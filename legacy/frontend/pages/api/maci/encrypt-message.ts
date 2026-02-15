import type { NextApiRequest, NextApiResponse } from 'next';
import {
  deserializeVoterKey,
  encryptMessage,
  serializeMessage,
} from '@/lib/crypto-wrapper';
import { pointFromCoordinates } from '@/lib/crypto-wrapper';

export default function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { voterKey, coordinatorPubKey, vote } = req.body;

    if (!voterKey || !coordinatorPubKey || vote === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: voterKey, coordinatorPubKey, vote',
      });
    }

    if (vote !== 0 && vote !== 1) {
      return res.status(400).json({
        success: false,
        error: 'Vote must be 0 or 1',
      });
    }

    // Deserialize voter key
    const keyPair = deserializeVoterKey(voterKey);

    // Deserialize coordinator public key (from hex string x||y)
    const coordPubKeyHex = coordinatorPubKey as string;
    const xHex = coordPubKeyHex.slice(0, 64);
    const yHex = coordPubKeyHex.slice(64, 128);
    const coordPubKey = pointFromCoordinates(
      BigInt('0x' + xHex),
      BigInt('0x' + yHex)
    );

    // Encrypt the message
    const encrypted = encryptMessage(keyPair, coordPubKey, vote as 0 | 1);
    const serialized = serializeMessage(encrypted);

    res.status(200).json({
      success: true,
      message: serialized,
    });
  } catch (error) {
    console.error('Error encrypting message:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to encrypt message',
    });
  }
}
