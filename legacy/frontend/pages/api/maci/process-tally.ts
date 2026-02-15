import type { NextApiRequest, NextApiResponse } from 'next';
import { createPublicClient, createWalletClient, http, keccak256, toHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { MACI_VOTING_ABI } from '@/lib/contracts';
import { createProcessorWithKey, pointFromCoordinates } from '@/lib/crypto-wrapper';
import * as fs from 'fs';

// Anvil account 0 (coordinator)
const DEPLOYER_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

// Path to coordinator key (same as setup-demo.ts)
const COORDINATOR_KEY_PATH = '/tmp/maci-coordinator-key.json';

interface StoredKeyData {
  privateKey: string;
  publicKey: {
    x: string;
    y: string;
  };
  publicKeyHex: string;
}

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

    // Load coordinator key
    if (!fs.existsSync(COORDINATOR_KEY_PATH)) {
      throw new Error('Coordinator key not found. Run setup-demo first.');
    }

    const keyData: StoredKeyData = JSON.parse(fs.readFileSync(COORDINATOR_KEY_PATH, 'utf8'));
    const coordinatorKey = {
      privateKey: BigInt(keyData.privateKey),
      publicKey: pointFromCoordinates(keyData.publicKey.x, keyData.publicKey.y),
    };

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

    // Get message count
    const messageCount = await publicClient.readContract({
      address: contractAddress,
      abi: MACI_VOTING_ABI,
      functionName: 'getMessageCount',
      args: [BigInt(proposalId)],
    }) as bigint;

    if (messageCount === 0n) {
      return res.status(400).json({ error: 'No votes to process' });
    }

    console.log(`Processing ${messageCount} messages for proposal ${proposalId}`);

    // Fetch all messages from the chain
    const serializedMessages: Array<{
      voterPubKey: string;
      encryptedData: string;
      ephemeralPubKey: string;
    }> = [];

    for (let i = 0n; i < messageCount; i++) {
      const msg = await publicClient.readContract({
        address: contractAddress,
        abi: MACI_VOTING_ABI,
        functionName: 'getMessage',
        args: [BigInt(proposalId), i],
      }) as [`0x${string}`, `0x${string}`, `0x${string}`, bigint];

      serializedMessages.push({
        voterPubKey: msg[0].slice(2),      // Remove 0x prefix
        encryptedData: msg[1].slice(2),
        ephemeralPubKey: msg[2].slice(2),
      });
    }

    console.log(`Fetched ${serializedMessages.length} messages from chain`);

    // Create processor with coordinator key and process messages
    const processor = createProcessorWithKey(coordinatorKey);
    const batchResult = processor.processSerializedBatch(serializedMessages);

    console.log(`Processed: ${batchResult.processed}, Applied: ${batchResult.applied}, Rejected: ${batchResult.rejected}`);

    // Get tally
    const tally = processor.tally();
    console.log(`Tally - Yes: ${tally.yes}, No: ${tally.no}, Abstain: ${tally.abstain}`);

    // Check if already processed
    const batchIndex = await publicClient.readContract({
      address: contractAddress,
      abi: MACI_VOTING_ABI,
      functionName: 'currentBatchIndex',
      args: [BigInt(proposalId)],
    }) as bigint;

    if (batchIndex === 0n) {
      // Submit state root
      const stateRootHex = `0x${batchResult.stateRoot.padStart(64, '0')}` as `0x${string}`;

      const hash1 = await walletClient.writeContract({
        address: contractAddress,
        abi: MACI_VOTING_ABI,
        functionName: 'submitStateRoot',
        args: [BigInt(proposalId), stateRootHex, messageCount],
      });

      await publicClient.waitForTransactionReceipt({ hash: hash1 });
      console.log('State root submitted:', stateRootHex);
    }

    // Check tally status
    const onChainTally = await publicClient.readContract({
      address: contractAddress,
      abi: MACI_VOTING_ABI,
      functionName: 'tallies',
      args: [BigInt(proposalId)],
    }) as [bigint, bigint, string, bigint, boolean, string, bigint, boolean];

    if (onChainTally[3] === 0n) { // totalVotes === 0
      // Submit actual tally
      const yesVotes = BigInt(tally.yes);
      const noVotes = BigInt(tally.no);

      // Create tally commitment (hash of results + state root)
      const tallyCommitmentData = `${tally.yes}:${tally.no}:${tally.abstain}:${batchResult.stateRoot}`;
      const tallyCommitment = keccak256(toHex(tallyCommitmentData));

      const hash2 = await walletClient.writeContract({
        address: contractAddress,
        abi: MACI_VOTING_ABI,
        functionName: 'submitTally',
        args: [BigInt(proposalId), yesVotes, noVotes, tallyCommitment],
      });

      await publicClient.waitForTransactionReceipt({ hash: hash2 });
      console.log(`Tally submitted - Yes: ${yesVotes}, No: ${noVotes}`);
    }

    res.status(200).json({
      success: true,
      message: 'Tally processed with real decryption!',
      proposalId,
      messageCount: Number(messageCount),
      processed: batchResult.processed,
      applied: batchResult.applied,
      rejected: batchResult.rejected,
      yesVotes: tally.yes,
      noVotes: tally.no,
      abstainVotes: tally.abstain,
      stateRoot: batchResult.stateRoot,
    });
  } catch (error) {
    console.error('Process tally error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Processing failed',
    });
  }
}
