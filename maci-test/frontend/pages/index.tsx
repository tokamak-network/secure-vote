import { useState, useEffect } from 'react';
import { usePublicClient } from 'wagmi';
import Layout from '@/components/Layout';
import ElectionCard, { ElectionData, ElectionStatus } from '@/components/ElectionCard';
import Link from 'next/link';
import { MACI_RLA_ABI, MACI_ABI, POLL_ABI, AuditPhase } from '@/lib/contracts';
import { parseAbi } from 'viem';

export default function Home() {
  const [elections, setElections] = useState<ElectionData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const publicClient = usePublicClient();

  useEffect(() => {
    loadElections();
  }, [publicClient]);

  const loadElections = async () => {
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
      setError(null);

      // Load election metadata (names, categories)
      let metadata: Record<string, { name: string; category: string }> = {};
      try {
        const metaRes = await fetch('/api/elections/list');
        const metaData = await metaRes.json();
        if (metaData.metadata) metadata = metaData.metadata;
      } catch {}

      // Get poll count from MACI
      const maciPollCount = await publicClient.readContract({
        address: maciAddress,
        abi: MACI_ABI,
        functionName: 'nextPollId',
      } as any) as bigint;

      // Get audit count from MaciRLA
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

      // Build election list from MACI polls
      const items: ElectionData[] = [];
      for (let i = 0; i < Number(maciPollCount); i++) {
        let status: ElectionStatus = 'new';
        let yesVotes = 0, noVotes = 0;
        let pmSampleCount = 0, tvSampleCount = 0;
        let pmProofsVerified = 0, tvProofsVerified = 0;
        let voterCount = 0;

        // Try to get Poll info
        try {
          const pollInfo = await publicClient.readContract({
            address: maciAddress,
            abi: MACI_ABI,
            functionName: 'getPoll',
            args: [BigInt(i)],
          } as any) as any;

          const pollAddr = pollInfo[0] || pollInfo.poll;
          if (pollAddr) {
            const numInfo = await publicClient.readContract({
              address: pollAddr,
              abi: POLL_ABI,
              functionName: 'numSignUpsAndMessages',
            } as any) as any;
            voterCount = Number(numInfo[1] || 0); // numMessages as proxy
          }
        } catch {}

        // Check if this poll has an RLA audit
        if (voterCount > 0) status = 'active';

        const meta = metadata[i.toString()];
        items.push({
          id: i,
          name: meta?.name || `Election #${i}`,
          category: meta?.category || '',
          status,
          voterCount,
          maxVoters: 0,
          yesVotes,
          noVotes,
          endTime: 0,
          rlaProgress: {
            pmVerified: pmProofsVerified,
            pmTotal: pmSampleCount,
            tvVerified: tvProofsVerified,
            tvTotal: tvSampleCount,
          },
        });
      }

      // Also load any RLA audits
      if (maciRlaAddress && rlaCount > 0n) {
        for (let i = 0; i < Number(rlaCount); i++) {
          try {
            const audit = await publicClient.readContract({
              address: maciRlaAddress,
              abi: MACI_RLA_ABI,
              functionName: 'pollAudits',
              args: [BigInt(i)],
            } as any) as any;

            const phase = Number(audit[22]);
            if (phase > 0) {
              const auditYes = Number(audit[3]);
              const auditNo = Number(audit[4]);
              let auditStatus: ElectionStatus = 'auditing';
              if (phase === AuditPhase.Finalized) auditStatus = 'finalized';
              else if (phase === AuditPhase.Rejected) auditStatus = 'rejected';

              const existingIdx = items.findIndex(e => e.id === i);
              if (existingIdx >= 0) {
                items[existingIdx].status = auditStatus;
                items[existingIdx].yesVotes = auditYes;
                items[existingIdx].noVotes = auditNo;
                items[existingIdx].voterCount = auditYes + auditNo;
                items[existingIdx].rlaProgress = {
                  pmVerified: Number(audit[13]),
                  pmTotal: Number(audit[11]),
                  tvVerified: Number(audit[14]),
                  tvTotal: Number(audit[12]),
                };
              }
            }
          } catch {}
        }
      }

      setElections(items.reverse());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load elections');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout>
      {/* Hero section */}
      <div className="mb-10">
        <div className="flex items-center gap-3 mb-3">
          <svg className="w-8 h-8 text-sv-accent" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 2.18l7 3.12v4.7c0 4.83-3.4 9.36-7 10.5-3.6-1.14-7-5.67-7-10.5V6.3l7-3.12z"/>
            <path d="M10 15.5l-3.5-3.5 1.41-1.41L10 12.67l5.59-5.59L17 8.5l-7 7z"/>
          </svg>
          <h1 className="text-display font-bold text-sv-text-primary">Elections</h1>
        </div>
        <p className="text-base text-sv-text-muted max-w-lg">
          MACI-encrypted voting with zero-knowledge proofs and risk-limiting audits.
        </p>
      </div>

      <div className="flex items-center justify-between mb-6">
        <div className="text-sm text-sv-text-muted">
          {!loading && elections.length > 0 && `${elections.length} election${elections.length !== 1 ? 's' : ''}`}
        </div>
        <Link href="/elections/create" className="sv-btn-primary flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          New Election
        </Link>
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
            Loading elections...
          </div>
        </div>
      ) : elections.length === 0 ? (
        <div className="py-24 text-center">
          <svg className="w-16 h-16 text-sv-text-disabled mx-auto mb-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 2.18l7 3.12v4.7c0 4.83-3.4 9.36-7 10.5-3.6-1.14-7-5.67-7-10.5V6.3l7-3.12z"/>
          </svg>
          <p className="text-sv-text-muted text-sm mb-2">No elections yet</p>
          <p className="text-sv-text-disabled text-xs">
            Deploy the platform and create an election to get started.
          </p>
        </div>
      ) : (
        <div className="space-y-0">
          {elections.map((election) => (
            <ElectionCard key={election.id} election={election} />
          ))}
        </div>
      )}
    </Layout>
  );
}
