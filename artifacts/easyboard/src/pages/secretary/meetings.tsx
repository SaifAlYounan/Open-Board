import { useState } from 'react';
import { useLocation } from 'wouter';
import { SecretarySidebar } from '@/components/SecretarySidebar';
import { useListMeetings, useCreateMeeting, useListBoards, getListMeetingsQueryKey } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { Plus, Calendar, MapPin, ChevronRight, Trash2 } from 'lucide-react';

const AGENDA_TYPES = [
  { value: 'information', label: 'Information' },
  { value: 'discussion',  label: 'Discussion' },
  { value: 'decision',    label: 'Decision' },
];

interface AgendaItem { title: string; type: string; description: string; }

export default function SecretaryMeetings() {
  const { data: meetings, isLoading } = useListMeetings();
  const { data: boards } = useListBoards();
  const [showCreate, setShowCreate] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const createMeeting = useCreateMeeting();
  const [, setLocation] = useLocation();

  const [form, setForm] = useState({ boardId: '', title: '', date: '', location: '' });
  const [agendaItems, setAgendaItems] = useState<AgendaItem[]>([]);

  const addAgendaItem = () => {
    setAgendaItems([...agendaItems, { title: '', type: 'information', description: '' }]);
  };

  const removeAgendaItem = (i: number) => {
    setAgendaItems(agendaItems.filter((_, idx) => idx !== i));
  };

  const updateAgendaItem = (i: number, field: keyof AgendaItem, value: string) => {
    const updated = agendaItems.map((item, idx) => idx === i ? { ...item, [field]: value } : item);
    setAgendaItems(updated);
  };

  const handleCreate = () => {
    if (!form.boardId || !form.title || !form.date) {
      toast({ title: 'Missing fields', description: 'Board, title, and date are required.', variant: 'destructive' });
      return;
    }
    const payload = {
      ...form,
      date: new Date(form.date).toISOString(),
      agendaItems: agendaItems.filter(a => a.title.trim()).map((a, i) => ({
        position: i + 1,
        title: a.title.trim(),
        type: a.type,
        description: a.description || undefined,
      })),
    };
    createMeeting.mutate({ data: payload }, {
      onSuccess: () => {
        toast({ title: 'Meeting created' });
        queryClient.invalidateQueries({ queryKey: getListMeetingsQueryKey() });
        setShowCreate(false);
        setForm({ boardId: '', title: '', date: '', location: '' });
        setAgendaItems([]);
      },
      onError: (err: any) => {
        toast({ title: 'Create failed', description: err.data?.error || 'Please try again.', variant: 'destructive' });
      }
    });
  };

  const STATUS_COLORS: Record<string, string> = { scheduled: '#0071e3', concluded: '#86868b' };

  return (
    <div className="flex h-screen bg-[#f5f5f7]">
      <SecretarySidebar />
      <main className="flex-1 ml-64 overflow-y-auto">
        <div className="max-w-4xl mx-auto p-8 space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-[#1d1d1f]">Meetings</h1>
              <p className="text-sm text-[#86868b] mt-1">All board and committee meetings</p>
            </div>
            <button onClick={() => setShowCreate(!showCreate)}
              className="flex items-center gap-2 px-4 py-2.5 bg-[#0071e3] text-white rounded-xl text-sm font-medium hover:bg-[#0077ed] transition-colors"
              data-testid="button-create-meeting">
              <Plus size={16} /> Create Meeting
            </button>
          </div>

          {showCreate && (
            <div className="bg-white rounded-2xl border border-[#e5e5e7] p-6 space-y-4">
              <h2 className="font-semibold text-[#1d1d1f]">New Meeting</h2>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-[#1d1d1f] mb-1.5 block">Board</label>
                  <select value={form.boardId} onChange={(e) => setForm({ ...form, boardId: e.target.value })}
                    className="w-full px-3 py-2.5 bg-[#f5f5f7] rounded-xl text-sm border-0 focus:outline-none focus:ring-2 focus:ring-[#0071e3]/30"
                    data-testid="select-meeting-board">
                    <option value="">Select board...</option>
                    {(boards as any[] || []).map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-[#1d1d1f] mb-1.5 block">Date & Time</label>
                  <input type="datetime-local" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })}
                    className="w-full px-3 py-2.5 bg-[#f5f5f7] rounded-xl text-sm border-0 focus:outline-none focus:ring-2 focus:ring-[#0071e3]/30"
                    data-testid="input-meeting-date" />
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-[#1d1d1f] mb-1.5 block">Meeting Title</label>
                <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="e.g., Board of Directors Meeting Q2 2026"
                  className="w-full px-3 py-2.5 bg-[#f5f5f7] rounded-xl text-sm border-0 focus:outline-none focus:ring-2 focus:ring-[#0071e3]/30"
                  data-testid="input-meeting-title" />
              </div>

              <div>
                <label className="text-xs font-medium text-[#1d1d1f] mb-1.5 block">Location</label>
                <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })}
                  placeholder="e.g., Boardroom A, Abu Dhabi HQ"
                  className="w-full px-3 py-2.5 bg-[#f5f5f7] rounded-xl text-sm border-0 focus:outline-none focus:ring-2 focus:ring-[#0071e3]/30"
                  data-testid="input-meeting-location" />
              </div>

              {/* Dynamic Agenda Items */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-medium text-[#1d1d1f]">Agenda Items</label>
                  <button onClick={addAgendaItem} type="button"
                    className="text-xs text-[#0071e3] font-medium hover:underline flex items-center gap-1"
                    data-testid="button-add-agenda-row">
                    <Plus size={12} /> Add Item
                  </button>
                </div>

                {agendaItems.length === 0 && (
                  <div className="text-xs text-[#86868b] bg-[#f5f5f7] rounded-xl px-3 py-2.5">
                    No agenda items. Click "Add Item" to add some.
                  </div>
                )}

                <div className="space-y-2">
                  {agendaItems.map((item, i) => (
                    <div key={i} className="flex items-start gap-2 p-3 bg-[#f5f5f7] rounded-xl">
                      <span className="text-xs text-[#86868b] font-mono mt-2.5 w-4 flex-shrink-0">{i + 1}.</span>
                      <div className="flex-1 grid grid-cols-3 gap-2">
                        <input
                          value={item.title}
                          onChange={(e) => updateAgendaItem(i, 'title', e.target.value)}
                          placeholder="Item title"
                          className="col-span-2 px-2.5 py-2 bg-white rounded-lg text-xs border-0 focus:outline-none focus:ring-2 focus:ring-[#0071e3]/30"
                        />
                        <select
                          value={item.type}
                          onChange={(e) => updateAgendaItem(i, 'type', e.target.value)}
                          className="px-2.5 py-2 bg-white rounded-lg text-xs border-0 focus:outline-none focus:ring-2 focus:ring-[#0071e3]/30"
                        >
                          {AGENDA_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                        </select>
                        <input
                          value={item.description}
                          onChange={(e) => updateAgendaItem(i, 'description', e.target.value)}
                          placeholder="Description (optional)"
                          className="col-span-3 px-2.5 py-2 bg-white rounded-lg text-xs border-0 focus:outline-none focus:ring-2 focus:ring-[#0071e3]/30"
                        />
                      </div>
                      <button onClick={() => removeAgendaItem(i)} type="button"
                        className="mt-1.5 p-1.5 text-[#86868b] hover:text-[#ff3b30] transition-colors rounded-lg hover:bg-[#ff3b30]/10">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button onClick={handleCreate} disabled={createMeeting.isPending}
                  className="px-5 py-2.5 bg-[#0071e3] text-white rounded-xl text-sm font-medium hover:bg-[#0077ed] transition-colors disabled:opacity-50"
                  data-testid="button-submit-meeting">
                  {createMeeting.isPending ? 'Creating...' : 'Create Meeting'}
                </button>
                <button onClick={() => { setShowCreate(false); setAgendaItems([]); }}
                  className="px-5 py-2.5 bg-[#f5f5f7] text-[#1d1d1f] rounded-xl text-sm font-medium hover:bg-[#ebebed] transition-colors">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {isLoading && <div className="text-center py-16 text-[#86868b] text-sm">Loading meetings...</div>}

          <div className="space-y-3">
            {(meetings as any[] || []).map((meeting: any) => (
              <button key={meeting.id} onClick={() => setLocation(`/secretary/meetings/${meeting.id}`)}
                className="w-full bg-white rounded-2xl border border-[#e5e5e7] p-5 text-left hover:border-[#0071e3]/30 hover:shadow-sm transition-all"
                data-testid={`meeting-card-${meeting.id}`}>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{
                        backgroundColor: STATUS_COLORS[meeting.status] + '20',
                        color: STATUS_COLORS[meeting.status]
                      }}>{meeting.status}</span>
                      {meeting.boardName && <span className="text-xs text-[#86868b]">{meeting.boardName}</span>}
                    </div>
                    <div className="font-medium text-[#1d1d1f]">{meeting.title}</div>
                    <div className="flex items-center gap-4 mt-2 text-xs text-[#86868b]">
                      <span className="flex items-center gap-1">
                        <Calendar size={12} />
                        {new Date(meeting.date).toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </span>
                      {meeting.location && (
                        <span className="flex items-center gap-1">
                          <MapPin size={12} /> {meeting.location}
                        </span>
                      )}
                      {meeting.agendaItemCount !== undefined && (
                        <span>{meeting.agendaItemCount} agenda items</span>
                      )}
                    </div>
                  </div>
                  <ChevronRight size={16} className="text-[#86868b] flex-shrink-0 mt-1" />
                </div>
              </button>
            ))}
            {!isLoading && (!meetings || (meetings as any[]).length === 0) && (
              <div className="text-center py-16 text-[#86868b] text-sm">No meetings yet. Create one to get started.</div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
