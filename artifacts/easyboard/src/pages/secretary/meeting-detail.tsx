import { useState, useEffect } from 'react';
import { useParams, useLocation } from 'wouter';
import { SecretarySidebar } from '@/components/SecretarySidebar';
import { useToast } from '@/hooks/use-toast';
import { ArrowLeft, Plus, Trash2, Calendar, MapPin, Users } from 'lucide-react';

const TYPE_CONFIG: Record<string, { label: string; color: string }> = {
  information: { label: 'Information', color: '#0071e3' },
  discussion:  { label: 'Discussion',  color: '#ff9500' },
  decision:    { label: 'Decision',    color: '#34c759' },
};

const ATTENDANCE_CONFIG: Record<string, { label: string; color: string }> = {
  confirmed: { label: 'Confirmed', color: '#34c759' },
  pending:   { label: 'Pending',   color: '#ff9500' },
  proxy:     { label: 'Proxy',     color: '#5856d6' },
  absent:    { label: 'Absent',    color: '#ff3b30' },
};

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  scheduled: { label: 'Scheduled', color: '#0071e3' },
  concluded:  { label: 'Concluded', color: '#86868b' },
};

function useCustomFetch() {
  const token = localStorage.getItem('token');
  return async (url: string, options: RequestInit = {}) => {
    const r = await fetch(url, {
      ...options,
      headers: {
        ...(options.headers || {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(!options.body || options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      },
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.error || `Request failed (${r.status})`);
    }
    if (r.status === 204) return null;
    return r.json();
  };
}

export default function SecretaryMeetingDetail() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const apiFetch = useCustomFetch();

  const [meeting, setMeeting] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [newAgendaItem, setNewAgendaItem] = useState({ title: '', type: 'information', description: '' });
  const [showAddAgenda, setShowAddAgenda] = useState(false);
  const [addingAgenda, setAddingAgenda] = useState(false);
  const [savingStatus, setSavingStatus] = useState(false);

  useEffect(() => {
    apiFetch(`/api/meetings/${id}`)
      .then((data) => { setMeeting(data); setLoading(false); })
      .catch(() => { setNotFound(true); setLoading(false); });
  }, [id]);

  const refetch = async () => {
    const data = await apiFetch(`/api/meetings/${id}`);
    setMeeting(data);
  };

  const handleStatusChange = async (status: string) => {
    setSavingStatus(true);
    try {
      await apiFetch(`/api/meetings/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      await refetch();
      toast({ title: 'Status updated' });
    } catch {
      toast({ title: 'Update failed', variant: 'destructive' });
    } finally {
      setSavingStatus(false);
    }
  };

  const handleAddAgenda = async () => {
    if (!newAgendaItem.title) return;
    setAddingAgenda(true);
    try {
      await apiFetch(`/api/meetings/${id}/agenda`, {
        method: 'POST',
        body: JSON.stringify(newAgendaItem),
      });
      await refetch();
      setNewAgendaItem({ title: '', type: 'information', description: '' });
      setShowAddAgenda(false);
      toast({ title: 'Agenda item added' });
    } catch {
      toast({ title: 'Failed to add agenda item', variant: 'destructive' });
    } finally {
      setAddingAgenda(false);
    }
  };

  const handleDeleteAgenda = async (itemId: string) => {
    try {
      await apiFetch(`/api/meetings/${id}/agenda/${itemId}`, { method: 'DELETE' });
      await refetch();
      toast({ title: 'Agenda item removed' });
    } catch {
      toast({ title: 'Failed to remove', variant: 'destructive' });
    }
  };

  const handleAttendanceChange = async (personId: string, status: string) => {
    try {
      await apiFetch(`/api/meetings/${id}/attendance`, {
        method: 'PATCH',
        body: JSON.stringify({ updates: [{ personId, status }] }),
      });
      await refetch();
    } catch {
      toast({ title: 'Failed to update attendance', variant: 'destructive' });
    }
  };

  if (loading) {
    return (
      <div className="flex h-screen bg-[#f5f5f7]">
        <SecretarySidebar />
        <main className="flex-1 ml-64 flex items-center justify-center">
          <div className="text-[#86868b] text-sm">Loading...</div>
        </main>
      </div>
    );
  }

  if (notFound || !meeting) {
    return (
      <div className="flex h-screen bg-[#f5f5f7]">
        <SecretarySidebar />
        <main className="flex-1 ml-64 flex items-center justify-center">
          <div className="text-center">
            <div className="text-[#1d1d1f] font-medium mb-2">Meeting not found</div>
            <button onClick={() => setLocation('/secretary/meetings')} className="text-[#0071e3] text-sm hover:underline">
              Back to meetings
            </button>
          </div>
        </main>
      </div>
    );
  }

  const statusCfg = STATUS_CONFIG[meeting.status] || { label: meeting.status, color: '#86868b' };
  const confirmedCount = (meeting.attendance || []).filter((a: any) => a.status === 'confirmed').length;
  const totalCount = (meeting.attendance || []).length;

  return (
    <div className="flex h-screen bg-[#f5f5f7]">
      <SecretarySidebar />
      <main className="flex-1 ml-64 overflow-y-auto">
        <div className="max-w-4xl mx-auto p-8 space-y-6">

          {/* Back + header */}
          <div>
            <button onClick={() => setLocation('/secretary/meetings')}
              className="flex items-center gap-1.5 text-sm text-[#86868b] hover:text-[#1d1d1f] mb-4 transition-colors">
              <ArrowLeft size={16} /> Back to Meetings
            </button>

            <div className="bg-white rounded-2xl border border-[#e5e5e7] p-6">
              <div className="flex items-start justify-between">
                <div>
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium mb-2"
                    style={{ backgroundColor: statusCfg.color + '20', color: statusCfg.color }}>
                    {statusCfg.label}
                  </span>
                  <h1 className="text-xl font-semibold text-[#1d1d1f]">{meeting.title}</h1>
                  {meeting.boardName && (
                    <p className="text-sm text-[#86868b] mt-0.5">{meeting.boardName}</p>
                  )}
                  <div className="flex items-center gap-5 mt-3 text-sm text-[#86868b]">
                    <span className="flex items-center gap-1.5">
                      <Calendar size={14} />
                      {new Date(meeting.date).toLocaleDateString('en-US', {
                        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
                        hour: '2-digit', minute: '2-digit'
                      })}
                    </span>
                    {meeting.location && (
                      <span className="flex items-center gap-1.5">
                        <MapPin size={14} /> {meeting.location}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex gap-2">
                  {meeting.status === 'scheduled' && (
                    <button onClick={() => handleStatusChange('concluded')} disabled={savingStatus}
                      className="px-4 py-2 bg-[#f5f5f7] text-[#1d1d1f] rounded-xl text-sm font-medium hover:bg-[#ebebed] transition-colors disabled:opacity-50">
                      Mark Concluded
                    </button>
                  )}
                  {meeting.status === 'concluded' && (
                    <button onClick={() => handleStatusChange('scheduled')} disabled={savingStatus}
                      className="px-4 py-2 bg-[#f5f5f7] text-[#1d1d1f] rounded-xl text-sm font-medium hover:bg-[#ebebed] transition-colors disabled:opacity-50">
                      Reopen
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Agenda Items */}
          <div className="bg-white rounded-2xl border border-[#e5e5e7] p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-[#1d1d1f]">Agenda</h2>
              <button onClick={() => setShowAddAgenda(!showAddAgenda)}
                className="flex items-center gap-1.5 text-sm text-[#0071e3] hover:text-[#0077ed] font-medium">
                <Plus size={15} /> Add Item
              </button>
            </div>

            {(meeting.agendaItems || []).length === 0 && !showAddAgenda && (
              <div className="text-center py-8 text-[#86868b] text-sm">
                No agenda items yet. Add the first one.
              </div>
            )}

            <div className="space-y-2">
              {(meeting.agendaItems || []).map((item: any, idx: number) => {
                const typeCfg = TYPE_CONFIG[item.type] || { label: item.type, color: '#86868b' };
                return (
                  <div key={item.id} className="flex items-start gap-3 p-3 rounded-xl hover:bg-[#f5f5f7] group transition-colors">
                    <span className="text-xs font-mono text-[#86868b] w-5 mt-0.5">{idx + 1}.</span>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                          style={{ backgroundColor: typeCfg.color + '20', color: typeCfg.color }}>
                          {typeCfg.label}
                        </span>
                        <span className="text-sm font-medium text-[#1d1d1f]">{item.title}</span>
                      </div>
                      {item.description && (
                        <p className="text-xs text-[#86868b] ml-0.5">{item.description}</p>
                      )}
                    </div>
                    <button onClick={() => handleDeleteAgenda(item.id)}
                      className="opacity-0 group-hover:opacity-100 p-1.5 text-[#86868b] hover:text-[#ff3b30] transition-all rounded-lg hover:bg-[#ff3b30]/10">
                      <Trash2 size={14} />
                    </button>
                  </div>
                );
              })}
            </div>

            {showAddAgenda && (
              <div className="mt-4 pt-4 border-t border-[#e5e5e7] space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-[#1d1d1f] mb-1 block">Title</label>
                    <input
                      value={newAgendaItem.title}
                      onChange={(e) => setNewAgendaItem({ ...newAgendaItem, title: e.target.value })}
                      placeholder="Agenda item title"
                      className="w-full px-3 py-2 bg-[#f5f5f7] rounded-xl text-sm border-0 focus:outline-none focus:ring-2 focus:ring-[#0071e3]/30"
                      data-testid="input-agenda-title"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-[#1d1d1f] mb-1 block">Type</label>
                    <select
                      value={newAgendaItem.type}
                      onChange={(e) => setNewAgendaItem({ ...newAgendaItem, type: e.target.value })}
                      className="w-full px-3 py-2 bg-[#f5f5f7] rounded-xl text-sm border-0 focus:outline-none focus:ring-2 focus:ring-[#0071e3]/30"
                      data-testid="select-agenda-type"
                    >
                      <option value="information">Information</option>
                      <option value="discussion">Discussion</option>
                      <option value="decision">Decision</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-[#1d1d1f] mb-1 block">Description (optional)</label>
                  <input
                    value={newAgendaItem.description}
                    onChange={(e) => setNewAgendaItem({ ...newAgendaItem, description: e.target.value })}
                    placeholder="Brief description"
                    className="w-full px-3 py-2 bg-[#f5f5f7] rounded-xl text-sm border-0 focus:outline-none focus:ring-2 focus:ring-[#0071e3]/30"
                  />
                </div>
                <div className="flex gap-2">
                  <button onClick={handleAddAgenda} disabled={addingAgenda || !newAgendaItem.title}
                    className="px-4 py-2 bg-[#0071e3] text-white rounded-xl text-sm font-medium hover:bg-[#0077ed] disabled:opacity-50 transition-colors"
                    data-testid="button-submit-agenda">
                    {addingAgenda ? 'Adding...' : 'Add Item'}
                  </button>
                  <button onClick={() => setShowAddAgenda(false)}
                    className="px-4 py-2 bg-[#f5f5f7] text-[#1d1d1f] rounded-xl text-sm font-medium hover:bg-[#ebebed] transition-colors">
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Attendance */}
          <div className="bg-white rounded-2xl border border-[#e5e5e7] p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-[#1d1d1f]">Attendance</h2>
              <span className="text-sm text-[#86868b] flex items-center gap-1.5">
                <Users size={14} /> {confirmedCount} / {totalCount} confirmed
              </span>
            </div>

            {(meeting.attendance || []).length === 0 && (
              <div className="text-center py-8 text-[#86868b] text-sm">
                No members assigned to this meeting.
              </div>
            )}

            <div className="space-y-2">
              {(meeting.attendance || []).map((att: any) => {
                const cfg = ATTENDANCE_CONFIG[att.status] || { label: att.status, color: '#86868b', icon: null };
                return (
                  <div key={att.personId} className="flex items-center gap-3 py-2 px-3 rounded-xl hover:bg-[#f5f5f7] transition-colors">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0"
                      style={{ backgroundColor: att.person?.avatarColor || '#86868b' }}>
                      {att.person?.name?.split(' ').map((n: string) => n[0]).join('').slice(0, 2)}
                    </div>
                    <div className="flex-1">
                      <div className="text-sm font-medium text-[#1d1d1f]">{att.person?.name}</div>
                      <div className="text-xs text-[#86868b]">{att.person?.title}</div>
                    </div>
                    <select
                      value={att.status}
                      onChange={(e) => handleAttendanceChange(att.personId, e.target.value)}
                      className="text-xs px-2.5 py-1.5 rounded-lg border-0 font-medium focus:outline-none focus:ring-2 focus:ring-[#0071e3]/30 cursor-pointer"
                      style={{ backgroundColor: cfg.color + '15', color: cfg.color }}
                    >
                      <option value="confirmed">Confirmed</option>
                      <option value="pending">Pending</option>
                      <option value="proxy">Proxy</option>
                      <option value="absent">Absent</option>
                    </select>
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
