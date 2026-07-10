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
import { Calendar, FileText, Vote, MapPin, CheckCircle, Clock, ChevronRight, Paperclip, ChevronDown } from 'lucide-react';
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
  const [submittedVotes, setSubmittedVotes] = useState<Record<string, { decision: string; votedAt: string; comment?: string }>>({});
  const [docsExpanded, setDocsExpanded] = useState<Record<string, boolean>>({});
  const [docsMap, setDocsMap] = useState<Record<string, any[]>>({});

  const toggleDocs = async (voteId: string) => {
    if (!docsExpanded[voteId] && !docsMap[voteId]) {
      try {
        const resp = await fetch(`/api/votes/${voteId}/documents`, {
          credentials: 'include',
        });
        const data = await resp.json();
        setDocsMap((prev) => ({ ...prev, [voteId]: data }));
      } catch {
        setDocsMap((prev) => ({ ...prev, [voteId]: [] }));
      }
    }
    setDocsExpanded((prev) => ({ ...prev, [voteId]: !prev[voteId] }));
  };

  const b = board as any;

  // Voting state is keyed per ballot: the member's own ballot uses the vote id,
  // a proxy ballot uses `voteId:principalId` so the holder can compose both
  // distinctly on the same card.
  const ballotKey = (voteId: string, onBehalfOf?: string) => (onBehalfOf ? `${voteId}:${onBehalfOf}` : voteId);

  const handleVoteOption = (voteId: string, option: typeof VOTE_OPTIONS[0], onBehalfOf?: string) => {
    const key = ballotKey(voteId, onBehalfOf);
    if (option.needsComment) {
      setVotingState((prev) => ({
        ...prev,
        [key]: { decision: option.key, comment: prev[key]?.comment || '', showComment: true }
      }));
    } else {
      submitVote(voteId, option.key, '', onBehalfOf);
    }
  };

  const submitVote = (voteId: string, decision: string, comment: string, onBehalfOf?: string) => {
    const key = ballotKey(voteId, onBehalfOf);
    castVote.mutate({ id: voteId, data: { decision: decision as any, comment, ...(onBehalfOf ? { onBehalfOf } : {}) } }, {
      onSuccess: () => {
        toast({
          title: onBehalfOf ? 'Proxy ballot cast' : 'Vote cast',
          description: `${onBehalfOf ? 'Ballot recorded for the member you represent' : 'Your vote'}: ${decision.replace(/_/g, ' ')}`,
        });
        setSubmittedVotes((prev) => ({ ...prev, [key]: { decision, votedAt: new Date().toISOString(), comment: comment || undefined } }));
        setVotingState((prev) => { const n = { ...prev }; delete n[key]; return n; });
        queryClient.invalidateQueries({ queryKey: getListVotesQueryKey({ boardId }) });
      },
      onError: (err: any) => {
        if (err.status === 409) {
          toast({ title: 'Already voted', description: onBehalfOf ? 'A ballot has already been cast for this member.' : 'You have already cast your vote on this resolution.', variant: 'destructive' });
        } else {
          toast({ title: 'Vote failed', description: err.data?.error, variant: 'destructive' });
        }
      }
    });
  };

  const STATUS_LABEL: Record<string, string> = {
    open: 'Open', approved: 'Approved', rejected: 'Rejected', lapsed: 'Lapsed', cancelled: 'Cancelled'
  };
  const STATUS_COLOR: Record<string, string> = {
    open: '#0071e3', approved: '#34c759', rejected: '#ff3b30', lapsed: '#86868b', cancelled: '#ff9500'
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
                            <div className="flex items-center gap-2 flex-wrap">
                              <div className="font-semibold text-[#1d1d1f]">{vote.title}</div>
                              {vote.secret && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-[#1c1c1e] text-[#ff9f0a] border border-[#ff9f0a]/30">
                                  Secret Ballot
                                </span>
                              )}
                            </div>
                            {deadlineStr && (
                              <div className="flex items-center gap-1 text-xs text-[#ff9500] mt-1">
                                <Clock size={12} /> Deadline: {deadlineStr}
                              </div>
                            )}
                            {vote.secret && (
                              <div className="text-xs text-[#86868b] mt-1 italic">
                                This is a secret ballot. Individual votes are confidential.
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

                        {/* Supporting Materials */}
                        {(vote.documentCount || 0) > 0 && (
                          <div className="mt-3">
                            <button
                              onClick={() => toggleDocs(vote.id)}
                              className="flex items-center gap-1.5 text-xs text-[#0071e3] hover:text-[#0077ed] transition-colors"
                              data-testid={`btn-view-docs-${vote.id}`}
                            >
                              <Paperclip size={12} />
                              {vote.documentCount} Supporting Document{vote.documentCount > 1 ? 's' : ''}
                              <ChevronDown size={12} className={cn('transition-transform', docsExpanded[vote.id] && 'rotate-180')} />
                            </button>
                            {docsExpanded[vote.id] && (
                              <div className="mt-2 space-y-1.5">
                                {(docsMap[vote.id] || []).map((doc: any) => (
                                  <div key={doc.id} className="flex items-center gap-2 p-2.5 bg-[#f5f5f7] rounded-lg">
                                    <FileText size={13} className="text-[#0071e3] flex-shrink-0" />
                                    <div className="flex-1 min-w-0">
                                      <p className="text-xs font-medium text-[#1d1d1f] truncate">{doc.title}</p>
                                      <p className="text-xs text-[#86868b]">{doc.filename}{doc.fileSize ? ` · ${(doc.fileSize / 1024).toFixed(0)} KB` : ''}</p>
                                    </div>
                                  </div>
                                ))}
                                {docsMap[vote.id]?.length === 0 && (
                                  <p className="text-xs text-[#86868b] p-2">No documents loaded.</p>
                                )}
                              </div>
                            )}
                          </div>
                        )}

                        {hasVoted ? (
                          <div className="mt-4 p-3 bg-[#f0fdf4] rounded-xl space-y-1" data-testid={`vote-confirmed-${vote.id}`}>
                            <div className="flex items-center gap-2 text-sm">
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
                            {myVote?.comment && (
                              <div className="text-xs text-[#1d1d1f] pl-6 italic">"{myVote.comment}"</div>
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

                        {/* Proxy ballots this user holds — cast distinctly from their own vote */}
                        {user?.role === 'member' && ((vote.myProxies as any[]) || []).map((p: any) => {
                          const key = ballotKey(vote.id, p.principalId);
                          const proxySubmitted = submittedVotes[key];
                          const pState = votingState[key];
                          if (p.hasVoted || proxySubmitted) {
                            return (
                              <div key={p.principalId} className="mt-3 p-3 bg-[#f5f3ff] rounded-xl flex items-center gap-2 text-sm" data-testid={`proxy-confirmed-${vote.id}-${p.principalId}`}>
                                <CheckCircle size={16} className="text-[#5856d6]" />
                                <span className="text-[#1d1d1f]">
                                  Ballot recorded for <strong>{p.principalName || 'the member you represent'}</strong>
                                  {proxySubmitted ? <> — <strong>{proxySubmitted.decision.replace(/_/g, ' ')}</strong> (cast by you as proxy)</> : null}
                                </span>
                              </div>
                            );
                          }
                          return (
                            <div key={p.principalId} className="mt-4 border border-[#5856d6]/30 bg-[#f5f3ff]/40 rounded-xl p-4 space-y-3" data-testid={`proxy-ballot-${vote.id}-${p.principalId}`}>
                              <div className="text-sm text-[#1d1d1f]">
                                <span className="inline-block text-xs font-medium text-[#5856d6] bg-[#5856d6]/10 px-2 py-0.5 rounded-full mr-2">Proxy</span>
                                You hold a proxy for <strong>{p.principalName || 'a member'}</strong> — cast their ballot (recorded as cast by you on their behalf):
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                {VOTE_OPTIONS.map((option) => (
                                  <button
                                    key={option.key}
                                    onClick={() => handleVoteOption(vote.id, option, p.principalId)}
                                    disabled={castVote.isPending}
                                    className="py-2.5 px-4 rounded-xl text-sm font-medium transition-colors text-white disabled:opacity-50"
                                    style={{ backgroundColor: option.color }}
                                    data-testid={`proxy-option-${option.key}-${vote.id}-${p.principalId}`}
                                  >
                                    {option.label}
                                  </button>
                                ))}
                              </div>
                              {pState?.showComment && (
                                <div className="space-y-2">
                                  <textarea
                                    value={pState.comment}
                                    onChange={(e) => setVotingState((prev) => ({
                                      ...prev,
                                      [key]: { ...prev[key], comment: e.target.value }
                                    }))}
                                    placeholder={`Comment on behalf of ${p.principalName || 'the member'}...`}
                                    rows={3}
                                    className="w-full px-3 py-2 bg-white rounded-xl text-sm border border-[#e5e5e7] focus:outline-none focus:ring-2 focus:ring-[#5856d6]/30 resize-none"
                                    data-testid={`proxy-comment-${vote.id}-${p.principalId}`}
                                  />
                                  <div className="flex gap-2">
                                    <button
                                      onClick={() => submitVote(vote.id, pState.decision, pState.comment, p.principalId)}
                                      disabled={castVote.isPending}
                                      className="px-4 py-2 bg-[#5856d6] text-white rounded-xl text-sm font-medium disabled:opacity-50"
                                      data-testid={`button-submit-proxy-${vote.id}-${p.principalId}`}
                                    >
                                      Submit Proxy Ballot
                                    </button>
                                    <button
                                      onClick={() => setVotingState((prev) => { const n = { ...prev }; delete n[key]; return n; })}
                                      className="px-4 py-2 bg-[#f5f5f7] text-[#1d1d1f] rounded-xl text-sm font-medium"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
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
              <button key={meeting.id} onClick={() => setLocation(`/board/meetings/${meeting.id}`)}
                className="w-full bg-white rounded-2xl border border-[#e5e5e7] p-5 text-left hover:border-[#0071e3]/30 hover:shadow-sm transition-all"
                data-testid={`meeting-${meeting.id}`}>
                <div className="flex items-start justify-between">
                  <div>
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
                  <ChevronRight size={16} className="text-[#86868b] flex-shrink-0 mt-1" />
                </div>
              </button>
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
                <div
                  key={minutes.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setLocation(`/board/minutes/${minutes.id}`)}
                  onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setLocation(`/board/minutes/${minutes.id}`); } }}
                  className="w-full bg-white rounded-2xl border border-[#e5e5e7] p-5 text-left hover:border-[#0071e3]/30 transition-colors flex items-center gap-4 cursor-pointer"
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
                    <button
                      type="button"
                      data-testid={`sign-btn-${minutes.id}`}
                      onClick={(e) => { e.stopPropagation(); setLocation(`/board/minutes/${minutes.id}/sign`); }}
                      className="text-xs px-2 py-1 bg-[#0071e3] text-white rounded-lg font-medium hover:bg-[#0077ed] transition-colors"
                    >Sign</button>
                  )}
                </div>
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
