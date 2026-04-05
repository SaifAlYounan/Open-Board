interface VoteProgressBarProps {
  votescast: number;
  totalVoters: number;
  approvalsCount?: number;
  status?: string;
}

export function VoteProgressBar({ votescast, totalVoters, approvalsCount, status }: VoteProgressBarProps) {
  const pct = totalVoters > 0 ? Math.round((votescast / totalVoters) * 100) : 0;
  const color = status === 'approved' ? '#34c759' : status === 'rejected' ? '#ff3b30' : '#0071e3';

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-[#86868b]">
        <span>{votescast}/{totalVoters} voted</span>
        {approvalsCount !== undefined && <span>{approvalsCount} approved</span>}
      </div>
      <div className="h-1.5 bg-[#f5f5f7] rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}
