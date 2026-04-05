import { SecretarySidebar } from '@/components/SecretarySidebar';
import { DocumentUploadPanel } from '@/components/DocumentUploadPanel';
import { useListDocuments } from '@workspace/api-client-react';
import { File, Download, Lock } from 'lucide-react';

const TYPE_LABELS: Record<string, { label: string; color: string }> = {
  minutes: { label: 'Minutes', color: '#0071e3' },
  resolution: { label: 'Resolution', color: '#5856d6' },
  financial_report: { label: 'Financial', color: '#34c759' },
  regulatory: { label: 'Regulatory', color: '#ff9500' },
  legal: { label: 'Legal', color: '#ff3b30' },
  policy: { label: 'Policy', color: '#86868b' },
  presentation: { label: 'Presentation', color: '#34c759' },
  correspondence: { label: 'Correspondence', color: '#86868b' },
  other: { label: 'Other', color: '#86868b' },
};

export default function SecretaryDocuments() {
  const { data: documents, isLoading } = useListDocuments();

  return (
    <div className="flex h-screen bg-[#f5f5f7]">
      <SecretarySidebar />
      <main className="flex-1 ml-64 overflow-y-auto">
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
                const typeInfo = TYPE_LABELS[doc.documentType] || { label: doc.documentType || 'Unknown', color: '#86868b' };
                return (
                  <div key={doc.id} className="bg-white rounded-2xl border border-[#e5e5e7] p-5 flex items-center gap-4" data-testid={`document-${doc.id}`}>
                    <div className="w-10 h-10 bg-[#f5f5f7] rounded-xl flex items-center justify-center flex-shrink-0">
                      <File size={18} className="text-[#86868b]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{
                          backgroundColor: typeInfo.color + '20', color: typeInfo.color
                        }}>{typeInfo.label}</span>
                        {doc.isConfidential && (
                          <span className="flex items-center gap-1 text-xs text-[#ff3b30]">
                            <Lock size={11} /> Confidential
                          </span>
                        )}
                        {doc.aiConfidence && (
                          <span className="text-xs text-[#86868b]">
                            {Math.round(doc.aiConfidence * 100)}% confident
                          </span>
                        )}
                      </div>
                      <div className="font-medium text-[#1d1d1f] truncate">{doc.title}</div>
                      {doc.boardName && <div className="text-xs text-[#86868b] mt-0.5">{doc.boardName}</div>}
                      <div className="text-xs text-[#86868b] mt-0.5">
                        {doc.fileName} · {doc.fileSize ? `${Math.round(doc.fileSize / 1024)}KB` : ''} · {new Date(doc.uploadedAt).toLocaleDateString()}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {doc.pendingActionCount > 0 && (
                        <span className="text-xs px-2 py-0.5 bg-[#ff9500]/10 text-[#ff9500] rounded-full font-medium">
                          {doc.pendingActionCount} pending
                        </span>
                      )}
                      <a
                        href={`/api/documents/${doc.id}/download`}
                        className="text-[#86868b] hover:text-[#0071e3] transition-colors p-1"
                        data-testid={`download-${doc.id}`}
                      >
                        <Download size={16} />
                      </a>
                    </div>
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
