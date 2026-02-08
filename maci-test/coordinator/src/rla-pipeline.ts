/**
 * RLA (Risk-Limiting Audit) pipeline for MaciRLA contract interaction.
 *
 * Encapsulates the commit → reveal → submit proofs → finalize flow
 * extracted from rla-e2e.ts patterns. Uses blockhash commit-reveal randomness.
 */
import { proofToUint256Array, loadProofFiles } from "./utils";
import type { ProofResult } from "./proof-pipeline";

export interface RlaResult {
  /** MaciRLA poll ID */
  rlaPollId: bigint;
  /** Number of PM batches sampled */
  pmSampleCount: number;
  /** Number of TV batches sampled */
  tvSampleCount: number;
  /** Selected PM batch indices */
  pmSelectedIndices: bigint[];
  /** Selected TV batch indices */
  tvSelectedIndices: bigint[];
  /** Whether finalization was successful */
  finalized: boolean;
}

/**
 * Run the full MaciRLA pipeline:
 * 1. commitResult() — stake + commit intermediate state commitments
 * 2. Mine block for blockhash availability
 * 3. revealSample() — derive random batch indices from blockhash
 * 4. Submit PM + TV proofs for sampled batches
 * 5. finalizeSampling() — start challenge period
 *
 * Note: Does NOT handle challenge period time travel or final finalize().
 * The caller is responsible for waiting 7 days and calling finalize().
 *
 * @param maciRlaContract MaciRLA contract instance
 * @param proofResult Result from runProofPipeline()
 * @param pollAddress Address of the MACI Poll contract
 * @param stake Coordinator stake amount in wei
 * @param provider Ethers provider (for mining blocks)
 */
export async function runRlaPipeline(
  maciRlaContract: any,
  proofResult: ProofResult,
  pollAddress: string,
  stake: bigint,
  provider: any,
): Promise<RlaResult> {
  const { pmCommitments, tvCommitments, yesVotes, noVotes, outputDir } = proofResult;

  // 1. Commit result
  const commitTx = await maciRlaContract.commitResult(
    pollAddress,
    pmCommitments,
    tvCommitments,
    yesVotes,
    noVotes,
    { value: stake }
  );
  const commitReceipt = await commitTx.wait();

  // Extract rlaPollId from event
  const commitEvent = commitReceipt.logs.find((log: any) => {
    try {
      return maciRlaContract.interface.parseLog({
        topics: [...log.topics],
        data: log.data,
      })?.name === "ResultCommitted";
    } catch {
      return false;
    }
  });
  const parsed = maciRlaContract.interface.parseLog({
    topics: [...commitEvent!.topics],
    data: commitEvent!.data,
  });
  const rlaPollId = BigInt(parsed!.args[0]);

  // 2. Mine block for blockhash availability
  await provider.send("evm_mine", []);

  // 3. Reveal sample
  const revealTx = await maciRlaContract.revealSample(rlaPollId);
  await revealTx.wait();

  // 4. Get sample info
  const [pmSampleCount, tvSampleCount] = await maciRlaContract.getSampleCounts(rlaPollId);
  const [pmSelectedIndices, tvSelectedIndices] = await maciRlaContract.getSelectedBatches(rlaPollId);

  // 5. Submit PM proofs for sampled batches
  const pmProofFiles = loadProofFiles(outputDir, "process");
  for (let i = 0; i < Number(pmSampleCount); i++) {
    const batchIndex = Number(pmSelectedIndices[i]);
    const fileIndex = batchIndex - 1;
    const proof = proofToUint256Array(pmProofFiles[fileIndex].proof);
    const tx = await maciRlaContract.submitPmProof(rlaPollId, i, proof);
    await tx.wait();
  }

  // 6. Submit TV proofs for sampled batches
  const tvProofFiles = loadProofFiles(outputDir, "tally");
  for (let i = 0; i < Number(tvSampleCount); i++) {
    const batchIndex = Number(tvSelectedIndices[i]);
    const fileIndex = batchIndex - 1;
    const proof = proofToUint256Array(tvProofFiles[fileIndex].proof);
    const tx = await maciRlaContract.submitTvProof(rlaPollId, i, proof);
    await tx.wait();
  }

  // 7. Finalize sampling (starts challenge period)
  const finalizeSamplingTx = await maciRlaContract.finalizeSampling(rlaPollId);
  await finalizeSamplingTx.wait();

  return {
    rlaPollId,
    pmSampleCount: Number(pmSampleCount),
    tvSampleCount: Number(tvSampleCount),
    pmSelectedIndices: Array.from(pmSelectedIndices).map((i: any) => BigInt(i)),
    tvSelectedIndices: Array.from(tvSelectedIndices).map((i: any) => BigInt(i)),
    finalized: false, // caller must handle finalize after challenge period
  };
}
