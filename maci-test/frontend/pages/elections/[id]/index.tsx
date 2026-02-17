import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { useAccount, usePublicClient } from 'wagmi';
import { writeContract, waitForTransactionReceipt } from '@wagmi/core';
import { wagmiConfig } from '@/lib/wagmi-config';
import { MACI_ABI, POLL_ABI, MACI_RLA_ABI } from '@/lib/contracts';
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
  const [rlaPollId, setRlaPollId] = useState<number | null>(null);

  // Load RLA Poll ID for results link
  useEffect(() => {
    if (id !== undefined && publicClient) {
      loadRlaPollId();
    }
  }, [id, publicClient]);

  const loadRlaPollId = async () => {
    if (!publicClient || id === undefined) return;
    try {
      const maciAddress = process.env.NEXT_PUBLIC_MACI_ADDRESS as `0x${string}`;
      const maciRlaAddress = process.env.NEXT_PUBLIC_MACI_RLA_ADDRESS as `0x${string}`;
      if (!maciAddress || !maciRlaAddress) return;

      // Get poll address
      const pollInfo = await publicClient.readContract({
        address: maciAddress,
        abi: MACI_ABI,
        functionName: 'getPoll',
        args: [BigInt(id as string)],
      } as any) as any;
      const pollAddress = pollInfo[0] || pollInfo.poll;

      // Get RLA Poll ID
      const rlaId = await publicClient.readContract({
        address: maciRlaAddress,
        abi: MACI_RLA_ABI,
        functionName: 'pollToAuditId',
        args: [pollAddress as `0x${string}`],
      } as any) as bigint;

      if (rlaId > 0n) {
        setRlaPollId(Number(rlaId));
      }
    } catch {}
  };

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


  return (
    <Layout>
      <div className="max-w-2xl mx-auto">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-accent-blue transition-colors mb-8">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back to Elections
        </Link>

        <header className="mb-12">
          <div className="flex items-end justify-between">
            <div>
              <h1 className="text-4xl font-light text-white tracking-tight mb-2">Election #{id}</h1>
              <p className="text-base text-zinc-500">
                MACI-encrypted voting with zero-knowledge proofs
              </p>
            </div>
            {rlaPollId !== null && (
              <Link
                href={`/elections/${rlaPollId}/results`}
                className="text-sm text-accent-blue hover:text-blue-400 transition-colors"
              >
                View Results →
              </Link>
            )}
          </div>
        </header>

        {(error || success) && (
          <div className={`mb-8 px-5 py-4 text-sm border flex items-start gap-3 ${
            success
              ? 'bg-emerald-950/20 text-emerald-400 border-emerald-500/20'
              : 'bg-rose-950/20 text-rose-400 border-rose-500/20'
          }`}>
            {success || error}
          </div>
        )}

        {/* Vertical Timeline */}
        <section className="space-y-0 relative">
          {/* Step 1: Wallet */}
          <div className="relative pl-8 pb-10 before:absolute before:left-[7px] before:top-[20px] before:bottom-0 before:w-px before:bg-border-dark">
            <div className={`absolute left-0 top-1 w-4 h-4 rounded-full flex items-center justify-center z-10 ring-4 ring-background-dark ${
              isConnected ? 'bg-primary' : 'border-2 border-zinc-600 bg-background-dark'
            }`}>
              {isConnected && (
                <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              )}
            </div>
            <div className="flex flex-col">
              <span className="text-[11px] font-bold uppercase tracking-widest-custom text-zinc-500 mb-2">Wallet</span>
              {isConnected ? (
                <div className="flex items-center justify-between p-3 border border-border-dark bg-surface-dark/50">
                  <span className="font-mono text-sm text-zinc-300">{address?.slice(0, 6)}...{address?.slice(-4)}</span>
                  <span className="text-xs text-emerald-500 font-medium">Connected</span>
                </div>
              ) : (
                <p className="text-sm text-zinc-500">Use the Connect button in the header</p>
              )}
            </div>
          </div>

          {/* Step 2: Registration */}
          <div className="relative pl-8 pb-10 before:absolute before:left-[7px] before:top-[20px] before:bottom-0 before:w-px before:bg-border-dark">
            <div className={`absolute left-0 top-1 w-4 h-4 rounded-full flex items-center justify-center z-10 ring-4 ring-background-dark ${
              isSignedUp ? 'bg-primary' : 'border-2 border-zinc-600 bg-background-dark'
            }`}>
              {isSignedUp && (
                <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              )}
            </div>
            <div className="flex flex-col">
              <span className="text-[11px] font-bold uppercase tracking-widest-custom text-zinc-500 mb-2">Registration</span>
              {isSignedUp ? (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-sm text-white font-medium">Eligible & Registered</span>
                    <span className="text-xs text-zinc-600">State #{keyData?.stateIndex}</span>
                  </div>
                  <button
                    onClick={handleKeyChange}
                    disabled={keyChangeLoading}
                    className="text-sm text-accent-blue hover:text-blue-400 disabled:opacity-50 transition-colors"
                  >
                    {keyChangeLoading ? 'Changing key...' : 'Change Key'}
                  </button>
                </div>
              ) : (
                <div>
                  <p className="text-sm text-zinc-500 mb-4">
                    Generate a MACI keypair for private voting. Stored locally in your browser.
                  </p>
                  <button
                    onClick={handleSignup}
                    disabled={!isConnected || signupLoading}
                    className="bg-accent-blue text-white px-5 py-2.5 text-sm font-medium hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {signupLoading ? 'Signing up...' : 'Generate Key & Sign Up'}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Step 3: Vote */}
          <div className="relative pl-8">
            <div className={`absolute left-0 top-1 w-4 h-4 rounded-full flex items-center justify-center z-10 ring-4 ring-background-dark ${
              hasVoted ? 'bg-primary' : isSignedUp ? 'border-2 border-white bg-transparent' : 'border-2 border-zinc-600 bg-background-dark'
            }`}>
              {hasVoted ? (
                <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              ) : isSignedUp && (
                <div className="w-1.5 h-1.5 bg-white rounded-full animate-pulse"></div>
              )}
            </div>
            <div className="flex flex-col">
              <span className={`text-[11px] font-bold uppercase tracking-widest-custom mb-4 ${isSignedUp ? 'text-white' : 'text-zinc-500'}`}>
                {hasVoted ? 'Change Vote' : 'Vote'}
              </span>
              {hasVoted && lastVoteChoice && (
                <p className="text-xs text-zinc-500 mb-4">Current: {lastVoteChoice} • You can re-vote anytime before tallying</p>
              )}
              <div className="space-y-3 mb-8">
                <button
                  onClick={() => setSelectedVote('yes')}
                  disabled={!isSignedUp}
                  className={`w-full text-left group relative ${!isSignedUp && 'opacity-40 cursor-not-allowed'}`}
                >
                  <div className={`absolute left-0 top-0 bottom-0 w-0.5 z-20 ${selectedVote === 'yes' ? 'bg-white' : 'bg-transparent'}`}></div>
                  <div className={`relative flex items-center justify-between px-5 py-4 border-y border-r transition-all ${
                    selectedVote === 'yes'
                      ? 'bg-surface-dark/50 border-zinc-700'
                      : 'bg-transparent border-border-dark hover:border-zinc-700'
                  }`}>
                    <div>
                      <span className={`block text-lg font-normal mb-0.5 ${selectedVote === 'yes' ? 'text-white' : 'text-zinc-400'}`}>For</span>
                      <span className="block text-xs text-zinc-500">Approve the proposal</span>
                    </div>
                    <div className={`w-5 h-5 rounded-full border flex items-center justify-center ${
                      selectedVote === 'yes' ? 'border-white' : 'border-zinc-600'
                    }`}>
                      {selectedVote === 'yes' && <div className="w-2.5 h-2.5 bg-white rounded-full"></div>}
                    </div>
                  </div>
                </button>

                <button
                  onClick={() => setSelectedVote('no')}
                  disabled={!isSignedUp}
                  className={`w-full text-left group relative ${!isSignedUp ? 'opacity-40 cursor-not-allowed' : 'opacity-60 hover:opacity-100 transition-opacity'}`}
                >
                  <div className={`absolute left-0 top-0 bottom-0 w-0.5 z-20 ${selectedVote === 'no' ? 'bg-white' : 'bg-transparent'}`}></div>
                  <div className={`relative flex items-center justify-between px-5 py-4 border transition-all ${
                    selectedVote === 'no'
                      ? 'border-zinc-700'
                      : 'border-border-dark hover:border-zinc-600'
                  }`}>
                    <div>
                      <span className={`block text-lg font-normal mb-0.5 transition-colors ${
                        selectedVote === 'no' ? 'text-white' : 'text-zinc-400 group-hover:text-zinc-200'
                      }`}>Against</span>
                      <span className="block text-xs text-zinc-600 group-hover:text-zinc-500 transition-colors">Reject the proposal</span>
                    </div>
                    <div className={`w-5 h-5 rounded-full border flex items-center justify-center ${
                      selectedVote === 'no' ? 'border-white' : 'border-zinc-600 group-hover:border-zinc-400'
                    }`}>
                      {selectedVote === 'no' && <div className="w-2.5 h-2.5 bg-white rounded-full"></div>}
                    </div>
                  </div>
                </button>
              </div>

              <button
                onClick={handleVote}
                disabled={!selectedVote || !isSignedUp || voteLoading}
                className="w-full bg-accent-blue hover:bg-blue-600 text-white font-medium py-4 px-6 text-sm tracking-wide transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {voteLoading ? 'Encrypting & Submitting...' : hasVoted ? 'SUBMIT RE-VOTE' : 'SUBMIT VOTE'}
              </button>

              <div className="mt-6 flex items-start gap-2 text-zinc-600">
                <p className="text-[13px] leading-relaxed">
                  Encrypted with MACI (Minimal Anti-Collusion Infrastructure). Your vote is private, tamper-proof, and secured by zero-knowledge proofs.
                </p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </Layout>
  );
}
