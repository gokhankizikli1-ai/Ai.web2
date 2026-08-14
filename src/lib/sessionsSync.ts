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
import { getAccessToken } from '@/stores/authStore';
import { currentStorageScope } from '@/lib/storageScope';

const BUNDLED_BACKEND = 'https://worker-production-1345.up.railway.app';

function apiBase(): string {
  const env = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
  return env ? env.replace(/\/+$/, '') : BUNDLED_BACKEND;
}

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

function headers(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    const t = getAccessToken();
    if (t) h['Authorization'] = `Bearer ${t}`;
  } catch {
    /* token unreadable — the request will resolve as guest and likely 401,
       which we treat as a no-op */
  }
  return h;
}

/** Best-effort JSON call returning the v2 envelope's `data`, or null. */
async function call<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T | null> {
  try {
    const res = await fetch(`${apiBase()}${path}`, {
      method,
      headers: headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) return null;
    const json = await res.json().catch(() => null);
    if (!json || json.success === false) return null;
    return (json.data ?? null) as T | null;
  } catch {
    return null;
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
}

const MIRRORED_ROLES = new Set(['user', 'assistant']);
const NON_CHAT_MODES = new Set(['web_build', 'game_build']);
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
  if (NON_CHAT_MODES.has(String(session.mode ?? ''))) return false;
  return true;
}

/**
 * Mirror a conversation's turns to the server, idempotently.
 *
 * Creates the server thread lazily on first sync (returning its id so the
 * caller can stash it on the session). Uses the SERVER's current message count
 * as the watermark and appends only the local messages beyond it — so a repeat
 * call, a retry after a partial failure, or two overlapping syncs never
 * duplicate a turn.
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

  // Watermark = messages already on the server. Append only the tail.
  const existing = await call<{ messages?: ServerMessage[] }>(
    'GET',
    `/v2/sessions/threads/${encodeURIComponent(threadId)}/messages?limit=${MAX_HYDRATED_MESSAGES}`,
  );
  const alreadyStored = existing?.messages?.length ?? 0;
  for (let i = alreadyStored; i < local.length; i++) {
    const m = local[i];
    const ok = await call('POST', `/v2/sessions/threads/${encodeURIComponent(threadId)}/messages`, {
      role: m.role,
      content: m.content,
    });
    // Stop on the first failed append; the next sync resumes from the server
    // watermark, so nothing is lost or duplicated.
    if (ok === null) break;
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
  const threads = (data?.threads || []).filter((t) => !NON_CHAT_MODES.has(String(t.mode ?? '')));
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
