import { useState } from 'react';
import { useLocation } from 'wouter';
import { SecretarySidebar } from '@/components/SecretarySidebar';
import {
  useListMinutes, useListMeetings, getListMinutesQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { FileText, ChevronRight, Plus } from 'lucide-react';

const STATUS_COLORS: Record<string, { label: string; color: string }> = {
  draft:   { label: 'Draft',      color: '#86868b' },
  review:  { label: 'In Review',  color: '#ff9500' },
  signing: { label: 'Signing',    color: '#0071e3' },
  signed:  { label: 'Signed',     color: '#34c759' },
};

export default function SecretaryMinutesList() {
  const { data: minutesList, isLoading } = useListMinutes();
  const { data: meetings } = useListMeetings();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ meetingId: '', content: '' });

  const handleCreate = async () => {
    if (!form.meetingId) {
      toast({ title: 'Select a meeting', variant: 'destructive' });
      return;
    }
    setCreating(true);
    try {
      const res = await fetch('/api/minutes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          meetingId: form.meetingId,
          content: form.content || '<h1>Board Minutes</h1><p>Begin writing minutes here...</p>',
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to create');
      }
      const newMinutes = await res.json();
      toast({ title: 'Minutes created' });
      queryClient.invalidateQueries({ queryKey: getListMinutesQueryKey() });
      setShowCreate(false);
      setForm({ meetingId: '', content: '' });
      setLocation(`/secretary/minutes/${newMinutes.id}`);
    } catch (err: any) {
      toast({ title: 'Create failed', description: err.message, variant: 'destructive' });
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex h-screen bg-[#f5f5f7]">
      <SecretarySidebar />
      <main className="flex-1 ml-64 overflow-y-auto">
        <div className="max-w-4xl mx-auto p-8 space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-[#1d1d1f]">Minutes</h1>
              <p className="text-sm text-[#86868b] mt-1">All board meeting minutes including drafts</p>
            </div>
            <button onClick={() => setShowCreate(!showCreate)}
              className="flex items-center gap-2 px-4 py-2.5 bg-[#0071e3] text-white rounded-xl text-sm font-medium hover:bg-[#0077ed] transition-colors"
              data-testid="button-create-minutes">
              <Plus size={16} /> Create Minutes
            </button>
          </div>

          {showCreate && (
            <div className="bg-white rounded-2xl border border-[#e5e5e7] p-6 space-y-4">
              <h2 className="font-semibold text-[#1d1d1f]">New Minutes</h2>

              <div>
                <label className="text-xs font-medium text-[#1d1d1f] mb-1.5 block">Meeting</label>
                <select value={form.meetingId} onChange={(e) => setForm({ ...form, meetingId: e.target.value })}
                  className="w-full px-3 py-2.5 bg-[#f5f5f7] rounded-xl text-sm border-0 focus:outline-none focus:ring-2 focus:ring-[#0071e3]/30"
                  data-testid="select-minutes-meeting">
                  <option value="">Select a meeting...</option>
                  {(meetings as any[] || []).map((m: any) => (
                    <option key={m.id} value={m.id}>
                      {m.title} — {new Date(m.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-medium text-[#1d1d1f] mb-1.5 block">Initial Content (optional)</label>
                <textarea value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })}
                  placeholder="Leave blank to use default template. You can edit in the minutes editor after creating."
                  rows={4}
                  className="w-full px-3 py-2.5 bg-[#f5f5f7] rounded-xl text-sm border-0 focus:outline-none focus:ring-2 focus:ring-[#0071e3]/30 resize-none"
                  data-testid="textarea-minutes-content" />
              </div>

              <div className="flex gap-3 pt-2">
                <button onClick={handleCreate} disabled={creating || !form.meetingId}
                  className="px-5 py-2.5 bg-[#0071e3] text-white rounded-xl text-sm font-medium hover:bg-[#0077ed] transition-colors disabled:opacity-50"
                  data-testid="button-submit-minutes">
                  {creating ? 'Creating...' : 'Create & Open Editor'}
                </button>
                <button onClick={() => setShowCreate(false)}
                  className="px-5 py-2.5 bg-[#f5f5f7] text-[#1d1d1f] rounded-xl text-sm font-medium hover:bg-[#ebebed] transition-colors">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {isLoading && <div className="text-center py-16 text-[#86868b] text-sm">Loading...</div>}

          {!isLoading && (!minutesList || (minutesList as any[]).length === 0) && !showCreate && (
            <div className="text-center py-16">
              <FileText size={40} className="text-[#86868b] mx-auto mb-4" />
              <div className="text-[#1d1d1f] font-medium">No minutes yet</div>
              <div className="text-[#86868b] text-sm mt-1">Create minutes manually or upload a draft minutes document.</div>
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
                    <div className="font-medium text-[#1d1d1f] truncate">{minutes.meetingTitle || 'Standalone Minutes'}</div>
                    {minutes.meetingDate && (
                      <div className="text-xs text-[#86868b] mt-0.5">
                        {new Date(minutes.meetingDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                      </div>
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
