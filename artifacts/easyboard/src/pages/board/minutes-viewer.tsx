import { useState, useMemo } from 'react';
import DOMPurify from 'dompurify';
import { useParams, useLocation } from 'wouter';
import { TopNav } from '@/components/TopNav';
import { useAuth } from '@/lib/auth';
import {
  useGetMinutes, useGetMinutesComments, useAddMinutesComment, useResolveMinutesComment,
  getGetMinutesQueryKey, getGetMinutesCommentsQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { MessageSquare, PenLine, CheckCircle, X } from 'lucide-react';

interface ParsedBlock {
  type: 'paragraph' | 'heading' | 'other';
  html: string;
  text: string;
  tag: string;
}

function parseContentBlocks(html: string): ParsedBlock[] {
  if (!html) return [];
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const blocks: ParsedBlock[] = [];
  doc.body.childNodes.forEach((node) => {
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    const text = el.textContent?.trim() || '';
    if (!text) return;
    const type: ParsedBlock['type'] =
      tag === 'p' ? 'paragraph'
      : /^h[1-6]$/.test(tag) ? 'heading'
      : 'other';
    blocks.push({ type, html: el.outerHTML, tag, text });
  });
  return blocks;
}

const STATUS_COLOR: Record<string, string> = {
  draft: '#86868b', review: '#ff9500', signing: '#0071e3', signed: '#34c759'
};

export default function MinutesViewer() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const { data: minutes, isLoading } = useGetMinutes(id, { query: { queryKey: getGetMinutesQueryKey(id) } });
  const { data: comments } = useGetMinutesComments(id, { query: { queryKey: getGetMinutesCommentsQueryKey(id), refetchInterval: 10000 } });
  const addComment = useAddMinutesComment();
  const resolveComment = useResolveMinutesComment();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [activeBlock, setActiveBlock] = useState<{ index: number; text: string } | null>(null);
  const [commentText, setCommentText] = useState('');

  const m = minutes as any;
  const isAdmin = user?.role === 'admin';

  const blocks = useMemo(() => parseContentBlocks(m?.content || ''), [m?.content]);

  const allComments = (comments as any[]) || [];
  const pendingComments = allComments.filter((c: any) => c.status === 'pending');

  const commentsByParagraph = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const c of pendingComments) {
      const key = c.originalText || '';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(c);
    }
    return map;
  }, [pendingComments]);

  const handleSubmitComment = () => {
    if (!activeBlock || !commentText.trim()) return;
    addComment.mutate({
      id,
      data: { originalText: activeBlock.text, commentText: commentText.trim() }
    }, {
      onSuccess: () => {
        toast({ title: 'Comment added' });
        queryClient.invalidateQueries({ queryKey: getGetMinutesCommentsQueryKey(id) });
        setActiveBlock(null);
        setCommentText('');
      },
      onError: () => {
        toast({ title: 'Failed to add comment', variant: 'destructive' });
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

  const handleDismissComment = (commentId: string) => {
    resolveComment.mutate({ id, commentId, data: { status: 'dismissed' as any } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetMinutesCommentsQueryKey(id) });
        toast({ title: 'Comment dismissed' });
      }
    });
  };

  if (isLoading) return (
    <div className="min-h-screen bg-[#f5f5f7]">
      <TopNav />
      <div className="pt-20 flex items-center justify-center py-16 text-[#86868b] text-sm">Loading minutes...</div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#f5f5f7]">
      <TopNav />
      <main className="pt-20 flex" style={{ height: 'calc(100vh - 56px)' }}>
        {/* Main content */}
        <div className="flex-1 overflow-y-auto p-8">
          <div className="max-w-2xl mx-auto">
            <div className="flex items-start justify-between mb-6">
              <div>
                <h1 className="text-xl font-semibold text-[#1d1d1f]">{m?.meetingTitle || 'Board Minutes'}</h1>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium capitalize"
                    style={{ backgroundColor: (STATUS_COLOR[m?.status] || '#86868b') + '20', color: STATUS_COLOR[m?.status] || '#86868b' }}>
                    {m?.status}
                  </span>
                  {m?.meetingDate && <span className="text-xs text-[#86868b]">{new Date(m.meetingDate).toLocaleDateString()}</span>}
                </div>
              </div>
              {m?.status === 'signing' && !m?.hasSigned && (
                <button
                  onClick={() => setLocation(`/board/minutes/${id}/sign`)}
                  className="flex items-center gap-2 px-4 py-2 bg-[#0071e3] text-white rounded-xl text-sm font-medium hover:bg-[#0077ed] transition-colors"
                  data-testid="button-sign-minutes"
                >
                  <PenLine size={14} /> Sign Minutes
                </button>
              )}
            </div>

            <div className="bg-white rounded-2xl border border-[#e5e5e7] p-8" data-testid="minutes-content">
              {blocks.length > 0 ? (
                <div className="prose prose-sm max-w-none space-y-1">
                  {blocks.map((block, i) => (
                    <div key={i} className="group">
                      <div className="relative flex items-start gap-1">
                        <div
                          className="flex-1 min-w-0"
                          dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(block.html) }}
                        />
                        {block.type === 'paragraph' && block.text.length > 5 && (
                          <button
                            type="button"
                            data-testid={`paragraph-comment-btn-${i}`}
                            onClick={() => {
                              if (activeBlock?.index === i) {
                                setActiveBlock(null);
                                setCommentText('');
                              } else {
                                setActiveBlock({ index: i, text: block.text });
                                setCommentText('');
                              }
                            }}
                            className={`flex-shrink-0 flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors mt-1 whitespace-nowrap ${
                              activeBlock?.index === i
                                ? 'bg-[#0071e3]/10 text-[#0071e3]'
                                : 'bg-[#f5f5f7] text-[#86868b] hover:bg-[#0071e3]/10 hover:text-[#0071e3]'
                            }`}
                          >
                            💬 Comment
                          </button>
                        )}
                      </div>

                      {activeBlock?.index === i && (
                        <div className="mt-2 mb-2 ml-0 bg-[#f5f5f7] rounded-xl border border-[#e5e5e7] p-3 space-y-2" data-testid="inline-comment-form">
                          <textarea
                            autoFocus
                            value={commentText}
                            onChange={(e) => setCommentText(e.target.value)}
                            placeholder="Add your comment..."
                            rows={2}
                            className="w-full px-3 py-2 bg-white rounded-lg text-sm border border-[#e5e5e7] focus:outline-none focus:ring-2 focus:ring-[#0071e3]/30 resize-none"
                            data-testid="input-comment"
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmitComment();
                              if (e.key === 'Escape') { setActiveBlock(null); setCommentText(''); }
                            }}
                          />
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={handleSubmitComment}
                              disabled={addComment.isPending || !commentText.trim()}
                              className="px-3 py-1.5 bg-[#0071e3] text-white rounded-lg text-xs font-medium disabled:opacity-50 hover:bg-[#0077ed] transition-colors"
                              data-testid="button-submit-comment"
                            >
                              {addComment.isPending ? 'Adding...' : 'Add Comment'}
                            </button>
                            <button
                              type="button"
                              onClick={() => { setActiveBlock(null); setCommentText(''); }}
                              className="px-3 py-1.5 bg-white border border-[#e5e5e7] text-[#1d1d1f] rounded-lg text-xs font-medium hover:bg-[#f5f5f7] transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-[#86868b] italic">No content available.</div>
              )}
            </div>
          </div>
        </div>

        {/* Signatures + Comments sidebar */}
        <div className="w-72 border-l border-[#e5e5e7] bg-white overflow-y-auto flex-shrink-0">
          {/* Signatures */}
          {m?.signatures?.length > 0 && (
            <div className="p-4 border-b border-[#e5e5e7]">
              <div className="text-xs font-medium text-[#86868b] uppercase tracking-wide mb-3">Signatures</div>
              <div className="space-y-2">
                {m.signatures.map((sig: any) => (
                  <div key={sig.id} className="flex items-center gap-2 text-xs">
                    <CheckCircle size={14} className="text-[#34c759]" />
                    <div>
                      <div className="font-medium text-[#1d1d1f]">{sig.person?.name}</div>
                      <div className="text-[#86868b] font-mono truncate" title={sig.signature || sig.signatureHash || ''}>
                        {sig.signature
                          ? `${sig.algorithm || 'Ed25519'}: ${sig.signature.slice(0, 12)}…`
                          : (sig.signatureHash ? `${sig.signatureHash.slice(0, 12)}… (legacy)` : 'legacy')}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Comments */}
          {pendingComments.length > 0 && (
            <div className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <MessageSquare size={14} className="text-[#86868b]" />
                <span className="text-xs font-medium text-[#86868b] uppercase tracking-wide">
                  Comments ({pendingComments.length})
                </span>
              </div>
              <div className="space-y-4">
                {Array.from(commentsByParagraph.entries()).map(([paragraphText, paragraphComments]) => (
                  <div key={paragraphText} className="space-y-2">
                    <div className="text-xs bg-[#f5f5f7] rounded-lg px-2 py-1.5 text-[#86868b] italic line-clamp-2">
                      "{paragraphText}"
                    </div>
                    {paragraphComments.map((comment: any) => (
                      <div key={comment.id} className="text-xs space-y-1" data-testid={`comment-${comment.id}`}>
                        <div className="flex items-start gap-2">
                          <div
                            className="w-5 h-5 rounded-full flex items-center justify-center text-white flex-shrink-0 mt-0.5"
                            style={{ backgroundColor: comment.color || '#86868b', fontSize: '8px' }}
                          >
                            {comment.person?.name?.charAt(0) || '?'}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-baseline gap-1.5">
                              <span className="font-medium text-[#1d1d1f]">{comment.person?.name}</span>
                              <span className="text-[#b0b0b8]" style={{ fontSize: '9px' }}>
                                {comment.createdAt ? new Date(comment.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}
                              </span>
                            </div>
                            <div className="text-[#86868b] mt-0.5 break-words">{comment.commentText}</div>
                          </div>
                        </div>
                        {isAdmin && (
                          <div className="flex gap-2 pl-7">
                            <button
                              type="button"
                              onClick={() => handleResolveComment(comment.id)}
                              className="flex items-center gap-1 text-[10px] text-[#34c759] hover:underline font-medium"
                              data-testid={`button-resolve-${comment.id}`}
                            >
                              <CheckCircle size={10} /> Resolve
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDismissComment(comment.id)}
                              className="flex items-center gap-1 text-[10px] text-[#ff3b30] hover:underline font-medium"
                              data-testid={`button-dismiss-${comment.id}`}
                            >
                              <X size={10} /> Dismiss
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}

          {pendingComments.length === 0 && (
            <div className="p-4 text-xs text-[#86868b] text-center pt-8">No pending comments</div>
          )}
        </div>
      </main>
    </div>
  );
}
