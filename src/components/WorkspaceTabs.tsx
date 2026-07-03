import { motion } from 'framer-motion';
import { Sparkles, Globe, Building2, TrendingUp, Gamepad2 } from 'lucide-react';
import type { WorkspaceTab } from '@/types';
import { useLanguageStore } from '@/stores/languageStore';

interface WorkspaceTabsProps {
  activeTab: WorkspaceTab;
  onTabChange: (tab: WorkspaceTab) => void;
  /** Owner-only private preview — Business + Trading are hidden for normal
   * users. Passed down from ChatDashboard's shared useOwnerMode() state. */
  showTrading?: boolean;
  /** Web Build is a standalone page (/tools/website-builder). Rendered as an
   * MVP nav button that routes there instead of switching chat tabs. */
  onWebBuildClick?: () => void;
  /** Game Build is a standalone page (/tools/game-builder). */
  onGameBuilderClick?: () => void;
}

/* ═══════════════════════════════════════════
   MVP top nav: Chat · Web Build · Game Build · Projects.
   Chat is a real workspace tab; Web Build / Game Build / Projects are
   standalone pages surfaced here so the chat screen exposes the full MVP
   nav. Business / Trading are owner-only chat tabs shown after the MVP set.
   ═══════════════════════════════════════════ */
interface TabConfig {
  key: WorkspaceTab;
  labelKey: string;
  icon: typeof Sparkles;
}

const OWNER_TABS: TabConfig[] = [
  { key: 'business', labelKey: 'business', icon: Building2 },
  { key: 'trading',  labelKey: 'trading',  icon: TrendingUp },
];

export default function WorkspaceTabs({
  activeTab, onTabChange, showTrading = false,
  onWebBuildClick, onGameBuilderClick,
}: WorkspaceTabsProps) {
  const { t } = useLanguageStore();

  const tabClass = (active: boolean) =>
    `relative flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium transition-all ${
      active ? 'text-[#F8FAFC]' : 'text-[#94A3B8] hover:text-[#CBD5E1]'
    }`;

  const activePill = (
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
  );

  return (
    <div className="flex items-center gap-0.5 px-1">
      {/* Chat — the active workspace tab */}
      <button onClick={() => onTabChange('chat')} className={tabClass(activeTab === 'chat')}>
        {activeTab === 'chat' && activePill}
        <span className="relative z-10 flex items-center gap-1">
          <Sparkles className={`h-3 w-3 ${activeTab === 'chat' ? 'text-[#60A5FA]' : ''}`} />
          <span className="hidden sm:inline">{t('navChat')}</span>
        </span>
      </button>

      {/* Web Build — standalone page */}
      {onWebBuildClick && (
        <button onClick={onWebBuildClick} className={tabClass(false)}>
          <span className="relative z-10 flex items-center gap-1">
            <Globe className="h-3 w-3" />
            <span className="hidden sm:inline">{t('navWebBuild')}</span>
          </span>
        </button>
      )}

      {/* Game Build — standalone page */}
      {onGameBuilderClick && (
        <button onClick={onGameBuilderClick} className={tabClass(false)}>
          <span className="relative z-10 flex items-center gap-1">
            <Gamepad2 className="h-3 w-3" />
            <span className="hidden sm:inline">{t('navGameBuild')}</span>
          </span>
        </button>
      )}

      {/* Owner-only chat tabs — after the MVP set */}
      {showTrading && OWNER_TABS.map((tab) => {
        const active = activeTab === tab.key;
        return (
          <button key={tab.key} onClick={() => onTabChange(tab.key)} className={tabClass(active)}>
            {active && activePill}
            <span className="relative z-10 flex items-center gap-1">
              <tab.icon className={`h-3 w-3 ${active ? 'text-[#60A5FA]' : ''}`} />
              <span className="hidden sm:inline">{t(tab.labelKey)}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
