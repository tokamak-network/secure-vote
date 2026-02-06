import type { NextApiRequest, NextApiResponse } from 'next';
import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { MACI_VOTING_ABI } from '@/lib/contracts';

// Anvil account 0 (coordinator)
const DEPLOYER_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { proposalId } = req.body;

    if (proposalId === undefined) {
      return res.status(400).json({ error: 'proposalId required' });
    }

    const contractAddress = process.env.NEXT_PUBLIC_MACI_CONTRACT_ADDRESS as `0x${string}`;
    if (!contractAddress) {
      throw new Error('MACI contract not deployed');
    }

    const account = privateKeyToAccount(DEPLOYER_KEY);

    const publicClient = createPublicClient({
      chain: foundry,
      transport: http('http://127.0.0.1:8545'),
    });

    const walletClient = createWalletClient({
      account,
      chain: foundry,
      transport: http('http://127.0.0.1:8545'),
    });

    // Finalize tally
    const hash = await walletClient.writeContract({
      address: contractAddress,
      abi: MACI_VOTING_ABI,
      functionName: 'finalizeTally',
      args: [BigInt(proposalId)],
    });

    await publicClient.waitForTransactionReceipt({ hash });

    res.status(200).json({
      success: true,
      message: 'Tally finalized!',
      proposalId,
    });
  } catch (error) {
    console.error('Finalize error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Finalize failed',
    });
  }
}
