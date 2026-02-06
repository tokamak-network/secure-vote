import type { NextApiRequest, NextApiResponse } from 'next';
import fs from 'fs';
import path from 'path';

const KEY_STORE_PATH = path.join(process.cwd(), 'key-shares.json');

type ResponseData = {
  publicKey?: {
    x: string;
    y: string;
  };
  error?: string;
}

export default function handler(
  req: NextApiRequest,
  res: NextApiResponse<ResponseData>
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    if (!fs.existsSync(KEY_STORE_PATH)) {
      return res.status(404).json({
        error: 'Public key not found. Please run Setup Demo first.',
      });
    }

    const keyData = JSON.parse(fs.readFileSync(KEY_STORE_PATH, 'utf-8'));

    // Support both legacy (publicKey) and new (aggregatedPublicKey) formats
    const pkData = keyData.aggregatedPublicKey || keyData.publicKey;
    if (!pkData) {
      return res.status(404).json({
        error: 'Invalid key format. Please run Setup Demo again.',
      });
    }

    return res.status(200).json({
      publicKey: pkData,
    });
  } catch (error) {
    console.error('Error reading public key:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
