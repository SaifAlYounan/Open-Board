import { AlertTriangle, Loader2 } from "lucide-react";

/**
 * Consistent loading / error UI for read queries. Renders a skeleton while
 * loading and an error panel with Retry on failure — so an API error stops
 * masquerading as an empty state ("No votes" when the fetch actually failed).
 */
export function QueryState({
  isLoading,
  isError,
  onRetry,
  label = "data",
}: {
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
  label?: string;
}) {
  if (isLoading) {
    return (
      <div className="space-y-3" data-testid="query-loading">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-16 rounded-2xl bg-[#ececf0] animate-pulse" />
        ))}
      </div>
    );
  }
  if (isError) {
    return (
      <div className="bg-white rounded-2xl border border-[#ff3b30]/30 p-8 text-center" data-testid="query-error">
        <div className="w-10 h-10 mx-auto mb-3 rounded-xl bg-[#ff3b30]/10 text-[#ff3b30] flex items-center justify-center">
          <AlertTriangle size={18} />
        </div>
        <p className="text-sm text-[#1d1d1f] font-medium">Couldn't load {label}.</p>
        <p className="text-xs text-[#86868b] mt-1">Check your connection and try again.</p>
        {onRetry && (
          <button
            onClick={onRetry}
            className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-[#0071e3] text-white text-sm font-medium rounded-xl hover:bg-[#0077ed] transition-colors"
            data-testid="query-retry"
          >
            <Loader2 size={14} /> Retry
          </button>
        )}
      </div>
    );
  }
  return null;
}
