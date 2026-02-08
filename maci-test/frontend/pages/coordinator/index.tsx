import { useState, useEffect } from 'react';
import { usePublicClient } from 'wagmi';
import Layout from '@/components/Layout';
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

  const getPhaseColor = (phase: number) => {
    if (phase === AuditPhase.Finalized) return 'bg-carbon-support-success/20 text-carbon-support-success';
    if (phase === AuditPhase.Rejected) return 'bg-carbon-support-error/20 text-carbon-support-error-light';
    if (phase === AuditPhase.None) return 'bg-carbon-layer-2 text-carbon-text-helper';
    return 'bg-carbon-support-warning/20 text-carbon-support-warning';
  };

  return (
    <Layout>
      <div className="mb-6">
        <h1 className="text-heading font-semibold text-carbon-text-primary">Coordinator</h1>
        <p className="text-sm text-carbon-text-helper mt-1">Manage elections, generate proofs, and submit RLA audits.</p>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 bg-carbon-support-error/10 text-carbon-support-error-light text-sm border-l-2 border-carbon-support-error">
          {error}
        </div>
      )}

      {loading ? (
        <div className="py-20 text-center text-carbon-text-disabled text-sm">Loading...</div>
      ) : polls.length === 0 ? (
        <div className="py-20 text-center">
          <p className="text-carbon-text-helper text-sm mb-1">No elections found</p>
          <p className="text-carbon-text-disabled text-xs">
            Create an election at <Link href="/elections/create" className="text-carbon-interactive">/elections/create</Link>
          </p>
        </div>
      ) : (
        <div className="carbon-card overflow-hidden">
          {/* Table header */}
          <div className="px-5 py-3 border-b border-carbon-border grid grid-cols-7 gap-3 text-2xs text-carbon-text-helper font-medium uppercase tracking-wider">
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
              className="px-5 py-3 border-b border-carbon-border-subtle last:border-b-0 grid grid-cols-7 gap-3 text-sm items-center hover:bg-carbon-layer-hover transition-colors"
            >
              <div>
                <div className="text-carbon-text-primary font-mono text-xs">#{poll.id}</div>
                <div className="text-2xs text-carbon-text-disabled truncate">{poll.name}</div>
              </div>
              <div>
                <span className={`carbon-tag ${getPhaseColor(poll.phase)}`}>
                  {getPhaseLabel(poll.phase)}
                </span>
              </div>
              <div className="text-carbon-text-secondary text-xs">{poll.messageCount}</div>
              <div className="text-carbon-text-secondary text-xs">
                {poll.phase > AuditPhase.None
                  ? `${poll.yesVotes}/${poll.noVotes}`
                  : <span className="text-carbon-text-disabled">&mdash;</span>}
              </div>
              <div className="text-carbon-text-secondary text-xs font-mono">
                {poll.pmSampleCount > 0
                  ? `${poll.pmProofsVerified}/${poll.pmSampleCount}`
                  : <span className="text-carbon-text-disabled">&mdash;</span>}
              </div>
              <div className="text-carbon-text-secondary text-xs font-mono">
                {poll.tvSampleCount > 0
                  ? `${poll.tvProofsVerified}/${poll.tvSampleCount}`
                  : <span className="text-carbon-text-disabled">&mdash;</span>}
              </div>
              <div>
                <Link
                  href={`/coordinator/${poll.id}`}
                  className="text-xs text-carbon-interactive hover:text-carbon-interactive-hover transition-colors"
                >
                  Manage
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </Layout>
  );
}
