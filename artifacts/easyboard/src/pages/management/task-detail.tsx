import { useState, useCallback } from 'react';
import { useParams, useLocation } from 'wouter';
import { TopNav } from '@/components/TopNav';
import { useAuth } from '@/lib/auth';
import { useGetTask, getGetTaskQueryKey } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { ArrowLeft, Upload, CheckCircle, XCircle, Clock, AlertTriangle } from 'lucide-react';
import { useDropzone } from 'react-dropzone';

const STATUS_COLORS: Record<string, { color: string; label: string }> = {
  todo: { color: '#86868b', label: 'To Do' },
  in_progress: { color: '#ff9500', label: 'In Progress' },
  evidence_submitted: { color: '#0071e3', label: 'Evidence Submitted' },
  pending_review: { color: '#5856d6', label: 'Pending Review' },
  done: { color: '#34c759', label: 'Done' },
  overdue: { color: '#ff3b30', label: 'Overdue' },
};

const VERDICT_ICON: Record<string, React.ReactNode> = {
  approved: <CheckCircle size={16} className="text-[#34c759]" />,
  rejected: <XCircle size={16} className="text-[#ff3b30]" />,
  pending: <Clock size={16} className="text-[#ff9500]" />,
};

export default function TaskDetail() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const { data: task, isLoading } = useGetTask(id, { query: { queryKey: getGetTaskQueryKey(id) } });
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [uploading, setUploading] = useState(false);

  const t = task as any;
  const statusInfo = STATUS_COLORS[t?.status] || { color: '#86868b', label: t?.status };
  const isOverdue = t?.dueDate && new Date(t.dueDate) < new Date() && t?.status !== 'done';

  const uploadEvidence = async (file: File) => {
    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);
    try {
      const response = await fetch(`/api/tasks/${id}/evidence`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Upload failed');
      }
      toast({ title: 'Evidence submitted', description: 'The AI will review it shortly.' });
      queryClient.invalidateQueries({ queryKey: getGetTaskQueryKey(id) });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      toast({ title: 'Upload failed', description: message, variant: 'destructive' });
    } finally {
      setUploading(false);
    }
  };

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles[0]) uploadEvidence(acceptedFiles[0]);
  }, [id]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    multiple: false,
    disabled: uploading || t?.status === 'done',
  });

  if (isLoading) return (
    <div className="min-h-screen bg-[#f5f5f7]">
      <TopNav />
      <div className="pt-20 flex items-center justify-center py-16 text-[#86868b] text-sm">Loading...</div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#f5f5f7]">
      <TopNav />
      <main className="pt-20 px-8 pb-8 max-w-3xl mx-auto space-y-6">
        <button onClick={() => setLocation('/management')}
          className="flex items-center gap-2 text-sm text-[#86868b] hover:text-[#1d1d1f] transition-colors">
          <ArrowLeft size={14} /> Back
        </button>

        <div className="bg-white rounded-2xl border border-[#e5e5e7] p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              {t?.taskNumber && <div className="text-xs font-mono text-[#86868b] mb-1">{t.taskNumber}</div>}
              <h1 className="text-xl font-semibold text-[#1d1d1f]">{t?.title}</h1>
              {t?.sourceMeetingTitle && (
                <div className="text-xs text-[#86868b] mt-1">From board decision: {t.sourceMeetingTitle}</div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{
                backgroundColor: statusInfo.color + '20', color: statusInfo.color
              }}>{statusInfo.label}</span>
              {isOverdue && <AlertTriangle size={14} className="text-[#ff3b30]" />}
            </div>
          </div>

          {t?.description && (
            <p className="text-sm text-[#86868b] mb-4">{t.description}</p>
          )}

          {t?.sourceParagraph && (
            <div className="bg-[#f5f5f7] rounded-xl p-4 border-l-4 border-[#0071e3] mb-4">
              <div className="text-xs text-[#86868b] mb-1 font-medium">From minutes:</div>
              <div className="text-sm text-[#1d1d1f] italic">"{t.sourceParagraph}"</div>
            </div>
          )}

          <div className="flex items-center gap-4 text-xs text-[#86868b]">
            {t?.dueDate && (
              <span className={`flex items-center gap-1 ${isOverdue ? 'text-[#ff3b30] font-medium' : ''}`}>
                <Clock size={12} /> Due: {new Date(t.dueDate).toLocaleDateString()}
              </span>
            )}
            {t?.assignee && <span>Assigned to: {t.assignee.name}</span>}
          </div>
        </div>

        {/* Evidence */}
        <div className="bg-white rounded-2xl border border-[#e5e5e7] p-6 space-y-5">
          <h2 className="font-semibold text-[#1d1d1f]">Evidence</h2>

          {t?.status !== 'done' && (
            <div
              {...getRootProps()}
              className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-colors ${
                isDragActive ? 'border-[#0071e3] bg-[#0071e3]/5' : 'border-[#e5e5e7] hover:border-[#0071e3]/50'
              } ${uploading ? 'opacity-60 cursor-not-allowed' : ''}`}
              data-testid="evidence-dropzone"
            >
              <input {...getInputProps()} data-testid="input-evidence-file" />
              <Upload size={24} className="text-[#86868b] mx-auto mb-3" />
              <div className="text-sm font-medium text-[#1d1d1f]">
                {uploading ? 'Uploading...' : isDragActive ? 'Drop the file here' : 'Upload evidence file'}
              </div>
              <div className="text-xs text-[#86868b] mt-1">PDF, DOCX, TXT — the AI will review it</div>
            </div>
          )}

          {t?.status === 'done' && (
            <div className="p-3 bg-[#f0fdf4] rounded-xl flex items-center gap-2 text-sm">
              <CheckCircle size={16} className="text-[#34c759]" />
              <span className="text-[#1d1d1f] font-medium">Task completed successfully</span>
            </div>
          )}

          {/* Evidence list */}
          {t?.evidence?.length > 0 && (
            <div className="space-y-3">
              {t.evidence.map((ev: any) => (
                <div key={ev.id} className="border border-[#e5e5e7] rounded-xl p-4" data-testid={`evidence-${ev.id}`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-sm font-medium text-[#1d1d1f]">{ev.fileName}</div>
                    <div className="flex items-center gap-1.5">
                      {VERDICT_ICON[ev.aiVerdict || 'pending']}
                      <span className="text-xs font-medium capitalize" style={{
                        color: ev.aiVerdict === 'approved' ? '#34c759' : ev.aiVerdict === 'rejected' ? '#ff3b30' : '#ff9500'
                      }}>
                        AI: {ev.aiVerdict || 'pending'}
                      </span>
                    </div>
                  </div>

                  {ev.aiReasoning && (
                    <div className="text-xs text-[#86868b] mb-2">{ev.aiReasoning}</div>
                  )}

                  {ev.aiMissing?.length > 0 && (
                    <div className="text-xs space-y-1">
                      <div className="font-medium text-[#ff3b30]">Missing items:</div>
                      {ev.aiMissing.map((item: string, i: number) => (
                        <div key={i} className="text-[#ff3b30]">• {item}</div>
                      ))}
                    </div>
                  )}

                  {ev.secretaryDecision && ev.secretaryDecision !== 'pending' && (
                    <div className="mt-2 pt-2 border-t border-[#f5f5f7] flex items-center gap-2">
                      {ev.secretaryDecision === 'confirmed' ? (
                        <CheckCircle size={12} className="text-[#34c759]" />
                      ) : (
                        <XCircle size={12} className="text-[#ff3b30]" />
                      )}
                      <span className="text-xs font-medium capitalize">Secretary: {ev.secretaryDecision}</span>
                      {ev.secretaryComment && <span className="text-xs text-[#86868b]">— {ev.secretaryComment}</span>}
                    </div>
                  )}

                  <div className="text-xs text-[#86868b] mt-2">
                    Submitted {new Date(ev.submittedAt).toLocaleDateString()}
                  </div>
                </div>
              ))}
            </div>
          )}

          {(!t?.evidence || t.evidence.length === 0) && t?.status !== 'done' && (
            <div className="text-center py-6 text-[#86868b] text-sm">No evidence submitted yet.</div>
          )}
        </div>
      </main>
    </div>
  );
}
