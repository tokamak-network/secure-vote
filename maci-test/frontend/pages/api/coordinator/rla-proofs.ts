import type { NextApiRequest, NextApiResponse } from 'next';
import { publicClient, walletClient, MACI_RLA_ABI, getAddresses } from '@/lib/server';
import * as path from 'path';
import * as fs from 'fs';

const PROOFS_DIR = path.resolve(process.cwd(), '../proofs-web');

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

/** Load proof files by prefix. */
function loadProofFiles(dir: string, prefix: string): any[] {
  const proofs: any[] = [];
  let idx = 0;
  while (fs.existsSync(path.join(dir, `${prefix}_${idx}.json`))) {
    proofs.push(JSON.parse(fs.readFileSync(path.join(dir, `${prefix}_${idx}.json`), 'utf8')));
    idx++;
  }
  return proofs;
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

    const { maciRla } = getAddresses();
    if (!maciRla) {
      return res.status(500).json({ success: false, error: 'MaciRLA address not configured' });
    }

    if (!fs.existsSync(path.join(PROOFS_DIR, 'process_0.json'))) {
      return res.status(400).json({ success: false, error: 'Proof files not found' });
    }

    const [pmSamples, tvSamples] = await publicClient.readContract({
      address: maciRla,
      abi: MACI_RLA_ABI,
      functionName: 'getSampleCounts',
      args: [BigInt(pollId)],
    } as any) as [bigint, bigint];

    const [pmIndices, tvIndices] = await publicClient.readContract({
      address: maciRla,
      abi: MACI_RLA_ABI,
      functionName: 'getSelectedBatches',
      args: [BigInt(pollId)],
    } as any) as [bigint[], bigint[]];

    const pmProofFiles = loadProofFiles(PROOFS_DIR, 'process');
    const tvProofFiles = loadProofFiles(PROOFS_DIR, 'tally');

    const results: string[] = [];

    // Submit PM proofs
    for (let i = 0; i < Number(pmSamples); i++) {
      const batchIndex = Number(pmIndices[i]); // 1-based
      const fileIndex = batchIndex - 1;
      const proof = proofToUint256Array(pmProofFiles[fileIndex].proof);

      const hash = await walletClient.writeContract({
        address: maciRla,
        abi: MACI_RLA_ABI,
        functionName: 'submitPmProof',
        args: [BigInt(pollId), BigInt(i), proof],
      } as any);
      await publicClient.waitForTransactionReceipt({ hash });
      results.push(`PM batch ${batchIndex} verified`);
    }

    // Submit TV proofs
    for (let i = 0; i < Number(tvSamples); i++) {
      const batchIndex = Number(tvIndices[i]); // 1-based
      const fileIndex = batchIndex - 1;
      const proof = proofToUint256Array(tvProofFiles[fileIndex].proof);

      const hash = await walletClient.writeContract({
        address: maciRla,
        abi: MACI_RLA_ABI,
        functionName: 'submitTvProof',
        args: [BigInt(pollId), BigInt(i), proof],
      } as any);
      await publicClient.waitForTransactionReceipt({ hash });
      results.push(`TV batch ${batchIndex} verified`);
    }

    res.status(200).json({
      success: true,
      submitted: results,
      pmProofsSubmitted: Number(pmSamples),
      tvProofsSubmitted: Number(tvSamples),
    });
  } catch (err: any) {
    console.error('rla-proofs error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}
