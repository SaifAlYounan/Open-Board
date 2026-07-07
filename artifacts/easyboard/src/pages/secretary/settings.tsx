import { SecretarySidebar } from '@/components/SecretarySidebar';
import { useGetAiStatus } from '@workspace/api-client-react';
import { useOrganization } from '@/hooks/use-organization';
import { CheckCircle, AlertCircle } from 'lucide-react';

export default function SecretarySettings() {
  const { data: aiStatus } = useGetAiStatus();
  const status = aiStatus as any;
  const { data: org } = useOrganization();
  const modelId = status?.model || 'the configured Claude model';

  return (
    <div className="flex h-screen bg-[#f5f5f7]">
      <SecretarySidebar />
      <main className="flex-1 lg:ml-64 pt-14 lg:pt-0 overflow-y-auto">
        <div className="max-w-2xl mx-auto p-8 space-y-8">
          <div>
            <h1 className="text-2xl font-semibold text-[#1d1d1f]">Settings</h1>
            <p className="text-sm text-[#86868b] mt-1">System configuration for Open Board</p>
          </div>

          <div className="bg-white rounded-2xl border border-[#e5e5e7] p-6 space-y-4">
            <h2 className="font-semibold text-[#1d1d1f]">Organization</h2>
            <div>
              <label className="text-xs font-medium text-[#86868b] block mb-1">Organization Name</label>
              <div className="px-4 py-3 bg-[#f5f5f7] rounded-xl text-sm text-[#1d1d1f]">{org?.name || '—'}</div>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-[#e5e5e7] p-6 space-y-4">
            <h2 className="font-semibold text-[#1d1d1f]">AI Configuration</h2>
            <div className="flex items-center gap-3">
              {status?.configured ? (
                <><CheckCircle size={18} className="text-[#34c759]" />
                <span className="text-sm text-[#1d1d1f] font-medium">AI is configured and active</span></>
              ) : (
                <><AlertCircle size={18} className="text-[#ff9500]" />
                <span className="text-sm text-[#1d1d1f] font-medium">AI is not configured</span></>
              )}
            </div>
            {!status?.configured && (
              <div className="text-sm text-[#86868b] bg-[#f5f5f7] rounded-xl p-4">
                <p className="mb-2">To enable AI features (document classification, AI search, smart insights), add your Anthropic API key as an environment variable:</p>
                <code className="font-mono text-xs bg-[#1d1d1f] text-white px-2 py-0.5 rounded">ANTHROPIC_API_KEY=sk-ant-...</code>
                <p className="mt-2">Set <code className="font-mono text-xs">AI_MODEL</code> to choose the Claude model (defaults to Claude Opus 4.8).</p>
              </div>
            )}
            {status?.configured && status?.model && (
              <div className="text-xs text-[#86868b]">Model: <span className="font-mono text-[#1d1d1f]">{status.model}</span></div>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-[#e5e5e7] p-6 space-y-4">
            <h2 className="font-semibold text-[#1d1d1f]">Email Notifications</h2>
            <div className="flex items-center justify-between py-2">
              <div>
                <div className="text-sm font-medium text-[#1d1d1f]">Email notifications</div>
                <div className="text-xs text-[#86868b]">Receive emails for pending actions and vote deadlines</div>
              </div>
              <span className="text-xs px-2 py-0.5 bg-[#f5f5f7] text-[#86868b] rounded-full font-medium">Coming Soon</span>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-[#e5e5e7] p-6">
            <h2 className="font-semibold text-[#1d1d1f] mb-3">About Open Board</h2>
            <div className="space-y-1 text-sm text-[#86868b]">
              <p>Version: {org?.version || '—'}</p>
              <p>License: MIT</p>
              <p>AI Model: {modelId}</p>
              <p>All data is stored in your PostgreSQL database.</p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
