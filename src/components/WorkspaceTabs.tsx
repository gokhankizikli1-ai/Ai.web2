import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MessageSquare, Search, Building2, Bot,
  Code2, TrendingUp, Rocket, GraduationCap, Palette,
  ChevronDown,
} from 'lucide-react';
import type { WorkspaceTab } from '@/types';
import { useApp } from '@/contexts/AppContext';

// ─── Tab definitions ───
const PRIMARY_TABS: { id: WorkspaceTab; icon: typeof MessageSquare }[] = [
  { id: 'chat',     icon: MessageSquare },
  { id: 'research', icon: Search },
  { id: 'business', icon: Building2 },
  { id: 'agents',   icon: Bot },
];

const MORE_TABS: { id: WorkspaceTab; icon: typeof MessageSquare }[] = [
  { id: 'coding',   icon: Code2 },
  { id: 'trading',  icon: TrendingUp },
  { id: 'startup',  icon: Rocket },
  { id: 'study',    icon: GraduationCap },
  { id: 'creative', icon: Palette },
];

const TAB_COLORS: Record<WorkspaceTab, string> = {
  chat:     'text-slate-400',
  research: 'text-violet-400/70',
  business: 'text-amber-400/70',
  agents:   'text-indigo-400/70',
  coding:   'text-blue-400/70',
  trading:  'text-emerald-400/70',
  startup:  'text-orange-400/70',
  study:    'text-rose-400/70',
  creative: 'text-pink-400/70',
};

interface WorkspaceTabsProps {
  activeTab: WorkspaceTab;
  onTabChange: (tab: WorkspaceTab) => void;
}

export default function WorkspaceTabs({ activeTab, onTabChange }: WorkspaceTabsProps) {
  const { t } = useApp();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  const isInMore = MORE_TABS.some((t) => t.id === activeTab);

  return (
    <div className="flex items-center gap-0.5">
      {/* Primary tabs — always visible */}
      {PRIMARY_TABS.map((tab) => (
        <TabButton
          key={tab.id}
          id={tab.id}
          icon={tab.icon}
          active={activeTab === tab.id}
          onClick={() => onTabChange(tab.id)}
        />
      ))}

      {/* "More" dropdown for secondary tabs */}
      <div ref={moreRef} className="relative">
        <button
          onClick={() => setMoreOpen(!moreOpen)}
          className={`relative flex items-center gap-1 px-2 py-1.5 rounded-md text-[11px] transition-all duration-200 ${
            isInMore
              ? 'text-white'
              : 'text-slate-600 hover:text-slate-400'
          }`}
        >
          {isInMore && (
            <motion.div
              layoutId="activeTabMore"
              className="absolute inset-0 bg-white/[0.06] rounded-md border border-white/[0.08]"
              transition={{ type: 'spring', duration: 0.4, bounce: 0.1 }}
            />
          )}
          <span className="relative z-10 flex items-center gap-1">
            <span className="hidden md:inline">{t('more')}</span>
            <ChevronDown className={`h-3 w-3 transition-transform duration-200 ${moreOpen ? 'rotate-180' : ''}`} />
          </span>
        </button>

        <AnimatePresence>
          {moreOpen && (
            <motion.div
              initial={{ opacity: 0, y: 4, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 4, scale: 0.98 }}
              transition={{ duration: 0.15 }}
              className="absolute top-full left-0 mt-1.5 w-36 rounded-xl border border-white/[0.06] bg-[#0e0e14] shadow-2xl overflow-hidden z-50 py-1"
            >
              {MORE_TABS.map((tab) => {
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => { onTabChange(tab.id); setMoreOpen(false); }}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 text-left text-[12px] transition-all ${
                      isActive ? 'bg-white/[0.05] text-white' : 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.02]'
                    }`}
                  >
                    <tab.icon className={`h-3.5 w-3.5 ${isActive ? TAB_COLORS[tab.id] : 'text-slate-600'}`} />
                    {t(tab.id)}
                  </button>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ─── Individual tab button ───
function TabButton({ id, icon: Icon, active, onClick }: {
  id: WorkspaceTab;
  icon: typeof MessageSquare;
  active: boolean;
  onClick: () => void;
}) {
  const { t } = useApp();

  return (
    <button
      onClick={onClick}
      className={`relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] transition-all duration-200 ${
        active ? 'text-white' : 'text-slate-600 hover:text-slate-400'
      }`}
    >
      {active && (
        <motion.div
          layoutId="activeTab"
          className="absolute inset-0 bg-white/[0.06] rounded-md border border-white/[0.08] shadow-[0_0_12px_-2px_rgba(255,255,255,0.03)]"
          transition={{ type: 'spring', duration: 0.4, bounce: 0.1 }}
        />
      )}
      <span className="relative z-10 flex items-center gap-1.5">
        <Icon className={`h-3 w-3 ${active ? TAB_COLORS[id] : ''}`} />
        <span className="hidden md:inline">{t(id)}</span>
      </span>
    </button>
  );
}
