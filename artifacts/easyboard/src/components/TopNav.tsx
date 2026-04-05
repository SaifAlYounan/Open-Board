import { useState } from 'react';
import { useLocation, Link } from 'wouter';
import { useAuth, getAvatarInitials } from '@/lib/auth';
import { useListBoards, useGetAiStatus } from '@workspace/api-client-react';
import { LogOut, ChevronDown, Sparkles } from 'lucide-react';
import { AiSearchModal } from './AiSearchModal';
import { cn } from '@/lib/utils';

interface TopNavProps {
  showBoardSelector?: boolean;
}

export function TopNav({ showBoardSelector = true }: TopNavProps) {
  const { user, logout } = useAuth();
  const [showSearch, setShowSearch] = useState(false);
  const [boardDropdown, setBoardDropdown] = useState(false);
  const [, setLocation] = useLocation();
  const { data: boards } = useListBoards();
  const { data: aiStatus } = useGetAiStatus();

  const handleBoardSelect = (boardId: string) => {
    if (user?.role === 'member') setLocation(`/board/room/${boardId}`);
    else if (user?.role === 'management') setLocation(`/management`);
    else if (user?.role === 'observer') setLocation(`/observer/room/${boardId}`);
    setBoardDropdown(false);
  };

  return (
    <>
      <header className="h-14 bg-white border-b border-[#e5e5e7] flex items-center gap-4 px-6 fixed top-0 left-0 right-0 z-30">
        <Link href={user?.role === 'member' ? '/board' : user?.role === 'management' ? '/management' : '/observer'}>
          <div className="flex items-center gap-2 cursor-pointer flex-shrink-0">
            <div className="w-7 h-7 bg-[#0071e3] text-white rounded-lg flex items-center justify-center text-xs font-bold">✦</div>
            <span className="text-sm font-semibold text-[#1d1d1f]">EasyBoard</span>
          </div>
        </Link>

        {showBoardSelector && boards && Array.isArray(boards) && boards.length > 0 && (
          <div className="relative">
            <button
              onClick={() => setBoardDropdown(!boardDropdown)}
              className="flex items-center gap-1.5 text-sm text-[#1d1d1f] hover:text-[#0071e3] transition-colors font-medium px-2 py-1 rounded-lg hover:bg-[#f5f5f7]"
            >
              Boards <ChevronDown size={14} />
            </button>
            {boardDropdown && (
              <div className="absolute top-full left-0 mt-1 bg-white border border-[#e5e5e7] rounded-xl shadow-lg z-50 min-w-[220px] py-1">
                {(boards as any[]).map((board: any) => (
                  <button
                    key={board.id}
                    onClick={() => handleBoardSelect(board.id)}
                    className="w-full text-left px-4 py-2.5 text-sm text-[#1d1d1f] hover:bg-[#f5f5f7] transition-colors"
                  >
                    <div className="font-medium">{board.name}</div>
                    <div className="text-xs text-[#86868b]">{board.memberCount} members</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex-1 max-w-xl">
          <button
            onClick={() => setShowSearch(true)}
            className="w-full flex items-center gap-2 px-3 py-2 bg-[#f5f5f7] rounded-xl text-sm text-[#86868b] hover:bg-[#ebebed] transition-colors"
            data-testid="button-ai-search"
          >
            <Sparkles size={14} className="text-[#0071e3]" />
            Ask anything about past meetings, votes, documents...
          </button>
        </div>

        <div className="flex items-center gap-3 ml-auto">
          {user && (
            <div className="flex items-center gap-2">
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold text-white"
                style={{ backgroundColor: user.avatarColor || '#0071e3' }}
              >
                {getAvatarInitials(user.name)}
              </div>
              <div className="hidden sm:block">
                <div className="text-xs font-medium text-[#1d1d1f]">{user.name}</div>
                <div className="text-xs text-[#86868b]">{user.title || user.role}</div>
              </div>
            </div>
          )}
          <button
            onClick={logout}
            className="text-[#86868b] hover:text-[#ff3b30] transition-colors p-1"
            data-testid="button-logout"
          >
            <LogOut size={16} />
          </button>
        </div>
      </header>

      {showSearch && (
        <AiSearchModal onClose={() => setShowSearch(false)} />
      )}
    </>
  );
}
