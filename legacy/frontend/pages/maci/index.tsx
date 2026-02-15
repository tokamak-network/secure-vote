import { useState, useEffect } from 'react';
import { usePublicClient } from 'wagmi';
import Layout from '@/components/Layout';
import Link from 'next/link';
import { MACI_VOTING_ABI, getMACIContractAddress } from '@/lib/contracts';

type Proposal = {
  id: number;
  description: string;
  createdAt: bigint;
  signupEndTime: bigint;
  votingEndTime: bigint;
  coordinatorId: bigint;
  finalized: boolean;
  messageCount: number;
  hasTally: boolean;
};

export default function MACIHome() {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(false);
  const [setupLoading, setSetupLoading] = useState(false);
  const [tallyLoading, setTallyLoading] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [blockTime, setBlockTime] = useState<bigint>(0n);
  const publicClient = usePublicClient();

  const setupDemo = async () => {
    try {
      setSetupLoading(true);
      setError(null);
      const response = await fetch('/api/maci/setup-demo', { method: 'POST' });
      const data = await response.json();
      if (!data.success) throw new Error(data.error || 'Setup failed');
      setSuccess('Demo ready');
      await loadProposals();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup failed');
    } finally {
      setSetupLoading(false);
    }
  };

  const processTally = async (proposalId: number) => {
    try {
      setTallyLoading(proposalId);
      setError(null);
      const response = await fetch('/api/maci/process-tally', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proposalId }),
      });
      const data = await response.json();
      if (!data.success) throw new Error(data.error || 'Processing failed');
      setSuccess(`Tally: ${data.yesVotes} For, ${data.noVotes} Against`);
      await loadProposals();
      setTimeout(() => setSuccess(null), 5000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process tally');
    } finally {
      setTallyLoading(null);
    }
  };

  const loadProposals = async () => {
    if (!publicClient) return;
    try {
      setLoading(true);
      setError(null);

      let contractAddress: `0x${string}`;
      try {
        contractAddress = getMACIContractAddress();
      } catch {
        setError('Contract not deployed');
        setLoading(false);
        return;
      }

      const block = await publicClient.getBlock();
      setBlockTime(block.timestamp);

      const count = await publicClient.readContract({
        address: contractAddress,
        abi: MACI_VOTING_ABI,
        functionName: 'nextProposalId',
      }) as bigint;

      const proposalsData: Proposal[] = [];

      for (let i = 0; i < Number(count); i++) {
        const proposal = await publicClient.readContract({
          address: contractAddress,
          abi: MACI_VOTING_ABI,
          functionName: 'proposals',
          args: [BigInt(i)],
        }) as [string, bigint, bigint, bigint, bigint, boolean];

        const messageCount = await publicClient.readContract({
          address: contractAddress,
          abi: MACI_VOTING_ABI,
          functionName: 'getMessageCount',
          args: [BigInt(i)],
        }) as bigint;

        const tally = await publicClient.readContract({
          address: contractAddress,
          abi: MACI_VOTING_ABI,
          functionName: 'tallies',
          args: [BigInt(i)],
        }) as [bigint, bigint, string, bigint, boolean, string, bigint, boolean];

        proposalsData.push({
          id: i,
          description: proposal[0],
          createdAt: proposal[1],
          signupEndTime: proposal[2],
          votingEndTime: proposal[3],
          coordinatorId: proposal[4],
          finalized: proposal[5],
          messageCount: Number(messageCount),
          hasTally: tally[3] > 0n,
        });
      }

      setProposals(proposalsData.reverse());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProposals();
  }, [publicClient]);

  const getStatus = (p: Proposal) => {
    if (p.finalized) return 'closed';
    if (p.hasTally) return 'pending';
    if (blockTime < p.signupEndTime) return 'active';
    if (blockTime < p.votingEndTime) return 'active';
    return 'ended';
  };

  return (
    <Layout>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-white">Proposals</h1>
        <button
          onClick={setupDemo}
          disabled={setupLoading}
          className="px-4 py-2 text-sm bg-[#384aff] text-white rounded-full hover:bg-[#4857ff] disabled:opacity-50"
        >
          {setupLoading ? 'Setting up...' : 'New proposal'}
        </button>
      </div>

      {(success || error) && (
        <div className={`mb-4 px-4 py-3 rounded-lg text-sm ${
          success ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
        }`}>
          {success || error}
        </div>
      )}

      {loading ? (
        <div className="py-20 text-center text-[#606060]">Loading...</div>
      ) : proposals.length === 0 ? (
        <div className="py-20 text-center text-[#606060]">
          No proposals yet
        </div>
      ) : (
        <div className="border border-white/[0.06] rounded-[16px] overflow-hidden bg-[#1c1c1f]">
          {proposals.map((proposal, idx) => {
            const status = getStatus(proposal);
            const canVote = status === 'active';
            const canTally = status === 'ended' && proposal.messageCount > 0;

            return (
              <div
                key={proposal.id}
                className={`px-4 py-4 flex items-center justify-between hover:bg-white/[0.02] ${
                  idx !== proposals.length - 1 ? 'border-b border-white/[0.06]' : ''
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`w-2 h-2 rounded-full ${
                      status === 'active' ? 'bg-green-400' :
                      status === 'pending' ? 'bg-yellow-400' :
                      status === 'ended' ? 'bg-orange-400' : 'bg-[#606060]'
                    }`} />
                    <span className="text-xs text-[#606060] uppercase tracking-wide">
                      {status === 'active' ? 'Active' :
                       status === 'pending' ? 'Pending' :
                       status === 'ended' ? 'Ended' : 'Closed'}
                    </span>
                  </div>
                  <Link
                    href={canVote ? `/maci/vote/${proposal.id}` : proposal.finalized ? `/maci/results/${proposal.id}` : '#'}
                    className="text-white font-medium hover:underline"
                  >
                    {proposal.description}
                  </Link>
                  <div className="text-xs text-[#606060] mt-1">
                    {proposal.messageCount} votes
                  </div>
                </div>

                <div className="flex items-center gap-2 ml-4">
                  {canVote && (
                    <Link
                      href={`/maci/vote/${proposal.id}`}
                      className="px-4 py-1.5 text-sm border border-white/20 rounded-full text-white hover:border-white/40"
                    >
                      Vote
                    </Link>
                  )}
                  {canTally && (
                    <button
                      onClick={() => processTally(proposal.id)}
                      disabled={tallyLoading === proposal.id}
                      className="px-4 py-1.5 text-sm border border-white/20 rounded-full text-white hover:border-white/40 disabled:opacity-50"
                    >
                      {tallyLoading === proposal.id ? '...' : 'Tally'}
                    </button>
                  )}
                  {proposal.finalized && (
                    <Link
                      href={`/maci/results/${proposal.id}`}
                      className="px-4 py-1.5 text-sm text-[#606060] hover:text-white"
                    >
                      Results
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Layout>
  );
}
