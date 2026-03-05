import type { NextApiRequest, NextApiResponse } from 'next';
import { exec } from 'child_process';
import { publicClient, MACI_RLA_ABI, getAddresses } from '@/lib/server';
import * as path from 'path';
import * as fs from 'fs';

const PROJECT_ROOT = path.resolve(process.cwd(), '..');

function getProofsDir(pollId: number | string): string {
  return path.resolve(process.cwd(), `../proofs-web/poll-${pollId}`);
}

function getStatusFile(pollId: number | string): string {
  return path.join(getProofsDir(pollId), 'status.json');
}

function getProveBatchesFile(pollId: number | string): string {
  return path.join(getProofsDir(pollId), 'prove-batches.json');
}

/**
 * POST /api/coordinator/rla-prove
 * After RLA reveal, generates Groth16 proofs ONLY for sampled batches.
 * Reads sampled batch indices from MaciRLA, writes prove-batches.json,
 * then spawns coordinator-prove-batch.ts.
 *
 * Body: { pollId } - the MaciRLA poll ID
 *
 * GET /api/coordinator/rla-prove
 * Returns current proof generation status.
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
      return res.status(200).json({
        success: true,
        proveStatus: status.proveStatus || 'not-started',
        proved: status.proved || 0,
        totalToProve: status.totalToProve || 0,
      });
    }
    return res.status(200).json({ success: true, proveStatus: 'not-started' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { pollId } = req.body;
    if (pollId === undefined) {
      return res.status(400).json({ success: false, error: 'pollId required' });
    }

    const pollIdStr = pollId.toString();
    const statusFile = getStatusFile(pollIdStr);
    const proofsDir = getProofsDir(pollIdStr);
    const proveBatchesFile = getProveBatchesFile(pollIdStr);

    // Ensure poll-specific directory exists
    if (!fs.existsSync(proofsDir)) {
      fs.mkdirSync(proofsDir, { recursive: true });
    }

    const { maci, maciRla } = getAddresses();
    if (!maciRla || !maci) {
      return res.status(500).json({ success: false, error: 'Contract addresses not configured' });
    }

    // Check if already proving
    if (fs.existsSync(statusFile)) {
      const status = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
      if (status.proveStatus === 'proving') {
        return res.status(200).json({
          success: true,
          proveStatus: 'proving',
          message: 'Already generating proofs',
          proved: status.proved || 0,
          totalToProve: status.totalToProve || 0,
        });
      }
    }

    // Get poll address from MACI Poll ID
    const pollResult = await publicClient.readContract({
      address: maci,
      abi: [{ type: 'function', name: 'getPoll', inputs: [{ type: 'uint256' }], outputs: [{ type: 'address', name: 'poll' }, { type: 'address' }, { type: 'address' }], stateMutability: 'view' }],
      functionName: 'getPoll',
      args: [BigInt(pollId)],
    } as any) as any;

    const pollAddress = pollResult[0] || pollResult.poll;

    // Convert MACI Poll address to RLA Poll ID
    const rlaPollId = await publicClient.readContract({
      address: maciRla,
      abi: MACI_RLA_ABI,
      functionName: 'pollToAuditId',
      args: [pollAddress as `0x${string}`],
    } as any) as bigint;

    // Read sampled batch indices from MaciRLA
    const [pmSamples, tvSamples] = await publicClient.readContract({
      address: maciRla,
      abi: MACI_RLA_ABI,
      functionName: 'getSampleCounts',
      args: [rlaPollId],
    } as any) as [bigint, bigint];

    const [pmIndices, tvIndices] = await publicClient.readContract({
      address: maciRla,
      abi: MACI_RLA_ABI,
      functionName: 'getSelectedBatches',
      args: [rlaPollId],
    } as any) as [bigint[], bigint[]];

    // Convert 1-based batch indices to 0-based file indices
    const pmFileIndices = pmIndices.slice(0, Number(pmSamples)).map(i => Number(i) - 1);
    const tvFileIndices = tvIndices.slice(0, Number(tvSamples)).map(i => Number(i) - 1);

    // Write prove-batches.json for the script to read
    fs.writeFileSync(proveBatchesFile, JSON.stringify({
      pm: pmFileIndices,
      tv: tvFileIndices,
    }, null, 2));

    // Spawn proof generation script with poll-specific directory
    const cmd = `cd "${PROJECT_ROOT}" && OUTPUT_DIR="${proofsDir}" npx hardhat run scripts/coordinator-prove-batch.ts --network localhost`;

    exec(cmd, { maxBuffer: 10 * 1024 * 1024, timeout: 600000 }, (error, stdout, stderr) => {
      if (error) {
        console.error('Batch proof generation error:', error.message);
        console.error('stderr:', stderr);
      } else {
        console.log('Batch proof generation output:', stdout);
      }
    });

    res.status(200).json({
      success: true,
      proveStatus: 'started',
      pmBatches: pmFileIndices,
      tvBatches: tvFileIndices,
      totalToProve: pmFileIndices.length + tvFileIndices.length,
      message: 'Proof generation started for sampled batches. Poll GET /api/coordinator/rla-prove for status.',
    });
  } catch (err: any) {
    console.error('rla-prove error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}
