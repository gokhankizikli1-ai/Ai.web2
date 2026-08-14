/**
 * sessionsSync — server-authoritative chat history (Phase 3).
 *
 * The backend `/v2/sessions/*` store (workspaces → threads → messages) is the
 * CANONICAL conversation history; localStorage is only a fast-start cache. This
 * module is the thin, best-effort client that keeps the two in sync:
 *
 *   • hydrateFromServer() — pull the signed-in user's server threads on load so
 *     a cleared cache / new device / new browser restores real history.
 *   • syncSession()       — mirror a conversation's turns to the server as they
 *     happen, idempotently (the server message count is the watermark, so a
 *     retry never duplicates a turn).
 *
 * DESIGN RULES (so it can never break the existing chat UX):
 *   • Every call is best-effort: any network/parse failure resolves to a safe
 *     empty/no-op value and NEVER throws. A server outage or a local save
 *     failure must not delete or corrupt the other side's truth.
 *   • Only authenticated users get server truth (a real `user_<id>` scope);
 *     guests keep the localStorage-only path. Force-off via VITE_SERVER_CHAT.
 *   • Only ordinary chat threads are mirrored/hydrated. Web/App Build sessions
 *     carry a separate payload authority and are intentionally left to it.
 */
import type { ChatSession, Message } from '@/types';
import { currentStorageScope } from '@/lib/storageScope';
import { apiCall as call } from '@/lib/serverApi';

/**
 * Server-authoritative chat is active for AUTHENTICATED users only — a real
 * `user_<id>` storage scope. Guests keep the localStorage-only fast path (there
 * is no durable server identity to key their history on). `VITE_SERVER_CHAT=false`
 * force-disables it for a clean rollback.
 */
export function serverChatEnabled(): boolean {
  const flag = (import.meta.env.VITE_SERVER_CHAT as string | undefined)?.trim().toLowerCase();
  if (flag === 'false' || flag === '0' || flag === 'no') return false;
  try {
    return currentStorageScope().startsWith('user_');
  } catch {
    return false;
  }
}

// ── Raw server shapes (only the fields we consume) ──────────────────────────

interface ServerThread {
  id: string;
  title?: string;
  mode?: string | null;
  updated_at?: string | null;
  metadata?: Record<string, unknown> | null;
}
interface ServerMessage {
  id: string;
  role?: string;
  content?: string;
  created_at?: string | null;
  client_message_id?: string | null;
}

const MIRRORED_ROLES = new Set(['user', 'assistant']);
// ORDINARY chat only. ChatSession.mode is the canonical ConversationMode:
// 'chat' | 'web_build' | 'game_build', and a plain chat leaves it undefined.
// Web AND App builds both persist as mode 'web_build' (the web|app axis lives on
// the WebBuildPayload, not the session), and any future tool/build mode is a new
// ConversationMode. An ALLOWLIST — mirror only when the mode is unset or 'chat' —
// therefore excludes every build/tool session by construction, so a large build
// or tool transcript is never mirrored into ordinary chat history.
const CHAT_MODES = new Set(['chat']);
const MAX_HYDRATED_THREADS = 40;
const MAX_HYDRATED_MESSAGES = 500;

// One default-workspace lookup per page load — cached so we don't re-hit
// ensure_default on every turn.
let _workspaceIdPromise: Promise<string | null> | null = null;

async function ensureWorkspaceId(): Promise<string | null> {
  if (!_workspaceIdPromise) {
    _workspaceIdPromise = call<{ id?: string }>('POST', '/v2/sessions/workspaces/ensure_default')
      .then((d) => (d && d.id ? d.id : null))
      .catch(() => null);
  }
  const id = await _workspaceIdPromise;
  // On failure, drop the cache so a later call can retry a transient outage.
  if (!id) _workspaceIdPromise = null;
  return id;
}

/** Reset cached state — for tests and for identity changes (logout/login). */
export function resetSessionsSync(): void {
  _workspaceIdPromise = null;
}

function isMirrorable(session: ChatSession): boolean {
  // Allowlist: ordinary chat only (mode unset or 'chat'). Everything else — every
  // build/tool mode, now or future — is excluded.
  const mode = session.mode;
  return mode === undefined || mode === null || CHAT_MODES.has(String(mode));
}

/**
 * Mirror a conversation's turns to the server, idempotently.
 *
 * Creates the server thread lazily on first sync (returning its id so the
 * caller can stash it on the session), then does an IDENTITY-BASED delta: it
 * reads the message ids already on the server and posts only the local messages
 * the server doesn't have, each carrying its STABLE chat message id as the
 * idempotency key (`client_message_id`). This is correct regardless of history
 * length and safe under retries / overlapping syncs / multiple tabs — the
 * server's per-thread unique key collapses any duplicate to one canonical row
 * (a re-post is recognised, never re-inserted). No count watermark is used.
 *
 * Returns the server thread id (existing or freshly created), or null when
 * server chat is disabled / unreachable. Never throws.
 */
export async function syncSession(session: ChatSession): Promise<string | null> {
  if (!serverChatEnabled() || !isMirrorable(session)) return null;
  const local = (session.messages || []).filter(
    (m) => MIRRORED_ROLES.has(m.role) && typeof m.content === 'string' && m.content.length > 0,
  );
  if (local.length === 0) return session.serverThreadId ?? null;

  let threadId = session.serverThreadId ?? null;
  if (!threadId) {
    const wsId = await ensureWorkspaceId();
    if (!wsId) return null;
    const created = await call<ServerThread>(
      'POST',
      `/v2/sessions/workspaces/${encodeURIComponent(wsId)}/threads`,
      { title: session.title || 'New chat', mode: session.mode || 'chat' },
    );
    if (!created || !created.id) return null;
    threadId = created.id;
  }

  // Identity set of what the server already has. A local message matches by its
  // own id OR by the stored client_message_id — so neither hydrated messages
  // (carrying the server row id) nor previously-synced local messages are ever
  // re-posted. (Bounded page; anything beyond it that we re-post is deduped
  // server-side by the unique key, so correctness never depends on this GET.)
  const existing = await call<{ messages?: ServerMessage[] }>(
    'GET',
    `/v2/sessions/threads/${encodeURIComponent(threadId)}/messages?limit=${MAX_HYDRATED_MESSAGES}`,
  );
  const known = new Set<string>();
  for (const m of existing?.messages || []) {
    if (m.id) known.add(m.id);
    if (m.client_message_id) known.add(m.client_message_id);
  }

  for (const m of local) {
    if (known.has(m.id)) continue;
    const ok = await call('POST', `/v2/sessions/threads/${encodeURIComponent(threadId)}/messages`, {
      role: m.role,
      content: m.content,
      client_message_id: m.id,
    });
    // A failed append is safe to leave for the next sync — the stable id makes
    // the retry idempotent, so nothing is lost or duplicated.
    if (ok !== null) known.add(m.id);
  }
  return threadId;
}

/**
 * Pull the signed-in user's server chat history as ChatSessions. Bounded to the
 * most-recent threads/messages so hydration never dumps an unbounded history
 * into memory. Only ordinary chat threads are returned (Web/App Build threads
 * are owned by their own payload authority). Returns [] on any failure.
 */
export async function hydrateFromServer(): Promise<ChatSession[]> {
  if (!serverChatEnabled()) return [];
  const wsId = await ensureWorkspaceId();
  if (!wsId) return [];
  const data = await call<{ threads?: ServerThread[] }>(
    'GET',
    `/v2/sessions/workspaces/${encodeURIComponent(wsId)}/threads?limit=${MAX_HYDRATED_THREADS}`,
  );
  const threads = (data?.threads || []).filter(
    (t) => t.mode == null || t.mode === '' || CHAT_MODES.has(String(t.mode)),
  );
  const out: ChatSession[] = [];
  for (const t of threads.slice(0, MAX_HYDRATED_THREADS)) {
    const md = await call<{ messages?: ServerMessage[] }>(
      'GET',
      `/v2/sessions/threads/${encodeURIComponent(t.id)}/messages?limit=${MAX_HYDRATED_MESSAGES}`,
    );
    const messages: Message[] = (md?.messages || [])
      .filter((m) => MIRRORED_ROLES.has(String(m.role)) && typeof m.content === 'string')
      .map((m) => ({
        id: m.id,
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content as string,
        timestamp: m.created_at ? new Date(m.created_at) : new Date(),
      }));
    if (messages.length === 0) continue; // skip empty shells
    out.push({
      id: t.id,
      serverThreadId: t.id,
      title: t.title || 'Chat',
      messages,
      updatedAt: t.updated_at ? new Date(t.updated_at) : new Date(),
      mode: 'chat',
    });
  }
  return out;
}

/**
 * Merge server-hydrated sessions into the local set WITHOUT losing local data.
 * Local sessions are always kept; a server session is added only when no local
 * session already represents that server thread (dedup by serverThreadId, and
 * by id as a fallback). This makes cross-device restore additive and safe —
 * hydration can never delete or overwrite a local conversation.
 */
export function mergeServerSessions(
  local: ChatSession[],
  server: ChatSession[],
): ChatSession[] {
  const localThreadIds = new Set(
    local.map((s) => s.serverThreadId).filter((x): x is string => !!x),
  );
  const localIds = new Set(local.map((s) => s.id));
  const additions = server.filter(
    (s) => !(s.serverThreadId && localThreadIds.has(s.serverThreadId)) && !localIds.has(s.id),
  );
  if (additions.length === 0) return local;
  // Newest first among additions, appended after existing local sessions.
  additions.sort((a, b) => (b.updatedAt?.getTime?.() ?? 0) - (a.updatedAt?.getTime?.() ?? 0));
  return [...local, ...additions];
}
