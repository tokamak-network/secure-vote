import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { usePublicClient } from 'wagmi';
import Layout from '@/components/Layout';
import { VOTING_ABI, getContractAddress } from '@/lib/contracts';

type Tally = {
  yesVotes: bigint;
  noVotes: bigint;
  votesRoot: string;
  submittedAt: bigint;
  submitter: string;
  finalized: boolean;
};

type Proposal = {
  description: string;
};

export default function ResultsPage() {
  const router = useRouter();
  const { id } = router.query;
  const proposalId = id ? BigInt(id as string) : undefined;

  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [tally, setTally] = useState<Tally | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const publicClient = usePublicClient();

  useEffect(() => {
    if (!publicClient || proposalId === undefined) return;

    const loadResults = async () => {
      try {
        setLoading(true);
        const contractAddress = getContractAddress();

        const proposalData = await publicClient.readContract({
          address: contractAddress,
          abi: VOTING_ABI,
          functionName: 'proposals',
          args: [proposalId],
        });

        setProposal({
          description: proposalData[0] as string,
        });

        const tallyData = await publicClient.readContract({
          address: contractAddress,
          abi: VOTING_ABI,
          functionName: 'tallies',
          args: [proposalId],
        });

        if (tallyData[0] === 0n && tallyData[1] === 0n && tallyData[2] === '0x0000000000000000000000000000000000000000000000000000000000000000') {
          setError('Tally not yet submitted');
        } else {
          setTally({
            yesVotes: tallyData[0] as bigint,
            noVotes: tallyData[1] as bigint,
            votesRoot: tallyData[2] as string,
            submittedAt: tallyData[3] as bigint,
            submitter: tallyData[4] as string,
            finalized: tallyData[6] as boolean,
          });
        }
      } catch (err) {
        console.error('Error loading results:', err);
        setError('Failed to load results');
      } finally {
        setLoading(false);
      }
    };

    loadResults();
  }, [publicClient, proposalId]);

  if (loading) {
    return (
      <Layout>
        <div className="text-center py-12">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 dark:border-white"></div>
          <p className="mt-2 text-gray-600 dark:text-gray-400">Loading results...</p>
        </div>
      </Layout>
    );
  }

  if (error || !proposal) {
    return (
      <Layout>
        <div className="text-center py-12">
          <p className="text-red-600 dark:text-red-400">{error || 'Proposal not found'}</p>
          <button
            onClick={() => router.push('/')}
            className="mt-4 text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
          >
            ← Back to proposals
          </button>
        </div>
      </Layout>
    );
  }

  if (!tally) {
    return (
      <Layout>
        <div className="text-center py-12">
          <p className="text-gray-600 dark:text-gray-400">Results not yet available</p>
          <button
            onClick={() => router.push('/committee')}
            className="mt-4 text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
          >
            Go to Committee Dashboard →
          </button>
        </div>
      </Layout>
    );
  }

  const totalVotes = tally.yesVotes + tally.noVotes;
  const yesPercentage = totalVotes > 0n ? Number((tally.yesVotes * 100n) / totalVotes) : 0;
  const noPercentage = totalVotes > 0n ? Number((tally.noVotes * 100n) / totalVotes) : 0;
  const outcome = tally.yesVotes > tally.noVotes ? 'Passed' : tally.yesVotes < tally.noVotes ? 'Rejected' : 'Tied';

  return (
    <Layout>
      <div className="max-w-3xl mx-auto space-y-6">
        <button
          onClick={() => router.push('/')}
          className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
        >
          ← Back to proposals
        </button>

        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-8">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
            {proposal.description}
          </h1>

          <div className={`text-center py-6 mb-6 rounded-lg ${
            outcome === 'Passed' ? 'bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800' :
            outcome === 'Rejected' ? 'bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800' :
            'bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600'
          }`}>
            <p className={`text-3xl font-bold mb-2 ${
              outcome === 'Passed' ? 'text-green-600 dark:text-green-400' :
              outcome === 'Rejected' ? 'text-red-600 dark:text-red-400' :
              'text-gray-600 dark:text-gray-400'
            }`}>{outcome}</p>
            <p className="text-gray-600 dark:text-gray-400">Based on {totalVotes.toString()} votes</p>
          </div>

          <div className="space-y-6">
            <div>
              <div className="flex justify-between items-center mb-2">
                <span className="text-lg font-semibold text-green-600 dark:text-green-400">Yes</span>
                <span className="text-2xl font-bold text-gray-900 dark:text-white">{tally.yesVotes.toString()}</span>
              </div>
              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-6">
                <div
                  className="bg-green-600 h-6 rounded-full transition-all duration-500"
                  style={{ width: `${yesPercentage}%` }}
                />
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{yesPercentage.toFixed(1)}%</p>
            </div>

            <div>
              <div className="flex justify-between items-center mb-2">
                <span className="text-lg font-semibold text-red-600 dark:text-red-400">No</span>
                <span className="text-2xl font-bold text-gray-900 dark:text-white">{tally.noVotes.toString()}</span>
              </div>
              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-6">
                <div
                  className="bg-red-600 h-6 rounded-full transition-all duration-500"
                  style={{ width: `${noPercentage}%` }}
                />
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{noPercentage.toFixed(1)}%</p>
            </div>
          </div>

          <div className="mt-8 pt-6 border-t border-gray-200 dark:border-gray-700">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">Verification Details</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-400">Merkle Root:</span>
                <code className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300 px-2 py-1 rounded">
                  {tally.votesRoot.slice(0, 10)}...{tally.votesRoot.slice(-8)}
                </code>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-400">Submitted by:</span>
                <code className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300 px-2 py-1 rounded">
                  {tally.submitter.slice(0, 6)}...{tally.submitter.slice(-4)}
                </code>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-400">Submitted at:</span>
                <span className="text-gray-900 dark:text-gray-300">{new Date(Number(tally.submittedAt) * 1000).toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-400">Status:</span>
                <span className={tally.finalized ? 'text-green-600 dark:text-green-400' : 'text-orange-600 dark:text-orange-400'}>
                  {tally.finalized ? 'Finalized' : 'Pending finalization'}
                </span>
              </div>
            </div>
          </div>

          <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg">
            <p className="text-sm text-blue-800 dark:text-blue-300">
              <strong>Cryptographic Verification:</strong> All votes were encrypted using threshold ElGamal encryption.
              The committee decrypted them off-chain using threshold cryptography, and the Merkle root
              allows any voter to verify their vote was included in the final tally.
            </p>
          </div>
        </div>
      </div>
    </Layout>
  );
}
