/**
 * ProjectBindingSection — the "Add / Move to project" UI for an ordinary chat.
 *
 * Rendered INLINE inside the chat header's kebab menu (the existing three-dot
 * conversation-actions surface, alongside Export Chat), not as a separate
 * easily-missed icon. Lists ONLY the authenticated user's projects (from the
 * project store), shows the chat's current project, and lets the user assign,
 * move A→B, or remove — all through the backend-authoritative routes. State is
 * read back from server truth on open; frontend hiding is never treated as
 * security (the server enforces ownership on both sides). Binding logic lives in
 * `@/lib/projectBinding`.
 */
import { FolderInput, Check, X, Loader2 } from 'lucide-react';
import type { ChatSession } from '@/types';
import { getProjects } from '@/stores/projectStore';
import { useProjectBinding } from '@/lib/projectBinding';

export default function ProjectBindingSection({ session }: { session: ChatSession }) {
  const { current, busy, error, assign, remove } = useProjectBinding(session);
  const projects = getProjects();
  const currentName = current
    ? (projects.find((p) => p.id === current)?.name ?? 'a project')
    : null;

  return (
    <div className="px-1 pb-1">
      <div className="flex items-center gap-2 px-2 pt-1.5 pb-1 text-[10px] uppercase tracking-wide" style={{ color: 'rgba(203,213,225,0.35)' }}>
        <FolderInput className="h-3 w-3" />
        <span className="flex-1 truncate">
          {currentName ? `In: ${currentName}` : 'Add to project'}
        </span>
      </div>

      {error && (
        <div role="alert" className="mx-1 my-1 rounded-md px-2 py-1 text-[11px]"
             style={{ background: 'rgba(245,158,11,0.08)', color: '#FCD9A6' }}>
          {error === 'forbidden' ? "You don't have access to that project." : 'Could not update — try again.'}
        </div>
      )}

      <div className="max-h-40 overflow-y-auto scrollbar-thin">
        {projects.length === 0 ? (
          <p className="px-2 py-1.5 text-[11.5px]" style={{ color: 'rgba(203,213,225,0.4)' }}>No projects yet.</p>
        ) : projects.map((p) => (
          <button
            key={p.id}
            role="menuitem"
            disabled={busy}
            onClick={() => { void assign(p.id); }}
            className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] transition-all hover:bg-white/[0.05] disabled:opacity-50"
            style={{ color: current === p.id ? '#E2E8F0' : 'rgba(203,213,225,0.65)' }}
          >
            <span className="flex-1 truncate">{p.name}</span>
            {current === p.id && <Check className="h-3.5 w-3.5 shrink-0" style={{ color: '#34D399' }} />}
          </button>
        ))}
      </div>

      {current && (
        <button
          role="menuitem"
          disabled={busy}
          onClick={() => { void remove(); }}
          className="mt-0.5 w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] transition-all hover:bg-white/[0.05] disabled:opacity-50"
          style={{ color: 'rgba(248,113,113,0.85)' }}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
          <span className="flex-1">Remove from project</span>
        </button>
      )}
    </div>
  );
}
