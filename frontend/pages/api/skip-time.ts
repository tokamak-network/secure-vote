import type { NextApiRequest, NextApiResponse } from 'next';

type ResponseData = {
  success: boolean;
  error?: string;
  newTimestamp?: number;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ResponseData>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const { seconds = 301 } = req.body; // Default: skip 5 minutes + 1 second

    // Advance Anvil time using evm_increaseTime
    const increaseResponse = await fetch('http://127.0.0.1:8545', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'evm_increaseTime',
        params: [seconds],
        id: 1,
      }),
    });

    // Mine a new block to apply the time change
    const mineResponse = await fetch('http://127.0.0.1:8545', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'evm_mine',
        params: [],
        id: 2,
      }),
    });

    // Get new timestamp
    const blockResponse = await fetch('http://127.0.0.1:8545', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_getBlockByNumber',
        params: ['latest', false],
        id: 3,
      }),
    });

    const blockData = await blockResponse.json();
    const newTimestamp = parseInt(blockData.result.timestamp, 16);

    console.log(`⏩ Skipped ${seconds} seconds. New timestamp: ${newTimestamp}`);

    return res.status(200).json({
      success: true,
      newTimestamp,
    });
  } catch (error) {
    console.error('Skip time error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
