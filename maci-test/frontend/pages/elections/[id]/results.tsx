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
        <div className="py-20 text-center text-carbon-text-disabled text-sm">Loading results...</div>
      </Layout>
    );
  }

  if (error && !audit) {
    return (
      <Layout>
        <div className="py-20 text-center text-carbon-support-error-light text-sm">{error || 'Audit not found'}</div>
      </Layout>
    );
  }

  if (!audit) {
    return (
      <Layout>
        <div className="py-20 text-center text-carbon-support-error-light text-sm">Audit not found</div>
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
        <Link href="/" className="text-sm text-carbon-text-helper hover:text-carbon-text-secondary transition-colors mb-6 inline-block">
          &larr; Elections
        </Link>

        <div className="flex items-center gap-3 mb-1">
          <h1 className="text-heading font-semibold text-carbon-text-primary">Election #{id}</h1>
          <span className={`carbon-tag ${
            isFinalized ? 'bg-carbon-support-success/20 text-carbon-support-success' :
            isRejected ? 'bg-carbon-support-error/20 text-carbon-support-error-light' :
            isChallenged ? 'bg-carbon-support-error/20 text-carbon-support-error-light' :
            'bg-carbon-support-warning/20 text-carbon-support-warning'
          }`}>
            {isFinalized ? 'Finalized' :
             isRejected ? 'Rejected' :
             isChallenged ? 'Challenged' :
             isTentative ? 'Tentative' : 'Auditing'}
          </span>
        </div>
        <p className="text-sm text-carbon-text-helper mb-8">
          {isFinalized ? 'Result verified and finalized.' :
           isRejected ? 'Result rejected — audit failed.' :
           isChallenged ? 'Awaiting coordinator response to challenge.' :
           isTentative ? 'Challenge period active.' :
           'Audit in progress.'}
        </p>

        {(error || success) && (
          <div className={`mb-6 px-4 py-3 text-sm border-l-2 ${
            success
              ? 'bg-carbon-support-success/10 text-carbon-support-success border-carbon-support-success'
              : 'bg-carbon-support-error/10 text-carbon-support-error-light border-carbon-support-error'
          }`}>
            {success || error}
          </div>
        )}

        {/* Vote Results */}
        <div className="carbon-card p-5 mb-4">
          <h3 className="text-xs font-medium text-carbon-text-helper uppercase tracking-wider mb-5">Vote Tally</h3>

          <div className="space-y-4">
            <div>
              <div className="flex justify-between text-sm mb-1.5">
                <span className="text-carbon-support-success">Yes / For</span>
                <span className="text-carbon-text-primary font-mono text-xs">
                  {Number(audit.yesVotes)} ({yesPct}%)
                </span>
              </div>
              <div className="h-1.5 bg-carbon-layer-2 overflow-hidden">
                <div className="h-full bg-carbon-support-success transition-all" style={{ width: `${yesPct}%` }} />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-sm mb-1.5">
                <span className="text-carbon-support-error-light">No / Against</span>
                <span className="text-carbon-text-primary font-mono text-xs">
                  {Number(audit.noVotes)} ({noPct}%)
                </span>
              </div>
              <div className="h-1.5 bg-carbon-layer-2 overflow-hidden">
                <div className="h-full bg-carbon-support-error-light transition-all" style={{ width: `${noPct}%` }} />
              </div>
            </div>
          </div>

          <div className="mt-4 pt-4 border-t border-carbon-border-subtle text-xs text-carbon-text-helper">
            Total: {totalVotes} votes
          </div>
        </div>

        {/* RLA Status */}
        <div className="mb-4">
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
          <div className="carbon-card !border-carbon-support-warning/30 p-5 mb-4">
            <h3 className="text-xs font-medium text-carbon-support-warning uppercase tracking-wider mb-3">
              Challenge Result
            </h3>
            <p className="text-xs text-carbon-text-helper mb-4">
              Post a bond to force the coordinator to prove ALL batches.
              If they fail to respond within 3 days, the result is rejected and you receive
              the coordinator&apos;s stake + your bond.
            </p>
            <div className="flex items-center justify-between">
              <div className="text-xs">
                <span className="text-carbon-text-helper">Bond: </span>
                <span className="text-carbon-text-primary font-mono">
                  {(Number(challengeBondRequired) / 1e18).toFixed(6)} ETH
                </span>
              </div>
              <button
                onClick={handleChallenge}
                disabled={challengeLoading || !walletClientData}
                className="px-4 py-2 text-xs bg-carbon-support-warning text-carbon-bg font-medium hover:brightness-110 disabled:opacity-50 transition-all"
              >
                {challengeLoading ? 'Submitting...' : 'Challenge'}
              </button>
            </div>
            {!walletClientData && (
              <p className="text-xs text-carbon-support-error-light mt-2">Connect wallet to challenge.</p>
            )}
          </div>
        )}

        {/* Challenged — claim timeout */}
        {isChallenged && (
          <div className="carbon-card !border-carbon-support-error/30 p-5 mb-4">
            <h3 className="text-xs font-medium text-carbon-support-error-light uppercase tracking-wider mb-3">
              Challenge Active
            </h3>
            <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-xs mb-4">
              <div>
                <div className="text-2xs text-carbon-text-helper uppercase tracking-wider mb-0.5">Challenger</div>
                <div className="text-carbon-text-primary font-mono text-2xs">
                  {audit.challenger !== zeroAddr
                    ? `${audit.challenger.slice(0, 10)}...${audit.challenger.slice(-8)}`
                    : 'None'}
                </div>
              </div>
              <div>
                <div className="text-2xs text-carbon-text-helper uppercase tracking-wider mb-0.5">Bond</div>
                <div className="text-carbon-text-primary">
                  {(Number(audit.challengeBond) / 1e18).toFixed(6)} ETH
                </div>
              </div>
              <div>
                <div className="text-2xs text-carbon-text-helper uppercase tracking-wider mb-0.5">Deadline</div>
                <div className="text-carbon-text-primary">
                  {audit.challengeDeadline > 0
                    ? new Date(audit.challengeDeadline * 1000).toLocaleString()
                    : 'N/A'}
                </div>
              </div>
              <div>
                <div className="text-2xs text-carbon-text-helper uppercase tracking-wider mb-0.5">Status</div>
                <div className="text-carbon-text-primary">
                  {challengeDeadlinePassed ? 'Deadline passed' : 'Awaiting response'}
                </div>
              </div>
            </div>
            {challengeDeadlinePassed && (
              <button
                onClick={handleClaimTimeout}
                disabled={challengeLoading || !walletClientData}
                className="carbon-btn-danger w-full text-xs"
              >
                {challengeLoading ? 'Claiming...' : 'Claim Timeout (Reject Result)'}
              </button>
            )}
          </div>
        )}

        {/* Coordinator Info */}
        <div className="carbon-card p-5">
          <h3 className="text-xs font-medium text-carbon-text-helper uppercase tracking-wider mb-4">Coordinator</h3>
          <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-xs">
            <div>
              <div className="text-2xs text-carbon-text-helper uppercase tracking-wider mb-0.5">Address</div>
              <div className="text-carbon-text-primary font-mono text-2xs">
                {audit.coordinator.slice(0, 10)}...{audit.coordinator.slice(-8)}
              </div>
            </div>
            <div>
              <div className="text-2xs text-carbon-text-helper uppercase tracking-wider mb-0.5">Stake</div>
              <div className="text-carbon-text-primary">
                {(Number(audit.stakeAmount) / 1e18).toFixed(4)} ETH
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
