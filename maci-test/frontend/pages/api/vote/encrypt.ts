import type { NextApiRequest, NextApiResponse } from 'next';
import { publicClient, walletClient, POLL_ABI, getAddresses } from '@/lib/server';

/**
 * POST /api/vote/encrypt
 * Encrypts a vote with MACI and optionally publishes it on-chain.
 *
 * Body: {
 *   pollId, voterKey: { pubKey, privKey }, voteOption: 0|1, stateIndex,
 *   nonce?: number,          // message nonce (1 for first vote, 2+ for re-votes)
 *   newPubKey?: string,      // serialized new PubKey for key-change messages
 *   newPrivKey?: string,     // serialized new PrivKey (returned to client for future use)
 *   submit?: boolean,        // default true — if false, returns encrypted data without on-chain submission
 * }
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { pollId, voterKey, voteOption, stateIndex, nonce, newPubKey, newPrivKey, submit } = req.body;

    if (pollId === undefined || !voterKey || voteOption === undefined) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }

    const shouldSubmit = submit !== false;

    const { Keypair, PCommand, PrivKey, PubKey } = await import('maci-domainobjs');
    const { genRandomSalt } = await import('maci-crypto');

    // Get coordinator public key for THIS poll
    const configPath = require('path').resolve(process.cwd(), '..', 'deploy-config.json');
    const config = JSON.parse(require('fs').readFileSync(configPath, 'utf8'));

    let coordPubKeyStr: string;
    let pollAddress: `0x${string}`;

    // Check if this is a multi-poll setup
    if (config.polls && config.polls[pollId.toString()]) {
      const pollConfig = config.polls[pollId.toString()];
      coordPubKeyStr = pollConfig.coordinatorPubKey;
      pollAddress = pollConfig.pollAddress;
    } else if (pollId === 0 || pollId.toString() === config.pollId) {
      // Fallback to legacy single-poll config (Poll #0)
      coordPubKeyStr = config.coordinatorPubKey || process.env.NEXT_PUBLIC_COORDINATOR_PUB_KEY!;
      pollAddress = config.pollAddress || process.env.NEXT_PUBLIC_POLL_ADDRESS as `0x${string}`;
    } else {
      return res.status(500).json({ success: false, error: `Poll ${pollId} configuration not found` });
    }

    if (!pollAddress || !coordPubKeyStr) {
      return res.status(500).json({ success: false, error: 'Poll configuration incomplete' });
    }

    // Reconstruct voter keypair (current key used for signing)
    const voterPrivKey = PrivKey.deserialize(voterKey.privKey);
    const voterPubKey = PubKey.deserialize(voterKey.pubKey);

    // Reconstruct coordinator public key for THIS poll
    const coordPubKey = PubKey.deserialize(coordPubKeyStr);

    // For key-change: newPubKey tells MACI to associate this voter with a new key.
    // Future messages must be signed with the new key.
    let commandPubKey = voterPubKey;
    let returnNewKey: { pubKey: string; privKey: string } | undefined;

    if (newPubKey) {
      commandPubKey = PubKey.deserialize(newPubKey);
      if (newPrivKey) {
        returnNewKey = { pubKey: newPubKey, privKey: newPrivKey };
      }
    }

    // Create encrypted vote command
    const command = new PCommand(
      BigInt(stateIndex || 1),
      commandPubKey,
      BigInt(voteOption),
      1n, // voteWeight
      BigInt(nonce || 1),
      BigInt(pollId),
      genRandomSalt()
    );

    // Sign with the CURRENT private key (the key MACI knows for this voter)
    const signature = command.sign(voterPrivKey);
    const ephemeralKeypair = new Keypair();
    const sharedKey = Keypair.genEcdhSharedKey(ephemeralKeypair.privKey, coordPubKey);
    const message = command.encrypt(signature, sharedKey);

    // Prepare raw data for contract call
    const messageData = message.data.map((d: any) => d.toString());
    const encPubKey = {
      x: ephemeralKeypair.pubKey.rawPubKey[0].toString(),
      y: ephemeralKeypair.pubKey.rawPubKey[1].toString(),
    };

    if (!shouldSubmit) {
      // Prepare mode: return encrypted data for direct MetaMask submission
      return res.status(200).json({
        success: true,
        messageData,
        encPubKey,
        pollAddress,
        ...(returnNewKey && { newKey: returnNewKey }),
      });
    }

    // Relay mode: submit on-chain via server wallet
    const msgParam = {
      data: messageData.map((d: string) => BigInt(d)) as unknown as readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint],
    };
    const encPubKeyParam = {
      x: BigInt(encPubKey.x),
      y: BigInt(encPubKey.y),
    };

    const hash = await walletClient.writeContract({
      address: pollAddress,
      abi: POLL_ABI,
      functionName: 'publishMessage',
      args: [msgParam, encPubKeyParam],
    } as any);

    await publicClient.waitForTransactionReceipt({ hash });

    res.status(200).json({
      success: true,
      txHash: hash,
      message: newPubKey ? 'Key changed and vote submitted' : 'Vote encrypted and submitted on-chain',
      ...(returnNewKey && { newKey: returnNewKey }),
    });
  } catch (err: any) {
    console.error('encrypt error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}
