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
          rlaPollId: undefined,
          rlaProgress: {
            pmVerified: pmProofsVerified,
            pmTotal: pmSampleCount,
            tvVerified: tvProofsVerified,
            tvTotal: tvSampleCount,
          },
        });
      }

      // Also load any RLA audits and map them to MACI polls
      if (maciRlaAddress && rlaCount > 0n) {
        for (let rlaPollId = 0; rlaPollId < Number(rlaCount); rlaPollId++) {
          try {
            const audit = await publicClient.readContract({
              address: maciRlaAddress,
              abi: MACI_RLA_ABI,
              functionName: 'pollAudits',
              args: [BigInt(rlaPollId)],
            } as any) as any;

            const phase = Number(audit[22]);
            if (phase > 0) {
              // Get the poll address from audit
              const pollAddress = audit[1];

              // Find the MACI Poll ID for this poll address
              let maciPollId = -1;
              for (let i = 0; i < Number(maciPollCount); i++) {
                try {
                  const pollInfo = await publicClient.readContract({
                    address: maciAddress,
                    abi: MACI_ABI,
                    functionName: 'getPoll',
                    args: [BigInt(i)],
                  } as any) as any;
                  const addr = pollInfo[0] || pollInfo.poll;
                  if (addr && addr.toLowerCase() === pollAddress.toLowerCase()) {
                    maciPollId = i;
                    break;
                  }
                } catch {}
              }

              if (maciPollId >= 0) {
                const auditYes = Number(audit[3]);
                const auditNo = Number(audit[4]);
                let auditStatus: ElectionStatus = 'auditing';
                if (phase === AuditPhase.Finalized) auditStatus = 'finalized';
                else if (phase === AuditPhase.Rejected) auditStatus = 'rejected';

                const existingIdx = items.findIndex(e => e.id === maciPollId);
                if (existingIdx >= 0) {
                  items[existingIdx].status = auditStatus;
                  items[existingIdx].yesVotes = auditYes;
                  items[existingIdx].noVotes = auditNo;
                  items[existingIdx].voterCount = auditYes + auditNo;
                  items[existingIdx].rlaPollId = rlaPollId;
                  items[existingIdx].rlaProgress = {
                    pmVerified: Number(audit[13]),
                    pmTotal: Number(audit[11]),
                    tvVerified: Number(audit[14]),
                    tvTotal: Number(audit[12]),
                  };
                }
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
      <header className="flex items-end justify-between mb-12">
        <h1 className="text-4xl font-light text-white tracking-tight">
          Elections
        </h1>
        <Link href="/elections/create" className="text-base font-normal text-accent-blue hover:text-blue-400 transition-colors duration-200">
          + New
        </Link>
      </header>

      {error && (
        <div className="mb-6 px-5 py-4 bg-rose-950/20 text-rose-400 text-sm border border-rose-500/20 flex items-start gap-3">
          {error}
        </div>
      )}

      {loading ? (
        <div className="py-24 text-center">
          <div className="inline-flex items-center gap-3 text-zinc-500 text-sm">
            <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            Loading elections...
          </div>
        </div>
      ) : elections.length === 0 ? (
        <div className="py-24 text-center">
          <div className="text-zinc-500 text-sm mb-4">No elections yet</div>
          <Link
            href="/elections/create"
            className="inline-flex items-center gap-2 text-accent-blue hover:text-blue-400 text-sm transition-colors duration-200"
          >
            Create your first election
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" />
            </svg>
          </Link>
        </div>
      ) : (
        <div className="w-full">
          <div className="hidden md:grid grid-cols-12 gap-8 px-4 pb-4 text-xs font-normal text-zinc-600 uppercase tracking-wider border-b border-border-dark">
            <div className="col-span-5">Name</div>
            <div className="col-span-3">Category</div>
            <div className="col-span-2">Status</div>
            <div className="col-span-2 text-right">Votes</div>
          </div>
          <div className="flex flex-col">
            {elections.map((election) => (
              <ElectionCard key={election.id} election={election} />
            ))}
          </div>
        </div>
      )}
    </Layout>
  );
}
