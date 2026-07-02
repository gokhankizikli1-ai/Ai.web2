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
              active ? 'text-[#F8FAFC]' : 'text-[#94A3B8] hover:text-[#CBD5E1]'
            }`}
          >
            {active && (
              <motion.div
                layoutId="wsTab"
                className="absolute inset-0 rounded-md border"
                style={{
                  background: 'rgba(59, 130, 246, 0.12)',
                  borderColor: 'rgba(59, 130, 246, 0.32)',
                  boxShadow: '0 0 0 1px rgba(59, 130, 246,0.05), inset 0 1px 0 rgba(255,255,255,0.04)',
                }}
                transition={{ type: 'spring', duration: 0.4, bounce: 0.15 }}
              />
            )}
            <span className="relative z-10 flex items-center gap-1">
              <tab.icon className={`h-3 w-3 ${active ? 'text-[#60A5FA]' : ''}`} />
              <span className="hidden sm:inline">{tab.label}</span>
              <span className="sm:hidden">{tab.shortLabel || tab.label}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
