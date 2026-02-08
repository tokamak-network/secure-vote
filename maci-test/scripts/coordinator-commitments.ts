/**
 * Coordinator commitment extraction script.
 * Run via: npx hardhat run scripts/coordinator-commitments.ts --network localhost
 *
 * Extracts circuit inputs and commitments WITHOUT generating Groth16 proofs.
 * This is the first step of the RLA workflow:
 *
 * 1. Time-travels past poll end (Anvil only)
 * 2. Merges MACI trees (signup + message)
 * 3. Runs poll.processMessages() + poll.tallyVotes() for all batches
 * 4. Saves circuit inputs (process_X_inputs.json, tally_X_inputs.json)
 * 5. Saves commitments.json (PM/TV commitment chains + tally)
 * 6. Saves tally.json
 *
 * Proof generation (groth16.fullProve) is deferred to coordinator-prove-batch.ts,
 * which runs only for sampled batches after RLA reveal.
 */
import hre from "hardhat";
const { ethers } = hre;
import * as path from "path";
import * as fs from "fs";
import {
  genMaciStateFromContract,
  getDefaultSigner,
  TreeMerger,
} from "maci-contracts";
import { Poll__factory, AccQueueQuinaryMaci__factory } from "maci-contracts";
import type { Poll as PollContract, AccQueue } from "maci-contracts";
import { Keypair, PrivKey } from "maci-domainobjs";

const OUTPUT_DIR = path.resolve(__dirname, "../proofs-web");
const TALLY_FILE = path.join(OUTPUT_DIR, "tally.json");
const STATUS_FILE = path.join(OUTPUT_DIR, "status.json");
const COMMITMENTS_FILE = path.join(OUTPUT_DIR, "commitments.json");
const CONFIG_FILE = path.resolve(__dirname, "../deploy-config.json");

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

  // Reconstruct MACI state from contract
  writeStatus("computing-inputs");
  console.log("  Computing circuit inputs (no proof generation)...");
  const maciState = await genMaciStateFromContract(
    ethers.provider,
    maciAddress,
    coordKeypair,
    pollId,
    0
  );

  const poll = maciState.polls.get(pollId)!;
  poll.updatePoll(await maciContract.numSignUps());

  // Process all message batches to collect circuit inputs
  // poll.processMessages() is fast — it's just local computation
  const pmInputs: any[] = [];
  while (poll.hasUnprocessedMessages()) {
    const circuitInputs = poll.processMessages(pollId);
    pmInputs.push(circuitInputs);
  }
  console.log(`  Collected ${pmInputs.length} PM circuit inputs`);

  // Tally all vote batches to collect circuit inputs
  const tvInputs: any[] = [];
  while (poll.hasUntalliedBallots()) {
    const circuitInputs = poll.tallyVotes();
    tvInputs.push(circuitInputs);
  }
  console.log(`  Collected ${tvInputs.length} TV circuit inputs`);

  // Save circuit inputs to individual files
  for (let i = 0; i < pmInputs.length; i++) {
    const inputFile = path.join(OUTPUT_DIR, `process_${i}_inputs.json`);
    fs.writeFileSync(inputFile, JSON.stringify(stringifyBigInts(pmInputs[i]), null, 2));
  }
  for (let i = 0; i < tvInputs.length; i++) {
    const inputFile = path.join(OUTPUT_DIR, `tally_${i}_inputs.json`);
    fs.writeFileSync(inputFile, JSON.stringify(stringifyBigInts(tvInputs[i]), null, 2));
  }

  // Extract commitment chains from circuit inputs
  const pmCommitments: string[] = [];
  pmCommitments.push(pmInputs[0].currentSbCommitment.toString());
  for (const input of pmInputs) {
    pmCommitments.push(input.newSbCommitment.toString());
  }

  const tvCommitments: string[] = [];
  tvCommitments.push(tvInputs[0].currentTallyCommitment.toString());
  for (const input of tvInputs) {
    tvCommitments.push(input.newTallyCommitment.toString());
  }

  // Extract tally from the final tally circuit inputs
  const lastTallyInput = tvInputs[tvInputs.length - 1];
  const newResultsRootSalt = lastTallyInput.newResultsRootSalt;
  const newPerVOSpentVoiceCreditsRootSalt = lastTallyInput.newPerVOSpentVoiceCreditsRootSalt;
  const newSpentVoiceCreditSubtotalSalt = lastTallyInput.newSpentVoiceCreditSubtotalSalt;

  // Build tally.json from poll's computed tally
  // MACI SDK stores results in poll.tallyResult (not poll.results)
  const tallyResults = poll.tallyResult.map((r: bigint) => r.toString());
  const yesVotes = tallyResults[1] || "0";
  const noVotes = tallyResults[0] || "0";

  const tallyData = {
    results: {
      tally: tallyResults,
      salt: newResultsRootSalt?.toString() || "0",
    },
    totalSpentVoiceCredits: {
      spent: poll.totalSpentVoiceCredits.toString(),
      salt: newSpentVoiceCreditSubtotalSalt?.toString() || "0",
    },
    perVOSpentVoiceCredits: {
      tally: poll.perVOSpentVoiceCredits.map((v: bigint) => v.toString()),
      salt: newPerVOSpentVoiceCreditsRootSalt?.toString() || "0",
    },
  };
  fs.writeFileSync(TALLY_FILE, JSON.stringify(tallyData, null, 2));

  // Save commitments
  const commitmentsData = {
    pmCommitments,
    tvCommitments,
    pmBatchCount: pmInputs.length,
    tvBatchCount: tvInputs.length,
    yesVotes,
    noVotes,
  };
  fs.writeFileSync(COMMITMENTS_FILE, JSON.stringify(commitmentsData, null, 2));

  writeStatus("commitments-ready", {
    pmBatchCount: pmInputs.length,
    tvBatchCount: tvInputs.length,
    yesVotes,
    noVotes,
    outputDir: OUTPUT_DIR,
  });

  console.log(`\n  Done! ${pmInputs.length} PM + ${tvInputs.length} TV circuit inputs extracted.`);
  console.log(`  Tally: Yes=${yesVotes}, No=${noVotes}`);
  console.log(`  Commitments: ${pmCommitments.length} PM, ${tvCommitments.length} TV`);
  console.log(`  Output: ${OUTPUT_DIR}`);
}

/** Recursively convert bigints to strings for JSON serialization */
function stringifyBigInts(obj: any): any {
  if (typeof obj === "bigint") return obj.toString();
  if (Array.isArray(obj)) return obj.map(stringifyBigInts);
  if (obj !== null && typeof obj === "object") {
    const result: any = {};
    for (const [key, val] of Object.entries(obj)) {
      result[key] = stringifyBigInts(val);
    }
    return result;
  }
  return obj;
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Coordinator commitments extraction failed:", err);
    try {
      writeStatus("error", { error: err.message });
    } catch {}
    process.exit(1);
  });
