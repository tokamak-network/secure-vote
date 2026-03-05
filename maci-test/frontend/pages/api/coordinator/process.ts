import type { NextApiRequest, NextApiResponse } from 'next';
import { exec } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

const PROJECT_ROOT = path.resolve(process.cwd(), '..');

function getProofsDir(pollId: number | string): string {
  return path.resolve(process.cwd(), `../proofs-web/poll-${pollId}`);
}

function getStatusFile(pollId: number | string): string {
  return path.join(getProofsDir(pollId), 'status.json');
}

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
  const cookie = req.headers.cookie || '';
  const authed = /(?:^|;\s*)coordinator_auth=true(?:;|$)/.test(cookie);
  if (!authed) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  if (req.method === 'GET') {
    const { pollId } = req.query;
    const pollIdStr = pollId !== undefined ? pollId.toString() : '0';
    const statusFile = getStatusFile(pollIdStr);

    if (fs.existsSync(statusFile)) {
      const status = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
      return res.status(200).json({ success: true, ...status });
    }
    return res.status(200).json({ success: true, status: 'not-started' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { pollId } = req.body;
    const pollIdStr = pollId !== undefined ? pollId.toString() : '0';
    const statusFile = getStatusFile(pollIdStr);
    const proofsDir = getProofsDir(pollIdStr);

    // Ensure poll-specific directory exists
    if (!fs.existsSync(proofsDir)) {
      fs.mkdirSync(proofsDir, { recursive: true });
    }

    // Check if already running
    if (fs.existsSync(statusFile)) {
      const status = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
      if (['starting', 'time-traveling', 'merging-trees', 'computing-inputs'].includes(status.status)) {
        return res.status(200).json({ success: true, status: status.status, message: 'Already running' });
      }
    }

    // Spawn commitment extraction script (no proof generation)
    const cmd = `cd "${PROJECT_ROOT}" && POLL_ID=${pollIdStr} OUTPUT_DIR="${proofsDir}" npx hardhat run scripts/coordinator-commitments.ts --network localhost`;

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
    res.status(500).json({
      success: false,
      error: 'Failed to start commitment extraction',
      details: err.message,
      suggestion: 'Check that the hardhat node is running and the poll exists',
    });
  }
}
