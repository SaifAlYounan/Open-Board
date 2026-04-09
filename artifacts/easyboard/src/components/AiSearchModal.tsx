import { useState } from "react";
import { useAiSearch } from "@workspace/api-client-react";
import { Search, Loader2, Bot, X } from "lucide-react";
import { Link } from "wouter";

interface AiSearchModalProps {
  onClose: () => void;
}

export function AiSearchModal({ onClose }: AiSearchModalProps) {
  const [query, setQuery] = useState("");
  const searchMutation = useAiSearch();

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    searchMutation.mutate({ data: { query } });
  };

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center pt-24 px-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      data-testid="modal-ai-search"
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden">
        <form onSubmit={handleSearch} className="flex items-center gap-3 p-4 border-b border-[#e5e5e7]">
          <Search size={18} className="text-[#86868b] flex-shrink-0" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="What was decided about the Q3 budget?"
            className="flex-1 text-base text-[#1d1d1f] placeholder-[#86868b] focus:outline-none"
            data-testid="input-ai-search"
          />
          {searchMutation.isPending ? (
            <Loader2 size={18} className="text-[#0071e3] animate-spin" />
          ) : (
            <button type="submit" aria-label="Search" className="text-[#0071e3] hover:text-[#0077ed] transition-colors" data-testid="button-submit-search">
              <Search size={18} />
            </button>
          )}
          <button type="button" aria-label="Close" onClick={onClose} className="text-[#86868b] hover:text-[#1d1d1f] transition-colors">
            <X size={18} />
          </button>
        </form>

        <div className="p-6 max-h-[60vh] overflow-y-auto">
          {!searchMutation.data && !searchMutation.isPending && (
            <div className="text-center py-12 text-[#86868b]">
              <div className="w-16 h-16 bg-[#0071e3]/10 text-[#0071e3] rounded-full flex items-center justify-center mx-auto mb-4">
                <Bot size={32} />
              </div>
              <p className="text-sm">I can search across all board materials, minutes, and decisions.</p>
            </div>
          )}

          {searchMutation.isPending && (
            <div className="flex flex-col items-center justify-center py-12 text-[#86868b]">
              <Loader2 size={32} className="animate-spin text-[#0071e3] mb-4" />
              <p className="text-sm">Searching the archives...</p>
            </div>
          )}

          {searchMutation.isError && (
            <div className="text-center py-8 text-[#ff3b30] text-sm">
              Search failed. Please try again.
            </div>
          )}

          {searchMutation.data && (
            <div className="space-y-6">
              <div className="prose prose-sm max-w-none text-[#1d1d1f]">
                {(searchMutation.data as any).answer}
              </div>

              {(searchMutation.data as any).sources?.length > 0 && (
                <div className="pt-4 border-t border-[#e5e5e7]">
                  <div className="text-xs font-medium text-[#86868b] uppercase tracking-wide mb-3">Sources</div>
                  <div className="flex flex-wrap gap-2">
                    {((searchMutation.data as any).sources as any[]).map((source: any, i: number) => {
                      const href = source.entityType === 'vote' ? `/board/vote/${source.entityId}`
                        : source.entityType === 'minutes' ? `/board/minutes/${source.entityId}`
                        : '#';
                      return (
                        <Link key={i} href={href} onClick={onClose}
                          className="inline-flex items-center px-3 py-1.5 bg-[#f5f5f7] hover:bg-[#ebebed] rounded-lg text-sm font-medium text-[#1d1d1f] transition-colors"
                          data-testid={`source-link-${source.entityId}`}>
                          {source.title}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
