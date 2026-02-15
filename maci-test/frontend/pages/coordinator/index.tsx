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
    if (phase === AuditPhase.Finalized) return 'bg-sv-emerald';
    if (phase === AuditPhase.Rejected) return 'bg-sv-error';
    if (phase === AuditPhase.None) return 'bg-sv-text-disabled';
    return 'bg-sv-warning';
  };

  const getPhaseTagColor = (phase: number) => {
    if (phase === AuditPhase.Finalized) return 'bg-sv-emerald/15 text-sv-emerald';
    if (phase === AuditPhase.Rejected) return 'bg-sv-error/15 text-sv-error-light';
    if (phase === AuditPhase.None) return 'bg-sv-surface-2 text-sv-text-muted';
    return 'bg-sv-warning/15 text-sv-warning';
  };

  // Summary stats
  const totalPolls = polls.length;
  const activePolls = polls.filter(p => p.phase > AuditPhase.None && p.phase < AuditPhase.Finalized).length;
  const finalizedPolls = polls.filter(p => p.phase === AuditPhase.Finalized).length;

  return (
    <Layout>
      <CoordinatorGuard>
        <div className="mb-8">
          <h1 className="text-heading font-bold text-sv-text-primary mb-2">Coordinator</h1>
          <p className="text-sm text-sv-text-muted">Manage elections, generate proofs, and submit RLA audits.</p>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          <div className="sv-card p-5">
            <div className="sv-stat-label">Total Elections</div>
            <div className="sv-stat-value mt-1">{totalPolls}</div>
          </div>
          <div className="sv-card p-5">
            <div className="sv-stat-label">In Progress</div>
            <div className="sv-stat-value mt-1 text-sv-warning">{activePolls}</div>
          </div>
          <div className="sv-card p-5">
            <div className="sv-stat-label">Finalized</div>
            <div className="sv-stat-value mt-1 text-sv-emerald">{finalizedPolls}</div>
          </div>
        </div>

        {error && (
          <div className="mb-6 px-5 py-4 bg-sv-error/10 text-sv-error-light text-sm border border-sv-error/20 rounded-lg flex items-start gap-3">
            <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
            {error}
          </div>
        )}

        {loading ? (
          <div className="py-24 text-center">
            <div className="inline-flex items-center gap-3 text-sv-text-muted text-sm">
              <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Loading...
            </div>
          </div>
        ) : polls.length === 0 ? (
          <div className="py-24 text-center">
            <p className="text-sv-text-muted text-sm mb-2">No elections found</p>
            <p className="text-sv-text-disabled text-xs">
              Create an election at <Link href="/elections/create" className="text-sv-accent hover:text-sv-accent-hover transition-colors">/elections/create</Link>
            </p>
          </div>
        ) : (
          <div className="sv-card overflow-hidden">
            {/* Table header */}
            <div className="px-5 py-3 border-b border-sv-border grid grid-cols-7 gap-3 text-2xs text-sv-text-muted font-medium uppercase tracking-wider">
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
                className="px-5 py-3.5 border-b border-sv-border-subtle last:border-b-0 grid grid-cols-7 gap-3 text-sm items-center
                  hover:bg-sv-surface-hover transition-colors group"
              >
                <div>
                  <div className="text-sv-text-primary font-mono text-xs font-medium">#{poll.id}</div>
                  <div className="text-2xs text-sv-text-disabled truncate">{poll.name}</div>
                </div>
                <div>
                  <span className={`sv-tag ${getPhaseTagColor(poll.phase)}`}>
                    <span className={`sv-badge-dot ${getPhaseDot(poll.phase)}`} />
                    {getPhaseLabel(poll.phase)}
                  </span>
                </div>
                <div className="text-sv-text-secondary text-xs">{poll.messageCount}</div>
                <div className="text-sv-text-secondary text-xs">
                  {poll.phase > AuditPhase.None
                    ? `${poll.yesVotes}/${poll.noVotes}`
                    : <span className="text-sv-text-disabled">&mdash;</span>}
                </div>
                <div className="text-sv-text-secondary text-xs font-mono">
                  {poll.pmSampleCount > 0
                    ? `${poll.pmProofsVerified}/${poll.pmSampleCount}`
                    : <span className="text-sv-text-disabled">&mdash;</span>}
                </div>
                <div className="text-sv-text-secondary text-xs font-mono">
                  {poll.tvSampleCount > 0
                    ? `${poll.tvProofsVerified}/${poll.tvSampleCount}`
                    : <span className="text-sv-text-disabled">&mdash;</span>}
                </div>
                <div>
                  <Link
                    href={`/coordinator/${poll.id}`}
                    className="text-xs text-sv-accent hover:text-sv-accent-hover transition-colors opacity-70 group-hover:opacity-100"
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
