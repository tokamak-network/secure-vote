import type { NextApiRequest, NextApiResponse } from 'next';
import { publicClient, walletClient, MACI_RLA_ABI, getAddresses } from '@/lib/server';
import * as path from 'path';
import * as fs from 'fs';

function getProofsDir(pollId: number | string): string {
  return path.resolve(process.cwd(), `../proofs-web/poll-${pollId}`);
}

/** Convert snarkjs proof to uint256[8] for on-chain verification. */
function proofToUint256Array(proof: any): readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint] {
  return [
    BigInt(proof.pi_a[0]),
    BigInt(proof.pi_a[1]),
    BigInt(proof.pi_b[0][1]),
    BigInt(proof.pi_b[0][0]),
    BigInt(proof.pi_b[1][1]),
    BigInt(proof.pi_b[1][0]),
    BigInt(proof.pi_c[0]),
    BigInt(proof.pi_c[1]),
  ] as const;
}

/** Load proof files by prefix, returns Map keyed by batch index */
function loadProofFiles(dir: string, prefix: string): Map<number, any> {
  const proofMap = new Map<number, any>();

  if (!fs.existsSync(dir)) {
    return proofMap;
  }

  const files = fs.readdirSync(dir)
    .filter(f => f.startsWith(`${prefix}_`) && f.endsWith('.json'))
    .sort();

  for (const file of files) {
    const match = file.match(new RegExp(`^${prefix}_([0-9]+)\\.json$`));
    if (match) {
      const idx = parseInt(match[1], 10);
      try {
        const content = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
        proofMap.set(idx, content);
      } catch (err) {
        console.error(`Failed to read ${file}:`, err);
      }
    }
  }

  return proofMap;
}

/**
 * POST /api/coordinator/rla-proofs
 * Submits Groth16 proofs for sampled batches to MaciRLA.
 *
 * Body: { pollId } - the MaciRLA poll ID
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const cookie = req.headers.cookie || '';
  const authed = /(?:^|;\s*)coordinator_auth=true(?:;|$)/.test(cookie);
  if (!authed) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { pollId } = req.body;
    if (pollId === undefined) {
      return res.status(400).json({ success: false, error: 'pollId required' });
    }

    const proofsDir = getProofsDir(pollId);

    const { maci, maciRla } = getAddresses();
    if (!maciRla || !maci) {
      return res.status(500).json({ success: false, error: 'Contract addresses not configured' });
    }

    if (!fs.existsSync(path.join(proofsDir, 'process_0.json'))) {
      return res.status(400).json({ success: false, error: `Proof files not found in ${proofsDir}. Run "Generate Sampled Proofs" first.` });
    }

    // Get poll address from MACI Poll ID
    const pollResult = await publicClient.readContract({
      address: maci,
      abi: [{ type: 'function', name: 'getPoll', inputs: [{ type: 'uint256' }], outputs: [{ type: 'address', name: 'poll' }, { type: 'address' }, { type: 'address' }], stateMutability: 'view' }],
      functionName: 'getPoll',
      args: [BigInt(pollId)],
    } as any) as any;

    const pollAddress = pollResult[0] || pollResult.poll;

    // Convert MACI Poll address to RLA Poll ID
    const rlaPollId = await publicClient.readContract({
      address: maciRla,
      abi: MACI_RLA_ABI,
      functionName: 'pollToAuditId',
      args: [pollAddress as `0x${string}`],
    } as any) as bigint;

    const [pmSamples, tvSamples] = await publicClient.readContract({
      address: maciRla,
      abi: MACI_RLA_ABI,
      functionName: 'getSampleCounts',
      args: [rlaPollId],
    } as any) as [bigint, bigint];

    const [pmIndices, tvIndices] = await publicClient.readContract({
      address: maciRla,
      abi: MACI_RLA_ABI,
      functionName: 'getSelectedBatches',
      args: [rlaPollId],
    } as any) as [bigint[], bigint[]];

    // Get current verification status
    const audit = await publicClient.readContract({
      address: maciRla,
      abi: MACI_RLA_ABI,
      functionName: 'pollAudits',
      args: [rlaPollId],
    } as any) as any;
    const pmProofsVerified = Number(audit[13]);
    const tvProofsVerified = Number(audit[14]);

    const pmProofFiles = loadProofFiles(proofsDir, 'process');
    const tvProofFiles = loadProofFiles(proofsDir, 'tally');

    const results: string[] = [];
    let pmSubmittedCount = 0;
    let tvSubmittedCount = 0;

    // Submit PM proofs (only those not yet verified)
    for (let i = pmProofsVerified; i < Number(pmSamples); i++) {
      const batchIndex = Number(pmIndices[i]); // 1-based
      const fileIndex = batchIndex - 1;
      const proofData = pmProofFiles.get(fileIndex);

      if (!proofData) {
        throw new Error(
          `PM proof file missing: process_${fileIndex}.json for batch #${batchIndex}. ` +
          `Available: [${Array.from(pmProofFiles.keys()).join(', ')}]`
        );
      }

      const proof = proofToUint256Array(proofData.proof);

      try {
        const hash = await walletClient.writeContract({
          address: maciRla,
          abi: MACI_RLA_ABI,
          functionName: 'submitPmProof',
          args: [rlaPollId, BigInt(i), proof],
        } as any);
        await publicClient.waitForTransactionReceipt({ hash });
        results.push(`PM batch ${batchIndex} verified`);
        pmSubmittedCount++;
      } catch (submitError: any) {
        // Check if it's the InvalidProof error (0x09bde339)
        const errorMsg = submitError.message || String(submitError);

        if (errorMsg.includes('0x09bde339') || errorMsg.includes('InvalidProof')) {
          throw new Error(
            `InvalidProof error for PM batch ${batchIndex}. ` +
            `This means the proof doesn't match the commitments stored in the contract. ` +
            `Possible causes: (1) Commitments were regenerated after RLA commit, ` +
            `(2) Blockchain state changed between commit and proof generation. ` +
            `Solution: Use a fresh poll and don't regenerate commitments after RLA commit.`
          );
        }

        throw new Error(`Failed to submit PM batch ${batchIndex}: ${errorMsg}`);
      }
    }

    // Submit TV proofs (only those not yet verified)
    for (let i = tvProofsVerified; i < Number(tvSamples); i++) {
      const batchIndex = Number(tvIndices[i]); // 1-based
      const fileIndex = batchIndex - 1;
      const proofData = tvProofFiles.get(fileIndex);

      if (!proofData) {
        throw new Error(
          `TV proof file missing: tally_${fileIndex}.json for batch #${batchIndex}. ` +
          `Available: [${Array.from(tvProofFiles.keys()).join(', ')}]`
        );
      }

      const proof = proofToUint256Array(proofData.proof);

      try {
        const hash = await walletClient.writeContract({
          address: maciRla,
          abi: MACI_RLA_ABI,
          functionName: 'submitTvProof',
          args: [rlaPollId, BigInt(i), proof],
        } as any);
        await publicClient.waitForTransactionReceipt({ hash });
        results.push(`TV batch ${batchIndex} verified`);
        tvSubmittedCount++;
      } catch (submitError: any) {
        // Check if it's the InvalidProof error (0x09bde339)
        const errorMsg = submitError.message || String(submitError);

        if (errorMsg.includes('0x09bde339') || errorMsg.includes('InvalidProof')) {
          throw new Error(
            `InvalidProof error for TV batch ${batchIndex}. ` +
            `This means the proof doesn't match the commitments stored in the contract. ` +
            `Possible causes: (1) Commitments were regenerated after RLA commit, ` +
            `(2) Blockchain state changed between commit and proof generation. ` +
            `Solution: Use a fresh poll and don't regenerate commitments after RLA commit.`
          );
        }

        throw new Error(`Failed to submit TV batch ${batchIndex}: ${errorMsg}`);
      }
    }

    res.status(200).json({
      success: true,
      submitted: results,
      pmTotal: Number(pmSamples),
      tvTotal: Number(tvSamples),
      pmSubmittedNow: pmSubmittedCount,
      tvSubmittedNow: tvSubmittedCount,
      pmAlreadyVerified: pmProofsVerified,
      tvAlreadyVerified: tvProofsVerified,
    });
  } catch (err: any) {
    console.error('rla-proofs error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}
