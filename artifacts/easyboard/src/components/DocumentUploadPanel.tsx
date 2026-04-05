import { useState, useCallback } from "react";
import { UploadCloud, FileType, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { PendingActionCard } from "./PendingActionCard";

export function DocumentUploadPanel() {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const uploadFile = async (file: File) => {
    setIsUploading(true);
    setProgress(10);
    setError(null);
    setResult(null);

    const formData = new FormData();
    formData.append('file', file);
    const token = localStorage.getItem('token');

    try {
      // Simulate progress
      const progressInterval = setInterval(() => {
        setProgress(p => Math.min(p + 10, 90));
      }, 500);

      const response = await fetch('/api/documents/upload', {
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
        body: formData,
      });

      clearInterval(progressInterval);
      setProgress(100);

      if (!response.ok) throw new Error('Upload failed');
      const data = await response.json();
      setResult(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsUploading(false);
    }
  };

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

  return (
    <div className="space-y-6">
      <div 
        className={`border-2 border-dashed rounded-2xl p-12 text-center transition-colors ${
          isDragging ? "border-[#0071e3] bg-[#0071e3]/5" : "border-[#e8e8ed] bg-white hover:border-[#0071e3]/50"
        }`}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        data-testid="panel-document-upload"
      >
        {!isUploading && !result ? (
          <div className="flex flex-col items-center justify-center space-y-4">
            <div className="w-16 h-16 bg-[#f5f5f7] rounded-full flex items-center justify-center text-[#0071e3]">
              <UploadCloud className="w-8 h-8" />
            </div>
            <div>
              <p className="text-lg font-medium text-[#1d1d1f]">Drag & drop document here</p>
              <p className="text-sm text-[#86868b] mt-1">PDF, DOCX, or TXT up to 50MB</p>
            </div>
            <label className="cursor-pointer">
              <span className="bg-[#f5f5f7] text-[#1d1d1f] hover:bg-[#e8e8ed] px-6 py-2.5 rounded-full font-medium transition-colors inline-block">
                Browse Files
              </span>
              <input type="file" className="hidden" onChange={onFileChange} accept=".pdf,.docx,.txt" data-testid="input-file-upload" />
            </label>
          </div>
        ) : isUploading ? (
          <div className="flex flex-col items-center justify-center space-y-6 py-8">
            <Loader2 className="w-12 h-12 text-[#0071e3] animate-spin" />
            <div className="w-full max-w-sm space-y-2">
              <div className="flex justify-between text-sm font-medium">
                <span className="text-[#1d1d1f]">Uploading & Analyzing...</span>
                <span className="text-[#86868b]">{progress}%</span>
              </div>
              <Progress value={progress} className="h-2 bg-[#f5f5f7]" indicatorClassName="bg-[#0071e3]" />
            </div>
          </div>
        ) : result ? (
          <div className="flex flex-col items-center justify-center space-y-4">
            <div className="w-16 h-16 bg-[#34c759]/10 rounded-full flex items-center justify-center text-[#34c759]">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <p className="text-lg font-medium text-[#1d1d1f]">Analysis Complete</p>
            <Button variant="outline" onClick={() => setResult(null)} className="rounded-full" data-testid="button-upload-another">
              Upload Another
            </Button>
          </div>
        ) : null}

        {error && (
          <div className="mt-6 p-4 bg-[#ff3b30]/10 text-[#ff3b30] rounded-xl flex items-center gap-3 text-left">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <p className="text-sm font-medium">{error}</p>
          </div>
        )}
      </div>

      {result && (
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
                    {result.classification?.document_type || 'Unknown'}
                  </span>
                  <span className="text-sm text-[#86868b]">
                    {Math.round((result.classification?.confidence || 0) * 100)}% confidence
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-[#f5f5f7] rounded-xl p-4 text-sm text-[#1d1d1f]">
            <h4 className="font-medium mb-2 text-[#86868b] uppercase tracking-wider text-xs">Summary</h4>
            <p>{result.classification?.extracted_data?.summary || 'No summary available.'}</p>
          </div>

          {result.proposedActions && result.proposedActions.length > 0 && (
            <div className="space-y-4 pt-4 border-t border-[#e8e8ed]">
              <h4 className="font-medium text-[#1d1d1f]">Proposed Actions</h4>
              <div className="space-y-4">
                {result.proposedActions.map((action: any) => (
                  <PendingActionCard key={action.id} action={action} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}