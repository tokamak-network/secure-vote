import type { NextApiRequest, NextApiResponse } from 'next';
import { publicClient, walletClient, MACI_RLA_ABI, getAddresses, anvilTimeTravel } from '@/lib/server';

/**
 * POST /api/coordinator/rla-finalize
 * Calls finalizeSampling() to move to Tentative phase,
 * then time-travels 7 days (Anvil only) and calls finalize().
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

    const { maci, maciRla } = getAddresses();
    if (!maciRla || !maci) {
      return res.status(500).json({ success: false, error: 'Contract addresses not configured' });
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

    // Read current phase
    const audit = await publicClient.readContract({
      address: maciRla,
      abi: MACI_RLA_ABI,
      functionName: 'pollAudits',
      args: [rlaPollId],
    } as any) as any;
    const currentPhase = Number(audit[22]);

    const txHashes: string[] = [];

    // Step 1: finalizeSampling() if in SampleRevealed phase (2)
    if (currentPhase === 2) {
      const hash = await walletClient.writeContract({
        address: maciRla,
        abi: MACI_RLA_ABI,
        functionName: 'finalizeSampling',
        args: [rlaPollId],
      } as any);
      await publicClient.waitForTransactionReceipt({ hash });
      txHashes.push(hash);
    }

    // Step 2: Time travel 7 days (Anvil only)
    await anvilTimeTravel(7 * 24 * 3600 + 1);

    // Step 3: finalize()
    const hash = await walletClient.writeContract({
      address: maciRla,
      abi: MACI_RLA_ABI,
      functionName: 'finalize',
      args: [rlaPollId],
    } as any);
    await publicClient.waitForTransactionReceipt({ hash });
    txHashes.push(hash);

    // Read final state
    const finalAudit = await publicClient.readContract({
      address: maciRla,
      abi: MACI_RLA_ABI,
      functionName: 'pollAudits',
      args: [rlaPollId],
    } as any) as any;

    res.status(200).json({
      success: true,
      txHashes,
      finalPhase: Number(finalAudit[22]),
      finalized: Number(finalAudit[22]) === 6,
      yesVotes: Number(finalAudit[3]),
      noVotes: Number(finalAudit[4]),
    });
  } catch (err: any) {
    console.error('rla-finalize error:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to finalize',
      details: err.message,
      suggestion: 'Check that all proofs have been submitted and verified',
    });
  }
}
