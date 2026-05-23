import { useState, useCallback, useRef, useEffect } from 'react';
import type { ChatSession, Message, AIMode, WorkspaceTab, ChatFolder } from '@/types';

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
const SESSIONS_KEY = 'korvix_sessions';
const ACTIVE_SESSION_KEY = 'korvix_active_session_id';

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
  return { id, role, content, timestamp };
}

function normalizeSession(raw: unknown): ChatSession | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;

  const messagesRaw = Array.isArray(s.messages) ? s.messages : [];
  const messages: Message[] = messagesRaw
    .map(normalizeMessage)
    .filter((m): m is Message => m !== null);

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
    const raw = localStorage.getItem(SESSIONS_KEY);
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
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
  } catch { /* ignore */ }
}

/* ─── Active-session persistence ─── */
function loadActiveSessionId(): string | null {
  try {
    const raw = localStorage.getItem(ACTIVE_SESSION_KEY);
    return typeof raw === 'string' && raw.length > 0 ? raw : null;
  } catch { return null; }
}

function saveActiveSessionId(id: string) {
  try {
    if (id) localStorage.setItem(ACTIVE_SESSION_KEY, id);
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
    : TAB_KEYS.map((tab) => createEmptySession(`New ${tab.charAt(0).toUpperCase() + tab.slice(1)}`));
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
  const userIdRef = useRef<string>(getUserId());

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

  const doSend = useCallback(async (content: string) => {
    if (!content.trim()) return;

    setError(null);
    setLastUserMessage(content.trim());
    setInputText('');

    const userMessage: Message = {
      id: generateId(),
      role: 'user',
      content: content.trim(),
      timestamp: new Date(),
    };

    setSessions((prev) =>
      prev.map((s) =>
        s.id === activeSessionId
          ? {
              ...s,
              messages: [...s.messages, userMessage],
              updatedAt: new Date(),
              title: s.title.startsWith('New ') ? content.slice(0, 40) : s.title,
            }
          : s
      )
    );

    setIsLoading(true);

    try {
      // Backend accepts an optional `mode` ("fast" | "deep_think" |
      // "research" | "coding" | "study" | …) for AI routing. The
      // frontend stores aiMode with a hyphen ("deep-think"); the
      // backend uses underscores. Omit when unknown so the backend
      // falls back to automatic intent-based routing.
      const KNOWN_BACKEND_MODES = new Set([
        'fast', 'deep_think', 'research', 'coding', 'study',
        'startup_advisor', 'marketing_dropshipping', 'trading_analyst',
      ]);
      const normalizedMode = aiMode ? aiMode.replace('-', '_') : '';
      const requestMode = KNOWN_BACKEND_MODES.has(normalizedMode) ? normalizedMode : undefined;

      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userIdRef.current,
          message: content.trim(),
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

      const demoMessage: Message = {
        id: generateId(),
        role: 'assistant',
        content: generateDemoReply(content.trim()),
        timestamp: new Date(),
      };

      setSessions((prev) =>
        prev.map((s) =>
          s.id === activeSessionId
            ? { ...s, messages: [...s.messages, demoMessage], updatedAt: new Date() }
            : s
        )
      );
      // Intentionally NOT calling setError() — the friendly demo reply
      // replaces the old "Load failed" / Retry error state so the chat
      // never visually dead-ends.
    } finally {
      setIsLoading(false);
    }
  }, [activeSessionId, aiMode]);

  const sendMessage = useCallback(async (content: string) => {
    await doSend(content);
  }, [doSend]);

  const retry = useCallback(() => {
    if (lastUserMessage) {
      setSessions((prev) =>
        prev.map((s) =>
          s.id === activeSessionId
            ? { ...s, messages: s.messages.slice(0, -1), updatedAt: new Date() }
            : s
        )
      );
      doSend(lastUserMessage);
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
    createNewChat,
    selectSession,
    deleteSession,
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
  };
}
