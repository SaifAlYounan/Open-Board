import { useState } from 'react';
import { SecretarySidebar } from '@/components/SecretarySidebar';
import {
  useListPendingActions,
  useApprovePendingAction,
  useRejectPendingAction,
  useListMeetings,
  getListPendingActionsQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { CheckCircle, XCircle, Edit3, Sparkles, Clock, FileText } from 'lucide-react';

const ACTION_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  create_minutes:    { label: 'Create Minutes',    color: '#5856d6' },
  create_vote:       { label: 'Create Vote',        color: '#0071e3' },
  create_meeting:    { label: 'Create Meeting',     color: '#34c759' },
  create_task:       { label: 'Create Task',        color: '#ff9500' },
  close_task:        { label: 'Close Task',         color: '#34c759' },
  attach_to_meeting: { label: 'Attach Document',    color: '#86868b' },
  flag_confidential: { label: 'Flag Confidential',  color: '#ff3b30' },
};

export default function PendingActions() {
  const { data: actions, isLoading } = useListPendingActions({ status: 'pending' });
  const { data: meetings } = useListMeetings();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const approveMutation = useApprovePendingAction();
  const rejectMutation = useRejectPendingAction();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editData, setEditData] = useState('');
  // For create_minutes: let Secretary pick meeting before approve
  const [meetingPickerId, setMeetingPickerId] = useState<string | null>(null);
  const [selectedMeetingId, setSelectedMeetingId] = useState('');

  const handleApprove = (id: string, overrideData?: unknown) => {
    const payload: any = {};
    if (overrideData) payload.actionData = overrideData;
    approveMutation.mutate({ id, data: payload }, {
      onSuccess: () => {
        toast({ title: 'Action approved', description: 'The entity has been created.' });
        queryClient.invalidateQueries({ queryKey: getListPendingActionsQueryKey() });
        setEditingId(null);
        setMeetingPickerId(null);
        setSelectedMeetingId('');
      },
      onError: (err: any) => {
        toast({ title: 'Approval failed', description: err.data?.error || 'Please try again.', variant: 'destructive' });
      }
    });
  };

  const handleApproveMinutes = (action: any) => {
    const baseData = action.actionData || {};
    const overrideData = {
      ...baseData,
      meetingId: selectedMeetingId || undefined,
    };
    handleApprove(action.id, overrideData);
  };

  const handleReject = (id: string) => {
    rejectMutation.mutate({ id, data: {} }, {
      onSuccess: () => {
        toast({ title: 'Action rejected' });
        queryClient.invalidateQueries({ queryKey: getListPendingActionsQueryKey() });
      }
    });
  };

  const handleEditSave = (id: string) => {
    try {
      const parsed = JSON.parse(editData);
      handleApprove(id, parsed);
    } catch {
      toast({ title: 'Invalid JSON', description: 'Please fix the JSON before saving.', variant: 'destructive' });
    }
  };

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
              const isMinutesPicker = meetingPickerId === action.id;
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

                  {/* Minutes meeting picker */}
                  {isCreateMinutes && isMinutesPicker && !isEditing && (
                    <div className="p-4 bg-[#f5f5f7] rounded-xl space-y-3">
                      <div className="text-xs font-medium text-[#1d1d1f]">Link these minutes to a meeting:</div>
                      <select
                        value={selectedMeetingId}
                        onChange={(e) => setSelectedMeetingId(e.target.value)}
                        className="w-full px-3 py-2 bg-white rounded-xl text-sm border-0 focus:outline-none focus:ring-2 focus:ring-[#0071e3]/30"
                        data-testid="select-minutes-meeting-picker"
                      >
                        <option value="">No meeting — create standalone</option>
                        {(meetings as any[] || []).map((m: any) => (
                          <option key={m.id} value={m.id}>
                            {m.title} — {new Date(m.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          </option>
                        ))}
                      </select>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleApproveMinutes(action)}
                          disabled={approveMutation.isPending}
                          className="px-4 py-2 bg-[#34c759] text-white rounded-xl text-sm font-medium hover:bg-[#30b84f] transition-colors disabled:opacity-50"
                          data-testid="button-confirm-approve-minutes"
                        >
                          <CheckCircle size={14} className="inline mr-1" /> Confirm & Create
                        </button>
                        <button onClick={() => setMeetingPickerId(null)}
                          className="px-4 py-2 bg-white text-[#1d1d1f] rounded-xl text-sm font-medium border border-[#e5e5e7]">
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {isEditing ? (
                    <div className="space-y-3">
                      <textarea
                        value={editData}
                        onChange={(e) => setEditData(e.target.value)}
                        className="w-full h-40 px-4 py-3 bg-[#f5f5f7] rounded-xl text-xs font-mono text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-[#0071e3]/30 resize-none"
                        data-testid="textarea-edit-action"
                      />
                      <div className="flex gap-2">
                        <button onClick={() => handleEditSave(action.id)}
                          className="px-4 py-2 bg-[#0071e3] text-white rounded-xl text-sm font-medium hover:bg-[#0077ed] transition-colors"
                          data-testid="button-save-edit">
                          Save & Approve
                        </button>
                        <button onClick={() => setEditingId(null)}
                          className="px-4 py-2 bg-[#f5f5f7] text-[#1d1d1f] rounded-xl text-sm font-medium hover:bg-[#ebebed] transition-colors">
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : !isMinutesPicker && (
                    <div className="flex items-center gap-2 pt-2 border-t border-[#f5f5f7]">
                      <button
                        onClick={() => {
                          if (isCreateMinutes) {
                            setMeetingPickerId(action.id);
                            setSelectedMeetingId('');
                          } else {
                            handleApprove(action.id);
                          }
                        }}
                        disabled={approveMutation.isPending}
                        className="flex items-center gap-1.5 px-4 py-2 bg-[#34c759] text-white rounded-xl text-sm font-medium hover:bg-[#30b84f] transition-colors disabled:opacity-50"
                        data-testid="button-approve-action"
                      >
                        <CheckCircle size={14} /> Approve
                      </button>
                      <button
                        onClick={() => {
                          setEditingId(action.id);
                          setEditData(JSON.stringify(action.actionData, null, 2));
                          setMeetingPickerId(null);
                        }}
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
