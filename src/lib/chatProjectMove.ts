/**
 * chatProjectMove — moving a standalone chat INTO a project, from the sidebar.
 *
 * This is the logic behind both the drag-and-drop gesture and its keyboard
 * equivalent ("Move to project"). It lives here, free of React and of the DOM,
 * because the interesting part is not the gesture — it is the ORDER OF TRUST:
 *
 *   1. the drop is validated against the CURRENT backend view (a chat is never
 *      "moved" into the project it is already in, and non-chat sessions such as
 *      Web Build runs are not project-bindable from here);
 *   2. the optimistic grouping is applied so the row jumps immediately;
 *   3. the AUTHORITATIVE binding call runs — `projectApi.assignChatToProject`,
 *      the same ownership-checked route the chat kebab and Project Overview use.
 *      Nothing here writes a client-side project↔chat record;
 *   4. on ANY server failure the optimistic grouping is rolled back, so the UI
 *      never keeps a binding the server refused.
 *
 * Identity: a chat carries a local `ChatSession.id` and a backend
 * `serverThreadId`. `assignChatToProject` syncs an un-synced session first so
 * the EXISTING conversation gets a thread — a move never mints a new/blank chat
 * — and binds by thread id, which is the only identity the server accepts.
 *
 * The optimistic entry is keyed by LOCAL session id, matching the pending-binding
 * map `buildSidebarGroups` already understands. Backend truth takes precedence
 * over it there, so a confirmed move is described by the server, not by this
 * module's leftover state; `pruneConfirmedMoves` drops those leftovers once the
 * server agrees.
 */
import type { ChatSession } from '@/types';
import type { BindingResult } from '@/lib/projectApi';
import type { ProjectChatRef } from '@/lib/sidebarGroups';
import { projectOfSession } from '@/lib/sidebarGroups';
import { isOrdinaryChat } from '@/lib/projectBinding';

/** dataTransfer type carrying the dragged chat's LOCAL session id. */
export const CHAT_DRAG_MIME = 'application/x-korvix-chat';

export interface MoveContext {
  /** projectId → chats filed under it (backend truth). */
  projectChats: Record<string, ProjectChatRef[]>;
  /** sessionId → projectId for bindings that are still in flight. */
  pendingBindings?: Record<string, string>;
}

export type MoveOutcome =
  /** The server confirmed the new binding. */
  | 'moved'
  /** Nothing to do — the chat is already filed under the target project. */
  | 'already-there'
  /** Not a droppable pair (no target, or a non-chat session). */
  | 'not-movable'
  /** The server refused: the caller does not own the thread or the project. */
  | 'forbidden'
  /** The binding call failed (network / server error). */
  | 'failed';

export interface MoveResult {
  ok: boolean;
  outcome: MoveOutcome;
  /** The project the chat now belongs to, per the SERVER (null unless moved). */
  projectId: string | null;
  /** The project it was detached from, per the server, when it had one. */
  movedFrom: string | null;
  status: number;
}

export interface MoveDeps {
  /**
   * The authoritative binding call. Injected so this module can be tested
   * without a network; production passes `projectApi.assignChatToProject`.
   */
  bind: (session: ChatSession, projectId: string) => Promise<BindingResult>;
  /** Show the chat under `projectId` immediately (optimistic grouping). */
  applyOptimistic: (sessionId: string, projectId: string) => void;
  /** Undo the optimistic grouping — called on every unsuccessful outcome. */
  rollbackOptimistic: (sessionId: string) => void;
  /** Re-read the backend binding index after a confirmed move. */
  onChanged?: () => void;
}

/**
 * Is dropping `session` on `targetProjectId` a real move?
 *
 * Used both to gate the drop and to decide whether a project group should light
 * up as a drop target while a chat is being dragged over it.
 */
export function canMoveChatToProject(
  session: ChatSession | null | undefined,
  targetProjectId: string | null | undefined,
  ctx: MoveContext,
): boolean {
  if (!session || !targetProjectId) return false;
  // Build/tool sessions (Web Build runs) are not project-bindable from here;
  // this mirrors the gate the existing chat kebab applies.
  if (!isOrdinaryChat(session)) return false;
  const current = projectOfSession(session, ctx.projectChats, ctx.pendingBindings ?? {});
  return current !== targetProjectId;
}

/**
 * Move a chat into a project, optimistically, with rollback on failure.
 *
 * Never throws: every path returns a typed {@link MoveResult}.
 */
export async function moveChatToProject(
  session: ChatSession,
  targetProjectId: string,
  ctx: MoveContext,
  deps: MoveDeps,
): Promise<MoveResult> {
  if (!session || !targetProjectId || !isOrdinaryChat(session)) {
    return { ok: false, outcome: 'not-movable', projectId: null, movedFrom: null, status: 0 };
  }
  const current = projectOfSession(session, ctx.projectChats, ctx.pendingBindings ?? {});
  if (current === targetProjectId) {
    return { ok: false, outcome: 'already-there', projectId: targetProjectId, movedFrom: null, status: 0 };
  }

  // 1. Optimistic: the row leaves Recent and appears under the project now.
  deps.applyOptimistic(session.id, targetProjectId);

  // 2. Server truth. `assignChatToProject` syncs an un-synced session first, so
  //    the EXISTING conversation gets its thread — never a new blank chat.
  let res: BindingResult;
  try {
    res = await deps.bind(session, targetProjectId);
  } catch {
    deps.rollbackOptimistic(session.id);
    return { ok: false, outcome: 'failed', projectId: null, movedFrom: null, status: 0 };
  }

  // 3. Rollback on ANY refusal — a 404 here means "you do not own the thread or
  //    the project" (existence-hidden), not "missing route".
  if (!res.ok) {
    deps.rollbackOptimistic(session.id);
    return {
      ok: false,
      outcome: res.status === 404 ? 'forbidden' : 'failed',
      projectId: null,
      movedFrom: null,
      status: res.status,
    };
  }

  // 4. Confirmed. The optimistic entry stays until the refreshed backend index
  //    supersedes it (see `pruneConfirmedMoves`), which is what keeps the row
  //    from flickering back into Recent between the response and the re-read.
  deps.onChanged?.();
  return {
    ok: true,
    outcome: 'moved',
    projectId: res.projectId ?? targetProjectId,
    movedFrom: res.movedFrom ?? null,
    status: res.status,
  };
}

/**
 * Drop optimistic entries the backend has caught up with.
 *
 * A pure projection, so it can be derived during render instead of written back
 * from an effect. An entry survives only while the server has not yet reported
 * the chat under that project; once it has, the server's answer is the only one
 * left. Entries for sessions that no longer exist are dropped too.
 */
export function pruneConfirmedMoves(
  optimistic: Record<string, string>,
  sessions: ChatSession[],
  projectChats: Record<string, ProjectChatRef[]>,
): Record<string, string> {
  const entries = Object.entries(optimistic);
  if (entries.length === 0) return optimistic;

  const byId = new Map<string, ChatSession>();
  for (const s of sessions) byId.set(s.id, s);

  const next: Record<string, string> = {};
  let changed = false;
  for (const [sessionId, projectId] of entries) {
    const session = byId.get(sessionId);
    if (!session) { changed = true; continue; }              // session gone
    if (projectOfSession(session, projectChats) === projectId) {
      changed = true;                                        // backend confirmed
      continue;
    }
    next[sessionId] = projectId;
  }
  return changed ? next : optimistic;
}
