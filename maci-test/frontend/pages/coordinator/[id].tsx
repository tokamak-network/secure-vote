import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { usePublicClient } from 'wagmi';
import Layout from '@/components/Layout';
import CoordinatorGuard from '@/components/CoordinatorGuard';
import RlaStatus from '@/components/RlaStatus';
import Link from 'next/link';
import { MACI_RLA_ABI, MACI_ABI, POLL_ABI, AuditPhase, PHASE_LABELS } from '@/lib/contracts';

interface AuditData {
  phase: number;
  yesVotes: bigint;
  noVotes: bigint;
  pmBatchCount: number;
  tvBatchCount: number;
  pmSampleCount: number;
  tvSampleCount: number;
  pmProofsVerified: number;
  tvProofsVerified: number;
  tentativeTimestamp: number;
  challengeDeadline: number;
  challenger: string;
  challengeBond: bigint;
  fullPmProofsVerified: number;
  fullTvProofsVerified: number;
  coordinator: string;
  stakeAmount: bigint;
}

interface PollInfo {
  pollAddress: string;
  voterCount: number;
  messageCount: number;
  deployTime: number;
  duration: number;
}

export default function CoordinatorManage() {
  const router = useRouter();
  const { id } = router.query;
  const publicClient = usePublicClient();
  const [audit, setAudit] = useState<AuditData | null>(null);
  const [pollInfo, setPollInfo] = useState<PollInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [challengePeriod, setChallengePeriod] = useState(604800);
  const [commitmentStatus, setCommitmentStatus] = useState<string>('not-started');
  const [proveStatus, setProveStatus] = useState<string>('not-started');

  useEffect(() => {
    if (id !== undefined) loadData();
  }, [id, publicClient]);

  const loadData = async () => {
    if (!publicClient || id === undefined) return;
    const maciAddress = process.env.NEXT_PUBLIC_MACI_ADDRESS as `0x${string}` | undefined;
    const maciRlaAddress = process.env.NEXT_PUBLIC_MACI_RLA_ADDRESS as `0x${string}` | undefined;

    try {
      setLoading(true);

      if (maciAddress) {
        try {
          const pollResult = await publicClient.readContract({
            address: maciAddress,
            abi: MACI_ABI,
            functionName: 'getPoll',
            args: [BigInt(id as string)],
          } as any) as any;

          const pollAddr = pollResult[0] || pollResult.poll;
          if (pollAddr) {
            const numInfo = await publicClient.readContract({
              address: pollAddr as `0x${string}`,
              abi: POLL_ABI,
              functionName: 'numSignUpsAndMessages',
            } as any) as any;

            let deployTime = 0, duration = 0;
            try {
              const timeInfo = await publicClient.readContract({
                address: pollAddr as `0x${string}`,
                abi: POLL_ABI,
                functionName: 'getDeployTimeAndDuration',
              } as any) as any;
              deployTime = Number(timeInfo[0]);
              duration = Number(timeInfo[1]);
            } catch {}

            setPollInfo({
              pollAddress: pollAddr,
              voterCount: Number(numInfo[0] || 0),
              messageCount: Number(numInfo[1] || 0),
              deployTime,
              duration,
            });
          }
        } catch {}
      }

      if (maciRlaAddress) {
        try {
          const period = await publicClient.readContract({
            address: maciRlaAddress,
            abi: MACI_RLA_ABI,
            functionName: 'CHALLENGE_PERIOD',
          } as any) as bigint;
          setChallengePeriod(Number(period));
        } catch {}

        try {
          const result = await publicClient.readContract({
            address: maciRlaAddress,
            abi: MACI_RLA_ABI,
            functionName: 'pollAudits',
            args: [BigInt(id as string)],
          } as any) as any;

          setAudit({
            coordinator: result[0],
            stakeAmount: result[2],
            yesVotes: result[3],
            noVotes: result[4],
            pmBatchCount: Number(result[5]),
            tvBatchCount: Number(result[6]),
            pmSampleCount: Number(result[11]),
            tvSampleCount: Number(result[12]),
            pmProofsVerified: Number(result[13]),
            tvProofsVerified: Number(result[14]),
            tentativeTimestamp: Number(result[16]),
            challengeDeadline: Number(result[17]),
            challenger: result[18],
            challengeBond: result[19],
            fullPmProofsVerified: Number(result[20]),
            fullTvProofsVerified: Number(result[21]),
            phase: Number(result[22]),
          });
        } catch {
          setAudit({
            coordinator: '0x0000000000000000000000000000000000000000',
            stakeAmount: 0n,
            yesVotes: 0n,
            noVotes: 0n,
            pmBatchCount: 0,
            tvBatchCount: 0,
            pmSampleCount: 0,
            tvSampleCount: 0,
            pmProofsVerified: 0,
            tvProofsVerified: 0,
            tentativeTimestamp: 0,
            challengeDeadline: 0,
            challenger: '0x0000000000000000000000000000000000000000',
            challengeBond: 0n,
            fullPmProofsVerified: 0,
            fullTvProofsVerified: 0,
            phase: AuditPhase.None,
          });
        }
      } else {
        setError('MaciRLA address not configured');
      }

      try {
        const res = await fetch('/api/coordinator/process');
        const data = await res.json();
        if (data.status) setCommitmentStatus(data.status);
      } catch {}

      try {
        const res = await fetch('/api/coordinator/rla-prove');
        const data = await res.json();
        if (data.proveStatus) setProveStatus(data.proveStatus);
      } catch {}
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  const pollCommitmentStatus = async () => {
    try {
      const res = await fetch('/api/coordinator/process');
      const data = await res.json();
      setCommitmentStatus(data.status || 'unknown');
      if (data.status === 'commitments-ready') {
        setSuccess(`Commitments extracted: ${data.pmBatchCount} PM + ${data.tvBatchCount} TV. Yes=${data.yesVotes} No=${data.noVotes}`);
        setActionLoading(null);
        return;
      }
      if (data.status === 'error') {
        setError(`Extraction failed: ${data.error}`);
        setActionLoading(null);
        return;
      }
      if (['starting', 'time-traveling', 'merging-trees', 'computing-inputs'].includes(data.status)) {
        setTimeout(pollCommitmentStatus, 3000);
      }
    } catch {
      setTimeout(pollCommitmentStatus, 5000);
    }
  };

  const pollProveStatus = async () => {
    try {
      const res = await fetch('/api/coordinator/rla-prove');
      const data = await res.json();
      setProveStatus(data.proveStatus || 'unknown');
      if (data.proveStatus === 'prove-complete') {
        setSuccess(`Proofs generated: ${data.proved || data.totalToProve} sampled batch proofs ready`);
        setActionLoading(null);
        return;
      }
      if (data.proveStatus === 'prove-error') {
        setError(`Proof generation failed: ${data.error}`);
        setActionLoading(null);
        return;
      }
      if (data.proveStatus === 'proving') {
        setTimeout(pollProveStatus, 3000);
      }
    } catch {
      setTimeout(pollProveStatus, 5000);
    }
  };

  const runAction = async (action: string) => {
    try {
      setActionLoading(action);
      setError(null);

      const res = await fetch(`/api/coordinator/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pollId: Number(id) }),
      });

      const data = await res.json();
      if (!data.success) throw new Error(data.error || `${action} failed`);

      if (action === 'process') {
        setCommitmentStatus('starting');
        setTimeout(pollCommitmentStatus, 3000);
        return;
      }

      if (action === 'rla-prove') {
        setProveStatus('proving');
        setTimeout(pollProveStatus, 3000);
        return;
      }

      if (action === 'challenge-respond') {
        setProveStatus('proving');
        setTimeout(pollProveStatus, 3000);
        return;
      }

      setSuccess(`${action} completed`);
      await loadData();
      setTimeout(() => setSuccess(null), 5000);
    } catch (err) {
      setError(err instanceof Error ? err.message : `${action} failed`);
    } finally {
      if (action !== 'process' && action !== 'rla-prove' && action !== 'challenge-respond') {
        setActionLoading(null);
      }
    }
  };

  if (loading) {
    return (
      <Layout>
        <div className="py-20 text-center text-carbon-text-disabled text-sm">Loading...</div>
      </Layout>
    );
  }

  const phase = audit?.phase ?? AuditPhase.None;
  const isExtracting = ['starting', 'time-traveling', 'merging-trees', 'computing-inputs'].includes(commitmentStatus);
  const commitmentsReady = commitmentStatus === 'commitments-ready';
  const isProving = proveStatus === 'proving';
  const provesReady = proveStatus === 'prove-complete';

  const actions = [
    {
      key: 'process',
      label: isExtracting
        ? `Extracting... (${commitmentStatus})`
        : commitmentsReady ? 'Commitments Ready' : 'Extract Commitments',
      description: 'Compute circuit inputs + commitments (no proof generation)',
      enabled: !isExtracting && phase === AuditPhase.None,
    },
    {
      key: 'rla-commit',
      label: 'RLA Commit',
      description: 'Stake ETH and commit state commitments to MaciRLA',
      enabled: phase === AuditPhase.None && commitmentsReady,
    },
    {
      key: 'rla-reveal',
      label: 'RLA Reveal',
      description: 'Derive random batch indices from blockhash',
      enabled: phase === AuditPhase.Committed,
    },
    {
      key: 'rla-prove',
      label: isProving
        ? 'Generating Proofs...'
        : provesReady ? 'Proofs Ready' : 'Generate Sampled Proofs',
      description: 'Groth16 proofs for randomly selected batches only',
      enabled: phase === AuditPhase.SampleRevealed && !isProving,
    },
    {
      key: 'rla-proofs',
      label: 'Submit Proofs',
      description: 'Submit proofs to MaciRLA for on-chain verification',
      enabled: phase === AuditPhase.SampleRevealed && provesReady,
    },
    {
      key: 'rla-finalize',
      label: 'Finalize',
      description: 'Finalize sampling + challenge period + result',
      enabled: phase === AuditPhase.SampleRevealed || phase === AuditPhase.Tentative,
    },
  ];

  const isChallenged = phase === AuditPhase.Challenged;

  return (
    <Layout>
      <CoordinatorGuard>
        <div className="max-w-2xl mx-auto">
          <Link href="/coordinator" className="text-sm text-carbon-text-helper hover:text-carbon-text-secondary transition-colors mb-6 inline-block">
            &larr; Dashboard
          </Link>

          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-heading font-semibold text-carbon-text-primary">Poll #{id}</h1>
            <span className={`carbon-tag ${
              phase === AuditPhase.None ? 'bg-carbon-layer-2 text-carbon-text-helper' :
              phase === AuditPhase.Finalized ? 'bg-carbon-support-success/20 text-carbon-support-success' :
              phase === AuditPhase.Rejected ? 'bg-carbon-support-error/20 text-carbon-support-error-light' :
              'bg-carbon-support-warning/20 text-carbon-support-warning'
            }`}>
              {PHASE_LABELS[phase] || 'Not Started'}
            </span>
          </div>
          <p className="text-sm text-carbon-text-helper mb-8">Coordinator management</p>

          {(error || success) && (
            <div className={`mb-6 px-4 py-3 text-sm border-l-2 ${
              success
                ? 'bg-carbon-support-success/10 text-carbon-support-success border-carbon-support-success'
                : 'bg-carbon-support-error/10 text-carbon-support-error-light border-carbon-support-error'
            }`}>
              {success || error}
            </div>
          )}

          {/* Poll Info */}
          {pollInfo && (
            <div className="carbon-card p-5 mb-4">
              <h3 className="text-xs font-medium text-carbon-text-helper uppercase tracking-wider mb-4">Poll Info</h3>
              <div className="grid grid-cols-4 gap-x-6 gap-y-3">
                <div>
                  <div className="text-2xs text-carbon-text-helper uppercase tracking-wider mb-0.5">Address</div>
                  <div className="text-xs text-carbon-text-primary font-mono text-2xs">
                    {pollInfo.pollAddress.slice(0, 10)}...{pollInfo.pollAddress.slice(-6)}
                  </div>
                </div>
                <div>
                  <div className="text-2xs text-carbon-text-helper uppercase tracking-wider mb-0.5">Messages</div>
                  <div className="text-sm text-carbon-text-primary">{pollInfo.messageCount}</div>
                </div>
                <div>
                  <div className="text-2xs text-carbon-text-helper uppercase tracking-wider mb-0.5">Signups</div>
                  <div className="text-sm text-carbon-text-primary">{pollInfo.voterCount}</div>
                </div>
                <div>
                  <div className="text-2xs text-carbon-text-helper uppercase tracking-wider mb-0.5">Duration</div>
                  <div className="text-sm text-carbon-text-primary">{Math.round(pollInfo.duration / 60)}m</div>
                </div>
              </div>
            </div>
          )}

          {/* RLA Status */}
          {audit && phase > AuditPhase.None && (
            <div className="mb-4">
              <RlaStatus
                phase={phase}
                pmSampleCount={audit.pmSampleCount}
                tvSampleCount={audit.tvSampleCount}
                pmProofsVerified={audit.pmProofsVerified}
                tvProofsVerified={audit.tvProofsVerified}
                pmBatchCount={audit.pmBatchCount}
                tvBatchCount={audit.tvBatchCount}
                yesVotes={audit.yesVotes}
                noVotes={audit.noVotes}
                tentativeTimestamp={audit.tentativeTimestamp}
                challengePeriod={challengePeriod}
                challenger={audit.challenger}
                challengeBond={audit.challengeBond}
                challengeDeadline={audit.challengeDeadline}
                fullPmProofsVerified={audit.fullPmProofsVerified}
                fullTvProofsVerified={audit.fullTvProofsVerified}
              />
            </div>
          )}

          {/* Actions */}
          <div className="carbon-card p-5 mb-4">
            <h3 className="text-xs font-medium text-carbon-text-helper uppercase tracking-wider mb-4">Actions</h3>
            <div className="space-y-2">
              {actions.map((action, i) => (
                <div
                  key={action.key}
                  className={`flex items-center justify-between p-3 transition-colors ${
                    action.enabled ? 'bg-carbon-layer-hover/50 hover:bg-carbon-layer-hover' : 'opacity-35'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-5 h-5 flex items-center justify-center text-2xs font-medium ${
                      action.enabled ? 'bg-carbon-interactive/20 text-carbon-interactive' : 'bg-carbon-layer-2 text-carbon-text-disabled'
                    }`}>{i + 1}</div>
                    <div>
                      <div className="text-sm text-carbon-text-primary font-medium">{action.label}</div>
                      <div className="text-2xs text-carbon-text-helper mt-0.5">{action.description}</div>
                    </div>
                  </div>
                  <button
                    onClick={() => runAction(action.key)}
                    disabled={!action.enabled || actionLoading !== null}
                    className="carbon-btn-primary text-xs px-3 py-1.5 shrink-0"
                  >
                    {actionLoading === action.key ? 'Running...' : 'Run'}
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Challenge Response */}
          {isChallenged && (
            <div className="carbon-card !border-carbon-support-error/30 p-5 mb-4">
              <h3 className="text-xs font-medium text-carbon-support-error-light uppercase tracking-wider mb-4">
                Challenge Response Required
              </h3>
              <div className="flex items-center justify-between p-3 bg-carbon-support-error/5">
                <div>
                  <div className="text-sm text-carbon-text-primary font-medium">Respond to Challenge</div>
                  <div className="text-2xs text-carbon-text-helper mt-0.5">
                    Generate all remaining proofs. Deadline: {
                      audit?.challengeDeadline
                        ? new Date(audit.challengeDeadline * 1000).toLocaleString()
                        : 'unknown'
                    }
                  </div>
                </div>
                <button
                  onClick={() => runAction('challenge-respond')}
                  disabled={actionLoading !== null}
                  className="carbon-btn-danger text-xs px-3 py-1.5 shrink-0"
                >
                  {actionLoading === 'challenge-respond' ? 'Running...' : 'Respond'}
                </button>
              </div>
            </div>
          )}

          {/* Results link */}
          {phase >= AuditPhase.Committed && (
            <div className="text-center">
              <Link
                href={`/elections/${id}/results`}
                className="text-sm text-carbon-interactive hover:text-carbon-interactive-hover transition-colors"
              >
                View Public Results &rarr;
              </Link>
            </div>
          )}
        </div>
      </CoordinatorGuard>
    </Layout>
  );
}
