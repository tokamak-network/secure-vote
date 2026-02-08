import type { NextApiRequest, NextApiResponse } from 'next';
import { publicClient, walletClient, MACI_SIGNUP_ABI, getAddresses } from '@/lib/server';
import * as fs from 'fs';
import * as path from 'path';

const METADATA_FILE = path.resolve(process.cwd(), '..', 'election-metadata.json');

// Circuit params must match zkeys (10-2-1-2 for PM, 10-1-2 for TV)
const TREE_DEPTHS = {
  intStateTreeDepth: 1,
  messageTreeSubDepth: 1,
  messageTreeDepth: 2,
  voteOptionTreeDepth: 2,
};

function loadMetadata(): Record<string, { name: string; category: string }> {
  try {
    return JSON.parse(fs.readFileSync(METADATA_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveMetadata(data: Record<string, { name: string; category: string }>) {
  fs.writeFileSync(METADATA_FILE, JSON.stringify(data, null, 2));
}

/**
 * POST /api/elections/create
 * Deploys a new MACI Poll on-chain.
 *
 * Body: { name, category?, duration? }
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { name, category, duration } = req.body;

    if (!name) {
      return res.status(400).json({ success: false, error: 'Election name is required' });
    }

    const { maci, verifier, vkRegistry } = getAddresses();
    if (!maci) {
      return res.status(500).json({ success: false, error: 'MACI address not configured' });
    }
    if (!verifier || !vkRegistry) {
      return res.status(500).json({ success: false, error: 'Verifier/VkRegistry not configured' });
    }

    // Generate coordinator keypair for this poll
    const { Keypair } = await import('maci-domainobjs');
    const coordinatorKeypair = new Keypair();

    const pubKeyParam = {
      x: BigInt(coordinatorKeypair.pubKey.rawPubKey[0].toString()),
      y: BigInt(coordinatorKeypair.pubKey.rawPubKey[1].toString()),
    };

    // Deploy the poll on-chain
    const hash = await walletClient.writeContract({
      address: maci,
      abi: MACI_SIGNUP_ABI,
      functionName: 'deployPoll',
      args: [
        BigInt(duration || 3600),
        TREE_DEPTHS,
        pubKeyParam,
        verifier,
        vkRegistry,
        0, // QV mode
      ],
    } as any);

    await publicClient.waitForTransactionReceipt({ hash });

    // Get the new poll ID
    const nextPollId = await publicClient.readContract({
      address: maci,
      abi: MACI_SIGNUP_ABI,
      functionName: 'nextPollId',
    } as any) as bigint;
    const pollId = Number(nextPollId) - 1;

    // Get poll address
    const pollContracts = await publicClient.readContract({
      address: maci,
      abi: MACI_SIGNUP_ABI,
      functionName: 'getPoll',
      args: [BigInt(pollId)],
    } as any) as any;

    // Store metadata
    const metadata = loadMetadata();
    metadata[pollId.toString()] = { name, category: category || '' };
    saveMetadata(metadata);

    // Store coordinator key for proof generation
    const deployConfigPath = path.resolve(process.cwd(), '..', 'deploy-config.json');
    try {
      const config = JSON.parse(fs.readFileSync(deployConfigPath, 'utf8'));
      if (!config.polls) config.polls = {};
      config.polls[pollId.toString()] = {
        pollAddress: pollContracts[0] || pollContracts.poll,
        coordinatorPubKey: coordinatorKeypair.pubKey.serialize(),
        coordinatorPrivKey: coordinatorKeypair.privKey.serialize(),
        duration: duration || 3600,
        createdAt: new Date().toISOString(),
      };
      fs.writeFileSync(deployConfigPath, JSON.stringify(config, null, 2));
    } catch (err) {
      console.error('Warning: could not update deploy-config.json:', err);
    }

    res.status(200).json({
      success: true,
      pollId,
      pollAddress: pollContracts[0] || pollContracts.poll,
      txHash: hash,
    });
  } catch (err: any) {
    console.error('create election error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}
