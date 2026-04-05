import { useState } from 'react';
import { useParams, useLocation } from 'wouter';
import { TopNav } from '@/components/TopNav';
import { VoteProgressBar } from '@/components/VoteProgressBar';
import { useAuth } from '@/lib/auth';
import {
  useGetBoard, useListVotes, useListMeetings, useListMinutes,
  useCastVote, getListVotesQueryKey,
  getGetBoardQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { Calendar, FileText, Vote, MapPin, CheckCircle, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

type Tab = 'votes' | 'meetings' | 'minutes';

const VOTE_OPTIONS = [
  { key: 'approved', label: 'Approved', color: '#34c759' },
  { key: 'approved_with_comments', label: 'Approved with Comments', color: '#34c759', needsComment: true },
  { key: 'not_approved', label: 'Not Approved', color: '#ff3b30' },
  { key: 'not_approved_with_comments', label: 'Not Approved with Comments', color: '#ff3b30', needsComment: true },
];

export default function BoardRoom() {
  const params = useParams<{ boardId: string }>();
  const boardId = params.boardId;
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>('votes');
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: board } = useGetBoard(boardId, { query: { queryKey: getGetBoardQueryKey(boardId) } });
  const { data: votes } = useListVotes({ boardId });
  const { data: meetings } = useListMeetings({ boardId });
  const { data: minutesList } = useListMinutes({ boardId });
  const castVote = useCastVote();

  const [votingState, setVotingState] = useState<Record<string, { decision: string; comment: string; showComment: boolean }>>({});
  const [submittedVotes, setSubmittedVotes] = useState<Record<string, { decision: string; votedAt: string }>>({});

  const b = board as any;

  const handleVoteOption = (voteId: string, option: typeof VOTE_OPTIONS[0]) => {
    if (option.needsComment) {
      setVotingState((prev) => ({
        ...prev,
        [voteId]: { decision: option.key, comment: prev[voteId]?.comment || '', showComment: true }
      }));
    } else {
      submitVote(voteId, option.key, '');
    }
  };

  const submitVote = (voteId: string, decision: string, comment: string) => {
    castVote.mutate({ id: voteId, data: { decision, comment } }, {
      onSuccess: () => {
        toast({ title: 'Vote cast', description: `Your vote: ${decision.replace(/_/g, ' ')}` });
        setSubmittedVotes((prev) => ({ ...prev, [voteId]: { decision, votedAt: new Date().toISOString() } }));
        setVotingState((prev) => { const n = { ...prev }; delete n[voteId]; return n; });
        queryClient.invalidateQueries({ queryKey: getListVotesQueryKey({ boardId }) });
      },
      onError: (err: any) => {
        if (err.status === 409) {
          toast({ title: 'Already voted', description: 'You have already cast your vote on this resolution.', variant: 'destructive' });
        } else {
          toast({ title: 'Vote failed', description: err.data?.error, variant: 'destructive' });
        }
      }
    });
  };

  const STATUS_LABEL: Record<string, string> = {
    open: 'Open', approved: 'Approved', rejected: 'Rejected', lapsed: 'Lapsed'
  };
  const STATUS_COLOR: Record<string, string> = {
    open: '#0071e3', approved: '#34c759', rejected: '#ff3b30', lapsed: '#86868b'
  };
  const MINUTES_STATUS_COLOR: Record<string, { label: string; color: string }> = {
    draft: { label: 'Draft', color: '#86868b' },
    review: { label: 'In Review', color: '#ff9500' },
    signing: { label: 'Signing', color: '#0071e3' },
    signed: { label: 'Signed', color: '#34c759' },
  };

  const openVotes = ((votes as any[]) || []).filter((v: any) => v.status === 'open');
  const closedVotes = ((votes as any[]) || []).filter((v: any) => v.status !== 'open');

  return (
    <div className="min-h-screen bg-[#f5f5f7]">
      <TopNav />
      <main className="pt-20 px-8 pb-8 max-w-4xl mx-auto space-y-6">
        <div>
          <div className="text-xs font-mono text-[#86868b]">{b?.abbreviation}</div>
          <h1 className="text-2xl font-semibold text-[#1d1d1f]">{b?.name || 'Board Room'}</h1>
        </div>

        <div className="flex gap-1 bg-white rounded-xl border border-[#e5e5e7] p-1 w-fit">
          {(['votes', 'meetings', 'minutes'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'px-5 py-2 rounded-lg text-sm font-medium transition-colors capitalize',
                tab === t ? 'bg-[#0071e3] text-white' : 'text-[#86868b] hover:text-[#1d1d1f]'
              )}
              data-testid={`tab-${t}`}
            >
              {t}
            </button>
          ))}
        </div>

        {tab === 'votes' && (
          <div className="space-y-6">
            {openVotes.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-[#1d1d1f] mb-3">Open Votes</h2>
                <div className="space-y-4">
                  {openVotes.map((vote: any) => {
                    const hasVoted = vote.hasVoted || !!submittedVotes[vote.id];
                    const myVote = submittedVotes[vote.id] || (vote.hasVoted ? vote.myVote : null);
                    const vState = votingState[vote.id];
                    const deadline = vote.deadline ? new Date(vote.deadline) : null;
                    const deadlineStr = deadline ? deadline.toLocaleDateString() : null;

                    return (
                      <div key={vote.id} className="bg-white rounded-2xl border border-[#e5e5e7] p-6" data-testid={`vote-${vote.id}`}>
                        <div className="flex items-start justify-between mb-3">
                          <div>
                            <div className="text-xs font-mono text-[#86868b] mb-0.5">{vote.resolutionNumber}</div>
                            <div className="font-semibold text-[#1d1d1f]">{vote.title}</div>
                            {deadlineStr && (
                              <div className="flex items-center gap-1 text-xs text-[#ff9500] mt-1">
                                <Clock size={12} /> Deadline: {deadlineStr}
                              </div>
                            )}
                          </div>
                        </div>

                        <VoteProgressBar
                          votescast={vote.votescast || 0}
                          totalVoters={vote.totalVoters || 0}
                          approvalsCount={vote.approvalsCount || 0}
                          status={vote.status}
                        />

                        {hasVoted ? (
                          <div className="mt-4 p-3 bg-[#f0fdf4] rounded-xl flex items-center gap-2 text-sm" data-testid={`vote-confirmed-${vote.id}`}>
                            <CheckCircle size={16} className="text-[#34c759]" />
                            <span className="text-[#1d1d1f]">
                              Your vote: <strong>{(myVote?.decision || '').replace(/_/g, ' ')}</strong>
                            </span>
                            {myVote?.votedAt && (
                              <span className="text-[#86868b] text-xs ml-auto">
                                {new Date(myVote.votedAt).toLocaleString()}
                              </span>
                            )}
                          </div>
                        ) : user?.role === 'member' ? (
                          <div className="mt-4 space-y-3" data-testid={`vote-buttons-${vote.id}`}>
                            <div className="grid grid-cols-2 gap-2">
                              {VOTE_OPTIONS.map((option) => (
                                <button
                                  key={option.key}
                                  onClick={() => handleVoteOption(vote.id, option)}
                                  disabled={castVote.isPending}
                                  className="py-2.5 px-4 rounded-xl text-sm font-medium transition-colors text-white disabled:opacity-50"
                                  style={{ backgroundColor: option.color }}
                                  data-testid={`vote-option-${option.key}-${vote.id}`}
                                >
                                  {option.label}
                                </button>
                              ))}
                            </div>

                            {vState?.showComment && (
                              <div className="space-y-2">
                                <textarea
                                  value={vState.comment}
                                  onChange={(e) => setVotingState((prev) => ({
                                    ...prev,
                                    [vote.id]: { ...prev[vote.id], comment: e.target.value }
                                  }))}
                                  placeholder="Your comment..."
                                  rows={3}
                                  className="w-full px-3 py-2 bg-[#f5f5f7] rounded-xl text-sm border-0 focus:outline-none focus:ring-2 focus:ring-[#0071e3]/30 resize-none"
                                  data-testid={`vote-comment-${vote.id}`}
                                />
                                <div className="flex gap-2">
                                  <button
                                    onClick={() => submitVote(vote.id, vState.decision, vState.comment)}
                                    disabled={castVote.isPending}
                                    className="px-4 py-2 bg-[#0071e3] text-white rounded-xl text-sm font-medium disabled:opacity-50"
                                    data-testid={`button-submit-vote-${vote.id}`}
                                  >
                                    Submit Vote
                                  </button>
                                  <button
                                    onClick={() => setVotingState((prev) => { const n = { ...prev }; delete n[vote.id]; return n; })}
                                    className="px-4 py-2 bg-[#f5f5f7] text-[#1d1d1f] rounded-xl text-sm font-medium"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {closedVotes.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-[#1d1d1f] mb-3">Closed Votes</h2>
                <div className="space-y-3">
                  {closedVotes.map((vote: any) => (
                    <div key={vote.id} className="bg-white rounded-2xl border border-[#e5e5e7] p-4 flex items-center gap-3" data-testid={`closed-vote-${vote.id}`}>
                      <div className="flex-1">
                        <div className="text-xs font-mono text-[#86868b]">{vote.resolutionNumber}</div>
                        <div className="text-sm font-medium text-[#1d1d1f]">{vote.title}</div>
                      </div>
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{
                        backgroundColor: STATUS_COLOR[vote.status] + '20', color: STATUS_COLOR[vote.status]
                      }}>{STATUS_LABEL[vote.status]}</span>
                      <button onClick={() => setLocation(`/board/vote/${vote.id}`)} className="text-xs text-[#0071e3] hover:underline">
                        Certificate
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {openVotes.length === 0 && closedVotes.length === 0 && (
              <div className="text-center py-16 text-[#86868b] text-sm">No votes for this board.</div>
            )}
          </div>
        )}

        {tab === 'meetings' && (
          <div className="space-y-3">
            {((meetings as any[]) || []).map((meeting: any) => (
              <div key={meeting.id} className="bg-white rounded-2xl border border-[#e5e5e7] p-5" data-testid={`meeting-${meeting.id}`}>
                <div className="font-medium text-[#1d1d1f]">{meeting.title}</div>
                <div className="flex items-center gap-4 mt-2 text-xs text-[#86868b]">
                  <span className="flex items-center gap-1">
                    <Calendar size={12} />
                    {new Date(meeting.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </span>
                  {meeting.location && <span className="flex items-center gap-1"><MapPin size={12} /> {meeting.location}</span>}
                  {meeting.agendaItemCount !== undefined && <span>{meeting.agendaItemCount} agenda items</span>}
                </div>
              </div>
            ))}
            {!meetings || (meetings as any[]).length === 0 && (
              <div className="text-center py-16 text-[#86868b] text-sm">No meetings for this board.</div>
            )}
          </div>
        )}

        {tab === 'minutes' && (
          <div className="space-y-3">
            {((minutesList as any[]) || []).filter((m: any) => m.status !== 'draft').map((minutes: any) => {
              const statusInfo = MINUTES_STATUS_COLOR[minutes.status] || { label: minutes.status, color: '#86868b' };
              return (
                <button
                  key={minutes.id}
                  onClick={() => setLocation(`/board/minutes/${minutes.id}`)}
                  className="w-full bg-white rounded-2xl border border-[#e5e5e7] p-5 text-left hover:border-[#0071e3]/30 transition-colors flex items-center gap-4"
                  data-testid={`minutes-${minutes.id}`}
                >
                  <FileText size={18} className="text-[#86868b] flex-shrink-0" />
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: statusInfo.color + '20', color: statusInfo.color }}>
                        {statusInfo.label}
                      </span>
                    </div>
                    <div className="font-medium text-[#1d1d1f] text-sm">{minutes.meetingTitle || 'Untitled meeting'}</div>
                    {minutes.meetingDate && <div className="text-xs text-[#86868b] mt-0.5">{new Date(minutes.meetingDate).toLocaleDateString()}</div>}
                  </div>
                  {minutes.status === 'signing' && !minutes.hasSigned && (
                    <span className="text-xs px-2 py-1 bg-[#0071e3] text-white rounded-lg font-medium">Sign</span>
                  )}
                </button>
              );
            })}
            {!minutesList || (minutesList as any[]).filter((m: any) => m.status !== 'draft').length === 0 && (
              <div className="text-center py-16 text-[#86868b] text-sm">No minutes available.</div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
