import type { NextApiRequest, NextApiResponse } from 'next';
import { encrypt, serializeCiphertext, pointFromCoordinates } from '../../lib/crypto-wrapper';
import fs from 'fs';
import path from 'path';

const KEY_STORE_PATH = path.join(process.cwd(), 'key-shares.json');

type ResponseData = {
  success: boolean;
  ciphertext?: string;
  error?: string;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ResponseData>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const { vote } = req.body;

    if (vote !== 0 && vote !== 1) {
      return res.status(400).json({ success: false, error: 'Vote must be 0 or 1' });
    }

    // Load public key from storage
    if (!fs.existsSync(KEY_STORE_PATH)) {
      return res.status(400).json({
        success: false,
        error: 'Public key not found. Please run Setup Demo first.',
      });
    }

    const keyData = JSON.parse(fs.readFileSync(KEY_STORE_PATH, 'utf-8'));

    // Support both legacy (publicKey) and new (aggregatedPublicKey) formats
    const pkData = keyData.aggregatedPublicKey || keyData.publicKey;
    if (!pkData) {
      return res.status(400).json({
        success: false,
        error: 'Invalid key format. Please run Setup Demo again.',
      });
    }
    const publicKey = pointFromCoordinates(pkData.x, pkData.y);

    // Encrypt the vote
    const ciphertext = encrypt(BigInt(vote), publicKey);
    const serialized = serializeCiphertext(ciphertext);

    return res.status(200).json({
      success: true,
      ciphertext: `0x${serialized}`,
    });
  } catch (error) {
    console.error('Encrypt vote error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
