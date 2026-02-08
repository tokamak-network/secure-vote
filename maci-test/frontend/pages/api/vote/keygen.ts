import type { NextApiRequest, NextApiResponse } from 'next';
import { publicClient, walletClient, MACI_SIGNUP_ABI, getAddresses } from '@/lib/server';

/**
 * POST /api/vote/keygen
 * Generates a MACI keypair and optionally signs up to MACI on-chain.
 *
 * Body (optional JSON):
 *   submit: boolean (default true) — if false, returns keypair + pubKey params without on-chain signup
 *
 * When submit=true (relay mode): generates keypair + submits signUp tx via server wallet
 * When submit=false (prepare mode): generates keypair + returns raw pubKey coordinates for MetaMask direct submission
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { Keypair } = await import('maci-domainobjs');
    const keypair = new Keypair();

    const { maci } = getAddresses();
    if (!maci) {
      return res.status(500).json({ success: false, error: 'MACI address not configured' });
    }

    const body = req.body || {};
    const shouldSubmit = body.submit !== false;

    const pubKeyParam = {
      x: keypair.pubKey.rawPubKey[0].toString(),
      y: keypair.pubKey.rawPubKey[1].toString(),
    };

    if (!shouldSubmit) {
      // Prepare mode: return keypair + raw pubKey for direct MetaMask submission
      return res.status(200).json({
        success: true,
        keypair: {
          pubKey: keypair.pubKey.serialize(),
          privKey: keypair.privKey.serialize(),
        },
        pubKeyParam,
        maciAddress: maci,
      });
    }

    // Relay mode: submit signUp on-chain via server wallet
    const hash = await walletClient.writeContract({
      address: maci,
      abi: MACI_SIGNUP_ABI,
      functionName: 'signUp',
      args: [{ x: BigInt(pubKeyParam.x), y: BigInt(pubKeyParam.y) }, '0x', '0x'],
    } as any);

    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    // Parse stateIndex from SignUp event data field
    // Event: SignUp(uint256 _stateIndex, uint256 indexed _userPubKeyX,
    //               uint256 indexed _userPubKeyY, uint256 _voiceCreditBalance, uint256 _timestamp)
    // _stateIndex is NOT indexed — it's the first word in the data field
    let stateIndex: bigint;
    const signUpLog = receipt.logs.find((log: any) =>
      log.topics?.length >= 2 && log.address.toLowerCase() === maci.toLowerCase()
    );
    if (signUpLog && signUpLog.data.length >= 66) {
      stateIndex = BigInt('0x' + signUpLog.data.substring(2, 66));
    } else {
      const numSignUps = await publicClient.readContract({
        address: maci,
        abi: MACI_SIGNUP_ABI,
        functionName: 'numSignUps',
      } as any) as bigint;
      stateIndex = numSignUps;
    }

    res.status(200).json({
      success: true,
      keypair: {
        pubKey: keypair.pubKey.serialize(),
        privKey: keypair.privKey.serialize(),
      },
      stateIndex: Number(stateIndex),
      txHash: hash,
    });
  } catch (err: any) {
    console.error('keygen error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}
