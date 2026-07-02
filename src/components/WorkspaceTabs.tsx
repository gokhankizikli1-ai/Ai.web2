import { motion } from 'framer-motion';
import { Sparkles, Building2, TrendingUp } from 'lucide-react';
import type { WorkspaceTab } from '@/types';

interface WorkspaceTabsProps {
  activeTab: WorkspaceTab;
  onTabChange: (tab: WorkspaceTab) => void;
  /** Owner-only private preview — Trading is hidden for normal users.
   * Passed down from ChatDashboard's shared useOwnerMode() state. */
  showTrading?: boolean;
}

/* ═══════════════════════════════════════════
   TAB CONFIG — lean top nav.
   Research is a capability inside Chat now (intent-based web research),
   not a tab. Projects lives in the left sidebar, not here.
   ═══════════════════════════════════════════ */
interface TabConfig {
  key: WorkspaceTab;
  label: string;
  icon: typeof Sparkles;
  shortLabel?: string;
}

const BASE_TABS: TabConfig[] = [
  { key: 'chat',     label: 'Chat',     icon: Sparkles,   shortLabel: 'Chat' },
  { key: 'business', label: 'Business', icon: Building2,  shortLabel: 'Business' },
];

const TRADING_TAB: TabConfig = {
  key: 'trading', label: 'Trading', icon: TrendingUp, shortLabel: 'Trading',
};

export default function WorkspaceTabs({ activeTab, onTabChange, showTrading = false }: WorkspaceTabsProps) {
  const tabs = showTrading ? [...BASE_TABS, TRADING_TAB] : BASE_TABS;
  return (
    <div className="flex items-center gap-0.5 px-1">
      {tabs.map((tab) => {
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
    </div>
  );
}
