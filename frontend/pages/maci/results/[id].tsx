import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { usePublicClient } from 'wagmi';
import Layout from '@/components/Layout';
import Link from 'next/link';
import { MACI_VOTING_ABI, getMACIContractAddress } from '@/lib/contracts';

type TallyResult = {
  yesVotes: bigint;
  noVotes: bigint;
  finalized: boolean;
  stateRoot: string;
  commitment: string;
  messageCount: number;
};

type Proposal = {
  description: string;
  finalized: boolean;
};

export default function ResultsPage() {
  const router = useRouter();
  const { id } = router.query;
  const [result, setResult] = useState<TallyResult | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const publicClient = usePublicClient();

  useEffect(() => {
    if (!id || !publicClient) return;

    const loadResults = async () => {
      try {
        setLoading(true);
        const contractAddress = getMACIContractAddress();
        const proposalId = BigInt(id as string);

        const proposalData = await publicClient.readContract({
          address: contractAddress,
          abi: MACI_VOTING_ABI,
          functionName: 'proposals',
          args: [proposalId],
        }) as [string, bigint, bigint, bigint, bigint, boolean];

        setProposal({
          description: proposalData[0],
          finalized: proposalData[5],
        });

        const tallyData = await publicClient.readContract({
          address: contractAddress,
          abi: MACI_VOTING_ABI,
          functionName: 'getTallyResult',
          args: [proposalId],
        }) as [bigint, bigint, boolean];

        const tally = await publicClient.readContract({
          address: contractAddress,
          abi: MACI_VOTING_ABI,
          functionName: 'tallies',
          args: [proposalId],
        }) as [bigint, bigint, string, bigint, boolean, string, bigint, boolean];

        const messageCount = await publicClient.readContract({
          address: contractAddress,
          abi: MACI_VOTING_ABI,
          functionName: 'getMessageCount',
          args: [proposalId],
        }) as bigint;

        setResult({
          yesVotes: tallyData[0],
          noVotes: tallyData[1],
          finalized: tallyData[2],
          stateRoot: tally[2],
          commitment: tally[5],
          messageCount: Number(messageCount),
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load');
      } finally {
        setLoading(false);
      }
    };

    loadResults();
  }, [id, publicClient]);

  const totalVotes = result ? Number(result.yesVotes) + Number(result.noVotes) : 0;
  const yesPercent = totalVotes > 0 ? (Number(result?.yesVotes || 0) / totalVotes) * 100 : 0;
  const noPercent = totalVotes > 0 ? (Number(result?.noVotes || 0) / totalVotes) * 100 : 0;

  return (
    <Layout>
      <div className="max-w-[580px] mx-auto">
        <Link href="/maci" className="text-[#606060] text-sm hover:text-white mb-6 inline-block">
          &larr; Back
        </Link>

        {loading ? (
          <div className="py-20 text-center text-[#606060]">Loading...</div>
        ) : error ? (
          <div className="px-4 py-3 rounded-lg bg-red-500/10 text-red-400 text-sm">{error}</div>
        ) : (
          <>
            <h1 className="text-2xl font-semibold text-white mb-2">{proposal?.description}</h1>
            <div className="flex items-center gap-2 mb-6">
              <span className={`w-2 h-2 rounded-full ${result?.finalized ? 'bg-[#606060]' : 'bg-yellow-400'}`} />
              <span className="text-sm text-[#606060]">
                {result?.finalized ? 'Closed' : 'Pending'}
              </span>
            </div>

            {/* Results */}
            <div className="border border-white/[0.06] rounded-[16px] bg-[#1c1c1f] mb-6">
              <div className="px-4 py-3 border-b border-white/[0.06]">
                <span className="text-sm text-[#606060]">Results</span>
              </div>
              <div className="p-4 space-y-4">
                {/* For */}
                <div>
                  <div className="flex justify-between text-sm mb-2">
                    <span className="text-white">For</span>
                    <span className="text-[#606060]">
                      {result?.yesVotes.toString()} ({yesPercent.toFixed(1)}%)
                    </span>
                  </div>
                  <div className="h-2 bg-white/[0.06] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-green-400 rounded-full"
                      style={{ width: `${yesPercent}%` }}
                    />
                  </div>
                </div>

                {/* Against */}
                <div>
                  <div className="flex justify-between text-sm mb-2">
                    <span className="text-white">Against</span>
                    <span className="text-[#606060]">
                      {result?.noVotes.toString()} ({noPercent.toFixed(1)}%)
                    </span>
                  </div>
                  <div className="h-2 bg-white/[0.06] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-red-400 rounded-full"
                      style={{ width: `${noPercent}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Stats */}
            <div className="border border-white/[0.06] rounded-[16px] bg-[#1c1c1f] mb-6">
              <div className="px-4 py-3 border-b border-white/[0.06]">
                <span className="text-sm text-[#606060]">Information</span>
              </div>
              <div className="p-4 space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-[#606060]">Total votes</span>
                  <span className="text-white">{totalVotes}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#606060]">Messages</span>
                  <span className="text-white">{result?.messageCount}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#606060]">State root</span>
                  <span className="text-white font-mono text-xs">
                    {result?.stateRoot ? `${result.stateRoot.slice(0, 10)}...` : '-'}
                  </span>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}
