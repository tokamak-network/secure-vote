import Link from 'next/link';

export type ElectionStatus = 'new' | 'active' | 'auditing' | 'finalized' | 'rejected';

export interface ElectionData {
  id: number;
  name: string;
  category: string;
  status: ElectionStatus;
  voterCount: number;
  maxVoters: number;
  yesVotes: number;
  noVotes: number;
  endTime: number;
  rlaPollId?: number;
  rlaProgress?: {
    pmVerified: number;
    pmTotal: number;
    tvVerified: number;
    tvTotal: number;
  };
}

const STATUS_CONFIG: Record<ElectionStatus, { dot: string; text: string; label: string }> = {
  new: { dot: 'bg-blue-500', text: 'text-zinc-400', label: 'New' },
  active: { dot: 'bg-emerald-500', text: 'text-zinc-400', label: 'Active' },
  auditing: { dot: 'bg-amber-500', text: 'text-zinc-400', label: 'Auditing' },
  finalized: { dot: 'bg-emerald-500', text: 'text-zinc-400', label: 'Finalized' },
  rejected: { dot: 'bg-rose-500', text: 'text-zinc-400', label: 'Rejected' },
};

export default function ElectionCard({ election }: { election: ElectionData }) {
  const config = STATUS_CONFIG[election.status];
  const now = Math.floor(Date.now() / 1000);
  const remaining = election.endTime > now ? election.endTime - now : 0;
  const hours = Math.floor(remaining / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);

  const href = election.status === 'finalized' || election.status === 'auditing' || election.status === 'rejected'
    ? `/elections/${election.rlaPollId || election.id}/results`
    : `/elections/${election.id}`;

  // RLA progress bar
  const rlaTotal = election.rlaProgress
    ? election.rlaProgress.pmTotal + election.rlaProgress.tvTotal
    : 0;
  const rlaVerified = election.rlaProgress
    ? election.rlaProgress.pmVerified + election.rlaProgress.tvVerified
    : 0;
  const rlaPct = rlaTotal > 0 ? Math.round((rlaVerified / rlaTotal) * 100) : 0;

  return (
    <Link href={href} className="group grid grid-cols-1 md:grid-cols-12 gap-4 md:gap-8 items-center py-6 border-b border-border-dark hover:bg-zinc-900/50 transition-colors duration-150 px-4 -mx-4">
      <div className="col-span-5">
        <h3 className="text-lg font-medium text-white group-hover:text-primary transition-colors">
          {election.name}
        </h3>
        <div className="md:hidden mt-1 text-sm text-zinc-500">{election.category}</div>
      </div>
      <div className="col-span-3 hidden md:block">
        <span className="text-base font-normal text-zinc-500">{election.category}</span>
      </div>
      <div className="col-span-2 flex items-center gap-3">
        <span className={`w-1.5 h-1.5 rounded-full ${config.dot}`}></span>
        <span className={`text-sm ${config.text}`}>{config.label}</span>
      </div>
      <div className="col-span-2 text-right">
        <span className="text-base font-normal text-zinc-300 tabular-nums">
          {election.status === 'finalized' ? (election.yesVotes + election.noVotes) : election.voterCount}
        </span>
      </div>
    </Link>
  );
}
