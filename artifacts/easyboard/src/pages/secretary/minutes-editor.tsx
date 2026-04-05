import { useState, useEffect } from 'react';
import { useParams } from 'wouter';
import { SecretarySidebar } from '@/components/SecretarySidebar';
import {
  useGetMinutes, useUpdateMinutes, useUpdateMinutesStatus, useGetMinutesComments, useResolveMinutesComment,
  getGetMinutesQueryKey, getGetMinutesCommentsQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Save, Send, PenLine, CheckCircle, ChevronRight, MessageSquare, X } from 'lucide-react';

const STATUS_FLOW: Record<string, { next: string; label: string; color: string }> = {
  draft: { next: 'review', label: 'Send to Review', color: '#ff9500' },
  review: { next: 'signing', label: 'Send to Signing', color: '#0071e3' },
  signing: { next: 'signed', label: 'Mark as Signed', color: '#34c759' },
};

export default function MinutesEditor() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { data: minutes, isLoading } = useGetMinutes(id, { query: { queryKey: getGetMinutesQueryKey(id) } });
  const { data: comments } = useGetMinutesComments(id, { query: { queryKey: getGetMinutesCommentsQueryKey(id) } });
  const updateMinutes = useUpdateMinutes();
  const updateStatus = useUpdateMinutesStatus();
  const resolveComment = useResolveMinutesComment();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [isSaving, setIsSaving] = useState(false);

  const m = minutes as any;

  const editor = useEditor({
    extensions: [StarterKit],
    content: m?.content || '',
    editable: true,
    onUpdate: () => {},
  });

  useEffect(() => {
    if (m?.content && editor && editor.getHTML() !== m.content) {
      editor.commands.setContent(m.content);
    }
  }, [m?.content]);

  const handleSave = async () => {
    if (!editor) return;
    setIsSaving(true);
    updateMinutes.mutate({ id, data: { content: editor.getHTML() } }, {
      onSuccess: () => {
        toast({ title: 'Minutes saved' });
        queryClient.invalidateQueries({ queryKey: getGetMinutesQueryKey(id) });
      },
      onError: (err: any) => toast({ title: 'Save failed', description: err.data?.error, variant: 'destructive' }),
      onSettled: () => setIsSaving(false),
    });
  };

  const handleStatusChange = () => {
    if (!m?.status || !STATUS_FLOW[m.status]) return;
    updateStatus.mutate({ id, data: { status: STATUS_FLOW[m.status].next } }, {
      onSuccess: () => {
        toast({ title: `Status changed to ${STATUS_FLOW[m.status].next}` });
        queryClient.invalidateQueries({ queryKey: getGetMinutesQueryKey(id) });
      }
    });
  };

  const handleResolveComment = (commentId: string) => {
    resolveComment.mutate({ id, commentId, data: { status: 'resolved' } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetMinutesCommentsQueryKey(id) });
        toast({ title: 'Comment resolved' });
      }
    });
  };

  if (isLoading) return (
    <div className="flex h-screen bg-[#f5f5f7]">
      <SecretarySidebar />
      <main className="flex-1 ml-64 flex items-center justify-center">
        <div className="text-[#86868b] text-sm">Loading minutes...</div>
      </main>
    </div>
  );

  const nextStatusInfo = m?.status ? STATUS_FLOW[m.status] : null;
  const pendingComments = ((comments as any[]) || []).filter((c: any) => c.status === 'pending');

  return (
    <div className="flex h-screen bg-[#f5f5f7]">
      <SecretarySidebar />
      <main className="flex-1 ml-64 overflow-hidden flex">
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto p-8 space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-xl font-semibold text-[#1d1d1f]">{m?.meetingTitle || 'Minutes'}</h1>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-[#f5f5f7] text-[#86868b] capitalize">{m?.status}</span>
                  {m?.meetingDate && <span className="text-xs text-[#86868b]">{new Date(m.meetingDate).toLocaleDateString()}</span>}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={handleSave} disabled={isSaving}
                  className="flex items-center gap-1.5 px-4 py-2 bg-[#f5f5f7] text-[#1d1d1f] rounded-xl text-sm font-medium hover:bg-[#ebebed] transition-colors disabled:opacity-50"
                  data-testid="button-save-minutes">
                  <Save size={14} /> {isSaving ? 'Saving...' : 'Save'}
                </button>
                {nextStatusInfo && (
                  <button onClick={handleStatusChange} disabled={updateStatus.isPending}
                    className="flex items-center gap-1.5 px-4 py-2 text-white rounded-xl text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
                    style={{ backgroundColor: nextStatusInfo.color }}
                    data-testid="button-next-status">
                    <Send size={14} /> {nextStatusInfo.label}
                  </button>
                )}
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-[#e5e5e7] p-8">
              <EditorContent
                editor={editor}
                className="prose prose-sm max-w-none min-h-[400px] focus:outline-none [&_.ProseMirror]:min-h-[400px] [&_.ProseMirror]:focus:outline-none"
                data-testid="minutes-editor"
              />
            </div>
          </div>
        </div>

        {/* Comments Sidebar */}
        {pendingComments.length > 0 && (
          <div className="w-72 border-l border-[#e5e5e7] bg-white overflow-y-auto flex-shrink-0">
            <div className="p-4 border-b border-[#e5e5e7]">
              <div className="flex items-center gap-2">
                <MessageSquare size={14} className="text-[#86868b]" />
                <span className="text-sm font-medium text-[#1d1d1f]">{pendingComments.length} Comments</span>
              </div>
            </div>
            <div className="p-4 space-y-4">
              {pendingComments.map((comment: any) => (
                <div key={comment.id} className="text-xs space-y-2" data-testid={`comment-${comment.id}`}>
                  <div className="bg-[#f5f5f7] rounded-lg p-2 text-[#86868b] italic line-clamp-2">
                    "{comment.originalText}"
                  </div>
                  <div className="flex items-start gap-2">
                    <div
                      className="w-5 h-5 rounded-full flex items-center justify-center text-white text-xs flex-shrink-0 mt-0.5"
                      style={{ backgroundColor: comment.color || '#86868b', fontSize: '8px' }}
                    >
                      {comment.person?.name?.charAt(0) || '?'}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-baseline gap-1.5">
                        <span className="font-medium text-[#1d1d1f]">{comment.person?.name || 'Unknown'}</span>
                        <span className="text-[#b0b0b8]" style={{ fontSize: '9px' }}>
                          {comment.createdAt ? new Date(comment.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}
                        </span>
                      </div>
                      <div className="text-[#86868b] mt-0.5">{comment.commentText}</div>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => handleResolveComment(comment.id)}
                      className="flex items-center gap-1 text-[#34c759] hover:underline font-medium"
                      data-testid={`button-resolve-${comment.id}`}
                    >
                      <CheckCircle size={12} /> Resolve
                    </button>
                    <button
                      type="button"
                      onClick={() => resolveComment.mutate({ id, commentId: comment.id, data: { status: 'dismissed' } }, {
                        onSuccess: () => {
                          queryClient.invalidateQueries({ queryKey: getGetMinutesCommentsQueryKey(id) });
                          toast({ title: 'Comment dismissed' });
                        }
                      })}
                      className="flex items-center gap-1 text-[#ff3b30] hover:underline font-medium"
                      data-testid={`button-dismiss-${comment.id}`}
                    >
                      <X size={12} /> Dismiss
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
