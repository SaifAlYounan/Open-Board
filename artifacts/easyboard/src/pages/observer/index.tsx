import { useLocation } from 'wouter';
import { TopNav } from '@/components/TopNav';
import { StatCard } from '@/components/StatCard';
import { AiBanner } from '@/components/AiBanner';
import { useListBoards, useGetDashboardSummary } from '@workspace/api-client-react';
import { ArrowRight } from 'lucide-react';

export default function ObserverDashboard() {
  const [, setLocation] = useLocation();
  const { data: boards } = useListBoards();
  const { data: summary } = useGetDashboardSummary();
  const s = summary as any;
  const boardList = (boards as any[]) || [];

  return (
    <div className="min-h-screen bg-[#f5f5f7]">
      <TopNav />
      <main className="pt-20 px-8 pb-8 max-w-4xl mx-auto space-y-8">
        <div>
          <h1 className="text-2xl font-semibold text-[#1d1d1f]">Observer Dashboard</h1>
          <p className="text-sm text-[#86868b] mt-1">Board activity you have read access to.</p>
        </div>

        <AiBanner />

        <div className="grid grid-cols-3 gap-4">
          <StatCard label="Minutes in Review" value={s?.minutesInReviewCount ?? 0} color="#ff9500" testId="stat-minutes-review" />
          <StatCard label="Open Votes" value={s?.openVotesCount ?? 0} color="#0071e3" testId="stat-open-votes" />
          <StatCard label="Next Meeting" value={s?.nextMeeting?.title || 'None'} color="#34c759" testId="stat-next-meeting" />
        </div>

        <div>
          <h2 className="font-semibold text-[#1d1d1f] mb-4">Boards</h2>
          <div className="grid grid-cols-2 gap-4">
            {boardList.map((board: any) => (
              <button
                key={board.id}
                onClick={() => setLocation(`/observer/room/${board.id}`)}
                className="bg-white rounded-2xl border border-[#e5e5e7] p-6 text-left hover:border-[#0071e3]/40 hover:shadow-sm transition-all"
                data-testid={`board-card-${board.id}`}
              >
                <div className="text-xs font-mono text-[#86868b] mb-1">{board.abbreviation}</div>
                <div className="font-semibold text-[#1d1d1f]">{board.name}</div>
                <div className="text-xs text-[#86868b] mt-1 capitalize">{board.type}</div>
                <div className="mt-4 flex items-center gap-1 text-[#86868b] text-xs">
                  View <ArrowRight size={12} />
                </div>
              </button>
            ))}
            {boardList.length === 0 && (
              <div className="col-span-2 text-center py-12 text-[#86868b] text-sm bg-white rounded-2xl border border-[#e5e5e7]">
                No boards available to observe.
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
