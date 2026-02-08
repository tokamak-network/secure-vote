import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { useAccount, usePublicClient } from 'wagmi';
import { writeContract, waitForTransactionReceipt } from '@wagmi/core';
import { wagmiConfig } from '@/lib/wagmi-config';
import { MACI_ABI, POLL_ABI } from '@/lib/contracts';
import Layout from '@/components/Layout';
import Link from 'next/link';

interface VoterKeyData {
  pubKey: string;
  privKey: string;
  stateIndex: number;
  nonce: number;
  chainId?: string;
}

export default function ElectionDetail() {
  const router = useRouter();
  const { id } = router.query;
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const [keyData, setKeyData] = useState<VoterKeyData | null>(null);
  const [isSignedUp, setIsSignedUp] = useState(false);
  const [hasVoted, setHasVoted] = useState(false);
  const [selectedVote, setSelectedVote] = useState<'yes' | 'no' | null>(null);
  const [signupLoading, setSignupLoading] = useState(false);
  const [voteLoading, setVoteLoading] = useState(false);
  const [keyChangeLoading, setKeyChangeLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [lastVoteChoice, setLastVoteChoice] = useState<string | null>(null);

  // Detect stale keys
  useEffect(() => {
    if (id !== undefined) {
      const stored = localStorage.getItem(`voter-key-${id}`);
      const currentMaci = process.env.NEXT_PUBLIC_MACI_ADDRESS || '';
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          if (!parsed.nonce) parsed.nonce = 1;
          if (parsed.chainId && parsed.chainId !== currentMaci) {
            localStorage.removeItem(`voter-key-${id}`);
            return;
          }
          setKeyData(parsed);
          setIsSignedUp(true);
          if (parsed.nonce > 1) setHasVoted(true);
          if (parsed.lastVote) setLastVoteChoice(parsed.lastVote);
        } catch {
          localStorage.removeItem(`voter-key-${id}`);
        }
      }
    }
  }, [id]);

  const saveKeyData = (data: VoterKeyData, lastVote?: string) => {
    const toStore = {
      ...data,
      chainId: process.env.NEXT_PUBLIC_MACI_ADDRESS || '',
      ...(lastVote && { lastVote }),
    };
    localStorage.setItem(`voter-key-${id}`, JSON.stringify(toStore));
    setKeyData(data);
  };

  const ensureGas = async () => {
    if (!address) return;
    await fetch('/api/faucet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address }),
    });
  };

  const parseStateIndex = (receipt: any, maciAddress: string): number => {
    const signUpLog = receipt.logs.find((log: any) =>
      log.topics.length >= 2 && log.address.toLowerCase() === maciAddress.toLowerCase()
    );
    if (signUpLog && signUpLog.data.length >= 66) {
      return Number(BigInt('0x' + signUpLog.data.substring(2, 66)));
    }
    return 1;
  };

  const handleSignup = async () => {
    if (!isConnected || !address) {
      setError('Please connect your wallet first');
      return;
    }

    try {
      setSignupLoading(true);
      setError(null);

      const res = await fetch('/api/vote/keygen', { method: 'POST' });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Key generation failed');

      const newKeyData: VoterKeyData = {
        pubKey: data.keypair.pubKey,
        privKey: data.keypair.privKey,
        stateIndex: data.stateIndex,
        nonce: 1,
      };
      saveKeyData(newKeyData);
      setIsSignedUp(true);
      setSuccess('Signup complete (via relayer)');
      setTimeout(() => setSuccess(null), 5000);
    } catch (relayerErr) {
      console.warn('Relayer signup failed, trying MetaMask:', relayerErr);
      try {
        setError(null);
        setSuccess('Relayer unavailable. Submitting via MetaMask...');

        const res = await fetch('/api/vote/keygen', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ submit: false }),
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'Key generation failed');

        await ensureGas();

        const maciAddress = data.maciAddress as `0x${string}`;
        const hash = await writeContract(wagmiConfig, {
          address: maciAddress,
          abi: MACI_ABI,
          functionName: 'signUp',
          args: [
            { x: BigInt(data.pubKeyParam.x), y: BigInt(data.pubKeyParam.y) },
            '0x',
            '0x',
          ],
        } as any);

        const receipt = await waitForTransactionReceipt(wagmiConfig, { hash });
        const stateIndex = parseStateIndex(receipt, maciAddress);

        const newKeyData: VoterKeyData = {
          pubKey: data.keypair.pubKey,
          privKey: data.keypair.privKey,
          stateIndex,
          nonce: 1,
        };
        saveKeyData(newKeyData);
        setIsSignedUp(true);
        setSuccess(`Signup complete (via MetaMask). Tx: ${hash.slice(0, 18)}...`);
        setTimeout(() => setSuccess(null), 8000);
      } catch (directErr) {
        setError(directErr instanceof Error ? directErr.message : 'Direct signup failed');
      }
    } finally {
      setSignupLoading(false);
    }
  };

  const handleVote = async () => {
    if (!selectedVote || !keyData) return;

    const votePayload = {
      pollId: Number(id),
      voterKey: { pubKey: keyData.pubKey, privKey: keyData.privKey },
      voteOption: selectedVote === 'yes' ? 1 : 0,
      stateIndex: keyData.stateIndex,
      nonce: keyData.nonce,
    };

    try {
      setVoteLoading(true);
      setError(null);

      const res = await fetch('/api/vote/encrypt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(votePayload),
      });

      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Vote encryption failed');

      completeVote(data.txHash);
    } catch (relayerErr) {
      console.warn('Relayer vote failed, trying MetaMask:', relayerErr);
      try {
        setError(null);
        setSuccess('Relayer unavailable. Submitting via MetaMask...');

        const res = await fetch('/api/vote/encrypt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...votePayload, submit: false }),
        });

        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'Vote encryption failed');

        await ensureGas();

        const pollAddress = data.pollAddress as `0x${string}`;
        const hash = await writeContract(wagmiConfig, {
          address: pollAddress,
          abi: POLL_ABI,
          functionName: 'publishMessage',
          args: [
            { data: data.messageData.map((d: string) => BigInt(d)) },
            { x: BigInt(data.encPubKey.x), y: BigInt(data.encPubKey.y) },
          ],
        } as any);

        await waitForTransactionReceipt(wagmiConfig, { hash });
        completeVote(hash, true);
      } catch (directErr) {
        setError(directErr instanceof Error ? directErr.message : 'Direct vote failed');
        setSuccess(null);
      }
    } finally {
      setVoteLoading(false);
    }
  };

  const completeVote = (txHash?: string, viaMM = false) => {
    if (!keyData || !selectedVote) return;
    const updated = { ...keyData, nonce: keyData.nonce + 1 };
    const voteLabel = selectedVote === 'yes' ? 'Yes' : 'No';
    saveKeyData(updated, voteLabel);
    setHasVoted(true);
    setLastVoteChoice(voteLabel);
    const method = viaMM ? 'MetaMask' : 'relayer';
    setSuccess(hasVoted
      ? `Re-vote (${voteLabel}) submitted via ${method}. Tx: ${txHash?.slice(0, 18)}...`
      : `Vote (${voteLabel}) submitted via ${method}. Tx: ${txHash?.slice(0, 18)}...`);
    setSelectedVote(null);
    setTimeout(() => setSuccess(null), 10000);
  };

  const handleKeyChange = async () => {
    if (!keyData) return;

    try {
      setKeyChangeLoading(true);
      setError(null);

      const keygenRes = await fetch('/api/vote/keygen-only', { method: 'POST' });
      const keygenData = await keygenRes.json();
      if (!keygenData.success) throw new Error(keygenData.error || 'Key generation failed');

      const encryptPayload = {
        pollId: Number(id),
        voterKey: { pubKey: keyData.pubKey, privKey: keyData.privKey },
        voteOption: 0,
        stateIndex: keyData.stateIndex,
        nonce: keyData.nonce,
        newPubKey: keygenData.keypair.pubKey,
        newPrivKey: keygenData.keypair.privKey,
      };

      try {
        const res = await fetch('/api/vote/encrypt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(encryptPayload),
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'Key change failed');

        completeKeyChange(keygenData.keypair);
        return;
      } catch (relayerErr) {
        console.warn('Relayer key change failed, trying MetaMask:', relayerErr);
      }

      setSuccess('Relayer unavailable. Submitting key change via MetaMask...');
      const res = await fetch('/api/vote/encrypt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...encryptPayload, submit: false }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Key change encryption failed');

      await ensureGas();

      const pollAddress = data.pollAddress as `0x${string}`;
      const hash = await writeContract(wagmiConfig, {
        address: pollAddress,
        abi: POLL_ABI,
        functionName: 'publishMessage',
        args: [
          { data: data.messageData.map((d: string) => BigInt(d)) },
          { x: BigInt(data.encPubKey.x), y: BigInt(data.encPubKey.y) },
        ],
      } as any);
      await waitForTransactionReceipt(wagmiConfig, { hash });

      completeKeyChange(keygenData.keypair, true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Key change failed');
      setSuccess(null);
    } finally {
      setKeyChangeLoading(false);
    }
  };

  const completeKeyChange = (newKeypair: { pubKey: string; privKey: string }, viaMM = false) => {
    if (!keyData) return;
    const updated: VoterKeyData = {
      pubKey: newKeypair.pubKey,
      privKey: newKeypair.privKey,
      stateIndex: keyData.stateIndex,
      nonce: keyData.nonce + 1,
    };
    saveKeyData(updated);
    const method = viaMM ? 'MetaMask' : 'relayer';
    setSuccess(`Key changed via ${method}. Your old key is now invalid. Please re-vote.`);
    setHasVoted(false);
    setTimeout(() => setSuccess(null), 8000);
  };

  const stepStatus = (done: boolean) =>
    done
      ? 'bg-carbon-support-success/20 text-carbon-support-success'
      : 'bg-carbon-layer-2 text-carbon-text-disabled';

  return (
    <Layout>
      <div className="max-w-lg mx-auto">
        <Link href="/" className="text-sm text-carbon-text-helper hover:text-carbon-text-secondary transition-colors mb-6 inline-block">
          &larr; Elections
        </Link>

        <h1 className="text-heading font-semibold text-carbon-text-primary mb-1">Election #{id}</h1>
        <p className="text-sm text-carbon-text-helper mb-8">
          Cast your vote privately using MACI encryption.
        </p>

        {(error || success) && (
          <div className={`mb-6 px-4 py-3 text-sm border-l-2 ${
            success
              ? 'bg-carbon-support-success/10 text-carbon-support-success border-carbon-support-success'
              : 'bg-carbon-support-error/10 text-carbon-support-error-light border-carbon-support-error'
          }`}>
            {success || error}
          </div>
        )}

        {/* Step 1: Connect Wallet */}
        <div className="carbon-card p-5 mb-3">
          <div className="flex items-center gap-3 mb-2">
            <div className={`w-5 h-5 flex items-center justify-center text-2xs font-medium ${stepStatus(isConnected)}`}>1</div>
            <h3 className="text-sm font-medium text-carbon-text-primary">Connect Wallet</h3>
          </div>
          <p className="text-xs text-carbon-text-helper ml-8">
            {isConnected
              ? <span className="font-mono text-carbon-text-secondary">{address?.slice(0, 6)}...{address?.slice(-4)}</span>
              : 'Use the Connect button in the header'}
          </p>
        </div>

        {/* Step 2: MACI Signup */}
        <div className="carbon-card p-5 mb-3">
          <div className="flex items-center gap-3 mb-2">
            <div className={`w-5 h-5 flex items-center justify-center text-2xs font-medium ${stepStatus(isSignedUp)}`}>2</div>
            <h3 className="text-sm font-medium text-carbon-text-primary">MACI Signup</h3>
          </div>
          {isSignedUp ? (
            <div className="ml-8">
              <p className="text-xs text-carbon-support-success mb-2">
                Signed up (state: {keyData?.stateIndex}, msgs: {(keyData?.nonce || 1) - 1})
              </p>
              <button
                onClick={handleKeyChange}
                disabled={keyChangeLoading}
                className="carbon-btn-ghost text-xs px-3 py-1.5"
              >
                {keyChangeLoading ? 'Changing...' : 'Change Key'}
              </button>
              <p className="text-xs text-carbon-text-disabled mt-1">
                If coerced, change your key to invalidate votes the coercer observed.
              </p>
            </div>
          ) : (
            <div className="ml-8">
              <p className="text-xs text-carbon-text-helper mb-3">
                Generate a MACI keypair for private voting. Stored locally in your browser.
              </p>
              <button
                onClick={handleSignup}
                disabled={!isConnected || signupLoading}
                className="carbon-btn-primary text-xs"
              >
                {signupLoading ? 'Signing up...' : 'Generate Key & Sign Up'}
              </button>
            </div>
          )}
        </div>

        {/* Step 3: Vote */}
        <div className="carbon-card p-5">
          <div className="flex items-center gap-3 mb-2">
            <div className={`w-5 h-5 flex items-center justify-center text-2xs font-medium ${
              hasVoted ? stepStatus(true) : selectedVote ? 'bg-carbon-interactive/20 text-carbon-interactive' : stepStatus(false)
            }`}>3</div>
            <h3 className="text-sm font-medium text-carbon-text-primary">
              {hasVoted ? 'Change Vote' : 'Cast Vote'}
            </h3>
            {hasVoted && lastVoteChoice && (
              <span className="carbon-tag bg-carbon-layer-2 text-carbon-text-helper">
                Current: {lastVoteChoice}
              </span>
            )}
          </div>
          {hasVoted && (
            <p className="text-xs text-carbon-text-disabled ml-8 mb-3">
              You can re-vote anytime before tallying. Only the last valid vote counts.
            </p>
          )}
          <div className="ml-8">
            <div className="flex gap-3 mb-4">
              <button
                onClick={() => setSelectedVote('yes')}
                className={`flex-1 py-3 text-sm font-medium transition-colors border ${
                  selectedVote === 'yes'
                    ? 'bg-carbon-support-success/15 text-carbon-support-success border-carbon-support-success/40'
                    : 'bg-carbon-layer-2 text-carbon-text-helper border-carbon-border hover:border-carbon-text-disabled'
                }`}
              >
                Yes / For
              </button>
              <button
                onClick={() => setSelectedVote('no')}
                className={`flex-1 py-3 text-sm font-medium transition-colors border ${
                  selectedVote === 'no'
                    ? 'bg-carbon-support-error/15 text-carbon-support-error-light border-carbon-support-error/40'
                    : 'bg-carbon-layer-2 text-carbon-text-helper border-carbon-border hover:border-carbon-text-disabled'
                }`}
              >
                No / Against
              </button>
            </div>
            <button
              onClick={handleVote}
              disabled={!selectedVote || !isSignedUp || voteLoading}
              className="carbon-btn-primary w-full"
            >
              {voteLoading ? 'Encrypting & Submitting...' : hasVoted ? 'Submit Re-Vote' : 'Submit Encrypted Vote'}
            </button>
            <p className="text-xs text-carbon-text-disabled mt-2">
              Encrypted with MACI. Submitted via relayer, falls back to MetaMask.
            </p>
          </div>
        </div>
      </div>
    </Layout>
  );
}
