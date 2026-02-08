/**
 * MACI-RLA E2E Test: Blockhash Commit-Reveal Workflow
 *
 * Tests the full RLA (Risk-Limiting Audit) workflow with 10 voters
 * across 4 margin ratios (9:1, 7:3, 6:4, 5:5).
 *
 * Uses blockhash-based commit-reveal randomness: the coordinator commits data,
 * then after BLOCK_HASH_DELAY blocks, blockhash provides unpredictable randomness.
 * With 10 voters (3 PM batches, 6 TV batches), all ratios converge to
 * full proof — this is expected; the test validates protocol correctness.
 */
import { expect } from "chai";
import hre from "hardhat";
const { ethers } = hre;
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
  ProofGenerator,
  TreeMerger,
} from "maci-contracts";
import type {
  MACI,
  Poll as PollContract,
  AccQueue,
  Verifier,
  VkRegistry,
} from "maci-contracts";
import {
  Poll__factory,
  AccQueueQuinaryMaci__factory,
} from "maci-contracts";
import { Keypair, PCommand, VerifyingKey } from "maci-domainobjs";
import { genRandomSalt } from "maci-crypto";

// ── Constants ──────────────────────────────────────────────────────────
const INITIAL_VOICE_CREDITS = 100;
const POLL_DURATION = 3600;
const VOTE_OPTION_NO = 0n;
const VOTE_OPTION_YES = 1n;
const COORDINATOR_STAKE = ethers.parseEther("0.1");

// Circuit params (10-2-1-2 for PM, 10-1-2 for TV)
const STATE_TREE_DEPTH = 10;
const INT_STATE_TREE_DEPTH = 1;
const MSG_TREE_DEPTH = 2;
const MSG_TREE_SUB_DEPTH = 1;
const VOTE_OPTION_TREE_DEPTH = 2;
const MSG_BATCH_SIZE = 5; // 5^1

const ZKEYS_DIR = path.resolve(__dirname, "../zkeys");

// PM paths
const PM_DIR = "ProcessMessages_10-2-1-2_test";
const PM_ZKEY = path.join(ZKEYS_DIR, PM_DIR, `${PM_DIR}.0.zkey`);
const PM_WASM = path.join(ZKEYS_DIR, PM_DIR, `${PM_DIR}_js`, `${PM_DIR}.wasm`);
const PM_VK_JSON = path.join(ZKEYS_DIR, PM_DIR, "groth16_vkey.json");

// TV paths
const TV_DIR = "TallyVotes_10-1-2_test";
const TV_ZKEY = path.join(ZKEYS_DIR, TV_DIR, `${TV_DIR}.0.zkey`);
const TV_WASM = path.join(ZKEYS_DIR, TV_DIR, `${TV_DIR}_js`, `${TV_DIR}.wasm`);
const TV_VK_JSON = path.join(ZKEYS_DIR, TV_DIR, "groth16_vkey.json");

// ── Test scenarios ─────────────────────────────────────────────────────
interface Scenario {
  name: string;
  yesVotes: number;
  noVotes: number;
}

const SCENARIOS: Scenario[] = [
  { name: "9:1", yesVotes: 9, noVotes: 1 },
  { name: "7:3", yesVotes: 7, noVotes: 3 },
  { name: "6:4", yesVotes: 6, noVotes: 4 },
  { name: "5:5", yesVotes: 5, noVotes: 5 },
];

// ── Helpers ────────────────────────────────────────────────────────────

function loadVk(vkPath: string): VerifyingKey {
  const raw = JSON.parse(fs.readFileSync(vkPath, "utf8"));
  return VerifyingKey.fromObj(raw);
}

async function timeTravel(seconds: number) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);
}

/**
 * Convert snarkjs proof to uint256[8] for on-chain verification.
 * snarkjs: { pi_a: [x,y,"1"], pi_b: [[x1,x2],[y1,y2],["1","0"]], pi_c: [x,y,"1"] }
 * uint256[8]: [a.x, a.y, b[0][1], b[0][0], b[1][1], b[1][0], c.x, c.y]
 * Note: pi_b coordinates are swapped (x1,x2 → x2,x1) for BN254 pairing.
 */
function proofToUint256Array(proof: any): string[] {
  return [
    proof.pi_a[0],
    proof.pi_a[1],
    proof.pi_b[0][1],
    proof.pi_b[0][0],
    proof.pi_b[1][1],
    proof.pi_b[1][0],
    proof.pi_c[0],
    proof.pi_c[1],
  ];
}

/**
 * Extract PM commitment chain from proof files.
 * MACI processes messages in reverse order, so process_0 is the FIRST batch executed.
 * Returns: [initial_sbCommitment, after_batch_1, after_batch_2, ..., final]
 */
function extractPmCommitments(outputDir: string): bigint[] {
  const proofFiles: any[] = [];
  let idx = 0;
  while (fs.existsSync(path.join(outputDir, `process_${idx}.json`))) {
    proofFiles.push(
      JSON.parse(fs.readFileSync(path.join(outputDir, `process_${idx}.json`), "utf8"))
    );
    idx++;
  }

  // process_0 = first executed batch (processes last messages)
  // The commitment chain follows execution order: process_0, process_1, ..., process_N
  const commitments: bigint[] = [];
  commitments.push(BigInt(proofFiles[0].circuitInputs.currentSbCommitment));
  for (const pf of proofFiles) {
    commitments.push(BigInt(pf.circuitInputs.newSbCommitment));
  }
  return commitments;
}

/**
 * Extract TV commitment chain from proof files.
 * Tally proofs are in forward order: tally_0, tally_1, ..., tally_N.
 * Returns: [0 (initial), after_tally_1, after_tally_2, ..., final]
 */
function extractTvCommitments(outputDir: string): bigint[] {
  const proofFiles: any[] = [];
  let idx = 0;
  while (fs.existsSync(path.join(outputDir, `tally_${idx}.json`))) {
    proofFiles.push(
      JSON.parse(fs.readFileSync(path.join(outputDir, `tally_${idx}.json`), "utf8"))
    );
    idx++;
  }

  const commitments: bigint[] = [];
  commitments.push(BigInt(proofFiles[0].circuitInputs.currentTallyCommitment));
  for (const pf of proofFiles) {
    commitments.push(BigInt(pf.circuitInputs.newTallyCommitment));
  }
  return commitments;
}

/**
 * Load proof files and return them indexed by batch number (0-based file index).
 */
function loadProofFiles(outputDir: string, prefix: string): any[] {
  const proofs: any[] = [];
  let idx = 0;
  while (fs.existsSync(path.join(outputDir, `${prefix}_${idx}.json`))) {
    proofs.push(
      JSON.parse(fs.readFileSync(path.join(outputDir, `${prefix}_${idx}.json`), "utf8"))
    );
    idx++;
  }
  return proofs;
}

function tryGC() {
  if (typeof global.gc === "function") {
    global.gc();
  }
}

// ── Test Suite ──────────────────────────────────────────────────────────

describe("MACI-RLA E2E: Blockhash Commit-Reveal Workflow", function () {
  this.timeout(1_200_000);

  // Summary table data
  const summaryRows: {
    scenario: string;
    margin: number;
    pmSamples: number;
    pmTotal: number;
    tvSamples: number;
    tvTotal: number;
    pass: boolean;
  }[] = [];

  for (const scenario of SCENARIOS) {
    it(`should complete RLA workflow for ${scenario.name} ratio (${scenario.yesVotes}Y/${scenario.noVotes}N)`, async function () {
      this.timeout(600_000);

      // Check zkeys exist
      if (!fs.existsSync(PM_ZKEY)) {
        console.log(`  Skipping: PM zkey not found at ${PM_ZKEY}`);
        this.skip();
        return;
      }
      if (!fs.existsSync(TV_ZKEY)) {
        console.log(`  Skipping: TV zkey not found at ${TV_ZKEY}`);
        this.skip();
        return;
      }

      tryGC();
      const totalVoters = scenario.yesVotes + scenario.noVotes;
      const outputDir = path.resolve(__dirname, `../proofs-rla-${scenario.name}`);
      const tallyFile = path.join(outputDir, "tally.json");

      // Clean output dir
      if (fs.existsSync(outputDir)) {
        fs.rmSync(outputDir, { recursive: true });
      }
      fs.mkdirSync(outputDir, { recursive: true });

      // ── 1. Deploy MACI infrastructure ──────────────────────────────
      console.log(`\n  [${scenario.name}] Deploying contracts...`);
      const deployer = await getDefaultSigner();

      const gatekeeperContract = await deployFreeForAllSignUpGatekeeper(deployer, true);
      const voiceCreditProxyContract = await deployConstantInitialVoiceCreditProxy(
        INITIAL_VOICE_CREDITS, deployer, true
      );
      const verifierContract = await deployVerifier(deployer, true);
      const vkRegistryContract = await deployVkRegistry(deployer, true);

      const r = await deployMaci({
        signUpTokenGatekeeperContractAddress: await gatekeeperContract.getAddress(),
        initialVoiceCreditBalanceAddress: await voiceCreditProxyContract.getAddress(),
        signer: deployer,
        stateTreeDepth: STATE_TREE_DEPTH,
        quiet: true,
      });
      const maciContract = r.maciContract;

      // Register VKs
      const processVk = loadVk(PM_VK_JSON);
      const tallyVk = loadVk(TV_VK_JSON);

      await (
        await vkRegistryContract.setVerifyingKeys(
          STATE_TREE_DEPTH,
          INT_STATE_TREE_DEPTH,
          MSG_TREE_DEPTH,
          VOTE_OPTION_TREE_DEPTH,
          MSG_BATCH_SIZE,
          EMode.QV,
          processVk.asContractParam(),
          tallyVk.asContractParam()
        )
      ).wait();

      // Deploy MaciRLA
      const MaciRLA = await ethers.getContractFactory("MaciRLA");
      const maciRLA = await MaciRLA.deploy(
        COORDINATOR_STAKE,
        ethers.parseEther("0.001"), // proofCostEstimate
        await verifierContract.getAddress(),
        await vkRegistryContract.getAddress()
      );
      await maciRLA.waitForDeployment();

      // ── 2. Deploy Poll ─────────────────────────────────────────────
      const coordinatorKeypair = new Keypair();

      const deployPollTx = await maciContract.deployPoll(
        POLL_DURATION,
        {
          intStateTreeDepth: INT_STATE_TREE_DEPTH,
          messageTreeSubDepth: MSG_TREE_SUB_DEPTH,
          messageTreeDepth: MSG_TREE_DEPTH,
          voteOptionTreeDepth: VOTE_OPTION_TREE_DEPTH,
        },
        coordinatorKeypair.pubKey.asContractParam(),
        await verifierContract.getAddress(),
        await vkRegistryContract.getAddress(),
        EMode.QV
      );
      await deployPollTx.wait();

      const pollId = (await maciContract.nextPollId()) - 1n;
      const pollContracts = await maciContract.getPoll(pollId);
      const pollContract = Poll__factory.connect(pollContracts.poll, deployer) as PollContract;
      const extContracts = await pollContract.extContracts();
      const messageAqContract = AccQueueQuinaryMaci__factory.connect(
        extContracts.messageAq, deployer
      ) as AccQueue;

      // ── 3. Sign up voters ──────────────────────────────────────────
      console.log(`  [${scenario.name}] Signing up ${totalVoters} voters...`);
      const voterKeypairs = Array.from({ length: totalVoters }, () => new Keypair());
      const stateIndices: bigint[] = [];

      for (let i = 0; i < totalVoters; i++) {
        const pubKey = voterKeypairs[i].pubKey.asContractParam();
        const tx = await maciContract.signUp(pubKey, "0x", "0x");
        const receipt = await tx.wait();
        const iface = maciContract.interface;
        const signUpLog = receipt!.logs.find((log) => {
          try {
            return iface.parseLog({ topics: [...log.topics], data: log.data })?.name === "SignUp";
          } catch { return false; }
        });
        const parsed = iface.parseLog({ topics: [...signUpLog!.topics], data: signUpLog!.data });
        stateIndices.push(BigInt(parsed!.args[0]));
      }

      // ── 4. Publish votes ───────────────────────────────────────────
      console.log(`  [${scenario.name}] Publishing ${scenario.yesVotes}Y/${scenario.noVotes}N votes...`);
      for (let i = 0; i < totalVoters; i++) {
        const voteOption = i < scenario.yesVotes ? VOTE_OPTION_YES : VOTE_OPTION_NO;
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
        await tx.wait();
      }

      // ── 5. Time travel + Merge trees ───────────────────────────────
      console.log(`  [${scenario.name}] Merging trees...`);
      await timeTravel(POLL_DURATION + 10);

      const merger = new TreeMerger({
        deployer: deployer as any,
        pollContract: pollContract as any,
        messageAccQueueContract: messageAqContract as any,
      });
      await merger.checkPollDuration();
      await merger.mergeSignups();
      await merger.mergeMessageSubtrees(0);
      await merger.mergeMessages();

      // ── 6. Generate proofs ─────────────────────────────────────────
      console.log(`  [${scenario.name}] Generating proofs...`);
      const maciAddress = await maciContract.getAddress();
      const maciState = await genMaciStateFromContract(
        ethers.provider,
        maciAddress,
        coordinatorKeypair,
        pollId,
        0
      );

      const poll = maciState.polls.get(pollId)!;
      poll.updatePoll(await maciContract.numSignUps());

      // We need a dummy tally address for ProofGenerator
      // Use deployer address as placeholder since we don't verify via Tally contract
      const proofGenerator = new ProofGenerator({
        poll,
        maciContractAddress: maciAddress,
        tallyContractAddress: maciAddress, // not used for proof gen
        outputDir,
        tallyOutputFile: tallyFile,
        useQuadraticVoting: true,
        mp: { zkey: PM_ZKEY, wasm: PM_WASM },
        tally: { zkey: TV_ZKEY, wasm: TV_WASM },
      });

      const mpProofs = await proofGenerator.generateMpProofs();
      const { proofs: tallyProofs } = await proofGenerator.generateTallyProofs(
        hre.network as any
      );

      console.log(`  [${scenario.name}] PM proofs: ${mpProofs.length}, TV proofs: ${tallyProofs.length}`);

      // ── 7. Verify tally correctness ────────────────────────────────
      const tallyData = JSON.parse(fs.readFileSync(tallyFile, "utf8"));
      const tallyNo = BigInt(tallyData.results.tally[0]);
      const tallyYes = BigInt(tallyData.results.tally[1]);
      expect(tallyNo).to.equal(BigInt(scenario.noVotes), "No vote tally mismatch");
      expect(tallyYes).to.equal(BigInt(scenario.yesVotes), "Yes vote tally mismatch");
      console.log(`  [${scenario.name}] Tally verified: No=${tallyNo} Yes=${tallyYes}`);

      // ── 8. Extract commitments from proof files ────────────────────
      const pmCommitmentsArr = extractPmCommitments(outputDir);
      const tvCommitmentsArr = extractTvCommitments(outputDir);

      console.log(`  [${scenario.name}] PM commitments: ${pmCommitmentsArr.length} (${pmCommitmentsArr.length - 1} batches)`);
      console.log(`  [${scenario.name}] TV commitments: ${tvCommitmentsArr.length} (${tvCommitmentsArr.length - 1} batches)`);

      // Verify commitment chain integrity
      expect(tvCommitmentsArr[0]).to.equal(0n, "TV initial commitment should be 0");

      // ── 9. MaciRLA.commitResult() ──────────────────────────────────
      console.log(`  [${scenario.name}] Committing result to MaciRLA...`);
      const pollAddress = await pollContract.getAddress();
      const coordBalanceBefore = await ethers.provider.getBalance(await deployer.getAddress());

      const commitTx = await maciRLA.commitResult(
        pollAddress,
        pmCommitmentsArr,
        tvCommitmentsArr,
        tallyYes, // yesVotes
        tallyNo,  // noVotes
        { value: COORDINATOR_STAKE }
      );
      const commitReceipt = await commitTx.wait();
      const rlaPollId = 0n; // first poll in MaciRLA

      // Check phase
      const auditAfterCommit = await maciRLA.pollAudits(rlaPollId);
      expect(auditAfterCommit.phase).to.equal(1n, "Phase should be Committed (1)");

      // ── 10. MaciRLA.revealSample() ─────────────────────────────────
      // Mine 1 block so blockhash(commitBlock + BLOCK_HASH_DELAY) is available
      console.log(`  [${scenario.name}] Mining block for blockhash availability...`);
      await ethers.provider.send("evm_mine", []);
      console.log(`  [${scenario.name}] Revealing sample (blockhash commit-reveal)...`);
      const revealTx = await maciRLA.revealSample(rlaPollId);
      await revealTx.wait();

      const auditAfterReveal = await maciRLA.pollAudits(rlaPollId);
      expect(auditAfterReveal.phase).to.equal(2n, "Phase should be SampleRevealed (2)");

      // Get sample info
      const [pmSampleCount, tvSampleCount] = await maciRLA.getSampleCounts(rlaPollId);
      const [pmSelectedIndices, tvSelectedIndices] = await maciRLA.getSelectedBatches(rlaPollId);

      console.log(`  [${scenario.name}] PM samples: ${pmSampleCount}/${pmCommitmentsArr.length - 1}, TV samples: ${tvSampleCount}/${tvCommitmentsArr.length - 1}`);
      console.log(`  [${scenario.name}] PM selected batches: [${pmSelectedIndices.join(", ")}]`);
      console.log(`  [${scenario.name}] TV selected batches: [${tvSelectedIndices.join(", ")}]`);

      // ── 11. Submit PM proofs for sampled batches ────────────────────
      console.log(`  [${scenario.name}] Submitting PM proofs...`);
      const pmProofFiles = loadProofFiles(outputDir, "process");

      for (let i = 0; i < Number(pmSampleCount); i++) {
        const batchIndex = Number(pmSelectedIndices[i]); // 1-based
        // MaciRLA batch index 1 = process_0 (first executed), etc.
        const fileIndex = batchIndex - 1;
        const proof = proofToUint256Array(pmProofFiles[fileIndex].proof);

        const tx = await maciRLA.submitPmProof(rlaPollId, i, proof);
        await tx.wait();
        console.log(`    PM batch ${batchIndex} (file: process_${fileIndex}) verified`);
      }

      // ── 12. Submit TV proofs for sampled batches ────────────────────
      console.log(`  [${scenario.name}] Submitting TV proofs...`);
      const tvProofFiles = loadProofFiles(outputDir, "tally");

      for (let i = 0; i < Number(tvSampleCount); i++) {
        const batchIndex = Number(tvSelectedIndices[i]); // 1-based
        // MaciRLA batch index 1 = tally_0 (first tally), etc.
        const fileIndex = batchIndex - 1;
        const proof = proofToUint256Array(tvProofFiles[fileIndex].proof);

        const tx = await maciRLA.submitTvProof(rlaPollId, i, proof);
        await tx.wait();
        console.log(`    TV batch ${batchIndex} (file: tally_${fileIndex}) verified`);
      }

      // ── 13. MaciRLA.finalizeSampling() ──────────────────────────────
      console.log(`  [${scenario.name}] Finalizing sampling...`);
      const finalizeSamplingTx = await maciRLA.finalizeSampling(rlaPollId);
      await finalizeSamplingTx.wait();

      const auditAfterSampling = await maciRLA.pollAudits(rlaPollId);
      expect(auditAfterSampling.phase).to.equal(4n, "Phase should be Tentative (4)");

      // ── 14. Time travel 7 days ──────────────────────────────────────
      console.log(`  [${scenario.name}] Time traveling 7 days...`);
      await timeTravel(7 * 24 * 3600 + 1);

      // ── 15. MaciRLA.finalize() ──────────────────────────────────────
      console.log(`  [${scenario.name}] Finalizing...`);
      const coordBalanceBeforeFinalize = await ethers.provider.getBalance(await deployer.getAddress());
      const finalizeTx = await maciRLA.finalize(rlaPollId);
      const finalizeReceipt = await finalizeTx.wait();
      const coordBalanceAfterFinalize = await ethers.provider.getBalance(await deployer.getAddress());

      const auditFinal = await maciRLA.pollAudits(rlaPollId);
      expect(auditFinal.phase).to.equal(6n, "Phase should be Finalized (6)");

      // Verify stake was returned (balance increased, minus gas)
      const gasUsed = finalizeReceipt!.gasUsed * finalizeReceipt!.gasPrice;
      const expectedReturn = coordBalanceBeforeFinalize + COORDINATOR_STAKE - gasUsed;
      expect(coordBalanceAfterFinalize).to.equal(expectedReturn, "Stake should be returned");

      console.log(`  [${scenario.name}] PASS — Finalized with stake returned`);

      // Collect summary
      const margin = Math.abs(scenario.yesVotes - scenario.noVotes);
      summaryRows.push({
        scenario: scenario.name,
        margin,
        pmSamples: Number(pmSampleCount),
        pmTotal: pmProofFiles.length,
        tvSamples: Number(tvSampleCount),
        tvTotal: tvProofFiles.length,
        pass: true,
      });
    });
  }

  after(function () {
    if (summaryRows.length === 0) return;

    // Print summary table
    const divider = "─".repeat(76);
    console.log(`\n${"═".repeat(76)}`);
    console.log("  MACI-RLA E2E RESULTS (10 voters, Blockhash Commit-Reveal)");
    console.log(`${"═".repeat(76)}`);
    console.log(
      `  ${"Scenario".padEnd(10)} ${"Margin".padEnd(8)} ${"PM Samp".padEnd(10)} ${"TV Samp".padEnd(10)} ${"PM Save".padEnd(10)} ${"TV Save".padEnd(10)} ${"Result".padEnd(8)}`
    );
    console.log(`  ${divider}`);
    for (const row of summaryRows) {
      const pmSave = row.pmTotal > 0
        ? `${(((row.pmTotal - row.pmSamples) / row.pmTotal) * 100).toFixed(0)}%`
        : "N/A";
      const tvSave = row.tvTotal > 0
        ? `${(((row.tvTotal - row.tvSamples) / row.tvTotal) * 100).toFixed(0)}%`
        : "N/A";
      console.log(
        `  ${row.scenario.padEnd(10)} ${String(row.margin).padEnd(8)} ${`${row.pmSamples}/${row.pmTotal}`.padEnd(10)} ${`${row.tvSamples}/${row.tvTotal}`.padEnd(10)} ${pmSave.padEnd(10)} ${tvSave.padEnd(10)} ${row.pass ? "PASS" : "FAIL"}`
      );
    }
    console.log(`${"═".repeat(76)}`);
  });
});
