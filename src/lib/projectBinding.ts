/**
 * projectBinding — chat↔project binding state, backend-authoritative.
 *
 * The logic behind the "Add / Move to project" chat action, kept out of the
 * component file so it can be shared without tripping fast-refresh. Reads the
 * current binding from server truth and mutates via the ownership-checked
 * `projectApi` routes.
 */
import { useState, useEffect, useCallback } from 'react';
import type { ChatSession } from '@/types';
import {
  getThreadProject,
  assignChatToProject,
  removeChatFromProject,
} from '@/lib/projectApi';

/** Ordinary chat only — build/tool sessions carry a non-chat ConversationMode. */
export function isOrdinaryChat(session: ChatSession | null | undefined): boolean {
  if (!session) return false;
  return session.mode === undefined || session.mode === 'chat';
}

export interface Binding {
  current: string | null;
  busy: boolean;
  error: 'forbidden' | 'failed' | null;
  assign: (projectId: string) => Promise<void>;
  remove: () => Promise<void>;
}

/** Backend-truth binding state for a chat. Reads the current project on mount. */
export function useProjectBinding(session: ChatSession): Binding {
  const [current, setCurrent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<'forbidden' | 'failed' | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const pid = session.serverThreadId
        ? await getThreadProject(session.serverThreadId)
        : null;
      if (!cancelled) setCurrent(pid);
    };
    void load();
    return () => { cancelled = true; };
  }, [session.serverThreadId]);

  const assign = useCallback(async (projectId: string) => {
    setBusy(true); setError(null);
    const res = await assignChatToProject(session, projectId);
    setBusy(false);
    if (!res.ok) { setError(res.status === 404 ? 'forbidden' : 'failed'); return; }
    setCurrent(res.projectId);
  }, [session]);

  const remove = useCallback(async () => {
    setBusy(true); setError(null);
    const res = await removeChatFromProject(session);
    setBusy(false);
    if (!res.ok) { setError('failed'); return; }
    setCurrent(null);
  }, [session]);

  return { current, busy, error, assign, remove };
}
