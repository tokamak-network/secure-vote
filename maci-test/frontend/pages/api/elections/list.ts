import type { NextApiRequest, NextApiResponse } from 'next';
import * as fs from 'fs';
import * as path from 'path';

const METADATA_FILE = path.resolve(process.cwd(), '..', 'election-metadata.json');

/**
 * GET /api/elections/list
 * Returns election metadata (names, categories) stored locally.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    let metadata: Record<string, { name: string; category: string }> = {};
    try {
      metadata = JSON.parse(fs.readFileSync(METADATA_FILE, 'utf8'));
    } catch {}

    res.status(200).json({ success: true, metadata });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
}
