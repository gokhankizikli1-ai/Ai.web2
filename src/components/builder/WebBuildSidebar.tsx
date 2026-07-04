import { useNavigate } from 'react-router';
import { ArrowLeft, Plus, Monitor } from 'lucide-react';
import { useLanguageStore } from '@/stores/languageStore';
import { listWebBuildSessions } from '@/lib/webBuildSession';

/**
 * The Web Build left rail — a Chat-sidebar-style column scoped to Web Build:
 * Back to Chat, New Build, and the current user's Web Build session history
 * (titled from the prompt). Sessions come from the per-user webBuildSession
 * store, so one account never sees another's builds. Desktop only; on mobile the
 * page falls back to the compact top "New Build" button.
 */
const ACCENT = '#60A5FA';

export default function WebBuildSidebar({
  activeSessionId, onNewBuild, onOpenSession,
}: {
  activeSessionId?: string;
  onNewBuild: () => void;
  onOpenSession: (id: string) => void;
}) {
  const { t } = useLanguageStore();
  const navigate = useNavigate();
  const sessions = listWebBuildSessions();

  return (
    <aside className="sticky top-4 hidden w-56 shrink-0 self-start flex-col gap-2 border-r border-white/[0.06] pr-5 lg:flex">
      <button
        onClick={() => navigate('/chat')}
        className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-[12.5px] text-[#94A3B8] transition-colors hover:bg-white/[0.04] hover:text-white"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> {t('wbBackToChat')}
      </button>

      <button
        onClick={onNewBuild}
        className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.02] px-2.5 py-2 text-[12.5px] font-medium text-slate-100 transition-colors hover:border-white/[0.16] hover:bg-white/[0.05]"
      >
        <Plus className="h-3.5 w-3.5" style={{ color: ACCENT }} /> {t('wbNewBuild')}
      </button>

      <div className="mt-3 px-1 text-[10.5px] font-medium uppercase tracking-wide text-[#64748B]">
        {t('wbBuildsHistory')}
      </div>

      <div className="flex flex-col gap-0.5 overflow-y-auto scrollbar-thin">
        {sessions.length === 0 ? (
          <p className="px-2.5 py-2 text-[12px] text-[#64748B]">{t('wbNoBuilds')}</p>
        ) : (
          sessions.map((s) => {
            const active = s.id === activeSessionId;
            return (
              <button
                key={s.id}
                onClick={() => onOpenSession(s.id)}
                className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12.5px] transition-colors ${active ? 'bg-white/[0.06] text-white' : 'text-[#CBD5E1] hover:bg-white/[0.03]'}`}
              >
                <Monitor className="h-3.5 w-3.5 shrink-0" style={{ color: active ? ACCENT : '#64748B' }} />
                <span className="truncate">{s.title || t('wbNewBuild')}</span>
              </button>
            );
          })
        )}
      </div>
    </aside>
  );
}
