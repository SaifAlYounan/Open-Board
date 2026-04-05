import { useLocation } from 'wouter';
import { SecretarySidebar } from '@/components/SecretarySidebar';
import { useListMinutes } from '@workspace/api-client-react';
import { FileText, ChevronRight } from 'lucide-react';

const STATUS_COLORS: Record<string, { label: string; color: string }> = {
  draft: { label: 'Draft', color: '#86868b' },
  review: { label: 'In Review', color: '#ff9500' },
  signing: { label: 'Signing', color: '#0071e3' },
  signed: { label: 'Signed', color: '#34c759' },
};

export default function SecretaryMinutesList() {
  const { data: minutesList, isLoading } = useListMinutes();
  const [, setLocation] = useLocation();

  return (
    <div className="flex h-screen bg-[#f5f5f7]">
      <SecretarySidebar />
      <main className="flex-1 ml-64 overflow-y-auto">
        <div className="max-w-4xl mx-auto p-8 space-y-6">
          <div>
            <h1 className="text-2xl font-semibold text-[#1d1d1f]">Minutes</h1>
            <p className="text-sm text-[#86868b] mt-1">All board meeting minutes including drafts</p>
          </div>

          {isLoading && <div className="text-center py-16 text-[#86868b] text-sm">Loading...</div>}

          {!isLoading && (!minutesList || (minutesList as any[]).length === 0) && (
            <div className="text-center py-16">
              <FileText size={40} className="text-[#86868b] mx-auto mb-4" />
              <div className="text-[#1d1d1f] font-medium">No minutes yet</div>
              <div className="text-[#86868b] text-sm mt-1">Upload a draft minutes document to get started.</div>
            </div>
          )}

          <div className="space-y-3">
            {(minutesList as any[] || []).map((minutes: any) => {
              const statusInfo = STATUS_COLORS[minutes.status] || { label: minutes.status, color: '#86868b' };
              return (
                <button
                  key={minutes.id}
                  onClick={() => setLocation(`/secretary/minutes/${minutes.id}`)}
                  className="w-full bg-white rounded-2xl border border-[#e5e5e7] p-5 hover:border-[#0071e3]/30 transition-colors text-left flex items-center gap-4"
                  data-testid={`minutes-card-${minutes.id}`}
                >
                  <FileText size={20} className="text-[#86868b] flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{
                        backgroundColor: statusInfo.color + '20', color: statusInfo.color
                      }}>{statusInfo.label}</span>
                      {minutes.boardName && <span className="text-xs text-[#86868b]">{minutes.boardName}</span>}
                    </div>
                    <div className="font-medium text-[#1d1d1f] truncate">{minutes.meetingTitle || 'Untitled meeting'}</div>
                    {minutes.meetingDate && (
                      <div className="text-xs text-[#86868b] mt-0.5">{new Date(minutes.meetingDate).toLocaleDateString()}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-[#86868b] flex-shrink-0">
                    {minutes.signatureCount > 0 && <span>{minutes.signatureCount} signed</span>}
                    {minutes.commentCount > 0 && <span>{minutes.commentCount} comments</span>}
                    <ChevronRight size={16} />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </main>
    </div>
  );
}
