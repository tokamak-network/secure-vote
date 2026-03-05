import { useState, useEffect } from 'react';
import { usePublicClient } from 'wagmi';
import Layout from '@/components/Layout';
import CoordinatorGuard from '@/components/CoordinatorGuard';
import Link from 'next/link';
import { MACI_RLA_ABI, MACI_ABI, POLL_ABI, AuditPhase, PHASE_LABELS } from '@/lib/contracts';

interface PollSummary {
  id: number;
  phase: number;
  yesVotes: number;
  noVotes: number;
  pmSampleCount: number;
  tvSampleCount: number;
  pmProofsVerified: number;
  tvProofsVerified: number;
  voterCount: number;
  messageCount: number;
  pollAddress: string;
  name: string;
}

export default function CoordinatorDashboard() {
  const [polls, setPolls] = useState<PollSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const publicClient = usePublicClient();

  useEffect(() => {
    loadPolls();
  }, [publicClient]);

  const loadPolls = async () => {
    if (!publicClient) return;
    const maciAddress = process.env.NEXT_PUBLIC_MACI_ADDRESS as `0x${string}` | undefined;
    const maciRlaAddress = process.env.NEXT_PUBLIC_MACI_RLA_ADDRESS as `0x${string}` | undefined;
    if (!maciAddress) {
      setError('MACI address not configured');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);

      let metadata: Record<string, { name: string; category: string }> = {};
      try {
        const metaRes = await fetch('/api/elections/list');
        const metaData = await metaRes.json();
        if (metaData.metadata) metadata = metaData.metadata;
      } catch {}

      const maciPollCount = await publicClient.readContract({
        address: maciAddress,
        abi: MACI_ABI,
        functionName: 'nextPollId',
      } as any) as bigint;

      let rlaCount = 0n;
      if (maciRlaAddress) {
        try {
          rlaCount = await publicClient.readContract({
            address: maciRlaAddress,
            abi: MACI_RLA_ABI,
            functionName: 'nextPollId',
          } as any) as bigint;
        } catch {}
      }

      const items: PollSummary[] = [];
      for (let i = 0; i < Number(maciPollCount); i++) {
        let voterCount = 0, messageCount = 0;
        let pollAddress = '';

        try {
          const pollInfo = await publicClient.readContract({
            address: maciAddress,
            abi: MACI_ABI,
            functionName: 'getPoll',
            args: [BigInt(i)],
          } as any) as any;

          pollAddress = pollInfo[0] || pollInfo.poll || '';
          if (pollAddress) {
            const numInfo = await publicClient.readContract({
              address: pollAddress as `0x${string}`,
              abi: POLL_ABI,
              functionName: 'numSignUpsAndMessages',
            } as any) as any;
            voterCount = Number(numInfo[0] || 0);
            messageCount = Number(numInfo[1] || 0);
          }
        } catch {}

        let phase = AuditPhase.None;
        let yesVotes = 0, noVotes = 0;
        let pmSampleCount = 0, tvSampleCount = 0;
        let pmProofsVerified = 0, tvProofsVerified = 0;

        if (maciRlaAddress && i < Number(rlaCount)) {
          try {
            const audit = await publicClient.readContract({
              address: maciRlaAddress,
              abi: MACI_RLA_ABI,
              functionName: 'pollAudits',
              args: [BigInt(i)],
            } as any) as any;
            phase = Number(audit[22]);
            yesVotes = Number(audit[3]);
            noVotes = Number(audit[4]);
            pmSampleCount = Number(audit[11]);
            tvSampleCount = Number(audit[12]);
            pmProofsVerified = Number(audit[13]);
            tvProofsVerified = Number(audit[14]);
          } catch {}
        }

        const meta = metadata[i.toString()];
        items.push({
          id: i,
          name: meta?.name || `Election #${i}`,
          phase,
          yesVotes,
          noVotes,
          pmSampleCount,
          tvSampleCount,
          pmProofsVerified,
          tvProofsVerified,
          voterCount,
          messageCount,
          pollAddress,
        });
      }

      setPolls(items.reverse());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  const getPhaseLabel = (phase: number) => {
    if (phase === AuditPhase.None) return 'Not Committed';
    return PHASE_LABELS[phase] || 'Unknown';
  };

  const getPhaseDot = (phase: number) => {
    if (phase === AuditPhase.Finalized) return 'bg-emerald-500';
    if (phase === AuditPhase.Rejected) return 'bg-rose-500';
    if (phase === AuditPhase.None) return 'bg-zinc-600';
    return 'bg-amber-500';
  };

  // Summary stats
  const totalPolls = polls.length;
  const activePolls = polls.filter(p => p.phase > AuditPhase.None && p.phase < AuditPhase.Finalized).length;
  const finalizedPolls = polls.filter(p => p.phase === AuditPhase.Finalized).length;

  return (
    <Layout>
      <CoordinatorGuard>
        <div className="mb-8">
          <h1 className="text-4xl font-light text-white tracking-tight mb-2">Coordinator</h1>
          <p className="text-base text-zinc-500">Manage elections, generate proofs, and submit RLA audits.</p>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          <div className="bg-surface-dark border border-border-dark p-5">
            <div className="text-[10px] font-bold tracking-widest text-zinc-500 uppercase">Total Elections</div>
            <div className="text-xl font-mono text-white mt-1">{totalPolls}</div>
          </div>
          <div className="bg-surface-dark border border-border-dark p-5">
            <div className="text-[10px] font-bold tracking-widest text-zinc-500 uppercase">In Progress</div>
            <div className="text-xl font-mono text-amber-500 mt-1">{activePolls}</div>
          </div>
          <div className="bg-surface-dark border border-border-dark p-5">
            <div className="text-[10px] font-bold tracking-widest text-zinc-500 uppercase">Finalized</div>
            <div className="text-xl font-mono text-emerald-500 mt-1">{finalizedPolls}</div>
          </div>
        </div>

        {error && (
          <div className="mb-6 px-5 py-4 bg-rose-950/20 text-rose-400 text-sm border border-rose-500/20 flex items-start gap-3">
            {error}
          </div>
        )}

        {loading ? (
          <div className="py-24 text-center">
            <div className="inline-flex items-center gap-3 text-zinc-500 text-sm">
              <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Loading...
            </div>
          </div>
        ) : polls.length === 0 ? (
          <div className="py-24 text-center">
            <p className="text-zinc-500 text-base mb-2">No elections found</p>
            <p className="text-zinc-600 text-sm">
              Create an election at <Link href="/elections/create" className="text-accent-blue hover:text-blue-400 transition-colors">/elections/create</Link>
            </p>
          </div>
        ) : (
          <div className="bg-surface-dark border border-border-dark overflow-hidden">
            {/* Table header */}
            <div className="px-5 py-3 border-b border-border-dark grid grid-cols-7 gap-3 text-xs text-zinc-600 font-normal uppercase tracking-wider">
              <div>Poll</div>
              <div>Phase</div>
              <div>Messages</div>
              <div>Result</div>
              <div>PM Proofs</div>
              <div>TV Proofs</div>
              <div></div>
            </div>

            {polls.map((poll) => (
              <div
                key={poll.id}
                className="px-5 py-3.5 border-b border-border-dark last:border-b-0 grid grid-cols-7 gap-3 text-sm items-center
                  hover:bg-zinc-900/50 transition-colors group"
              >
                <div>
                  <div className="text-white font-mono text-xs font-medium">#{poll.id}</div>
                  <div className="text-xs text-zinc-600 truncate">{poll.name}</div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`w-1.5 h-1.5 rounded-full ${getPhaseDot(poll.phase)}`}></span>
                  <span className="text-xs text-zinc-400">{getPhaseLabel(poll.phase)}</span>
                </div>
                <div className="text-zinc-300 text-xs">{poll.messageCount}</div>
                <div className="text-zinc-300 text-xs">
                  {poll.phase > AuditPhase.None
                    ? `${poll.yesVotes}/${poll.noVotes}`
                    : <span className="text-zinc-600">&mdash;</span>}
                </div>
                <div className="text-zinc-300 text-xs font-mono">
                  {poll.pmSampleCount > 0
                    ? `${poll.pmProofsVerified}/${poll.pmSampleCount}`
                    : <span className="text-zinc-600">&mdash;</span>}
                </div>
                <div className="text-zinc-300 text-xs font-mono">
                  {poll.tvSampleCount > 0
                    ? `${poll.tvProofsVerified}/${poll.tvSampleCount}`
                    : <span className="text-zinc-600">&mdash;</span>}
                </div>
                <div>
                  <Link
                    href={`/coordinator/${poll.id}`}
                    className="text-xs text-accent-blue hover:text-blue-400 transition-colors opacity-70 group-hover:opacity-100"
                  >
                    Manage
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </CoordinatorGuard>
    </Layout>
  );
}
