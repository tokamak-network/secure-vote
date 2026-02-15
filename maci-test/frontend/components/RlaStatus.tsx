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

function CircularProgress({ value, max, size = 80, strokeWidth = 4, color = '#3b82f6' }: {
  value: number;
  max: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = max > 0 ? Math.min(value / max, 1) : 0;
  const offset = circumference * (1 - pct);
  const displayPct = Math.round(pct * 100);

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none" stroke="#1f1f30" strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none" stroke={color} strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-all duration-500"
        />
      </svg>
      <span className="absolute text-lg font-bold text-sv-text-primary">{displayPct}%</span>
    </div>
  );
}

function ProgressBar({ value, max, label, variant = 'default' }: {
  value: number;
  max: number;
  label: string;
  variant?: 'default' | 'danger';
}) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="mb-4">
      <div className="flex justify-between text-xs mb-2">
        <span className="text-sv-text-muted">{label}</span>
        <span className="text-sv-text-secondary font-mono text-2xs">{value}/{max}</span>
      </div>
      <div className="h-1.5 bg-sv-surface-2 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            variant === 'danger' ? 'bg-sv-error-light' : 'bg-sv-accent'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

const PHASE_STEPS = [
  { phase: AuditPhase.Committed, label: 'Commit', icon: '1' },
  { phase: AuditPhase.SampleRevealed, label: 'Reveal', icon: '2' },
  { phase: AuditPhase.Tentative, label: 'Verify', icon: '3' },
  { phase: AuditPhase.Finalized, label: 'Final', icon: '4' },
];

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
    <div className={`sv-card p-6 ${
      isChallenged ? 'border-sv-error/30 shadow-glow-error' :
      isRejected ? 'border-sv-error/40 shadow-glow-error' : ''
    }`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h3 className="sv-section-label">RLA Audit</h3>
        <span className={`sv-tag ${
          isRejected ? 'bg-sv-error/15 text-sv-error-light' :
          isChallenged ? 'bg-sv-error/15 text-sv-error-light' :
          phase === AuditPhase.Finalized ? 'bg-sv-emerald/15 text-sv-emerald' :
          'bg-sv-accent/15 text-sv-accent'
        }`}>
          <span className={`sv-badge-dot ${
            isRejected || isChallenged ? 'bg-sv-error' :
            phase === AuditPhase.Finalized ? 'bg-sv-emerald' : 'bg-sv-accent'
          }`} />
          {PHASE_LABELS[phase] || 'Unknown'}
        </span>
      </div>

      {/* Savings ring + Proofs */}
      <div className="flex items-start gap-6 mb-6">
        <div className="flex flex-col items-center">
          <CircularProgress
            value={savings}
            max={100}
            color={savings > 50 ? '#10b981' : '#3b82f6'}
          />
          <span className="text-2xs text-sv-text-muted mt-2 uppercase tracking-wider">Saved</span>
        </div>
        <div className="flex-1">
          <ProgressBar label="PM Proofs (sampled)" value={pmProofsVerified} max={pmSampleCount} />
          <ProgressBar label="TV Proofs (sampled)" value={tvProofsVerified} max={tvSampleCount} />
        </div>
      </div>

      {/* Challenge response progress */}
      {isChallenged && (
        <div className="mb-6 pt-5 border-t border-sv-error/20">
          <div className="text-xs text-sv-error-light font-semibold mb-4 uppercase tracking-wider flex items-center gap-2">
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            Challenge Response
          </div>
          <ProgressBar label="PM Full Proofs" value={totalFullPm} max={pmBatchCount} variant="danger" />
          <ProgressBar label="TV Full Proofs" value={totalFullTv} max={tvBatchCount} variant="danger" />
        </div>
      )}

      {/* Stats grid */}
      <div className="pt-5 border-t border-sv-border-subtle grid grid-cols-2 gap-6">
        <div>
          <div className="sv-stat-label">Margin</div>
          <div className="text-lg font-bold text-sv-text-primary">
            {marginPct}%
            <span className="text-xs font-normal text-sv-text-muted ml-1.5">({margin} votes)</span>
          </div>
        </div>
        <div>
          <div className="sv-stat-label">Sampling</div>
          <div className="text-lg font-bold text-sv-text-primary">
            {totalSampled}
            <span className="text-xs font-normal text-sv-text-muted ml-1.5">/ {totalBatches} batches</span>
          </div>
        </div>
        <div>
          <div className="sv-stat-label">Cost Savings</div>
          <div className={`text-lg font-bold ${savings > 50 ? 'text-sv-emerald' : 'text-sv-text-primary'}`}>
            {savings}%
          </div>
        </div>
        <div>
          <div className="sv-stat-label">Challenge Period</div>
          <div className="text-lg font-bold text-sv-text-primary">
            {phase === AuditPhase.Tentative && challengeRemaining > 0
              ? `${challengeDays}d ${challengeHours}h`
              : isChallenged ? <span className="text-sv-error-light">Active</span>
              : phase >= AuditPhase.Finalized ? <span className="text-sv-emerald">Done</span>
              : 'Pending'}
          </div>
        </div>
      </div>

      {/* Challenge details */}
      {isChallenged && challenger && challenger !== zeroAddr && (
        <div className="mt-5 pt-5 border-t border-sv-error/20">
          <div className="grid grid-cols-2 gap-6">
            <div>
              <div className="sv-stat-label">Challenger</div>
              <div className="text-sm text-sv-text-primary font-mono text-2xs mt-1">
                {challenger.slice(0, 10)}...{challenger.slice(-8)}
              </div>
            </div>
            <div>
              <div className="sv-stat-label">Bond</div>
              <div className="text-sm text-sv-text-primary mt-1">
                {challengeBond ? (Number(challengeBond) / 1e18).toFixed(6) : '0'} ETH
              </div>
            </div>
            <div>
              <div className="sv-stat-label">Response Deadline</div>
              <div className="text-sm text-sv-text-primary mt-1">
                {responseRemaining > 0
                  ? <span className="text-sv-warning">{responseDays}d {responseHours}h {responseMinutes}m</span>
                  : <span className="text-sv-error-light">Expired</span>}
              </div>
            </div>
            <div>
              <div className="sv-stat-label">Full Proofs</div>
              <div className="text-sm text-sv-text-primary mt-1">
                {totalFullPm}/{pmBatchCount} PM, {totalFullTv}/{tvBatchCount} TV
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Phase stepper */}
      <div className="mt-6 pt-5 border-t border-sv-border-subtle flex items-center justify-between">
        {PHASE_STEPS.map((step, i) => {
          const active = phase >= step.phase && !isRejected;
          const rejected = isRejected && step.phase <= phase;
          return (
            <div key={step.label} className="flex items-center flex-1 last:flex-none">
              <div className="flex flex-col items-center">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-2xs font-bold transition-all ${
                  rejected ? 'bg-sv-error/20 text-sv-error-light border border-sv-error/40' :
                  active ? 'bg-sv-accent/20 text-sv-accent border border-sv-accent/40' :
                  'bg-sv-surface-2 text-sv-text-disabled border border-sv-border-subtle'
                }`}>
                  {active && !rejected ? (
                    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  ) : step.icon}
                </div>
                <span className={`mt-1.5 text-2xs uppercase tracking-wider ${
                  rejected ? 'text-sv-error-light' :
                  active ? 'text-sv-text-primary' :
                  'text-sv-text-disabled'
                }`}>
                  {step.label}
                </span>
              </div>
              {i < PHASE_STEPS.length - 1 && (
                <div className={`flex-1 h-px mx-3 mt-[-1rem] ${
                  rejected ? 'bg-sv-error/40' :
                  active && phase > step.phase ? 'bg-sv-accent/40' :
                  'bg-sv-border-subtle'
                }`} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
