import { useLocation } from 'wouter';
import { TopNav } from '@/components/TopNav';
import { useAuth } from '@/lib/auth';
import { useListTasks } from '@workspace/api-client-react';
import { CheckSquare, AlertTriangle, Clock, ArrowRight, ArrowLeft } from 'lucide-react';

const STATUS_COLORS: Record<string, { color: string; label: string }> = {
  todo:               { color: '#86868b', label: 'To Do' },
  in_progress:        { color: '#ff9500', label: 'In Progress' },
  evidence_submitted: { color: '#0071e3', label: 'Evidence Submitted' },
  pending_review:     { color: '#5856d6', label: 'Pending Review' },
  done:               { color: '#34c759', label: 'Done' },
  overdue:            { color: '#ff3b30', label: 'Overdue' },
};

export default function ManagementTasks() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const { data: tasks, isLoading } = useListTasks({ assigneeId: user?.id });

  const taskList = (tasks as any[]) || [];
  const openTasks = taskList.filter((t: any) => t.status !== 'done');
  const doneTasks = taskList.filter((t: any) => t.status === 'done');

  const isOverdue = (task: any) => task.dueDate && new Date(task.dueDate) < new Date() && task.status !== 'done';

  function TaskCard({ task }: { task: any }) {
    const statusInfo = STATUS_COLORS[task.status] || { color: '#86868b', label: task.status };
    const overdue = isOverdue(task);
    return (
      <button
        onClick={() => setLocation(`/management/task/${task.id}`)}
        className={`w-full bg-white rounded-2xl border p-5 text-left hover:shadow-sm transition-all flex items-center gap-4 ${overdue ? 'border-[#ff3b30]/30' : 'border-[#e5e5e7]'}`}
        style={overdue ? { borderLeftWidth: 4, borderLeftColor: '#ff3b30' } : {}}
        data-testid={`task-card-${task.id}`}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            {task.taskNumber && <span className="text-xs font-mono text-[#86868b]">{task.taskNumber}</span>}
            <span className="text-xs px-2 py-0.5 rounded-full font-medium"
              style={{ backgroundColor: statusInfo.color + '20', color: statusInfo.color }}>
              {statusInfo.label}
            </span>
            {overdue && <AlertTriangle size={12} className="text-[#ff3b30]" />}
          </div>
          <div className="font-medium text-[#1d1d1f] truncate">{task.title}</div>
          {task.sourceMeetingTitle && <div className="text-xs text-[#86868b] mt-0.5">From: {task.sourceMeetingTitle}</div>}
          {task.dueDate && (
            <div className={`text-xs mt-1 flex items-center gap-1 ${overdue ? 'text-[#ff3b30] font-medium' : 'text-[#86868b]'}`}>
              <Clock size={11} /> Due {new Date(task.dueDate).toLocaleDateString()}
            </div>
          )}
        </div>
        <ArrowRight size={14} className="text-[#86868b] flex-shrink-0" />
      </button>
    );
  }

  return (
    <div className="min-h-screen bg-[#f5f5f7]">
      <TopNav showBoardSelector={false} />
      <main className="pt-20 px-8 pb-8 max-w-3xl mx-auto space-y-6">
        <div>
          <button onClick={() => setLocation('/management')}
            className="flex items-center gap-1.5 text-sm text-[#86868b] hover:text-[#1d1d1f] mb-4 transition-colors">
            <ArrowLeft size={14} /> Dashboard
          </button>
          <h1 className="text-2xl font-semibold text-[#1d1d1f]">My Tasks</h1>
          <p className="text-sm text-[#86868b] mt-1">All action items assigned to you.</p>
        </div>

        {isLoading && <div className="text-center py-16 text-[#86868b] text-sm">Loading tasks...</div>}

        {openTasks.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-[#1d1d1f]">Open ({openTasks.length})</h2>
            {openTasks.map((task: any) => <TaskCard key={task.id} task={task} />)}
          </div>
        )}

        {doneTasks.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-[#86868b]">Completed ({doneTasks.length})</h2>
            {doneTasks.map((task: any) => <TaskCard key={task.id} task={task} />)}
          </div>
        )}

        {!isLoading && taskList.length === 0 && (
          <div className="text-center py-16">
            <CheckSquare size={40} className="text-[#34c759] mx-auto mb-4" />
            <div className="text-[#1d1d1f] font-medium">No tasks assigned</div>
            <div className="text-[#86868b] text-sm mt-1">Tasks assigned to you will appear here.</div>
          </div>
        )}
      </main>
    </div>
  );
}
