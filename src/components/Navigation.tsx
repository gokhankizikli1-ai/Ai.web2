import { useNavigate, useLocation } from 'react-router';
import { motion } from 'framer-motion';
import {
  MessageSquare, Search, Building2, FolderOpen,
  TrendingUp, Sparkles, Settings, LogIn,
} from 'lucide-react';
import { useApp } from '@/contexts/AppContext';
import { useAuthStore } from '@/stores/authStore';
import CreditDisplay from './CreditDisplay';
import UserMenu from './UserMenu';

/* ═══════════════════════════════════════════
   TYPES
   ═══════════════════════════════════════════ */
interface NavItem {
  id: string;
  label: string;
  icon: typeof MessageSquare;
  path: string;
}

/* ═══════════════════════════════════════════
   NAV DATA — 5 direct tabs, no dropdown
   ═══════════════════════════════════════════ */
const NAV_ITEMS: NavItem[] = [
  { id: 'chat',     label: 'Chat',     icon: MessageSquare, path: '/chat' },
  { id: 'research', label: 'Research', icon: Search,        path: '/chat?tab=research' },
  { id: 'business', label: 'Business', icon: Building2,     path: '/chat?tab=business' },
  { id: 'projects', label: 'Projects', icon: FolderOpen,    path: '/projects' },
  { id: 'trading',  label: 'Trading',  icon: TrendingUp,    path: '/chat?tab=trading' },
];

/* ═══════════════════════════════════════════
   COMPONENT
   ═══════════════════════════════════════════ */
export default function Navigation() {
  const navigate = useNavigate();
  const location = useLocation();
  useApp();
  const { isAuthenticated } = useAuthStore();

  const handleNav = (item: NavItem) => {
    if (item.path.startsWith('/chat?tab=')) {
      const tab = item.path.split('tab=')[1];
      navigate('/chat');
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('korvix-switch-workspace', { detail: tab }));
      }, 100);
    } else {
      navigate(item.path);
    }
  };

  /* ─── Determine active nav item ─── */
  const pathname = location.pathname;
  const search = location.search;

  const getActiveItem = (): string => {
    if (pathname === '/chat') {
      if (search.includes('tab=research')) return 'research';
      if (search.includes('tab=business')) return 'business';
      if (search.includes('tab=trading')) return 'trading';
      return 'chat';
    }
    if (pathname === '/projects' || pathname.startsWith('/projects')) return 'projects';
    return '';
  };

  const activeItem = getActiveItem();

  return (
    <nav className="sticky top-0 z-30 h-9 flex items-center justify-between px-2 sm:px-3 bg-[#11151C]/80 backdrop-blur-md border-b border-white/[0.03]">

      {/* Left — Nav items */}
      <div className="flex items-center gap-0.5">
        {NAV_ITEMS.map((item) => {
          const isActive = activeItem === item.id;

          return (
            <button
              key={item.id}
              onClick={() => handleNav(item)}
              className={`relative flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium transition-all duration-200 ${
                isActive
                  ? 'text-[#E2E8F0]'
                  : 'text-[#94A3B8] hover:text-[#CBD5E1]'
              }`}
            >
              {isActive && (
                <motion.div
                  layoutId="navActive"
                  className="absolute inset-0 bg-white/[0.05] rounded-md border border-white/[0.06]"
                  transition={{ type: 'spring', duration: 0.4, bounce: 0.15 }}
                />
              )}
              <span className="relative z-10 flex items-center gap-1">
                <item.icon className="h-3 w-3" />
                <span className="hidden md:inline">{item.label}</span>
              </span>
            </button>
          );
        })}
      </div>

      {/* Right — Credits + Settings + Auth */}
      <div className="flex items-center gap-1.5 shrink-0">
        <div className="hidden sm:block">
          <CreditDisplay />
        </div>
        <button
          onClick={() => navigate('/settings')}
          className="h-6 w-6 flex items-center justify-center text-[#94A3B8] hover:text-[#3B82F6] hover:bg-[#3B82F6]/[0.06] rounded transition-all border border-transparent hover:border-white/[0.04]"
        >
          <Settings className="h-3 w-3" />
        </button>

        {isAuthenticated ? (
          <UserMenu />
        ) : (
          <>
            <button
              onClick={() => navigate('/login')}
              className="h-6 px-2 flex items-center gap-1 rounded text-[10px] text-[#94A3B8] hover:text-slate-300 hover:bg-white/[0.03] transition-all"
            >
              <LogIn className="h-3 w-3" />
              <span className="hidden md:inline">Sign In</span>
            </button>
            <button
              onClick={() => navigate('/signup')}
              className="h-6 px-2 flex items-center gap-1 rounded bg-white/[0.06] text-[10px] text-white hover:bg-white/[0.1] transition-all"
            >
              <Sparkles className="h-3 w-3" />
              <span className="hidden md:inline">Create</span>
            </button>
          </>
        )}
      </div>
    </nav>
  );
}
