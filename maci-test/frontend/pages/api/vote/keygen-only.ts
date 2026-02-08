import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * POST /api/vote/keygen-only
 * Generates a MACI keypair WITHOUT on-chain signup.
 * Used for key-change messages where the voter already has a stateIndex.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { Keypair } = await import('maci-domainobjs');
    const keypair = new Keypair();

    res.status(200).json({
      success: true,
      keypair: {
        pubKey: keypair.pubKey.serialize(),
        privKey: keypair.privKey.serialize(),
      },
    });
  } catch (err: any) {
    console.error('keygen-only error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}
