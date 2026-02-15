import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { usePublicClient, useAccount, useWalletClient } from 'wagmi';
import Layout from '@/components/Layout';
import RlaStatus from '@/components/RlaStatus';
import Link from 'next/link';
import { MACI_RLA_ABI, AuditPhase } from '@/lib/contracts';

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

export default function ElectionResults() {
  const router = useRouter();
  const { id } = router.query;
  const publicClient = usePublicClient();
  const { address: userAddress } = useAccount();
  const { data: walletClientData } = useWalletClient();
  const [audit, setAudit] = useState<AuditData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [challengePeriod, setChallengePeriod] = useState(604800);
  const [challengeBondRequired, setChallengeBondRequired] = useState<bigint>(0n);
  const [challengeLoading, setChallengeLoading] = useState(false);

  useEffect(() => {
    if (id !== undefined) loadAudit();
  }, [id, publicClient]);

  const loadAudit = async () => {
    if (!publicClient || id === undefined) return;
    const maciRlaAddress = process.env.NEXT_PUBLIC_MACI_RLA_ADDRESS as `0x${string}` | undefined;
    if (!maciRlaAddress) {
      setError('MaciRLA address not configured');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);

      const period = await publicClient.readContract({
        address: maciRlaAddress,
        abi: MACI_RLA_ABI,
        functionName: 'CHALLENGE_PERIOD',
      } as any) as bigint;
      setChallengePeriod(Number(period));

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

      try {
        const bond = await publicClient.readContract({
          address: maciRlaAddress,
          abi: MACI_RLA_ABI,
          functionName: 'getChallengeBondAmount',
          args: [BigInt(id as string)],
        } as any) as bigint;
        setChallengeBondRequired(bond);
      } catch {}
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load audit data');
    } finally {
      setLoading(false);
    }
  };

  const handleChallenge = async () => {
    if (!walletClientData || !publicClient) return;
    const maciRlaAddress = process.env.NEXT_PUBLIC_MACI_RLA_ADDRESS as `0x${string}`;
    if (!maciRlaAddress) return;

    try {
      setChallengeLoading(true);
      setError(null);

      const hash = await walletClientData.writeContract({
        address: maciRlaAddress,
        abi: MACI_RLA_ABI,
        functionName: 'challenge',
        args: [BigInt(id as string)],
        value: challengeBondRequired,
      } as any);

      await publicClient.waitForTransactionReceipt({ hash });
      setSuccess('Challenge submitted. Coordinator must now prove all batches.');
      await loadAudit();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Challenge failed');
    } finally {
      setChallengeLoading(false);
    }
  };

  const handleClaimTimeout = async () => {
    if (!walletClientData || !publicClient) return;
    const maciRlaAddress = process.env.NEXT_PUBLIC_MACI_RLA_ADDRESS as `0x${string}`;
    if (!maciRlaAddress) return;

    try {
      setChallengeLoading(true);
      setError(null);

      const hash = await walletClientData.writeContract({
        address: maciRlaAddress,
        abi: MACI_RLA_ABI,
        functionName: 'claimChallengeTimeout',
        args: [BigInt(id as string)],
      } as any);

      await publicClient.waitForTransactionReceipt({ hash });
      setSuccess('Timeout claimed. Result rejected, stake slashed.');
      await loadAudit();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Claim timeout failed');
    } finally {
      setChallengeLoading(false);
    }
  };

  if (loading) {
    return (
      <Layout>
        <div className="py-24 text-center">
          <div className="inline-flex items-center gap-3 text-sv-text-muted text-sm">
            <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            Loading results...
          </div>
        </div>
      </Layout>
    );
  }

  if (error && !audit) {
    return (
      <Layout>
        <div className="py-24 text-center text-sv-error-light text-sm">{error || 'Audit not found'}</div>
      </Layout>
    );
  }

  if (!audit) {
    return (
      <Layout>
        <div className="py-24 text-center text-sv-error-light text-sm">Audit not found</div>
      </Layout>
    );
  }

  const totalVotes = Number(audit.yesVotes + audit.noVotes);
  const yesPct = totalVotes > 0 ? Math.round((Number(audit.yesVotes) / totalVotes) * 100) : 0;
  const noPct = totalVotes > 0 ? Math.round((Number(audit.noVotes) / totalVotes) * 100) : 0;
  const isFinalized = audit.phase === AuditPhase.Finalized;
  const isRejected = audit.phase === AuditPhase.Rejected;
  const isTentative = audit.phase === AuditPhase.Tentative;
  const isChallenged = audit.phase === AuditPhase.Challenged;

  const now = Math.floor(Date.now() / 1000);
  const challengeDeadlinePassed = audit.challengeDeadline > 0 && now > audit.challengeDeadline;
  const zeroAddr = '0x0000000000000000000000000000000000000000';

  return (
    <Layout>
      <div className="max-w-2xl mx-auto">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-sv-text-muted hover:text-sv-accent transition-colors mb-8">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Elections
        </Link>

        <div className="flex items-center gap-3 mb-2">
          <h1 className="text-heading font-bold text-sv-text-primary">Election #{id}</h1>
          <span className={`sv-tag ${
            isFinalized ? 'bg-sv-emerald/15 text-sv-emerald' :
            isRejected ? 'bg-sv-error/15 text-sv-error-light' :
            isChallenged ? 'bg-sv-error/15 text-sv-error-light' :
            'bg-sv-warning/15 text-sv-warning'
          }`}>
            <span className={`sv-badge-dot ${
              isFinalized ? 'bg-sv-emerald' :
              isRejected || isChallenged ? 'bg-sv-error' :
              'bg-sv-warning'
            }`} />
            {isFinalized ? 'Finalized' :
             isRejected ? 'Rejected' :
             isChallenged ? 'Challenged' :
             isTentative ? 'Tentative' : 'Auditing'}
          </span>
        </div>
        <p className="text-sm text-sv-text-muted mb-10">
          {isFinalized ? 'Result verified and finalized.' :
           isRejected ? 'Result rejected — audit failed.' :
           isChallenged ? 'Awaiting coordinator response to challenge.' :
           isTentative ? 'Challenge period active.' :
           'Audit in progress.'}
        </p>

        {(error || success) && (
          <div className={`mb-8 px-5 py-4 text-sm rounded-lg border flex items-start gap-3 ${
            success
              ? 'bg-sv-emerald/10 text-sv-emerald border-sv-emerald/20'
              : 'bg-sv-error/10 text-sv-error-light border-sv-error/20'
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

        {/* Vote Results */}
        <div className="sv-card p-6 mb-5">
          <h3 className="sv-section-label mb-6">Vote Tally</h3>

          <div className="space-y-5">
            <div>
              <div className="flex justify-between items-baseline mb-2">
                <span className="text-sm font-medium text-sv-emerald">Yes / For</span>
                <div className="text-right">
                  <span className="text-2xl font-bold text-sv-text-primary">{yesPct}%</span>
                  <span className="text-xs text-sv-text-muted ml-2 font-mono">
                    {Number(audit.yesVotes)} votes
                  </span>
                </div>
              </div>
              <div className="h-2.5 bg-sv-surface-2 rounded-full overflow-hidden">
                <div className="h-full bg-sv-emerald rounded-full transition-all duration-500" style={{ width: `${yesPct}%` }} />
              </div>
            </div>

            <div>
              <div className="flex justify-between items-baseline mb-2">
                <span className="text-sm font-medium text-sv-error-light">No / Against</span>
                <div className="text-right">
                  <span className="text-2xl font-bold text-sv-text-primary">{noPct}%</span>
                  <span className="text-xs text-sv-text-muted ml-2 font-mono">
                    {Number(audit.noVotes)} votes
                  </span>
                </div>
              </div>
              <div className="h-2.5 bg-sv-surface-2 rounded-full overflow-hidden">
                <div className="h-full bg-sv-error-light rounded-full transition-all duration-500" style={{ width: `${noPct}%` }} />
              </div>
            </div>
          </div>

          <div className="mt-5 pt-5 border-t border-sv-border-subtle flex items-center justify-between text-xs text-sv-text-muted">
            <span>Total: {totalVotes} votes</span>
            <span>Margin: {Math.abs(yesPct - noPct)}%</span>
          </div>
        </div>

        {/* RLA Status */}
        <div className="mb-5">
          <RlaStatus
            phase={audit.phase}
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

        {/* Challenge Action */}
        {isTentative && (
          <div className="sv-card border-sv-warning/30 shadow-glow-warning p-6 mb-5">
            <div className="flex items-center gap-2 mb-4">
              <svg className="w-4 h-4 text-sv-warning" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              <h3 className="text-sm font-semibold text-sv-warning uppercase tracking-wider">
                Challenge Result
              </h3>
            </div>
            <p className="text-xs text-sv-text-muted mb-5">
              Post a bond to force the coordinator to prove ALL batches.
              If they fail to respond within 3 days, the result is rejected and you receive
              the coordinator&apos;s stake + your bond.
            </p>
            <div className="flex items-center justify-between">
              <div className="text-xs">
                <span className="text-sv-text-muted">Bond: </span>
                <span className="text-sv-text-primary font-mono font-semibold">
                  {(Number(challengeBondRequired) / 1e18).toFixed(6)} ETH
                </span>
              </div>
              <button
                onClick={handleChallenge}
                disabled={challengeLoading || !walletClientData}
                className="sv-btn-warning"
              >
                {challengeLoading ? 'Submitting...' : 'Challenge'}
              </button>
            </div>
            {!walletClientData && (
              <p className="text-xs text-sv-error-light mt-3">Connect wallet to challenge.</p>
            )}
          </div>
        )}

        {/* Challenged — claim timeout */}
        {isChallenged && (
          <div className="sv-card border-sv-error/30 shadow-glow-error p-6 mb-5">
            <div className="flex items-center gap-2 mb-4">
              <svg className="w-4 h-4 text-sv-error-light" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              <h3 className="text-sm font-semibold text-sv-error-light uppercase tracking-wider">
                Challenge Active
              </h3>
            </div>
            <div className="grid grid-cols-2 gap-6 mb-5">
              <div>
                <div className="sv-stat-label">Challenger</div>
                <div className="text-sm text-sv-text-primary font-mono text-2xs mt-1">
                  {audit.challenger !== zeroAddr
                    ? `${audit.challenger.slice(0, 10)}...${audit.challenger.slice(-8)}`
                    : 'None'}
                </div>
              </div>
              <div>
                <div className="sv-stat-label">Bond</div>
                <div className="text-sm text-sv-text-primary mt-1">
                  {(Number(audit.challengeBond) / 1e18).toFixed(6)} ETH
                </div>
              </div>
              <div>
                <div className="sv-stat-label">Deadline</div>
                <div className="text-sm text-sv-text-primary mt-1">
                  {audit.challengeDeadline > 0
                    ? new Date(audit.challengeDeadline * 1000).toLocaleString()
                    : 'N/A'}
                </div>
              </div>
              <div>
                <div className="sv-stat-label">Status</div>
                <div className={`text-sm font-semibold mt-1 ${challengeDeadlinePassed ? 'text-sv-error-light' : 'text-sv-warning'}`}>
                  {challengeDeadlinePassed ? 'Deadline passed' : 'Awaiting response'}
                </div>
              </div>
            </div>
            {challengeDeadlinePassed && (
              <button
                onClick={handleClaimTimeout}
                disabled={challengeLoading || !walletClientData}
                className="sv-btn-danger w-full"
              >
                {challengeLoading ? 'Claiming...' : 'Claim Timeout (Reject Result)'}
              </button>
            )}
          </div>
        )}

        {/* Coordinator Info */}
        <div className="sv-card p-6">
          <h3 className="sv-section-label mb-5">Coordinator</h3>
          <div className="grid grid-cols-2 gap-6">
            <div>
              <div className="sv-stat-label">Address</div>
              <div className="text-sm text-sv-text-primary font-mono text-2xs mt-1">
                {audit.coordinator.slice(0, 10)}...{audit.coordinator.slice(-8)}
              </div>
            </div>
            <div>
              <div className="sv-stat-label">Stake</div>
              <div className="text-sm text-sv-text-primary mt-1">
                {(Number(audit.stakeAmount) / 1e18).toFixed(4)} ETH
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
