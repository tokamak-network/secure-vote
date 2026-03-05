import type { NextApiRequest, NextApiResponse } from 'next';
import { publicClient, walletClient, MACI_RLA_ABI, getAddresses, anvilMineBlocks } from '@/lib/server';

/**
 * POST /api/coordinator/rla-reveal
 * Mines blocks for blockhash availability, then calls MaciRLA.revealSample().
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

    // Mine blocks so blockhash(commitBlock + BLOCK_HASH_DELAY) is available
    await anvilMineBlocks(2);

    const hash = await walletClient.writeContract({
      address: maciRla,
      abi: MACI_RLA_ABI,
      functionName: 'revealSample',
      args: [rlaPollId],
    } as any);

    await publicClient.waitForTransactionReceipt({ hash });

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

    res.status(200).json({
      success: true,
      txHash: hash,
      pmSamples: Number(pmSamples),
      tvSamples: Number(tvSamples),
      pmIndices: pmIndices.map(Number),
      tvIndices: tvIndices.map(Number),
    });
  } catch (err: any) {
    console.error('rla-reveal error:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to reveal sample',
      details: err.message,
      suggestion: 'Check that the commitment phase has completed and blocks have been mined',
    });
  }
}
