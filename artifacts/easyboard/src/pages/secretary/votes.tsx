import { useState } from 'react';
import { useLocation } from 'wouter';
import { SecretarySidebar } from '@/components/SecretarySidebar';
import {
  useListVotes,
  useCreateVote,
  useListBoards,
  useGetBoardMembers,
  getListVotesQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { VoteProgressBar } from '@/components/VoteProgressBar';
import { Plus, ChevronRight, GitBranch } from 'lucide-react';

const RULE_PRESETS = [
  { key: 'unanimous', label: 'Unanimous', description: 'All members must approve' },
  { key: 'majority', label: 'Simple Majority', description: '>50% must approve' },
  { key: 'two_thirds', label: 'Two-Thirds', description: '≥66.7% must approve' },
  { key: 'three_quarters', label: 'Three-Quarters', description: '≥75% must approve' },
  { key: 'custom', label: 'Custom', description: 'Set specific approval count' },
];

export default function SecretaryVotes() {
  const { data: votes, isLoading } = useListVotes();
  const { data: boards } = useListBoards();
  const [showCreate, setShowCreate] = useState(false);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const createVote = useCreateVote();

  const [form, setForm] = useState({
    boardId: '',
    title: '',
    resolutionText: '',
    type: 'circulation' as 'circulation' | 'meeting',
    deadline: '',
    ruleType: 'majority',
    customMinApprovals: '',
    customQuorum: '',
    deadlineBehavior: 'lapse',
    recusedIds: [] as string[],
    requiredVoterIds: [] as string[],
  });

  const { data: boardMembers } = useGetBoardMembers(form.boardId, { query: { enabled: !!form.boardId } });

  const toggleRecusal = (personId: string) => {
    setForm((prev) => ({
      ...prev,
      recusedIds: prev.recusedIds.includes(personId)
        ? prev.recusedIds.filter((id) => id !== personId)
        : [...prev.recusedIds, personId],
      requiredVoterIds: prev.requiredVoterIds.filter((id) => id !== personId),
    }));
  };

  const toggleRequiredVoter = (personId: string) => {
    setForm((prev) => ({
      ...prev,
      requiredVoterIds: prev.requiredVoterIds.includes(personId)
        ? prev.requiredVoterIds.filter((id) => id !== personId)
        : [...prev.requiredVoterIds, personId],
      recusedIds: prev.recusedIds.filter((id) => id !== personId),
    }));
  };

  const handleCreate = () => {
    if (!form.boardId || !form.title || !form.resolutionText) {
      toast({ title: 'Missing fields', description: 'Board, title, and resolution text are required.', variant: 'destructive' });
      return;
    }

    const selectedBoard = (boards as any[])?.find((b: any) => b.id === form.boardId);
    const abbrev = selectedBoard?.abbreviation || 'GEN';
    const year = new Date().getFullYear();
    const count = ((votes as any[])?.length || 0) + 1;
    const resolutionNumber = `RES-${abbrev}-${year}-${String(count).padStart(3, '0')}`;

    createVote.mutate({
      data: {
        boardId: form.boardId,
        resolutionNumber,
        title: form.title,
        resolutionText: form.resolutionText,
        type: form.type,
        deadline: form.deadline || undefined,
        approvalRule: {
          type: form.ruleType,
          minApprovals: form.customMinApprovals ? parseInt(form.customMinApprovals) : undefined,
          quorum: form.customQuorum ? parseInt(form.customQuorum) : undefined,
          deadlineBehavior: form.deadlineBehavior,
          recusedIds: form.recusedIds.length > 0 ? form.recusedIds : undefined,
          requiredVoterIds: form.requiredVoterIds.length > 0 ? form.requiredVoterIds : undefined,
        }
      }
    }, {
      onSuccess: () => {
        toast({ title: 'Vote created' });
        queryClient.invalidateQueries({ queryKey: getListVotesQueryKey() });
        setShowCreate(false);
        setForm({ boardId: '', title: '', resolutionText: '', type: 'circulation', deadline: '', ruleType: 'majority', customMinApprovals: '', customQuorum: '', deadlineBehavior: 'lapse', recusedIds: [], requiredVoterIds: [] });
      },
      onError: (err: any) => {
        toast({ title: 'Create failed', description: err.data?.error || 'Please try again.', variant: 'destructive' });
      }
    });
  };

  const STATUS_COLORS: Record<string, string> = {
    open: '#0071e3', approved: '#34c759', rejected: '#ff3b30', lapsed: '#86868b', cancelled: '#ff9500'
  };

  return (
    <div className="flex h-screen bg-[#f5f5f7]">
      <SecretarySidebar />
      <main className="flex-1 ml-64 overflow-y-auto">
        <div className="max-w-4xl mx-auto p-8 space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-[#1d1d1f]">Votes</h1>
              <p className="text-sm text-[#86868b] mt-1">All board resolutions and circulation votes</p>
            </div>
            <button
              onClick={() => setShowCreate(!showCreate)}
              className="flex items-center gap-2 px-4 py-2.5 bg-[#0071e3] text-white rounded-xl text-sm font-medium hover:bg-[#0077ed] transition-colors"
              data-testid="button-create-vote"
            >
              <Plus size={16} /> Create Vote
            </button>
          </div>

          {showCreate && (
            <div className="bg-white rounded-2xl border border-[#e5e5e7] p-6 space-y-5">
              <h2 className="font-semibold text-[#1d1d1f]">New Resolution</h2>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-[#1d1d1f] mb-1.5 block">Board</label>
                  <select value={form.boardId} onChange={(e) => setForm({ ...form, boardId: e.target.value })}
                    className="w-full px-3 py-2.5 bg-[#f5f5f7] rounded-xl text-sm text-[#1d1d1f] border-0 focus:outline-none focus:ring-2 focus:ring-[#0071e3]/30" data-testid="select-board">
                    <option value="">Select board...</option>
                    {(boards as any[] || []).map((b: any) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-[#1d1d1f] mb-1.5 block">Type</label>
                  <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as any })}
                    className="w-full px-3 py-2.5 bg-[#f5f5f7] rounded-xl text-sm text-[#1d1d1f] border-0 focus:outline-none focus:ring-2 focus:ring-[#0071e3]/30" data-testid="select-vote-type">
                    <option value="circulation">Circulation</option>
                    <option value="meeting">Meeting</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-[#1d1d1f] mb-1.5 block">Resolution Title</label>
                <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="e.g., Approval of Q1 2026 Financial Statements"
                  className="w-full px-3 py-2.5 bg-[#f5f5f7] rounded-xl text-sm text-[#1d1d1f] border-0 focus:outline-none focus:ring-2 focus:ring-[#0071e3]/30" data-testid="input-vote-title" />
              </div>

              <div>
                <label className="text-xs font-medium text-[#1d1d1f] mb-1.5 block">Resolution Text</label>
                <textarea value={form.resolutionText} onChange={(e) => setForm({ ...form, resolutionText: e.target.value })}
                  placeholder="RESOLVED THAT the Board of Directors of Meridian Energy Group hereby approves..."
                  rows={4}
                  className="w-full px-3 py-2.5 bg-[#f5f5f7] rounded-xl text-sm text-[#1d1d1f] border-0 focus:outline-none focus:ring-2 focus:ring-[#0071e3]/30 resize-none" data-testid="textarea-resolution-text" />
              </div>

              {form.type === 'circulation' && (
                <div>
                  <label className="text-xs font-medium text-[#1d1d1f] mb-1.5 block">Deadline</label>
                  <input type="date" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })}
                    className="w-full px-3 py-2.5 bg-[#f5f5f7] rounded-xl text-sm text-[#1d1d1f] border-0 focus:outline-none focus:ring-2 focus:ring-[#0071e3]/30" data-testid="input-vote-deadline" />
                </div>
              )}

              <div>
                <label className="text-xs font-medium text-[#1d1d1f] mb-2 block">Approval Rule</label>
                <div className="grid grid-cols-4 gap-2">
                  {RULE_PRESETS.map((preset) => (
                    <button
                      key={preset.key}
                      onClick={() => setForm({ ...form, ruleType: preset.key })}
                      className={`p-3 rounded-xl border text-left transition-colors ${
                        form.ruleType === preset.key
                          ? 'border-[#0071e3] bg-[#0071e3]/5'
                          : 'border-[#e5e5e7] bg-white hover:bg-[#f5f5f7]'
                      }`}
                      data-testid={`button-rule-${preset.key}`}
                    >
                      <div className="text-xs font-semibold text-[#1d1d1f]">{preset.label}</div>
                      <div className="text-xs text-[#86868b] mt-0.5">{preset.description}</div>
                    </button>
                  ))}
                </div>

                {form.ruleType === 'custom' && (
                  <div className="mt-3 grid grid-cols-2 gap-3 p-4 bg-[#f5f5f7] rounded-xl">
                    <div>
                      <label className="text-xs font-medium text-[#1d1d1f] mb-1 block">Min Approvals</label>
                      <input type="number" value={form.customMinApprovals} onChange={(e) => setForm({ ...form, customMinApprovals: e.target.value })}
                        className="w-full px-3 py-2 bg-white rounded-lg text-sm border-0 focus:outline-none focus:ring-2 focus:ring-[#0071e3]/30" />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-[#1d1d1f] mb-1 block">Quorum</label>
                      <input type="number" value={form.customQuorum} onChange={(e) => setForm({ ...form, customQuorum: e.target.value })}
                        className="w-full px-3 py-2 bg-white rounded-lg text-sm border-0 focus:outline-none focus:ring-2 focus:ring-[#0071e3]/30" />
                    </div>
                  </div>
                )}

                {/* Recusals and Key Approvers */}
                {form.boardId && (boardMembers as any[] || []).length > 0 && (() => {
                  const votingMembers = (boardMembers as any[] || []).filter(
                    (m: any) => m.roleInBoard !== 'observer' && m.roleInBoard !== 'secretary'
                  );
                  return (
                    <div className="mt-3 space-y-3">
                      <div className="p-4 bg-[#f5f5f7] rounded-xl">
                        <label className="text-xs font-medium text-[#1d1d1f] mb-2 block">Recused Members</label>
                        <p className="text-xs text-[#86868b] mb-2">Members who must abstain from this vote due to a conflict of interest.</p>
                        <div className="flex flex-wrap gap-2">
                          {votingMembers.map((m: any) => {
                            const pid = m.personId;
                            const name = m.person?.name || pid;
                            const isRecused = form.recusedIds.includes(pid);
                            const isRequired = form.requiredVoterIds.includes(pid);
                            return (
                              <button
                                key={pid}
                                type="button"
                                onClick={() => !isRequired && toggleRecusal(pid)}
                                disabled={isRequired}
                                className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors ${
                                  isRecused
                                    ? 'border-[#ff3b30] bg-[#fff5f5] text-[#ff3b30]'
                                    : isRequired
                                    ? 'border-[#e5e5e7] bg-[#f5f5f7] text-[#86868b] cursor-not-allowed opacity-50'
                                    : 'border-[#e5e5e7] bg-white text-[#1d1d1f] hover:border-[#ff3b30]/50'
                                }`}
                                data-testid={`btn-recuse-${pid}`}
                              >
                                {isRecused ? '✕ ' : ''}{name}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <div className="p-4 bg-[#f5f5f7] rounded-xl">
                        <label className="text-xs font-medium text-[#1d1d1f] mb-2 block">Key Approvers</label>
                        <p className="text-xs text-[#86868b] mb-2">Members whose approval is required for this resolution to pass, regardless of majority.</p>
                        <div className="flex flex-wrap gap-2">
                          {votingMembers.map((m: any) => {
                            const pid = m.personId;
                            const name = m.person?.name || pid;
                            const isRequired = form.requiredVoterIds.includes(pid);
                            const isRecused = form.recusedIds.includes(pid);
                            return (
                              <button
                                key={pid}
                                type="button"
                                onClick={() => !isRecused && toggleRequiredVoter(pid)}
                                disabled={isRecused}
                                className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors ${
                                  isRequired
                                    ? 'border-[#0071e3] bg-[#f0f7ff] text-[#0071e3]'
                                    : isRecused
                                    ? 'border-[#e5e5e7] bg-[#f5f5f7] text-[#86868b] cursor-not-allowed opacity-50'
                                    : 'border-[#e5e5e7] bg-white text-[#1d1d1f] hover:border-[#0071e3]/50'
                                }`}
                                data-testid={`btn-required-${pid}`}
                              >
                                {isRequired ? '★ ' : ''}{name}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>

              {form.boardId && (
                <div className="text-xs text-[#86868b] bg-[#f5f5f7] rounded-lg px-3 py-2">
                  Resolution number will be: <span className="font-mono font-medium text-[#1d1d1f]">
                    RES-{(boards as any[])?.find((b: any) => b.id === form.boardId)?.abbreviation || 'GEN'}-{new Date().getFullYear()}-{String(((votes as any[])?.length || 0) + 1).padStart(3, '0')}
                  </span>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button onClick={handleCreate} disabled={createVote.isPending}
                  className="px-5 py-2.5 bg-[#0071e3] text-white rounded-xl text-sm font-medium hover:bg-[#0077ed] transition-colors disabled:opacity-50"
                  data-testid="button-submit-vote">
                  {createVote.isPending ? 'Creating...' : 'Create Resolution'}
                </button>
                <button onClick={() => setShowCreate(false)}
                  className="px-5 py-2.5 bg-[#f5f5f7] text-[#1d1d1f] rounded-xl text-sm font-medium hover:bg-[#ebebed] transition-colors">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {isLoading && <div className="text-center py-16 text-[#86868b] text-sm">Loading votes...</div>}

          <div className="space-y-3">
            {(votes as any[] || []).map((vote: any) => (
              <div
                key={vote.id}
                className="bg-white rounded-2xl border border-[#e5e5e7] p-5 cursor-pointer hover:border-[#0071e3]/30 hover:shadow-sm transition-all"
                onClick={() => setLocation(`/secretary/votes/${vote.id}`)}
                data-testid={`vote-card-${vote.id}`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-mono text-[#86868b]">{vote.resolutionNumber}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{
                        backgroundColor: STATUS_COLORS[vote.status] + '20',
                        color: STATUS_COLORS[vote.status]
                      }}>{vote.status}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-[#f5f5f7] text-[#86868b] font-medium capitalize">{vote.type}</span>
                      {vote.documentCount > 0 && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-[#f5f5f7] text-[#86868b]">{vote.documentCount} doc{vote.documentCount > 1 ? 's' : ''}</span>
                      )}
                      {vote.workflowStage && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-[#0071e3]/10 text-[#0071e3] font-medium flex items-center gap-1">
                          <GitBranch size={10} />
                          Workflow
                        </span>
                      )}
                    </div>
                    <div className="font-medium text-[#1d1d1f]">{vote.title}</div>
                    {vote.boardName && <div className="text-xs text-[#86868b] mt-0.5">{vote.boardName}</div>}
                  </div>
                  <ChevronRight size={16} className="text-[#86868b] flex-shrink-0 mt-1" />
                </div>
                <VoteProgressBar votescast={vote.votescast || 0} totalVoters={vote.totalVoters || 0} approvalsCount={vote.approvalsCount || 0} status={vote.status} />
                {vote.deadline && (
                  <div className="text-xs text-[#86868b] mt-2">
                    Deadline: {new Date(vote.deadline).toLocaleDateString()}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
