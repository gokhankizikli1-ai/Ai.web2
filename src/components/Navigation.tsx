import { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MessageSquare, Search, Building2, Bot,
  ChevronDown, Sparkles, Settings, LogIn,
  LayoutGrid, Wrench, Compass,
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
  icon: typeof MessageSquare | null;
  path?: string;
  isDropdown?: boolean;
}

interface DropdownItem {
  id: string;
  label: string;
  icon: typeof MessageSquare;
  path: string;
}

/* ═══════════════════════════════════════════
   NAV DATA — 4 primary + More dropdown
   ═══════════════════════════════════════════ */
const NAV_ITEMS: NavItem[] = [
  { id: 'chat',     label: 'Chat',     icon: MessageSquare, path: '/chat' },
  { id: 'research', label: 'Research', icon: Search,        path: '/chat?tab=research' },
  { id: 'business', label: 'Business', icon: Building2,     path: '/chat?tab=business' },
  { id: 'agents',   label: 'Agents',   icon: Bot,           path: '/agents' },
  { id: 'more',     label: 'More',     icon: null,          isDropdown: true },
];

const DROPDOWN_ITEMS: DropdownItem[] = [
  { id: 'workspace', label: 'Workspace', icon: LayoutGrid, path: '/workspace' },
  { id: 'tools',     label: 'Tools',     icon: Wrench,     path: '/tools' },
  { id: 'explore',   label: 'Explore',   icon: Compass,    path: '/explore' },
];

/* ═══════════════════════════════════════════
   COMPONENT
   ═══════════════════════════════════════════ */
export default function Navigation() {
  const navigate = useNavigate();
  const location = useLocation();
  useApp();
  const { isAuthenticated } = useAuthStore();
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on click outside
  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setActiveDropdown(null);
      }
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  // Close dropdown on route change
  useEffect(() => {
    setActiveDropdown(null);
  }, [location.pathname]);

  const handleNav = (item: NavItem) => {
    if (item.isDropdown) {
      setActiveDropdown(activeDropdown === 'more' ? null : 'more');
      return;
    }
    if (item.path) {
      if (item.path.startsWith('/chat?tab=')) {
        const tab = item.path.split('tab=')[1];
        navigate('/chat');
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('korvix-switch-workspace', { detail: tab }));
        }, 100);
      } else {
        navigate(item.path);
      }
    }
  };

  /* ─── Determine active nav item ─── */
  const pathname = location.pathname;
  const search = location.search;

  const getActiveItem = (): string => {
    if (pathname === '/chat') {
      if (search.includes('tab=research')) return 'research';
      if (search.includes('tab=business')) return 'business';
      return 'chat';
    }
    if (pathname === '/agents') return 'agents';
    if (pathname === '/workspace') return 'more';
    if (pathname === '/tools' || pathname.startsWith('/tools/')) return 'more';
    if (pathname === '/explore') return 'more';
    return '';
  };

  const activeItem = getActiveItem();
  const isInMore = activeItem === 'more';

  return (
    <nav className="sticky top-0 z-30 h-9 flex items-center justify-between px-2 sm:px-3 bg-[#0a0a0a]/80 backdrop-blur-md border-b border-white/[0.03]">

      {/* Left — Nav items */}
      <div className="flex items-center gap-0.5">
        {NAV_ITEMS.map((item) => {
          const isActive = !item.isDropdown && activeItem === item.id;
          const isMoreActive = item.isDropdown && isInMore;

          return (
            <div key={item.id} ref={item.isDropdown ? dropdownRef : undefined} className="relative">
              <button
                onClick={() => handleNav(item)}
                className={`relative flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium transition-all duration-200 ${
                  isActive || isMoreActive
                    ? 'text-white'
                    : 'text-slate-600 hover:text-slate-400'
                }`}
              >
                {(isActive || isMoreActive) && (
                  <motion.div
                    layoutId="navActive"
                    className="absolute inset-0 bg-white/[0.05] rounded-md border border-white/[0.06]"
                    transition={{ type: 'spring', duration: 0.4, bounce: 0.15 }}
                  />
                )}
                <span className="relative z-10 flex items-center gap-1">
                  {item.icon && <item.icon className="h-3 w-3" />}
                  <span className="hidden md:inline">{item.label}</span>
                  {item.isDropdown && (
                    <ChevronDown className={`h-2.5 w-2.5 transition-transform ${activeDropdown === 'more' ? 'rotate-180' : ''}`} />
                  )}
                </span>
              </button>

              {/* Dropdown */}
              <AnimatePresence>
                {item.isDropdown && activeDropdown === 'more' && (
                  <motion.div
                    initial={{ opacity: 0, y: 4, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 4, scale: 0.97 }}
                    transition={{ duration: 0.15 }}
                    className="absolute top-full left-0 mt-1.5 w-44 rounded-xl border border-white/[0.06] bg-[#0e0e14] shadow-2xl overflow-hidden z-50 py-1"
                  >
                    {DROPDOWN_ITEMS.map((d) => (
                      <button
                        key={d.id}
                        onClick={() => { navigate(d.path); setActiveDropdown(null); }}
                        className={`w-full flex items-center gap-2.5 px-3 py-2 text-left text-[12px] transition-all ${
                          pathname === d.path || pathname.startsWith(d.path + '/')
                            ? 'bg-white/[0.05] text-white'
                            : 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.02]'
                        }`}
                      >
                        <d.icon className="h-3.5 w-3.5" />
                        {d.label}
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
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
          className="h-6 w-6 flex items-center justify-center text-slate-600 hover:text-amber-400 hover:bg-amber-500/[0.06] rounded transition-all border border-transparent hover:border-white/[0.04]"
        >
          <Settings className="h-3 w-3" />
        </button>

        {isAuthenticated ? (
          <UserMenu />
        ) : (
          <>
            <button
              onClick={() => navigate('/login')}
              className="h-6 px-2 flex items-center gap-1 rounded text-[10px] text-slate-600 hover:text-slate-300 hover:bg-white/[0.03] transition-all"
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
