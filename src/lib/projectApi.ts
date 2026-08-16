/**
 * projectApi — backend-authoritative project linkage (chats + products).
 *
 * Thin client over the server routes that own the truth:
 *   • chat ↔ project binding  (/v2/sessions/threads/{id}/project, …)
 *   • Save-to-Project attach   (/v2/orchestrator/projects/{id}/products)
 *
 * The SERVER enforces ownership on both sides; this client never assumes the
 * frontend's hidden state is authoritative — callers read the current binding
 * back from the server. Every call is best-effort and returns a typed result;
 * nothing throws.
 */
import type { ChatSession } from '@/types';
import { apiCall, apiCallDetailed } from '@/lib/serverApi';
import { serverChatEnabled, syncSession, listUserThreads } from '@/lib/sessionsSync';
import { getProjects } from '@/stores/projectStore';
import { resolveBuildType, type BuildType } from '@/lib/buildType';
import { normalizeWorkspace, type ProjectWorkspace } from '@/lib/projectWorkspace';

export interface BindingResult {
  ok: boolean;
  status: number;
  projectId: string | null;
  movedFrom?: string | null;
}

/**
 * Cross-surface signal that a chat↔project binding changed on the SERVER.
 *
 * The chat sidebar renders project groups from the backend binding authority.
 * When another surface (Project Overview, the chat kebab's Add/Move action, the
 * deferred bind that fires after a new project chat's first turn) mutates that
 * binding, the sidebar must re-read it — otherwise it shows a stale group until
 * a full reload. This is a pure invalidation ping: it carries no state, so it
 * can never become a second source of truth.
 */
export const PROJECT_BINDINGS_CHANGED_EVENT = 'korvix-project-bindings-changed';

export function notifyProjectBindingsChanged(): void {
  try {
    window.dispatchEvent(new CustomEvent(PROJECT_BINDINGS_CHANGED_EVENT));
  } catch { /* non-browser (tests/SSR) — nothing to notify */ }
}

/** The project a chat is currently filed under (null if none / unavailable). */
export async function getThreadProject(threadId: string): Promise<string | null> {
  const data = await apiCall<{ project_id?: string | null }>(
    'GET',
    `/v2/sessions/threads/${encodeURIComponent(threadId)}/project`,
  );
  return data?.project_id ?? null;
}

/**
 * Assign or MOVE a chat to a project. The chat must exist server-side first, so
 * a not-yet-synced session is synced (its thread created) before binding. The
 * server detaches any prior binding, enforces ownership on BOTH the thread and
 * the project, and returns the authoritative new binding.
 *
 * Returns `{ok, status, projectId, movedFrom}`; `ok=false` with `status=404`
 * means the caller does not own the thread or the project (existence-hidden).
 */
export async function assignChatToProject(
  session: ChatSession,
  projectId: string,
): Promise<BindingResult> {
  if (!serverChatEnabled()) return { ok: false, status: 0, projectId: null };
  // Ensure the chat has a server thread to bind (created idempotently).
  const threadId = session.serverThreadId ?? (await syncSession(session));
  if (!threadId) return { ok: false, status: 0, projectId: null };
  const res = await apiCallDetailed<{ project_id?: string; moved_from?: string | null }>(
    'PUT',
    `/v2/sessions/threads/${encodeURIComponent(threadId)}/project`,
    { project_id: projectId },
  );
  if (res.ok) notifyProjectBindingsChanged();
  return {
    ok: res.ok,
    status: res.status,
    projectId: res.data?.project_id ?? (res.ok ? projectId : null),
    movedFrom: res.data?.moved_from ?? null,
  };
}

/**
 * Bind an ALREADY-SYNCED thread to a project (raw PUT, no re-sync). Used by the
 * chat lifecycle once a new chat's server thread exists — the point at which a
 * "new chat from a project" can be filed. Best-effort; never throws.
 */
export async function bindThreadToProject(
  threadId: string,
  projectId: string,
): Promise<BindingResult> {
  const res = await apiCallDetailed<{ project_id?: string; moved_from?: string | null }>(
    'PUT',
    `/v2/sessions/threads/${encodeURIComponent(threadId)}/project`,
    { project_id: projectId },
  );
  if (res.ok) notifyProjectBindingsChanged();
  return {
    ok: res.ok,
    status: res.status,
    projectId: res.data?.project_id ?? (res.ok ? projectId : null),
    movedFrom: res.data?.moved_from ?? null,
  };
}

/**
 * Unbind a thread from its project by SERVER THREAD ID (raw DELETE) — used by
 * the Project Overview chat row's "Remove from project". Non-destructive: the
 * conversation, its messages, and any products are untouched; only the project
 * binding is dropped. Ownership enforced server-side. Best-effort; never throws.
 */
export async function removeThreadFromProject(threadId: string): Promise<BindingResult> {
  const res = await apiCallDetailed<{ removed_from?: string | null }>(
    'DELETE',
    `/v2/sessions/threads/${encodeURIComponent(threadId)}/project`,
  );
  if (res.ok) notifyProjectBindingsChanged();
  return { ok: res.ok, status: res.status, projectId: null, movedFrom: res.data?.removed_from ?? null };
}

/** Remove a chat from its project (thread + messages are kept). */
export async function removeChatFromProject(session: ChatSession): Promise<BindingResult> {
  if (!serverChatEnabled()) return { ok: false, status: 0, projectId: null };
  const threadId = session.serverThreadId ?? null;
  if (!threadId) return { ok: true, status: 200, projectId: null }; // never synced → nothing to remove
  const res = await apiCallDetailed<{ removed_from?: string | null }>(
    'DELETE',
    `/v2/sessions/threads/${encodeURIComponent(threadId)}/project`,
  );
  if (res.ok) notifyProjectBindingsChanged();
  return { ok: res.ok, status: res.status, projectId: null, movedFrom: res.data?.removed_from ?? null };
}

export interface AttachProductInput {
  buildType: BuildType | string | undefined;
  title?: string;
  artifactRef?: string;
  buildRef?: string;
  sourceId?: string;   // stable build/session id → idempotent upsert key
  threadId?: string;   // originating chat
}

export interface AttachProductResult {
  ok: boolean;
  status: number;
  deliverableId: string | null;
}

/**
 * Attach a generated Web/App product to a project on the SERVER (Save-to-Project
 * backend truth). Reuses the canonical deliverable authority; sends a reference
 * only, never the source tree. Idempotent by `sourceId`. buildType preserved.
 * `ok=false, status=404` means the caller does not own the project.
 */
export async function attachProductToProject(
  projectId: string,
  input: AttachProductInput,
): Promise<AttachProductResult> {
  const res = await apiCallDetailed<{ deliverable_id?: string }>(
    'POST',
    `/v2/orchestrator/projects/${encodeURIComponent(projectId)}/products`,
    {
      build_type: resolveBuildType(input.buildType),
      title: input.title ?? '',
      artifact_ref: input.artifactRef ?? '',
      build_ref: input.buildRef ?? '',
      source_id: input.sourceId ?? '',
      thread_id: input.threadId ?? '',
    },
  );
  return { ok: res.ok, status: res.status, deliverableId: res.data?.deliverable_id ?? null };
}

// ── Project Overview reads (backend-authoritative; localStorage is never the
//    authority for these) ────────────────────────────────────────────────────

export interface ProjectChat {
  id: string;              // server thread id — the ChatSession id after hydrate
  title: string;
  mode: string | null;
  updated_at: string | null;
}

/** Chats filed under a project (server truth). [] on failure / unavailable. */
export async function listProjectChats(projectId: string): Promise<ProjectChat[]> {
  const data = await apiCall<{ threads?: ProjectChat[] }>(
    'GET',
    `/v2/sessions/projects/${encodeURIComponent(projectId)}/threads`,
  );
  return (data?.threads || []).map((t) => ({
    id: t.id,
    title: t.title || 'Chat',
    mode: t.mode ?? null,
    updated_at: t.updated_at ?? null,
  }));
}

export interface AddableChat {
  id: string;                    // server thread id
  title: string;
  updated_at: string | null;
  inCurrentProject: boolean;     // already filed here → disable
  otherProjectId: string | null; // bound to a DIFFERENT project → "Move here"
  otherProjectName: string | null;
}

/**
 * The signed-in user's ordinary chats, annotated with their project membership,
 * for the "Add existing chat" picker. Server-authoritative:
 *   • the chat list comes from the sessions authority (`listUserThreads`), NEVER
 *     localStorage;
 *   • membership comes from the canonical per-project binding
 *     (`listProjectChats`), queried once per owned project (few calls, not
 *     per-thread).
 * `getProjects()` is used ONLY to know which project ids to ask about (+ names);
 * chat membership itself is backend truth. Ownership is enforced server-side on
 * every read, so this can never surface another user's chats.
 */
export async function listAddableChats(currentProjectId: string): Promise<AddableChat[]> {
  const threads = await listUserThreads();
  if (threads.length === 0) return [];

  // thread id → { projectId, projectName } for every project the user owns.
  const owned = getProjects();
  const membership = new Map<string, { id: string; name: string }>();
  await Promise.all(
    owned.map(async (p) => {
      const chats = await listProjectChats(p.id);
      for (const c of chats) membership.set(c.id, { id: p.id, name: p.name });
    }),
  );

  return threads.map((t) => {
    const m = membership.get(t.id) || null;
    const inCurrent = m?.id === currentProjectId;
    return {
      id: t.id,
      title: t.title,
      updated_at: t.updated_at,
      inCurrentProject: !!inCurrent,
      otherProjectId: m && !inCurrent ? m.id : null,
      otherProjectName: m && !inCurrent ? m.name : null,
    };
  });
}

export interface ProjectProduct {
  deliverable_id?: string;
  build_type?: string;     // "web" | "app"
  title?: string;
  status?: string;
  artifact_ref?: string;
  build_ref?: string;
  run_id?: string;
  updated_at?: string;
}

/** Generated Web/App products for a project (server truth). [] on failure. */
export async function listProjectProducts(projectId: string): Promise<ProjectProduct[]> {
  const data = await apiCall<{ products?: ProjectProduct[] }>(
    'GET',
    `/v2/orchestrator/projects/${encodeURIComponent(projectId)}/products`,
  );
  return data?.products || [];
}

export interface ProjectWorkspaceResult {
  workspace: ProjectWorkspace | null;
  /** HTTP status (0 when the server could not be reached). */
  status: number;
  /** The server says this project is not available to the caller. */
  notFound: boolean;
}

/**
 * The bounded Project WORKSPACE snapshot — the ONE request the Project page
 * renders from. Replaces the previous three-call fan-out (chats + products +
 * brain) with a single backend-authoritative read that also carries goals,
 * needs-attention, unified activity, connected tools and freshness.
 *
 * The 404 case is reported separately from a transport failure so the page can
 * tell "this project isn't yours / doesn't exist" (a permanent answer, and the
 * one the server gives for BOTH, deliberately hiding existence) apart from
 * "the server was unreachable" (worth a retry button). Never throws.
 */
export async function getProjectWorkspace(projectId: string): Promise<ProjectWorkspaceResult> {
  const res = await apiCallDetailed<unknown>(
    'GET',
    `/v2/projects/${encodeURIComponent(projectId)}/workspace`,
  );
  return {
    workspace: res.ok ? normalizeWorkspace(res.data) : null,
    status: res.status,
    notFound: res.status === 404,
  };
}

export interface ProjectBrainContext {
  project_summary?: string;
  current_goals?: string[];
  connector_signals?: { source?: string; kind?: string; summary?: string }[];
  counts?: Record<string, number>;
}

/**
 * Bounded Project Brain snapshot (goals / connector signals / counts). Reads the
 * existing deterministic aggregate endpoint — NO model call. Returns null when
 * the brain is disabled/empty so the Overview simply omits the section.
 */
export async function getProjectBrainContext(projectId: string): Promise<ProjectBrainContext | null> {
  const data = await apiCall<{ brain?: ProjectBrainContext | null; empty?: boolean }>(
    'GET',
    `/v2/projects/${encodeURIComponent(projectId)}/brain`,
  );
  if (!data || data.empty || !data.brain) return null;
  return data.brain;
}
