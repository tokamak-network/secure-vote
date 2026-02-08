/**
 * MACI-RLA Scenario E2E Tests
 *
 * 4 scenarios testing the full RLA lifecycle:
 *   1. Happy Path — normal finalize with sampled proofs only
 *   2. Challenge + Coordinator Responds — challenger loses bond
 *   3. Challenge + Coordinator Timeout — result rejected, stake slashed
 *   4. Invalid Proof During Challenge — immediate rejection
 *
 * Each scenario deploys fresh MACI infrastructure (clean state).
 * Uses 10 voters with 7:3 (yes:no) ratio.
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
const PROOF_COST_ESTIMATE = ethers.parseEther("0.001");

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

// ── Helpers ────────────────────────────────────────────────────────────

function loadVk(vkPath: string): VerifyingKey {
  const raw = JSON.parse(fs.readFileSync(vkPath, "utf8"));
  return VerifyingKey.fromObj(raw);
}

async function timeTravel(seconds: number) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);
}

async function mineBlocks(n: number) {
  for (let i = 0; i < n; i++) {
    await ethers.provider.send("evm_mine", []);
  }
}

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

function extractPmCommitments(outputDir: string): bigint[] {
  const proofFiles: any[] = [];
  let idx = 0;
  while (fs.existsSync(path.join(outputDir, `process_${idx}.json`))) {
    proofFiles.push(
      JSON.parse(fs.readFileSync(path.join(outputDir, `process_${idx}.json`), "utf8"))
    );
    idx++;
  }
  const commitments: bigint[] = [];
  commitments.push(BigInt(proofFiles[0].circuitInputs.currentSbCommitment));
  for (const pf of proofFiles) {
    commitments.push(BigInt(pf.circuitInputs.newSbCommitment));
  }
  return commitments;
}

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

/**
 * Deploy MACI infrastructure + MaciRLA + create poll + sign up + vote.
 * Returns everything needed for the RLA workflow.
 */
async function deployAndVote(
  scenarioName: string,
  yesVotes: number,
  noVotes: number
) {
  const totalVoters = yesVotes + noVotes;
  const outputDir = path.resolve(__dirname, `../proofs-scenario-${scenarioName}`);
  const tallyFile = path.join(outputDir, "tally.json");

  if (fs.existsSync(outputDir)) {
    fs.rmSync(outputDir, { recursive: true });
  }
  fs.mkdirSync(outputDir, { recursive: true });

  const deployer = await getDefaultSigner();
  const signers = await ethers.getSigners();

  // Deploy MACI infrastructure
  console.log(`  [${scenarioName}] Deploying contracts...`);
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
    PROOF_COST_ESTIMATE,
    await verifierContract.getAddress(),
    await vkRegistryContract.getAddress()
  );
  await maciRLA.waitForDeployment();

  // Deploy Poll
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

  // Sign up voters
  console.log(`  [${scenarioName}] Signing up ${totalVoters} voters...`);
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

  // Publish votes
  console.log(`  [${scenarioName}] Publishing ${yesVotes}Y/${noVotes}N votes...`);
  for (let i = 0; i < totalVoters; i++) {
    const voteOption = i < yesVotes ? VOTE_OPTION_YES : VOTE_OPTION_NO;
    const command = new PCommand(
      stateIndices[i],
      voterKeypairs[i].pubKey,
      voteOption,
      1n,
      1n,
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

  // Time travel + merge trees
  console.log(`  [${scenarioName}] Merging trees...`);
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

  // Generate ALL proofs (needed for challenge scenarios)
  console.log(`  [${scenarioName}] Generating proofs...`);
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

  const proofGenerator = new ProofGenerator({
    poll,
    maciContractAddress: maciAddress,
    tallyContractAddress: maciAddress,
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

  console.log(`  [${scenarioName}] PM proofs: ${mpProofs.length}, TV proofs: ${tallyProofs.length}`);

  // Verify tally
  const tallyData = JSON.parse(fs.readFileSync(tallyFile, "utf8"));
  const tallyNo = BigInt(tallyData.results.tally[0]);
  const tallyYes = BigInt(tallyData.results.tally[1]);

  const pmCommitments = extractPmCommitments(outputDir);
  const tvCommitments = extractTvCommitments(outputDir);
  const pmProofFiles = loadProofFiles(outputDir, "process");
  const tvProofFiles = loadProofFiles(outputDir, "tally");

  return {
    deployer,
    signers,
    maciContract,
    maciRLA,
    pollContract,
    pollId,
    coordinatorKeypair,
    outputDir,
    tallyYes,
    tallyNo,
    pmCommitments,
    tvCommitments,
    pmProofFiles,
    tvProofFiles,
  };
}

/**
 * Run the common flow: commitResult → revealSample → submit sampled proofs → finalizeSampling
 * Returns the rlaPollId and sample info.
 */
async function commitRevealAndSubmit(ctx: Awaited<ReturnType<typeof deployAndVote>>) {
  const { deployer, maciRLA, pollContract, pmCommitments, tvCommitments, tallyYes, tallyNo, pmProofFiles, tvProofFiles } = ctx;
  const pollAddress = await pollContract.getAddress();

  // commitResult
  const commitTx = await maciRLA.commitResult(
    pollAddress,
    pmCommitments,
    tvCommitments,
    tallyYes,
    tallyNo,
    { value: COORDINATOR_STAKE }
  );
  await commitTx.wait();
  const rlaPollId = 0n;

  // Mine block + revealSample
  await mineBlocks(1);
  const revealTx = await maciRLA.revealSample(rlaPollId);
  await revealTx.wait();

  // Get sample info
  const [pmSampleCount, tvSampleCount] = await maciRLA.getSampleCounts(rlaPollId);
  const [pmSelectedIndices, tvSelectedIndices] = await maciRLA.getSelectedBatches(rlaPollId);

  // Submit PM proofs for sampled batches
  for (let i = 0; i < Number(pmSampleCount); i++) {
    const batchIndex = Number(pmSelectedIndices[i]);
    const fileIndex = batchIndex - 1;
    const proof = proofToUint256Array(pmProofFiles[fileIndex].proof);
    const tx = await maciRLA.submitPmProof(rlaPollId, i, proof);
    await tx.wait();
  }

  // Submit TV proofs for sampled batches
  for (let i = 0; i < Number(tvSampleCount); i++) {
    const batchIndex = Number(tvSelectedIndices[i]);
    const fileIndex = batchIndex - 1;
    const proof = proofToUint256Array(tvProofFiles[fileIndex].proof);
    const tx = await maciRLA.submitTvProof(rlaPollId, i, proof);
    await tx.wait();
  }

  // finalizeSampling
  const finalizeSamplingTx = await maciRLA.finalizeSampling(rlaPollId);
  await finalizeSamplingTx.wait();

  return {
    rlaPollId,
    pmSampleCount: Number(pmSampleCount),
    tvSampleCount: Number(tvSampleCount),
    pmSelectedIndices: pmSelectedIndices.map(Number),
    tvSelectedIndices: tvSelectedIndices.map(Number),
  };
}

// ── Test Suite ──────────────────────────────────────────────────────────

describe("MACI-RLA Scenario E2E Tests", function () {
  this.timeout(1_200_000);

  before(function () {
    if (!fs.existsSync(PM_ZKEY) || !fs.existsSync(TV_ZKEY)) {
      console.log("  Skipping: zkeys not found");
      this.skip();
    }
  });

  // ────────────────────────────────────────────────────────────────────
  // Scenario 1: Happy Path (Normal Finalize)
  // ────────────────────────────────────────────────────────────────────
  it("Scenario 1: Happy Path — sampled proofs only → Finalized", async function () {
    this.timeout(600_000);
    tryGC();
    console.log("\n  === Scenario 1: Happy Path ===");

    const ctx = await deployAndVote("s1-happy", 7, 3);
    const { maciRLA, deployer, tallyYes, tallyNo } = ctx;

    // Commit → Reveal → Submit → finalizeSampling
    const { rlaPollId, pmSampleCount, tvSampleCount } = await commitRevealAndSubmit(ctx);

    // Verify Tentative phase
    let audit = await maciRLA.pollAudits(rlaPollId);
    expect(audit.phase).to.equal(4n, "Should be Tentative (4)");

    // Time travel 7 days
    console.log("  [s1] Time traveling 7 days...");
    await timeTravel(7 * 24 * 3600 + 1);

    // Finalize
    const coordBalanceBefore = await ethers.provider.getBalance(await deployer.getAddress());
    const finalizeTx = await maciRLA.finalize(rlaPollId);
    const finalizeReceipt = await finalizeTx.wait();
    const coordBalanceAfter = await ethers.provider.getBalance(await deployer.getAddress());

    audit = await maciRLA.pollAudits(rlaPollId);
    expect(audit.phase).to.equal(6n, "Should be Finalized (6)");

    // Verify stake returned
    const gasUsed = finalizeReceipt!.gasUsed * finalizeReceipt!.gasPrice;
    const expectedReturn = coordBalanceBefore + COORDINATOR_STAKE - gasUsed;
    expect(coordBalanceAfter).to.equal(expectedReturn, "Stake should be returned");

    console.log(`  [s1] PASS — Finalized. Sampled: ${pmSampleCount} PM + ${tvSampleCount} TV`);
    console.log(`  [s1] Tally: Yes=${tallyYes}, No=${tallyNo}. Stake returned.`);
  });

  // ────────────────────────────────────────────────────────────────────
  // Scenario 2: Challenge + Coordinator Responds (Challenger Loses)
  // ────────────────────────────────────────────────────────────────────
  it("Scenario 2: Challenge + Respond — coordinator proves all → Finalized, challenger loses bond", async function () {
    this.timeout(600_000);
    tryGC();
    console.log("\n  === Scenario 2: Challenge + Coordinator Responds ===");

    const ctx = await deployAndVote("s2-challenge-respond", 7, 3);
    const { maciRLA, deployer, signers, pmProofFiles, tvProofFiles } = ctx;

    // Commit → Reveal → Submit → finalizeSampling
    const { rlaPollId } = await commitRevealAndSubmit(ctx);

    // Verify Tentative
    let audit = await maciRLA.pollAudits(rlaPollId);
    expect(audit.phase).to.equal(4n, "Should be Tentative (4)");

    // Challenger = signers[1]
    const challenger = signers[1];
    const challengeBond = await maciRLA.getChallengeBondAmount(rlaPollId);
    console.log(`  [s2] Challenge bond required: ${ethers.formatEther(challengeBond)} ETH`);

    const challengerBalanceBefore = await ethers.provider.getBalance(challenger.address);

    // Challenge
    console.log("  [s2] Challenger submitting challenge...");
    const challengeTx = await maciRLA.connect(challenger).challenge(rlaPollId, { value: challengeBond });
    const challengeReceipt = await challengeTx.wait();
    const challengeGas = challengeReceipt!.gasUsed * challengeReceipt!.gasPrice;

    audit = await maciRLA.pollAudits(rlaPollId);
    expect(audit.phase).to.equal(5n, "Should be Challenged (5)");
    expect(audit.challenger).to.equal(challenger.address);

    // Coordinator submits remaining proofs
    console.log("  [s2] Coordinator submitting all remaining proofs...");
    const pmBatchCount = Number(audit.pmBatchCount);
    const tvBatchCount = Number(audit.tvBatchCount);

    for (let batchIdx = 1; batchIdx <= pmBatchCount; batchIdx++) {
      const verified = await maciRLA.pmBatchVerified(rlaPollId, batchIdx);
      if (verified) continue;
      const proof = proofToUint256Array(pmProofFiles[batchIdx - 1].proof);
      const tx = await maciRLA.submitPmProofForChallenge(rlaPollId, batchIdx, proof);
      await tx.wait();
      console.log(`    PM batch ${batchIdx} submitted`);
    }

    for (let batchIdx = 1; batchIdx <= tvBatchCount; batchIdx++) {
      const verified = await maciRLA.tvBatchVerified(rlaPollId, batchIdx);
      if (verified) continue;
      const proof = proofToUint256Array(tvProofFiles[batchIdx - 1].proof);
      const tx = await maciRLA.submitTvProofForChallenge(rlaPollId, batchIdx, proof);
      await tx.wait();
      console.log(`    TV batch ${batchIdx} submitted`);
    }

    // finalizeChallengeResponse
    const coordBalanceBefore = await ethers.provider.getBalance(await deployer.getAddress());
    const respondTx = await maciRLA.finalizeChallengeResponse(rlaPollId);
    const respondReceipt = await respondTx.wait();
    const respondGas = respondReceipt!.gasUsed * respondReceipt!.gasPrice;
    const coordBalanceAfter = await ethers.provider.getBalance(await deployer.getAddress());

    audit = await maciRLA.pollAudits(rlaPollId);
    expect(audit.phase).to.equal(6n, "Should be Finalized (6)");

    // Coordinator gets stake + challengeBond
    const expectedPayout = coordBalanceBefore + COORDINATOR_STAKE + challengeBond - respondGas;
    expect(coordBalanceAfter).to.equal(expectedPayout, "Coordinator should get stake + challenge bond");

    // Challenger lost their bond
    const challengerBalanceAfter = await ethers.provider.getBalance(challenger.address);
    const challengerLoss = challengerBalanceBefore - challengerBalanceAfter;
    // Challenger paid: challengeBond + gas
    expect(challengerLoss).to.be.gte(challengeBond, "Challenger should have lost at least the bond amount");

    console.log("  [s2] PASS — Coordinator proved all batches. Challenger lost bond.");
  });

  // ────────────────────────────────────────────────────────────────────
  // Scenario 3: Challenge + Coordinator Timeout (Result Rejected)
  // ────────────────────────────────────────────────────────────────────
  it("Scenario 3: Challenge + Timeout — coordinator fails to respond → Rejected", async function () {
    this.timeout(600_000);
    tryGC();
    console.log("\n  === Scenario 3: Challenge + Coordinator Timeout ===");

    const ctx = await deployAndVote("s3-challenge-timeout", 7, 3);
    const { maciRLA, deployer, signers } = ctx;

    // Commit → Reveal → Submit → finalizeSampling
    const { rlaPollId } = await commitRevealAndSubmit(ctx);

    let audit = await maciRLA.pollAudits(rlaPollId);
    expect(audit.phase).to.equal(4n, "Should be Tentative (4)");

    // Challenge
    const challenger = signers[1];
    const challengeBond = await maciRLA.getChallengeBondAmount(rlaPollId);
    const challengerBalanceBefore = await ethers.provider.getBalance(challenger.address);

    console.log("  [s3] Challenger submitting challenge...");
    const challengeTx = await maciRLA.connect(challenger).challenge(rlaPollId, { value: challengeBond });
    const challengeReceipt = await challengeTx.wait();
    const challengeGas = challengeReceipt!.gasUsed * challengeReceipt!.gasPrice;

    audit = await maciRLA.pollAudits(rlaPollId);
    expect(audit.phase).to.equal(5n, "Should be Challenged (5)");

    // Time travel past CHALLENGE_RESPONSE_DEADLINE (3 days)
    console.log("  [s3] Time traveling 3 days (response deadline)...");
    await timeTravel(3 * 24 * 3600 + 1);

    // Claim timeout
    console.log("  [s3] Claiming challenge timeout...");
    const claimTx = await maciRLA.connect(challenger).claimChallengeTimeout(rlaPollId);
    const claimReceipt = await claimTx.wait();
    const claimGas = claimReceipt!.gasUsed * claimReceipt!.gasPrice;

    audit = await maciRLA.pollAudits(rlaPollId);
    expect(audit.phase).to.equal(7n, "Should be Rejected (7)");

    // Challenger gets: bond back + coordinator stake
    const challengerBalanceAfter = await ethers.provider.getBalance(challenger.address);
    const challengerNet = challengerBalanceAfter - challengerBalanceBefore;
    // Net should be positive: +COORDINATOR_STAKE - gas fees
    const expectedNet = COORDINATOR_STAKE - challengeGas - claimGas;
    expect(challengerNet).to.equal(expectedNet, "Challenger should profit by coordinator stake minus gas");

    console.log("  [s3] PASS — Result rejected. Coordinator stake slashed. Challenger rewarded.");
  });

  // ────────────────────────────────────────────────────────────────────
  // Scenario 4: Invalid Proof During Challenge (Immediate Rejection)
  // ────────────────────────────────────────────────────────────────────
  it("Scenario 4: Invalid proof during challenge — immediate rejection", async function () {
    this.timeout(600_000);
    tryGC();
    console.log("\n  === Scenario 4: Invalid Proof During Challenge ===");

    const ctx = await deployAndVote("s4-invalid-proof", 7, 3);
    const { maciRLA, deployer, signers, pmProofFiles, tvProofFiles } = ctx;

    // Commit → Reveal → Submit → finalizeSampling
    const { rlaPollId } = await commitRevealAndSubmit(ctx);

    let audit = await maciRLA.pollAudits(rlaPollId);
    expect(audit.phase).to.equal(4n, "Should be Tentative (4)");

    // Challenge
    const challenger = signers[1];
    const challengeBond = await maciRLA.getChallengeBondAmount(rlaPollId);
    const challengerBalanceBefore = await ethers.provider.getBalance(challenger.address);

    console.log("  [s4] Challenger submitting challenge...");
    const challengeTx = await maciRLA.connect(challenger).challenge(rlaPollId, { value: challengeBond });
    const challengeReceipt = await challengeTx.wait();
    const challengeGas = challengeReceipt!.gasUsed * challengeReceipt!.gasPrice;

    audit = await maciRLA.pollAudits(rlaPollId);
    expect(audit.phase).to.equal(5n, "Should be Challenged (5)");

    // Find an unverified PM batch
    const pmBatchCount = Number(audit.pmBatchCount);
    let targetBatch = 0;
    for (let i = 1; i <= pmBatchCount; i++) {
      const verified = await maciRLA.pmBatchVerified(rlaPollId, i);
      if (!verified) {
        targetBatch = i;
        break;
      }
    }
    expect(targetBatch).to.be.gt(0, "Should have at least one unverified PM batch");

    // Submit a FAKE proof (all zeros)
    console.log(`  [s4] Submitting fake proof for PM batch ${targetBatch}...`);
    const fakeProof = ["0", "0", "0", "0", "0", "0", "0", "0"];
    const fakeTx = await maciRLA.submitPmProofForChallenge(rlaPollId, targetBatch, fakeProof);
    await fakeTx.wait();

    // The fake proof should trigger _rejectAndSlash
    audit = await maciRLA.pollAudits(rlaPollId);
    expect(audit.phase).to.equal(7n, "Should be Rejected (7) due to invalid proof");

    // Challenger gets payout (bond + stake)
    const challengerBalanceAfter = await ethers.provider.getBalance(challenger.address);
    const challengerNet = challengerBalanceAfter - challengerBalanceBefore;
    // Net = COORDINATOR_STAKE - challengeGas (bond is returned, stake is gained)
    const expectedMinNet = COORDINATOR_STAKE - challengeGas - ethers.parseEther("0.01"); // small margin for gas
    expect(challengerNet).to.be.gte(expectedMinNet, "Challenger should profit");

    console.log("  [s4] PASS — Invalid proof detected. Coordinator slashed. Challenger rewarded.");
  });
});
