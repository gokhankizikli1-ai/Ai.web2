import { useState, useCallback, useEffect, useRef } from 'react';
import type { ChatSession, Message, AIMode, ChatFolder } from '@/types';
import { sessionsClient } from '@/services/sessions';

const generateId = () => Math.random().toString(36).substring(2, 9);

// Canonical Railway backend (per STABLE_CHECKPOINT.md). The 2a49 host that
// appears in some historical commits is a typo whose DNS does not resolve —
// every fetch from it throws TypeError: Load failed (Safari) / Failed to
// fetch (Chromium), which is the exact symptom we keep regressing into.
// If you change this URL, also update STABLE_CHECKPOINT.md and the
// matching constant in src/hooks/useTradingSignals.ts.
const API_URL = 'https://worker-production-1345.up.railway.app/chat';

// Hard ceiling so a slow / unreachable backend never leaves the composer
// hanging forever. AbortController fires; the catch block surfaces a
// friendly "timed out" assistant bubble.
const CHAT_REQUEST_TIMEOUT_MS = 60_000;

function getUserId(): string {
  const key = 'korvix_user_id';
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : generateId() + generateId();
    localStorage.setItem(key, id);
  }
  return id;
}

function createEmptySession(): ChatSession {
  return {
    id: generateId(),
    title: 'New Conversation',
    messages: [],
    updatedAt: new Date(),
    folder: 'none',
  };
}


// ── Phase 2 — local session persistence + backend write-through ──────────
//
// Two layers:
//   1. ALWAYS-ON local cache (localStorage) — sessions survive refresh,
//      tab close, browser restart. Hydrated synchronously on mount so the
//      UI never flickers an empty state.
//   2. OPT-IN backend sync — when the backend reports
//      `metadata.sessions_enabled=true` via /v2/health, we lazily ensure
//      a default workspace + thread, then fire-and-forget appendMessage
//      calls so the conversation is also persisted server-side. Every
//      backend call is best-effort; failure never affects the UI.
//
// The mapping of local session.id → backend thread.id is stored on the
// session itself (`threadId?: string`) and round-trips through
// localStorage like everything else.

const SESSIONS_STORAGE_KEY      = 'korvix_chat_sessions_v1';
const ACTIVE_SESSION_STORAGE_KEY = 'korvix_active_session_id_v1';
const WORKSPACE_STORAGE_KEY     = 'korvix_workspace_id_v1';

// ChatSession already declares `threadId?: string` (see src/types/index.ts),
// so no separate persisted-session type is needed. The revive function
// returns a ChatSession directly.
function reviveSession(raw: unknown): ChatSession | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  if (typeof s.id !== 'string' || !Array.isArray(s.messages)) return null;
  const messages = s.messages.map((m: unknown): Message | null => {
    if (!m || typeof m !== 'object') return null;
    const mm = m as Record<string, unknown>;
    if (typeof mm.id !== 'string' || typeof mm.content !== 'string') return null;
    if (mm.role !== 'user' && mm.role !== 'assistant') return null;
    return {
      id:        mm.id,
      role:      mm.role,
      content:   mm.content,
      timestamp: new Date((mm.timestamp as string | number) ?? Date.now()),
      isError:   mm.isError === true ? true : undefined,
    };
  }).filter((m): m is Message => m !== null);
  return {
    id:        s.id,
    title:     typeof s.title === 'string' ? s.title : 'Conversation',
    messages,
    updatedAt: new Date((s.updatedAt as string | number) ?? Date.now()),
    folder:    (s.folder as ChatFolder) ?? 'none',
    threadId:  typeof s.threadId === 'string' ? s.threadId : undefined,
  };
}

function loadSessionsFromStorage(): ChatSession[] {
  try {
    const raw = localStorage.getItem(SESSIONS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(reviveSession).filter((s): s is ChatSession => s !== null);
  } catch {
    return [];
  }
}

function saveSessionsToStorage(sessions: ChatSession[]): void {
  try {
    localStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(sessions));
  } catch {
    // Quota exceeded, private-mode Safari, or a hostile storage shim —
    // local-only mode degrades gracefully. The UI keeps working from
    // in-memory state; we just don't survive refresh this turn.
  }
}

function loadActiveSessionId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

function saveActiveSessionId(id: string): void {
  try { localStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, id); } catch { /* ignore */ }
}

function loadWorkspaceId(): string | null {
  try { return localStorage.getItem(WORKSPACE_STORAGE_KEY); } catch { return null; }
}

function saveWorkspaceId(id: string): void {
  try { localStorage.setItem(WORKSPACE_STORAGE_KEY, id); } catch { /* ignore */ }
}


// ── Diagnostics-rich error formatting ─────────────────────────────────────
//
// The user wants the assistant error bubble to EXPLAIN the failure, not
// just say "Load failed". Every failure path collects these four signals
// and renders them inside a single, friendly bubble:
//
//   - apiUrl       : which host the browser tried to call
//   - statusCode   : null for network / abort / DNS, otherwise HTTP code
//   - reason       : raw error name + message (capped, sanitized)
//   - category     : drives the top-line friendly summary
//
// "Load failed" can never reach the UI because we never echo `err.message`
// directly into the bubble — the category-based summary always leads, and
// the raw reason sits beneath it on its own line, prefixed for clarity.

type ErrorCategory =
  | 'network' | 'timeout' | 'parse' | 'server'
  | 'empty'   | 'auth'    | 'rate-limit' | 'unknown';

interface ChatErrorDetails {
  category:   ErrorCategory;
  statusCode: number | null;
  reason:     string;
}

const CATEGORY_SUMMARY: Record<ErrorCategory, string> = {
  'network':    "Couldn't reach the chat service.",
  'timeout':    "The chat service didn't respond in time.",
  'parse':      "The chat service returned an unexpected response.",
  'server':     "The chat service hit a server error.",
  'empty':      "The chat service returned an empty reply.",
  'auth':       "Authentication failed.",
  'rate-limit': "Too many requests — please wait a moment.",
  'unknown':    "Something went wrong.",
};

const NETWORK_ERROR_PATTERNS =
  /load failed|failed to fetch|network ?error|connection (refused|reset)|err_(internet|connection|name_not_resolved)/i;
const JSON_PARSE_PATTERNS =
  /unexpected (?:token|end of json)|json\.parse|invalid json/i;

function classifyException(err: unknown): ChatErrorDetails {
  // Abort/timeout
  if (err instanceof DOMException && err.name === 'AbortError') {
    return { category: 'timeout', statusCode: null, reason: 'AbortError: request aborted (timeout)' };
  }
  // Browser fetch failure — DNS / TLS / CORS preflight / offline
  if (err instanceof TypeError) {
    return {
      category: 'network',
      statusCode: null,
      reason: `${err.name}: ${err.message || 'fetch failed'}`,
    };
  }
  const msg = (err instanceof Error ? err.message : String(err ?? '')).trim();
  if (msg && JSON_PARSE_PATTERNS.test(msg)) {
    return { category: 'parse', statusCode: null, reason: `Parse error: ${msg}` };
  }
  if (msg && NETWORK_ERROR_PATTERNS.test(msg)) {
    return { category: 'network', statusCode: null, reason: msg };
  }
  // Final safety net — anything that "smells" like fetch trouble counts
  // as network, so the literal string "Load failed" can never escape.
  if (msg && /failed|fetch|network|aborted|timeout/i.test(msg)) {
    return { category: 'network', statusCode: null, reason: msg };
  }
  return { category: 'unknown', statusCode: null, reason: msg || 'No additional detail.' };
}

function classifyHttpStatus(status: number): ChatErrorDetails {
  if (status === 401 || status === 403) {
    return { category: 'auth',       statusCode: status, reason: `Backend rejected the request (HTTP ${status}).` };
  }
  if (status === 429) {
    return { category: 'rate-limit', statusCode: status, reason: 'Rate limited by the backend.' };
  }
  if (status === 503) {
    return { category: 'server',     statusCode: status, reason: 'Backend service unavailable (likely flag-gated off).' };
  }
  if (status >= 500) {
    return { category: 'server',     statusCode: status, reason: `Backend returned HTTP ${status}.` };
  }
  return { category: 'server',       statusCode: status, reason: `Unexpected HTTP ${status}.` };
}

function formatErrorBubble(d: ChatErrorDetails): string {
  // Bubble content is plain text rendered by MessageBubble's error branch.
  // The category summary is always the first line; diagnostics follow on
  // labelled lines so the user (or a tester) can immediately see WHICH
  // endpoint failed and WHY without opening devtools.
  const lines: string[] = [];
  lines.push(CATEGORY_SUMMARY[d.category]);
  lines.push('');
  lines.push(`Endpoint: ${API_URL}`);
  lines.push(`Status:   ${d.statusCode !== null ? `HTTP ${d.statusCode}` : (d.category === 'timeout' ? 'aborted (timeout)' : 'network error')}`);
  if (d.reason && d.reason.trim()) {
    // Cap to 200 chars so a giant stack trace can't bloat the bubble.
    const reason = d.reason.length > 200 ? `${d.reason.slice(0, 197)}...` : d.reason;
    lines.push(`Reason:   ${reason}`);
  }
  lines.push('');
  lines.push('Tap Try Again to retry.');
  return lines.join('\n');
}


export function useChat() {
  // Compute initial state ONCE — both useState initializers need to
  // agree on which session is active. If we computed them independently
  // (each calling loadSessionsFromStorage + createEmptySession), an empty
  // first-visit localStorage would produce two different random session
  // IDs and `doSend`'s `s.id === activeSessionId` predicate would never
  // match → every message would silently drop. The useRef gate runs
  // exactly once per mount so both useStates read from the same snapshot.
  const initialStateRef = useRef<{ sessions: ChatSession[]; activeId: string } | null>(null);
  if (initialStateRef.current === null) {
    const restored = loadSessionsFromStorage();
    const seeded   = restored.length > 0 ? restored : [createEmptySession()];
    const stored   = loadActiveSessionId();
    const activeId = (stored && seeded.some(s => s.id === stored)) ? stored : seeded[0].id;
    initialStateRef.current = { sessions: seeded, activeId };
  }

  const [sessions, setSessions] = useState<ChatSession[]>(initialStateRef.current.sessions);
  const [activeSessionId, setActiveSessionId] = useState<string>(initialStateRef.current.activeId);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUserMessage, setLastUserMessage] = useState<string | null>(null);
  const userIdRef = useRef<string>(getUserId());
  // Cached backend workspace id; set on first successful ensureDefault.
  const workspaceIdRef = useRef<string | null>(loadWorkspaceId());
  // Mirror of sessions for callbacks that need the current value without
  // listing `sessions` in their dep array (which would re-bind doSend
  // on every message append and break stable identity downstream).
  const sessionsRef = useRef<ChatSession[]>(sessions);
  // Synchronous local-session-id → backend-thread-id cache. Populated by
  // ensureThread as soon as a Thread is created, so the assistant turn's
  // write-through never reads a stale `sessions` snapshot and triggers
  // a second createThread call. Restored from sessions on mount below.
  const threadIdMapRef = useRef<Record<string, string>>({});
  // In-flight createThread promises keyed by local session id. Lets
  // concurrent callers (user-turn + a fast follow-up) await the same
  // resolution instead of racing two parallel backend creates.
  const threadCreationPromisesRef = useRef<Record<string, Promise<string | null>>>({});
  // Local message ids whose backend appendMessage POST has confirmed
  // success. retry() consults this to decide whether to re-POST the
  // same user message — preventing duplicates on the backend thread
  // when the first attempt landed but /chat failed locally.
  const syncedLocalMessageIdsRef = useRef<Set<string>>(new Set());
  // The local message id of the most recent user-turn send, so retry()
  // can look up the sync state above. Cleared by createNewChat.
  const lastUserMessageIdRef = useRef<string | null>(null);

  // Seed the threadId map from whatever was restored from localStorage,
  // so a refresh mid-conversation keeps writing to the same backend thread.
  if (Object.keys(threadIdMapRef.current).length === 0) {
    for (const s of sessions) {
      if (s.threadId) threadIdMapRef.current[s.id] = s.threadId;
    }
  }

  // ── Phase-2 persistence side effects ──────────────────────────────────
  // 1) Mirror sessions to localStorage on every change so a refresh
  //    finds the same set of conversations the user just saw. Also
  //    syncs the ref used by stable callbacks.
  useEffect(() => {
    sessionsRef.current = sessions;
    saveSessionsToStorage(sessions);
  }, [sessions]);

  // 2) Mirror the active session id so the right thread re-selects.
  useEffect(() => {
    saveActiveSessionId(activeSessionId);
  }, [activeSessionId]);

  // 3) Lazy helper: ensure a backend Thread for the given local session.
  //    Returns the thread id (creating workspace + thread on demand) or
  //    null if the sessions backend is disabled / unreachable. The local
  //    session is updated in-place with `threadId` so future sends reuse
  //    the same thread.
  //
  //    Concurrency safety:
  //      - threadIdMapRef is a SYNCHRONOUS cache. As soon as a thread is
  //        created, the id lands there — the very next call sees it
  //        without waiting for React's render commit.
  //      - threadCreationPromisesRef dedupes parallel calls so two
  //        ensureThread() invocations for the same local session share
  //        one backend createThread instead of racing two.
  const ensureThread = useCallback(async (
    localSession: ChatSession,
  ): Promise<string | null> => {
    // Fast path: cache hit.
    const cached = threadIdMapRef.current[localSession.id];
    if (cached) return cached;
    // The local snapshot might carry an id from localStorage hydration.
    if (localSession.threadId) {
      threadIdMapRef.current[localSession.id] = localSession.threadId;
      return localSession.threadId;
    }
    // In-flight dedup — another caller already started; await the same
    // promise so the second send writes to the same thread.
    const inflight = threadCreationPromisesRef.current[localSession.id];
    if (inflight) return inflight;

    const promise = (async (): Promise<string | null> => {
      try {
        if (!workspaceIdRef.current) {
          const ws = await sessionsClient.ensureDefaultWorkspace(userIdRef.current);
          if (!ws) return null;
          workspaceIdRef.current = ws.id;
          saveWorkspaceId(ws.id);
        }
        // Re-check the cache after the workspace round-trip — a
        // concurrent caller may have populated it while we were waiting.
        const justCached = threadIdMapRef.current[localSession.id];
        if (justCached) return justCached;

        const thread = await sessionsClient.createThread(
          workspaceIdRef.current,
          localSession.title || 'New Conversation',
          'chat',
        );
        if (!thread) return null;

        // Synchronously update the ref BEFORE setSessions so any later
        // caller hitting the fast path on the next event-loop turn sees
        // the new thread id without waiting for the React commit.
        threadIdMapRef.current[localSession.id] = thread.id;
        setSessions(prev =>
          prev.map(s => s.id === localSession.id ? { ...s, threadId: thread.id } : s)
        );
        return thread.id;
      } catch {
        return null;
      } finally {
        delete threadCreationPromisesRef.current[localSession.id];
      }
    })();

    threadCreationPromisesRef.current[localSession.id] = promise;
    return promise;
  }, []);

  const [aiMode, setAiMode] = useState<AIMode>('fast');
  const [pinnedMessages, setPinnedMessages] = useState<Message[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [inputText, setInputText] = useState('');
  const [activeTools, setActiveTools] = useState<string[]>([]);
  const [memoryRefs, setMemoryRefs] = useState<string[]>([]);

  const activeSession = sessions.find((s) => s.id === activeSessionId) || sessions[0];

  const filteredSessions = sessions.filter((s) => {
    if (!searchQuery) return true;
    return s.title.toLowerCase().includes(searchQuery.toLowerCase());
  });

  const createNewChat = useCallback(() => {
    const newSession = createEmptySession();
    setSessions((prev) => [newSession, ...prev]);
    setActiveSessionId(newSession.id);
    setInputText('');
    setActiveTools([]);
    setError(null);
    // Reset the retry context — the previous session's last-user-message
    // id and sync state must NOT leak into a fresh conversation.
    // Without this, retry() in the new session could read a stale id
    // and skip the user-turn write-through, silently dropping a real
    // message on the backend thread.
    setLastUserMessage(null);
    lastUserMessageIdRef.current = null;
    return newSession.id;
  }, []);

  const selectSession = useCallback((id: string) => {
    setActiveSessionId(id);
    setError(null);
    // Same reasoning as createNewChat: a session switch invalidates the
    // retry context, so we drop the previous session's last-user-message
    // marker to keep retry()'s skipUserSync decision honest.
    setLastUserMessage(null);
    lastUserMessageIdRef.current = null;
  }, []);

  const deleteSession = useCallback((id: string) => {
    setSessions((prev) => {
      const filtered = prev.filter((s) => s.id !== id);
      if (filtered.length === 0) {
        const newSession = createEmptySession();
        setActiveSessionId(newSession.id);
        return [newSession];
      }
      if (activeSessionId === id) {
        setActiveSessionId(filtered[0].id);
      }
      return filtered;
    });
    setError(null);
  }, [activeSessionId]);

  const doSend = useCallback(async (
    content: string,
    opts?: { skipUserSync?: boolean },
  ) => {
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
    lastUserMessageIdRef.current = userMessage.id;
    // When retry() asks us to skip the user-turn write-through, it does
    // so because the PREVIOUS attempt's POST already landed on the
    // backend. The new local message id is logically the same row, so
    // propagate the "synced" state forward — otherwise a second retry
    // would see an unsynced id, re-POST, and create a duplicate.
    if (opts?.skipUserSync) {
      syncedLocalMessageIdsRef.current.add(userMessage.id);
    }

    setSessions((prev) =>
      prev.map((s) =>
        s.id === activeSessionId
          ? {
              ...s,
              messages: [...s.messages, userMessage],
              updatedAt: new Date(),
              title: s.title === 'New Conversation' ? content.slice(0, 40) : s.title,
            }
          : s
      )
    );

    // Phase-2 write-through (best-effort, never awaited on the UI path).
    // Ensures a backend thread exists for this local session, then
    // appends the user message to /sessions/threads/{id}/messages. If
    // the backend has ENABLE_SESSIONS=false or the call fails for any
    // reason, the local state above is the source of truth — the user
    // sees no difference.
    // Skip when retry() already knows the user message was persisted on
    // the previous attempt — otherwise we'd create a duplicate in the
    // backend thread that Phase-3 cross-device sync would surface.
    const activeSnapshot = sessionsRef.current.find(s => s.id === activeSessionId);
    if (activeSnapshot && !opts?.skipUserSync) {
      const localMsgId = userMessage.id;
      void ensureThread(activeSnapshot).then(threadId => {
        if (!threadId) return;
        void sessionsClient.appendMessage(threadId, 'user', content.trim()).then(persisted => {
          // Only mark as synced when the backend confirms — a network
          // failure here keeps the id out of the set so the next retry
          // will re-attempt the POST.
          if (persisted) syncedLocalMessageIdsRef.current.add(localMsgId);
        });
      });
    }

    setIsLoading(true);

    // AbortController gates the hard 60s ceiling.
    const ctrl = new AbortController();
    const timeoutId = setTimeout(() => {
      try { ctrl.abort(); } catch { /* ignore */ }
    }, CHAT_REQUEST_TIMEOUT_MS);

    // Two outcomes flow through the same tail: a successful reply OR a
    // diagnostics-rich error bubble. Either way we ALWAYS append an
    // assistant-role message so failure is never silent.
    let assistantText = '';
    let isErrorTurn = false;
    let errorToastShort = '';   // shorter copy for the global toast

    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ctrl.signal,
        body: JSON.stringify({
          user_id: userIdRef.current,
          message: content.trim(),
          chat_id: activeSessionId,
          session_id: activeSessionId,
          platform: 'web',
        }),
      });

      if (!response.ok) {
        const d = classifyHttpStatus(response.status);
        assistantText  = formatErrorBubble(d);
        errorToastShort = `${CATEGORY_SUMMARY[d.category]} (HTTP ${response.status})`;
        isErrorTurn   = true;
      } else {
        // JSON parse is its own failure mode (empty body, HTML error page,
        // half-streamed response). Catch locally so the outer catch keeps
        // a single semantic path.
        let data: Record<string, unknown> | null = null;
        try {
          data = await response.json();
        } catch (parseErr) {
          const d: ChatErrorDetails = {
            category:   'parse',
            statusCode: response.status,
            reason:     parseErr instanceof Error ? `${parseErr.name}: ${parseErr.message}` : 'Failed to parse JSON.',
          };
          assistantText  = formatErrorBubble(d);
          errorToastShort = CATEGORY_SUMMARY[d.category];
          isErrorTurn   = true;
        }
        if (!isErrorTurn && data) {
          const reply = data.reply ?? data.response ?? data.message;
          if (typeof reply === 'string' && reply.trim()) {
            assistantText = reply;
          } else {
            const d: ChatErrorDetails = {
              category:   'empty',
              statusCode: response.status,
              reason:     'Response body had no `reply` / `response` / `message` string field.',
            };
            assistantText  = formatErrorBubble(d);
            errorToastShort = CATEGORY_SUMMARY[d.category];
            isErrorTurn   = true;
          }
        }
      }
    } catch (err) {
      // DNS / TLS / CORS / offline / Safari "Load failed" / abort timeout
      // all land here. classifyException() guarantees a friendly summary
      // — "Load failed" can never reach the UI.
      const d = classifyException(err);
      assistantText  = formatErrorBubble(d);
      errorToastShort = CATEGORY_SUMMARY[d.category];
      isErrorTurn   = true;
    } finally {
      clearTimeout(timeoutId);
    }

    // Final safety net — assistantText should never be empty, but if some
    // unforeseen code path leaves it blank, show a friendly default rather
    // than rendering a literally empty bubble.
    if (!assistantText.trim()) {
      assistantText  = 'Something went wrong. Tap Try Again to retry.';
      errorToastShort = 'Something went wrong.';
      isErrorTurn   = true;
    }

    const assistantMessage: Message = {
      id: generateId(),
      role: 'assistant',
      content: assistantText,
      timestamp: new Date(),
      isError: isErrorTurn || undefined,
    };

    setSessions((prev) =>
      prev.map((s) =>
        s.id === activeSessionId
          ? { ...s, messages: [...s.messages, assistantMessage], updatedAt: new Date() }
          : s
      )
    );

    // Phase-2 write-through for the assistant turn — only when it's a
    // real reply (skip error bubbles; they're frontend-synthesised and
    // re-appending them on every retry would clutter the persisted log).
    if (!isErrorTurn) {
      const sessionForThread = sessionsRef.current.find(s => s.id === activeSessionId);
      if (sessionForThread) {
        void ensureThread(sessionForThread).then(threadId => {
          if (threadId) {
            void sessionsClient.appendMessage(threadId, 'assistant', assistantText);
          }
        });
      }
    }

    if (isErrorTurn) {
      // Mirror to the global toast UX. Keep it short — the full diagnostic
      // detail already lives inside the assistant bubble.
      setError(errorToastShort || 'Something went wrong.');
    }
    setIsLoading(false);
  }, [activeSessionId, ensureThread]);

  const sendMessage = useCallback(async (content: string) => {
    await doSend(content);
  }, [doSend]);

  const retry = useCallback(() => {
    if (!lastUserMessage) return;
    // Was the previous attempt's user message already persisted to the
    // backend thread? If yes, doSend must skip the user-turn write-through
    // on this retry — otherwise we'd duplicate the same message in the
    // backend log. If no (e.g. first attempt's POST also failed), let
    // doSend re-attempt it.
    const previousUserMessageWasSynced =
      lastUserMessageIdRef.current !== null &&
      syncedLocalMessageIdsRef.current.has(lastUserMessageIdRef.current);

    // The previous attempt left [userMessage, assistantErrorMessage]
    // in the thread. Strip both so doSend re-creates them cleanly —
    // otherwise a retry leaves a duplicate user message locally.
    setSessions((prev) =>
      prev.map((s) => {
        if (s.id !== activeSessionId) return s;
        const msgs = s.messages;
        let chop = 0;
        if (msgs.length > 0 && msgs[msgs.length - 1].role === 'assistant') chop = 1;
        if (
          msgs.length - chop > 0 &&
          msgs[msgs.length - 1 - chop].role === 'user' &&
          msgs[msgs.length - 1 - chop].content === lastUserMessage
        ) chop += 1;
        return { ...s, messages: msgs.slice(0, msgs.length - chop), updatedAt: new Date() };
      })
    );
    doSend(lastUserMessage, { skipUserSync: previousUserMessageWasSynced });
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
  };
}
