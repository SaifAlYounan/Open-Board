import { useState } from 'react';
import { TopNav } from '@/components/TopNav';
import { StatCard } from '@/components/StatCard';
import { AiBanner } from '@/components/AiBanner';
import {
  useGetDashboardSummary, useListBoards, useGetDashboardAiInsights,
} from '@workspace/api-client-react';
import { useLocation } from 'wouter';
import { Clock, AlertCircle, CheckCircle, File, Users, Calendar, Sparkles, ArrowRight } from 'lucide-react';

const INSIGHT_ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  clock: Clock, alert: AlertCircle, check: CheckCircle, file: File, users: Users, calendar: Calendar,
};

export default function BoardMemberDashboard() {
  const { data: summary } = useGetDashboardSummary();
  const { data: boards } = useListBoards();
  const { data: insights } = useGetDashboardAiInsights();
  const [, setLocation] = useLocation();
  const s = summary as any;
  const boardList = (boards as any[]) || [];
  const insightList = ((insights as any)?.insights as any[]) || [];

  return (
    <div className="min-h-screen bg-[#f5f5f7]">
      <TopNav />
      <main className="pt-20 px-8 pb-8 max-w-5xl mx-auto space-y-8">
        <div>
          <h1 className="text-2xl font-semibold text-[#1d1d1f]">My Dashboard</h1>
          <p className="text-sm text-[#86868b] mt-1">Your board activity at a glance.</p>
        </div>

        <AiBanner />

        {/* Stats */}
        <div className="grid grid-cols-4 gap-4">
          <StatCard label="Pending Votes" value={s?.pendingVotesCount ?? 0} color="#ff3b30" testId="stat-pending-votes" />
          <StatCard label="Minutes to Sign" value={s?.minutesToSignCount ?? 0} color="#0071e3" testId="stat-minutes-sign" />
          <StatCard label="Minutes in Review" value={s?.minutesInReviewCount ?? 0} color="#ff9500" testId="stat-minutes-review" />
          <StatCard label="Next Meeting" value={s?.nextMeeting?.title || 'None scheduled'} color="#34c759" testId="stat-next-meeting" />
        </div>

        {/* AI Insights */}
        {insightList.length > 0 && (
          <div className="bg-white rounded-2xl border border-[#e5e5e7] p-6">
            <div className="flex items-center gap-2 mb-4">
              <Sparkles size={16} className="text-[#0071e3]" />
              <h2 className="font-semibold text-[#1d1d1f]">AI Insights</h2>
            </div>
            <div className="space-y-3">
              {insightList.map((insight: any, i: number) => {
                const IconComponent = INSIGHT_ICONS[insight.icon] || Sparkles;
                return (
                  <div key={i} className="flex items-start gap-3 p-3 bg-[#f5f5f7] rounded-xl" data-testid={`insight-${i}`}>
                    <IconComponent size={16} className="text-[#0071e3] mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-[#1d1d1f]">{insight.title}</div>
                      <div className="text-xs text-[#86868b] mt-0.5">{insight.detail}</div>
                    </div>
                    {insight.actionLink?.entityId && (
                      <button
                        onClick={() => setLocation(`/board/${insight.actionLink.entityType}/${insight.actionLink.entityId}`)}
                        className="text-[#0071e3] flex-shrink-0"
                      >
                        <ArrowRight size={14} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Board Room Cards */}
        <div>
          <h2 className="font-semibold text-[#1d1d1f] mb-4">My Boards</h2>
          <div className="grid grid-cols-2 gap-4">
            {boardList.map((board: any) => (
              <button
                key={board.id}
                onClick={() => setLocation(`/board/room/${board.id}`)}
                className="bg-white rounded-2xl border border-[#e5e5e7] p-6 text-left hover:border-[#0071e3]/40 hover:shadow-sm transition-all"
                data-testid={`board-card-${board.id}`}
              >
                <div className="text-xs font-mono text-[#86868b] mb-1">{board.abbreviation}</div>
                <div className="font-semibold text-[#1d1d1f]">{board.name}</div>
                <div className="text-xs text-[#86868b] mt-1 capitalize">{board.type}</div>
                <div className="text-xs text-[#86868b] mt-0.5">{board.memberCount} members</div>
                <div className="mt-4 flex items-center gap-1 text-[#0071e3] text-xs font-medium">
                  Enter board room <ArrowRight size={12} />
                </div>
              </button>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
