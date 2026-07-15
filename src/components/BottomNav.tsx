import { useNavigate, useLocation } from 'react-router';
import { motion } from 'framer-motion';
import {
  MessageSquare, Globe, Gamepad2, FolderOpen,
} from 'lucide-react';
import { useLanguageStore } from '@/stores/languageStore';
import { useOwnerMode } from '@/hooks/useOwnerMode';

interface NavItem {
  id: string;
  label: string;
  icon: typeof MessageSquare;
  path: string;
  /** Phase 14A — an unfinished launch surface: shown to the owner only. */
  ownerOnly?: boolean;
}

export default function BottomNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const pathname = location.pathname;
  const { t } = useLanguageStore();
  const { isOwner } = useOwnerMode();

  // Phase 14A — Game Build is unfinished; hide its mobile tab from normal users.
  const ITEMS: NavItem[] = ([
    { id: 'chat', label: t('navChat'), icon: MessageSquare, path: '/chat' },
    { id: 'webbuild', label: t('navWebBuild'), icon: Globe, path: '/tools/website-builder' },
    { id: 'game', label: t('navGameBuild'), icon: Gamepad2, path: '/tools/game-builder', ownerOnly: true },
    { id: 'projects', label: t('navProjects'), icon: FolderOpen, path: '/projects' },
  ] as NavItem[]).filter((item) => !item.ownerOnly || isOwner);

  // Determine active item based on current route
  const getActiveId = () => {
    if (pathname === '/tools/website-builder') return 'webbuild';
    if (pathname === '/tools/game-builder') return 'game';
    if (pathname === '/projects' || pathname.startsWith('/projects')) return 'projects';
    if (pathname === '/chat' || pathname.startsWith('/chat')) return 'chat';
    return 'chat';
  };

  const activeId = getActiveId();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-[#0a0a0a]/85 backdrop-blur-2xl border-t border-white/[0.03] sm:hidden safe-area-pb">
      <div className="flex items-center justify-around h-16 max-w-lg mx-auto px-2">
        {ITEMS.map((item) => {
          const isActive = activeId === item.id;
          return (
            <button
              key={item.id}
              onClick={() => navigate(item.path)}
              className="relative flex flex-col items-center justify-center gap-1 w-16 h-14 active:scale-95 transition-transform"
            >
              {/* Active indicator */}
              {isActive && (
                <motion.div
                  layoutId="bottomNavActive"
                  className="absolute -top-px left-1/2 -translate-x-1/2 w-6 h-0.5 bg-[#3B82F6] rounded-full"
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                />
              )}
              {/* Subtle glow for active */}
              {isActive && (
                <div className="absolute inset-1 rounded-xl bg-[#3B82F6]/[0.04]" />
              )}
              <item.icon
                className={`w-[18px] h-[18px] transition-colors relative z-10 ${
                  isActive ? 'text-[#3B82F6]' : 'text-[#94A3B8]'
                }`}
              />
              <span
                className={`text-[10px] font-medium transition-colors relative z-10 ${
                  isActive ? 'text-[#3B82F6]' : 'text-[#94A3B8]'
                }`}
              >
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
