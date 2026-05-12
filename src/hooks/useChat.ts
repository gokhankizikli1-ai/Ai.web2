import { useState, useCallback, useRef } from 'react';
import type { ChatSession, Message, AIMode, ChatFolder } from '@/types';

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
  const initialSession = createEmptySession();
  const [sessions, setSessions] = useState<ChatSession[]>([initialSession]);
  const [activeSessionId, setActiveSessionId] = useState<string>(initialSession.id);
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
    return newSession.id;
  }, []);

  const selectSession = useCallback((id: string) => {
    setActiveSessionId(id);
    setError(null);
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
              title: s.title === 'New Conversation' ? content.slice(0, 40) : s.title,
            }
          : s
      )
    );

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

    if (isErrorTurn) {
      // Mirror to the global toast UX. Keep it short — the full diagnostic
      // detail already lives inside the assistant bubble.
      setError(errorToastShort || 'Something went wrong.');
    }
    setIsLoading(false);
  }, [activeSessionId]);

  const sendMessage = useCallback(async (content: string) => {
    await doSend(content);
  }, [doSend]);

  const retry = useCallback(() => {
    if (!lastUserMessage) return;
    // The previous attempt left [userMessage, assistantErrorMessage]
    // in the thread. Strip both so doSend re-creates them cleanly —
    // otherwise a retry leaves a duplicate user message.
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
    doSend(lastUserMessage);
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
