import { useState, useEffect } from 'react';
import { usePublicClient } from 'wagmi';
import Layout from '@/components/Layout';
import Link from 'next/link';
import { VOTING_ABI, getContractAddress } from '@/lib/contracts';

type Proposal = {
  id: number;
  description: string;
  createdAt: bigint;
  commitDeadline: bigint;
  revealDeadline: bigint;
  finalized: boolean;
  hasTally: boolean;
};

export default function Home() {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(false);
  const [setupLoading, setSetupLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blockTime, setBlockTime] = useState<bigint>(0n);
  const publicClient = usePublicClient();

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

        // Check if tally exists
        const tally = await publicClient.readContract({
          address: contractAddress,
          abi: VOTING_ABI,
          functionName: 'tallies',
          args: [BigInt(i)],
        }) as [bigint, bigint, string, bigint, string, boolean, boolean];

        proposalsData.push({
          id: i,
          description: proposal[0] as string,
          createdAt: proposal[2] as bigint,
          commitDeadline: proposal[3] as bigint,
          revealDeadline: proposal[4] as bigint,
          finalized: proposal[5] as boolean,
          hasTally: tally[3] > 0n, // submittedAt > 0
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

  const setupDemo = async () => {
    try {
      setSetupLoading(true);
      setError(null);

      const response = await fetch('/api/setup-demo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Setup failed');
      }

      alert('Demo setup complete! You can now vote.');
      await loadProposals();
    } catch (err) {
      console.error('Setup error:', err);
      setError(err instanceof Error ? err.message : 'Setup failed');
    } finally {
      setSetupLoading(false);
    }
  };

  useEffect(() => {
    loadProposals();
  }, [publicClient]);

  const formatDeadline = (deadline: bigint) => {
    const date = new Date(Number(deadline) * 1000);
    return date.toLocaleString();
  };

  const isVotingOpen = (proposal: Proposal) => {
    // If tally exists or finalized, voting is closed
    if (proposal.hasTally || proposal.finalized) return false;
    return blockTime < proposal.commitDeadline;
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Proposals</h1>
          <button
            onClick={setupDemo}
            disabled={setupLoading}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {setupLoading ? 'Setting up...' : 'Setup Demo'}
          </button>
        </div>

        {error && (
          <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-3 rounded">
            {error}
          </div>
        )}

        <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-300 px-4 py-3 rounded">
          <p className="font-semibold mb-2">Quick Start:</p>
          <ol className="list-decimal list-inside space-y-1 text-sm">
            <li>Click "Setup Demo" to initialize the voting system</li>
            <li>Connect your MetaMask to Anvil (localhost:8545, chainId 31337)</li>
            <li>Import Foundry account 3: <code className="bg-blue-100 dark:bg-blue-800 px-1 rounded">0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6</code></li>
            <li>Vote on the proposal below</li>
            <li>Go to Committee page to decrypt and tally</li>
          </ol>
        </div>

        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 dark:border-white"></div>
            <p className="mt-2 text-gray-600 dark:text-gray-400">Loading proposals...</p>
          </div>
        ) : proposals.length === 0 ? (
          <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
            <p className="text-gray-600 dark:text-gray-400">No proposals yet. Click "Setup Demo" to create one.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {proposals.map((proposal) => {
              const votingOpen = isVotingOpen(proposal);
              return (
                <div
                  key={proposal.id}
                  className={`rounded-lg border p-6 hover:shadow-md transition-shadow ${
                    proposal.finalized
                      ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
                      : votingOpen
                      ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800'
                      : 'bg-gray-100 dark:bg-gray-800 border-gray-300 dark:border-gray-700'
                  }`}
                >
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                        {proposal.description}
                      </h3>
                      <div className="space-y-1 text-sm text-gray-600 dark:text-gray-400">
                        <p>Created: {formatDeadline(proposal.createdAt)}</p>
                        <p>Voting deadline: {formatDeadline(proposal.commitDeadline)}</p>
                        <p>
                          Status:{' '}
                          <span className={
                            proposal.finalized
                              ? 'text-green-600 dark:text-green-400 font-semibold'
                              : votingOpen
                              ? 'text-blue-600 dark:text-blue-400 font-semibold'
                              : 'text-gray-500 dark:text-gray-400'
                          }>
                            {proposal.finalized ? 'Finalized' : votingOpen ? 'Open for Voting' : 'Closed'}
                          </span>
                        </p>
                      </div>
                    </div>
                    <div className="flex space-x-2 ml-4">
                      {votingOpen && !proposal.finalized && (
                        <Link
                          href={`/vote/${proposal.id}`}
                          className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
                        >
                          Vote Now
                        </Link>
                      )}
                      {proposal.finalized && (
                        <Link
                          href={`/results/${proposal.id}`}
                          className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700"
                        >
                          View Results
                        </Link>
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
