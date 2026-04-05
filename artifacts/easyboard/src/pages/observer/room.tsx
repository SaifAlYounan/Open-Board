import { useState } from 'react';
import { useParams, useLocation } from 'wouter';
import { TopNav } from '@/components/TopNav';
import { VoteProgressBar } from '@/components/VoteProgressBar';
import { useGetBoard, useListVotes, useListMeetings, useListMinutes, getGetBoardQueryKey } from '@workspace/api-client-react';
import { Calendar, FileText, Vote, MapPin } from 'lucide-react';
import { cn } from '@/lib/utils';

type Tab = 'votes' | 'meetings' | 'minutes';

export default function ObserverRoom() {
  const params = useParams<{ boardId: string }>();
  const boardId = params.boardId;
  const [tab, setTab] = useState<Tab>('votes');
  const [, setLocation] = useLocation();

  const { data: board } = useGetBoard(boardId, { query: { queryKey: getGetBoardQueryKey(boardId) } });
  const { data: votes } = useListVotes({ boardId });
  const { data: meetings } = useListMeetings({ boardId });
  const { data: minutesList } = useListMinutes({ boardId });

  const b = board as any;
  const STATUS_COLOR: Record<string, string> = {
    open: '#0071e3', approved: '#34c759', rejected: '#ff3b30', lapsed: '#86868b'
  };
  const MINUTES_STATUS_COLOR: Record<string, { label: string; color: string }> = {
    draft: { label: 'Draft', color: '#86868b' },
    review: { label: 'In Review', color: '#ff9500' },
    signing: { label: 'Signing', color: '#0071e3' },
    signed: { label: 'Signed', color: '#34c759' },
  };

  return (
    <div className="min-h-screen bg-[#f5f5f7]">
      <TopNav />
      <main className="pt-20 px-8 pb-8 max-w-4xl mx-auto space-y-6">
        <div>
          <div className="text-xs font-mono text-[#86868b]">{b?.abbreviation}</div>
          <h1 className="text-2xl font-semibold text-[#1d1d1f]">{b?.name || 'Board Room'} (Observer)</h1>
        </div>

        <div className="flex gap-1 bg-white rounded-xl border border-[#e5e5e7] p-1 w-fit">
          {(['votes', 'meetings', 'minutes'] as Tab[]).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={cn('px-5 py-2 rounded-lg text-sm font-medium transition-colors capitalize',
                tab === t ? 'bg-[#0071e3] text-white' : 'text-[#86868b] hover:text-[#1d1d1f]'
              )}
              data-testid={`tab-${t}`}>
              {t}
            </button>
          ))}
        </div>

        {tab === 'votes' && (
          <div className="space-y-3">
            {((votes as any[]) || []).map((vote: any) => (
              <div key={vote.id} className="bg-white rounded-2xl border border-[#e5e5e7] p-5" data-testid={`vote-${vote.id}`}>
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <div className="text-xs font-mono text-[#86868b] mb-0.5">{vote.resolutionNumber}</div>
                    <div className="font-medium text-[#1d1d1f]">{vote.title}</div>
                  </div>
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{
                    backgroundColor: STATUS_COLOR[vote.status] + '20', color: STATUS_COLOR[vote.status]
                  }}>{vote.status}</span>
                </div>
                <VoteProgressBar votescast={vote.votescast || 0} totalVoters={vote.totalVoters || 0} approvalsCount={vote.approvalsCount || 0} status={vote.status} />
              </div>
            ))}
            {(!votes || (votes as any[]).length === 0) && (
              <div className="text-center py-12 text-[#86868b] text-sm bg-white rounded-2xl border border-[#e5e5e7]">No votes.</div>
            )}
          </div>
        )}

        {tab === 'meetings' && (
          <div className="space-y-3">
            {((meetings as any[]) || []).map((meeting: any) => (
              <div key={meeting.id} className="bg-white rounded-2xl border border-[#e5e5e7] p-5" data-testid={`meeting-${meeting.id}`}>
                <div className="font-medium text-[#1d1d1f]">{meeting.title}</div>
                <div className="flex items-center gap-4 mt-2 text-xs text-[#86868b]">
                  <span className="flex items-center gap-1"><Calendar size={12} /> {new Date(meeting.date).toLocaleDateString()}</span>
                  {meeting.location && <span className="flex items-center gap-1"><MapPin size={12} /> {meeting.location}</span>}
                </div>
              </div>
            ))}
            {(!meetings || (meetings as any[]).length === 0) && (
              <div className="text-center py-12 text-[#86868b] text-sm bg-white rounded-2xl border border-[#e5e5e7]">No meetings.</div>
            )}
          </div>
        )}

        {tab === 'minutes' && (
          <div className="space-y-3">
            {((minutesList as any[]) || []).filter((m: any) => m.status !== 'draft').map((minutes: any) => {
              const statusInfo = MINUTES_STATUS_COLOR[minutes.status] || { label: minutes.status, color: '#86868b' };
              return (
                <button key={minutes.id}
                  onClick={() => setLocation(`/board/minutes/${minutes.id}`)}
                  className="w-full bg-white rounded-2xl border border-[#e5e5e7] p-5 text-left hover:border-[#0071e3]/30 transition-colors flex items-center gap-4"
                  data-testid={`minutes-${minutes.id}`}>
                  <FileText size={18} className="text-[#86868b] flex-shrink-0" />
                  <div className="flex-1">
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium mb-1 inline-block" style={{ backgroundColor: statusInfo.color + '20', color: statusInfo.color }}>{statusInfo.label}</span>
                    <div className="font-medium text-[#1d1d1f] text-sm">{minutes.meetingTitle || 'Untitled'}</div>
                  </div>
                </button>
              );
            })}
            {(!minutesList || (minutesList as any[]).filter((m: any) => m.status !== 'draft').length === 0) && (
              <div className="text-center py-12 text-[#86868b] text-sm bg-white rounded-2xl border border-[#e5e5e7]">No published minutes.</div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
