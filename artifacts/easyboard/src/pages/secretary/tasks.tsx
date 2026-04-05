import { useState } from 'react';
import { SecretarySidebar } from '@/components/SecretarySidebar';
import { useListTasks, useListPeople, useListBoards, useCreateTask, getListTasksQueryKey } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { Plus, CheckSquare, AlertTriangle } from 'lucide-react';

const STATUS_COLORS: Record<string, { color: string; label: string }> = {
  todo: { color: '#86868b', label: 'To Do' },
  in_progress: { color: '#ff9500', label: 'In Progress' },
  evidence_submitted: { color: '#0071e3', label: 'Evidence Submitted' },
  pending_review: { color: '#5856d6', label: 'Pending Review' },
  done: { color: '#34c759', label: 'Done' },
  overdue: { color: '#ff3b30', label: 'Overdue' },
};

export default function SecretaryTasks() {
  const { data: tasks, isLoading } = useListTasks();
  const { data: people } = useListPeople();
  const { data: boards } = useListBoards();
  const [showCreate, setShowCreate] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const createTask = useCreateTask();

  const [form, setForm] = useState({
    title: '', description: '', assigneeId: '', boardId: '', dueDate: '',
  });

  const handleCreate = () => {
    if (!form.title || !form.assigneeId) {
      toast({ title: 'Missing fields', description: 'Title and assignee are required.', variant: 'destructive' });
      return;
    }
    createTask.mutate({ data: { ...form, dueDate: form.dueDate || undefined } }, {
      onSuccess: () => {
        toast({ title: 'Task created' });
        queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
        setShowCreate(false);
        setForm({ title: '', description: '', assigneeId: '', boardId: '', dueDate: '' });
      },
      onError: (err: any) => toast({ title: 'Create failed', description: err.data?.error, variant: 'destructive' }),
    });
  };

  const isOverdue = (task: any) => task.dueDate && new Date(task.dueDate) < new Date() && task.status !== 'done';

  return (
    <div className="flex h-screen bg-[#f5f5f7]">
      <SecretarySidebar />
      <main className="flex-1 ml-64 overflow-y-auto">
        <div className="max-w-4xl mx-auto p-8 space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-[#1d1d1f]">Tasks</h1>
              <p className="text-sm text-[#86868b] mt-1">All action items extracted from board decisions</p>
            </div>
            <button onClick={() => setShowCreate(!showCreate)}
              className="flex items-center gap-2 px-4 py-2.5 bg-[#0071e3] text-white rounded-xl text-sm font-medium hover:bg-[#0077ed] transition-colors"
              data-testid="button-create-task">
              <Plus size={16} /> Create Task
            </button>
          </div>

          {showCreate && (
            <div className="bg-white rounded-2xl border border-[#e5e5e7] p-6 space-y-4">
              <h2 className="font-semibold text-[#1d1d1f]">New Task</h2>
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="Task title"
                className="w-full px-3 py-2.5 bg-[#f5f5f7] rounded-xl text-sm border-0 focus:outline-none focus:ring-2 focus:ring-[#0071e3]/30" data-testid="input-task-title" />
              <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Description (optional)" rows={3}
                className="w-full px-3 py-2.5 bg-[#f5f5f7] rounded-xl text-sm border-0 focus:outline-none focus:ring-2 focus:ring-[#0071e3]/30 resize-none" />
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-[#1d1d1f] mb-1.5 block">Assignee</label>
                  <select value={form.assigneeId} onChange={(e) => setForm({ ...form, assigneeId: e.target.value })}
                    className="w-full px-3 py-2.5 bg-[#f5f5f7] rounded-xl text-sm border-0 focus:outline-none focus:ring-2 focus:ring-[#0071e3]/30" data-testid="select-task-assignee">
                    <option value="">Select person...</option>
                    {(people as any[] || []).filter((p: any) => p.role === 'management' || p.role === 'member').map((p: any) => (
                      <option key={p.id} value={p.id}>{p.name} ({p.title || p.role})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-[#1d1d1f] mb-1.5 block">Due Date</label>
                  <input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
                    className="w-full px-3 py-2.5 bg-[#f5f5f7] rounded-xl text-sm border-0 focus:outline-none focus:ring-2 focus:ring-[#0071e3]/30" />
                </div>
              </div>
              <div className="flex gap-3">
                <button onClick={handleCreate} disabled={createTask.isPending}
                  className="px-5 py-2.5 bg-[#0071e3] text-white rounded-xl text-sm font-medium hover:bg-[#0077ed] transition-colors disabled:opacity-50"
                  data-testid="button-submit-task">
                  {createTask.isPending ? 'Creating...' : 'Create Task'}
                </button>
                <button onClick={() => setShowCreate(false)}
                  className="px-5 py-2.5 bg-[#f5f5f7] text-[#1d1d1f] rounded-xl text-sm font-medium hover:bg-[#ebebed] transition-colors">Cancel</button>
              </div>
            </div>
          )}

          {isLoading && <div className="text-center py-16 text-[#86868b] text-sm">Loading tasks...</div>}

          <div className="space-y-3">
            {(tasks as any[] || []).map((task: any) => {
              const statusInfo = STATUS_COLORS[task.status] || { color: '#86868b', label: task.status };
              const overdue = isOverdue(task);
              return (
                <div key={task.id}
                  className={`bg-white rounded-2xl border p-5 ${overdue ? 'border-[#ff3b30]/30' : 'border-[#e5e5e7]'}`}
                  style={overdue ? { borderLeftWidth: 4, borderLeftColor: '#ff3b30' } : {}}
                  data-testid={`task-card-${task.id}`}>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        {task.taskNumber && <span className="text-xs font-mono text-[#86868b]">{task.taskNumber}</span>}
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{
                          backgroundColor: statusInfo.color + '20', color: statusInfo.color
                        }}>{statusInfo.label}</span>
                        {task.aiExtracted && <span className="text-xs bg-[#0071e3]/10 text-[#0071e3] px-1.5 py-0.5 rounded-full font-medium">AI</span>}
                        {overdue && <AlertTriangle size={12} className="text-[#ff3b30]" />}
                      </div>
                      <div className="font-medium text-[#1d1d1f]">{task.title}</div>
                      {task.assignee && <div className="text-xs text-[#86868b] mt-0.5">Assigned to {task.assignee.name}</div>}
                      {task.dueDate && (
                        <div className={`text-xs mt-1 ${overdue ? 'text-[#ff3b30] font-medium' : 'text-[#86868b]'}`}>
                          Due: {new Date(task.dueDate).toLocaleDateString()}
                        </div>
                      )}
                      {task.sourceMeetingTitle && <div className="text-xs text-[#86868b] mt-0.5">From: {task.sourceMeetingTitle}</div>}
                    </div>
                  </div>
                </div>
              );
            })}
            {!isLoading && (!tasks || (tasks as any[]).length === 0) && (
              <div className="text-center py-16">
                <CheckSquare size={40} className="text-[#86868b] mx-auto mb-4" />
                <div className="text-[#1d1d1f] font-medium">No tasks yet</div>
                <div className="text-[#86868b] text-sm mt-1">Tasks are created from board decisions or manually.</div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
