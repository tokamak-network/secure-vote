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

function ProgressBar({ value, max, label, variant = 'default' }: {
  value: number;
  max: number;
  label: string;
  variant?: 'default' | 'danger';
}) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="mb-3">
      <div className="flex justify-between text-xs mb-1.5">
        <span className="text-carbon-text-helper">{label}</span>
        <span className="text-carbon-text-secondary font-mono text-2xs">{value}/{max}</span>
      </div>
      <div className="h-1 bg-carbon-layer-2 overflow-hidden">
        <div
          className={`h-full transition-all ${
            variant === 'danger' ? 'bg-carbon-support-error-light' : 'bg-carbon-interactive'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

const PHASE_STEPS = [
  { phase: AuditPhase.Committed, label: 'Commit' },
  { phase: AuditPhase.SampleRevealed, label: 'Reveal' },
  { phase: AuditPhase.Tentative, label: 'Verify' },
  { phase: AuditPhase.Finalized, label: 'Final' },
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
    <div className={`carbon-card p-5 ${
      isChallenged ? '!border-carbon-support-error/30' :
      isRejected ? '!border-carbon-support-error/40' : ''
    }`}>
      {/* Phase + Label */}
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-xs font-medium text-carbon-text-helper uppercase tracking-wider">RLA Audit</h3>
        <span className={`carbon-tag ${
          isRejected ? 'bg-carbon-support-error/20 text-carbon-support-error-light' :
          isChallenged ? 'bg-carbon-support-error/20 text-carbon-support-error-light' :
          phase === AuditPhase.Finalized ? 'bg-carbon-support-success/20 text-carbon-support-success' :
          'bg-carbon-interactive/20 text-carbon-interactive'
        }`}>
          {PHASE_LABELS[phase] || 'Unknown'}
        </span>
      </div>

      {/* Sampling proofs */}
      <ProgressBar label="PM Proofs (sampled)" value={pmProofsVerified} max={pmSampleCount} />
      <ProgressBar label="TV Proofs (sampled)" value={tvProofsVerified} max={tvSampleCount} />

      {/* Challenge response progress */}
      {isChallenged && (
        <div className="mt-4 pt-4 border-t border-carbon-border-subtle">
          <div className="text-xs text-carbon-support-error-light font-medium mb-3 uppercase tracking-wider">
            Challenge Response
          </div>
          <ProgressBar label="PM Full Proofs" value={totalFullPm} max={pmBatchCount} variant="danger" />
          <ProgressBar label="TV Full Proofs" value={totalFullTv} max={tvBatchCount} variant="danger" />
        </div>
      )}

      {/* Stats grid */}
      <div className="mt-4 pt-4 border-t border-carbon-border-subtle grid grid-cols-2 gap-x-8 gap-y-3">
        <div>
          <div className="text-2xs text-carbon-text-helper uppercase tracking-wider mb-0.5">Margin</div>
          <div className="text-sm text-carbon-text-primary">{margin} votes ({marginPct}%)</div>
        </div>
        <div>
          <div className="text-2xs text-carbon-text-helper uppercase tracking-wider mb-0.5">Sampling</div>
          <div className="text-sm text-carbon-text-primary">
            {pmSampleCount}+{tvSampleCount} / {pmBatchCount}+{tvBatchCount}
          </div>
        </div>
        <div>
          <div className="text-2xs text-carbon-text-helper uppercase tracking-wider mb-0.5">Savings</div>
          <div className="text-sm text-carbon-text-primary">{savings}%</div>
        </div>
        <div>
          <div className="text-2xs text-carbon-text-helper uppercase tracking-wider mb-0.5">Challenge Period</div>
          <div className="text-sm text-carbon-text-primary">
            {phase === AuditPhase.Tentative && challengeRemaining > 0
              ? `${challengeDays}d ${challengeHours}h`
              : isChallenged ? 'Challenged'
              : phase >= AuditPhase.Finalized ? 'Completed'
              : 'Pending'}
          </div>
        </div>
      </div>

      {/* Challenge details */}
      {isChallenged && challenger && challenger !== zeroAddr && (
        <div className="mt-4 pt-4 border-t border-carbon-support-error/20">
          <div className="grid grid-cols-2 gap-x-8 gap-y-3">
            <div>
              <div className="text-2xs text-carbon-text-helper uppercase tracking-wider mb-0.5">Challenger</div>
              <div className="text-sm text-carbon-text-primary font-mono text-2xs">
                {challenger.slice(0, 10)}...{challenger.slice(-8)}
              </div>
            </div>
            <div>
              <div className="text-2xs text-carbon-text-helper uppercase tracking-wider mb-0.5">Bond</div>
              <div className="text-sm text-carbon-text-primary">
                {challengeBond ? (Number(challengeBond) / 1e18).toFixed(6) : '0'} ETH
              </div>
            </div>
            <div>
              <div className="text-2xs text-carbon-text-helper uppercase tracking-wider mb-0.5">Response Deadline</div>
              <div className="text-sm text-carbon-text-primary">
                {responseRemaining > 0
                  ? `${responseDays}d ${responseHours}h ${responseMinutes}m`
                  : 'Expired'}
              </div>
            </div>
            <div>
              <div className="text-2xs text-carbon-text-helper uppercase tracking-wider mb-0.5">Full Proofs</div>
              <div className="text-sm text-carbon-text-primary">
                {totalFullPm}/{pmBatchCount} PM, {totalFullTv}/{tvBatchCount} TV
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Phase stepper */}
      <div className="mt-5 pt-4 border-t border-carbon-border-subtle flex items-center">
        {PHASE_STEPS.map((step, i) => {
          const active = phase >= step.phase && !isRejected;
          const rejected = isRejected && step.phase <= phase;
          return (
            <div key={step.label} className="flex items-center">
              <div className={`w-2 h-2 ${
                rejected ? 'bg-carbon-support-error' :
                active ? 'bg-carbon-interactive' :
                'bg-carbon-layer-2'
              }`} />
              <span className={`ml-1.5 text-2xs uppercase tracking-wider ${
                rejected ? 'text-carbon-support-error-light' :
                active ? 'text-carbon-text-primary' :
                'text-carbon-text-disabled'
              }`}>
                {step.label}
              </span>
              {i < PHASE_STEPS.length - 1 && (
                <div className={`w-8 h-px mx-2 ${
                  rejected ? 'bg-carbon-support-error' :
                  active ? 'bg-carbon-interactive' :
                  'bg-carbon-layer-2'
                }`} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
