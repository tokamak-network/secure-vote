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

      // Get poll address first (local variable, not state)
      let currentPollAddr: string | null = null;

      if (maciAddress) {
        try {
          const pollResult = await publicClient.readContract({
            address: maciAddress,
            abi: MACI_ABI,
            functionName: 'getPoll',
            args: [BigInt(id as string)],
          } as any) as any;

          const pollAddr = pollResult[0] || pollResult.poll;
          currentPollAddr = pollAddr; // ✅ Save to local variable

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
          // Use local variable instead of stale state
          const pollAddr = currentPollAddr;

          if (!pollAddr) {
            throw new Error('Poll address not found');
          }

          // Use reverse mapping to get correct RLA Poll ID
          const rlaPollId = await publicClient.readContract({
            address: maciRlaAddress,
            abi: MACI_RLA_ABI,
            functionName: 'pollToAuditId',
            args: [pollAddr as `0x${string}`],
          } as any) as bigint;

          // If rlaPollId is 0 and poll address is not at audit 0, poll not yet committed
          const audit0 = await publicClient.readContract({
            address: maciRlaAddress,
            abi: MACI_RLA_ABI,
            functionName: 'pollAudits',
            args: [0n],
          } as any) as any;

          const poll0Address = audit0[1]?.toString().toLowerCase();
          const isAudit0 = poll0Address === pollAddr.toLowerCase();

          if (rlaPollId === 0n && !isAudit0) {
            // Poll not yet committed to RLA
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
          } else {
            // Use correct RLA Poll ID
            const result = await publicClient.readContract({
              address: maciRlaAddress,
              abi: MACI_RLA_ABI,
              functionName: 'pollAudits',
              args: [rlaPollId],
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
          }
        } catch (err) {
          console.error('Failed to load RLA audit:', err);
          // Default to Phase.None
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
        const res = await fetch(`/api/coordinator/process?pollId=${id}`);
        const data = await res.json();
        if (data.status) setCommitmentStatus(data.status);
        if (data.status === 'error' && data.error) {
          setError(`Extraction failed: ${data.error}${data.message ? ' - ' + data.message : ''}`);
        }
      } catch {}

      try {
        const res = await fetch(`/api/coordinator/rla-prove?pollId=${id}`);
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
      const res = await fetch(`/api/coordinator/process?pollId=${id}`);
      const data = await res.json();
      setCommitmentStatus(data.status || 'unknown');
      if (data.status === 'commitments-ready') {
        setSuccess(`Commitments extracted: ${data.pmBatchCount} PM + ${data.tvBatchCount} TV. Yes=${data.yesVotes} No=${data.noVotes}`);
        setActionLoading(null);
        await loadData(); // Reload to update button states
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
      const res = await fetch(`/api/coordinator/rla-prove?pollId=${id}`);
      const data = await res.json();
      setProveStatus(data.proveStatus || 'unknown');
      if (data.proveStatus === 'prove-complete') {
        setSuccess(`Proofs generated: ${data.proved || data.totalToProve} sampled batch proofs ready`);
        setActionLoading(null);
        await loadData(); // Reload phase after proofs complete
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

      // Check HTTP status first
      if (!res.ok) {
        const err: any = new Error(data.error || `${action} failed`);
        err.details = data.details;
        err.suggestion = data.suggestion;
        throw err;
      }

      // Then check success field
      if (!data.success) {
        const err: any = new Error(data.error || `${action} failed`);
        err.details = data.details;
        err.suggestion = data.suggestion;
        throw err;
      }

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

      // Special handling for rla-proofs with detailed feedback
      if (action === 'rla-proofs') {
        const pmNew = data.pmSubmittedNow || 0;
        const tvNew = data.tvSubmittedNow || 0;
        const total = pmNew + tvNew;

        if (total === 0) {
          setSuccess('All proofs already submitted ✓');
        } else {
          setSuccess(`${total} proof${total > 1 ? 's' : ''} submitted successfully (PM: ${pmNew}, TV: ${tvNew})`);
        }

        await loadData();
        setTimeout(() => setSuccess(null), 5000);
        setActionLoading(null);
        return;
      }

      // Special handling for rla-finalize
      if (action === 'rla-finalize') {
        setSuccess('🎉 Poll finalized successfully! Result is now official and immutable.');
        await loadData();
        setTimeout(() => setSuccess(null), 8000);
        setActionLoading(null);
        return;
      }

      setSuccess(`${action} completed`);
      await loadData();
      setTimeout(() => setSuccess(null), 5000);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : `${action} failed`;
      const details = (err as any).details ? `\n\n${(err as any).details}` : '';
      const suggestion = (err as any).suggestion ? `\n\n💡 ${(err as any).suggestion}` : '';
      setError(errorMsg + details + suggestion);
    } finally {
      if (action !== 'process' && action !== 'rla-prove' && action !== 'challenge-respond') {
        setActionLoading(null);
      }
    }
  };

  if (loading) {
    return (
      <Layout>
        <div className="py-24 text-center">
          <div className="inline-flex items-center gap-3 text-text-zinc-500 text-sm">
            <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            Loading...
          </div>
        </div>
      </Layout>
    );
  }

  const phase = audit?.phase ?? AuditPhase.None;
  const isExtracting = ['starting', 'time-traveling', 'merging-trees', 'computing-inputs'].includes(commitmentStatus);
  const commitmentsReady = commitmentStatus === 'commitments-ready';
  const isProving = proveStatus === 'proving';
  const provesReady = proveStatus === 'prove-complete';

  // Check if all sampled proofs have been submitted
  const allProofsSubmitted = audit ?
    (audit.pmProofsVerified >= audit.pmSampleCount && audit.tvProofsVerified >= audit.tvSampleCount) :
    false;

  // Audit is complete - no more actions needed
  const isComplete = phase === AuditPhase.Finalized || phase === AuditPhase.Rejected;

  const actions = [
    {
      key: 'process',
      label: isExtracting
        ? `Extracting... (${commitmentStatus})`
        : commitmentsReady ? 'Commitments Ready ✓' : 'Extract Commitments',
      description: commitmentsReady
        ? 'Commitments extracted and ready for RLA commit'
        : 'Compute circuit inputs + commitments (no proof generation)',
      enabled: !isExtracting && !commitmentsReady && phase === AuditPhase.None,
    },
    {
      key: 'rla-commit',
      label: 'RLA Commit',
      description: 'Stake ETH and commit state commitments to MaciRLA',
      enabled: !isComplete && phase === AuditPhase.None && commitmentsReady,
    },
    {
      key: 'rla-reveal',
      label: 'RLA Reveal',
      description: 'Derive random batch indices from blockhash',
      enabled: !isComplete && phase === AuditPhase.Committed,
    },
    {
      key: 'rla-prove',
      label: isProving
        ? 'Generating Proofs...'
        : provesReady ? 'Proofs Ready ✓' : 'Generate Sampled Proofs',
      description: provesReady
        ? 'Proofs generated and ready for submission'
        : 'Groth16 proofs for randomly selected batches only',
      enabled: !isComplete && phase === AuditPhase.SampleRevealed && !isProving && !provesReady,
    },
    {
      key: 'rla-proofs',
      label: allProofsSubmitted ? 'Proofs Submitted ✓' : 'Submit Proofs',
      description: allProofsSubmitted
        ? 'All sampled proofs verified on-chain'
        : 'Submit proofs to MaciRLA for on-chain verification',
      enabled: !isComplete && phase === AuditPhase.SampleRevealed && provesReady && !allProofsSubmitted,
    },
    {
      key: 'rla-finalize',
      label: phase === AuditPhase.Finalized ? 'Finalized ✓' : 'Finalize',
      description: phase === AuditPhase.Finalized
        ? 'Audit complete and result verified'
        : 'Finalize sampling + challenge period + result',
      enabled: !isComplete && ((phase === AuditPhase.SampleRevealed && allProofsSubmitted) || phase === AuditPhase.Tentative),
    },
  ];

  const isChallenged = phase === AuditPhase.Challenged;

  return (
    <Layout>
      <CoordinatorGuard>
        <div className="max-w-2xl mx-auto">
          <Link href="/coordinator" className="inline-flex items-center gap-1.5 text-sm text-text-zinc-500 hover:text-accent-blue transition-colors mb-8">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Dashboard
          </Link>

          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-heading font-bold text-text-white">Poll #{id}</h1>
            <span className={`sv-tag ${
              phase === AuditPhase.None ? 'bg-surface-dark-2 text-text-zinc-500' :
              phase === AuditPhase.Finalized ? 'bg-sv-emerald/15 text-emerald-500' :
              phase === AuditPhase.Rejected ? 'bg-sv-error/15 text-rose-400' :
              'bg-sv-warning/15 text-amber-500'
            }`}>
              <span className={`sv-badge-dot ${
                phase === AuditPhase.None ? 'bg-text-zinc-600' :
                phase === AuditPhase.Finalized ? 'bg-sv-emerald' :
                phase === AuditPhase.Rejected ? 'bg-sv-error' :
                'bg-sv-warning'
              }`} />
              {PHASE_LABELS[phase] || 'Not Started'}
            </span>
          </div>
          <p className="text-sm text-text-zinc-500 mb-8">Coordinator management</p>

          {(error || success) && (
            <div className={`mb-6 px-5 py-4 text-sm rounded-lg border flex items-start gap-3 ${
              success
                ? 'bg-emerald-950/20 text-emerald-500 border-sv-emerald/20'
                : 'bg-rose-950/20 text-rose-400 border-rose-500/20'
            }`}>
              <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                {success ? (
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                ) : (
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                )}
              </svg>
              {success || error}
            </div>
          )}

          {/* Poll Info */}
          {pollInfo && (
            <div className="bg-surface-dark border border-border-dark p-6 mb-5">
              <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-5">Poll Info</h3>
              <div className="grid grid-cols-4 gap-6">
                <div>
                  <div className="text-[10px] font-bold tracking-widest text-zinc-500 uppercase">Address</div>
                  <div className="text-xs text-text-white font-mono text-2xs mt-1">
                    {pollInfo.pollAddress.slice(0, 10)}...{pollInfo.pollAddress.slice(-6)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-bold tracking-widest text-zinc-500 uppercase">Messages</div>
                  <div className="text-lg font-bold text-text-white mt-1">{pollInfo.messageCount}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold tracking-widest text-zinc-500 uppercase">Signups</div>
                  <div className="text-lg font-bold text-text-white mt-1">{pollInfo.voterCount}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold tracking-widest text-zinc-500 uppercase">Duration</div>
                  <div className="text-lg font-bold text-text-white mt-1">{Math.round(pollInfo.duration / 60)}m</div>
                </div>
              </div>
            </div>
          )}

          {/* RLA Status */}
          {audit && phase > AuditPhase.None && (
            <div className="mb-5">
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
          <div className="bg-surface-dark border border-border-dark p-6 mb-5">
            <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-5">Actions</h3>
            <div className="space-y-2">
              {actions.map((action, i) => (
                <div
                  key={action.key}
                  className={`flex items-center justify-between p-4 rounded-lg transition-all ${
                    action.enabled ? 'bg-surface-dark-hover/50 hover:bg-surface-dark-hover' : 'opacity-35'
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-2xs font-bold ${
                      action.enabled ? 'bg-sv-accent/20 text-accent-blue border border-sv-accent/40' : 'bg-surface-dark-2 text-text-zinc-600 border border-border-dark'
                    }`}>{i + 1}</div>
                    <div>
                      <div className="text-sm text-text-white font-medium">{action.label}</div>
                      <div className="text-2xs text-text-zinc-500 mt-0.5">{action.description}</div>
                    </div>
                  </div>
                  <button
                    onClick={() => runAction(action.key)}
                    disabled={!action.enabled || actionLoading !== null}
                    className="bg-accent-blue text-white px-5 py-2.5 text-sm font-medium hover:bg-blue-600 disabled:opacity-50 transition-colors text-xs px-4 py-2 shrink-0"
                  >
                    {actionLoading === action.key ? 'Running...' : 'Run'}
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Challenge Response */}
          {isChallenged && (
            <div className="bg-surface-dark border border-border-dark border-sv-error/30 shadow-glow-error p-6 mb-5">
              <div className="flex items-center gap-2 mb-4">
                <svg className="w-4 h-4 text-rose-400" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                <h3 className="text-sm font-semibold text-rose-400 uppercase tracking-wider">
                  Challenge Response Required
                </h3>
              </div>
              <div className="flex items-center justify-between p-4 bg-sv-error/5 rounded-lg">
                <div>
                  <div className="text-sm text-text-white font-medium">Respond to Challenge</div>
                  <div className="text-2xs text-text-zinc-500 mt-0.5">
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
                  className="bg-rose-600 text-white px-5 py-2.5 text-sm font-medium hover:bg-rose-700 disabled:opacity-50 transition-colors text-xs px-4 py-2 shrink-0"
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
                className="text-sm text-accent-blue hover:text-accent-blue-hover transition-colors"
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
