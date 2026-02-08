import type { NextApiRequest, NextApiResponse } from 'next';

const PASSWORD = process.env.COORDINATOR_PASSWORD;

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!PASSWORD) {
    return res.status(500).json({ success: false, error: 'Server misconfigured: COORDINATOR_PASSWORD is not set' });
  }

  const { password } = req.body;

  if (password === PASSWORD) {
    // Set a cookie that expires in 1 day
    res.setHeader('Set-Cookie', `coordinator_auth=true; Path=/; Max-Age=86400; SameSite=Strict`);
    return res.status(200).json({ success: true });
  }

  return res.status(401).json({ success: false, error: 'Invalid password' });
}
