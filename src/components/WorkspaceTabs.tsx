import { motion } from 'framer-motion';
import {
  Sparkles, Search, Building2, FolderOpen,
  TrendingUp,
} from 'lucide-react';
import type { WorkspaceTab } from '@/types';

interface WorkspaceTabsProps {
  activeTab: WorkspaceTab;
  onTabChange: (tab: WorkspaceTab) => void;
}

/* ═══════════════════════════════════════════
   TAB CONFIG — 5 direct tabs, no dropdown
   ═══════════════════════════════════════════ */
interface TabConfig {
  key: WorkspaceTab;
  label: string;
  icon: typeof Sparkles;
  shortLabel?: string;
}

const TABS: TabConfig[] = [
  { key: 'chat',     label: 'Chat',     icon: Sparkles,   shortLabel: 'Chat' },
  { key: 'research', label: 'Research', icon: Search,     shortLabel: 'Research' },
  { key: 'business', label: 'Business', icon: Building2,  shortLabel: 'Business' },
  { key: 'agents',   label: 'Projects', icon: FolderOpen, shortLabel: 'Projects' },
  { key: 'trading',  label: 'Trading',  icon: TrendingUp, shortLabel: 'Trading' },
];

export default function WorkspaceTabs({ activeTab, onTabChange }: WorkspaceTabsProps) {
  return (
    <div className="flex items-center gap-0.5 px-1">
      {TABS.map((tab) => {
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
