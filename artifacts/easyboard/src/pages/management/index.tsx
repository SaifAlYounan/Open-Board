import { useLocation } from 'wouter';
import { TopNav } from '@/components/TopNav';
import { StatCard } from '@/components/StatCard';
import { AiBanner } from '@/components/AiBanner';
import { useAuth } from '@/lib/auth';
import { useListTasks, useGetDashboardSummary } from '@workspace/api-client-react';
import { CheckSquare, AlertTriangle, ArrowRight, Clock } from 'lucide-react';

const STATUS_COLORS: Record<string, { color: string; label: string }> = {
  todo: { color: '#86868b', label: 'To Do' },
  in_progress: { color: '#ff9500', label: 'In Progress' },
  evidence_submitted: { color: '#0071e3', label: 'Evidence Submitted' },
  pending_review: { color: '#5856d6', label: 'Pending Review' },
  done: { color: '#34c759', label: 'Done' },
  overdue: { color: '#ff3b30', label: 'Overdue' },
};

export default function ManagementDashboard() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const { data: summary } = useGetDashboardSummary();
  const { data: tasks } = useListTasks({ assigneeId: user?.id });

  const s = summary as any;
  const taskList = ((tasks as any[]) || []).filter((t: any) => t.status !== 'done');
  const overdueTasks = taskList.filter((t: any) => t.dueDate && new Date(t.dueDate) < new Date());

  return (
    <div className="min-h-screen bg-[#f5f5f7]">
      <TopNav showBoardSelector={false} />
      <main className="pt-20 px-8 pb-8 max-w-4xl mx-auto space-y-8">
        <div>
          <h1 className="text-2xl font-semibold text-[#1d1d1f]">My Dashboard</h1>
          <p className="text-sm text-[#86868b] mt-1">Your tasks and board action items.</p>
        </div>

        <AiBanner />

        <div className="grid grid-cols-3 gap-4">
          <StatCard label="Open Tasks" value={taskList.length} color="#0071e3" testId="stat-open-tasks" />
          <StatCard label="Overdue" value={overdueTasks.length} color="#ff3b30" testId="stat-overdue" />
          <StatCard label="Completed" value={(tasks as any[])?.filter((t: any) => t.status === 'done').length || 0} color="#34c759" testId="stat-completed" />
        </div>

        {/* My Tasks */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-[#1d1d1f]">My Tasks</h2>
            <button onClick={() => setLocation('/management/tasks')} className="text-sm text-[#0071e3] hover:underline">
              View all
            </button>
          </div>

          {taskList.length === 0 && (
            <div className="text-center py-12 bg-white rounded-2xl border border-[#e5e5e7]">
              <CheckSquare size={36} className="text-[#34c759] mx-auto mb-3" />
              <div className="text-[#1d1d1f] font-medium">All tasks complete</div>
              <div className="text-[#86868b] text-sm mt-1">No pending action items.</div>
            </div>
          )}

          <div className="space-y-3">
            {taskList.slice(0, 5).map((task: any) => {
              const statusInfo = STATUS_COLORS[task.status] || { color: '#86868b', label: task.status };
              const isOverdue = task.dueDate && new Date(task.dueDate) < new Date();
              return (
                <button
                  key={task.id}
                  onClick={() => setLocation(`/management/task/${task.id}`)}
                  className={`w-full bg-white rounded-2xl border p-5 text-left hover:shadow-sm transition-all flex items-center gap-4 ${isOverdue ? 'border-[#ff3b30]/30' : 'border-[#e5e5e7]'}`}
                  style={isOverdue ? { borderLeftWidth: 4, borderLeftColor: '#ff3b30' } : {}}
                  data-testid={`task-card-${task.id}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      {task.taskNumber && <span className="text-xs font-mono text-[#86868b]">{task.taskNumber}</span>}
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{
                        backgroundColor: statusInfo.color + '20', color: statusInfo.color
                      }}>{statusInfo.label}</span>
                      {isOverdue && <AlertTriangle size={12} className="text-[#ff3b30]" />}
                    </div>
                    <div className="font-medium text-[#1d1d1f] truncate">{task.title}</div>
                    {task.sourceMeetingTitle && <div className="text-xs text-[#86868b] mt-0.5">From: {task.sourceMeetingTitle}</div>}
                    {task.dueDate && (
                      <div className={`text-xs mt-1 flex items-center gap-1 ${isOverdue ? 'text-[#ff3b30] font-medium' : 'text-[#86868b]'}`}>
                        <Clock size={11} /> Due {new Date(task.dueDate).toLocaleDateString()}
                      </div>
                    )}
                  </div>
                  <ArrowRight size={14} className="text-[#86868b] flex-shrink-0" />
                </button>
              );
            })}
          </div>
        </div>
      </main>
    </div>
  );
}
