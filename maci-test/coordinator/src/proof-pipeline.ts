/**
 * Proof generation pipeline for MACI voting.
 *
 * Encapsulates the tree merge → proof generation → commitment extraction flow
 * extracted from benchmark-e2e.ts patterns.
 */
import * as path from "path";
import * as fs from "fs";
import {
  genMaciStateFromContract,
  ProofGenerator,
  TreeMerger,
} from "maci-contracts";
import type { Keypair } from "maci-domainobjs";
import { extractPmCommitments, extractTvCommitments, loadProofFiles } from "./utils";

export interface ZKeyPaths {
  processZkey: string;
  processWasm: string;
  tallyZkey: string;
  tallyWasm: string;
}

export interface ProofResult {
  /** Number of ProcessMessages proofs generated */
  pmProofCount: number;
  /** Number of TallyVotes proofs generated */
  tvProofCount: number;
  /** PM commitment chain: [initial, after_batch_1, ..., final] */
  pmCommitments: bigint[];
  /** TV commitment chain: [0, after_tally_1, ..., final] */
  tvCommitments: bigint[];
  /** Tally data (yes/no votes) */
  yesVotes: bigint;
  noVotes: bigint;
  /** Output directory containing proof files */
  outputDir: string;
}

/**
 * Run the full MACI proof generation pipeline:
 * 1. Merge message and signup trees
 * 2. Generate ProcessMessages and TallyVotes proofs
 * 3. Extract commitment chains from proof files
 *
 * @param config Pipeline configuration
 * @param provider Ethers provider
 * @param deployer Signer for merge transactions
 * @param pollContract MACI Poll contract instance
 * @param messageAqContract AccQueue contract for messages
 * @param maciContract MACI contract instance
 * @param network Hardhat network (for tally proof generation)
 */
export async function runProofPipeline(config: {
  maciAddress: string;
  pollId: bigint;
  coordinatorKey: Keypair;
  zkeyPaths: ZKeyPaths;
  outputDir: string;
}, context: {
  provider: any;
  deployer: any;
  pollContract: any;
  messageAqContract: any;
  maciContract: any;
  network: any;
}): Promise<ProofResult> {
  const { maciAddress, pollId, coordinatorKey, zkeyPaths, outputDir } = config;
  const { provider, deployer, pollContract, messageAqContract, maciContract, network } = context;

  const tallyFile = path.join(outputDir, "tally.json");

  // Clean output dir
  if (fs.existsSync(outputDir)) {
    fs.rmSync(outputDir, { recursive: true });
  }
  fs.mkdirSync(outputDir, { recursive: true });

  // 1. Merge trees
  const merger = new TreeMerger({
    deployer,
    pollContract,
    messageAccQueueContract: messageAqContract,
  });
  await merger.checkPollDuration();
  await merger.mergeSignups();
  await merger.mergeMessageSubtrees(0);
  await merger.mergeMessages();

  // 2. Generate proofs
  const maciState = await genMaciStateFromContract(
    provider,
    maciAddress,
    coordinatorKey,
    pollId,
    0
  );

  const poll = maciState.polls.get(pollId)!;
  poll.updatePoll(await maciContract.numSignUps());

  const proofGenerator = new ProofGenerator({
    poll,
    maciContractAddress: maciAddress,
    tallyContractAddress: maciAddress, // not used directly for proof gen
    outputDir,
    tallyOutputFile: tallyFile,
    useQuadraticVoting: true,
    mp: { zkey: zkeyPaths.processZkey, wasm: zkeyPaths.processWasm },
    tally: { zkey: zkeyPaths.tallyZkey, wasm: zkeyPaths.tallyWasm },
  });

  const mpProofs = await proofGenerator.generateMpProofs();
  const { proofs: tallyProofs } = await proofGenerator.generateTallyProofs(network);

  // 3. Extract commitments
  const pmCommitments = extractPmCommitments(outputDir);
  const tvCommitments = extractTvCommitments(outputDir);

  // 4. Read tally
  const tallyData = JSON.parse(fs.readFileSync(tallyFile, "utf8"));
  const noVotes = BigInt(tallyData.results.tally[0]);
  const yesVotes = BigInt(tallyData.results.tally[1]);

  return {
    pmProofCount: mpProofs.length,
    tvProofCount: tallyProofs.length,
    pmCommitments,
    tvCommitments,
    yesVotes,
    noVotes,
    outputDir,
  };
}
