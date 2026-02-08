import type { NextApiRequest, NextApiResponse } from 'next';
import { publicClient, walletClient } from '@/lib/server';
import { parseEther } from 'viem';

/**
 * POST /api/faucet
 * Sends test ETH from Anvil account #0 to the given address.
 * Only for local dev — allows users to pay gas for direct MetaMask submissions.
 *
 * Body: { address: "0x..." }
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { address } = req.body;
    if (!address) {
      return res.status(400).json({ success: false, error: 'Missing address' });
    }

    // Check current balance
    const balance = await publicClient.getBalance({ address: address as `0x${string}` });

    // Only fund if balance is below 0.5 ETH
    if (balance < parseEther('0.5')) {
      const hash = await walletClient.sendTransaction({
        to: address as `0x${string}`,
        value: parseEther('1'),
      } as any);
      await publicClient.waitForTransactionReceipt({ hash });

      return res.status(200).json({ success: true, txHash: hash, funded: true });
    }

    res.status(200).json({ success: true, funded: false, message: 'Balance sufficient' });
  } catch (err: any) {
    console.error('faucet error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}
