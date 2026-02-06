import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { usePublicClient, useWalletClient, useAccount } from 'wagmi';
import Layout from '@/components/Layout';
import { VOTING_ABI, getContractAddress } from '@/lib/contracts';

type Proposal = {
  description: string;
  commitDeadline: bigint;
  finalized: boolean;
};

export default function VotePage() {
  const router = useRouter();
  const { id } = router.query;
  const proposalId = id ? BigInt(id as string) : undefined;

  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [loading, setLoading] = useState(true);
  const [voting, setVoting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const { isConnected } = useAccount();

  useEffect(() => {
    if (!publicClient || proposalId === undefined) return;

    const loadProposal = async () => {
      try {
        setLoading(true);
        const contractAddress = getContractAddress();

        const data = await publicClient.readContract({
          address: contractAddress,
          abi: VOTING_ABI,
          functionName: 'proposals',
          args: [proposalId],
        });

        // [description, committeeId, createdAt, commitEndTime, revealEndTime, finalized]
        setProposal({
          description: data[0] as string,
          commitDeadline: data[3] as bigint,
          finalized: data[5] as boolean,
        });
      } catch (err) {
        console.error('Error loading proposal:', err);
        setError('Failed to load proposal');
      } finally {
        setLoading(false);
      }
    };

    loadProposal();
  }, [publicClient, proposalId]);

  const handleVote = async (vote: 0n | 1n) => {
    if (!walletClient || !publicClient || proposalId === undefined) {
      setError('Wallet not connected');
      return;
    }

    try {
      setVoting(true);
      setError(null);

      const contractAddress = getContractAddress();

      // Encrypt vote via server API (avoids library instance issues)
      console.log('Encrypting vote...');
      const encryptResponse = await fetch('/api/encrypt-vote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vote: Number(vote) }),
      });

      if (!encryptResponse.ok) {
        const errorData = await encryptResponse.json();
        throw new Error(errorData.error || 'Failed to encrypt vote');
      }

      const { ciphertext } = await encryptResponse.json();

      console.log('Submitting vote to contract...');
      const hash = await walletClient.writeContract({
        address: contractAddress,
        abi: VOTING_ABI,
        functionName: 'commitVote',
        args: [proposalId, ciphertext],
      });

      console.log('Waiting for confirmation...');
      await publicClient.waitForTransactionReceipt({ hash });

      setSuccess(true);
      setTimeout(() => {
        router.push('/');
      }, 2000);
    } catch (err) {
      console.error('Vote error:', err);
      setError(err instanceof Error ? err.message : 'Failed to submit vote');
    } finally {
      setVoting(false);
    }
  };

  if (loading) {
    return (
      <Layout>
        <div className="text-center py-12">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 dark:border-white"></div>
          <p className="mt-2 text-gray-600 dark:text-gray-400">Loading proposal...</p>
        </div>
      </Layout>
    );
  }

  if (!proposal) {
    return (
      <Layout>
        <div className="text-center py-12">
          <p className="text-red-600 dark:text-red-400">Proposal not found</p>
        </div>
      </Layout>
    );
  }

  const isVotingOpen = () => {
    const now = BigInt(Math.floor(Date.now() / 1000));
    return now < proposal.commitDeadline && !proposal.finalized;
  };

  return (
    <Layout>
      <div className="max-w-2xl mx-auto">
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-8">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
            {proposal.description}
          </h1>

          {!isConnected && (
            <div className="bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-800 text-yellow-800 dark:text-yellow-300 px-4 py-3 rounded mb-6">
              Please connect your wallet to vote
            </div>
          )}

          {error && (
            <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-3 rounded mb-6">
              {error}
            </div>
          )}

          {success && (
            <div className="bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-400 px-4 py-3 rounded mb-6">
              Vote submitted successfully! Redirecting...
            </div>
          )}

          {isVotingOpen() && !success ? (
            <div className="space-y-4">
              <p className="text-gray-600 dark:text-gray-400 mb-4">Cast your vote:</p>
              <div className="grid grid-cols-2 gap-4">
                <button
                  onClick={() => handleVote(1n)}
                  disabled={voting || !isConnected}
                  className="bg-green-600 text-white px-6 py-4 rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-lg font-semibold"
                >
                  {voting ? 'Voting...' : 'Yes'}
                </button>
                <button
                  onClick={() => handleVote(0n)}
                  disabled={voting || !isConnected}
                  className="bg-red-600 text-white px-6 py-4 rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-lg font-semibold"
                >
                  {voting ? 'Voting...' : 'No'}
                </button>
              </div>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-4">
                Your vote will be encrypted before submission. Only the committee can decrypt the final tally.
              </p>
            </div>
          ) : (
            <div className="text-center py-8">
              <p className="text-gray-600 dark:text-gray-400">
                {proposal.finalized ? 'Voting has ended and been tallied' : 'Voting is closed'}
              </p>
              <button
                onClick={() => router.push('/')}
                className="mt-4 text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
              >
                ← Back to proposals
              </button>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
