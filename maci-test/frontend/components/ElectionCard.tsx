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

const STATUS_CONFIG: Record<ElectionStatus, { color: string; label: string }> = {
  new: { color: 'bg-carbon-support-info/20 text-carbon-support-info', label: 'New' },
  active: { color: 'bg-carbon-support-success/20 text-carbon-support-success', label: 'Active' },
  auditing: { color: 'bg-carbon-support-warning/20 text-carbon-support-warning', label: 'Auditing' },
  finalized: { color: 'bg-carbon-interactive/20 text-carbon-interactive', label: 'Finalized' },
  rejected: { color: 'bg-carbon-support-error/20 text-carbon-support-error-light', label: 'Rejected' },
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

  return (
    <Link href={href} className="block">
      <div className="px-5 py-4 hover:bg-carbon-layer-hover transition-colors border-b border-carbon-border-subtle last:border-b-0">
        <div className="flex items-center justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-1">
              <h3 className="text-sm font-medium text-carbon-text-primary">{election.name}</h3>
              <span className={`carbon-tag ${config.color}`}>
                {config.label}
              </span>
              {election.category && (
                <span className="carbon-tag bg-carbon-layer-2 text-carbon-text-helper">
                  {election.category}
                </span>
              )}
            </div>
            <div className="text-xs text-carbon-text-helper">
              {election.status === 'new' && (
                <span>{election.voterCount}/{election.maxVoters} signed up</span>
              )}
              {election.status === 'active' && (
                <span>{election.voterCount} voted &middot; {hours}h {minutes}m remaining</span>
              )}
              {election.status === 'auditing' && election.rlaProgress && (
                <span>
                  PM {election.rlaProgress.pmVerified}/{election.rlaProgress.pmTotal} &middot;
                  TV {election.rlaProgress.tvVerified}/{election.rlaProgress.tvTotal}
                </span>
              )}
              {election.status === 'finalized' && (
                <span>
                  Yes {election.yesVotes > 0 ? Math.round((election.yesVotes / (election.yesVotes + election.noVotes)) * 100) : 0}%
                  &middot; No {election.noVotes > 0 ? Math.round((election.noVotes / (election.yesVotes + election.noVotes)) * 100) : 0}%
                  &middot; {election.voterCount} voters
                </span>
              )}
              {election.status === 'rejected' && (
                <span className="text-carbon-support-error-light">Result rejected</span>
              )}
            </div>
          </div>
          <svg className="w-4 h-4 text-carbon-text-disabled" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="square" strokeLinejoin="miter" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </div>
      </div>
    </Link>
  );
}
