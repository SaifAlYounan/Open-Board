import { useState, useEffect } from 'react';
import { useParams, useLocation } from 'wouter';
import { TopNav } from '@/components/TopNav';
import { ArrowLeft, Calendar, MapPin, Users } from 'lucide-react';

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

export default function BoardMeetingDetail() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [, navigate] = useLocation();

  const [meeting, setMeeting] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    fetch(`/api/meetings/${id}`, {
      credentials: 'include',
    })
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((data) => { setMeeting(data); setLoading(false); })
      .catch(() => { setNotFound(true); setLoading(false); });
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f5f5f7]">
        <TopNav />
        <main className="pt-20 px-8 pb-8 max-w-3xl mx-auto flex items-center justify-center" style={{ minHeight: 'calc(100vh - 80px)' }}>
          <div className="text-[#86868b] text-sm">Loading...</div>
        </main>
      </div>
    );
  }

  if (notFound || !meeting) {
    return (
      <div className="min-h-screen bg-[#f5f5f7]">
        <TopNav />
        <main className="pt-20 px-8 pb-8 max-w-3xl mx-auto flex items-center justify-center" style={{ minHeight: 'calc(100vh - 80px)' }}>
          <div className="text-center">
            <div className="text-[#1d1d1f] font-medium mb-2">Meeting not found</div>
            <button onClick={() => navigate("/board")} className="text-[#0071e3] text-sm hover:underline">
              Go back
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
    <div className="min-h-screen bg-[#f5f5f7]">
      <TopNav />
      <main className="pt-20 px-8 pb-8 max-w-3xl mx-auto space-y-6">

        <div>
          <button onClick={() => navigate("/board")}
            className="flex items-center gap-1.5 text-sm text-[#86868b] hover:text-[#1d1d1f] mb-4 transition-colors">
            <ArrowLeft size={16} /> Back
          </button>

          <div className="bg-white rounded-2xl border border-[#e5e5e7] p-6">
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium mb-2"
              style={{ backgroundColor: statusCfg.color + '20', color: statusCfg.color }}>
              {statusCfg.label}
            </span>
            <h1 className="text-xl font-semibold text-[#1d1d1f]">{meeting.title}</h1>
            {meeting.boardName && (
              <p className="text-sm text-[#86868b] mt-0.5">{meeting.boardName}</p>
            )}
            <div className="flex flex-wrap items-center gap-5 mt-3 text-sm text-[#86868b]">
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
              <span className="flex items-center gap-1.5">
                <Users size={14} /> {confirmedCount}/{totalCount} confirmed
              </span>
            </div>
          </div>
        </div>

        {/* Agenda */}
        <div className="bg-white rounded-2xl border border-[#e5e5e7] p-6">
          <h2 className="font-semibold text-[#1d1d1f] mb-4">Agenda</h2>

          {(meeting.agendaItems || []).length === 0 ? (
            <div className="text-center py-8 text-[#86868b] text-sm">No agenda items have been added yet.</div>
          ) : (
            <div className="space-y-2">
              {(meeting.agendaItems || []).map((item: any, idx: number) => {
                const typeCfg = TYPE_CONFIG[item.type] || { label: item.type, color: '#86868b' };
                return (
                  <div key={item.id} className="flex items-start gap-3 p-3 rounded-xl bg-[#f5f5f7]">
                    <span className="text-xs font-mono text-[#86868b] w-5 mt-0.5 flex-shrink-0">{idx + 1}.</span>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                          style={{ backgroundColor: typeCfg.color + '20', color: typeCfg.color }}>
                          {typeCfg.label}
                        </span>
                        <span className="text-sm font-medium text-[#1d1d1f]">{item.title}</span>
                      </div>
                      {item.description && (
                        <p className="text-xs text-[#86868b]">{item.description}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Attendance */}
        <div className="bg-white rounded-2xl border border-[#e5e5e7] p-6">
          <h2 className="font-semibold text-[#1d1d1f] mb-4">Attendance</h2>

          {(meeting.attendance || []).length === 0 ? (
            <div className="text-center py-8 text-[#86868b] text-sm">No attendance records.</div>
          ) : (
            <div className="divide-y divide-[#f5f5f7]">
              {(meeting.attendance || []).map((att: any) => {
                const cfg = ATTENDANCE_CONFIG[att.status] || { label: att.status, color: '#86868b' };
                return (
                  <div key={att.personId} className="flex items-center gap-3 py-3">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0"
                      style={{ backgroundColor: att.person?.avatarColor || '#86868b' }}>
                      {att.person?.name?.split(' ').map((n: string) => n[0]).join('').slice(0, 2)}
                    </div>
                    <div className="flex-1">
                      <div className="text-sm font-medium text-[#1d1d1f]">{att.person?.name}</div>
                      <div className="text-xs text-[#86868b]">{att.person?.title}</div>
                    </div>
                    <span className="text-xs px-2.5 py-1 rounded-full font-medium"
                      style={{ backgroundColor: cfg.color + '20', color: cfg.color }}>
                      {cfg.label}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

      </main>
    </div>
  );
}
