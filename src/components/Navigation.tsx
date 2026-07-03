import { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router';
import { motion } from 'framer-motion';
import {
  MessageSquare, Globe, Gamepad2,
  FlaskConical, Rocket, Building2, TrendingUp, Bot,
  Sparkles, Settings, LogIn, Zap,
} from 'lucide-react';
import { useApp } from '@/contexts/AppContext';
import { useAuthStore } from '@/stores/authStore';
import { useOwnerMode } from '@/hooks/useOwnerMode';
import { useLanguageStore } from '@/stores/languageStore';
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
   COMPONENT
   ═══════════════════════════════════════════ */
export default function Navigation() {
  const navigate = useNavigate();
  const location = useLocation();
  useApp();
  const { isAuthenticated } = useAuthStore();
  const { isOwner } = useOwnerMode();
  const { t } = useLanguageStore();

  const [labsOpen, setLabsOpen] = useState(false);
  const labsRef = useRef<HTMLDivElement>(null);

  /* ─── Public center items (ALL users). Projects intentionally NOT here —
        it's the primary item in the left sidebar; duplicating it in the top
        nav was redundant. ─── */
  const NAV_ITEMS: NavItem[] = [
    { id: 'chat',     label: t('navChat'),     icon: MessageSquare, path: '/chat' },
    { id: 'webbuild', label: t('navWebBuild'), icon: Globe,         path: '/tools/website-builder' },
    { id: 'game',     label: t('navGameBuild'),icon: Gamepad2,      path: '/tools/game-builder' },
  ];

  /* ─── Owner-only Labs dropdown items ─── */
  const LABS_ITEMS: NavItem[] = [
    { id: 'startup',  label: t('startup'),  icon: Rocket,     path: '/tools/startup' },
    { id: 'business', label: t('business'), icon: Building2,  path: '/chat?tab=business' },
    { id: 'trading',  label: t('trading'),  icon: TrendingUp, path: '/chat?tab=trading' },
    { id: 'agents',   label: t('agents'),   icon: Bot,        path: '/agents' },
  ];

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

  /* ─── Close Labs dropdown on outside click ─── */
  useEffect(() => {
    if (!labsOpen) return;
    const onClick = (e: MouseEvent) => {
      if (labsRef.current && !labsRef.current.contains(e.target as Node)) {
        setLabsOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [labsOpen]);

  /* ─── Determine active nav item ─── */
  const pathname = location.pathname;

  const getActiveItem = (): string => {
    if (pathname === '/chat') return 'chat';
    if (pathname === '/tools/website-builder') return 'webbuild';
    if (pathname === '/tools/game-builder') return 'game';
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

        {/* Owner-only Labs dropdown */}
        {isOwner && (
          <div ref={labsRef} className="relative">
            <button
              onClick={() => setLabsOpen((o) => !o)}
              className={`relative flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium transition-all duration-200 ${
                labsOpen ? 'text-[#E2E8F0] bg-white/[0.05]' : 'text-[#94A3B8] hover:text-[#CBD5E1]'
              }`}
            >
              <span className="relative z-10 flex items-center gap-1">
                <FlaskConical className="h-3 w-3" />
                <span className="hidden md:inline">{t('navLabs')}</span>
              </span>
            </button>

            {labsOpen && (
              <div className="absolute left-0 top-full mt-1 w-40 py-1 rounded-lg bg-[#151C28] border border-white/[0.06] shadow-xl shadow-black/40 z-40">
                {LABS_ITEMS.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => { setLabsOpen(false); handleNav(item); }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-[#94A3B8] hover:text-[#E2E8F0] hover:bg-white/[0.04] transition-colors"
                  >
                    <item.icon className="h-3 w-3 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Right — Credits + Upgrade + Settings + Auth */}
      <div className="flex items-center gap-1.5 shrink-0">
        <div className="hidden sm:block">
          <CreditDisplay />
        </div>

        <button
          onClick={() => navigate('/credits')}
          className="h-6 px-2 flex items-center gap-1 rounded bg-white/[0.06] text-[10px] text-white hover:bg-white/[0.1] transition-all"
        >
          <Zap className="h-3 w-3" />
          <span className="hidden md:inline">{t('upgrade')}</span>
        </button>

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
              <span className="hidden md:inline">{t('signIn')}</span>
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
