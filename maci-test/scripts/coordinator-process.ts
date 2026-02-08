/**
 * Coordinator proof generation script.
 * Run via: npx hardhat run scripts/coordinator-process.ts --network localhost
 *
 * 1. Time-travels past poll end (Anvil only)
 * 2. Merges MACI trees (signup + message)
 * 3. Generates ProcessMessages + TallyVotes proofs
 * 4. Writes proof files + tally.json to proofs-web/
 * 5. Writes status.json for API route consumption
 */
import hre from "hardhat";
const { ethers } = hre;
import * as path from "path";
import * as fs from "fs";
import {
  genMaciStateFromContract,
  getDefaultSigner,
  ProofGenerator,
  TreeMerger,
} from "maci-contracts";
import { Poll__factory, AccQueueQuinaryMaci__factory } from "maci-contracts";
import type { Poll as PollContract, AccQueue } from "maci-contracts";
import { Keypair, PrivKey } from "maci-domainobjs";

const OUTPUT_DIR = path.resolve(__dirname, "../proofs-web");
const TALLY_FILE = path.join(OUTPUT_DIR, "tally.json");
const STATUS_FILE = path.join(OUTPUT_DIR, "status.json");
const CONFIG_FILE = path.resolve(__dirname, "../deploy-config.json");

const ZKEYS_DIR = path.resolve(__dirname, "../zkeys");
const PM_DIR = "ProcessMessages_10-2-1-2_test";
const PM_ZKEY = path.join(ZKEYS_DIR, PM_DIR, `${PM_DIR}.0.zkey`);
const PM_WASM = path.join(ZKEYS_DIR, PM_DIR, `${PM_DIR}_js`, `${PM_DIR}.wasm`);
const TV_DIR = "TallyVotes_10-1-2_test";
const TV_ZKEY = path.join(ZKEYS_DIR, TV_DIR, `${TV_DIR}.0.zkey`);
const TV_WASM = path.join(ZKEYS_DIR, TV_DIR, `${TV_DIR}_js`, `${TV_DIR}.wasm`);

function writeStatus(status: string, data: any = {}) {
  fs.writeFileSync(STATUS_FILE, JSON.stringify({ status, ...data, updatedAt: new Date().toISOString() }, null, 2));
}

async function main() {
  // Read deploy config
  if (!fs.existsSync(CONFIG_FILE)) {
    throw new Error(`deploy-config.json not found at ${CONFIG_FILE}`);
  }
  const config = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  const { maciAddress, pollAddress, coordinatorPrivKey, pollId: pollIdStr } = config;
  const pollId = BigInt(pollIdStr);

  // Verify zkeys exist
  if (!fs.existsSync(PM_ZKEY)) throw new Error(`PM zkey not found: ${PM_ZKEY}`);
  if (!fs.existsSync(TV_ZKEY)) throw new Error(`TV zkey not found: ${TV_ZKEY}`);

  // Clean + create output dir
  if (fs.existsSync(OUTPUT_DIR)) {
    fs.rmSync(OUTPUT_DIR, { recursive: true });
  }
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  writeStatus("starting");

  const deployer = await getDefaultSigner();
  const maciContract = await ethers.getContractAt("MACI", maciAddress, deployer);
  const pollContracts = await maciContract.getPoll(pollId);
  const pollContract = Poll__factory.connect(pollContracts.poll, deployer) as PollContract;
  const extContracts = await pollContract.extContracts();
  const messageAqContract = AccQueueQuinaryMaci__factory.connect(
    extContracts.messageAq, deployer
  ) as AccQueue;

  // Reconstruct coordinator keypair
  const coordPrivKey = PrivKey.deserialize(coordinatorPrivKey);
  const coordKeypair = new Keypair(coordPrivKey);

  // Time travel past poll end
  writeStatus("time-traveling");
  console.log("  Time traveling past poll end...");
  const [deployTime, duration] = await pollContract.getDeployTimeAndDuration();
  const endTime = Number(deployTime) + Number(duration);
  const latestBlock = await ethers.provider.getBlock("latest");
  const now = latestBlock!.timestamp;
  if (now < endTime) {
    await ethers.provider.send("evm_increaseTime", [endTime - now + 10]);
    await ethers.provider.send("evm_mine", []);
  }

  // Merge trees
  writeStatus("merging-trees");
  console.log("  Merging trees...");
  const merger = new TreeMerger({
    deployer: deployer as any,
    pollContract: pollContract as any,
    messageAccQueueContract: messageAqContract as any,
  });
  await merger.checkPollDuration();
  await merger.mergeSignups();
  await merger.mergeMessageSubtrees(0);
  await merger.mergeMessages();

  // Generate proofs
  writeStatus("generating-proofs");
  console.log("  Generating proofs (this may take a few minutes)...");
  const maciState = await genMaciStateFromContract(
    ethers.provider,
    maciAddress,
    coordKeypair,
    pollId,
    0
  );

  const poll = maciState.polls.get(pollId)!;
  poll.updatePoll(await maciContract.numSignUps());

  const proofGenerator = new ProofGenerator({
    poll,
    maciContractAddress: maciAddress,
    tallyContractAddress: maciAddress, // not used for proof gen
    outputDir: OUTPUT_DIR,
    tallyOutputFile: TALLY_FILE,
    useQuadraticVoting: true,
    mp: { zkey: PM_ZKEY, wasm: PM_WASM },
    tally: { zkey: TV_ZKEY, wasm: TV_WASM },
  });

  const mpProofs = await proofGenerator.generateMpProofs();
  const { proofs: tallyProofs } = await proofGenerator.generateTallyProofs(
    hre.network as any
  );

  console.log(`  PM proofs: ${mpProofs.length}, TV proofs: ${tallyProofs.length}`);

  // Read tally
  const tallyData = JSON.parse(fs.readFileSync(TALLY_FILE, "utf8"));
  const yesVotes = tallyData.results.tally[1];
  const noVotes = tallyData.results.tally[0];

  writeStatus("complete", {
    pmProofCount: mpProofs.length,
    tvProofCount: tallyProofs.length,
    yesVotes,
    noVotes,
    outputDir: OUTPUT_DIR,
  });

  console.log(`\n  Done! ${mpProofs.length} PM + ${tallyProofs.length} TV proofs generated.`);
  console.log(`  Tally: Yes=${yesVotes}, No=${noVotes}`);
  console.log(`  Output: ${OUTPUT_DIR}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Coordinator process failed:", err);
    try {
      writeStatus("error", { error: err.message });
    } catch {}
    process.exit(1);
  });
