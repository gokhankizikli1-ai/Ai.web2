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
import { serverChatEnabled, syncSession } from '@/lib/sessionsSync';
import { resolveBuildType, type BuildType } from '@/lib/buildType';

export interface BindingResult {
  ok: boolean;
  status: number;
  projectId: string | null;
  movedFrom?: string | null;
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
  return {
    ok: res.ok,
    status: res.status,
    projectId: res.data?.project_id ?? (res.ok ? projectId : null),
    movedFrom: res.data?.moved_from ?? null,
  };
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
