import { useState } from 'react';
import { SecretarySidebar } from '@/components/SecretarySidebar';
import { StatCard } from '@/components/StatCard';
import { AiBanner } from '@/components/AiBanner';
import { DocumentUploadPanel } from '@/components/DocumentUploadPanel';
import { useGetDashboardSummary, useAiCommand } from '@workspace/api-client-react';
import { useToast } from '@/hooks/use-toast';
import { Sparkles, ArrowRight } from 'lucide-react';
import { useLocation } from 'wouter';

export default function SecretaryDashboard() {
  const [command, setCommand] = useState('');
  const [aiResult, setAiResult] = useState<{ understood: boolean; interpretation: string; pendingActionIds: string[] } | null>(null);
  const [, setLocation] = useLocation();
  const { data: summary } = useGetDashboardSummary();
  const aiCommand = useAiCommand();
  const { toast } = useToast();

  const handleCommand = async () => {
    if (!command.trim()) return;
    aiCommand.mutate({ data: { command } }, {
      onSuccess: (res: any) => {
        setAiResult(res);
        if (res.pendingActionIds?.length) {
          toast({ title: 'AI actions created', description: `${res.pendingActionIds.length} action(s) sent to your queue.` });
        }
        setCommand('');
      },
      onError: () => {
        toast({ title: 'Command failed', description: 'Try again or check your API key.', variant: 'destructive' });
      }
    });
  };

  const s = summary as any;

  return (
    <div className="flex h-screen bg-[#f5f5f7]">
      <SecretarySidebar />
      <main className="flex-1 lg:ml-64 pt-14 lg:pt-0 overflow-y-auto">
        <div className="max-w-5xl mx-auto p-8 space-y-8">
          <div>
            <h1 className="text-2xl font-semibold text-[#1d1d1f]">Secretary Dashboard</h1>
            <p className="text-sm text-[#86868b] mt-1">Manage the board, approve AI actions, and keep everything moving.</p>
          </div>

          <AiBanner />

          {/* AI Command Bar */}
          <div className="bg-white rounded-2xl border border-[#e5e5e7] p-6">
            <div className="flex items-center gap-2 mb-4">
              <Sparkles size={18} className="text-[#0071e3]" />
              <h2 className="font-semibold text-[#1d1d1f]">AI Command</h2>
              <span className="text-xs bg-[#0071e3]/10 text-[#0071e3] px-2 py-0.5 rounded-full font-medium">Natural language</span>
            </div>
            <div className="flex gap-3">
              <input
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCommand()}
                placeholder="Schedule a Board of Directors meeting for next Thursday at 10am..."
                className="flex-1 px-4 py-3 bg-[#f5f5f7] border-0 rounded-xl text-sm text-[#1d1d1f] placeholder-[#86868b] focus:outline-none focus:ring-2 focus:ring-[#0071e3]/30"
                data-testid="input-ai-command"
              />
              <button
                onClick={handleCommand}
                disabled={aiCommand.isPending || !command.trim()}
                className="px-5 py-3 bg-[#0071e3] text-white rounded-xl text-sm font-medium disabled:opacity-50 hover:bg-[#0077ed] transition-colors flex items-center gap-2"
                data-testid="button-ai-command-submit"
              >
                {aiCommand.isPending ? 'Processing...' : 'Submit'}
                <ArrowRight size={14} />
              </button>
            </div>

            {aiResult && (
              <div className={`mt-4 p-4 rounded-xl text-sm ${aiResult.understood ? 'bg-[#f0fdf4] border border-[#34c759]/20 text-[#1d1d1f]' : 'bg-[#fff8ed] border border-[#ff9500]/20 text-[#1d1d1f]'}`}>
                <div className="font-medium mb-1">{aiResult.understood ? 'Understood:' : 'Clarification needed:'}</div>
                <div className="text-[#86868b]">{aiResult.interpretation}</div>
                {aiResult.pendingActionIds?.length > 0 && (
                  <button
                    onClick={() => setLocation('/secretary/pending')}
                    className="mt-3 text-[#0071e3] text-xs font-medium hover:underline flex items-center gap-1"
                  >
                    View {aiResult.pendingActionIds.length} action(s) in queue <ArrowRight size={12} />
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Document Upload — above stats */}
          <DocumentUploadPanel />

          {/* Stats */}
          <div className="grid grid-cols-4 gap-4">
            <StatCard label="Pending AI Actions" value={s?.pendingActionsCount ?? 0} color="#ff9500" testId="stat-pending-actions" />
            <StatCard label="Open Votes" value={s?.openVotesCount ?? 0} color="#0071e3" testId="stat-open-votes" />
            <StatCard label="Minutes in Review" value={s?.minutesInReviewCount ?? 0} color="#34c759" testId="stat-minutes-review" />
            <StatCard label="Upcoming Meeting" value={s?.nextMeeting?.title || 'None scheduled'} color="#5856d6" testId="stat-next-meeting" />
          </div>
        </div>
      </main>
    </div>
  );
}
