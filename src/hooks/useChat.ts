import { useState, useCallback, useRef, useEffect } from 'react';
import type { ChatSession, Message, AIMode, WorkspaceTab, ChatFolder, AttachedAsset } from '@/types';
import { deriveSessionTitle } from '@/lib/chatTitles';

const generateId = () => Math.random().toString(36).substring(2, 9);

/**
 * Chat backend endpoint.
 *
 * ─── Why "Load failed" was happening ───────────────────────────────
 * The chat endpoint was hard-coded to a single Railway URL. When that
 * host is wrong / asleep / retired, or the backend doesn't send CORS
 * headers for the Vercel domain, the browser `fetch` rejects with
 * `TypeError: Load failed` (WebKit) / `Failed to fetch` (Chrome). The
 * catch block piped that raw message straight into the error banner —
 * a dead-end "Load failed" / Retry state with no backend connected.
 *
 * Resolution order now:
 *   1. VITE_API_URL — set this in Vercel → Settings → Environment
 *      Variables to point at the real backend ("/chat" is appended).
 *   2. The hard-coded Railway worker as a last-resort default.
 *
 * If the resolved endpoint still can't be reached, doSend() degrades
 * to a local demo reply instead of failing the chat (see its catch).
 */
// Bundled default — the same Railway host that useTradingSignals.ts hits
// (confirmed live, returns 200 on /health). When VITE_API_URL isn't set
// on Vercel we fall back to this so chat hits the SAME backend trading
// is already using, instead of a dead host that forces demo mode.
const BUNDLED_BACKEND = 'https://worker-production-1345.up.railway.app';

function resolveApiUrl(): string {
  const envBase = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
  if (envBase) return `${envBase.replace(/\/+$/, '')}/chat`;
  console.warn(
    `[useChat] VITE_API_URL is not set — using the bundled backend ` +
    `${BUNDLED_BACKEND}. If chat still falls back to demo mode the live ` +
    `backend either rejected the request or didn't send a CORS header ` +
    `for this origin. Set VITE_API_URL in the Vercel environment to ` +
    `override.`,
  );
  return `${BUNDLED_BACKEND}/chat`;
}

const API_URL = resolveApiUrl();

/* ─── Per-user storage keys (production fix 2026-06-28) ─────────────────
 *
 * Chat history is now namespaced by the authenticated user_id so that:
 *   - User A's sessions persist across A's logout/login cycle
 *     (key `korvix_sessions_<A>` survives the wipe).
 *   - User B never reads A's sessions even on the same browser
 *     (key `korvix_sessions_<B>` is a different localStorage entry).
 *   - Guest sessions are scoped to the browser nonce so guest history
 *     persists per-device without leaking across explicit accounts.
 *
 * authStore.logout() no longer wipes these keys — isolation is
 * structural (per-user key), not destructive. The unsuffixed legacy
 * keys (`korvix_sessions`, `korvix_active_session_id`) are still in
 * the wipe list so any pre-PR data left in localStorage is cleared.
 */
const SESSIONS_KEY_BASE = 'korvix_sessions';
const ACTIVE_SESSION_KEY_BASE = 'korvix_active_session_id';

/** Return the localStorage scope for the current identity.
 *
 * Authenticated user → `user_<id>` (id from zustand's persisted
 * `korvix-auth` blob, written by authStore on every login). Guest →
 * `guest_<browser_nonce>` (the same `korvix_user_id` value useChat
 * sends as `req.user_id` for guests). Falls back to `guest_anon` if
 * storage is unavailable (private mode) — guarantees the function
 * never returns the empty string, so storage keys are always
 * well-defined.
 */
function currentStorageScope(): string {
  // Authenticated identity — read directly from the zustand persist
  // blob so this hook doesn't have to import authStore (avoids a
  // circular dep between auth and chat layers).
  try {
    const blob = localStorage.getItem('korvix-auth');
    if (blob) {
      const parsed = JSON.parse(blob);
      const uid = parsed?.state?.user?.id;
      if (typeof uid === 'string' && uid) return `user_${uid}`;
    }
  } catch { /* fall through to guest */ }
  // Guest — same nonce used by the backend as the X-Korvix-Guest-Id
  // header. authStore.wipeUserScopedStorage() rotates this on every
  // logout, so the guest scope changes whenever the prior account
  // signs out (cross-account isolation stays intact).
  try {
    const nonce = localStorage.getItem('korvix_user_id');
    if (typeof nonce === 'string' && nonce) return `guest_${nonce}`;
  } catch { /* ignore */ }
  return 'guest_anon';
}

function sessionsKey(): string {
  return `${SESSIONS_KEY_BASE}_${currentStorageScope()}`;
}
function activeSessionKey(): string {
  return `${ACTIVE_SESSION_KEY_BASE}_${currentStorageScope()}`;
}

/* ═══════════════════════════════════════════
   STREAMING (Phase 1.1) — opt-in via VITE_CHAT_STREAMING=true
   ═══════════════════════════════════════════
   When enabled, doSend() POSTs to /v2/chat/stream and renders
   token-by-token (ChatGPT/Claude-style). Any failure — bad status,
   error frame, network drop, empty stream — falls back to the
   legacy /chat path so the user always sees a reply. The same
   placeholder assistant bubble is reused across all paths so the
   user never sees a duplicate message. */
const STREAMING_ENABLED: boolean = (() => {
  const raw = (import.meta.env.VITE_CHAT_STREAMING as string | undefined)
    ?.trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes';
})();

const STREAM_URL: string = (() => {
  const envBase = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
  const base = envBase ? envBase.replace(/\/+$/, '') : BUNDLED_BACKEND;
  return `${base}/v2/chat/stream`;
})();

/**
 * Parse a fetch() response body as a stream of SSE frames.
 *
 * Robust to:
 *   - UTF-8 characters split across chunk boundaries (TextDecoder streaming)
 *   - Partial frames arriving in pieces (buffer until \n\n or \r\n\r\n)
 *   - CRLF or LF line endings
 *   - Multi-line `data:` (joined with \n per the SSE spec)
 *   - Comment lines starting with `:`
 *
 * Yields one {event, data} object per terminated SSE frame. Generator
 * completes when the upstream stream closes; the caller decides what to
 * do if a terminal `done` or `error` frame wasn't observed.
 */
async function* readSSEFrames(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<{ event: string; data: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  const parseFrame = (raw: string): { event: string; data: string } | null => {
    let event = 'message';
    let data = '';
    for (const line of raw.split(/\r?\n/)) {
      if (!line || line.startsWith(':')) continue;
      if (line.startsWith('event:')) {
        event = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        const part = line.slice(5).replace(/^ /, '');
        data = data ? `${data}\n${part}` : part;
      }
    }
    if (!data && event === 'message') return null;
    return { event, data };
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep: RegExpMatchArray | null;
      while ((sep = buffer.match(/\r?\n\r?\n/))) {
        const idx = sep.index!;
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + sep[0].length);
        const parsed = parseFrame(frame);
        if (parsed) yield parsed;
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) {
      const parsed = parseFrame(buffer);
      if (parsed) yield parsed;
    }
  } finally {
    try { reader.releaseLock(); } catch { /* ignore */ }
  }
}

/**
 * Local placeholder reply used when the chat backend is unreachable or
 * not connected yet. Keeps the chat usable in a demo state instead of
 * dead-ending on a "Load failed" error — see doSend()'s catch block.
 */
function generateDemoReply(userMessage: string): string {
  const text = userMessage.trim().toLowerCase();
  const isGreeting = /^(merhaba|selam|hey|hi|hello|good morning|günaydın|iyi günler)\b/.test(text);
  const isQuestion = text.endsWith('?') ||
    /^(what|how|why|when|where|who|which|nedir|nasıl|neden|ne zaman|kim)\b/.test(text);

  const banner =
    '\n\n— KorvixAI backend is not connected yet, but the frontend demo ' +
    'is working. The reply above is a local placeholder. Set VITE_API_URL ' +
    'in the Vercel environment (or start the backend) to get real AI answers.';

  if (isGreeting) {
    return 'Merhaba! 👋 KorvixAI is here — currently running in demo mode. '
      + 'Once the backend is connected I can help with real answers.' + banner;
  }
  if (isQuestion) {
    return "Good question. I'd normally research this and answer in detail, "
      + 'but the AI backend is offline for this deployment right now.' + banner;
  }
  return "Got it — I've added your message to this conversation. I can't "
    + 'generate a full AI response yet because the backend is offline.' + banner;
}

function getUserId(): string {
  const key = 'korvix_user_id';
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : generateId() + generateId();
    localStorage.setItem(key, id);
  }
  return id;
}

function createEmptySession(title?: string): ChatSession {
  return {
    id: generateId(),
    title: title || 'New Conversation',
    messages: [],
    updatedAt: new Date(),
    folder: 'none',
  };
}

/* ─── Session persistence ───
   The load path is deliberately forgiving: a malformed or partial
   localStorage payload is repaired entry-by-entry rather than wiping
   every conversation. Each session/message is normalized into a full,
   correctly-typed shape (string id/title, Date timestamps). */
function normalizeMessage(raw: unknown): Message | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  const role = m.role === 'user' || m.role === 'assistant' ? m.role : null;
  if (!role) return null;
  const content = typeof m.content === 'string' ? m.content : '';
  const id = typeof m.id === 'string' && m.id ? m.id : generateId();
  const tsRaw = m.timestamp;
  let timestamp: Date;
  if (tsRaw instanceof Date) {
    timestamp = tsRaw;
  } else if (typeof tsRaw === 'string' || typeof tsRaw === 'number') {
    const d = new Date(tsRaw);
    timestamp = Number.isNaN(d.getTime()) ? new Date() : d;
  } else {
    timestamp = new Date();
  }
  // Phase 9 — preserve attachments across reloads. Defensive
  // normalisation: drop anything that doesn't look like a real
  // AttachedAsset shape so stale localStorage can't crash render.
  let attachments: AttachedAsset[] | undefined;
  const rawAtt = m.attachments;
  if (Array.isArray(rawAtt) && rawAtt.length > 0) {
    attachments = rawAtt
      .filter((a): a is Record<string, unknown> =>
        !!a && typeof a === 'object')
      .map((a) => ({
        asset_id:   typeof a.asset_id   === 'string' ? a.asset_id   : '',
        filename:   typeof a.filename   === 'string' ? a.filename   : 'asset',
        mime_type:  typeof a.mime_type  === 'string' ? a.mime_type  : 'application/octet-stream',
        size_bytes: typeof a.size_bytes === 'number' ? a.size_bytes : 0,
        public_url: typeof a.public_url === 'string' ? a.public_url : undefined,
        asset_type: typeof a.asset_type === 'string' ? a.asset_type : undefined,
      }))
      .filter((a) => !!a.asset_id);
    if (attachments.length === 0) attachments = undefined;
  }
  // Preserve web sources across reloads. Defensive: keep only entries
  // with a real http[s] url so stale/garbage storage can't break render.
  let sources: { url: string; title?: string }[] | undefined;
  const rawSrc = m.sources;
  if (Array.isArray(rawSrc) && rawSrc.length > 0) {
    sources = rawSrc
      .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
      .map((x) => ({
        url: typeof x.url === 'string' ? x.url : '',
        ...(typeof x.title === 'string' ? { title: x.title } : {}),
      }))
      .filter((x) => /^https?:\/\//i.test(x.url));
    if (sources.length === 0) sources = undefined;
  }
  return { id, role, content, timestamp,
           ...(attachments ? { attachments } : {}),
           ...(sources ? { sources } : {}) };
}

function normalizeSession(raw: unknown): ChatSession | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;

  const messagesRaw = Array.isArray(s.messages) ? s.messages : [];
  const normalized: Message[] = messagesRaw
    .map(normalizeMessage)
    .filter((m): m is Message => m !== null);
  // Conservative hydration dedupe — protects against any historical
  // double-append (same id, or an identical role+content pair landing
  // back-to-back within a 2s window). Only ever collapses adjacent
  // exact duplicates; distinct messages and repeated legitimate
  // questions are never removed.
  const messages: Message[] = [];
  const seenIds = new Set<string>();
  for (const m of normalized) {
    if (seenIds.has(m.id)) continue;
    const prev = messages[messages.length - 1];
    if (prev && prev.role === m.role && prev.content === m.content && m.content &&
        Math.abs(m.timestamp.getTime() - prev.timestamp.getTime()) < 2000) {
      continue;
    }
    seenIds.add(m.id);
    messages.push(m);
  }

  const id = typeof s.id === 'string' && s.id ? s.id : generateId();

  // Title fallback: explicit title → first user message (≤40 chars) → "New Chat"
  const explicitTitle = typeof s.title === 'string' ? s.title.trim() : '';
  const firstUserMsg = messages.find((m) => m.role === 'user')?.content?.trim() ?? '';
  const title = explicitTitle || firstUserMsg.slice(0, 40) || 'New Chat';

  const updatedAtRaw = s.updatedAt;
  let updatedAt: Date;
  if (updatedAtRaw instanceof Date) {
    updatedAt = updatedAtRaw;
  } else if (typeof updatedAtRaw === 'string' || typeof updatedAtRaw === 'number') {
    const d = new Date(updatedAtRaw);
    updatedAt = Number.isNaN(d.getTime()) ? new Date() : d;
  } else {
    updatedAt = new Date();
  }

  return {
    id,
    title,
    messages,
    updatedAt,
    folder: (s.folder as ChatFolder) || 'none',
    isFavorite: !!s.isFavorite,
    isArchived: !!s.isArchived,
    isDemo: !!s.isDemo,
  };
}

function loadSessions(): ChatSession[] | null {
  try {
    const raw = localStorage.getItem(sessionsKey());
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    const normalized = parsed
      .map(normalizeSession)
      .filter((s): s is ChatSession => s !== null);
    return normalized.length > 0 ? normalized : null;
  } catch { /* ignore */ }
  return null;
}

function saveSessions(sessions: ChatSession[]) {
  try {
    localStorage.setItem(sessionsKey(), JSON.stringify(sessions));
  } catch { /* ignore */ }
}

/* ─── Active-session persistence ─── */
function loadActiveSessionId(): string | null {
  try {
    const raw = localStorage.getItem(activeSessionKey());
    return typeof raw === 'string' && raw.length > 0 ? raw : null;
  } catch { return null; }
}

function saveActiveSessionId(id: string) {
  try {
    if (id) localStorage.setItem(activeSessionKey(), id);
  } catch { /* ignore */ }
}

/**
 * Choose which session to activate when the hook mounts. Priority:
 *   1. The persisted activeSessionId, if it still resolves to a session
 *      that exists (covers refresh + Home→back round-trips).
 *   2. The most-recently-updated session that HAS messages — so a user
 *      returning to /chat after sending a message lands on it, not on
 *      an empty placeholder that happens to be at index 0.
 *   3. The most-recently-updated session overall.
 *   4. The first session in the array, or a fresh id as a last resort.
 */
function pickInitialActiveId(sessions: ChatSession[]): string {
  if (!sessions.length) return generateId();
  const stored = loadActiveSessionId();
  if (stored && sessions.some((s) => s.id === stored)) return stored;
  const withMessages = sessions
    .filter((s) => s.messages.length > 0)
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  if (withMessages.length) return withMessages[0].id;
  const sorted = [...sessions].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  return sorted[0]?.id || sessions[0].id;
}

/* ═══════════════════════════════════════════
   MODE-ISOLATED SESSION STATE
   Each workspace tab maintains its own session.
   No cross-mode contamination.
   ═══════════════════════════════════════════ */

export const TAB_KEYS: WorkspaceTab[] = ['chat', 'research', 'coding', 'startup', 'study', 'creative', 'trading', 'business', 'agents'];

function loadTabSessions(): Record<string, string> {
  try {
    const raw = localStorage.getItem('korvix_tab_sessions');
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return {};
}

function saveTabSessions(map: Record<string, string>) {
  localStorage.setItem('korvix_tab_sessions', JSON.stringify(map));
}

export function useChat() {
  // Load persisted sessions or create fresh ones. `hadPersistedSessions`
  // lets the save-effect below skip its first run when we just hydrated
  // from disk — saving the same bytes back is a no-op, and skipping it
  // removes any window where a transient empty state could clobber a
  // real conversation.
  const persisted = loadSessions();
  const hadPersistedSessions = !!(persisted && persisted.length > 0);
  const initialSessions = hadPersistedSessions
    ? (persisted as ChatSession[])
    // Seed sessions only for reachable tabs — Research is gone from the
    // nav, Trading is owner-only, Agents redirects to /projects. Their
    // sessions are still created lazily by switchTab when actually
    // visited, so nothing breaks for owners/legacy links.
    : TAB_KEYS.filter((tab) => !['research', 'trading', 'agents'].includes(tab))
        .map((tab) => createEmptySession(`New ${tab.charAt(0).toUpperCase() + tab.slice(1)}`));
  const [sessions, setSessions] = useState<ChatSession[]>(initialSessions);
  // Restore the last-active session id so Home→back / refresh lands the
  // user on the SAME conversation they were viewing, not on the empty
  // placeholder that happens to be at index 0.
  const [activeSessionId, setActiveSessionId] = useState<string>(
    () => pickInitialActiveId(initialSessions),
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUserMessage, setLastUserMessage] = useState<string | null>(null);
  // Phase 10 fix — current tool activity (e.g. "Analyzing repository
  // openai/openai-python") surfaced while the backend runs the
  // github_repo tool before the LLM stream opens. Null when no tool
  // is in flight.
  const [toolActivity, setToolActivity] = useState<import('@/types').ToolActivity | null>(null);
  const userIdRef = useRef<string>(getUserId());
  // Phase 9 fix — `retry` and the composer need to know the LAST attached
  // assets so a retry after a stream failure replays the same attachment
  // set instead of degrading to text-only.
  const lastAttachmentsRef = useRef<AttachedAsset[]>([]);

  // Mirror of `sessions` for synchronous reads inside async callbacks
  // (the streaming path builds the conversation payload from prior
  // messages and can't depend on the async-batched `sessions` state).
  const sessionsRef = useRef<ChatSession[]>(sessions);
  useEffect(() => { sessionsRef.current = sessions; }, [sessions]);

  const [aiMode, setAiMode] = useState<AIMode>('fast');
  const [pinnedMessages, setPinnedMessages] = useState<Message[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [inputText, setInputText] = useState('');
  const [activeTools, setActiveTools] = useState<string[]>([]);
  const [memoryRefs, setMemoryRefs] = useState<string[]>([]);

  // Per-tab session isolation
  const [tabSessionMap, setTabSessionMap] = useState<Record<string, string>>(loadTabSessions);
  const [currentTab, setCurrentTab] = useState<WorkspaceTab>('chat');

  // Persist tab session map
  useEffect(() => {
    saveTabSessions(tabSessionMap);
  }, [tabSessionMap]);

  // Persist all sessions to localStorage for workspace persistence
  // across refresh. Skip the very first run when sessions were just
  // hydrated from disk — writing the same bytes back is wasteful and,
  // more importantly, removes any window where a transient empty state
  // could overwrite a real conversation with empty placeholders.
  const sessionsHydratedRef = useRef<boolean>(hadPersistedSessions);
  useEffect(() => {
    if (sessionsHydratedRef.current) {
      sessionsHydratedRef.current = false;
      return;
    }
    saveSessions(sessions);
  }, [sessions]);

  // Persist activeSessionId so a Home→back round-trip (or refresh)
  // restores the conversation the user was last viewing.
  useEffect(() => {
    saveActiveSessionId(activeSessionId);
  }, [activeSessionId]);

  const activeSession = sessions.find((s) => s.id === activeSessionId) || sessions[0];

  /* ─── Sidebar: filter out empty auto-created sessions ───
     Only show sessions that have real messages (user-created chats).
     Keep the active session even if empty so the user isn't confused.
     Limit to 7 most recent real conversations.
     Mode-shortcut empty sessions ("New Chat", "New Research" etc.)
     are filtered out — they exist for tab isolation, not as history. */
  const filteredSessions = sessions
    .filter((s) => {
      // Always include the active session
      if (s.id === activeSessionId) return true;
      // Include sessions with actual messages (real conversations)
      if (s.messages.length > 0) return true;
      // Exclude empty "New X" auto-created sessions
      return false;
    })
    .filter((s) => {
      if (!searchQuery) return true;
      return s.title.toLowerCase().includes(searchQuery.toLowerCase());
    })
    // Sort by most recently updated, limit to 7 visible in sidebar
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .slice(0, 7);

  /* ─── Pending session title (handoff auto-naming) ───
     Startup Radar → Advisor/Builder handoffs (and any future flow) can
     stage a human title ("Startup: AI support tools") so the session
     never sits as "New Chat". State-driven so the sidebar renames
     IMMEDIATELY — both when the handoff switches tabs (the batched
     activeSessionId change re-runs the effect with the target session)
     and when the user is already on the target tab (the pendingTitle
     change alone re-runs it). Consumed at latest on the first send.
     Only ever renames unused "New X" sessions — real conversations
     keep their titles. */
  const [pendingTitle, setPendingTitle] = useState<string | null>(null);
  const pendingTitleRef = useRef<string | null>(null);
  const setPendingSessionTitle = useCallback((title: string) => {
    const t = (title || '').trim() || null;
    pendingTitleRef.current = t;
    setPendingTitle(t);
  }, []);
  useEffect(() => {
    if (!pendingTitle) return;
    const active = sessionsRef.current.find((s) => s.id === activeSessionId);
    if (!active || !active.title.startsWith('New ')) return;
    setSessions((prev) => prev.map((s) =>
      s.id === activeSessionId && s.title.startsWith('New ') ? { ...s, title: pendingTitle } : s,
    ));
    // Applied — clear so a later manual tab switch can't rename another
    // fresh session. (doSend keeps its own ref copy as the fallback.)
    setPendingTitle(null);
  }, [pendingTitle, activeSessionId]);

  /* ─── Switch to a tab — activates that tab's isolated session ─── */
  const switchTab = useCallback((tab: WorkspaceTab) => {
    setCurrentTab(tab);
    setError(null);
    setInputText('');
    setIsLoading(false);

    const existingId = tabSessionMap[tab];
    if (existingId && sessions.some((s) => s.id === existingId)) {
      setActiveSessionId(existingId);
    } else {
      // Create a new isolated session for this tab
      const newSession = createEmptySession(`New ${tab.charAt(0).toUpperCase() + tab.slice(1)}`);
      setSessions((prev) => [newSession, ...prev]);
      setActiveSessionId(newSession.id);
      setTabSessionMap((prev) => ({ ...prev, [tab]: newSession.id }));
    }
  }, [tabSessionMap, sessions]);

  /* ─── Create new chat for CURRENT tab ─── */
  const createNewChat = useCallback(() => {
    const newSession = createEmptySession(`New ${currentTab.charAt(0).toUpperCase() + currentTab.slice(1)}`);
    setSessions((prev) => [newSession, ...prev]);
    setActiveSessionId(newSession.id);
    setTabSessionMap((prev) => ({ ...prev, [currentTab]: newSession.id }));
    setInputText('');
    setActiveTools([]);
    setError(null);
    setIsLoading(false);
    return newSession.id;
  }, [currentTab]);

  const selectSession = useCallback((id: string) => {
    setActiveSessionId(id);
    // Update the current tab's session mapping
    setTabSessionMap((prev) => ({ ...prev, [currentTab]: id }));
    setError(null);
    setIsLoading(false);
  }, [currentTab]);

  /**
   * Append an assistant-role message to the active session. Used by
   * the owner-greeting effect (and any future system-level insertion)
   * to drop a message into the chat without going through the
   * user→backend→assistant pipeline.
   *
   * Caller owns dedup — this method always inserts. It also won't
   * insert into a session that already contains a message with the
   * same `content` as the most recent assistant message, so calling
   * it twice in a row (e.g. StrictMode double-render) is a no-op.
   */
  const insertSystemMessage = useCallback((content: string) => {
    if (!content?.trim()) return;
    setSessions((prev) => prev.map((s) => {
      if (s.id !== activeSessionId) return s;
      const last = s.messages[s.messages.length - 1];
      if (last && last.role === 'assistant' && last.content === content) {
        return s; // dedup
      }
      return {
        ...s,
        messages: [
          ...s.messages,
          {
            id: generateId(),
            role: 'assistant' as const,
            content,
            timestamp: new Date(),
          },
        ],
        updatedAt: new Date(),
      };
    }));
  }, [activeSessionId]);

  const deleteSession = useCallback((id: string) => {
    setSessions((prev) => {
      const filtered = prev.filter((s) => s.id !== id);
      if (filtered.length === 0) {
        const newSession = createEmptySession();
        setActiveSessionId(newSession.id);
        setTabSessionMap((m) => ({ ...m, [currentTab]: newSession.id }));
        return [newSession];
      }
      if (activeSessionId === id) {
        setActiveSessionId(filtered[0].id);
        setTabSessionMap((m) => ({ ...m, [currentTab]: filtered[0].id }));
      }
      return filtered;
    });
    setError(null);
  }, [activeSessionId, currentTab]);

  const doSend = useCallback(async (
    content: string,
    attachments: AttachedAsset[] = [],
  ): Promise<boolean> => {
    if (!content.trim() && attachments.length === 0) return false;
    const attachedAssetIds = attachments.map((a) => a.asset_id);
    const hasAssets = attachedAssetIds.length > 0;

    const trimmed = content.trim();
    setError(null);
    setLastUserMessage(trimmed);
    lastAttachmentsRef.current = attachments;
    setInputText('');

    const userMessage: Message = {
      id: generateId(),
      role: 'user',
      content: trimmed,
      timestamp: new Date(),
      // Phase 9 — Persist attachments on the user message so the
      // bubble can render asset chips even after a full page reload
      // (sessions are localStorage-persisted; attachments survive).
      ...(attachments.length > 0 ? { attachments } : {}),
    };

    // Consume the staged handoff title BEFORE queueing the state update —
    // the updater runs asynchronously, after the ref would be cleared.
    const stagedTitle = pendingTitleRef.current;
    pendingTitleRef.current = null;
    setPendingTitle(null);

    setSessions((prev) =>
      prev.map((s) =>
        s.id === activeSessionId
          ? {
              ...s,
              messages: [...s.messages, userMessage],
              updatedAt: new Date(),
              // Meaningful auto-title on the first message: handoff title
              // ("Startup: X") wins, then derived ("Research: topic"),
              // then the legacy first-40-chars fallback.
              title: s.title.startsWith('New ')
                ? (stagedTitle
                    ?? deriveSessionTitle(trimmed, currentTab)
                    ?? trimmed.slice(0, 40))
                : s.title,
            }
          : s
      )
    );

    setIsLoading(true);

    // Backend accepts an optional `mode` ("fast" | "deep_think" |
    // "research" | "coding" | "study" | …) for AI routing. The frontend
    // stores aiMode with a hyphen ("deep-think"); the backend uses
    // underscores. Omit when unknown so the backend falls back to
    // automatic intent-based routing.
    const KNOWN_BACKEND_MODES = new Set([
      'fast', 'deep_think', 'research', 'coding', 'study',
      'startup_advisor', 'marketing_dropshipping', 'trading_analyst',
    ]);
    const normalizedMode = aiMode ? aiMode.replace('-', '_') : '';
    let requestMode = KNOWN_BACKEND_MODES.has(normalizedMode) ? normalizedMode : undefined;
    // The Startup workspace is a specialized advisor surface, not generic
    // chat: its messages must run as startup_advisor on the backend so the
    // mode's founder persona + tools (startup_complaints, web_research)
    // activate. Only the default 'fast' mode is overridden — an explicit
    // user pick of a heavier mode (deep_think, research, …) is respected.
    if (currentTab === 'startup' && (!requestMode || requestMode === 'fast')) {
      requestMode = 'startup_advisor';
    }

    // When streaming creates a placeholder assistant message, both the
    // legacy /chat fallback and the demo fallback REPLACE that
    // placeholder in-place. This is the only thing that guarantees no
    // duplicate assistant bubble appears if streaming fails partway.
    let assistantId: string | null = null;
    // Web sources the backend actually used this turn — collected from
    // tool.completed (web_research / browser_fetch `urls`) and attached to
    // the assistant message so the bubble can show a "Show sources" drawer.
    // Deduped by url; never fabricated.
    const collectedSourceUrls: string[] = [];

    /* ── Streaming path (Phase 1.1, opt-in via VITE_CHAT_STREAMING) ──
       Phase 9 fix: when the turn carries attachments, FORCE streaming
       regardless of the VITE_CHAT_STREAMING flag. The legacy /chat
       endpoint (used below) does not accept `asset_ids` and would
       silently drop the user's attached image. /v2/chat/stream is the
       only endpoint that folds asset summaries into the system prompt
       (see backend/services/memory_plane/chat_integration.py
       build_asset_context_block). */
    const useStreaming = STREAMING_ENABLED || hasAssets;
    if (useStreaming) {
      try {
        // Build OpenAI-shaped messages from the conversation BEFORE the
        // new user message (which hasn't been committed to the ref yet
        // — state is async — so we append it manually).
        const priorMessages =
          sessionsRef.current.find((s) => s.id === activeSessionId)?.messages ?? [];
        const streamMessages = [
          ...priorMessages.map((m) => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
          })),
          { role: 'user' as const, content: trimmed },
        ];

        const response = await fetch(STREAM_URL, {
          method: 'POST',
          headers: (() => {
            // Phase 6 — include the JWT (when present) so the backend
            // can resolve the user's Memory Plane namespace. Without
            // this header the streaming route falls back to body
            // user_id, which is also sent below.
            const h: Record<string, string> = { 'Content-Type': 'application/json' };
            try {
              const tok = localStorage.getItem('korvix_access_token');
              if (tok) h['Authorization'] = `Bearer ${tok}`;
            } catch { /* ignore — localStorage may be disabled */ }
            return h;
          })(),
          body: JSON.stringify({
            messages: streamMessages,
            // Phase 6 — same `user_id` namespace as /chat so memories
            // saved via either path are visible to the other.
            user_id: userIdRef.current,
            ...(requestMode ? { mode: requestMode } : {}),
            // Phase 9 — attached assets. The backend
            // (v2_chat_stream.py) ownership-checks each id under
            // user_id and folds asset summaries into the system
            // prompt before the LLM call.
            ...(attachedAssetIds && attachedAssetIds.length > 0
              ? { asset_ids: attachedAssetIds } : {}),
          }),
        });

        if (!response.ok || !response.body) {
          throw new Error(`Stream request failed: HTTP ${response.status}`);
        }

        let accumulated = '';
        let sawDone = false;
        let streamError: { code?: string; message?: string } | null = null;

        for await (const frame of readSSEFrames(response.body)) {
          if (frame.event === 'token') {
            let delta = '';
            try { delta = String(JSON.parse(frame.data)?.delta ?? ''); } catch { /* skip malformed */ }
            if (!delta) continue;
            accumulated += delta;
            if (!assistantId) {
              // Create the assistant bubble on the FIRST token so the
              // typing indicator stays visible until real content arrives.
              const newId = generateId();
              assistantId = newId;
              setSessions((prev) =>
                prev.map((s) =>
                  s.id === activeSessionId
                    ? {
                        ...s,
                        messages: [
                          ...s.messages,
                          { id: newId, role: 'assistant', content: accumulated, timestamp: new Date() },
                        ],
                        updatedAt: new Date(),
                      }
                    : s
                )
              );
            } else {
              const targetId = assistantId;
              const live = accumulated;
              setSessions((prev) =>
                prev.map((s) =>
                  s.id === activeSessionId
                    ? {
                        ...s,
                        messages: s.messages.map((m) =>
                          m.id === targetId ? { ...m, content: live } : m
                        ),
                      }
                    : s
                )
              );
            }
          } else if (frame.event === 'done') {
            sawDone = true;
            break;
          } else if (frame.event === 'error') {
            try { streamError = JSON.parse(frame.data); }
            catch { streamError = { message: frame.data }; }
            break;
          } else if (frame.event === 'warning') {
            // Phase 9 vision — backend can emit a non-fatal warning
            // before tokens start. Currently used for
            // VISION_UNAVAILABLE ("This model doesn't support image
            // analysis"). Surface as an error banner so the user
            // notices — the existing one is non-fatal text, no
            // styling tweak needed.
            try {
              const w = JSON.parse(frame.data);
              if (w?.message && typeof w.message === 'string') {
                setError(w.message);
              }
            } catch { /* ignore malformed warning */ }
          } else if (frame.event === 'tool.started') {
            // Phase 10 fix — surface "Analyzing repository …" while
            // the github_repo tool fetches metadata + README + key
            // files. Brief: typically 3-8 s before tokens start.
            try {
              const t = JSON.parse(frame.data);
              const id = String(t?.tool_id || '');
              const label = (() => {
                if (id === 'github_repo') {
                  const subj = String(t?.input_summary || '').replace(/^repo:\s*/i, '');
                  return subj
                    ? `Analyzing repository ${subj}…`
                    : 'Analyzing repository…';
                }
                if (id === 'browser_fetch') {
                  const subj = String(t?.input_summary || '').replace(/^url:\s*/i, '');
                  return subj ? `Fetching ${subj}…` : 'Fetching page…';
                }
                if (id === 'web_research') {
                  const subj = String(t?.input_summary || '').replace(/^search:\s*/i, '');
                  return subj ? `Searching the web for "${subj}"…` : 'Searching the web…';
                }
                return id ? `Running ${id}…` : 'Running tool…';
              })();
              setToolActivity({
                toolId: id || 'tool',
                label,
                status: 'running',
                inputs: t?.input_summary ? [String(t.input_summary)] : undefined,
                startedAtMs: Date.now(),
              });
            } catch { /* ignore malformed tool.started */ }
          } else if (frame.event === 'tool.completed') {
            try {
              const t = JSON.parse(frame.data);
              const id = String(t?.tool_id || '');
              const succeeded = t?.succeeded === true;
              // GitHub flow uses `repos`; browser flow uses `urls`.
              // Phase 11 — the chip handles both shapes so users see
              // a coherent indicator regardless of which tool ran.
              const repos = Array.isArray(t?.repos) ? t.repos as string[] : [];
              const urls  = Array.isArray(t?.urls)  ? t.urls  as string[] : [];
              const subjects = repos.length ? repos : urls;
              // Persist real web sources (http[s] urls) for the message's
              // "Show sources" drawer — dedup, cap generous. Only genuine
              // urls the tool reported; nothing invented.
              if (succeeded && (id === 'web_research' || id === 'browser_fetch')) {
                for (const u of urls) {
                  if (typeof u === 'string' && /^https?:\/\//i.test(u) && !collectedSourceUrls.includes(u)) {
                    collectedSourceUrls.push(u);
                  }
                }
              }
              const successLabel = (() => {
                if (id === 'github_repo') {
                  return subjects.length
                    ? `Repository analyzed successfully — ${subjects.join(', ')}`
                    : 'Repository analyzed successfully';
                }
                if (id === 'browser_fetch') {
                  if (subjects.length === 1) {
                    // Pretty-print: drop scheme so chip stays compact.
                    const u = subjects[0].replace(/^https?:\/\//, '');
                    return `Page fetched — ${u}`;
                  }
                  return subjects.length
                    ? `${subjects.length} pages fetched`
                    : 'Page fetched';
                }
                if (id === 'web_research') {
                  // Phase 11 fix — chip surfaces the citation count
                  // so the user sees "Web search complete — 5 sources".
                  const count = typeof t?.citations === 'number' ? t.citations : 0;
                  return count > 0
                    ? `Web search complete — ${count} source${count === 1 ? '' : 's'}`
                    : 'Web search complete';
                }
                return subjects.length
                  ? `Inspected ${subjects.join(', ')}`
                  : 'Tool finished';
              })();
              const failLabel = (() => {
                if (id === 'browser_fetch') {
                  return subjects.length
                    ? `Could not fetch ${subjects.length === 1
                        ? subjects[0].replace(/^https?:\/\//, '')
                        : `${subjects.length} pages`}`
                    : 'Page fetch failed';
                }
                if (id === 'web_research') {
                  return 'Web search unavailable — answering from model knowledge';
                }
                return subjects.length
                  ? `Could not inspect ${subjects.join(', ')}`
                  : 'Tool returned no data';
              })();
              setToolActivity({
                toolId: id || 'tool',
                label: succeeded ? successLabel : failLabel,
                status: succeeded ? 'completed' : 'failed',
                inputs: subjects.length ? subjects : undefined,
                startedAtMs: Date.now(),
              });
              // Auto-clear after a short beat so the chip doesn't
              // linger past the next user turn.
              window.setTimeout(() => setToolActivity(null), 3500);
            } catch { /* ignore malformed tool.completed */ }
          } else if (frame.event === 'tool.debug') {
            // Owner-only diagnostic payload — surface via window
            // event so an owner-mode workspace panel can render it.
            // We deliberately DON'T put raw tool payloads into the
            // chat history (they can be large and contain README
            // text already in the system prompt).
            try {
              const t = JSON.parse(frame.data);
              window.dispatchEvent(new CustomEvent('korvix:tool-debug', { detail: t }));
            } catch { /* ignore */ }
          }
          // `ready` / `message` / unknown → ignore by spec
        }

        if (streamError) {
          throw new Error(
            `Backend error frame: ${[streamError.code, streamError.message].filter(Boolean).join(' ')}`,
          );
        }
        if (!sawDone && accumulated.length === 0) {
          throw new Error('Stream ended without any content.');
        }

        // Attach any web sources gathered this turn to the assistant
        // message so the bubble can render a collapsed "Show sources"
        // drawer (never inline in the answer text).
        if (assistantId && collectedSourceUrls.length > 0) {
          const targetId = assistantId;
          const sources = collectedSourceUrls.map((url) => ({ url }));
          setSessions((prev) =>
            prev.map((s) =>
              s.id === activeSessionId
                ? { ...s, messages: s.messages.map((m) => (m.id === targetId ? { ...m, sources } : m)) }
                : s,
            ),
          );
        }

        // Success — assistant message is fully populated by token frames.
        setIsLoading(false);
        return true;
      } catch (streamErr) {
        const cause = streamErr instanceof Error ? streamErr.message : String(streamErr);
        // Phase 9 regression fix — when the streaming endpoint is
        // unreachable (404 because /v2/chat/stream isn't deployed on
        // the bundled worker URL, 5xx, CORS, network drop), do NOT
        // dead-end the user with a hard "could not attach files"
        // error. Fall through to legacy /chat with the asset
        // metadata folded into the user message text so the assistant
        // still sees what was attached. This is an HONEST degradation:
        // the AI can name the file and acknowledge its presence, even
        // though it can't run vision over it on the legacy endpoint.
        // No fake success — just a transparent context block.
        console.warn(
          `[useChat] Streaming failed (assets=${hasAssets}); falling ` +
          'back to non-streaming /chat with asset context inlined.\n' +
          `  endpoint : ${STREAM_URL}\n` +
          `  cause    : ${cause}`,
        );
        // Fall through to the legacy /chat path. If assistantId is set we
        // already created a placeholder bubble; the fallback paths below
        // REPLACE its content rather than appending a duplicate.
      }
    }

    /* ── Legacy /chat path (default + streaming fallback) ──
       Phase 9 regression fix — the legacy endpoint has no `asset_ids`
       field, so when we reach this path with attachments we INLINE
       the asset metadata into the user message text. The model sees
       e.g. "describe this image\n\n[Attached files: photo.png
       (245 KB, image/png)]" and can acknowledge what was attached
       even though it can't run vision over it on this endpoint.
       Honest degradation, not fake success. */
    const legacyMessage = hasAssets
      ? `${trimmed}\n\n[Attached files: ${attachments
          .map((a) => {
            const kb = a.size_bytes ? Math.max(1, Math.round(a.size_bytes / 1024)) : 0;
            const size = kb > 0 ? `, ${kb} KB` : '';
            return `${a.filename}${size}, ${a.mime_type || 'unknown'}`;
          })
          .join('; ')}]`
      : trimmed;
    try {
      const legacyHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
      // Forward the JWT so legacy /chat resolves the user under the
      // SAME identity namespace the asset upload landed in.
      try {
        const tok = localStorage.getItem('korvix_access_token');
        if (tok) legacyHeaders['Authorization'] = `Bearer ${tok}`;
      } catch { /* ignore */ }
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: legacyHeaders,
        body: JSON.stringify({
          user_id: userIdRef.current,
          message: legacyMessage,
          chat_id: activeSessionId,
          session_id: activeSessionId,
          platform: 'web',
          ...(requestMode ? { mode: requestMode } : {}),
        }),
      });

      if (!response.ok) {
        throw new Error(`Server responded with ${response.status}. Please try again.`);
      }

      const data = await response.json();
      const responseText = data.reply ?? data.response ?? data.message ?? JSON.stringify(data);

      if (assistantId) {
        const targetId = assistantId;
        setSessions((prev) =>
          prev.map((s) =>
            s.id === activeSessionId
              ? {
                  ...s,
                  messages: s.messages.map((m) =>
                    m.id === targetId ? { ...m, content: responseText, timestamp: new Date() } : m
                  ),
                  updatedAt: new Date(),
                }
              : s
          )
        );
      } else {
        const assistantMessage: Message = {
          id: generateId(),
          role: 'assistant',
          content: responseText,
          timestamp: new Date(),
        };
        setSessions((prev) =>
          prev.map((s) =>
            s.id === activeSessionId
              ? { ...s, messages: [...s.messages, assistantMessage], updatedAt: new Date() }
              : s
          )
        );
      }
    } catch (err) {
      /* ─── Graceful demo-mode fallback ──────────────────────────────
         The chat backend could not produce a usable reply. Common
         causes, in rough order of likelihood for a fresh Vercel deploy:
           • VITE_API_URL is unset, so we fell back to the bundled
             Railway URL which may be wrong / asleep / retired.
           • The backend is down or still deploying.
           • CORS — the backend didn't return an
             Access-Control-Allow-Origin header for this Vercel origin
             (a blocked request surfaces as "TypeError: Load failed" /
             "Failed to fetch").
           • A non-2xx response, or a 2xx with an empty/non-JSON body.
         Instead of dead-ending the user with a raw "Load failed"
         banner, append a local placeholder reply so the conversation
         stays usable until the real backend is connected. */
      console.error(
        '[useChat] Chat request failed — falling back to demo mode.\n' +
        `  endpoint : ${API_URL}\n` +
        `  cause    : ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}\n` +
        '  fix      : set VITE_API_URL in the Vercel environment to the ' +
        'live backend, and ensure that backend returns CORS headers for ' +
        'this origin.',
      );

      const demoContent = generateDemoReply(trimmed);
      if (assistantId) {
        const targetId = assistantId;
        setSessions((prev) =>
          prev.map((s) =>
            s.id === activeSessionId
              ? {
                  ...s,
                  messages: s.messages.map((m) =>
                    m.id === targetId ? { ...m, content: demoContent, timestamp: new Date() } : m
                  ),
                  updatedAt: new Date(),
                }
              : s
          )
        );
      } else {
        const demoMessage: Message = {
          id: generateId(),
          role: 'assistant',
          content: demoContent,
          timestamp: new Date(),
        };
        setSessions((prev) =>
          prev.map((s) =>
            s.id === activeSessionId
              ? { ...s, messages: [...s.messages, demoMessage], updatedAt: new Date() }
              : s
          )
        );
      }
      // Intentionally NOT calling setError() — the friendly demo reply
      // replaces the old "Load failed" / Retry error state so the chat
      // never visually dead-ends.
    } finally {
      setIsLoading(false);
    }
    // Either the legacy /chat path succeeded, or it fell into the
    // demo-mode reply — in both cases the conversation got a usable
    // assistant turn, so report success to the composer.
    return true;
  }, [activeSessionId, aiMode, currentTab]);

  const sendMessage = useCallback(
    async (
      content: string,
      attachments: AttachedAsset[] = [],
    ): Promise<boolean> => {
      return doSend(content, attachments);
    },
    [doSend],
  );

  const retry = useCallback(() => {
    if (lastUserMessage) {
      setSessions((prev) =>
        prev.map((s) =>
          s.id === activeSessionId
            ? { ...s, messages: s.messages.slice(0, -1), updatedAt: new Date() }
            : s
        )
      );
      // Phase 9 fix — replay attachments that were on the failed turn.
      // Without this, retry-ing a failed image-attached send would
      // re-submit only the text and the assistant would have no asset
      // context, defeating the purpose of the retry.
      doSend(lastUserMessage, lastAttachmentsRef.current);
    }
  }, [lastUserMessage, doSend, activeSessionId]);

  const clearChat = useCallback(() => {
    setSessions((prev) =>
      prev.map((s) =>
        s.id === activeSessionId
          ? { ...s, messages: [], updatedAt: new Date(), title: 'New Conversation' }
          : s
      )
    );
    setError(null);
  }, [activeSessionId]);

  const togglePin = useCallback((message: Message) => {
    setPinnedMessages((prev) => {
      const exists = prev.find((m) => m.id === message.id);
      if (exists) return prev.filter((m) => m.id !== message.id);
      if (prev.length >= 5) return [...prev.slice(1), message];
      return [...prev, message];
    });
  }, []);

  const moveToFolder = useCallback((sessionId: string, folder: ChatFolder) => {
    setSessions((prev) =>
      prev.map((s) => (s.id === sessionId ? { ...s, folder } : s))
    );
  }, []);

  const addMemoryRef = useCallback((ref: string) => {
    setMemoryRefs((prev) => {
      if (prev.includes(ref)) return prev;
      if (prev.length >= 10) return [...prev.slice(1), ref];
      return [...prev, ref];
    });
  }, []);

  return {
    sessions,
    activeSession,
    activeSessionId,
    isLoading,
    error,
    aiMode,
    pinnedMessages,
    searchQuery,
    inputText,
    activeTools,
    memoryRefs,
    currentTab,
    filteredSessions,
    toolActivity,            // Phase 10 fix — current tool run, null when idle
    createNewChat,
    selectSession,
    deleteSession,
    insertSystemMessage,
    sendMessage,
    retry,
    clearChat,
    setAiMode,
    togglePin,
    setSearchQuery,
    setInputText,
    moveToFolder,
    addMemoryRef,
    switchTab,
    setPendingSessionTitle,
  };
}
