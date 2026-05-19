import { motion } from 'framer-motion';
import {
  Sparkles, Search, Building2, Bot,
  TrendingUp, Rocket,
  ChevronDown,
} from 'lucide-react';
import type { WorkspaceTab } from '@/types';

interface WorkspaceTabsProps {
  activeTab: WorkspaceTab;
  onTabChange: (tab: WorkspaceTab) => void;
}

/* ═══════════════════════════════════════════
   TAB CONFIG — 4 primary + More dropdown
   ═══════════════════════════════════════════ */
interface TabConfig {
  key: WorkspaceTab;
  label: string;
  icon: typeof Sparkles;
  shortLabel?: string;
}

const PRIMARY_TABS: TabConfig[] = [
  { key: 'chat',     label: 'Chat',     icon: Sparkles, shortLabel: 'Chat' },
  { key: 'research', label: 'Research', icon: Search,   shortLabel: 'Research' },
  { key: 'business', label: 'Business', icon: Building2, shortLabel: 'Business' },
  { key: 'agents',   label: 'Agents',   icon: Bot,      shortLabel: 'Agents' },
];

const MORE_TABS: TabConfig[] = [
  { key: 'trading', label: 'Trading', icon: TrendingUp },
  { key: 'startup', label: 'Startup', icon: Rocket },
];

export default function WorkspaceTabs({ activeTab, onTabChange }: WorkspaceTabsProps) {
  const isMoreActive = MORE_TABS.some((t) => t.key === activeTab);

  return (
    <div className="flex items-center gap-0.5 px-1">
      {/* Primary tabs */}
      {PRIMARY_TABS.map((tab) => {
        const active = activeTab === tab.key;
        return (
          <button
            key={tab.key}
            onClick={() => onTabChange(tab.key)}
            className={`relative flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium transition-all ${
              active ? 'text-white' : 'text-slate-600 hover:text-slate-400'
            }`}
          >
            {active && (
              <motion.div
                layoutId="wsTab"
                className="absolute inset-0 bg-white/[0.05] rounded-md border border-white/[0.06]"
                transition={{ type: 'spring', duration: 0.4, bounce: 0.15 }}
              />
            )}
            <span className="relative z-10 flex items-center gap-1">
              <tab.icon className="h-3 w-3" />
              <span className="hidden sm:inline">{tab.label}</span>
              <span className="sm:hidden">{tab.shortLabel || tab.label}</span>
            </span>
          </button>
        );
      })}

      {/* Divider */}
      <div className="w-px h-3.5 bg-white/[0.04] mx-0.5" />

      {/* More dropdown */}
      <div className="relative group">
        <button
          className={`relative flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-all ${
            isMoreActive ? 'text-white' : 'text-slate-600 hover:text-slate-400'
          }`}
        >
          {isMoreActive && (
            <motion.div
              layoutId="wsTabMore"
              className="absolute inset-0 bg-white/[0.05] rounded-md border border-white/[0.06]"
              transition={{ type: 'spring', duration: 0.4, bounce: 0.15 }}
            />
          )}
          <span className="relative z-10 flex items-center gap-1">
            More
            <ChevronDown className="h-2.5 w-2.5" />
          </span>
        </button>

        {/* Dropdown */}
        <div className="absolute top-full right-0 mt-1 w-40 rounded-xl border border-white/[0.06] bg-[#0e0e14] shadow-2xl overflow-hidden z-20 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-150 py-1">
          {MORE_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => onTabChange(tab.key)}
              className={`w-full flex items-center gap-2 px-3 py-2 text-left text-[12px] transition-all ${
                activeTab === tab.key
                  ? 'bg-white/[0.05] text-white'
                  : 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.02]'
              }`}
            >
              <tab.icon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
