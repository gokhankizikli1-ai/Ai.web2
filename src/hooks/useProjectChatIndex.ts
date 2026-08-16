/**
 * useProjectChatIndex — a READ-ONLY view of "which chats are filed under which
 * project", assembled from the existing backend authority.
 *
 * There is deliberately NO new client-side project↔chat store. The mapping is
 * owned by the server (`/v2/sessions/projects/{id}/threads`, the same record the
 * Project Overview and Project Brain read); this hook just caches the answer for
 * the length of a render pass so the chat sidebar can group by project without
 * a request per row.
 *
 * Refresh triggers (all cheap, none polling):
 *   • mount / project-list change,
 *   • the cross-surface `PROJECT_BINDINGS_CHANGED_EVENT` ping, fired by every
 *     binding mutator in projectApi (bind / move / unbind, from any surface),
 *   • a change in the set of server thread ids the chat hook knows about — a
 *     newly-synced thread is exactly when a deferred binding lands.
 *
 * Ownership is enforced server-side on every read, so this can never surface
 * another user's chats. On failure each project simply resolves to [] and the
 * sidebar degrades to a flat Recent list.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  listProjectChats, PROJECT_BINDINGS_CHANGED_EVENT, type ProjectChat,
} from '@/lib/projectApi';
import { serverChatEnabled } from '@/lib/sessionsSync';
import { getProjects } from '@/stores/projectStore';
import type { ProjectChatRef } from '@/lib/sidebarGroups';

export interface ProjectChatIndex {
  /** The user's projects (id + name), newest first as the store returns them. */
  projects: { id: string; name: string }[];
  /** projectId → chats filed under it (server truth). */
  projectChats: Record<string, ProjectChatRef[]>;
  /** True until the first read settles (used only to avoid an empty flash). */
  loading: boolean;
  refresh: () => void;
}

function toRefs(chats: ProjectChat[]): ProjectChatRef[] {
  return chats.map((c) => ({ id: c.id, title: c.title, updated_at: c.updated_at }));
}

/**
 * @param threadSignature A stable string derived from the caller's known server
 * thread ids. When it changes, the index re-reads (a new thread may have just
 * been filed). Passing a constant disables that trigger.
 */
export function useProjectChatIndex(threadSignature = ''): ProjectChatIndex {
  const [projectChats, setProjectChats] = useState<Record<string, ProjectChatRef[]>>({});
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((n) => n + 1), []);

  // Projects come from the existing project store (localStorage-backed, backend
  // mirrored). Only ids/names are used — chat membership is NEVER read from
  // there. DERIVED during render (not mirrored into state) so a project created
  // on another surface appears on the next refresh trigger without an
  // effect→setState cascade.
  const projects = useMemo<{ id: string; name: string }[]>(() => {
    try { return getProjects().map((p) => ({ id: p.id, name: p.name })); }
    catch { return []; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, threadSignature]);

  const projectIds = useMemo(() => projects.map((p) => p.id).join(','), [projects]);

  const cancelRef = useRef(0);
  useEffect(() => {
    const run = ++cancelRef.current;
    let cancelled = false;
    const load = async () => {
      // Guests have no server chat identity — there is nothing to group.
      if (!serverChatEnabled() || projects.length === 0) {
        if (!cancelled && run === cancelRef.current) {
          setProjectChats({});
          setLoading(false);
        }
        return;
      }
      const entries = await Promise.all(
        projects.map(async (p) => [p.id, toRefs(await listProjectChats(p.id))] as const),
      );
      if (cancelled || run !== cancelRef.current) return;
      const next: Record<string, ProjectChatRef[]> = {};
      for (const [pid, chats] of entries) next[pid] = chats;
      setProjectChats(next);
      setLoading(false);
    };
    void load();
    return () => { cancelled = true; };
    // `projectIds` (not `projects`) so a re-created array of the same ids does
    // not re-fetch on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectIds, tick, threadSignature]);

  // Cross-surface invalidation ping.
  useEffect(() => {
    const handler = () => refresh();
    window.addEventListener(PROJECT_BINDINGS_CHANGED_EVENT, handler);
    return () => window.removeEventListener(PROJECT_BINDINGS_CHANGED_EVENT, handler);
  }, [refresh]);

  return { projects, projectChats, loading, refresh };
}
