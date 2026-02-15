import type { NextApiRequest, NextApiResponse } from 'next';
import { createPublicClient, createWalletClient, http, parseEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { MACI_VOTING_ABI } from '@/lib/contracts';
import { generateCoordinatorKeyPair } from '@/lib/crypto-wrapper';
import { serializePoint } from '../../../../offchain/src/crypto/elgamal';
import * as fs from 'fs';
import * as path from 'path';

// Anvil account 0 (has 10000 ETH)
const DEPLOYER_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

// Path to store coordinator key
const COORDINATOR_KEY_PATH = '/tmp/maci-coordinator-key.json';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
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

    // Check if coordinator already exists
    let coordinatorId = 0n;
    let needsRegistration = false;

    try {
      const coord = await publicClient.readContract({
        address: contractAddress,
        abi: MACI_VOTING_ABI,
        functionName: 'coordinators',
        args: [0n],
      }) as [string, `0x${string}`, bigint, boolean, bigint];

      if (coord[3]) { // active
        coordinatorId = 0n;
        console.log('Coordinator already exists');

        // Check if we have the key file
        if (!fs.existsSync(COORDINATOR_KEY_PATH)) {
          console.log('Coordinator key file missing, need to re-register');
          // For demo, we'll skip re-registration but warn
          // In production, this would be a problem
        }
      } else {
        needsRegistration = true;
      }
    } catch {
      needsRegistration = true;
    }

    if (needsRegistration) {
      // Register as coordinator
      console.log('Registering coordinator...');

      const coordKeyPair = generateCoordinatorKeyPair();
      const pubKeyBytes = serializePoint(coordKeyPair.publicKey);
      const pubKeyHex = `0x${Buffer.from(pubKeyBytes).toString('hex')}` as `0x${string}`;

      // Save coordinator key to file for later decryption
      const affine = coordKeyPair.publicKey.toAffine();
      const keyData = {
        privateKey: coordKeyPair.privateKey.toString(),
        publicKey: {
          x: affine.x.toString(),
          y: affine.y.toString(),
        },
        publicKeyHex: pubKeyHex,
      };

      fs.writeFileSync(COORDINATOR_KEY_PATH, JSON.stringify(keyData, null, 2));
      console.log('Coordinator key saved to', COORDINATOR_KEY_PATH);

      const registerHash = await walletClient.writeContract({
        address: contractAddress,
        abi: MACI_VOTING_ABI,
        functionName: 'registerCoordinator',
        args: [pubKeyHex],
        value: parseEther('10'),
      });

      await publicClient.waitForTransactionReceipt({ hash: registerHash });
      coordinatorId = 0n;
    }

    // Check if proposal exists
    const proposalCount = await publicClient.readContract({
      address: contractAddress,
      abi: MACI_VOTING_ABI,
      functionName: 'nextProposalId',
    }) as bigint;

    let proposalId = 0n;

    if (proposalCount === 0n) {
      // Create a demo proposal
      console.log('Creating demo proposal...');

      const createHash = await walletClient.writeContract({
        address: contractAddress,
        abi: MACI_VOTING_ABI,
        functionName: 'createProposal',
        args: [
          coordinatorId,
          'Should we adopt MACI for all future votes?',
          BigInt(300),  // 5 min signup
          BigInt(300),  // 5 min voting
        ],
      });

      await publicClient.waitForTransactionReceipt({ hash: createHash });
      proposalId = 0n;
    } else {
      proposalId = proposalCount - 1n;
    }

    res.status(200).json({
      success: true,
      message: 'Demo setup complete!',
      coordinatorId: Number(coordinatorId),
      proposalId: Number(proposalId),
      keyFilePath: COORDINATOR_KEY_PATH,
      instructions: [
        '1. Go to /maci',
        '2. Click on the proposal to vote',
        '3. Generate a voter key',
        '4. Cast your vote (Yes/No)',
        '5. Try changing your key to invalidate previous vote',
      ],
    });
  } catch (error) {
    console.error('Setup error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Setup failed',
    });
  }
}
