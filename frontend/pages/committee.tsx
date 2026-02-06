import { useState, useEffect } from 'react';
import { usePublicClient } from 'wagmi';
import Layout from '@/components/Layout';
import { VOTING_ABI, getContractAddress } from '@/lib/contracts';
import { useRouter } from 'next/router';

type Proposal = {
  id: number;
  description: string;
  createdAt: bigint;
  commitEndTime: bigint;
  finalized: boolean;
  tally?: {
    yesVotes: bigint;
    noVotes: bigint;
  };
};

export default function CommitteePage() {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(false);
  const [decrypting, setDecrypting] = useState<number | null>(null);
  const [skipping, setSkipping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blockTime, setBlockTime] = useState<bigint>(0n);
  const publicClient = usePublicClient();
  const router = useRouter();

  const isVotingOpen = (proposal: Proposal) => {
    if (proposal.tally) return false;
    if (proposal.finalized) return false;
    return blockTime < proposal.commitEndTime;
  };

  const skipTime = async () => {
    try {
      setSkipping(true);
      setError(null);

      const response = await fetch('/api/skip-time', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seconds: 301 }), // 5 min + 1 sec
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to skip time');
      }

      // Reload to update block time
      await loadProposals();
    } catch (err) {
      console.error('Skip time error:', err);
      setError(err instanceof Error ? err.message : 'Failed to skip time');
    } finally {
      setSkipping(false);
    }
  };

  const loadProposals = async () => {
    if (!publicClient) return;

    try {
      setLoading(true);
      setError(null);
      const contractAddress = getContractAddress();

      // Get blockchain time
      const block = await publicClient.getBlock();
      setBlockTime(block.timestamp);

      const count = await publicClient.readContract({
        address: contractAddress,
        abi: VOTING_ABI,
        functionName: 'nextProposalId',
      });

      const proposalsData: Proposal[] = [];

      for (let i = 0; i < Number(count); i++) {
        const proposal = await publicClient.readContract({
          address: contractAddress,
          abi: VOTING_ABI,
          functionName: 'proposals',
          args: [BigInt(i)],
        });

        // Fetch tally if exists
        const tally = await publicClient.readContract({
          address: contractAddress,
          abi: VOTING_ABI,
          functionName: 'tallies',
          args: [BigInt(i)],
        }) as [bigint, bigint, string, bigint, string, boolean, boolean];

        const hasTally = tally[3] > 0n; // submittedAt > 0

        proposalsData.push({
          id: i,
          description: proposal[0] as string,
          createdAt: proposal[2] as bigint,
          commitEndTime: proposal[3] as bigint,
          finalized: proposal[5] as boolean,
          tally: hasTally ? {
            yesVotes: tally[0],
            noVotes: tally[1],
          } : undefined,
        });
      }

      // Show newest first
      setProposals(proposalsData.reverse());
    } catch (err) {
      console.error('Error loading proposals:', err);
      setError(err instanceof Error ? err.message : 'Failed to load proposals');
    } finally {
      setLoading(false);
    }
  };

  const decryptAndTally = async (proposalId: number) => {
    try {
      setDecrypting(proposalId);
      setError(null);

      const response = await fetch('/api/decrypt-tally', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proposalId }),
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Decryption failed');
      }

      // Reload proposals to show updated results
      await loadProposals();
    } catch (err) {
      console.error('Decrypt error:', err);
      setError(err instanceof Error ? err.message : 'Decryption failed');
    } finally {
      setDecrypting(null);
    }
  };

  useEffect(() => {
    loadProposals();
  }, [publicClient]);

  return (
    <Layout>
      <div className="space-y-6">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Committee Dashboard</h1>

        <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-300 px-4 py-3 rounded">
          <div className="flex justify-between items-start">
            <div>
              <p className="font-semibold mb-2">Committee Role:</p>
              <p className="text-sm">
                As a committee member, you can decrypt and tally votes after the voting period ends.
                The decryption happens off-chain using threshold cryptography, and only the final
                tally is submitted to the blockchain.
              </p>
              <p className="text-xs mt-2 text-blue-600 dark:text-blue-400">
                Note: Old proposals created before the last "Setup Demo" cannot be decrypted (different encryption keys).
              </p>
            </div>
            <button
              onClick={skipTime}
              disabled={skipping}
              className="ml-4 bg-orange-500 text-white px-3 py-1 rounded text-sm hover:bg-orange-600 disabled:opacity-50 whitespace-nowrap"
            >
              {skipping ? 'Skipping...' : 'Skip 5min (Demo)'}
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-3 rounded">
            {error}
          </div>
        )}

        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 dark:border-white"></div>
            <p className="mt-2 text-gray-600 dark:text-gray-400">Loading proposals...</p>
          </div>
        ) : proposals.length === 0 ? (
          <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
            <p className="text-gray-600 dark:text-gray-400">No proposals yet.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {proposals.map((proposal) => {
              const votingOpen = isVotingOpen(proposal);
              return (
                <div
                  key={proposal.id}
                  className={`rounded-lg border p-6 ${
                    proposal.finalized
                      ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
                      : proposal.tally
                      ? 'bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800'
                      : votingOpen
                      ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800'
                      : 'bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800'
                  }`}
                >
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                        {proposal.description}
                      </h3>
                      <div className="space-y-1 text-sm text-gray-600 dark:text-gray-400">
                        <p>Created: {new Date(Number(proposal.createdAt) * 1000).toLocaleString()}</p>
                        <p>Voting ends: {new Date(Number(proposal.commitEndTime) * 1000).toLocaleString()}</p>
                        <p>
                          Status:{' '}
                          <span className={
                            proposal.finalized
                              ? 'text-green-600 dark:text-green-400 font-semibold'
                              : proposal.tally
                              ? 'text-purple-600 dark:text-purple-400 font-semibold'
                              : votingOpen
                              ? 'text-blue-600 dark:text-blue-400 font-semibold'
                              : 'text-orange-600 dark:text-orange-400 font-semibold'
                          }>
                            {proposal.finalized
                              ? 'Finalized'
                              : proposal.tally
                              ? 'Tally Submitted (Challenge Period)'
                              : votingOpen
                              ? 'Voting Open'
                              : 'Voting Closed - Awaiting Tally'}
                          </span>
                        </p>
                        {proposal.tally && (
                          <div className="mt-3 p-3 bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
                            <p className="font-semibold text-gray-900 dark:text-white mb-1">Results:</p>
                            <p>
                              <span className="text-green-600 dark:text-green-400">Yes: {proposal.tally.yesVotes.toString()}</span>
                              {' / '}
                              <span className="text-red-600 dark:text-red-400">No: {proposal.tally.noVotes.toString()}</span>
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="ml-4">
                      {!proposal.finalized && !votingOpen && !proposal.tally ? (
                        <button
                          onClick={() => decryptAndTally(proposal.id)}
                          disabled={decrypting !== null}
                          className="bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {decrypting === proposal.id ? 'Decrypting...' : 'Decrypt & Tally'}
                        </button>
                      ) : proposal.finalized || proposal.tally ? (
                        <button
                          onClick={() => router.push(`/results/${proposal.id}`)}
                          className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700"
                        >
                          View Details
                        </button>
                      ) : (
                        <span className="text-blue-600 dark:text-blue-400 text-sm">Voting in progress...</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Layout>
  );
}
