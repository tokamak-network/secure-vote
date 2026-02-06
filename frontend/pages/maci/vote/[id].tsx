import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { usePublicClient, useWalletClient, useAccount } from 'wagmi';
import Layout from '@/components/Layout';
import Link from 'next/link';
import { MACI_VOTING_ABI, getMACIContractAddress } from '@/lib/contracts';
import type { SerializedVoterKey } from '@/lib/crypto-wrapper';

type Proposal = {
  description: string;
  signupEndTime: bigint;
  votingEndTime: bigint;
  coordinatorId: bigint;
  finalized: boolean;
};

const VOTER_KEY_STORAGE_PREFIX = 'maci_voter_key_';

export default function MACIVotePage() {
  const router = useRouter();
  const { id } = router.query;
  const proposalId = id ? BigInt(id as string) : undefined;

  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [coordinatorPubKey, setCoordinatorPubKey] = useState<string | null>(null);
  const [voterKey, setVoterKey] = useState<SerializedVoterKey | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [generatingKey, setGeneratingKey] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [blockTime, setBlockTime] = useState<bigint>(0n);
  const [selectedChoice, setSelectedChoice] = useState<0 | 1 | null>(null);

  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const { address, isConnected } = useAccount();

  useEffect(() => {
    if (typeof window !== 'undefined' && proposalId !== undefined && address) {
      const storageKey = `${VOTER_KEY_STORAGE_PREFIX}${proposalId}_${address}`;
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        try {
          setVoterKey(JSON.parse(stored));
        } catch (e) {
          console.error('Failed to parse stored key:', e);
        }
      }
    }
  }, [proposalId, address]);

  useEffect(() => {
    if (!publicClient || proposalId === undefined) return;

    const loadProposal = async () => {
      try {
        setLoading(true);
        const contractAddress = getMACIContractAddress();
        const block = await publicClient.getBlock();
        setBlockTime(block.timestamp);

        const data = await publicClient.readContract({
          address: contractAddress,
          abi: MACI_VOTING_ABI,
          functionName: 'proposals',
          args: [proposalId],
        }) as [string, bigint, bigint, bigint, bigint, boolean];

        setProposal({
          description: data[0],
          signupEndTime: data[2],
          votingEndTime: data[3],
          coordinatorId: data[4],
          finalized: data[5],
        });

        const pubKey = await publicClient.readContract({
          address: contractAddress,
          abi: MACI_VOTING_ABI,
          functionName: 'getProposalCoordinatorPublicKey',
          args: [proposalId],
        }) as `0x${string}`;

        setCoordinatorPubKey(pubKey.slice(2));
      } catch (err) {
        console.error('Error loading proposal:', err);
        setError('Failed to load proposal');
      } finally {
        setLoading(false);
      }
    };

    loadProposal();
  }, [publicClient, proposalId]);

  const generateKey = async () => {
    if (!address || proposalId === undefined) return;

    try {
      setGeneratingKey(true);
      setError(null);
      const nonce = voterKey ? voterKey.nonce + 1 : 0;

      const response = await fetch('/api/maci/generate-voter-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nonce }),
      });

      const data = await response.json();
      if (!data.success) throw new Error(data.error || 'Failed to generate key');

      const newKey = data.keyPair as SerializedVoterKey;
      setVoterKey(newKey);

      const storageKey = `${VOTER_KEY_STORAGE_PREFIX}${proposalId}_${address}`;
      localStorage.setItem(storageKey, JSON.stringify(newKey));

      setSuccess(nonce === 0 ? 'Key generated' : 'Key changed');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate key');
    } finally {
      setGeneratingKey(false);
    }
  };

  const submitVote = async () => {
    if (!walletClient || !publicClient || proposalId === undefined || !voterKey || !coordinatorPubKey || selectedChoice === null) {
      setError('Missing required data');
      return;
    }

    try {
      setSubmitting(true);
      setError(null);

      const contractAddress = getMACIContractAddress();

      const encryptResponse = await fetch('/api/maci/encrypt-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          voterKey,
          coordinatorPubKey,
          vote: selectedChoice,
        }),
      });

      const encryptData = await encryptResponse.json();
      if (!encryptData.success) throw new Error(encryptData.error || 'Failed to encrypt');

      const { message } = encryptData;

      const hash = await walletClient.writeContract({
        address: contractAddress,
        abi: MACI_VOTING_ABI,
        functionName: 'submitMessage',
        args: [
          proposalId,
          `0x${message.voterPubKey}`,
          `0x${message.encryptedData}`,
          `0x${message.ephemeralPubKey}`,
        ],
      });

      await publicClient.waitForTransactionReceipt({ hash });

      setSuccess('Vote submitted');
      setTimeout(() => router.push('/maci'), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit vote');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <Layout>
        <div className="py-20 text-center text-[#606060]">Loading...</div>
      </Layout>
    );
  }

  if (!proposal) {
    return (
      <Layout>
        <div className="py-20 text-center text-[#606060]">Proposal not found</div>
      </Layout>
    );
  }

  const canVote = blockTime < proposal.votingEndTime && !proposal.finalized;

  return (
    <Layout>
      <div className="max-w-[580px] mx-auto">
        <Link href="/maci" className="text-[#606060] text-sm hover:text-white mb-6 inline-block">
          &larr; Back
        </Link>

        <h1 className="text-2xl font-semibold text-white mb-6">{proposal.description}</h1>

        {(success || error) && (
          <div className={`mb-4 px-4 py-3 rounded-lg text-sm ${
            success ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
          }`}>
            {success || error}
          </div>
        )}

        {!isConnected && (
          <div className="mb-6 px-4 py-3 rounded-lg bg-yellow-500/10 text-yellow-400 text-sm">
            Connect wallet to vote
          </div>
        )}

        {/* Choices */}
        {canVote && (
          <div className="border border-white/[0.06] rounded-[16px] bg-[#1c1c1f] mb-6">
            <div className="px-4 py-3 border-b border-white/[0.06]">
              <span className="text-sm text-[#606060]">Cast your vote</span>
            </div>
            <div className="p-4 space-y-2">
              <button
                onClick={() => setSelectedChoice(1)}
                disabled={!voterKey}
                className={`w-full px-4 py-3 rounded-lg text-left transition-colors ${
                  selectedChoice === 1
                    ? 'bg-[#384aff] text-white'
                    : 'border border-white/[0.06] text-white hover:border-white/20'
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                For
              </button>
              <button
                onClick={() => setSelectedChoice(0)}
                disabled={!voterKey}
                className={`w-full px-4 py-3 rounded-lg text-left transition-colors ${
                  selectedChoice === 0
                    ? 'bg-[#384aff] text-white'
                    : 'border border-white/[0.06] text-white hover:border-white/20'
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                Against
              </button>
            </div>
            <div className="px-4 pb-4">
              <button
                onClick={submitVote}
                disabled={submitting || !isConnected || selectedChoice === null || !voterKey}
                className="w-full py-3 bg-[#384aff] text-white rounded-full hover:bg-[#4857ff] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? 'Submitting...' : 'Vote'}
              </button>
            </div>
          </div>
        )}

        {/* Key Management */}
        <div className="border border-white/[0.06] rounded-[16px] bg-[#1c1c1f]">
          <div className="px-4 py-3 border-b border-white/[0.06]">
            <span className="text-sm text-[#606060]">Voter key</span>
          </div>
          <div className="p-4">
            {voterKey ? (
              <div className="space-y-4">
                <div className="text-sm">
                  <span className="text-[#606060]">Public key: </span>
                  <span className="text-white font-mono text-xs">
                    {voterKey.publicKey.x.slice(0, 12)}...
                  </span>
                </div>
                <div className="text-sm">
                  <span className="text-[#606060]">Nonce: </span>
                  <span className="text-white">{voterKey.nonce}</span>
                </div>
                <button
                  onClick={generateKey}
                  disabled={generatingKey || !isConnected}
                  className="w-full py-2 text-sm border border-white/20 rounded-full text-white hover:border-white/40 disabled:opacity-50"
                >
                  {generatingKey ? 'Generating...' : 'Change key'}
                </button>
                <p className="text-xs text-[#606060]">
                  Change your key to invalidate previous votes (anti-bribery)
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-[#606060]">
                  Generate a key to vote. Keys are stored in your browser.
                </p>
                <button
                  onClick={generateKey}
                  disabled={generatingKey || !isConnected}
                  className="w-full py-2 bg-[#384aff] text-white rounded-full hover:bg-[#4857ff] disabled:opacity-50"
                >
                  {generatingKey ? 'Generating...' : 'Generate key'}
                </button>
              </div>
            )}
          </div>
        </div>

        {!canVote && (
          <div className="mt-6 text-center text-[#606060]">
            {proposal.finalized ? 'Voting has ended' : 'Voting period ended'}
          </div>
        )}
      </div>
    </Layout>
  );
}
