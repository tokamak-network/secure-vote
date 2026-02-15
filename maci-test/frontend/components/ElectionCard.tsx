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
  rlaProgress?: {
    pmVerified: number;
    pmTotal: number;
    tvVerified: number;
    tvTotal: number;
  };
}

const STATUS_CONFIG: Record<ElectionStatus, { dot: string; bg: string; text: string; label: string }> = {
  new: { dot: 'bg-sv-accent', bg: 'bg-sv-accent/10', text: 'text-sv-accent', label: 'New' },
  active: { dot: 'bg-sv-emerald', bg: 'bg-sv-emerald/10', text: 'text-sv-emerald', label: 'Active' },
  auditing: { dot: 'bg-sv-warning', bg: 'bg-sv-warning/10', text: 'text-sv-warning', label: 'Auditing' },
  finalized: { dot: 'bg-sv-emerald', bg: 'bg-sv-emerald/10', text: 'text-sv-emerald', label: 'Finalized' },
  rejected: { dot: 'bg-sv-error', bg: 'bg-sv-error/10', text: 'text-sv-error-light', label: 'Rejected' },
};

export default function ElectionCard({ election }: { election: ElectionData }) {
  const config = STATUS_CONFIG[election.status];
  const now = Math.floor(Date.now() / 1000);
  const remaining = election.endTime > now ? election.endTime - now : 0;
  const hours = Math.floor(remaining / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);

  const href = election.status === 'finalized' || election.status === 'auditing' || election.status === 'rejected'
    ? `/elections/${election.id}/results`
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
    <Link href={href} className="block group">
      <div className="px-5 py-4 rounded-lg border border-sv-border-subtle bg-sv-surface
        hover:border-sv-border hover:bg-sv-surface-hover hover:shadow-glow-sm
        transition-all duration-200 mb-3">
        <div className="flex items-center justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-2">
              <h3 className="text-sm font-semibold text-sv-text-primary group-hover:text-white transition-colors">
                {election.name}
              </h3>
              <span className={`sv-tag ${config.bg} ${config.text}`}>
                <span className={`sv-badge-dot ${config.dot}`} />
                {config.label}
              </span>
              {election.category && (
                <span className="sv-tag bg-sv-surface-2 text-sv-text-muted">
                  {election.category}
                </span>
              )}
            </div>
            <div className="flex items-center gap-4 text-xs text-sv-text-muted">
              {election.status === 'new' && (
                <span>{election.voterCount}/{election.maxVoters} signed up</span>
              )}
              {election.status === 'active' && (
                <span>{election.voterCount} voted &middot; {hours}h {minutes}m remaining</span>
              )}
              {election.status === 'auditing' && election.rlaProgress && (
                <div className="flex items-center gap-3">
                  <span>
                    PM {election.rlaProgress.pmVerified}/{election.rlaProgress.pmTotal} &middot;
                    TV {election.rlaProgress.tvVerified}/{election.rlaProgress.tvTotal}
                  </span>
                  <div className="w-20 h-1 bg-sv-surface-2 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-sv-warning rounded-full transition-all"
                      style={{ width: `${rlaPct}%` }}
                    />
                  </div>
                </div>
              )}
              {election.status === 'finalized' && (
                <span>
                  Yes {election.yesVotes > 0 ? Math.round((election.yesVotes / (election.yesVotes + election.noVotes)) * 100) : 0}%
                  &middot; No {election.noVotes > 0 ? Math.round((election.noVotes / (election.yesVotes + election.noVotes)) * 100) : 0}%
                  &middot; {election.voterCount} voters
                </span>
              )}
              {election.status === 'rejected' && (
                <span className="text-sv-error-light">Result rejected</span>
              )}
            </div>
          </div>
          <svg className="w-4 h-4 text-sv-text-disabled group-hover:text-sv-accent transition-colors"
            fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </div>
      </div>
    </Link>
  );
}
