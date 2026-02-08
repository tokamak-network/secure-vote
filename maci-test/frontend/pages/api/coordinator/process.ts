import type { NextApiRequest, NextApiResponse } from 'next';
import { exec } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

const PROOFS_DIR = path.resolve(process.cwd(), '../proofs-web');
const STATUS_FILE = path.join(PROOFS_DIR, 'status.json');
const PROJECT_ROOT = path.resolve(process.cwd(), '..');

/**
 * POST /api/coordinator/process
 * Triggers commitment extraction (no proof generation) by spawning
 * the coordinator-commitments.ts hardhat script.
 * Returns immediately with status; poll GET for progress.
 *
 * GET /api/coordinator/process
 * Returns current extraction status.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    if (fs.existsSync(STATUS_FILE)) {
      const status = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
      return res.status(200).json({ success: true, ...status });
    }
    return res.status(200).json({ success: true, status: 'not-started' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Check if already running
    if (fs.existsSync(STATUS_FILE)) {
      const status = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
      if (['starting', 'time-traveling', 'merging-trees', 'computing-inputs'].includes(status.status)) {
        return res.status(200).json({ success: true, status: status.status, message: 'Already running' });
      }
    }

    // Spawn commitment extraction script (no proof generation)
    const cmd = `cd "${PROJECT_ROOT}" && npx hardhat run scripts/coordinator-commitments.ts --network localhost`;

    exec(cmd, { maxBuffer: 10 * 1024 * 1024, timeout: 600000 }, (error, stdout, stderr) => {
      if (error) {
        console.error('Coordinator commitments error:', error.message);
        console.error('stderr:', stderr);
      } else {
        console.log('Coordinator commitments output:', stdout);
      }
    });

    res.status(200).json({
      success: true,
      status: 'started',
      message: 'Commitment extraction started. Poll GET /api/coordinator/process for status.',
    });
  } catch (err: any) {
    console.error('process error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}
