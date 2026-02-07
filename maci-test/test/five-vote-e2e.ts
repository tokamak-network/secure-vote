/**
 * MACI 5-Vote End-to-End Test
 *
 * Deploys official MACI contracts, registers 5 voters, casts 5 votes
 * (3 Yes / 2 No), generates ZK proofs, verifies on-chain, and checks tally.
 *
 * Circuit parameters: 10-2-1-2 (stateTreeDepth=10, msgTreeDepth=2,
 * msgTreeSubDepth=1, voteOptionTreeDepth=2)
 * Message batch size = 5^1 = 5
 */
import { expect } from "chai";
import hre from "hardhat";
const { ethers } = hre;
import { type Signer } from "ethers";
import * as path from "path";
import * as fs from "fs";

// MACI contracts deployment helpers
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

// MACI domain objects
import { Keypair, PCommand, VerifyingKey } from "maci-domainobjs";
import { genRandomSalt } from "maci-crypto";

// ── Constants ──────────────────────────────────────────────────────────
const STATE_TREE_DEPTH = 10;
const INT_STATE_TREE_DEPTH = 1;
const MSG_TREE_DEPTH = 2;
const MSG_TREE_SUB_DEPTH = 1;
const VOTE_OPTION_TREE_DEPTH = 2;
const MSG_BATCH_SIZE = 5; // 5^msgTreeSubDepth = 5^1

const INITIAL_VOICE_CREDITS = 100;
const POLL_DURATION = 60; // seconds

// Vote options: 0 = No, 1 = Yes
const VOTE_OPTION_NO = 0n;
const VOTE_OPTION_YES = 1n;

// Zkey paths (relative to project root)
const ZKEYS_DIR = path.resolve(__dirname, "../zkeys");
const PROCESS_ZKEY = path.join(
  ZKEYS_DIR,
  "ProcessMessages_10-2-1-2_test",
  "ProcessMessages_10-2-1-2_test.0.zkey"
);
const PROCESS_WASM = path.join(
  ZKEYS_DIR,
  "ProcessMessages_10-2-1-2_test",
  "ProcessMessages_10-2-1-2_test_js",
  "ProcessMessages_10-2-1-2_test.wasm"
);
const TALLY_ZKEY = path.join(
  ZKEYS_DIR,
  "TallyVotes_10-1-2_test",
  "TallyVotes_10-1-2_test.0.zkey"
);
const TALLY_WASM = path.join(
  ZKEYS_DIR,
  "TallyVotes_10-1-2_test",
  "TallyVotes_10-1-2_test_js",
  "TallyVotes_10-1-2_test.wasm"
);

const PROCESS_VK_JSON = path.join(
  ZKEYS_DIR,
  "ProcessMessages_10-2-1-2_test",
  "groth16_vkey.json"
);
const TALLY_VK_JSON = path.join(
  ZKEYS_DIR,
  "TallyVotes_10-1-2_test",
  "groth16_vkey.json"
);

const OUTPUT_DIR = path.resolve(__dirname, "../proofs");
const TALLY_FILE = path.join(OUTPUT_DIR, "tally.json");

// ── Helpers ────────────────────────────────────────────────────────────

/** Load a verifying key from a groth16_vkey.json file */
function loadVk(vkPath: string): VerifyingKey {
  const raw = JSON.parse(fs.readFileSync(vkPath, "utf8"));
  return VerifyingKey.fromObj(raw);
}

/** Time-travel helper: advance Hardhat time */
async function timeTravel(seconds: number) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);
}

// ── Test suite ─────────────────────────────────────────────────────────
describe("MACI 5-Vote E2E", function () {
  // Participants
  let deployer: Signer;
  let coordinatorKeypair: Keypair;
  let voterKeypairs: Keypair[];

  // Contracts
  let maciContract: MACI;
  let vkRegistryContract: VkRegistry;
  let verifierContract: Verifier;
  let pollContract: PollContract;
  let mpContract: MessageProcessor;
  let tallyContract: Tally;
  let messageAqContract: AccQueue;

  // State
  let pollId: bigint;
  let stateIndices: bigint[];

  // Metrics
  const gasUsed: Record<string, bigint> = {};
  const timings: Record<string, number> = {};

  before(async function () {
    // Check zkeys exist
    if (!fs.existsSync(PROCESS_ZKEY)) {
      this.skip();
      console.log("Zkeys not found. Run: pnpm download-zkeys");
      return;
    }

    // Clean output dir
    if (fs.existsSync(OUTPUT_DIR)) {
      fs.rmSync(OUTPUT_DIR, { recursive: true });
    }
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    deployer = await getDefaultSigner();
    coordinatorKeypair = new Keypair();
    voterKeypairs = Array.from({ length: 5 }, () => new Keypair());
    stateIndices = [];
  });

  // ── Step 1: Deploy MACI contracts ──────────────────────────────────
  it("should deploy MACI contracts", async function () {
    const start = Date.now();

    // Deploy supporting contracts
    const gatekeeperContract = await deployFreeForAllSignUpGatekeeper(
      deployer,
      true
    );
    const voiceCreditProxyContract =
      await deployConstantInitialVoiceCreditProxy(
        INITIAL_VOICE_CREDITS,
        deployer,
        true
      );
    verifierContract = await deployVerifier(deployer, true);
    vkRegistryContract = await deployVkRegistry(deployer, true);

    // Deploy MACI core
    const gatekeeperAddress = await gatekeeperContract.getAddress();
    const voiceCreditProxyAddress =
      await voiceCreditProxyContract.getAddress();

    const r = await deployMaci({
      signUpTokenGatekeeperContractAddress: gatekeeperAddress,
      initialVoiceCreditBalanceAddress: voiceCreditProxyAddress,
      signer: deployer,
      stateTreeDepth: STATE_TREE_DEPTH,
      quiet: true,
    });
    maciContract = r.maciContract;

    // Register verifying keys
    const processVk = loadVk(PROCESS_VK_JSON);
    const tallyVk = loadVk(TALLY_VK_JSON);

    const tx = await vkRegistryContract.setVerifyingKeys(
      STATE_TREE_DEPTH,
      INT_STATE_TREE_DEPTH,
      MSG_TREE_DEPTH,
      VOTE_OPTION_TREE_DEPTH,
      MSG_BATCH_SIZE,
      EMode.QV,
      processVk.asContractParam(),
      tallyVk.asContractParam()
    );
    await tx.wait();

    timings["deploy"] = Date.now() - start;
    console.log(`    Deploy time: ${timings["deploy"]}ms`);
  });

  // ── Step 2: Deploy Poll ────────────────────────────────────────────
  it("should deploy a poll", async function () {
    const verifierAddress = await verifierContract.getAddress();
    const vkRegistryAddress = await vkRegistryContract.getAddress();

    const treeDepths = {
      intStateTreeDepth: INT_STATE_TREE_DEPTH,
      messageTreeSubDepth: MSG_TREE_SUB_DEPTH,
      messageTreeDepth: MSG_TREE_DEPTH,
      voteOptionTreeDepth: VOTE_OPTION_TREE_DEPTH,
    };

    const coordPubKey = coordinatorKeypair.pubKey.asContractParam();

    const deployPollTx = await maciContract.deployPoll(
      POLL_DURATION,
      treeDepths,
      coordPubKey,
      verifierAddress,
      vkRegistryAddress,
      EMode.QV
    );
    const receipt = await deployPollTx.wait();
    gasUsed["deployPoll"] = receipt!.gasUsed;

    // Get poll ID from nextPollId
    pollId = (await maciContract.nextPollId()) - 1n;
    expect(pollId).to.equal(0n);

    // Get deployed poll contracts using prebuilt typechain factories
    const pollContracts = await maciContract.getPoll(pollId);
    pollContract = Poll__factory.connect(
      pollContracts.poll,
      deployer
    ) as PollContract;
    mpContract = MessageProcessor__factory.connect(
      pollContracts.messageProcessor,
      deployer
    ) as MessageProcessor;
    tallyContract = Tally__factory.connect(
      pollContracts.tally,
      deployer
    ) as Tally;

    // Get message AccQueue
    const extContracts = await pollContract.extContracts();
    messageAqContract = AccQueueQuinaryMaci__factory.connect(
      extContracts.messageAq,
      deployer
    ) as AccQueue;

    console.log(`    deployPoll gas: ${gasUsed["deployPoll"]}`);
  });

  // ── Step 3: Sign up 5 voters ──────────────────────────────────────
  it("should sign up 5 voters", async function () {
    const start = Date.now();
    let totalGas = 0n;

    for (let i = 0; i < 5; i++) {
      const pubKey = voterKeypairs[i].pubKey.asContractParam();
      const tx = await maciContract.signUp(
        pubKey,
        "0x",
        "0x"
      );
      const receipt = await tx.wait();
      totalGas += receipt!.gasUsed;

      // Extract actual state index from SignUp event
      const iface = maciContract.interface;
      const signUpLog = receipt!.logs.find(
        (log) => {
          try { return iface.parseLog({ topics: [...log.topics], data: log.data })?.name === "SignUp"; }
          catch { return false; }
        }
      );
      const parsed = iface.parseLog({ topics: [...signUpLog!.topics], data: signUpLog!.data });
      const stateIndex = parsed!.args[0]; // first arg = stateIndex
      stateIndices.push(BigInt(stateIndex));
      console.log(`    voter ${i} stateIndex: ${stateIndex}`);
    }

    gasUsed["signUp_total"] = totalGas;
    timings["signUp"] = Date.now() - start;

    const numSignUps = await maciContract.numSignUps();
    expect(numSignUps).to.be.gte(5n);

    console.log(`    signUp total gas: ${totalGas}`);
    console.log(`    signUp time: ${timings["signUp"]}ms`);
  });

  // ── Step 4: Publish 5 votes (3 Yes, 2 No) ─────────────────────────
  it("should publish 5 votes", async function () {
    const start = Date.now();
    let totalGas = 0n;

    // Votes: voter 0=No, 1=No, 2=Yes, 3=Yes, 4=Yes
    const voteChoices = [
      VOTE_OPTION_NO,
      VOTE_OPTION_NO,
      VOTE_OPTION_YES,
      VOTE_OPTION_YES,
      VOTE_OPTION_YES,
    ];
    // QV: voteWeight = sqrt(voiceCredits). Use weight=1 (costs 1 credit)
    const voteWeight = 1n;

    for (let i = 0; i < 5; i++) {
      const voterKeypair = voterKeypairs[i];
      const stateIndex = stateIndices[i];

      // Create vote command
      const command = new PCommand(
        stateIndex,
        voterKeypair.pubKey, // keep same key
        voteChoices[i], // vote option index
        voteWeight, // vote weight (QV: actual credits = weight^2 = 1)
        1n, // nonce
        pollId,
        genRandomSalt()
      );

      // Sign the command
      const signature = command.sign(voterKeypair.privKey);

      // Encrypt: generate ephemeral keypair for ECDH
      const ephemeralKeypair = new Keypair();
      const sharedKey = Keypair.genEcdhSharedKey(
        ephemeralKeypair.privKey,
        coordinatorKeypair.pubKey
      );
      const message = command.encrypt(signature, sharedKey);

      // Publish on-chain
      const tx = await pollContract.publishMessage(
        message.asContractParam(),
        ephemeralKeypair.pubKey.asContractParam()
      );
      const receipt = await tx.wait();
      totalGas += receipt!.gasUsed;
    }

    gasUsed["publish_total"] = totalGas;
    timings["publish"] = Date.now() - start;

    const numMessages = await pollContract.numMessages();
    // numMessages includes the initial padding message
    expect(numMessages).to.equal(6n); // 5 votes + 1 padding

    console.log(`    publish total gas: ${totalGas}`);
    console.log(`    publish time: ${timings["publish"]}ms`);
  });

  // ── Step 5: End poll and merge trees ──────────────────────────────
  it("should merge trees after poll ends", async function () {
    const start = Date.now();

    // Time-travel past poll duration
    await timeTravel(POLL_DURATION + 10);

    // Merge using TreeMerger helper
    const merger = new TreeMerger({
      deployer: deployer as any, // HardhatEthersSigner
      pollContract: pollContract as any,
      messageAccQueueContract: messageAqContract as any,
    });

    await merger.checkPollDuration();
    await merger.mergeSignups();
    await merger.mergeMessageSubtrees(0); // 0 = merge all
    await merger.mergeMessages();

    const merged = await pollContract.stateMerged();
    expect(merged).to.be.true;

    timings["merge"] = Date.now() - start;
    console.log(`    merge time: ${timings["merge"]}ms`);
  });

  // ── Step 6: Generate proofs ───────────────────────────────────────
  it("should generate proofs", async function () {
    this.timeout(600_000); // 10 min for proof generation

    const start = Date.now();
    const maciAddress = await maciContract.getAddress();
    const tallyAddress = await tallyContract.getAddress();

    // Reconstruct MACI state from on-chain events
    const maciState = await genMaciStateFromContract(
      ethers.provider,
      maciAddress,
      coordinatorKeypair,
      pollId,
      0 // fromBlock
    );

    const poll = maciState.polls.get(pollId)!;
    poll.updatePoll(await maciContract.numSignUps());

    // Create proof generator
    const proofGenerator = new ProofGenerator({
      poll,
      maciContractAddress: maciAddress,
      tallyContractAddress: tallyAddress,
      outputDir: OUTPUT_DIR,
      tallyOutputFile: TALLY_FILE,
      useQuadraticVoting: true,
      mp: {
        zkey: PROCESS_ZKEY,
        wasm: PROCESS_WASM,
      },
      tally: {
        zkey: TALLY_ZKEY,
        wasm: TALLY_WASM,
      },
    });

    // Generate message processing proofs
    const processStart = Date.now();
    const mpProofs = await proofGenerator.generateMpProofs();
    timings["processProofs"] = Date.now() - processStart;
    console.log(
      `    ProcessMessages proofs: ${mpProofs.length}, time: ${timings["processProofs"]}ms`
    );

    // Generate tally proofs
    const tallyStart = Date.now();
    const { proofs: tallyProofs, tallyData } =
      await proofGenerator.generateTallyProofs(
        hre.network as any
      );
    timings["tallyProofs"] = Date.now() - tallyStart;
    console.log(
      `    TallyVotes proofs: ${tallyProofs.length}, time: ${timings["tallyProofs"]}ms`
    );

    timings["totalProofGen"] = Date.now() - start;
    console.log(
      `    Total proof generation: ${timings["totalProofGen"]}ms`
    );

    // Verify tally data exists
    expect(tallyData).to.exist;
    expect(tallyData.results.tally.length).to.be.greaterThan(0);

    // Store for next step
    (this as any).mpProofs = mpProofs;
    (this as any).tallyProofs = tallyProofs;
    (this as any).tallyData = tallyData;
  });

  // ── Step 7: On-chain verification ─────────────────────────────────
  it("should verify proofs on-chain", async function () {
    const start = Date.now();

    // Read proofs from files (ProofGenerator writes them to OUTPUT_DIR)
    const mpProofsFile = path.join(OUTPUT_DIR, "process_0.json");
    const mpProofs = [];
    let i = 0;
    while (fs.existsSync(path.join(OUTPUT_DIR, `process_${i}.json`))) {
      mpProofs.push(
        JSON.parse(
          fs.readFileSync(
            path.join(OUTPUT_DIR, `process_${i}.json`),
            "utf8"
          )
        )
      );
      i++;
    }

    const tallyProofs = [];
    i = 0;
    while (fs.existsSync(path.join(OUTPUT_DIR, `tally_${i}.json`))) {
      tallyProofs.push(
        JSON.parse(
          fs.readFileSync(
            path.join(OUTPUT_DIR, `tally_${i}.json`),
            "utf8"
          )
        )
      );
      i++;
    }

    const tallyData = JSON.parse(fs.readFileSync(TALLY_FILE, "utf8"));

    // Create prover
    const prover = new Prover({
      pollContract: pollContract as any,
      mpContract: mpContract as any,
      messageAqContract: messageAqContract as any,
      maciContract: maciContract as any,
      vkRegistryContract: vkRegistryContract as any,
      verifierContract: verifierContract as any,
      tallyContract: tallyContract as any,
    });

    // Submit message processing proofs
    const mpStart = Date.now();
    await prover.proveMessageProcessing(mpProofs);
    timings["mpOnChain"] = Date.now() - mpStart;

    // Submit tally proofs
    const tallyStart = Date.now();
    await prover.proveTally(tallyProofs);
    timings["tallyOnChain"] = Date.now() - tallyStart;

    // Submit results (commits tally to contract)
    await prover.submitResults(tallyData);

    timings["onChainVerify"] = Date.now() - start;
    console.log(
      `    On-chain verification time: ${timings["onChainVerify"]}ms`
    );
  });

  // ── Step 8: Verify tally results ──────────────────────────────────
  it("should have correct tally: 2 No, 3 Yes", async function () {
    const tallyData = JSON.parse(fs.readFileSync(TALLY_FILE, "utf8"));

    // In QV: tally[i] = sum of voteWeight for option i
    // We voted weight=1 for each, so:
    // tally[0] = 2 (No votes)
    // tally[1] = 3 (Yes votes)
    const noVotes = BigInt(tallyData.results.tally[0]);
    const yesVotes = BigInt(tallyData.results.tally[1]);

    console.log(`\n    ┌─────────────────────────────┐`);
    console.log(`    │  Final Tally Results        │`);
    console.log(`    ├─────────────────────────────┤`);
    console.log(`    │  No  (option 0): ${noVotes}          │`);
    console.log(`    │  Yes (option 1): ${yesVotes}          │`);
    console.log(`    └─────────────────────────────┘`);

    expect(noVotes).to.equal(2n);
    expect(yesVotes).to.equal(3n);

    // Print all metrics
    console.log(`\n    ═══ Performance Metrics ═══`);
    for (const [key, value] of Object.entries(timings)) {
      console.log(`    ${key}: ${value}ms`);
    }
    console.log(`\n    ═══ Gas Usage ═══`);
    for (const [key, value] of Object.entries(gasUsed)) {
      console.log(`    ${key}: ${value}`);
    }
  });
});
