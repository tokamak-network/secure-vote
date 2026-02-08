import type { NextApiRequest, NextApiResponse } from 'next';
import { exec } from 'child_process';
import { publicClient, MACI_RLA_ABI, getAddresses } from '@/lib/server';
import * as path from 'path';
import * as fs from 'fs';

const PROOFS_DIR = path.resolve(process.cwd(), '../proofs-web');
const STATUS_FILE = path.join(PROOFS_DIR, 'status.json');
const PROVE_BATCHES_FILE = path.join(PROOFS_DIR, 'prove-batches.json');
const PROJECT_ROOT = path.resolve(process.cwd(), '..');

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
  if (req.method === 'GET') {
    if (fs.existsSync(STATUS_FILE)) {
      const status = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
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

    const { maciRla } = getAddresses();
    if (!maciRla) {
      return res.status(500).json({ success: false, error: 'MaciRLA address not configured' });
    }

    // Check if already proving
    if (fs.existsSync(STATUS_FILE)) {
      const status = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
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

    // Read sampled batch indices from MaciRLA
    const [pmSamples, tvSamples] = await publicClient.readContract({
      address: maciRla,
      abi: MACI_RLA_ABI,
      functionName: 'getSampleCounts',
      args: [BigInt(pollId)],
    } as any) as [bigint, bigint];

    const [pmIndices, tvIndices] = await publicClient.readContract({
      address: maciRla,
      abi: MACI_RLA_ABI,
      functionName: 'getSelectedBatches',
      args: [BigInt(pollId)],
    } as any) as [bigint[], bigint[]];

    // Convert 1-based batch indices to 0-based file indices
    const pmFileIndices = pmIndices.slice(0, Number(pmSamples)).map(i => Number(i) - 1);
    const tvFileIndices = tvIndices.slice(0, Number(tvSamples)).map(i => Number(i) - 1);

    // Write prove-batches.json for the script to read
    fs.writeFileSync(PROVE_BATCHES_FILE, JSON.stringify({
      pm: pmFileIndices,
      tv: tvFileIndices,
    }, null, 2));

    // Spawn proof generation script
    const cmd = `cd "${PROJECT_ROOT}" && npx hardhat run scripts/coordinator-prove-batch.ts --network localhost`;

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
