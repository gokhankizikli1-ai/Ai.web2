/**
 * MoveToProjectMenu — the smallest clean "Add / Move to project" affordance for
 * an existing chat. Lists ONLY the authenticated user's projects (from the
 * project store), shows the chat's current project, and lets the user assign,
 * move A→B, or remove — all through the backend-authoritative routes
 * (`projectApi`). UI state is read back from server truth; frontend hiding is
 * never treated as security (the server enforces ownership on both sides).
 *
 * Rendered only for ordinary chat sessions (see ChatDashboard gating).
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { FolderInput, Check, X, Loader2 } from 'lucide-react';
import type { ChatSession } from '@/types';
import { getProjects } from '@/stores/projectStore';
import {
  getThreadProject,
  assignChatToProject,
  removeChatFromProject,
} from '@/lib/projectApi';

export default function MoveToProjectMenu({ session }: { session: ChatSession }) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<'forbidden' | 'failed' | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Read the current binding from server truth whenever the menu opens. All
  // state updates happen inside the async callback (not synchronously in the
  // effect body) so a fresh open reflects backend truth without cascading renders.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const load = async () => {
      const pid = session.serverThreadId
        ? await getThreadProject(session.serverThreadId)
        : null;
      if (!cancelled) { setCurrent(pid); setError(null); }
    };
    void load();
    return () => { cancelled = true; };
  }, [open, session.serverThreadId]);

  const projects = getProjects();

  const doAssign = useCallback(async (projectId: string) => {
    setBusy(true); setError(null);
    const res = await assignChatToProject(session, projectId);
    setBusy(false);
    if (!res.ok) { setError(res.status === 404 ? 'forbidden' : 'failed'); return; }
    setCurrent(res.projectId);
  }, [session]);

  const doRemove = useCallback(async () => {
    setBusy(true); setError(null);
    const res = await removeChatFromProject(session);
    setBusy(false);
    if (!res.ok) { setError('failed'); return; }
    setCurrent(null);
  }, [session]);

  const currentName = current
    ? (projects.find((p) => p.id === current)?.name ?? 'a project')
    : null;

  return (
    <div ref={ref} className="relative">
      <button
        aria-label="Move chat to project"
        onClick={() => setOpen((o) => !o)}
        className="h-7 w-7 flex items-center justify-center rounded-md transition-all border hover:text-slate-300 hover:bg-white/[0.04]"
        style={{ color: 'rgba(203, 213, 225,0.4)', borderColor: 'rgba(255,255,255,0.05)' }}
      >
        <FolderInput className="h-3.5 w-3.5" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute top-full right-0 mt-1.5 w-56 rounded-xl border shadow-2xl overflow-hidden z-50 py-1"
          style={{ borderColor: 'rgba(255,255,255,0.06)', background: 'rgba(17, 23, 34,0.96)', backdropFilter: 'blur(24px)' }}
        >
          <div className="px-3 py-1.5 text-[11px] uppercase tracking-wide" style={{ color: 'rgba(203,213,225,0.35)' }}>
            {currentName ? `In: ${currentName}` : 'Add to project'}
          </div>

          {error && (
            <div role="alert" className="mx-2 my-1 rounded-md px-2 py-1 text-[11px]"
                 style={{ background: 'rgba(245,158,11,0.08)', color: '#FCD9A6' }}>
              {error === 'forbidden' ? "You don't have access to that project." : 'Could not update — try again.'}
            </div>
          )}

          <div className="max-h-56 overflow-y-auto scrollbar-thin">
            {projects.length === 0 ? (
              <p className="px-3 py-2 text-[12px]" style={{ color: 'rgba(203,213,225,0.4)' }}>No projects yet.</p>
            ) : projects.map((p) => (
              <button
                key={p.id}
                role="menuitem"
                disabled={busy}
                onClick={() => doAssign(p.id)}
                className="w-full flex items-center gap-2 px-3 py-2 text-left text-[12px] transition-all hover:bg-white/[0.04] disabled:opacity-50"
                style={{ color: 'rgba(203,213,225,0.7)' }}
              >
                <span className="flex-1 truncate">{p.name}</span>
                {current === p.id && <Check className="h-3.5 w-3.5" style={{ color: '#34D399' }} />}
              </button>
            ))}
          </div>

          {current && (
            <>
              <div className="my-1 h-px" style={{ background: 'rgba(255,255,255,0.06)' }} />
              <button
                role="menuitem"
                disabled={busy}
                onClick={doRemove}
                className="w-full flex items-center gap-2 px-3 py-2 text-left text-[12px] transition-all hover:bg-white/[0.04] disabled:opacity-50"
                style={{ color: 'rgba(248,113,113,0.85)' }}
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                <span className="flex-1">Remove from project</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
