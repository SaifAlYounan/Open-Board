import { useState } from 'react';
import { SecretarySidebar } from '@/components/SecretarySidebar';
import { DocumentUploadPanel } from '@/components/DocumentUploadPanel';
import { useListDocuments } from '@workspace/api-client-react';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { File, Download, Lock, AlertTriangle, RefreshCw } from 'lucide-react';

const TYPE_LABELS: Record<string, { label: string; color: string }> = {
  minutes:          { label: 'Minutes',         color: '#0071e3' },
  resolution:       { label: 'Resolution',      color: '#5856d6' },
  financial_report: { label: 'Financial',       color: '#34c759' },
  regulatory:       { label: 'Regulatory',      color: '#ff9500' },
  legal:            { label: 'Legal',           color: '#ff3b30' },
  policy:           { label: 'Policy',          color: '#86868b' },
  presentation:     { label: 'Presentation',    color: '#34c759' },
  correspondence:   { label: 'Correspondence',  color: '#86868b' },
  other:            { label: 'Other',           color: '#86868b' },
};

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function SecretaryDocuments() {
  const { data: documents, isLoading, refetch } = useListDocuments();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [retrying, setRetrying] = useState<Record<string, boolean>>({});
  const [accessDocId, setAccessDocId] = useState<string | null>(null);
  const [accessRows, setAccessRows] = useState<any[]>([]);
  const [accessLoading, setAccessLoading] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const handleRetryClassification = async (docId: string) => {
    setRetrying((prev) => ({ ...prev, [docId]: true }));
    try {
      const res = await fetch(`/api/documents/${docId}/reclassify`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed');
      await refetch();
      toast({ title: 'Reclassification complete' });
    } catch {
      toast({ title: 'Retry failed', description: 'Check your AI configuration.', variant: 'destructive' });
    } finally {
      setRetrying((prev) => ({ ...prev, [docId]: false }));
    }
  };

  async function openAccessPanel(docId: string) {
    if (accessDocId === docId) {
      setAccessDocId(null);
      return;
    }
    setAccessDocId(docId);
    setAccessLoading(true);
    try {
      const res = await fetch(`/api/documents/${docId}/access`, { credentials: 'include' });
      const data = await res.json();
      setAccessRows(Array.isArray(data) ? data.filter((r: any) => r.personRole !== 'admin') : []);
    } catch {
      setAccessRows([]);
    } finally {
      setAccessLoading(false);
    }
  }

  async function toggleAccess(docId: string, personId: string, currentAccess: boolean) {
    setTogglingId(personId);
    try {
      const res = await fetch(`/api/documents/${docId}/access`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personId, hasAccess: !currentAccess }),
      });
      if (!res.ok) throw new Error('Failed');
      const personName = accessRows.find((r: any) => r.personId === personId)?.personName || 'User';
      setAccessRows((prev: any[]) =>
        prev.map((r: any) => r.personId === personId ? { ...r, hasAccess: !currentAccess } : r)
      );
      toast({
        title: !currentAccess ? `Access restored for ${personName}` : `Access revoked for ${personName}`,
      });
    } catch {
      toast({ title: 'Failed to update access', variant: 'destructive' });
    } finally {
      setTogglingId(null);
    }
  }

  return (
    <div className="flex h-screen bg-[#f5f5f7]">
      <SecretarySidebar />
      <main className="flex-1 lg:ml-64 pt-14 lg:pt-0 overflow-y-auto">
        <div className="max-w-4xl mx-auto p-8 space-y-8">
          <div>
            <h1 className="text-2xl font-semibold text-[#1d1d1f]">Documents</h1>
            <p className="text-sm text-[#86868b] mt-1">Upload and classify board documents. The AI will extract entities and propose actions.</p>
          </div>

          <DocumentUploadPanel />

          <div>
            <h2 className="font-semibold text-[#1d1d1f] mb-4">Uploaded Documents</h2>

            {isLoading && <div className="text-center py-12 text-[#86868b] text-sm">Loading...</div>}

            {!isLoading && (!documents || (documents as any[]).length === 0) && (
              <div className="text-center py-12 bg-white rounded-2xl border border-[#e5e5e7]">
                <File size={36} className="text-[#86868b] mx-auto mb-3" />
                <div className="text-[#1d1d1f] font-medium">No documents yet</div>
                <div className="text-[#86868b] text-sm mt-1">Upload a document above to get started.</div>
              </div>
            )}

            <div className="space-y-3">
              {(documents as any[] || []).map((doc: any) => {
                const classificationData = doc.aiClassification as any;
                const docType = classificationData?.document_type || doc.documentType;
                const typeInfo = TYPE_LABELS[docType] || { label: docType || 'Unknown', color: '#86868b' };
                const isPending = !classificationData;
                const isRetrying = retrying[doc.id];
                const dateStr = doc.createdAt || doc.uploadedAt;

                return (
                  <div key={doc.id} className="bg-white rounded-2xl border border-[#e5e5e7] p-5" data-testid={`document-${doc.id}`}>
                    <div className="flex items-start gap-4">
                      <div className="w-10 h-10 bg-[#f5f5f7] rounded-xl flex items-center justify-center flex-shrink-0">
                        <File size={18} className="text-[#86868b]" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                          {isPending ? (
                            <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium bg-[#ff9500]/10 text-[#ff9500]">
                              <AlertTriangle size={11} /> Classification pending
                            </span>
                          ) : (
                            <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                              style={{ backgroundColor: typeInfo.color + '20', color: typeInfo.color }}>
                              {typeInfo.label}
                            </span>
                          )}
                          {doc.isConfidential && (
                            <span className="flex items-center gap-1 text-xs text-[#ff3b30]">
                              <Lock size={11} /> Confidential
                            </span>
                          )}
                          {classificationData?.confidence && (
                            <span className="text-xs text-[#86868b]">
                              {Math.round(classificationData.confidence * 100)}% confident
                            </span>
                          )}
                        </div>
                        <div className="font-medium text-[#1d1d1f] truncate">{doc.title}</div>
                        {doc.boardName && <div className="text-xs text-[#86868b] mt-0.5">{doc.boardName}</div>}
                        <div className="text-xs text-[#86868b] mt-0.5">
                          {doc.filename} · {doc.fileSize ? `${Math.round(doc.fileSize / 1024)}KB` : ''} · {formatDate(dateStr)}
                        </div>
                        {isPending && (
                          <button
                            onClick={() => handleRetryClassification(doc.id)}
                            disabled={isRetrying}
                            className="mt-2 flex items-center gap-1.5 text-xs px-3 py-1.5 bg-[#0071e3]/10 text-[#0071e3] rounded-lg font-medium hover:bg-[#0071e3]/20 transition-colors disabled:opacity-50"
                            data-testid={`retry-classify-${doc.id}`}
                          >
                            <RefreshCw size={11} className={isRetrying ? 'animate-spin' : ''} />
                            {isRetrying ? 'Retrying...' : 'Retry Classification'}
                          </button>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {doc.pendingActionCount > 0 && (
                          <span className="text-xs px-2 py-0.5 bg-[#ff9500]/10 text-[#ff9500] rounded-full font-medium">
                            {doc.pendingActionCount} pending
                          </span>
                        )}
                        <button
                          onClick={() => openAccessPanel(doc.id)}
                          className={`p-1 transition-colors rounded ${accessDocId === doc.id ? 'text-[#0071e3]' : 'text-[#86868b] hover:text-[#0071e3]'}`}
                          aria-label="Manage document access"
                          title="Manage access"
                          data-testid={`access-${doc.id}`}
                        >
                          <Lock size={16} />
                        </button>
                        <a
                          href={`/api/documents/${doc.id}/download`}
                          className="text-[#86868b] hover:text-[#0071e3] transition-colors p-1"
                          data-testid={`download-${doc.id}`}
                        >
                          <Download size={16} />
                        </a>
                      </div>
                    </div>

                    {accessDocId === doc.id && (
                      <div className="mt-4 pt-4 border-t border-[#f5f5f7]">
                        <div className="text-xs font-medium text-[#86868b] uppercase tracking-wide mb-3">Document Access</div>
                        {accessLoading ? (
                          <div className="text-xs text-[#86868b] py-2">Loading...</div>
                        ) : accessRows.length === 0 ? (
                          <div className="text-xs text-[#86868b] py-2">No access records found.</div>
                        ) : (
                          <div className="space-y-2">
                            {accessRows.map((row: any) => (
                              <div key={row.personId} className={`flex items-center justify-between py-2 px-3 rounded-xl ${!row.hasAccess ? 'bg-[#ff3b30]/5' : 'bg-[#f5f5f7]'}`}>
                                <div className="flex-1 min-w-0">
                                  <div className={`text-sm font-medium truncate ${!row.hasAccess ? 'text-[#86868b] line-through' : 'text-[#1d1d1f]'}`}>
                                    {row.personName || 'Unknown'}
                                  </div>
                                  <div className="text-xs text-[#86868b] truncate">{row.personEmail}</div>
                                </div>
                                <button
                                  onClick={() => toggleAccess(doc.id, row.personId, row.hasAccess)}
                                  disabled={togglingId === row.personId}
                                  aria-label={row.hasAccess ? 'Revoke access' : 'Restore access'}
                                  className={`ml-3 flex-shrink-0 w-10 h-6 rounded-full transition-colors relative disabled:opacity-50 ${row.hasAccess ? 'bg-[#34c759]' : 'bg-[#e5e5e7]'}`}
                                >
                                  <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${row.hasAccess ? 'translate-x-4' : 'translate-x-0.5'}`} />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
