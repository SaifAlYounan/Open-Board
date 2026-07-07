import { useState } from 'react';
import { useLocation, Link } from 'wouter';
import { cn } from '@/lib/utils';
import { useAuth, getAvatarInitials } from '@/lib/auth';
import { useOrganization } from '@/hooks/use-organization';
import { useListPendingActions } from '@workspace/api-client-react';
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from '@/components/ui/sheet';
import { AiSearchModal } from '@/components/AiSearchModal';
import {
  LayoutDashboard, Inbox, FileText, Vote, Calendar, CheckSquare,
  File, Users, Settings, LogOut, ShieldCheck, Network, Menu, Search
} from 'lucide-react';

const navItems = [
  { href: '/secretary', icon: LayoutDashboard, label: 'Dashboard', exact: true },
  { href: '/secretary/pending', icon: Inbox, label: 'Pending AI Actions' },
  { href: '/secretary/minutes', icon: FileText, label: 'Minutes' },
  { href: '/secretary/votes', icon: Vote, label: 'Votes' },
  { href: '/secretary/meetings', icon: Calendar, label: 'Meetings' },
  { href: '/secretary/tasks', icon: CheckSquare, label: 'Tasks' },
  { href: '/secretary/documents', icon: File, label: 'Documents' },
  { href: '/secretary/members', icon: Users, label: 'Members' },
  { href: '/secretary/intelligence', icon: Network, label: 'Intelligence' },
  { href: '/secretary/admin', icon: ShieldCheck, label: 'Admin Panel' },
  { href: '/secretary/settings', icon: Settings, label: 'Settings' },
];

/** The nav body, shared by the desktop aside and the mobile drawer. */
function SidebarBody({ orgName, onNavigate, onSearch }: { orgName?: string; onNavigate?: () => void; onSearch: () => void }) {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const { data: pendingActions } = useListPendingActions({ status: 'pending' });
  const pendingCount = Array.isArray(pendingActions) ? pendingActions.length : 0;

  return (
    <div className="flex flex-col h-full">
      <div className="p-6 border-b border-[#e5e5e7]">
        <Link href="/secretary">
          <div className="flex items-center gap-2 cursor-pointer" onClick={onNavigate}>
            <div className="w-8 h-8 bg-[#0071e3] text-white rounded-lg flex items-center justify-center text-sm font-bold">✦</div>
            <div>
              <div className="text-sm font-semibold text-[#1d1d1f] leading-tight">Open Board</div>
              <div className="text-xs text-[#86868b]">{orgName || ' '}</div>
            </div>
          </div>
        </Link>
      </div>

      <div className="px-4 pt-4">
        <button
          onClick={() => { onSearch(); onNavigate?.(); }}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-[#86868b] bg-[#f5f5f7] hover:bg-[#ebebed] transition-colors"
          data-testid="button-open-ai-search"
        >
          <Search size={15} /> Ask the board archive…
        </button>
      </div>

      <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
        {navItems.map(({ href, icon: Icon, label, exact }) => {
          const isActive = exact ? location === href : (location === href || location.startsWith(href + '/'));
          const isPending = href === '/secretary/pending';
          return (
            <Link key={href} href={href}>
              <div
                onClick={onNavigate}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors cursor-pointer',
                  isActive ? 'bg-[#0071e3] text-white' : 'text-[#1d1d1f] hover:bg-[#f5f5f7]'
                )}
                data-testid={`nav-${label.toLowerCase().replace(/\s+/g, '-')}`}
              >
                <Icon size={16} className="flex-shrink-0" />
                <span className="flex-1">{label}</span>
                {isPending && pendingCount > 0 && (
                  <span className={cn('text-xs px-1.5 py-0.5 rounded-full font-semibold', isActive ? 'bg-white text-[#0071e3]' : 'bg-[#ff3b30] text-white')}>
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
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold text-white flex-shrink-0" style={{ backgroundColor: user.avatarColor || '#0071e3' }}>
              {getAvatarInitials(user.name)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-[#1d1d1f] truncate">{user.name}</div>
              <div className="text-xs text-[#86868b] truncate">{user.title || user.role}</div>
            </div>
            <button onClick={logout} className="text-[#86868b] hover:text-[#ff3b30] transition-colors p-1" data-testid="button-logout" aria-label="Sign out">
              <LogOut size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function SecretarySidebar() {
  const { data: org } = useOrganization();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  return (
    <>
      {/* Desktop: fixed sidebar (lg and up) */}
      <aside className="hidden lg:flex w-64 flex-col h-screen bg-white border-r border-[#e5e5e7] fixed left-0 top-0 z-40">
        <SidebarBody orgName={org?.name} onSearch={() => setSearchOpen(true)} />
      </aside>

      {/* Mobile: top bar with hamburger + search (below lg) */}
      <header className="lg:hidden fixed top-0 left-0 right-0 h-14 z-40 bg-white border-b border-[#e5e5e7] flex items-center justify-between px-4">
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <button aria-label="Open menu" className="p-2 -ml-2 text-[#1d1d1f]"><Menu size={20} /></button>
          </SheetTrigger>
          <SheetContent side="left" className="p-0 w-72">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <SidebarBody orgName={org?.name} onNavigate={() => setMobileOpen(false)} onSearch={() => setSearchOpen(true)} />
          </SheetContent>
        </Sheet>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-[#0071e3] text-white rounded-lg flex items-center justify-center text-xs font-bold">✦</div>
          <span className="text-sm font-semibold text-[#1d1d1f]">Open Board</span>
        </div>
        <button aria-label="Search the board archive" onClick={() => setSearchOpen(true)} className="p-2 -mr-2 text-[#1d1d1f]"><Search size={18} /></button>
      </header>

      {searchOpen && <AiSearchModal onClose={() => setSearchOpen(false)} />}
    </>
  );
}
