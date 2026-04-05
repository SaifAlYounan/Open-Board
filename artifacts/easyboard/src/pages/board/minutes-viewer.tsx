import { useState, useEffect, useMemo } from 'react';
import { useParams, useLocation } from 'wouter';
import { TopNav } from '@/components/TopNav';
import { useAuth } from '@/lib/auth';
import {
  useGetMinutes, useGetMinutesComments, useAddMinutesComment,
  getGetMinutesQueryKey, getGetMinutesCommentsQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { MessageSquare, PenLine, CheckCircle } from 'lucide-react';

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

export default function MinutesViewer() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const { data: minutes, isLoading } = useGetMinutes(id, { query: { queryKey: getGetMinutesQueryKey(id) } });
  const { data: comments } = useGetMinutesComments(id, { query: { queryKey: getGetMinutesCommentsQueryKey(id), refetchInterval: 10000 } });
  const addComment = useAddMinutesComment();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [commentDraft, setCommentDraft] = useState<{ text: string; selected: string } | null>(null);
  const [hoveredBlock, setHoveredBlock] = useState<number | null>(null);

  const m = minutes as any;

  const blocks = useMemo(() => parseContentBlocks(m?.content || ''), [m?.content]);

  const handleAddComment = () => {
    if (!commentDraft?.selected || !commentDraft?.text) return;
    addComment.mutate({
      id,
      data: { originalText: commentDraft.selected, commentText: commentDraft.text }
    }, {
      onSuccess: () => {
        toast({ title: 'Comment added' });
        queryClient.invalidateQueries({ queryKey: getGetMinutesCommentsQueryKey(id) });
        setCommentDraft(null);
      }
    });
  };

  const handleParagraphComment = (text: string) => {
    setCommentDraft({ text: '', selected: text.slice(0, 200) });
  };

  const handleSelection = () => {
    const sel = window.getSelection();
    if (sel && sel.toString().trim().length > 3) {
      setCommentDraft({ text: '', selected: sel.toString().trim() });
    }
  };

  const pendingComments = ((comments as any[]) || []).filter((c: any) => c.status === 'pending');
  const STATUS_COLOR: Record<string, string> = {
    draft: '#86868b', review: '#ff9500', signing: '#0071e3', signed: '#34c759'
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

            <div className="bg-white rounded-2xl border border-[#e5e5e7] p-8" onMouseUp={handleSelection} data-testid="minutes-content">
              {blocks.length > 0 ? (
                <div className="prose prose-sm max-w-none space-y-1">
                  {blocks.map((block, i) => (
                    <div
                      key={i}
                      className="group relative flex items-start gap-1"
                      onMouseEnter={() => setHoveredBlock(i)}
                      onMouseLeave={() => setHoveredBlock(null)}
                    >
                      <div
                        className="flex-1 min-w-0"
                        dangerouslySetInnerHTML={{ __html: block.html }}
                      />
                      {block.type === 'paragraph' && block.text.length > 5 && (
                        <button
                          data-testid={`paragraph-comment-btn-${i}`}
                          onClick={() => handleParagraphComment(block.text)}
                          className={`flex-shrink-0 p-1 rounded text-[#86868b] hover:text-[#0071e3] hover:bg-[#0071e3]/10 transition-all mt-0.5 ${hoveredBlock === i ? 'opacity-100' : 'opacity-0'}`}
                          title="Comment on this paragraph"
                        >
                          <MessageSquare size={13} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-[#86868b] italic">No content available.</div>
              )}
            </div>

            {commentDraft && (
              <div className="mt-4 bg-white rounded-2xl border border-[#e5e5e7] p-4 space-y-3">
                <div className="text-xs text-[#86868b] italic">"{commentDraft.selected}"</div>
                <textarea
                  value={commentDraft.text}
                  onChange={(e) => setCommentDraft({ ...commentDraft, text: e.target.value })}
                  placeholder="Add your comment..."
                  rows={3}
                  className="w-full px-3 py-2 bg-[#f5f5f7] rounded-xl text-sm border-0 focus:outline-none focus:ring-2 focus:ring-[#0071e3]/30 resize-none"
                  data-testid="input-comment"
                />
                <div className="flex gap-2">
                  <button onClick={handleAddComment} disabled={addComment.isPending}
                    className="px-4 py-2 bg-[#0071e3] text-white rounded-xl text-sm font-medium disabled:opacity-50"
                    data-testid="button-submit-comment">
                    Add Comment
                  </button>
                  <button onClick={() => setCommentDraft(null)}
                    className="px-4 py-2 bg-[#f5f5f7] text-[#1d1d1f] rounded-xl text-sm font-medium">
                    Cancel
                  </button>
                </div>
              </div>
            )}
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
                      <div className="text-[#86868b] font-mono truncate" title={sig.signatureHash}>
                        {sig.signatureHash?.slice(0, 12)}...
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
                <span className="text-xs font-medium text-[#86868b] uppercase tracking-wide">Comments</span>
              </div>
              <div className="space-y-4">
                {pendingComments.map((comment: any) => (
                  <div key={comment.id} className="text-xs space-y-1.5" data-testid={`comment-${comment.id}`}>
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
                      <div>
                        <div className="font-medium text-[#1d1d1f]">{comment.person?.name}</div>
                        <div className="text-[#86868b] mt-0.5">{comment.commentText}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
