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

  const StepIcon = ({ step, done, active }: { step: number; done: boolean; active: boolean }) => (
    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
      done ? 'bg-sv-emerald/20 text-sv-emerald border border-sv-emerald/40' :
      active ? 'bg-sv-accent/20 text-sv-accent border border-sv-accent/40' :
      'bg-sv-surface-2 text-sv-text-disabled border border-sv-border-subtle'
    }`}>
      {done ? (
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
        </svg>
      ) : step}
    </div>
  );

  return (
    <Layout>
      <div className="max-w-lg mx-auto">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-sv-text-muted hover:text-sv-accent transition-colors mb-8">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Elections
        </Link>

        <h1 className="text-heading font-bold text-sv-text-primary mb-1">Election #{id}</h1>
        <p className="text-sm text-sv-text-muted mb-10">
          Cast your vote privately using MACI encryption.
        </p>

        {(error || success) && (
          <div className={`mb-8 px-5 py-4 text-sm rounded-lg border flex items-start gap-3 ${
            success
              ? 'bg-sv-emerald/10 text-sv-emerald border-sv-emerald/20'
              : 'bg-sv-error/10 text-sv-error-light border-sv-error/20'
          }`}>
            <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              {success ? (
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              ) : (
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              )}
            </svg>
            {success || error}
          </div>
        )}

        {/* Step 1: Connect Wallet */}
        <div className="relative">
          <div className="sv-card p-5 mb-2">
            <div className="flex items-center gap-4 mb-2">
              <StepIcon step={1} done={isConnected} active={false} />
              <h3 className="text-sm font-semibold text-sv-text-primary">Connect Wallet</h3>
            </div>
            <p className="text-xs text-sv-text-muted ml-12">
              {isConnected
                ? <span className="font-mono text-sv-text-secondary">{address?.slice(0, 6)}...{address?.slice(-4)}</span>
                : 'Use the Connect button in the header'}
            </p>
          </div>

          {/* Connector line */}
          <div className="absolute left-[2.1rem] top-[4.5rem] w-px h-4 bg-sv-border-subtle" />

          {/* Step 2: MACI Signup */}
          <div className="sv-card p-5 mb-2 mt-2">
            <div className="flex items-center gap-4 mb-2">
              <StepIcon step={2} done={isSignedUp} active={!isSignedUp && isConnected} />
              <h3 className="text-sm font-semibold text-sv-text-primary">MACI Signup</h3>
            </div>
            {isSignedUp ? (
              <div className="ml-12">
                <p className="text-xs text-sv-emerald mb-3">
                  Signed up (state: {keyData?.stateIndex}, msgs: {(keyData?.nonce || 1) - 1})
                </p>
                <button
                  onClick={handleKeyChange}
                  disabled={keyChangeLoading}
                  className="sv-btn-ghost text-xs px-3 py-1.5"
                >
                  {keyChangeLoading ? 'Changing...' : 'Change Key'}
                </button>
                <p className="text-xs text-sv-text-disabled mt-2">
                  If coerced, change your key to invalidate votes the coercer observed.
                </p>
              </div>
            ) : (
              <div className="ml-12">
                <p className="text-xs text-sv-text-muted mb-4">
                  Generate a MACI keypair for private voting. Stored locally in your browser.
                </p>
                <button
                  onClick={handleSignup}
                  disabled={!isConnected || signupLoading}
                  className="sv-btn-primary text-xs"
                >
                  {signupLoading ? 'Signing up...' : 'Generate Key & Sign Up'}
                </button>
              </div>
            )}
          </div>

          {/* Connector line */}
          <div className="absolute left-[2.1rem] bottom-[calc(100%-10.5rem)] w-px h-4 bg-sv-border-subtle" style={{ display: 'none' }} />

          {/* Step 3: Vote */}
          <div className="sv-card p-5 mt-2">
            <div className="flex items-center gap-4 mb-2">
              <StepIcon step={3} done={hasVoted} active={!hasVoted && isSignedUp} />
              <h3 className="text-sm font-semibold text-sv-text-primary">
                {hasVoted ? 'Change Vote' : 'Cast Vote'}
              </h3>
              {hasVoted && lastVoteChoice && (
                <span className="sv-tag bg-sv-surface-2 text-sv-text-muted">
                  Current: {lastVoteChoice}
                </span>
              )}
            </div>
            {hasVoted && (
              <p className="text-xs text-sv-text-disabled ml-12 mb-3">
                You can re-vote anytime before tallying. Only the last valid vote counts.
              </p>
            )}
            <div className="ml-12">
              <div className="flex gap-3 mb-4">
                <button
                  onClick={() => setSelectedVote('yes')}
                  className={`flex-1 py-4 text-sm font-semibold rounded-lg transition-all border ${
                    selectedVote === 'yes'
                      ? 'bg-sv-emerald/15 text-sv-emerald border-sv-emerald/40 shadow-glow-emerald'
                      : 'bg-sv-surface-2 text-sv-text-muted border-sv-border-subtle hover:border-sv-border hover:text-sv-text-secondary'
                  }`}
                >
                  Yes / For
                </button>
                <button
                  onClick={() => setSelectedVote('no')}
                  className={`flex-1 py-4 text-sm font-semibold rounded-lg transition-all border ${
                    selectedVote === 'no'
                      ? 'bg-sv-error/15 text-sv-error-light border-sv-error/40 shadow-glow-error'
                      : 'bg-sv-surface-2 text-sv-text-muted border-sv-border-subtle hover:border-sv-border hover:text-sv-text-secondary'
                  }`}
                >
                  No / Against
                </button>
              </div>
              <button
                onClick={handleVote}
                disabled={!selectedVote || !isSignedUp || voteLoading}
                className="sv-btn-primary w-full"
              >
                {voteLoading ? 'Encrypting & Submitting...' : hasVoted ? 'Submit Re-Vote' : 'Submit Encrypted Vote'}
              </button>
              <p className="text-xs text-sv-text-disabled mt-3">
                Encrypted with MACI. Submitted via relayer, falls back to MetaMask.
              </p>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
