import type { NextApiRequest, NextApiResponse } from 'next';
import {
  generateVoterKeyPair,
  serializeVoterKey,
} from '@/lib/crypto-wrapper';

export default function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { nonce = 0 } = req.body;

    const keyPair = generateVoterKeyPair(nonce);
    const serialized = serializeVoterKey(keyPair);

    res.status(200).json({
      success: true,
      keyPair: serialized,
    });
  } catch (error) {
    console.error('Error generating voter key:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to generate key',
    });
  }
}
