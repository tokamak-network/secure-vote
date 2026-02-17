import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { usePublicClient, useAccount, useWalletClient } from 'wagmi';
import Layout from '@/components/Layout';
import RlaStatus from '@/components/RlaStatus';
import Link from 'next/link';
import { MACI_RLA_ABI, MACI_ABI, AuditPhase } from '@/lib/contracts';

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
  const [auditId, setAuditId] = useState<bigint | null>(null);
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
    const maciAddress = process.env.NEXT_PUBLIC_MACI_ADDRESS as `0x${string}` | undefined;
    const maciRlaAddress = process.env.NEXT_PUBLIC_MACI_RLA_ADDRESS as `0x${string}` | undefined;
    if (!maciRlaAddress || !maciAddress) {
      setError('Contract addresses not configured');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);

      // Step 1: Resolve MACI poll ID → poll address → RLA audit ID
      const pollInfo = await publicClient.readContract({
        address: maciAddress,
        abi: MACI_ABI,
        functionName: 'getPoll',
        args: [BigInt(id as string)],
      } as any) as [string, string, string];
      const pollAddress = pollInfo[0] as `0x${string}`;

      const resolvedAuditId = await publicClient.readContract({
        address: maciRlaAddress,
        abi: MACI_RLA_ABI,
        functionName: 'pollToAuditId',
        args: [pollAddress],
      } as any) as bigint;

      if (!resolvedAuditId || resolvedAuditId === 0n) {
        setError(`No audit found for election #${id}`);
        setLoading(false);
        return;
      }
      setAuditId(resolvedAuditId);

      // Step 2: Fetch audit data using the resolved audit ID
      const [period, result, bondResult] = await Promise.all([
        publicClient.readContract({
          address: maciRlaAddress,
          abi: MACI_RLA_ABI,
          functionName: 'CHALLENGE_PERIOD',
        } as any) as Promise<bigint>,
        publicClient.readContract({
          address: maciRlaAddress,
          abi: MACI_RLA_ABI,
          functionName: 'pollAudits',
          args: [resolvedAuditId],
        } as any) as Promise<any>,
        publicClient.readContract({
          address: maciRlaAddress,
          abi: MACI_RLA_ABI,
          functionName: 'getChallengeBondAmount',
          args: [resolvedAuditId],
        } as any).catch(() => 0n) as Promise<bigint>,
      ]);

      // Update all state together to avoid hydration issues
      setChallengePeriod(Number(period));
      setChallengeBondRequired(bondResult);
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load audit data');
    } finally {
      setLoading(false);
    }
  };

  const handleChallenge = async () => {
    if (!walletClientData || !publicClient || !auditId) return;
    const maciRlaAddress = process.env.NEXT_PUBLIC_MACI_RLA_ADDRESS as `0x${string}`;
    if (!maciRlaAddress) return;

    try {
      setChallengeLoading(true);
      setError(null);

      const hash = await walletClientData.writeContract({
        address: maciRlaAddress,
        abi: MACI_RLA_ABI,
        functionName: 'challenge',
        args: [auditId],
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
    if (!walletClientData || !publicClient || !auditId) return;
    const maciRlaAddress = process.env.NEXT_PUBLIC_MACI_RLA_ADDRESS as `0x${string}`;
    if (!maciRlaAddress) return;

    try {
      setChallengeLoading(true);
      setError(null);

      const hash = await walletClientData.writeContract({
        address: maciRlaAddress,
        abi: MACI_RLA_ABI,
        functionName: 'claimChallengeTimeout',
        args: [auditId],
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
      <div className="max-w-2xl mx-auto space-y-12">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-accent-blue transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back to Elections
        </Link>

        <header className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-mono text-primary uppercase tracking-wider">Election #{id}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className={`w-1.5 h-1.5 rounded-full ${
                isFinalized ? 'bg-emerald-500' :
                isRejected || isChallenged ? 'bg-rose-500' :
                'bg-amber-500'
              }`}></span>
              <span className="text-xs uppercase tracking-wide text-zinc-400 font-medium">
                {isFinalized ? 'Finalized' :
                 isRejected ? 'Rejected' :
                 isChallenged ? 'Challenged' :
                 isTentative ? 'Tentative' : 'Auditing'}
              </span>
            </div>
          </div>
          <h1 className="text-4xl font-light tracking-tight text-white">
            MACI + RLA Verification
          </h1>
          <p className="text-sm text-zinc-400 max-w-lg">
            {isFinalized ? 'Result verified and finalized via risk-limiting audit.' :
             isRejected ? 'Result rejected — audit failed verification.' :
             isChallenged ? 'Awaiting coordinator response to challenge.' :
             isTentative ? 'Challenge period active for result verification.' :
             'Audit in progress with sample verification.'}
          </p>
        </header>

        <div className="border-t border-border-dark w-full"></div>

        {(error || success) && (
          <div className={`px-5 py-4 text-sm border flex items-start gap-3 ${
            success
              ? 'bg-emerald-950/20 text-emerald-400 border-emerald-500/20'
              : 'bg-rose-950/20 text-rose-400 border-rose-500/20'
          }`}>
            {success || error}
          </div>
        )}

        {/* Warning: Suspicious 0 vs 0 result */}
        {totalVotes === 0 && audit.phase >= AuditPhase.Committed && (
          <div className="px-5 py-4 text-sm border bg-rose-950/20 text-rose-400 border-rose-500/20 space-y-2">
            <div className="flex items-start gap-3">
              <svg className="w-5 h-5 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              <div>
                <div className="font-semibold">⚠️ Suspicious Result: 0 vs 0</div>
                <div className="text-xs mt-1 text-rose-300/80">
                  This result is likely incorrect. Common causes:
                </div>
                <ul className="text-xs mt-2 space-y-1 text-rose-300/80 list-disc list-inside">
                  <li><strong>Coordinator key mismatch</strong>: Votes were encrypted with a different public key than expected</li>
                  <li><strong>No votes submitted</strong>: Check if users actually voted before the poll closed</li>
                  <li><strong>Wrong poll processed</strong>: Coordinator may have processed the wrong poll ID</li>
                </ul>
                <div className="text-xs mt-3 text-rose-300/80">
                  → For multi-poll setups: Each poll has its own coordinator keypair. Votes must be encrypted with the correct poll's public key.
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Vote Results */}
        <section className="space-y-8">
          <div className="space-y-3">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-medium tracking-wider text-zinc-400">FOR</span>
              <span className="text-5xl font-light text-white">{yesPct}%</span>
            </div>
            <div className="w-full h-3 bg-surface-dark overflow-hidden">
              <div className="h-full bg-white transition-all duration-500" style={{ width: `${yesPct}%` }}></div>
            </div>
            <div className="flex justify-between text-xs text-zinc-500 font-mono">
              <span>{Number(audit.yesVotes)} votes</span>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-medium tracking-wider text-zinc-500">AGAINST</span>
              <span className="text-3xl font-light text-[#71717a]">{noPct}%</span>
            </div>
            <div className="w-full h-2 bg-surface-dark overflow-hidden">
              <div className="h-full bg-[#3f3f46] transition-all duration-500" style={{ width: `${noPct}%` }}></div>
            </div>
            <div className="flex justify-between text-xs text-zinc-500 font-mono">
              <span>{Number(audit.noVotes)} votes</span>
            </div>
          </div>
        </section>

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
          <section className="relative overflow-hidden bg-amber-950/20 border-t-2 border-amber-500/70 p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
            <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-b from-amber-500/5 to-transparent pointer-events-none"></div>
            <div className="space-y-2 relative z-10">
              <h3 className="text-xs font-bold tracking-widest uppercase text-amber-500">Challenge Period Open</h3>
              <p className="text-sm text-zinc-400 max-w-sm">
                Submit a fraud proof if you detect inconsistencies in the RLA sample set.
                Bond: {(Number(challengeBondRequired) / 1e18).toFixed(6)} ETH
              </p>
            </div>
            <div className="flex flex-col items-end gap-3 relative z-10 w-full sm:w-auto">
              <button
                onClick={handleChallenge}
                disabled={challengeLoading || !walletClientData}
                className="w-full sm:w-auto px-6 py-2 bg-transparent hover:bg-amber-500/10 border border-amber-500/50 hover:border-amber-500 text-amber-500 text-xs font-medium uppercase tracking-wider transition-all duration-200 disabled:opacity-50"
              >
                {challengeLoading ? 'Submitting...' : 'Challenge Result'}
              </button>
              {!walletClientData && (
                <p className="text-xs text-rose-400">Connect wallet to challenge</p>
              )}
            </div>
          </section>
        )}

        {/* Challenged — claim timeout */}
        {isChallenged && (
          <section className="bg-rose-950/20 border border-rose-500/20 p-6 sm:p-8 space-y-6">
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-bold tracking-widest uppercase text-rose-400">Challenge Active</h3>
            </div>
            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-1">
                <p className="text-[10px] font-bold tracking-widest text-zinc-500 uppercase">Challenger</p>
                <p className="text-sm font-mono text-white">
                  {audit.challenger !== zeroAddr
                    ? `${audit.challenger.slice(0, 10)}...${audit.challenger.slice(-8)}`
                    : 'None'}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-[10px] font-bold tracking-widest text-zinc-500 uppercase">Bond</p>
                <p className="text-sm text-white">{(Number(audit.challengeBond) / 1e18).toFixed(6)} ETH</p>
              </div>
              <div className="space-y-1">
                <p className="text-[10px] font-bold tracking-widest text-zinc-500 uppercase">Deadline</p>
                <p className="text-sm text-white">
                  {audit.challengeDeadline > 0
                    ? new Date(audit.challengeDeadline * 1000).toLocaleString()
                    : 'N/A'}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-[10px] font-bold tracking-widest text-zinc-500 uppercase">Status</p>
                <p className={`text-sm font-semibold ${challengeDeadlinePassed ? 'text-rose-400' : 'text-amber-500'}`}>
                  {challengeDeadlinePassed ? 'Deadline passed' : 'Awaiting response'}
                </p>
              </div>
            </div>
            {challengeDeadlinePassed && (
              <button
                onClick={handleClaimTimeout}
                disabled={challengeLoading || !walletClientData}
                className="w-full px-6 py-3 bg-rose-600 hover:bg-rose-700 text-white font-medium text-sm uppercase tracking-wider transition-colors disabled:opacity-50"
              >
                {challengeLoading ? 'Claiming...' : 'Claim Timeout (Reject Result)'}
              </button>
            )}
          </section>
        )}
      </div>
    </Layout>
  );
}
