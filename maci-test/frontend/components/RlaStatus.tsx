import { AuditPhase, PHASE_LABELS } from '@/lib/contracts';

interface RlaStatusProps {
  phase: number;
  pmSampleCount: number;
  tvSampleCount: number;
  pmProofsVerified: number;
  tvProofsVerified: number;
  pmBatchCount: number;
  tvBatchCount: number;
  yesVotes: bigint;
  noVotes: bigint;
  tentativeTimestamp: number;
  challengePeriod: number;
  challenger?: string;
  challengeBond?: bigint;
  challengeDeadline?: number;
  fullPmProofsVerified?: number;
  fullTvProofsVerified?: number;
}


export default function RlaStatus({
  phase,
  pmSampleCount,
  tvSampleCount,
  pmProofsVerified,
  tvProofsVerified,
  pmBatchCount,
  tvBatchCount,
  yesVotes,
  noVotes,
  tentativeTimestamp,
  challengePeriod,
  challenger,
  challengeBond,
  challengeDeadline,
  fullPmProofsVerified = 0,
  fullTvProofsVerified = 0,
}: RlaStatusProps) {
  const totalVotes = Number(yesVotes + noVotes);
  const margin = Math.abs(Number(yesVotes) - Number(noVotes));
  const marginPct = totalVotes > 0 ? Math.round((margin / totalVotes) * 100) : 0;
  const totalSampled = pmSampleCount + tvSampleCount;
  const totalBatches = pmBatchCount + tvBatchCount;
  const savings = totalBatches > 0 ? Math.round(((totalBatches - totalSampled) / totalBatches) * 100) : 0;

  const challengeEnd = tentativeTimestamp > 0 ? tentativeTimestamp + challengePeriod : 0;
  const now = Math.floor(Date.now() / 1000);
  const challengeRemaining = challengeEnd > now ? challengeEnd - now : 0;
  const challengeDays = Math.floor(challengeRemaining / 86400);
  const challengeHours = Math.floor((challengeRemaining % 86400) / 3600);

  const isChallenged = phase === AuditPhase.Challenged;
  const isRejected = phase === AuditPhase.Rejected;
  const zeroAddr = '0x0000000000000000000000000000000000000000';

  const responseDeadline = challengeDeadline || 0;
  const responseRemaining = responseDeadline > now ? responseDeadline - now : 0;
  const responseDays = Math.floor(responseRemaining / 86400);
  const responseHours = Math.floor((responseRemaining % 86400) / 3600);
  const responseMinutes = Math.floor((responseRemaining % 3600) / 60);

  const totalFullPm = pmProofsVerified + fullPmProofsVerified;
  const totalFullTv = tvProofsVerified + fullTvProofsVerified;

  return (
    <div className="bg-surface-dark/50 border border-border-dark/5 p-8 space-y-8">
      {/* Audit Pipeline */}
      <div className="space-y-4">
        <h3 className="text-xs font-bold tracking-widest-custom text-zinc-500 uppercase">Audit Status</h3>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-base font-light text-zinc-400">
          <span className={phase >= AuditPhase.Committed ? 'text-primary font-medium border-b border-primary pb-0.5' : 'text-zinc-600'}>Committed</span>
          <span className="text-zinc-600">→</span>
          <span className={phase >= AuditPhase.SampleRevealed ? 'text-primary font-medium border-b border-primary pb-0.5' : 'text-zinc-600'}>Sampled</span>
          <span className="text-zinc-600">→</span>
          <span className={phase >= AuditPhase.Tentative ? 'text-primary font-medium border-b border-primary pb-0.5' : 'text-zinc-600'}>Verified</span>
          <span className="text-zinc-600">→</span>
          <span className={phase >= AuditPhase.Finalized ? 'text-primary font-medium border-b border-primary pb-0.5' : 'text-zinc-600'}>Finalized</span>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
        <div className="space-y-1">
          <p className="text-[10px] font-bold tracking-widest text-zinc-500 uppercase">Proofs Verified</p>
          <p className="text-xl font-mono text-white">{pmProofsVerified + tvProofsVerified}<span className="text-zinc-500 text-base">/{pmSampleCount + tvSampleCount}</span></p>
        </div>
        <div className="space-y-1">
          <p className="text-[10px] font-bold tracking-widest text-zinc-500 uppercase">Gas Saved</p>
          <p className="text-xl font-mono text-primary">{savings}%</p>
        </div>
        <div className="space-y-1">
          <p className="text-[10px] font-bold tracking-widest text-zinc-500 uppercase">Sample Size</p>
          <p className="text-xl font-mono text-white">{totalSampled}</p>
        </div>
        <div className="space-y-1">
          <p className="text-[10px] font-bold tracking-widest text-zinc-500 uppercase">Margin</p>
          <p className="text-xl font-mono text-white">{marginPct}%</p>
        </div>
      </div>

      {/* Challenge details if challenged */}
      {isChallenged && challenger && challenger !== zeroAddr && (
        <div className="pt-4 border-t border-border-dark/10">
          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-1">
              <p className="text-[10px] font-bold tracking-widest text-zinc-500 uppercase">Challenger</p>
              <p className="text-sm font-mono text-white">{challenger.slice(0, 10)}...{challenger.slice(-8)}</p>
            </div>
            <div className="space-y-1">
              <p className="text-[10px] font-bold tracking-widest text-zinc-500 uppercase">Bond</p>
              <p className="text-sm text-white">{challengeBond ? (Number(challengeBond) / 1e18).toFixed(6) : '0'} ETH</p>
            </div>
            <div className="space-y-1">
              <p className="text-[10px] font-bold tracking-widest text-zinc-500 uppercase">Response Deadline</p>
              <p className="text-sm text-amber-500">{responseDays}d {responseHours}h {responseMinutes}m</p>
            </div>
            <div className="space-y-1">
              <p className="text-[10px] font-bold tracking-widest text-zinc-500 uppercase">Full Proofs</p>
              <p className="text-sm text-white">{totalFullPm}/{pmBatchCount} PM, {totalFullTv}/{tvBatchCount} TV</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
