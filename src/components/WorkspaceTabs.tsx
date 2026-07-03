import { motion } from 'framer-motion';
import { Sparkles, Building2, TrendingUp, Gamepad2 } from 'lucide-react';
import type { WorkspaceTab } from '@/types';
import { useLanguageStore } from '@/stores/languageStore';

interface WorkspaceTabsProps {
  activeTab: WorkspaceTab;
  onTabChange: (tab: WorkspaceTab) => void;
  /** Owner-only private preview — Trading is hidden for normal users.
   * Passed down from ChatDashboard's shared useOwnerMode() state. */
  showTrading?: boolean;
  /** Game Development is a standalone page (/tools/game-builder), not a
   * chat workspace tab. When provided, a "Game" button renders alongside
   * the tabs and routes to the Game Builder instead of switching tabs —
   * so `game` never has to be forced into the WorkspaceTab union. */
  onGameBuilderClick?: () => void;
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

export default function WorkspaceTabs({ activeTab, onTabChange, showTrading = false, onGameBuilderClick }: WorkspaceTabsProps) {
  const { t } = useLanguageStore();

  // Chat is public. Business + Trading are OWNER-ONLY (private preview) —
  // ChatDashboard passes its useOwnerMode() `isOwner` in as `showTrading`.
  const CHAT_TAB: TabConfig = { key: 'chat', label: t('chat'), icon: Sparkles, shortLabel: t('chat') };
  const OWNER_TABS: TabConfig[] = [
    { key: 'business', label: t('business'), icon: Building2,  shortLabel: t('business') },
    { key: 'trading',  label: t('trading'),  icon: TrendingUp, shortLabel: t('trading') },
  ];

  const tabs = showTrading ? [CHAT_TAB, ...OWNER_TABS] : [CHAT_TAB];
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

      {/* Game — routes to the standalone Game Builder page. Never shows an
          active pill here (it leaves the chat workspace); it uses the same
          inactive/hover styling as the tabs above for visual consistency. */}
      {onGameBuilderClick && (
        <button
          onClick={onGameBuilderClick}
          className="relative flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium transition-all text-[#94A3B8] hover:text-[#CBD5E1]"
        >
          <span className="relative z-10 flex items-center gap-1">
            <Gamepad2 className="h-3 w-3" />
            <span className="hidden sm:inline">{t('navGameBuild')}</span>
            <span className="sm:hidden">{t('navGameBuild')}</span>
          </span>
        </button>
      )}
    </div>
  );
}
