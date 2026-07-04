import { useNavigate } from 'react-router';
import { ArrowLeft, Plus, Monitor } from 'lucide-react';
import { useLanguageStore } from '@/stores/languageStore';
import { listWebBuildSessions } from '@/lib/webBuildSession';

/**
 * The Web Build left rail — styled to match the normal Chat sidebar: a docked
 * left panel with a Back-to-Chat link, a New Build button (same treatment as
 * New Chat), and the current user's Web Build history as chat-style rows with a
 * selected state. Sessions come from the per-user webBuildSession store, so one
 * account never sees another's builds. Desktop only; mobile uses the compact
 * top "New Build" button.
 */
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
    <aside className="sticky top-4 hidden w-56 shrink-0 self-start flex-col gap-2.5 rounded-xl border border-white/[0.05] bg-white/[0.02] p-2.5 lg:flex">
      {/* Back to Chat */}
      <button
        onClick={() => navigate('/chat')}
        className="flex h-7 items-center gap-1.5 rounded-lg px-2 text-[12px] text-white/45 transition-colors hover:text-white/80"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> {t('wbBackToChat')}
      </button>

      {/* New Build — mirrors the New Chat button */}
      <button
        onClick={onNewBuild}
        className="flex h-8 w-full items-center justify-center gap-1.5 rounded-lg text-[12px] text-white/55 transition-all hover:text-white/85"
        style={{ background: 'rgba(255,255,255,0.03)', border: '1px dashed rgba(255,255,255,0.08)' }}
      >
        <Plus className="h-3.5 w-3.5" /> {t('wbNewBuild')}
      </button>

      {/* History */}
      <div className="mt-1 px-1 text-[10px] font-medium uppercase tracking-wide text-white/25">
        {t('wbBuildsHistory')}
      </div>
      <div className="flex flex-col gap-0.5 overflow-y-auto scrollbar-thin">
        {sessions.length === 0 ? (
          <p className="px-2 py-1.5 text-[11px] text-white/25">{t('wbNoBuilds')}</p>
        ) : (
          sessions.map((s) => {
            const active = s.id === activeSessionId;
            return (
              <button
                key={s.id}
                onClick={() => onOpenSession(s.id)}
                className={`flex w-full min-w-0 items-center gap-2 rounded-lg border px-2.5 py-[6px] text-left transition-all duration-200 ${
                  active ? 'border-[#3B82F6]/25' : 'border-transparent hover:border-[#3B82F6]/12'
                }`}
                style={active ? { background: 'rgba(59,130,246,0.10)' } : undefined}
              >
                <span className={`h-[3px] w-[3px] shrink-0 rounded-full transition-all ${active ? 'scale-100 bg-[#60A5FA]' : 'scale-0 bg-transparent'}`} />
                <Monitor className={`h-2.5 w-2.5 shrink-0 ${active ? 'text-[#60A5FA]' : 'text-white/25'}`} />
                <span className={`block w-full truncate text-[11px] leading-tight ${active ? 'font-medium text-white/85' : 'text-white/50'}`}>
                  {s.title || t('wbNewBuild')}
                </span>
              </button>
            );
          })
        )}
      </div>
    </aside>
  );
}
