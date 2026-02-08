/**
 * MACI E2E Benchmark: 10/50/100 Vote Scaling Test
 *
 * Runs parameterized E2E tests at different voter counts to measure:
 * - Wall clock time per phase (deploy, signUp, publish, merge, proof gen, on-chain verify)
 * - Gas usage per operation
 * - Memory usage (heap + peak RSS)
 * - Proof counts (ProcessMessages + TallyVotes)
 *
 * Circuit requirements:
 * - 10 votes: existing 10-2-1-2 zkeys (max 25 messages)
 * - 50/100 votes: compiled 10-3-1-2 zkeys (max 125 messages)
 *   Run `pnpm compile:circuit` first for 50/100 vote benchmarks.
 */
import { expect } from "chai";
import hre from "hardhat";
const { ethers } = hre;
import { type Signer } from "ethers";
import * as path from "path";
import * as fs from "fs";

import {
  deployMaci,
  deployVkRegistry,
  deployVerifier,
  deployFreeForAllSignUpGatekeeper,
  deployConstantInitialVoiceCreditProxy,
  genMaciStateFromContract,
  getDefaultSigner,
  EMode,
  Prover,
  ProofGenerator,
  TreeMerger,
} from "maci-contracts";
import type {
  MACI,
  Poll as PollContract,
  MessageProcessor,
  Tally,
  AccQueue,
  Verifier,
  VkRegistry,
} from "maci-contracts";
import {
  Poll__factory,
  MessageProcessor__factory,
  Tally__factory,
  AccQueueQuinaryMaci__factory,
} from "maci-contracts";
import { Keypair, PCommand, VerifyingKey } from "maci-domainobjs";
import { genRandomSalt } from "maci-crypto";

import { BENCHMARKS as ALL_BENCHMARKS, type BenchmarkConfig } from "./benchmark-config";

// ── Process isolation: BENCH_NAME env var selects a single benchmark ────
// When set, only that benchmark runs (used by the wrapper script).
// When unset, all benchmarks run in the same process (legacy mode).
const BENCH_NAME = process.env.BENCH_NAME;
const BENCHMARKS = BENCH_NAME
  ? ALL_BENCHMARKS.filter((b) => b.name === BENCH_NAME)
  : ALL_BENCHMARKS;

// ── Constants ──────────────────────────────────────────────────────────
const INITIAL_VOICE_CREDITS = 100;
const POLL_DURATION = 3600; // 1 hour - needs to be long enough that voting doesn't expire during benchmark
const VOTE_OPTION_NO = 0n;
const VOTE_OPTION_YES = 1n;

// ── Types ──────────────────────────────────────────────────────────────
interface BenchmarkResult {
  name: string;
  numVoters: number;
  timings: Record<string, number>;
  gasUsed: Record<string, string>; // bigint serialized as string
  memory: {
    heapUsedMB: number;
    rssMB: number;
    peakRssKB: number | null;
  };
  proofCounts: {
    processMessages: number;
    tallyVotes: number;
    total: number;
  };
  tally: {
    noVotes: string;
    yesVotes: string;
    correct: boolean;
  };
}

// ── Helpers ────────────────────────────────────────────────────────────

function loadVk(vkPath: string): VerifyingKey {
  const raw = JSON.parse(fs.readFileSync(vkPath, "utf8"));
  return VerifyingKey.fromObj(raw);
}

async function timeTravel(seconds: number) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);
}

function getMemoryUsage(): { heapUsedMB: number; rssMB: number } {
  const mem = process.memoryUsage();
  return {
    heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
    rssMB: Math.round(mem.rss / 1024 / 1024),
  };
}

function getPeakRssKB(): number | null {
  try {
    const status = fs.readFileSync("/proc/self/status", "utf8");
    const match = status.match(/VmHWM:\s+(\d+)\s+kB/);
    return match ? parseInt(match[1], 10) : null;
  } catch {
    return null;
  }
}

function tryGC() {
  if (typeof global.gc === "function") {
    global.gc();
  }
}

async function getGasInBlockRange(
  provider: typeof ethers.provider,
  startBlock: number,
  endBlock: number
): Promise<bigint> {
  let total = 0n;
  for (let b = startBlock; b <= endBlock; b++) {
    const block = await provider.getBlock(b);
    if (!block) continue;
    for (const txHash of block.transactions) {
      const receipt = await provider.getTransactionReceipt(txHash);
      if (receipt) total += receipt.gasUsed;
    }
  }
  return total;
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function formatGas(gas: bigint): string {
  if (gas > 1_000_000n) return `${(Number(gas) / 1_000_000).toFixed(2)}M`;
  if (gas > 1_000n) return `${(Number(gas) / 1_000).toFixed(1)}K`;
  return gas.toString();
}

// ── Single benchmark runner ────────────────────────────────────────────

async function runBenchmark(config: BenchmarkConfig): Promise<BenchmarkResult> {
  const timings: Record<string, number> = {};
  const gasUsed: Record<string, bigint> = {};

  const deployer = await getDefaultSigner();
  const coordinatorKeypair = new Keypair();
  const voterKeypairs = Array.from({ length: config.numVoters }, () => new Keypair());
  const stateIndices: bigint[] = [];

  const outputDir = path.resolve(__dirname, `../proofs-${config.name}`);
  const tallyFile = path.join(outputDir, "tally.json");

  // Clean output dir
  if (fs.existsSync(outputDir)) {
    fs.rmSync(outputDir, { recursive: true });
  }
  fs.mkdirSync(outputDir, { recursive: true });

  // ── Deploy ──────────────────────────────────────────────────────────
  console.log(`\n  [${config.name}] Deploying contracts...`);
  let start = Date.now();

  const gatekeeperContract = await deployFreeForAllSignUpGatekeeper(deployer, true);
  const voiceCreditProxyContract = await deployConstantInitialVoiceCreditProxy(
    INITIAL_VOICE_CREDITS,
    deployer,
    true
  );
  const verifierContract = await deployVerifier(deployer, true);
  const vkRegistryContract = await deployVkRegistry(deployer, true);

  const r = await deployMaci({
    signUpTokenGatekeeperContractAddress: await gatekeeperContract.getAddress(),
    initialVoiceCreditBalanceAddress: await voiceCreditProxyContract.getAddress(),
    signer: deployer,
    stateTreeDepth: config.stateTreeDepth,
    quiet: true,
  });
  const maciContract = r.maciContract;

  // Register verifying keys
  const processVk = loadVk(config.processVkJson);
  const tallyVk = loadVk(config.tallyVkJson);

  await (
    await vkRegistryContract.setVerifyingKeys(
      config.stateTreeDepth,
      config.intStateTreeDepth,
      config.msgTreeDepth,
      config.voteOptionTreeDepth,
      config.msgBatchSize,
      EMode.QV,
      processVk.asContractParam(),
      tallyVk.asContractParam()
    )
  ).wait();

  timings["deploy"] = Date.now() - start;

  // ── Deploy Poll ─────────────────────────────────────────────────────
  const deployPollTx = await maciContract.deployPoll(
    POLL_DURATION,
    {
      intStateTreeDepth: config.intStateTreeDepth,
      messageTreeSubDepth: config.msgTreeSubDepth,
      messageTreeDepth: config.msgTreeDepth,
      voteOptionTreeDepth: config.voteOptionTreeDepth,
    },
    coordinatorKeypair.pubKey.asContractParam(),
    await verifierContract.getAddress(),
    await vkRegistryContract.getAddress(),
    EMode.QV
  );
  const deployPollReceipt = await deployPollTx.wait();
  gasUsed["deployPoll"] = deployPollReceipt!.gasUsed;

  const pollId = (await maciContract.nextPollId()) - 1n;
  const pollContracts = await maciContract.getPoll(pollId);
  const pollContract = Poll__factory.connect(pollContracts.poll, deployer) as PollContract;
  const mpContract = MessageProcessor__factory.connect(
    pollContracts.messageProcessor,
    deployer
  ) as MessageProcessor;
  const tallyContract = Tally__factory.connect(pollContracts.tally, deployer) as Tally;
  const extContracts = await pollContract.extContracts();
  const messageAqContract = AccQueueQuinaryMaci__factory.connect(
    extContracts.messageAq,
    deployer
  ) as AccQueue;

  // ── Sign Up ─────────────────────────────────────────────────────────
  console.log(`  [${config.name}] Signing up ${config.numVoters} voters...`);
  start = Date.now();
  let signUpGas = 0n;

  for (let i = 0; i < config.numVoters; i++) {
    const pubKey = voterKeypairs[i].pubKey.asContractParam();
    const tx = await maciContract.signUp(pubKey, "0x", "0x");
    const receipt = await tx.wait();
    signUpGas += receipt!.gasUsed;

    const iface = maciContract.interface;
    const signUpLog = receipt!.logs.find((log) => {
      try {
        return iface.parseLog({ topics: [...log.topics], data: log.data })?.name === "SignUp";
      } catch {
        return false;
      }
    });
    const parsed = iface.parseLog({ topics: [...signUpLog!.topics], data: signUpLog!.data });
    stateIndices.push(BigInt(parsed!.args[0]));
  }

  gasUsed["signUp_total"] = signUpGas;
  gasUsed["signUp_avg"] = signUpGas / BigInt(config.numVoters);
  timings["signUp"] = Date.now() - start;

  // ── Publish Votes ───────────────────────────────────────────────────
  const numYes = Math.round(config.numVoters * config.yesRatio);
  console.log(`  [${config.name}] Publishing ${config.numVoters} votes (${numYes} Yes, ${config.numVoters - numYes} No)...`);
  start = Date.now();
  let publishGas = 0n;

  for (let i = 0; i < config.numVoters; i++) {
    const voteOption = i < numYes ? VOTE_OPTION_YES : VOTE_OPTION_NO;
    const command = new PCommand(
      stateIndices[i],
      voterKeypairs[i].pubKey,
      voteOption,
      1n, // voteWeight
      1n, // nonce
      pollId,
      genRandomSalt()
    );

    const signature = command.sign(voterKeypairs[i].privKey);
    const ephemeralKeypair = new Keypair();
    const sharedKey = Keypair.genEcdhSharedKey(ephemeralKeypair.privKey, coordinatorKeypair.pubKey);
    const message = command.encrypt(signature, sharedKey);

    const tx = await pollContract.publishMessage(
      message.asContractParam(),
      ephemeralKeypair.pubKey.asContractParam()
    );
    const receipt = await tx.wait();
    publishGas += receipt!.gasUsed;
  }

  gasUsed["publish_total"] = publishGas;
  gasUsed["publish_avg"] = publishGas / BigInt(config.numVoters);
  timings["publish"] = Date.now() - start;

  // ── Merge Trees ─────────────────────────────────────────────────────
  console.log(`  [${config.name}] Merging trees...`);
  start = Date.now();
  await timeTravel(POLL_DURATION + 10);

  const merger = new TreeMerger({
    deployer: deployer as any,
    pollContract: pollContract as any,
    messageAccQueueContract: messageAqContract as any,
  });

  const mergeBlockBefore = await ethers.provider.getBlockNumber();
  await merger.checkPollDuration();
  await merger.mergeSignups();
  await merger.mergeMessageSubtrees(0);
  await merger.mergeMessages();
  const mergeBlockAfter = await ethers.provider.getBlockNumber();
  timings["merge"] = Date.now() - start;

  // ── Generate Proofs ─────────────────────────────────────────────────
  console.log(`  [${config.name}] Generating proofs...`);
  start = Date.now();
  const memBefore = getMemoryUsage();

  const maciAddress = await maciContract.getAddress();
  const tallyAddress = await tallyContract.getAddress();

  const maciState = await genMaciStateFromContract(
    ethers.provider,
    maciAddress,
    coordinatorKeypair,
    pollId,
    0
  );

  const poll = maciState.polls.get(pollId)!;
  poll.updatePoll(await maciContract.numSignUps());

  const proofGenerator = new ProofGenerator({
    poll,
    maciContractAddress: maciAddress,
    tallyContractAddress: tallyAddress,
    outputDir,
    tallyOutputFile: tallyFile,
    useQuadraticVoting: true,
    mp: {
      zkey: config.processZkey,
      wasm: config.processWasm,
    },
    tally: {
      zkey: config.tallyZkey,
      wasm: config.tallyWasm,
    },
  });

  const processStart = Date.now();
  const mpProofs = await proofGenerator.generateMpProofs();
  timings["processProofs"] = Date.now() - processStart;

  const tallyStart = Date.now();
  const { proofs: tallyProofs, tallyData } = await proofGenerator.generateTallyProofs(
    hre.network as any
  );
  timings["tallyProofs"] = Date.now() - tallyStart;
  timings["totalProofGen"] = Date.now() - start;

  const memAfter = getMemoryUsage();
  const peakRss = getPeakRssKB();

  console.log(`  [${config.name}] PM proofs: ${mpProofs.length}, TV proofs: ${tallyProofs.length}`);
  console.log(`  [${config.name}] Proof gen: ${formatMs(timings["totalProofGen"])}`);

  // ── On-Chain Verification ───────────────────────────────────────────
  console.log(`  [${config.name}] Verifying proofs on-chain...`);
  start = Date.now();

  // Read proofs from files
  const mpProofsFromFiles = [];
  let idx = 0;
  while (fs.existsSync(path.join(outputDir, `process_${idx}.json`))) {
    mpProofsFromFiles.push(
      JSON.parse(fs.readFileSync(path.join(outputDir, `process_${idx}.json`), "utf8"))
    );
    idx++;
  }

  const tallyProofsFromFiles = [];
  idx = 0;
  while (fs.existsSync(path.join(outputDir, `tally_${idx}.json`))) {
    tallyProofsFromFiles.push(
      JSON.parse(fs.readFileSync(path.join(outputDir, `tally_${idx}.json`), "utf8"))
    );
    idx++;
  }

  const tallyDataFromFile = JSON.parse(fs.readFileSync(tallyFile, "utf8"));

  const prover = new Prover({
    pollContract: pollContract as any,
    mpContract: mpContract as any,
    messageAqContract: messageAqContract as any,
    maciContract: maciContract as any,
    vkRegistryContract: vkRegistryContract as any,
    verifierContract: verifierContract as any,
    tallyContract: tallyContract as any,
  });

  // Collect merge gas from block range
  gasUsed["merge_total"] = await getGasInBlockRange(ethers.provider, mergeBlockBefore + 1, mergeBlockAfter);

  const mpBlockBefore = await ethers.provider.getBlockNumber();
  const mpOnChainStart = Date.now();
  await prover.proveMessageProcessing(mpProofsFromFiles);
  timings["mpOnChain"] = Date.now() - mpOnChainStart;
  const mpBlockAfter = await ethers.provider.getBlockNumber();

  const tvBlockBefore = await ethers.provider.getBlockNumber();
  const tvOnChainStart = Date.now();
  await prover.proveTally(tallyProofsFromFiles);
  timings["tvOnChain"] = Date.now() - tvOnChainStart;
  const tvBlockAfter = await ethers.provider.getBlockNumber();

  gasUsed["mpVerify_total"] = await getGasInBlockRange(ethers.provider, mpBlockBefore + 1, mpBlockAfter);
  gasUsed["mpVerify_avg"] = gasUsed["mpVerify_total"] / BigInt(mpProofsFromFiles.length);
  gasUsed["tvVerify_total"] = await getGasInBlockRange(ethers.provider, tvBlockBefore + 1, tvBlockAfter);
  gasUsed["tvVerify_avg"] = gasUsed["tvVerify_total"] / BigInt(tallyProofsFromFiles.length);

  const submitBlockBefore = await ethers.provider.getBlockNumber();
  await prover.submitResults(tallyDataFromFile);
  const submitBlockAfter = await ethers.provider.getBlockNumber();
  gasUsed["submitResults"] = await getGasInBlockRange(ethers.provider, submitBlockBefore + 1, submitBlockAfter);
  timings["onChainVerify"] = Date.now() - start;

  // ── Verify Tally ────────────────────────────────────────────────────
  const noVotes = BigInt(tallyDataFromFile.results.tally[0]);
  const yesVotes = BigInt(tallyDataFromFile.results.tally[1]);
  const expectedNo = BigInt(config.numVoters - numYes);
  const expectedYes = BigInt(numYes);
  const tallyCorrect = noVotes === expectedNo && yesVotes === expectedYes;

  console.log(`  [${config.name}] Tally: No=${noVotes} Yes=${yesVotes} (expected No=${expectedNo} Yes=${expectedYes}) ${tallyCorrect ? "PASS" : "FAIL"}`);

  return {
    name: config.name,
    numVoters: config.numVoters,
    timings,
    gasUsed: Object.fromEntries(
      Object.entries(gasUsed).map(([k, v]) => [k, v.toString()])
    ),
    memory: {
      heapUsedMB: memAfter.heapUsedMB,
      rssMB: memAfter.rssMB,
      peakRssKB: peakRss,
    },
    proofCounts: {
      processMessages: mpProofs.length,
      tallyVotes: tallyProofs.length,
      total: mpProofs.length + tallyProofs.length,
    },
    tally: {
      noVotes: noVotes.toString(),
      yesVotes: yesVotes.toString(),
      correct: tallyCorrect,
    },
  };
}

// ── Print comparison table ─────────────────────────────────────────────

function printComparisonTable(results: BenchmarkResult[]) {
  const divider = "─".repeat(90);
  console.log(`\n${"═".repeat(90)}`);
  console.log("  MACI E2E BENCHMARK COMPARISON");
  console.log(`${"═".repeat(90)}`);

  // Timing table
  console.log(`\n  ┌─ Timing (wall clock) ${divider.slice(24)}┐`);
  const timingKeys = ["deploy", "signUp", "publish", "merge", "processProofs", "tallyProofs", "totalProofGen", "mpOnChain", "tvOnChain", "onChainVerify"];
  const header = "  │ " + "Phase".padEnd(20) + results.map((r) => r.name.padStart(14)).join("") + " │";
  console.log(header);
  console.log(`  ├${"─".repeat(88)}┤`);
  for (const key of timingKeys) {
    const row =
      "  │ " +
      key.padEnd(20) +
      results.map((r) => formatMs(r.timings[key] || 0).padStart(14)).join("") +
      " │";
    console.log(row);
  }
  console.log(`  └${"─".repeat(88)}┘`);

  // Gas table
  console.log(`\n  ┌─ Gas Usage ${divider.slice(13)}┐`);
  const gasKeys = [
    "deployPoll", "signUp_total", "signUp_avg", "publish_total", "publish_avg",
    "merge_total", "mpVerify_total", "mpVerify_avg", "tvVerify_total", "tvVerify_avg", "submitResults",
  ];
  const gasHeader = "  │ " + "Operation".padEnd(20) + results.map((r) => r.name.padStart(14)).join("") + " │";
  console.log(gasHeader);
  console.log(`  ├${"─".repeat(88)}┤`);
  for (const key of gasKeys) {
    const row =
      "  │ " +
      key.padEnd(20) +
      results
        .map((r) => {
          const val = r.gasUsed[key];
          return val ? formatGas(BigInt(val)).padStart(14) : "N/A".padStart(14);
        })
        .join("") +
      " │";
    console.log(row);
  }
  console.log(`  └${"─".repeat(88)}┘`);

  // Proof counts
  console.log(`\n  ┌─ Proof Counts ${divider.slice(17)}┐`);
  const proofHeader = "  │ " + "Metric".padEnd(20) + results.map((r) => r.name.padStart(14)).join("") + " │";
  console.log(proofHeader);
  console.log(`  ├${"─".repeat(88)}┤`);
  for (const key of ["processMessages", "tallyVotes", "total"] as const) {
    const row =
      "  │ " +
      key.padEnd(20) +
      results.map((r) => String(r.proofCounts[key]).padStart(14)).join("") +
      " │";
    console.log(row);
  }
  console.log(`  └${"─".repeat(88)}┘`);

  // Memory
  console.log(`\n  ┌─ Memory ${divider.slice(11)}┐`);
  const memHeader = "  │ " + "Metric".padEnd(20) + results.map((r) => r.name.padStart(14)).join("") + " │";
  console.log(memHeader);
  console.log(`  ├${"─".repeat(88)}┤`);
  console.log(
    "  │ " +
      "Heap Used (MB)".padEnd(20) +
      results.map((r) => String(r.memory.heapUsedMB).padStart(14)).join("") +
      " │"
  );
  console.log(
    "  │ " +
      "RSS (MB)".padEnd(20) +
      results.map((r) => String(r.memory.rssMB).padStart(14)).join("") +
      " │"
  );
  console.log(
    "  │ " +
      "Peak RSS (MB)".padEnd(20) +
      results
        .map((r) => {
          const peak = r.memory.peakRssKB;
          return peak ? String(Math.round(peak / 1024)).padStart(14) : "N/A".padStart(14);
        })
        .join("") +
      " │"
  );
  console.log(`  └${"─".repeat(88)}┘`);

  // Tally correctness
  console.log(`\n  ┌─ Tally Correctness ${divider.slice(22)}┐`);
  for (const r of results) {
    console.log(
      `  │ ${r.name.padEnd(12)} No=${r.tally.noVotes} Yes=${r.tally.yesVotes} ${r.tally.correct ? "PASS" : "FAIL"}`.padEnd(
        90
      ) + " │"
    );
  }
  console.log(`  └${"─".repeat(88)}┘`);
}

// ── Test suite ─────────────────────────────────────────────────────────

describe("MACI E2E Benchmark", function () {
  this.timeout(1_200_000); // 20 min total

  const results: BenchmarkResult[] = [];

  for (const config of BENCHMARKS) {
    it(`should complete ${config.name} benchmark`, async function () {
      // Check zkeys exist
      if (!fs.existsSync(config.processZkey)) {
        console.log(`  Skipping ${config.name}: zkey not found at ${config.processZkey}`);
        console.log(`  Run: pnpm compile:circuit (for 10-3-1-2 circuits)`);
        this.skip();
        return;
      }
      if (!fs.existsSync(config.tallyZkey)) {
        console.log(`  Skipping ${config.name}: tally zkey not found at ${config.tallyZkey}`);
        this.skip();
        return;
      }

      // Set per-benchmark timeout based on voter count
      this.timeout(config.numVoters <= 10 ? 300_000 : config.numVoters <= 50 ? 600_000 : 900_000);

      tryGC();
      const result = await runBenchmark(config);
      results.push(result);

      // Assert tally correctness
      expect(result.tally.correct).to.be.true;
    });
  }

  after(function () {
    if (results.length === 0) return;

    const resultsDir = path.resolve(__dirname, "..");

    // Save per-benchmark result file (for process isolation)
    for (const r of results) {
      const perFile = path.join(resultsDir, `benchmark-results-${r.name}.json`);
      fs.writeFileSync(perFile, JSON.stringify(r, null, 2));
    }

    // Merge all per-benchmark result files for comparison table
    const allResults: BenchmarkResult[] = [];
    for (const config of ALL_BENCHMARKS) {
      const perFile = path.join(resultsDir, `benchmark-results-${config.name}.json`);
      if (fs.existsSync(perFile)) {
        allResults.push(JSON.parse(fs.readFileSync(perFile, "utf8")));
      }
    }

    // Print comparison table with all available results
    printComparisonTable(allResults);

    // Save combined results
    const outputPath = path.join(resultsDir, "benchmark-results.json");
    fs.writeFileSync(outputPath, JSON.stringify(allResults, null, 2));
    console.log(`\n  Results saved to: ${outputPath}`);
  });
});
