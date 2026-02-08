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
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-heading font-semibold text-carbon-text-primary">Elections</h1>
          <p className="text-sm text-carbon-text-helper mt-1">MACI-encrypted voting with risk-limiting audits</p>
        </div>
        <Link href="/elections/create" className="carbon-btn-primary">
          New Election
        </Link>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 bg-carbon-support-error/10 text-carbon-support-error-light text-sm border-l-2 border-carbon-support-error">
          {error}
        </div>
      )}

      {loading ? (
        <div className="py-20 text-center text-carbon-text-disabled text-sm">Loading elections...</div>
      ) : elections.length === 0 ? (
        <div className="py-20 text-center">
          <p className="text-carbon-text-helper text-sm mb-1">No elections yet</p>
          <p className="text-carbon-text-disabled text-xs">Deploy the platform and create an election to get started.</p>
        </div>
      ) : (
        <div className="carbon-card overflow-hidden">
          {elections.map((election) => (
            <ElectionCard key={election.id} election={election} />
          ))}
        </div>
      )}
    </Layout>
  );
}
