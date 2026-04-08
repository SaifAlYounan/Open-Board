import { useState, useEffect } from 'react';
import { SecretarySidebar } from '@/components/SecretarySidebar';
import {
  useListPendingActions,
  useApprovePendingAction,
  useRejectPendingAction,
  useListMeetings,
  useListPeople,
  useListBoards,
  getListPendingActionsQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { CheckCircle, XCircle, Edit3, Sparkles, Clock, FileText, ChevronDown, ChevronUp } from 'lucide-react';

const ACTION_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  create_minutes:    { label: 'Create Minutes',    color: '#5856d6' },
  create_vote:       { label: 'Create Vote',        color: '#0071e3' },
  create_meeting:    { label: 'Create Meeting',     color: '#34c759' },
  create_task:       { label: 'Create Task',        color: '#ff9500' },
  close_task:        { label: 'Close Task',         color: '#34c759' },
  attach_to_meeting: { label: 'Attach Document',    color: '#86868b' },
  flag_confidential: { label: 'Flag Confidential',  color: '#ff3b30' },
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs font-medium text-[#1d1d1f] mb-1.5 block">{label}</label>
      {children}
    </div>
  );
}

const INPUT_CLS = "w-full px-3 py-2 bg-[#f5f5f7] rounded-xl text-sm border-0 focus:outline-none focus:ring-2 focus:ring-[#0071e3]/30";

export default function PendingActions() {
  const { data: actions, isLoading } = useListPendingActions({ status: 'pending' });
  const { data: meetings } = useListMeetings();
  const { data: people }   = useListPeople();
  const { data: boards }   = useListBoards();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const approveMutation = useApprovePendingAction();
  const rejectMutation  = useRejectPendingAction();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFormData, setEditFormData] = useState<Record<string, any>>({});
  // Pre-selected meeting for create_minutes (per action id)
  const [selectedMeetings, setSelectedMeetings] = useState<Record<string, string>>({});

  // Pre-set the most recent meeting for each create_minutes action
  useEffect(() => {
    if (!meetings || !actions) return;
    const meetingList = (meetings as any[]);
    const sorted = [...meetingList].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const mostRecent = sorted[0]?.id || '';
    setSelectedMeetings((prev) => {
      const newSelected: Record<string, string> = {};
      for (const action of (actions as any[])) {
        if (action.actionType === 'create_minutes' && !prev[action.id]) {
          newSelected[action.id] = mostRecent;
        }
      }
      if (Object.keys(newSelected).length === 0) return prev;
      return { ...prev, ...newSelected };
    });
  }, [meetings, actions]);

  const handleApprove = (id: string, overrideData?: unknown) => {
    const payload: any = {};
    if (overrideData) payload.actionData = overrideData;
    approveMutation.mutate({ id, data: payload }, {
      onSuccess: () => {
        toast({ title: 'Action approved', description: 'The entity has been created.' });
        queryClient.invalidateQueries({ queryKey: getListPendingActionsQueryKey() });
        setEditingId(null);
      },
      onError: (err: any) => {
        toast({ title: 'Approval failed', description: err.data?.error || 'Please try again.', variant: 'destructive' });
      }
    });
  };

  const handleApproveMinutes = (action: any) => {
    const baseData = action.actionData || {};
    const meetingId = selectedMeetings[action.id] || undefined;
    handleApprove(action.id, { ...baseData, meetingId });
  };

  const handleReject = (id: string) => {
    rejectMutation.mutate({ id, data: {} }, {
      onSuccess: () => {
        toast({ title: 'Action rejected' });
        queryClient.invalidateQueries({ queryKey: getListPendingActionsQueryKey() });
      }
    });
  };

  const handleEditSave = (action: any) => {
    handleApprove(action.id, editFormData);
  };

  function startEdit(action: any) {
    const d = action.actionData || {};
    setEditingId(action.id);
    setEditFormData({ ...d });
  }

  function updateField(field: string, value: any) {
    setEditFormData((prev) => ({ ...prev, [field]: value }));
  }

  function renderEditForm(action: any) {
    const type = action.actionType;
    const f = editFormData;

    if (type === 'create_meeting') {
      return (
        <div className="space-y-3 pt-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Meeting Title">
              <input value={f.title || ''} onChange={(e) => updateField('title', e.target.value)} className={INPUT_CLS} placeholder="Q2 2026 Board Meeting" />
            </Field>
            <Field label="Board">
              <select value={f.boardId || ''} onChange={(e) => updateField('boardId', e.target.value)} className={INPUT_CLS}>
                <option value="">No board</option>
                {(boards as any[] || []).map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </Field>
            <Field label="Date & Time">
              <input type="datetime-local" value={(f.date || '').slice(0, 16)} onChange={(e) => updateField('date', e.target.value)} className={INPUT_CLS} />
            </Field>
            <Field label="Location">
              <input value={f.location || ''} onChange={(e) => updateField('location', e.target.value)} className={INPUT_CLS} placeholder="Boardroom A" />
            </Field>
          </div>
        </div>
      );
    }

    if (type === 'create_vote') {
      return (
        <div className="space-y-3 pt-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Resolution Title">
              <input value={f.title || ''} onChange={(e) => updateField('title', e.target.value)} className={INPUT_CLS} placeholder="Approve Budget 2026" />
            </Field>
            <Field label="Board">
              <select value={f.boardId || ''} onChange={(e) => updateField('boardId', e.target.value)} className={INPUT_CLS}>
                <option value="">No board</option>
                {(boards as any[] || []).map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </Field>
            <Field label="Deadline">
              <input type="date" value={(f.deadline || '').slice(0, 10)} onChange={(e) => updateField('deadline', e.target.value)} className={INPUT_CLS} />
            </Field>
          </div>
          <Field label="Resolution Text">
            <textarea value={f.voteText || ''} onChange={(e) => updateField('voteText', e.target.value)} rows={3} className={INPUT_CLS + ' resize-none'} placeholder="Resolved that..." />
          </Field>
        </div>
      );
    }

    if (type === 'create_task') {
      return (
        <div className="space-y-3 pt-3">
          <Field label="Task Title">
            <input value={f.title || ''} onChange={(e) => updateField('title', e.target.value)} className={INPUT_CLS} placeholder="Prepare financial report" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Assignee">
              <select value={f.assigneeId || ''} onChange={(e) => updateField('assigneeId', e.target.value)} className={INPUT_CLS}>
                <option value="">No assignee</option>
                {(people as any[] || []).filter((p: any) => p.role === 'management' || p.role === 'member').map((p: any) => (
                  <option key={p.id} value={p.id}>{p.name} — {p.title || p.role}</option>
                ))}
              </select>
            </Field>
            <Field label="Due Date">
              <input type="date" value={(f.dueDate || '').slice(0, 10)} onChange={(e) => updateField('dueDate', e.target.value)} className={INPUT_CLS} />
            </Field>
          </div>
          <Field label="Description">
            <textarea value={f.description || ''} onChange={(e) => updateField('description', e.target.value)} rows={2} className={INPUT_CLS + ' resize-none'} placeholder="Task details..." />
          </Field>
        </div>
      );
    }

    if (type === 'create_minutes') {
      return (
        <div className="space-y-3 pt-3">
          <Field label="Link to Meeting">
            <select
              value={f.meetingId || ''}
              onChange={(e) => updateField('meetingId', e.target.value)}
              className={INPUT_CLS}
            >
              <option value="">No meeting — standalone</option>
              {(meetings as any[] || []).map((m: any) => (
                <option key={m.id} value={m.id}>
                  {m.title} — {new Date(m.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Meeting Title (override)">
            <input value={f.meetingTitle || ''} onChange={(e) => updateField('meetingTitle', e.target.value)} className={INPUT_CLS} placeholder="Optional title override" />
          </Field>
        </div>
      );
    }

    // Fallback: raw JSON editor for other types
    return (
      <div className="pt-3">
        <Field label="Action Data (JSON)">
          <textarea
            value={JSON.stringify(f, null, 2)}
            onChange={(e) => {
              try { setEditFormData(JSON.parse(e.target.value)); } catch {}
            }}
            rows={6}
            className={INPUT_CLS + ' font-mono text-xs resize-none'}
          />
        </Field>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-[#f5f5f7]">
      <SecretarySidebar />
      <main className="flex-1 ml-64 overflow-y-auto">
        <div className="max-w-3xl mx-auto p-8 space-y-6">
          <div>
            <h1 className="text-2xl font-semibold text-[#1d1d1f]">Pending AI Actions</h1>
            <p className="text-sm text-[#86868b] mt-1">Review what the AI wants to create. You approve — it executes.</p>
          </div>

          {isLoading && <div className="text-center py-16 text-[#86868b] text-sm">Loading...</div>}

          {!isLoading && (!actions || (actions as any[]).length === 0) && (
            <div className="text-center py-16">
              <CheckCircle size={40} className="text-[#34c759] mx-auto mb-4" />
              <div className="text-[#1d1d1f] font-medium">All caught up</div>
              <div className="text-[#86868b] text-sm mt-1">No pending AI actions. Upload a document to get started.</div>
            </div>
          )}

          <div className="space-y-4">
            {(actions as any[] || []).map((action: any) => {
              const typeInfo = ACTION_TYPE_LABELS[action.actionType] || { label: action.actionType, color: '#86868b' };
              const confidence = action.aiConfidence ? Math.round(action.aiConfidence * 100) : null;
              const isEditing = editingId === action.id;
              const isCreateMinutes = action.actionType === 'create_minutes';

              return (
                <div key={action.id} className="bg-white rounded-2xl border border-[#e5e5e7] p-6 space-y-4" data-testid={`pending-action-${action.id}`}>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <Sparkles size={14} className="text-[#0071e3]" />
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
                        style={{ backgroundColor: typeInfo.color + '20', color: typeInfo.color }}>
                        {typeInfo.label}
                      </span>
                      {confidence !== null && (
                        <span className="text-xs text-[#86868b]">{confidence}% confident</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 text-xs text-[#86868b]">
                      <Clock size={12} />
                      {new Date(action.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </div>
                  </div>

                  {action.documentTitle && (
                    <div className="flex items-center gap-2 text-xs text-[#86868b]">
                      <FileText size={12} />
                      Source: <span className="font-medium text-[#1d1d1f]">{action.documentTitle}</span>
                    </div>
                  )}

                  <div className="text-sm text-[#1d1d1f]">
                    <span className="font-medium">AI says: </span>
                    {action.aiDescription || 'No description provided'}
                  </div>

                  {/* Minutes meeting picker — always visible for create_minutes */}
                  {isCreateMinutes && !isEditing && (
                    <div className="p-4 bg-[#f0f6ff] rounded-xl space-y-2">
                      <div className="text-xs font-medium text-[#0071e3]">Link to a meeting (optional):</div>
                      <select
                        value={selectedMeetings[action.id] || ''}
                        onChange={(e) => setSelectedMeetings((prev) => ({ ...prev, [action.id]: e.target.value }))}
                        className="w-full px-3 py-2 bg-white rounded-xl text-sm border border-[#e5e5e7] focus:outline-none focus:ring-2 focus:ring-[#0071e3]/30"
                        data-testid="select-minutes-meeting-picker"
                      >
                        <option value="">No meeting — create standalone</option>
                        {(meetings as any[] || []).map((m: any) => (
                          <option key={m.id} value={m.id}>
                            {m.title} — {new Date(m.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Structured edit form */}
                  {isEditing && (
                    <div className="border-t border-[#f5f5f7] space-y-3">
                      {renderEditForm(action)}
                      <div className="flex gap-2 pt-1">
                        <button onClick={() => handleEditSave(action)}
                          disabled={approveMutation.isPending}
                          className="px-4 py-2 bg-[#0071e3] text-white rounded-xl text-sm font-medium hover:bg-[#0077ed] transition-colors disabled:opacity-50"
                          data-testid="button-save-edit">
                          Save & Approve
                        </button>
                        <button onClick={() => setEditingId(null)}
                          className="px-4 py-2 bg-[#f5f5f7] text-[#1d1d1f] rounded-xl text-sm font-medium hover:bg-[#ebebed] transition-colors">
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Action buttons */}
                  {!isEditing && (
                    <div className="flex items-center gap-2 pt-2 border-t border-[#f5f5f7]">
                      <button
                        onClick={() => isCreateMinutes ? handleApproveMinutes(action) : handleApprove(action.id)}
                        disabled={approveMutation.isPending}
                        className="flex items-center gap-1.5 px-4 py-2 bg-[#34c759] text-white rounded-xl text-sm font-medium hover:bg-[#30b84f] transition-colors disabled:opacity-50"
                        data-testid="button-approve-action"
                      >
                        <CheckCircle size={14} /> {isCreateMinutes ? 'Create Minutes' : 'Approve'}
                      </button>
                      <button
                        onClick={() => startEdit(action)}
                        className="flex items-center gap-1.5 px-4 py-2 bg-[#f5f5f7] text-[#1d1d1f] rounded-xl text-sm font-medium hover:bg-[#ebebed] transition-colors"
                        data-testid="button-edit-action"
                      >
                        <Edit3 size={14} /> Edit
                      </button>
                      <button
                        onClick={() => handleReject(action.id)}
                        disabled={rejectMutation.isPending}
                        className="flex items-center gap-1.5 px-4 py-2 bg-[#ff3b30]/10 text-[#ff3b30] rounded-xl text-sm font-medium hover:bg-[#ff3b30]/20 transition-colors disabled:opacity-50"
                        data-testid="button-reject-action"
                      >
                        <XCircle size={14} /> Reject
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </main>
    </div>
  );
}
