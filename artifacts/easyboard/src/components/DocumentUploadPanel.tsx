import { useState, useCallback, useEffect, useRef, type KeyboardEvent } from "react";
import { UploadCloud, FileType, CheckCircle2, AlertCircle, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import { getListDocumentsQueryKey, getListPendingActionsQueryKey, getGetDashboardSummaryQueryKey } from "@workspace/api-client-react";

export function DocumentUploadPanel() {
  const queryClient = useQueryClient();
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [classifying, setClassifying] = useState(false);
  const [classification, setClassification] = useState<any>(null);
  const [lastDocId, setLastDocId] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  useEffect(() => {
    return () => stopPolling();
  }, []);

  const pollForClassification = (docId: string) => {
    let attempts = 0;
    const maxAttempts = 30; // 30 × 3s = 90 seconds max

    pollRef.current = setInterval(async () => {
      attempts++;
      try {
        const r = await fetch(`/api/documents/${docId}`, {
          credentials: "include",
        });
        if (!r.ok) return;
        const doc = await r.json();
        if (doc.aiClassification) {
          stopPolling();
          setClassifying(false);
          // The classifier writes {error, message} on failure — surface it, don't
          // treat it as a successful classification.
          if (doc.aiClassification.error) {
            setError(doc.aiClassification.message || 'Classification failed. You can retry from the Documents page.');
            setLastDocId(doc.id);
          } else {
            setClassification(doc.aiClassification);
          }
          // Refresh pending actions count after AI creates them
          queryClient.invalidateQueries({ queryKey: getListPendingActionsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
        } else if (attempts >= maxAttempts) {
          stopPolling();
          setClassifying(false);
        }
      } catch {
        stopPolling();
        setClassifying(false);
      }
    }, 3000);
  };

  const uploadFile = async (file: File) => {
    setIsUploading(true);
    setError(null);
    setResult(null);
    setClassification(null);
    setClassifying(false);
    stopPolling();

    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch('/api/documents/upload', {
        method: 'POST',
        credentials: "include",
        body: formData,
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'Upload failed');
      }

      const data = await response.json();
      setResult(data);

      // Invalidate documents list, pending actions, and dashboard counts
      queryClient.invalidateQueries({ queryKey: getListDocumentsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListPendingActionsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });

      if (data.classifying && data.document?.id) {
        setClassifying(true);
        pollForClassification(data.document.id);
      }
    } catch (err: any) {
      setError(err.message || 'Upload failed. Please try again.');
    } finally {
      setIsUploading(false);
    }
  };

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      uploadFile(e.dataTransfer.files[0]);
    }
  }, []);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      uploadFile(e.target.files[0]);
    }
  };

  const onDropZoneKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInputRef.current?.click();
    }
  };

  const reset = () => {
    stopPolling();
    setResult(null);
    setClassification(null);
    setClassifying(false);
    setError(null);
  };

  return (
    <div className="space-y-6">
      <div
        className={`border-2 border-dashed rounded-2xl p-12 text-center transition-colors ${
          isDragging ? "border-[#0071e3] bg-[#0071e3]/5" : "border-[#e8e8ed] bg-white hover:border-[#0071e3]/50"
        }`}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onKeyDown={onDropZoneKeyDown}
        tabIndex={0}
        role="button"
        aria-label="Upload document area. Press Enter or Space to browse files, or drag and drop."
        data-testid="panel-document-upload"
      >
        {isUploading ? (
          <div className="flex flex-col items-center justify-center space-y-4 py-4">
            <Loader2 className="w-10 h-10 text-[#0071e3] animate-spin" />
            <p className="text-sm font-medium text-[#1d1d1f]">Uploading...</p>
          </div>
        ) : result ? (
          <div className="flex flex-col items-center justify-center space-y-4">
            <div className="w-16 h-16 bg-[#34c759]/10 rounded-full flex items-center justify-center text-[#34c759]">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <div>
              <p className="text-lg font-medium text-[#1d1d1f]">
                {result.document?.title || 'File'} uploaded
              </p>
              {classifying && (
                <p className="text-sm text-[#86868b] mt-1 flex items-center justify-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-[#0071e3] animate-pulse" />
                  Claude is analyzing the document...
                </p>
              )}
            </div>
            <Button variant="outline" onClick={reset} className="rounded-full" data-testid="button-upload-another">
              Upload Another
            </Button>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center space-y-4">
            <div className="w-16 h-16 bg-[#f5f5f7] rounded-full flex items-center justify-center text-[#0071e3]">
              <UploadCloud className="w-8 h-8" />
            </div>
            <div>
              <p className="text-lg font-medium text-[#1d1d1f]">Drag & drop document here</p>
              <p className="text-sm text-[#86868b] mt-1">PDF, DOCX, or TXT up to 10MB</p>
            </div>
            <label className="cursor-pointer">
              <span className="bg-[#f5f5f7] text-[#1d1d1f] hover:bg-[#e8e8ed] px-6 py-2.5 rounded-full font-medium transition-colors inline-block">
                Browse Files
              </span>
              <input ref={fileInputRef} type="file" className="hidden" onChange={onFileChange} accept=".pdf,.docx,.txt" data-testid="input-file-upload" />
            </label>
          </div>
        )}

        {error && lastDocId && (
          <div className="mt-4">
            <Button
              variant="outline"
              disabled={retrying}
              onClick={async () => {
                setRetrying(true);
                setError(null);
                try {
                  const r = await fetch(`/api/documents/${lastDocId}/reclassify`, { method: "POST", credentials: "include" });
                  const doc = await r.json();
                  if (doc.classificationError) {
                    setError(doc.classificationError);
                  } else if (doc.aiClassification && !doc.aiClassification.error) {
                    setClassification(doc.aiClassification);
                    setLastDocId(null);
                    queryClient.invalidateQueries({ queryKey: getListPendingActionsQueryKey() });
                    queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
                  } else {
                    setError(doc.aiClassification?.message || "Classification failed again.");
                  }
                } catch {
                  setError("Retry failed — please try again.");
                } finally {
                  setRetrying(false);
                }
              }}
            >
              {retrying ? "Retrying…" : "Retry Classification"}
            </Button>
          </div>
        )}

        {error && (
          <div className="mt-6 p-4 bg-[#ff3b30]/10 text-[#ff3b30] rounded-xl flex items-center gap-3 text-left">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <p className="text-sm font-medium">{error}</p>
          </div>
        )}
      </div>

      {classification && (
        <div className="bg-white rounded-2xl border border-[#e8e8ed] p-6 space-y-6 animate-in slide-in-from-bottom-4 duration-500">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-[#f5f5f7] rounded-lg text-[#0071e3]">
                <FileType className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-semibold text-[#1d1d1f]">Classification Results</h3>
                <div className="flex items-center gap-2 mt-1">
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-[#f5f5f7] text-[#1d1d1f]">
                    {classification.document_type || 'Unknown'}
                  </span>
                  <span className="text-sm text-[#86868b]">
                    {Math.round((classification.confidence || 0) * 100)}% confidence
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-[#f5f5f7] rounded-xl p-4 text-sm text-[#1d1d1f]">
            <h4 className="font-medium mb-2 text-[#86868b] uppercase tracking-wider text-xs">Summary</h4>
            <p>{classification.extracted_data?.summary || 'No summary available.'}</p>
          </div>

          {classification.proposed_actions && classification.proposed_actions.length > 0 && (
            <div className="space-y-4 pt-4 border-t border-[#e8e8ed]">
              <h4 className="font-medium text-[#1d1d1f]">
                {classification.proposed_actions.length} Proposed Action{classification.proposed_actions.length !== 1 ? 's' : ''} — check Pending AI Actions to review
              </h4>
              <p className="text-sm text-[#86868b]">Go to Pending AI Actions in the sidebar to approve or reject them.</p>
            </div>
          )}

          {(!classification.proposed_actions || classification.proposed_actions.length === 0) && (
            <div className="pt-4 border-t border-[#e8e8ed]">
              <p className="text-sm text-[#86868b]">No actions proposed. Document stored for reference.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
