import { useGetAiStatus } from '@workspace/api-client-react';
import { Info, X } from 'lucide-react';
import { useState } from 'react';

export function AiBanner() {
  const { data: aiStatus } = useGetAiStatus();
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || !aiStatus || (aiStatus as any).configured) return null;

  return (
    <div className="bg-[#e8f0fe] border border-[#0071e3]/20 rounded-xl px-4 py-3 flex items-center gap-3 text-sm text-[#0071e3]">
      <Info size={16} className="flex-shrink-0" />
      <span className="flex-1">
        AI features require configuration. Add your <strong>ANTHROPIC_API_KEY</strong> environment variable to enable document classification, AI search, and smart insights.
      </span>
      <button onClick={() => setDismissed(true)} className="text-[#0071e3]/60 hover:text-[#0071e3] flex-shrink-0">
        <X size={14} />
      </button>
    </div>
  );
}
