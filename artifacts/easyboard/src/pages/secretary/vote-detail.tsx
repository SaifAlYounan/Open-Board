import { useState, useRef } from 'react';
import { useLocation, useParams } from 'wouter';
import { SecretarySidebar } from '@/components/SecretarySidebar';
import { useGetVote, useUpdateVote, getListVotesQueryKey, getGetVoteQueryKey } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { VoteProgressBar } from '@/components/VoteProgressBar';
import {
  ArrowLeft, Clock, CheckCircle, XCircle, MinusCircle, Download, Upload, Trash2, FileText, Users, Shield, Calendar, Paperclip, X, Ban
} from 'lucide-react';
import { useAuth } from '@/lib/auth';

function formatDate(d: string | null | undefined) {
  if (!d) return '—';
  // For date-only strings (YYYY-MM-DD), parse as local date to avoid UTC midnight timezone shifts
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.exec(d);
  if (dateOnly) {
    const [yr, mo, dy] = d.split('-').map(Number);
    return new Date(yr, mo - 1, dy).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  return new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatDateTime(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, { color: string; label: string; icon: React.ReactNode }> = {
    open:      { color: '#0071e3', label: 'Open',      icon: <Clock size={12} /> },
    approved:  { color: '#34c759', label: 'Approved',  icon: <CheckCircle size={12} /> },
    rejected:  { color: '#ff3b30', label: 'Rejected',  icon: <XCircle size={12} /> },
    lapsed:    { color: '#86868b', label: 'Lapsed',    icon: <MinusCircle size={12} /> },
    cancelled: { color: '#ff9500', label: 'Cancelled', icon: <Ban size={12} /> },
  };
  const { color, label, icon } = cfg[status] || cfg.lapsed;
  return (
    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium text-white" style={{ backgroundColor: color }}>
      {icon} {label}
    </span>
  );
}

function MemberRow({ record, member, isRecused, isRequired }: { record?: any; member?: any; isRecused?: boolean; isRequired?: boolean }) {
  const name = record?.person?.name || member?.personName || member?.name || 'Unknown';
  const title = record?.person?.title || member?.personTitle || member?.title || '';

  if (isRecused) {
    return (
      <div className="flex items-center gap-3 py-2.5 border-b border-[#f5f5f7] last:border-0">
        <div className="w-8 h-8 rounded-full bg-[#f5f5f7] flex items-center justify-center">
          <span className="text-xs font-medium text-[#86868b]">{name.charAt(0)}</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-[#86868b]">{name}</p>
          {title && <p className="text-xs text-[#86868b]">{title}</p>}
        </div>
        <span className="text-xs text-[#86868b] bg-[#f5f5f7] px-2 py-0.5 rounded-full">Recused</span>
      </div>
    );
  }

  if (!record) {
    return (
      <div className="flex items-center gap-3 py-2.5 border-b border-[#f5f5f7] last:border-0">
        <div className="w-8 h-8 rounded-full bg-[#f5f5f7] flex items-center justify-center">
          <span className="text-xs font-medium text-[#86868b]">{name.charAt(0)}</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-[#1d1d1f]">{name}</p>
          {title && <p className="text-xs text-[#86868b]">{title}</p>}
        </div>
        <div className="flex items-center gap-1.5">
          {isRequired && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-[#0071e3]/10 text-[#0071e3] font-medium">Key Approver</span>
          )}
          <span className="text-xs text-[#86868b]">Pending</span>
        </div>
      </div>
    );
  }

  const isApproved = record.decision.startsWith('approved');
  const color = isApproved ? '#34c759' : '#ff3b30';
  const decisionLabel = {
    approved: 'Approved',
    approved_with_comments: 'Approved with Comments',
    not_approved: 'Not Approved',
    not_approved_with_comments: 'Not Approved with Comments',
  }[record.decision] || record.decision;

  return (
    <div className="py-2.5 border-b border-[#f5f5f7] last:border-0">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-semibold" style={{ backgroundColor: color }}>
          {name.charAt(0)}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-[#1d1d1f]">{name}</p>
          {title && <p className="text-xs text-[#86868b]">{title}</p>}
        </div>
        <div className="text-right">
          {isRequired && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-[#0071e3]/10 text-[#0071e3] font-medium block mb-0.5">Key Approver</span>
          )}
          <p className="text-xs font-medium" style={{ color }}>{decisionLabel}</p>
          <p className="text-xs text-[#86868b]">{formatDateTime(record.votedAt)}</p>
        </div>
      </div>
      {record.comment && (
        <div className="ml-11 mt-1.5 p-2.5 bg-[#f5f5f7] rounded-lg">
          <p className="text-xs text-[#1d1d1f] italic">"{record.comment}"</p>
        </div>
      )}
    </div>
  );
}

export default function SecretaryVoteDetail() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { token } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [showClose, setShowClose] = useState(false);
  const [closeStatus, setCloseStatus] = useState<'approved' | 'rejected' | 'lapsed'>('lapsed');
  const [showExtend, setShowExtend] = useState(false);
  const [newDeadline, setNewDeadline] = useState('');
  const [uploading, setUploading] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [showCancel, setShowCancel] = useState(false);

  const { data: vote, isLoading } = useGetVote(id);
  const updateVote = useUpdateVote();

  const voteData = vote as any;

  const handleClose = () => {
    updateVote.mutate(
      { id, data: { status: closeStatus } },
      {
        onSuccess: () => {
          toast({ title: 'Vote closed', description: `Status set to ${closeStatus}` });
          queryClient.invalidateQueries({ queryKey: getGetVoteQueryKey(id) });
          queryClient.invalidateQueries({ queryKey: getListVotesQueryKey() });
          setShowClose(false);
        },
        onError: (err: any) => {
          toast({ title: 'Failed', description: err.data?.error || 'Please try again.', variant: 'destructive' });
        },
      }
    );
  };

  const handleExtend = () => {
    if (!newDeadline) {
      toast({ title: 'Select a date', variant: 'destructive' });
      return;
    }
    updateVote.mutate(
      { id, data: { deadline: newDeadline } },
      {
        onSuccess: () => {
          toast({ title: 'Deadline extended' });
          queryClient.invalidateQueries({ queryKey: getGetVoteQueryKey(id) });
          queryClient.invalidateQueries({ queryKey: getListVotesQueryKey() });
          setShowExtend(false);
          setNewDeadline('');
        },
        onError: (err: any) => {
          toast({ title: 'Failed', description: err.data?.error || 'Please try again.', variant: 'destructive' });
        },
      }
    );
  };

  const handleDelete = async () => {
    const resp = await fetch(`/api/votes/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (resp.status === 409) {
      toast({ title: 'Cannot delete', description: 'This vote has cast votes. Use Cancel Vote instead.', variant: 'destructive' });
      setShowDelete(false);
      return;
    }
    if (!resp.ok) {
      toast({ title: 'Delete failed', variant: 'destructive' });
      return;
    }
    toast({ title: 'Vote deleted' });
    queryClient.invalidateQueries({ queryKey: getListVotesQueryKey() });
    setLocation('/secretary/votes');
  };

  const handleCancel = () => {
    updateVote.mutate(
      { id, data: { status: 'cancelled' as any } },
      {
        onSuccess: () => {
          toast({ title: 'Vote cancelled', description: 'The vote has been cancelled. All records are preserved.' });
          queryClient.invalidateQueries({ queryKey: getGetVoteQueryKey(id) });
          queryClient.invalidateQueries({ queryKey: getListVotesQueryKey() });
          setShowCancel(false);
        },
        onError: (err: any) => {
          toast({ title: 'Failed', description: err.data?.error || 'Please try again.', variant: 'destructive' });
        },
      }
    );
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);
    formData.append('title', file.name.replace(/\.[^/.]+$/, ''));
    try {
      const resp = await fetch(`/api/votes/${id}/documents`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (!resp.ok) throw new Error('Upload failed');
      toast({ title: 'Document uploaded' });
      queryClient.invalidateQueries({ queryKey: getGetVoteQueryKey(id) });
    } catch {
      toast({ title: 'Upload failed', variant: 'destructive' });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDeleteDoc = async (docId: string) => {
    try {
      await fetch(`/api/votes/${id}/documents/${docId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      toast({ title: 'Document removed' });
      queryClient.invalidateQueries({ queryKey: getGetVoteQueryKey(id) });
    } catch {
      toast({ title: 'Failed to remove', variant: 'destructive' });
    }
  };

  const handleDownloadCertificate = async () => {
    try {
      const resp = await fetch(`/api/votes/${id}/certificate`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const cert = await resp.json();
      generateCertificatePDF(cert);
    } catch {
      toast({ title: 'Failed to load certificate', variant: 'destructive' });
    }
  };

  const generateCertificatePDF = (cert: any) => {
    const approvals = cert.voteRecords?.filter((r: any) => r.decision.startsWith('approved')).length || 0;
    const total = cert.voteRecords?.length || 0;
    const statusColor = { approved: '#34c759', rejected: '#ff3b30', lapsed: '#86868b', open: '#0071e3' }[cert.status as string] || '#86868b';

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Certificate — ${cert.resolutionNumber}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif; background: #fff; color: #1d1d1f; padding: 60px; max-width: 800px; margin: 0 auto; }
  .header { text-align: center; border-bottom: 2px solid #1d1d1f; padding-bottom: 32px; margin-bottom: 32px; }
  .logo { font-size: 13px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: #86868b; margin-bottom: 8px; }
  h1 { font-size: 28px; font-weight: 700; margin-bottom: 8px; }
  .subtitle { font-size: 15px; color: #86868b; }
  .badge { display: inline-block; padding: 4px 14px; border-radius: 999px; color: #fff; font-size: 13px; font-weight: 600; background: ${statusColor}; margin: 16px 0; }
  .section { margin-bottom: 28px; }
  .section-title { font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: #86868b; margin-bottom: 10px; }
  .resolution-text { background: #f5f5f7; border-radius: 10px; padding: 16px; font-size: 14px; line-height: 1.6; font-style: italic; }
  .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .info-item label { font-size: 11px; color: #86868b; display: block; margin-bottom: 2px; }
  .info-item value, .info-item p { font-size: 14px; font-weight: 500; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; padding: 8px 10px; background: #f5f5f7; font-size: 11px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; color: #86868b; }
  td { padding: 10px; border-bottom: 1px solid #f5f5f7; }
  .approved { color: #34c759; font-weight: 600; }
  .rejected { color: #ff3b30; font-weight: 600; }
  .hash-box { background: #f5f5f7; border-radius: 10px; padding: 14px; font-family: 'SF Mono', 'Courier New', monospace; font-size: 11px; word-break: break-all; color: #86868b; }
  .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e5e7; text-align: center; font-size: 11px; color: #86868b; }
  .tally { display: flex; gap: 24px; justify-content: center; margin: 16px 0; }
  .tally-item { text-align: center; }
  .tally-item .num { font-size: 32px; font-weight: 700; }
  .tally-item .lbl { font-size: 11px; color: #86868b; text-transform: uppercase; letter-spacing: 0.05em; }
  @media print { body { padding: 40px; } }
</style>
</head>
<body>
  <div class="header">
    <div class="logo">Meridian Energy Group</div>
    <h1>Resolution Certificate</h1>
    <div class="subtitle">${cert.boardName}</div>
    <div class="badge">${cert.status?.toUpperCase()}</div>
  </div>

  <div class="section">
    <div class="section-title">Resolution Details</div>
    <div class="info-grid">
      <div class="info-item"><label>Resolution Number</label><p>${cert.resolutionNumber}</p></div>
      <div class="info-item"><label>Status</label><p style="color:${statusColor};font-weight:600;">${cert.status?.toUpperCase()}</p></div>
      <div class="info-item"><label>Deadline</label><p>${cert.deadline ? new Date(cert.deadline).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'}</p></div>
      <div class="info-item"><label>Closed At</label><p>${cert.closedAt ? new Date(cert.closedAt).toLocaleString('en-AU') : '—'}</p></div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Resolution Title</div>
    <p style="font-size:16px;font-weight:600;">${cert.title}</p>
  </div>

  <div class="section">
    <div class="section-title">Resolution Text</div>
    <div class="resolution-text">${cert.resolutionText}</div>
  </div>

  <div class="section">
    <div class="section-title">Vote Tally</div>
    <div class="tally">
      <div class="tally-item"><div class="num" style="color:#34c759">${approvals}</div><div class="lbl">For</div></div>
      <div class="tally-item"><div class="num" style="color:#ff3b30">${total - approvals}</div><div class="lbl">Against</div></div>
      <div class="tally-item"><div class="num">${total}</div><div class="lbl">Total Votes</div></div>
    </div>
    ${cert.approvalRule?.summaryText ? `<p style="text-align:center;font-size:13px;color:#86868b;">${cert.approvalRule.summaryText}</p>` : ''}
  </div>

  <div class="section">
    <div class="section-title">Individual Votes</div>
    <table>
      <thead><tr><th>Member</th><th>Decision</th><th>Date & Time</th><th>Comment</th></tr></thead>
      <tbody>
        ${(cert.voteRecords || []).map((r: any) => `
          <tr>
            <td>${r.person?.name || 'Unknown'}</td>
            <td class="${r.decision.startsWith('approved') ? 'approved' : 'rejected'}">${r.decision.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}</td>
            <td>${r.votedAt ? new Date(r.votedAt).toLocaleString('en-AU') : '—'}</td>
            <td style="font-style:italic;color:#86868b;">${r.comment || ''}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  </div>

  ${cert.hash ? `
  <div class="section">
    <div class="section-title">Integrity Certificate (SHA-256)</div>
    <div class="hash-box">${cert.hash}</div>
    <p style="font-size:11px;color:#86868b;margin-top:8px;">This cryptographic hash certifies the integrity and immutability of this resolution record.</p>
  </div>
  ` : ''}

  <div class="footer">
    <p>Generated by EasyBoard — Meridian Energy Group Board Management Portal</p>
    <p>${new Date().toLocaleString('en-AU')}</p>
  </div>
</body>
</html>`;

    const win = window.open('', '_blank');
    if (win) {
      win.document.write(html);
      win.document.close();
      setTimeout(() => win.print(), 500);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-screen bg-[#f5f5f7]">
        <SecretarySidebar />
        <main className="flex-1 ml-64 flex items-center justify-center">
          <p className="text-[#86868b] text-sm">Loading...</p>
        </main>
      </div>
    );
  }

  if (!voteData) {
    return (
      <div className="flex h-screen bg-[#f5f5f7]">
        <SecretarySidebar />
        <main className="flex-1 ml-64 flex items-center justify-center">
          <p className="text-[#86868b] text-sm">Vote not found.</p>
        </main>
      </div>
    );
  }

  const voteRecordsById = new Map((voteData.voteRecords || []).map((r: any) => [r.personId, r]));
  const recusedIds = new Set<string>(voteData.approvalRule?.recusedIds || []);
  const requiredVoterIds = new Set<string>(voteData.approvalRule?.requiredVoterIds || []);
  const votingBoardMembers = (voteData.boardMembers || []).filter(
    (m: any) => m.roleInBoard !== 'observer' && m.roleInBoard !== 'secretary'
  );
  const isOpen = voteData.status === 'open';
  const isClosed = ['approved', 'rejected', 'lapsed'].includes(voteData.status);
  const hasVotes = (voteData.votescast ?? 0) > 0;

  return (
    <div className="flex h-screen bg-[#f5f5f7]">
      <SecretarySidebar />
      <main className="flex-1 ml-64 overflow-y-auto">
        <div className="max-w-4xl mx-auto p-8 space-y-6">

          {/* Header */}
          <div className="flex items-start gap-4">
            <button
              onClick={() => setLocation('/secretary/votes')}
              className="mt-1 p-1.5 rounded-lg hover:bg-white transition-colors text-[#86868b]"
            >
              <ArrowLeft size={18} />
            </button>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-mono text-[#86868b]">{voteData.resolutionNumber}</span>
                <span className="text-[#e5e5e7]">·</span>
                <span className="text-xs text-[#86868b]">{voteData.boardName}</span>
                <span className="text-[#e5e5e7]">·</span>
                <span className="text-xs text-[#86868b] capitalize">{voteData.type}</span>
              </div>
              <h1 className="text-2xl font-semibold text-[#1d1d1f]">{voteData.title}</h1>
            </div>
            <StatusBadge status={voteData.status} />
          </div>

          {/* Action bar */}
          <div className="flex items-center gap-2 flex-wrap">
            {isOpen && (
              <>
                <button
                  onClick={() => setShowExtend(!showExtend)}
                  className="flex items-center gap-1.5 px-3 py-2 bg-white border border-[#e5e5e7] text-[#1d1d1f] rounded-xl text-xs font-medium hover:bg-[#f5f5f7] transition-colors"
                  data-testid="btn-extend-deadline"
                >
                  <Calendar size={14} /> Extend Deadline
                </button>
                <button
                  onClick={() => setShowClose(!showClose)}
                  className="flex items-center gap-1.5 px-3 py-2 bg-[#ff3b30] text-white rounded-xl text-xs font-medium hover:opacity-90 transition-opacity"
                  data-testid="btn-close-vote"
                >
                  <XCircle size={14} /> Close Vote
                </button>
              </>
            )}
            {isClosed && (
              <button
                onClick={handleDownloadCertificate}
                className="flex items-center gap-1.5 px-3 py-2 bg-[#34c759] text-white rounded-xl text-xs font-medium hover:opacity-90 transition-opacity"
                data-testid="btn-download-certificate"
              >
                <Download size={14} /> Download Certificate
              </button>
            )}
            {isOpen && !hasVotes && (
              <button
                onClick={() => { setShowDelete(!showDelete); setShowCancel(false); }}
                className="flex items-center gap-1.5 px-3 py-2 bg-white border border-[#e5e5e7] text-[#ff3b30] rounded-xl text-xs font-medium hover:bg-[#fff5f5] transition-colors ml-auto"
                data-testid="btn-delete-vote"
              >
                <Trash2 size={14} /> Delete
              </button>
            )}
            {isOpen && hasVotes && (
              <button
                onClick={() => { setShowCancel(!showCancel); setShowDelete(false); }}
                className="flex items-center gap-1.5 px-3 py-2 bg-white border border-[#ff9500] text-[#ff9500] rounded-xl text-xs font-medium hover:bg-[#fff8f0] transition-colors ml-auto"
                data-testid="btn-cancel-vote"
              >
                <Ban size={14} /> Cancel Vote
              </button>
            )}
          </div>

          {/* Extend Deadline Panel */}
          {showExtend && (
            <div className="bg-white rounded-2xl border border-[#e5e5e7] p-5">
              <h3 className="font-semibold text-[#1d1d1f] mb-3 flex items-center gap-2">
                <Calendar size={16} className="text-[#0071e3]" /> Extend Deadline
              </h3>
              <p className="text-xs text-[#86868b] mb-3">
                Current deadline: <strong>{formatDate(voteData.deadline)}</strong>
              </p>
              <div className="flex items-center gap-3">
                <input
                  type="date"
                  value={newDeadline}
                  onChange={(e) => setNewDeadline(e.target.value)}
                  min={new Date().toISOString().split('T')[0]}
                  className="px-3 py-2 bg-[#f5f5f7] rounded-xl text-sm text-[#1d1d1f] border-0 focus:outline-none focus:ring-2 focus:ring-[#0071e3]/30"
                  data-testid="input-new-deadline"
                />
                <button
                  onClick={handleExtend}
                  disabled={updateVote.isPending}
                  className="px-4 py-2 bg-[#0071e3] text-white rounded-xl text-sm font-medium hover:bg-[#0077ed] disabled:opacity-50 transition-colors"
                >
                  {updateVote.isPending ? 'Saving...' : 'Save'}
                </button>
                <button onClick={() => setShowExtend(false)} className="p-2 text-[#86868b] hover:text-[#1d1d1f]">
                  <X size={16} />
                </button>
              </div>
            </div>
          )}

          {/* Close Vote Panel */}
          {showClose && (
            <div className="bg-white rounded-2xl border border-[#ff3b30]/30 p-5">
              <h3 className="font-semibold text-[#1d1d1f] mb-3 flex items-center gap-2">
                <XCircle size={16} className="text-[#ff3b30]" /> Close Vote
              </h3>
              <p className="text-xs text-[#86868b] mb-3">
                Force-close this vote and set the final outcome. A SHA-256 certificate hash will be generated.
              </p>
              <div className="flex items-center gap-3 flex-wrap">
                {(['approved', 'rejected', 'lapsed'] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setCloseStatus(s)}
                    className="px-3 py-1.5 rounded-xl text-xs font-medium border-2 transition-colors capitalize"
                    style={{
                      borderColor: closeStatus === s ? (s === 'approved' ? '#34c759' : s === 'rejected' ? '#ff3b30' : '#86868b') : '#e5e5e7',
                      backgroundColor: closeStatus === s ? (s === 'approved' ? '#f0fdf4' : s === 'rejected' ? '#fff5f5' : '#f5f5f7') : 'white',
                      color: closeStatus === s ? (s === 'approved' ? '#34c759' : s === 'rejected' ? '#ff3b30' : '#86868b') : '#86868b',
                    }}
                  >
                    {s}
                  </button>
                ))}
                <button
                  onClick={handleClose}
                  disabled={updateVote.isPending}
                  className="px-4 py-2 bg-[#ff3b30] text-white rounded-xl text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
                  data-testid="btn-confirm-close"
                >
                  {updateVote.isPending ? 'Closing...' : 'Confirm Close'}
                </button>
                <button onClick={() => setShowClose(false)} className="p-2 text-[#86868b] hover:text-[#1d1d1f]">
                  <X size={16} />
                </button>
              </div>
            </div>
          )}

          {/* Delete Confirm Panel */}
          {showDelete && (
            <div className="bg-white rounded-2xl border border-[#ff3b30]/30 p-5">
              <h3 className="font-semibold text-[#ff3b30] mb-2">Delete Resolution</h3>
              <p className="text-sm text-[#86868b] mb-4">
                No votes have been cast yet. This will permanently remove the resolution, its documents, and all related data. This cannot be undone.
              </p>
              <div className="flex gap-3">
                <button onClick={handleDelete} className="px-4 py-2 bg-[#ff3b30] text-white rounded-xl text-sm font-medium hover:opacity-90">
                  Delete Permanently
                </button>
                <button onClick={() => setShowDelete(false)} className="px-4 py-2 bg-[#f5f5f7] text-[#1d1d1f] rounded-xl text-sm font-medium">
                  Keep
                </button>
              </div>
            </div>
          )}

          {/* Cancel Vote Confirm Panel */}
          {showCancel && (
            <div className="bg-white rounded-2xl border border-[#ff9500]/30 p-5">
              <h3 className="font-semibold text-[#ff9500] mb-2 flex items-center gap-2">
                <Ban size={16} /> Cancel Vote
              </h3>
              <p className="text-sm text-[#86868b] mb-4">
                This will cancel the vote and preserve the full audit trail — all cast votes are retained for the record. The resolution will be marked as Cancelled and no further voting will be accepted.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={handleCancel}
                  disabled={updateVote.isPending}
                  className="px-4 py-2 bg-[#ff9500] text-white rounded-xl text-sm font-medium hover:opacity-90 disabled:opacity-50"
                >
                  {updateVote.isPending ? 'Cancelling...' : 'Confirm Cancel'}
                </button>
                <button onClick={() => setShowCancel(false)} className="px-4 py-2 bg-[#f5f5f7] text-[#1d1d1f] rounded-xl text-sm font-medium">
                  Keep Open
                </button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-3 gap-6">
            {/* Left column: Resolution + Rule + Progress */}
            <div className="col-span-2 space-y-5">

              {/* Vote progress */}
              <div className="bg-white rounded-2xl border border-[#e5e5e7] p-5">
                <div className="flex items-center gap-2 mb-3">
                  <Users size={16} className="text-[#86868b]" />
                  <h2 className="font-semibold text-[#1d1d1f] text-sm">Vote Progress</h2>
                </div>
                <VoteProgressBar
                  totalVoters={voteData.totalVoters}
                  votescast={voteData.votescast}
                  approvalsCount={voteData.approvalsCount}
                />
                <div className="mt-3 flex items-center gap-4 text-xs text-[#86868b]">
                  <span><strong className="text-[#34c759]">{voteData.approvalsCount}</strong> for</span>
                  <span><strong className="text-[#ff3b30]">{voteData.votescast - voteData.approvalsCount}</strong> against</span>
                  <span><strong className="text-[#86868b]">{voteData.totalVoters - voteData.votescast}</strong> pending</span>
                  <span className="ml-auto">{voteData.votescast}/{voteData.totalVoters} voted</span>
                </div>
              </div>

              {/* Resolution text */}
              <div className="bg-white rounded-2xl border border-[#e5e5e7] p-5">
                <div className="flex items-center gap-2 mb-3">
                  <FileText size={16} className="text-[#86868b]" />
                  <h2 className="font-semibold text-[#1d1d1f] text-sm">Resolution Text</h2>
                </div>
                <p className="text-sm text-[#1d1d1f] leading-relaxed italic">"{voteData.resolutionText}"</p>
              </div>

              {/* Per-member breakdown */}
              <div className="bg-white rounded-2xl border border-[#e5e5e7] p-5">
                <div className="flex items-center gap-2 mb-4">
                  <Users size={16} className="text-[#86868b]" />
                  <h2 className="font-semibold text-[#1d1d1f] text-sm">Member Votes</h2>
                </div>
                {votingBoardMembers.length === 0 ? (
                  <p className="text-xs text-[#86868b]">No voting members assigned to this board.</p>
                ) : (
                  <div>
                    {/* Recused members */}
                    {votingBoardMembers
                      .filter((m: any) => recusedIds.has(m.personId))
                      .map((m: any) => (
                        <MemberRow key={m.personId} member={m.person} isRecused />
                      ))
                    }
                    {/* Cast votes */}
                    {votingBoardMembers
                      .filter((m: any) => !recusedIds.has(m.personId) && voteRecordsById.has(m.personId))
                      .map((m: any) => (
                        <MemberRow key={m.personId} record={voteRecordsById.get(m.personId)} isRequired={requiredVoterIds.has(m.personId)} />
                      ))
                    }
                    {/* Pending (haven't voted yet) — show with real names */}
                    {votingBoardMembers
                      .filter((m: any) => !recusedIds.has(m.personId) && !voteRecordsById.has(m.personId))
                      .map((m: any) => (
                        <MemberRow key={m.personId} member={m.person} isRequired={requiredVoterIds.has(m.personId)} />
                      ))
                    }
                  </div>
                )}
              </div>

              {/* Supporting documents */}
              <div className="bg-white rounded-2xl border border-[#e5e5e7] p-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Paperclip size={16} className="text-[#86868b]" />
                    <h2 className="font-semibold text-[#1d1d1f] text-sm">Supporting Materials</h2>
                    {(voteData.documents || []).length > 0 && (
                      <span className="text-xs bg-[#0071e3] text-white px-1.5 py-0.5 rounded-full">{(voteData.documents || []).length}</span>
                    )}
                  </div>
                  <div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      onChange={handleFileUpload}
                      className="hidden"
                      accept=".pdf,.docx,.txt,.xlsx,.pptx,.png,.jpg,.jpeg"
                      data-testid="input-document-upload"
                    />
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploading}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-[#f5f5f7] rounded-xl text-xs font-medium text-[#1d1d1f] hover:bg-[#e5e5e7] disabled:opacity-50 transition-colors"
                      data-testid="btn-upload-document"
                    >
                      <Upload size={13} /> {uploading ? 'Uploading...' : 'Upload'}
                    </button>
                  </div>
                </div>

                {(voteData.documents || []).length === 0 ? (
                  <div
                    className="border-2 border-dashed border-[#e5e5e7] rounded-xl p-8 text-center cursor-pointer hover:border-[#0071e3]/40 transition-colors"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Paperclip size={20} className="text-[#86868b] mx-auto mb-2" />
                    <p className="text-xs text-[#86868b]">Click to upload supporting materials</p>
                    <p className="text-xs text-[#86868b] mt-1">PDF, DOCX, XLSX, PPTX, images up to 20MB</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {(voteData.documents || []).map((doc: any) => (
                      <div key={doc.id} className="flex items-center gap-3 p-3 bg-[#f5f5f7] rounded-xl">
                        <FileText size={16} className="text-[#0071e3] flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-[#1d1d1f] truncate">{doc.title}</p>
                          <p className="text-xs text-[#86868b]">
                            {doc.filename} {doc.fileSize ? `· ${(doc.fileSize / 1024).toFixed(0)} KB` : ''}
                            {doc.uploaderName ? ` · ${doc.uploaderName}` : ''}
                          </p>
                        </div>
                        <button
                          onClick={() => handleDeleteDoc(doc.id)}
                          className="p-1.5 text-[#86868b] hover:text-[#ff3b30] transition-colors flex-shrink-0"
                          data-testid={`btn-delete-doc-${doc.id}`}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Right column: Meta + Rule */}
            <div className="space-y-5">

              {/* Vote info */}
              <div className="bg-white rounded-2xl border border-[#e5e5e7] p-5 space-y-4">
                <div className="flex items-center gap-2 mb-1">
                  <FileText size={16} className="text-[#86868b]" />
                  <h2 className="font-semibold text-[#1d1d1f] text-sm">Details</h2>
                </div>
                <div className="space-y-3">
                  <div>
                    <p className="text-xs text-[#86868b] mb-0.5">Board</p>
                    <p className="text-sm font-medium text-[#1d1d1f]">{voteData.boardName}</p>
                  </div>
                  <div>
                    <p className="text-xs text-[#86868b] mb-0.5">Type</p>
                    <p className="text-sm font-medium text-[#1d1d1f] capitalize">{voteData.type}</p>
                  </div>
                  <div>
                    <p className="text-xs text-[#86868b] mb-0.5">Created</p>
                    <p className="text-sm font-medium text-[#1d1d1f]">{formatDate(voteData.createdAt)}</p>
                  </div>
                  {voteData.deadline && (
                    <div>
                      <p className="text-xs text-[#86868b] mb-0.5">Deadline</p>
                      <p className="text-sm font-medium text-[#1d1d1f]">{formatDateTime(voteData.deadline)}</p>
                    </div>
                  )}
                  {voteData.closedAt && (
                    <div>
                      <p className="text-xs text-[#86868b] mb-0.5">Closed At</p>
                      <p className="text-sm font-medium text-[#1d1d1f]">{formatDateTime(voteData.closedAt)}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Approval rule */}
              {voteData.approvalRule && (
                <div className="bg-white rounded-2xl border border-[#e5e5e7] p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <Shield size={16} className="text-[#86868b]" />
                    <h2 className="font-semibold text-[#1d1d1f] text-sm">Approval Rule</h2>
                  </div>
                  <p className="text-xs text-[#86868b] leading-relaxed">{voteData.approvalRule.summaryText}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="text-xs px-2 py-1 bg-[#f5f5f7] rounded-lg text-[#1d1d1f] capitalize font-medium">
                      {voteData.approvalRule.type?.replace('_', ' ')}
                    </span>
                    {voteData.approvalRule.quorum && (
                      <span className="text-xs px-2 py-1 bg-[#f5f5f7] rounded-lg text-[#1d1d1f]">Quorum: {voteData.approvalRule.quorum}</span>
                    )}
                    {voteData.approvalRule.weighted && (
                      <span className="text-xs px-2 py-1 bg-[#f5f5f7] rounded-lg text-[#1d1d1f]">Weighted</span>
                    )}
                  </div>
                </div>
              )}

              {/* Certificate hash for closed votes */}
              {isClosed && voteData.certificateHash && (
                <div className="bg-white rounded-2xl border border-[#e5e5e7] p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <Shield size={16} className="text-[#34c759]" />
                    <h2 className="font-semibold text-[#1d1d1f] text-sm">Certificate Hash</h2>
                  </div>
                  <p className="text-xs font-mono text-[#86868b] break-all bg-[#f5f5f7] p-2.5 rounded-lg">{voteData.certificateHash}</p>
                  <p className="text-xs text-[#86868b] mt-2">SHA-256 integrity fingerprint</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
