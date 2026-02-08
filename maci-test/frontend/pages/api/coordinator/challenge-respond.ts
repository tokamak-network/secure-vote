import type { NextApiRequest, NextApiResponse } from 'next';
import { exec } from 'child_process';
import { publicClient, walletClient, MACI_RLA_ABI, getAddresses } from '@/lib/server';
import * as path from 'path';
import * as fs from 'fs';

const PROOFS_DIR = path.resolve(process.cwd(), '../proofs-web');
const STATUS_FILE = path.join(PROOFS_DIR, 'status.json');
const PROVE_BATCHES_FILE = path.join(PROOFS_DIR, 'prove-batches.json');
const PROJECT_ROOT = path.resolve(process.cwd(), '..');

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

/**
 * POST /api/coordinator/challenge-respond
 * When challenged, generates proofs for ALL remaining unverified batches,
 * submits them via submitPmProofForChallenge / submitTvProofForChallenge,
 * then calls finalizeChallengeResponse.
 *
 * Body: { pollId } - the MaciRLA poll ID
 *
 * This is a two-step process:
 * 1. Generate proofs for unverified batches (spawns coordinator-prove-batch.ts)
 * 2. Submit proofs on-chain (done after proof generation completes)
 *
 * For now, step 2 runs synchronously after checking prove-complete status.
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

    // Read audit data to find unverified batches
    const audit = await publicClient.readContract({
      address: maciRla,
      abi: MACI_RLA_ABI,
      functionName: 'pollAudits',
      args: [BigInt(pollId)],
    } as any) as any;

    const phase = Number(audit[22]);
    if (phase !== 5) { // Phase.Challenged
      return res.status(400).json({ success: false, error: `Not in Challenged phase (current: ${phase})` });
    }

    const pmBatchCount = Number(audit[5]);
    const tvBatchCount = Number(audit[6]);

    // Find unverified PM batches
    const unverifiedPm: number[] = [];
    for (let i = 1; i <= pmBatchCount; i++) {
      const verified = await publicClient.readContract({
        address: maciRla,
        abi: MACI_RLA_ABI,
        functionName: 'pmBatchVerified',
        args: [BigInt(pollId), BigInt(i)],
      } as any) as boolean;
      if (!verified) unverifiedPm.push(i - 1); // 0-based file index
    }

    // Find unverified TV batches
    const unverifiedTv: number[] = [];
    for (let i = 1; i <= tvBatchCount; i++) {
      const verified = await publicClient.readContract({
        address: maciRla,
        abi: MACI_RLA_ABI,
        functionName: 'tvBatchVerified',
        args: [BigInt(pollId), BigInt(i)],
      } as any) as boolean;
      if (!verified) unverifiedTv.push(i - 1); // 0-based file index
    }

    if (unverifiedPm.length === 0 && unverifiedTv.length === 0) {
      // All proofs already generated — just submit finalizeChallengeResponse
      const hash = await walletClient.writeContract({
        address: maciRla,
        abi: MACI_RLA_ABI,
        functionName: 'finalizeChallengeResponse',
        args: [BigInt(pollId)],
      } as any);
      await publicClient.waitForTransactionReceipt({ hash });

      return res.status(200).json({
        success: true,
        message: 'All proofs already verified. Challenge response finalized.',
        txHash: hash,
      });
    }

    // Check if proofs already exist for these batches
    const needProofGen: { pm: number[]; tv: number[] } = { pm: [], tv: [] };
    for (const idx of unverifiedPm) {
      if (!fs.existsSync(path.join(PROOFS_DIR, `process_${idx}.json`))) {
        needProofGen.pm.push(idx);
      }
    }
    for (const idx of unverifiedTv) {
      if (!fs.existsSync(path.join(PROOFS_DIR, `tally_${idx}.json`))) {
        needProofGen.tv.push(idx);
      }
    }

    if (needProofGen.pm.length > 0 || needProofGen.tv.length > 0) {
      // Need to generate proofs first
      fs.writeFileSync(PROVE_BATCHES_FILE, JSON.stringify(needProofGen, null, 2));

      const cmd = `cd "${PROJECT_ROOT}" && npx hardhat run scripts/coordinator-prove-batch.ts --network localhost`;
      exec(cmd, { maxBuffer: 10 * 1024 * 1024, timeout: 600000 }, async (error, stdout, stderr) => {
        if (error) {
          console.error('Challenge response proof gen error:', error.message);
          return;
        }
        console.log('Challenge proofs generated:', stdout);

        // After proof generation, submit all unverified proofs
        try {
          await submitChallengeProofs(maciRla, BigInt(pollId), unverifiedPm, unverifiedTv);
        } catch (err: any) {
          console.error('Failed to submit challenge proofs:', err.message);
        }
      });

      return res.status(200).json({
        success: true,
        proveStatus: 'proving',
        message: `Generating proofs for ${needProofGen.pm.length} PM + ${needProofGen.tv.length} TV unverified batches`,
        unverifiedPm,
        unverifiedTv,
      });
    }

    // Proofs exist — submit them directly
    await submitChallengeProofs(maciRla, BigInt(pollId), unverifiedPm, unverifiedTv);

    return res.status(200).json({
      success: true,
      message: 'Challenge proofs submitted and response finalized.',
    });
  } catch (err: any) {
    console.error('challenge-respond error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}

async function submitChallengeProofs(
  maciRla: `0x${string}`,
  pollId: bigint,
  unverifiedPm: number[],
  unverifiedTv: number[],
) {
  // Submit PM proofs for challenge
  for (const fileIdx of unverifiedPm) {
    const proofFile = path.join(PROOFS_DIR, `process_${fileIdx}.json`);
    if (!fs.existsSync(proofFile)) continue;
    const data = JSON.parse(fs.readFileSync(proofFile, 'utf8'));
    const proof = proofToUint256Array(data.proof);
    const batchIndex = fileIdx + 1; // 1-based

    const hash = await walletClient.writeContract({
      address: maciRla,
      abi: MACI_RLA_ABI,
      functionName: 'submitPmProofForChallenge',
      args: [pollId, BigInt(batchIndex), proof],
    } as any);
    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`Challenge: PM batch ${batchIndex} proof submitted`);
  }

  // Submit TV proofs for challenge
  for (const fileIdx of unverifiedTv) {
    const proofFile = path.join(PROOFS_DIR, `tally_${fileIdx}.json`);
    if (!fs.existsSync(proofFile)) continue;
    const data = JSON.parse(fs.readFileSync(proofFile, 'utf8'));
    const proof = proofToUint256Array(data.proof);
    const batchIndex = fileIdx + 1; // 1-based

    const hash = await walletClient.writeContract({
      address: maciRla,
      abi: MACI_RLA_ABI,
      functionName: 'submitTvProofForChallenge',
      args: [pollId, BigInt(batchIndex), proof],
    } as any);
    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`Challenge: TV batch ${batchIndex} proof submitted`);
  }

  // Finalize challenge response
  const hash = await walletClient.writeContract({
    address: maciRla,
    abi: MACI_RLA_ABI,
    functionName: 'finalizeChallengeResponse',
    args: [pollId],
  } as any);
  await publicClient.waitForTransactionReceipt({ hash });
  console.log('Challenge response finalized');
}
