import { useLocation, Link } from 'wouter';
import { cn } from '@/lib/utils';
import { useAuth, getAvatarInitials } from '@/lib/auth';
import { useListPendingActions } from '@workspace/api-client-react';
import {
  Inbox, FileText, Vote, Calendar, CheckSquare,
  File, Users, Settings, LogOut, ShieldCheck
} from 'lucide-react';

const navItems = [
  { href: '/secretary/pending', icon: Inbox, label: 'Pending AI Actions' },
  { href: '/secretary/minutes', icon: FileText, label: 'Minutes' },
  { href: '/secretary/votes', icon: Vote, label: 'Votes' },
  { href: '/secretary/meetings', icon: Calendar, label: 'Meetings' },
  { href: '/secretary/tasks', icon: CheckSquare, label: 'Tasks' },
  { href: '/secretary/documents', icon: File, label: 'Documents' },
  { href: '/secretary/members', icon: Users, label: 'Members' },
  { href: '/secretary/admin', icon: ShieldCheck, label: 'Admin Panel' },
  { href: '/secretary/settings', icon: Settings, label: 'Settings' },
];

export function SecretarySidebar() {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const { data: pendingActions } = useListPendingActions({ status: 'pending' });
  const pendingCount = Array.isArray(pendingActions) ? pendingActions.length : 0;

  return (
    <aside className="w-64 flex flex-col h-screen bg-white border-r border-[#e5e5e7] fixed left-0 top-0 z-40">
      <div className="p-6 border-b border-[#e5e5e7]">
        <Link href="/secretary">
          <div className="flex items-center gap-2 cursor-pointer">
            <div className="w-8 h-8 bg-[#0071e3] text-white rounded-lg flex items-center justify-center text-sm font-bold">
              ✦
            </div>
            <div>
              <div className="text-sm font-semibold text-[#1d1d1f] leading-tight">EasyBoard v2</div>
              <div className="text-xs text-[#86868b]">Meridian Energy Group</div>
            </div>
          </div>
        </Link>
      </div>

      <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
        {navItems.map(({ href, icon: Icon, label }) => {
          const isActive = location === href || location.startsWith(href + '/');
          const isPending = href === '/secretary/pending';

          return (
            <Link key={href} href={href}>
              <div
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors cursor-pointer',
                  isActive
                    ? 'bg-[#0071e3] text-white'
                    : 'text-[#1d1d1f] hover:bg-[#f5f5f7]'
                )}
                data-testid={`nav-${label.toLowerCase().replace(/\s+/g, '-')}`}
              >
                <Icon size={16} className="flex-shrink-0" />
                <span className="flex-1">{label}</span>
                {isPending && pendingCount > 0 && (
                  <span className={cn(
                    'text-xs px-1.5 py-0.5 rounded-full font-semibold',
                    isActive ? 'bg-white text-[#0071e3]' : 'bg-[#ff3b30] text-white'
                  )}>
                    {pendingCount}
                  </span>
                )}
              </div>
            </Link>
          );
        })}
      </nav>

      {user && (
        <div className="p-4 border-t border-[#e5e5e7]">
          <div className="flex items-center gap-3 px-3 py-2">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold text-white flex-shrink-0"
              style={{ backgroundColor: user.avatarColor || '#0071e3' }}
            >
              {getAvatarInitials(user.name)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-[#1d1d1f] truncate">{user.name}</div>
              <div className="text-xs text-[#86868b] truncate">{user.title || user.role}</div>
            </div>
            <button
              onClick={logout}
              className="text-[#86868b] hover:text-[#ff3b30] transition-colors p-1"
              data-testid="button-logout"
            >
              <LogOut size={14} />
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}
