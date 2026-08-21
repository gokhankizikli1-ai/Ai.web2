/**
 * inlineAsk — asking Korvix a question from inside the Project Workspace, and
 * getting the answer there.
 *
 * WHAT CHANGED, AND WHAT DELIBERATELY DID NOT
 * -------------------------------------------
 * The Project page has always offered honest, project-derived questions ("what
 * should I look at first?", "what changed recently?"). Clicking one used to
 * NAVIGATE to Chat with the question pre-typed in the composer — the user left
 * the page they were reading, and then still had to press send.
 *
 * Now the question is asked in place. What it is NOT is a second chat system.
 * Every authority in the flow is the existing one:
 *
 *   the conversation      `/v2/sessions/*` — the canonical workspace → thread →
 *                         message store, reached through `sessionsSync`, which
 *                         is the same client the Chat surface mirrors through.
 *   the project binding   `PUT /v2/sessions/threads/{id}/project` — the same
 *                         ownership-checked route "Move to project" uses. The
 *                         backend, not this file, decides whether the caller
 *                         may file a thread under a project.
 *   the AI path           `POST /v2/chat/stream` — the ONE streaming endpoint.
 *                         It resolves identity from the bearer token, and it
 *                         builds the Project Brain / Project Context block
 *                         itself from `project_id`, owner-gated and fail-closed.
 *   the wire              `chatStream` — the same SSE reader and internal-marker
 *                         scrub the Chat surface uses.
 *
 * So there is no second endpoint, no second prompt assembly, no second context
 * builder, and no workspace-only conversation store. `project_id` is a ROUTING
 * HINT; the security boundary is the backend's ownership check, exactly as it
 * is for a chat sent from the Chat page.
 *
 * REAL TURNS, NOT A PREVIEW
 * -------------------------
 * Both halves of the exchange are appended to the server thread through the
 * sessions authority, each with a stable idempotency key. The result is an
 * ordinary project chat: it appears in the project's Chats list, it hydrates
 * into the Chat sidebar, "Open in chat" resumes it, and a follow-up asked from
 * either surface continues the same conversation with the same history.
 *
 * ONE CONVERSATION PER PROJECT
 * ----------------------------
 * The thread this creates is marked `metadata.origin = 'project_workspace_ask'`
 * on the sessions authority, and `resolveAskThread` finds the newest one so
 * far. That means a person who asks three questions over three visits gets one
 * continuing conversation rather than three stubs — and it needs no new index,
 * because the sessions store already carries thread metadata and the project
 * binding already answers "which threads are this project's".
 */
import { chatStreamUrl, readSSEFrames, stripInternalMarkers, authHeaders } from '@/lib/chatStream';
import { getRequestLocale } from '@/lib/locale';
import { bindThreadToProject, listProjectChats } from '@/lib/projectApi';
import {
  appendThreadMessage, createChatThread, listThreadMessages, serverChatEnabled,
} from '@/lib/sessionsSync';

/** Marks a thread as the one the Workspace's inline Ask created for a project.
 *  Stored on the sessions authority; never inferred from a title. */
export const ASK_ORIGIN = 'project_workspace_ask';

/** How much of the conversation is replayed to the AI path. The same bound the
 *  Chat surface's own history is subject to; enough for real follow-ups without
 *  an unbounded prompt. */
const MAX_HISTORY_TURNS = 40;

/** Reasons an inline ask can fail, as stable codes the page translates. Never
 *  a raw provider or transport message — those are neither translatable nor
 *  safe to render. */
export type AskErrorCode =
  | 'unavailable'   // server chat is off / the user is a guest
  | 'thread'        // the conversation could not be created or filed
  | 'network'       // the request never completed
  | 'stream'        // the stream ended without an answer, or errored
  | 'empty';        // the stream completed but produced nothing

export interface AskHandle {
  /** The project-bound thread this exchange lives in, once it exists. */
  threadId: string | null;
  /** The idempotency key the question was persisted under. A RETRY must pass
   *  it back so the sessions store recognises the re-post instead of writing
   *  the same question twice. */
  questionMessageId: string;
  /**
   * The user pressed Stop. The stream ends and whatever had arrived is KEPT —
   * persisted as the assistant's turn, so what the page shows and what the
   * conversation holds are the same thing. A truncated answer the user chose to
   * truncate is a real answer; silently discarding it would mean "Open in chat"
   * showed a question with nothing under it.
   */
  stop: () => void;
  /**
   * Abandon the exchange — unmount, project switch, navigation. NOTHING further
   * is written: the user did not choose to end it here, so a fragment they may
   * never have read does not become part of the conversation. The question
   * itself was already persisted and stays.
   */
  cancel: () => void;
}

export interface AskCallbacks {
  /** The thread id, as soon as it is known — so the page can offer "Open in
   *  chat" while the answer is still streaming. */
  onThread?: (threadId: string) => void;
  /** The answer so far, already scrubbed. Called on every delta. */
  onToken: (text: string) => void;
  /** The final answer text. */
  onDone: (text: string) => void;
  onError: (code: AskErrorCode) => void;
}

function newId(): string {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return (crypto as Crypto).randomUUID();
    }
  } catch { /* fall through */ }
  return `ask-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

/**
 * The project's existing inline-Ask conversation, or null.
 *
 * Server truth only: it reads the project's threads through the ownership-
 * checked project↔thread route, so a thread this browser once created but no
 * longer owns (or that was deleted, or moved to another project) is simply not
 * found. Newest first, so the conversation continues where it left off.
 *
 * TWO facts must agree before a thread is reused, and both come from the
 * server. The project↔thread route says the thread is filed under THIS project
 * now; `metadata.project_id`, stamped at creation, says it was created as this
 * project's inline-Ask conversation. A thread that was created for project A
 * and later moved to project B satisfies only the first — and reusing it would
 * replay A's questions and A's answers as B's history, so B's next answer
 * continues a conversation about a different project. Requiring both is
 * fail-closed: a thread that cannot prove it belongs here is not reused, and a
 * fresh one is created and bound instead.
 */
export async function resolveAskThread(projectId: string): Promise<string | null> {
  if (!serverChatEnabled() || !projectId) return null;
  try {
    const chats = await listProjectChats(projectId);
    const owned = chats
      .filter((c) => String(c.metadata?.origin || '') === ASK_ORIGIN)
      .filter((c) => String(c.metadata?.project_id || '') === projectId)
      .filter((c) => c.mode === null || c.mode === '' || c.mode === 'chat')
      .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
    return owned.length > 0 ? owned[0].id : null;
  } catch {
    return null;
  }
}

/**
 * Create the project's inline-Ask conversation and file it under the project.
 *
 * The binding is what makes the answer project-aware: `/v2/chat/stream` injects
 * Project Context from `project_id`, and Chat resolves the same binding when
 * the user later continues the conversation there. A thread that cannot be
 * filed is NOT used — an unbound conversation would answer without the
 * project's context and would show up in the wrong place, which is worse than
 * a truthful failure.
 */
async function createAskThread(projectId: string, title: string): Promise<string | null> {
  const threadId = await createChatThread(title, { origin: ASK_ORIGIN, project_id: projectId });
  if (!threadId) return null;
  const bound = await bindThreadToProject(threadId, projectId);
  return bound.ok ? threadId : null;
}

/**
 * Ask one question inside the Project Workspace and stream the answer back.
 *
 * Returns a handle immediately; everything else arrives through the callbacks.
 * `cancel()` (also called on unmount / navigation) stops the stream — the
 * question and whatever answer had already been persisted remain, so nothing
 * is half-written and the conversation is still resumable in Chat.
 *
 * Duplicate-click protection is the CALLER's: a handle is one exchange, and the
 * page keeps at most one in flight.
 */
export function askInWorkspace(
  projectId: string,
  question: string,
  callbacks: AskCallbacks,
  options: {
    threadId?: string | null;
    title?: string;
    /** Reuse on RETRY so the question is not persisted twice. */
    questionMessageId?: string;
  } = {},
): AskHandle {
  const controller = new AbortController();
  const questionMessageId = options.questionMessageId || newId();
  //: Set by `stop()` only. It is what tells the abort handler below whether the
  //: partial answer was chosen or merely interrupted.
  let stopped = false;
  const handle: AskHandle = {
    threadId: options.threadId || null,
    questionMessageId,
    stop: () => { stopped = true; controller.abort(); },
    cancel: () => controller.abort(),
  };
  const text = (question || '').trim();
  if (!text) {
    callbacks.onError('empty');
    return handle;
  }
  if (!serverChatEnabled()) {
    // A guest has no durable conversation to append to. Saying so is better
    // than streaming an answer that would vanish on reload.
    callbacks.onError('unavailable');
    return handle;
  }

  void (async () => {
    // ── 1. the conversation ──────────────────────────────────────────────
    let threadId = options.threadId || await resolveAskThread(projectId);
    if (!threadId) {
      threadId = await createAskThread(projectId, options.title || text.slice(0, 60));
    }
    if (!threadId) {
      callbacks.onError('thread');
      return;
    }
    if (controller.signal.aborted) return;
    handle.threadId = threadId;
    callbacks.onThread?.(threadId);

    // ── 2. the conversation's real history, so a follow-up is a follow-up ─
    // Read BEFORE the question is appended, and the question is added to the
    // request explicitly below — so a retry (which re-posts the same question
    // idempotently) can never send it twice in one prompt.
    const history = (await listThreadMessages(threadId, MAX_HISTORY_TURNS))
      .filter((m) => !(m.role === 'user' && m.content === text))
      .slice(-MAX_HISTORY_TURNS);
    if (controller.signal.aborted) return;

    // ── 3. persist the user's turn BEFORE asking ─────────────────────────
    // If the stream then fails, the question is still on the record and the
    // user can retry or open the conversation — rather than a question that
    // was asked, answered nowhere, and left no trace.
    await appendThreadMessage(threadId, {
      role: 'user', content: text, clientMessageId: questionMessageId,
    });
    if (controller.signal.aborted) return;

    // ── 4. the ONE streaming AI path ─────────────────────────────────────
    let accumulated = '';
    let sawDone = false;
    try {
      const response = await fetch(chatStreamUrl(), {
        method: 'POST',
        headers: authHeaders(),
        signal: controller.signal,
        body: JSON.stringify({
          messages: [...history, { role: 'user', content: text }],
          // A routing HINT. The backend re-verifies that the AUTHENTICATED
          // caller owns this project before injecting any project context, so
          // a tampered id yields no context rather than someone else's.
          project_id: projectId,
          ...getRequestLocale(text),
        }),
      });
      if (!response.ok || !response.body) {
        callbacks.onError('stream');
        return;
      }
      for await (const frame of readSSEFrames(response.body)) {
        if (controller.signal.aborted) break;
        if (frame.event === 'token') {
          let delta = '';
          try { delta = String(JSON.parse(frame.data)?.delta ?? ''); }
          catch { /* a malformed frame is skipped, never rendered */ }
          if (!delta) continue;
          accumulated += delta;
          callbacks.onToken(stripInternalMarkers(accumulated));
        } else if (frame.event === 'done') {
          sawDone = true;
          break;
        } else if (frame.event === 'error') {
          callbacks.onError('stream');
          return;
        }
      }
    } catch {
      // An abort is not a failure. A user-requested Stop falls through so the
      // partial answer is kept; an abandoned exchange returns here and writes
      // nothing further.
      if (!controller.signal.aborted) {
        callbacks.onError('network');
        return;
      }
      if (!stopped) return;
    }

    if (controller.signal.aborted && !stopped) return;

    const answer = stripInternalMarkers(accumulated).trim();
    if (!answer) {
      // A Stop before the first token leaves nothing to keep, and nothing to
      // complain about either — the user ended it deliberately.
      if (!stopped) callbacks.onError(sawDone ? 'empty' : 'stream');
      return;
    }

    // ── 5. persist the answer as a real assistant turn ───────────────────
    // Deliberately AFTER the stream, and deliberately not conditional on the
    // component still being mounted: the conversation is server truth, and a
    // user who navigated away mid-answer should still find the whole exchange
    // when they open it in Chat.
    await appendThreadMessage(threadId, {
      role: 'assistant', content: answer, clientMessageId: newId(),
    });
    callbacks.onDone(answer);
  })();

  return handle;
}
