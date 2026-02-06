import type { NextApiRequest, NextApiResponse } from 'next';
import { createWalletClient, createPublicClient, http, Log } from 'viem';
import { getCommitteeAccount } from '../../lib/anvil-helpers';
import { VOTING_ABI, anvilChain, getContractAddress } from '../../lib/contracts';
import {
  VoteAggregator,
  deserializeCiphertext,
  createPartialDecryption,
  silentDecrypt,
} from '../../lib/crypto-wrapper';
import fs from 'fs';
import path from 'path';

const KEY_STORE_PATH = path.join(process.cwd(), 'key-shares.json');

type ResponseData = {
  success: boolean;
  result?: {
    yesVotes: number;
    noVotes: number;
    votesRoot: string;
  };
  error?: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ResponseData>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    console.log('=== Decrypt & Tally Starting ===');

    const { proposalId } = req.body;
    if (proposalId === undefined) {
      return res.status(400).json({ success: false, error: 'proposalId required' });
    }

    const contractAddress = getContractAddress();

    // Load key shares from storage
    if (!fs.existsSync(KEY_STORE_PATH)) {
      return res.status(400).json({
        success: false,
        error: 'Key shares not found. Please run Setup Demo first.',
      });
    }

    const keyData = JSON.parse(fs.readFileSync(KEY_STORE_PATH, 'utf-8'));

    // Handle both legacy (Shamir) and new (Silent Setup) formats
    const isLegacyFormat = keyData.shares !== undefined;
    if (isLegacyFormat) {
      return res.status(400).json({
        success: false,
        error: 'Legacy key format detected. Please delete key-shares.json and run Setup Demo again.',
      });
    }

    const members = keyData.members.map((m: any) => ({
      index: m.index,
      secretKey: BigInt(m.secretKey),
    }));

    console.log(`✓ Loaded Silent Setup keys (${members.length} members)`);

    // Setup clients
    const publicClient = createPublicClient({
      chain: anvilChain,
      transport: http(),
    });

    const committeeAccount = getCommitteeAccount();
    const committeeClient = createWalletClient({
      account: committeeAccount,
      chain: anvilChain,
      transport: http(),
    });

    // Step 1: Fetch encrypted votes from contract events
    console.log('Fetching encrypted votes from contract...');

    // Get all VoteCommitted events for this proposal to find voters
    const logs = await publicClient.getLogs({
      address: contractAddress,
      event: {
        type: 'event',
        name: 'VoteCommitted',
        inputs: [
          { type: 'uint256', name: 'proposalId', indexed: true },
          { type: 'address', name: 'voter', indexed: true },
          { type: 'uint256', name: 'timestamp', indexed: false },
        ],
      },
      args: {
        proposalId: BigInt(proposalId),
      },
      fromBlock: 0n,
    });

    if (logs.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No votes found for this proposal',
      });
    }

    console.log(`✓ Found ${logs.length} vote events`);

    // Step 2: Fetch encrypted votes from contract storage and aggregate
    console.log('Fetching and decrypting votes...');
    const aggregator = new VoteAggregator();

    // Track unique voters (in case of vote overwrites, only the last one counts)
    const uniqueVoters = new Map<string, { voter: string; timestamp: bigint }>();
    for (const log of logs) {
      const { voter, timestamp } = (log as any).args;
      const existing = uniqueVoters.get(voter.toLowerCase());
      if (!existing || timestamp > existing.timestamp) {
        uniqueVoters.set(voter.toLowerCase(), { voter, timestamp });
      }
    }

    console.log(`✓ Found ${uniqueVoters.size} unique voters`);

    // Add all votes to aggregator
    for (const { voter, timestamp } of uniqueVoters.values()) {
      // Read encrypted vote from contract storage
      const encryptedVote = await publicClient.readContract({
        address: contractAddress,
        abi: VOTING_ABI,
        functionName: 'encryptedVotes',
        args: [BigInt(proposalId), voter as `0x${string}`],
      }) as [string, bigint];

      const ciphertext = encryptedVote[0];
      const voteTimestamp = encryptedVote[1];

      if (!ciphertext || ciphertext === '0x') {
        console.log(`Skipping empty vote for ${voter}`);
        continue;
      }

      const ciphertextHex = ciphertext.slice(2); // Remove 0x prefix
      const deserializedCiphertext = deserializeCiphertext(ciphertextHex);

      aggregator.addVote(voter, deserializedCiphertext, Number(voteTimestamp));
    }

    // Decrypt all votes using Silent Setup (n-of-n)
    const allVotes = aggregator.getVotes();
    const decryptedVotes: Array<{ voter: string; vote: bigint; timestamp: number }> = [];

    console.log('Decrypting votes with Silent Setup (all members required)...');

    for (const voteData of allVotes) {
      // All members create partial decryptions
      const partials = members.map((m: { index: number; secretKey: bigint }) =>
        createPartialDecryption(voteData.ciphertext, m.secretKey, m.index)
      );

      // Combine all partials to decrypt
      const decryptedValue = silentDecrypt(voteData.ciphertext, partials);

      if (decryptedValue === null) {
        console.log(`Skipping voter ${voteData.voter}: decryption failed (wrong key?)`);
        continue;
      }

      decryptedVotes.push({
        voter: voteData.voter,
        vote: decryptedValue,
        timestamp: voteData.timestamp,
      });
    }

    console.log(`✓ Decrypted ${decryptedVotes.length} of ${allVotes.length} votes`);

    if (decryptedVotes.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No votes could be decrypted. The votes may have been encrypted with different keys. Please run Setup Demo again to create a new proposal.',
      });
    }

    // Tally votes
    const result = aggregator.tallyVotes(decryptedVotes);
    console.log(`✓ Tally: Yes=${result.yesVotes}, No=${result.noVotes}`);

    // Step 3: Submit tally to contract
    console.log('Submitting tally to blockchain...');
    const tallyHash = await committeeClient.writeContract({
      address: contractAddress,
      abi: VOTING_ABI,
      functionName: 'submitTally',
      args: [
        BigInt(proposalId),
        BigInt(result.yesVotes),
        BigInt(result.noVotes),
        result.votesRoot as `0x${string}`,
      ],
    });

    await publicClient.waitForTransactionReceipt({ hash: tallyHash });
    console.log('✓ Tally submitted:', tallyHash);

    console.log('=== Decrypt & Tally Complete ===');

    return res.status(200).json({
      success: true,
      result: {
        yesVotes: result.yesVotes,
        noVotes: result.noVotes,
        votesRoot: result.votesRoot,
      },
    });
  } catch (error) {
    console.error('Decrypt & tally error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
