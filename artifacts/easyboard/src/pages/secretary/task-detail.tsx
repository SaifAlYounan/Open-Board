import { useParams, useLocation } from 'wouter';
import { SecretarySidebar } from '@/components/SecretarySidebar';
import { useGetTask, useListPeople, useListBoards } from '@workspace/api-client-react';
import { ArrowLeft, CheckSquare, AlertTriangle, Calendar, User, FileText, Clock } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { getListTasksQueryKey } from '@workspace/api-client-react';

const STATUS_COLORS: Record<string, { color: string; label: string }> = {
  todo:               { color: '#86868b', label: 'To Do' },
  in_progress:        { color: '#ff9500', label: 'In Progress' },
  evidence_submitted: { color: '#0071e3', label: 'Evidence Submitted' },
  pending_review:     { color: '#5856d6', label: 'Pending Review' },
  done:               { color: '#34c759', label: 'Done' },
  overdue:            { color: '#ff3b30', label: 'Overdue' },
};

function getToken() { return localStorage.getItem('token'); }
function authHeaders() {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
}

export default function SecretaryTaskDetail() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [, setLocation] = useLocation();
  const { data: task, isLoading, refetch } = useGetTask(id);
  const { data: people } = useListPeople();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [editForm, setEditForm] = useState<any>(null);

  const t = task as any;
  const isOverdue = t?.dueDate && new Date(t.dueDate) < new Date() && t?.status !== 'done';
  const statusInfo = STATUS_COLORS[t?.status] || { color: '#86868b', label: t?.status };

  function startEdit() {
    setEditForm({
      title: t.title || '',
      description: t.description || '',
      status: t.status || 'todo',
      assigneeId: t.assigneeId || '',
      dueDate: t.dueDate ? t.dueDate.slice(0, 10) : '',
    });
  }

  async function saveEdit() {
    setSaving(true);
    const res = await fetch(`/api/tasks/${id}`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify(editForm),
    });
    setSaving(false);
    if (res.ok) {
      toast({ title: 'Task updated' });
      queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
      refetch();
      setEditForm(null);
    } else {
      toast({ title: 'Update failed', variant: 'destructive' });
    }
  }

  if (isLoading) return (
    <div className="flex h-screen bg-[#f5f5f7]">
      <SecretarySidebar />
      <main className="flex-1 ml-64 flex items-center justify-center text-[#86868b] text-sm">Loading task...</main>
    </div>
  );

  if (!t) return (
    <div className="flex h-screen bg-[#f5f5f7]">
      <SecretarySidebar />
      <main className="flex-1 ml-64 flex items-center justify-center text-[#86868b] text-sm">Task not found.</main>
    </div>
  );

  return (
    <div className="flex h-screen bg-[#f5f5f7]">
      <SecretarySidebar />
      <main className="flex-1 ml-64 overflow-y-auto">
        <div className="max-w-2xl mx-auto p-8 space-y-6">
          <button onClick={() => setLocation('/secretary/tasks')}
            className="flex items-center gap-2 text-sm text-[#86868b] hover:text-[#1d1d1f] transition-colors">
            <ArrowLeft size={14} /> Back to Tasks
          </button>

          {/* Header */}
          <div className="bg-white rounded-2xl border border-[#e5e5e7] p-6 space-y-3">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  {t.taskNumber && <span className="text-xs font-mono text-[#86868b]">{t.taskNumber}</span>}
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                    style={{ backgroundColor: statusInfo.color + '20', color: statusInfo.color }}>
                    {statusInfo.label}
                  </span>
                  {t.aiExtracted && (
                    <span className="text-xs bg-[#0071e3]/10 text-[#0071e3] px-1.5 py-0.5 rounded-full font-medium">AI</span>
                  )}
                  {isOverdue && <AlertTriangle size={12} className="text-[#ff3b30]" />}
                </div>
                <h1 className="text-xl font-semibold text-[#1d1d1f]">{t.title}</h1>
              </div>
              {!editForm && (
                <button onClick={startEdit}
                  className="text-sm text-[#0071e3] hover:underline ml-4 flex-shrink-0">Edit</button>
              )}
            </div>

            {editForm ? (
              <div className="space-y-4 pt-2 border-t border-[#f5f5f7]">
                <div>
                  <label className="text-xs font-medium text-[#86868b] mb-1 block">Title</label>
                  <input value={editForm.title} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                    className="w-full px-3 py-2 bg-[#f5f5f7] rounded-xl text-sm border-0 focus:outline-none focus:ring-2 focus:ring-[#0071e3]/30" />
                </div>
                <div>
                  <label className="text-xs font-medium text-[#86868b] mb-1 block">Description</label>
                  <textarea value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                    rows={3} className="w-full px-3 py-2 bg-[#f5f5f7] rounded-xl text-sm border-0 focus:outline-none focus:ring-2 focus:ring-[#0071e3]/30 resize-none" />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs font-medium text-[#86868b] mb-1 block">Status</label>
                    <select value={editForm.status} onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                      className="w-full px-3 py-2 bg-[#f5f5f7] rounded-xl text-sm border-0 focus:outline-none focus:ring-2 focus:ring-[#0071e3]/30">
                      {Object.entries(STATUS_COLORS).map(([key, { label }]) => (
                        <option key={key} value={key}>{label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-[#86868b] mb-1 block">Assignee</label>
                    <select value={editForm.assigneeId} onChange={(e) => setEditForm({ ...editForm, assigneeId: e.target.value })}
                      className="w-full px-3 py-2 bg-[#f5f5f7] rounded-xl text-sm border-0 focus:outline-none focus:ring-2 focus:ring-[#0071e3]/30">
                      <option value="">None</option>
                      {((people as any[]) || []).map((p: any) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-[#86868b] mb-1 block">Due Date</label>
                    <input type="date" value={editForm.dueDate} onChange={(e) => setEditForm({ ...editForm, dueDate: e.target.value })}
                      className="w-full px-3 py-2 bg-[#f5f5f7] rounded-xl text-sm border-0 focus:outline-none focus:ring-2 focus:ring-[#0071e3]/30" />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={saveEdit} disabled={saving}
                    className="px-4 py-2 bg-[#0071e3] text-white rounded-xl text-sm font-medium hover:bg-[#0077ed] disabled:opacity-50 transition-colors">
                    {saving ? 'Saving...' : 'Save Changes'}
                  </button>
                  <button onClick={() => setEditForm(null)}
                    className="px-4 py-2 bg-[#f5f5f7] text-[#1d1d1f] rounded-xl text-sm font-medium hover:bg-[#ebebed] transition-colors">Cancel</button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4 pt-2 border-t border-[#f5f5f7]">
                <div className="flex items-center gap-2 text-sm">
                  <User size={14} className="text-[#86868b]" />
                  <span className="text-[#86868b]">Assignee:</span>
                  <span className="text-[#1d1d1f] font-medium">{t.assignee?.name || 'Unassigned'}</span>
                </div>
                {t.dueDate && (
                  <div className={`flex items-center gap-2 text-sm ${isOverdue ? 'text-[#ff3b30]' : 'text-[#86868b]'}`}>
                    <Calendar size={14} />
                    <span>Due:</span>
                    <span className="font-medium">{new Date(t.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                  </div>
                )}
                {t.sourceMeetingTitle && (
                  <div className="flex items-center gap-2 text-sm col-span-2">
                    <FileText size={14} className="text-[#86868b]" />
                    <span className="text-[#86868b]">From meeting:</span>
                    <span className="text-[#1d1d1f] font-medium">{t.sourceMeetingTitle}</span>
                  </div>
                )}
                {t.createdAt && (
                  <div className="flex items-center gap-2 text-sm text-[#86868b] col-span-2">
                    <Clock size={14} />
                    <span>Created:</span>
                    <span>{new Date(t.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Description */}
          {t.description && !editForm && (
            <div className="bg-white rounded-2xl border border-[#e5e5e7] p-6">
              <h2 className="text-sm font-semibold text-[#86868b] uppercase tracking-wide mb-3">Description</h2>
              <p className="text-sm text-[#1d1d1f] leading-relaxed whitespace-pre-wrap">{t.description}</p>
            </div>
          )}

          {/* Source document */}
          {t.sourceDocumentTitle && (
            <div className="bg-white rounded-2xl border border-[#e5e5e7] p-6">
              <h2 className="text-sm font-semibold text-[#86868b] uppercase tracking-wide mb-2">Source Document</h2>
              <div className="flex items-center gap-2 text-sm text-[#1d1d1f]">
                <FileText size={14} className="text-[#0071e3]" />
                {t.sourceDocumentTitle}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
