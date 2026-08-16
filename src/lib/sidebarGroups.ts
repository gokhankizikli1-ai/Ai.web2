/**
 * sidebarGroups — pure grouping of the chat sidebar into PROJECT groups and
 * standalone RECENT chats.
 *
 * WHY A PURE MODULE
 * -----------------
 * The sidebar now shows project-bound chats directly under their owning project,
 * so a user never has to enter the Project Overview to reach a project chat. The
 * grouping decision is small but full of identity traps, so it lives here where
 * it can be unit-tested without a router, a store or a network:
 *
 *   • A chat carries TWO ids — the local `ChatSession.id` and the backend
 *     `serverThreadId`. Project membership is expressed in SERVER THREAD IDS
 *     (`/v2/sessions/projects/{id}/threads` is the authority), so a session is
 *     matched by EITHER id. Matching only by `id` is exactly the historical
 *     "clicking a project chat opens a blank new chat" bug.
 *   • Membership truth is the BACKEND binding, mirrored here as a read-only
 *     view. This module never invents a binding and never persists one — there
 *     is deliberately no client-side project↔chat store.
 *   • A chat the user just started FROM a project has no server thread yet, so
 *     its binding is still *pending*. Those are grouped optimistically under the
 *     target project (the same optimistic value `useChat` already surfaces as
 *     `activeProjectId`), so a new project chat does not visibly jump lists once
 *     its thread is created.
 *   • A chat must appear EXACTLY ONCE: bound chats live only in their project
 *     group, standalone chats only in Recent.
 */
import type { ChatSession } from '@/types';

/** A chat filed under a project, as reported by the backend sessions authority. */
export interface ProjectChatRef {
  /** Server thread id. */
  id: string;
  title: string;
  updated_at: string | null;
}

export interface SidebarChatItem {
  /** Stable React key. */
  key: string;
  title: string;
  updatedAt: Date;
  /** Local session id when this chat is present in the local session set. */
  sessionId: string | null;
  /** Server thread id when known (project membership is keyed on this). */
  threadId: string | null;
  /** Non-chat sessions (Web Build) keep their routing behaviour on click. */
  mode?: ChatSession['mode'];
  webBuildRunId?: string;
}

export interface SidebarProjectGroup {
  projectId: string;
  name: string;
  chats: SidebarChatItem[];
}

export interface SidebarGroups {
  projects: SidebarProjectGroup[];
  recents: ChatSession[];
  /** Total chats filed under projects (for the section counter). */
  projectChatCount: number;
}

export interface BuildSidebarGroupsInput {
  /** Real sidebar sessions (already filtered + search-applied), newest first. */
  sessions: ChatSession[];
  /** The user's projects (id + display name). Order is preserved. */
  projects: { id: string; name: string }[];
  /** projectId → chats filed under it, from the backend sessions authority. */
  projectChats: Record<string, ProjectChatRef[]>;
  /** sessionId → projectId for bindings that exist only as a pending request. */
  pendingBindings?: Record<string, string>;
  /** Cap on the standalone Recent list (project groups are never truncated). */
  recentLimit?: number;
  /** Lower-cased search text; when set, project groups are filtered too. */
  search?: string;
}

const DEFAULT_RECENT_LIMIT = 12;

function toDate(iso: string | null | undefined): Date {
  if (!iso) return new Date(0);
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? new Date(0) : d;
}

/**
 * Group sessions into project buckets + standalone recents.
 *
 * The project bucket for a project is the UNION of:
 *   • the backend's chat list for that project (authoritative membership, so a
 *     chat that exists on the server but is outside the locally-hydrated window
 *     is still reachable), and
 *   • local sessions whose id/serverThreadId matches one of those entries — the
 *     local row supplies the live title/updatedAt and, crucially, the LOCAL id
 *     the active session is keyed on, and
 *   • local sessions with a pending binding to that project.
 *
 * A session that appears in any project bucket is removed from `recents`.
 */
export function buildSidebarGroups(input: BuildSidebarGroupsInput): SidebarGroups {
  const {
    sessions, projects, projectChats,
    pendingBindings = {}, recentLimit = DEFAULT_RECENT_LIMIT,
  } = input;
  const search = (input.search || '').trim().toLowerCase();

  // thread id → project id (backend truth).
  const threadToProject = new Map<string, string>();
  for (const p of projects) {
    for (const c of projectChats[p.id] || []) {
      if (c && c.id) threadToProject.set(c.id, p.id);
    }
  }

  // Which local sessions are bound (by either identity), and to which project.
  const sessionToProject = new Map<string, string>();
  for (const s of sessions) {
    const viaThread = s.serverThreadId ? threadToProject.get(s.serverThreadId) : undefined;
    const viaId = threadToProject.get(s.id);
    const pid = viaThread ?? viaId ?? pendingBindings[s.id];
    if (pid) sessionToProject.set(s.id, pid);
  }

  // Local session lookup by BOTH identities so a server-listed chat resolves to
  // the real local session (never a fresh blank one).
  const byIdentity = new Map<string, ChatSession>();
  for (const s of sessions) {
    byIdentity.set(s.id, s);
    if (s.serverThreadId) byIdentity.set(s.serverThreadId, s);
  }

  const groups: SidebarProjectGroup[] = [];
  let projectChatCount = 0;

  for (const p of projects) {
    const items: SidebarChatItem[] = [];
    const seen = new Set<string>();

    const push = (item: SidebarChatItem, ...ids: (string | null)[]) => {
      for (const id of ids) if (id && seen.has(id)) return;
      for (const id of ids) if (id) seen.add(id);
      items.push(item);
    };

    // 1. Backend-listed chats (authoritative membership).
    for (const c of projectChats[p.id] || []) {
      if (!c || !c.id) continue;
      const local = byIdentity.get(c.id);
      push(
        {
          key: local ? local.id : c.id,
          title: (local?.title || c.title || 'Chat').trim() || 'Chat',
          updatedAt: local?.updatedAt ?? toDate(c.updated_at),
          sessionId: local?.id ?? null,
          threadId: c.id,
          ...(local?.mode ? { mode: local.mode } : {}),
          ...(local?.webBuildRunId ? { webBuildRunId: local.webBuildRunId } : {}),
        },
        c.id,
        local?.id ?? null,
      );
    }

    // 2. Local sessions bound to this project (covers pending bindings and any
    //    local row whose thread the backend list has not caught up with yet).
    for (const s of sessions) {
      if (sessionToProject.get(s.id) !== p.id) continue;
      push(
        {
          key: s.id,
          title: s.title,
          updatedAt: s.updatedAt,
          sessionId: s.id,
          threadId: s.serverThreadId ?? null,
          ...(s.mode ? { mode: s.mode } : {}),
          ...(s.webBuildRunId ? { webBuildRunId: s.webBuildRunId } : {}),
        },
        s.id,
        s.serverThreadId ?? null,
      );
    }

    const filtered = search
      ? items.filter((i) => i.title.toLowerCase().includes(search))
      : items;
    filtered.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    projectChatCount += filtered.length;
    groups.push({ projectId: p.id, name: p.name || 'Untitled project', chats: filtered });
  }

  const recents = sessions
    .filter((s) => !sessionToProject.has(s.id))
    .slice(0, Math.max(0, recentLimit));

  return { projects: groups, recents, projectChatCount };
}

/**
 * Which project (if any) a session belongs to, given the same backend view.
 * Exported for callers that need the single-session answer without building
 * the whole grouping (e.g. deciding which unbind action a row offers).
 */
export function projectOfSession(
  session: ChatSession,
  projectChats: Record<string, ProjectChatRef[]>,
  pendingBindings: Record<string, string> = {},
): string | null {
  for (const [pid, chats] of Object.entries(projectChats)) {
    for (const c of chats || []) {
      if (!c?.id) continue;
      if (c.id === session.serverThreadId || c.id === session.id) return pid;
    }
  }
  return pendingBindings[session.id] ?? null;
}
