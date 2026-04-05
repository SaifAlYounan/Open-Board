import { useLocation } from 'wouter';
import { TopNav } from '@/components/TopNav';
import { useListMinutes } from '@workspace/api-client-react';
import { FileText, ArrowLeft } from 'lucide-react';

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  draft:   { label: 'Draft',     color: '#86868b' },
  review:  { label: 'In Review', color: '#ff9500' },
  signing: { label: 'Signing',   color: '#0071e3' },
  signed:  { label: 'Signed',    color: '#34c759' },
};

export default function ManagementMinutes() {
  const [, setLocation] = useLocation();
  const { data: minutesList, isLoading } = useListMinutes({});

  const visible = ((minutesList as any[]) || []).filter((m: any) => m.status !== 'draft');

  return (
    <div className="min-h-screen bg-[#f5f5f7]">
      <TopNav showBoardSelector={false} />
      <main className="pt-20 px-8 pb-8 max-w-3xl mx-auto space-y-6">
        <div>
          <button onClick={() => setLocation('/management')}
            className="flex items-center gap-1.5 text-sm text-[#86868b] hover:text-[#1d1d1f] mb-4 transition-colors">
            <ArrowLeft size={14} /> Dashboard
          </button>
          <h1 className="text-2xl font-semibold text-[#1d1d1f]">Board Minutes</h1>
          <p className="text-sm text-[#86868b] mt-1">Published minutes from board and committee meetings.</p>
        </div>

        {isLoading && <div className="text-center py-16 text-[#86868b] text-sm">Loading minutes...</div>}

        {!isLoading && visible.length === 0 && (
          <div className="text-center py-16">
            <FileText size={40} className="text-[#86868b] mx-auto mb-4" />
            <div className="text-[#1d1d1f] font-medium">No minutes available</div>
            <div className="text-[#86868b] text-sm mt-1">Published minutes will appear here.</div>
          </div>
        )}

        <div className="space-y-3">
          {visible.map((m: any) => {
            const statusInfo = STATUS_CONFIG[m.status] || { label: m.status, color: '#86868b' };
            return (
              <button
                key={m.id}
                onClick={() => setLocation(`/board/minutes/${m.id}`)}
                className="w-full bg-white rounded-2xl border border-[#e5e5e7] p-5 text-left hover:border-[#0071e3]/30 hover:shadow-sm transition-all flex items-center gap-4"
                data-testid={`minutes-${m.id}`}
              >
                <FileText size={18} className="text-[#86868b] flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                      style={{ backgroundColor: statusInfo.color + '20', color: statusInfo.color }}>
                      {statusInfo.label}
                    </span>
                    {m.boardName && (
                      <span className="text-xs text-[#86868b] font-mono">{m.boardName}</span>
                    )}
                  </div>
                  <div className="font-medium text-[#1d1d1f] truncate">{m.meetingTitle || 'Board Minutes'}</div>
                  {m.meetingDate && (
                    <div className="text-xs text-[#86868b] mt-0.5">
                      {new Date(m.meetingDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                    </div>
                  )}
                </div>
                {m.signaturesCount > 0 && (
                  <div className="text-xs text-[#34c759] font-medium flex-shrink-0">
                    {m.signaturesCount} signed
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </main>
    </div>
  );
}
