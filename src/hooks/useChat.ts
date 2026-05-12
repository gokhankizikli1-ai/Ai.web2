import { useState, useCallback, useRef } from 'react';
import type { ChatSession, Message, AIMode, ChatFolder } from '@/types';

const generateId = () => Math.random().toString(36).substring(2, 9);

// Canonical Railway backend (per STABLE_CHECKPOINT.md). The 2a49 host that
// appears in earlier history is a typo and resolves to nothing — fetch from
// it throws "TypeError: Load failed" (Safari) or "Failed to fetch" (others).
const API_URL = 'https://worker-production-1345.up.railway.app/chat';

// Hard ceiling so a slow / unreachable backend can never leave the UI
// hanging forever — the AbortController fires after this and the catch
// block surfaces a friendly "Request timed out." toast.
const CHAT_REQUEST_TIMEOUT_MS = 60_000;

// Map any raw browser/network/parse error to user-facing copy. The literal
// strings "Load failed" (Safari) / "Failed to fetch" (Chromium) / network
// patterns must NEVER reach the UI verbatim. Also catches JSON-parse
// SyntaxErrors and any other surprise.
const NETWORK_ERROR_PATTERNS =
  /load failed|failed to fetch|network ?error|connection (refused|reset)|err_(internet|connection|name_not_resolved)/i;
const JSON_PARSE_PATTERNS =
  /unexpected (?:token|end of json)|json\.parse|invalid json/i;

function friendlyErrorMessage(err: unknown): string {
  if (err instanceof DOMException && err.name === 'AbortError') {
    return 'Request timed out. Please try again.';
  }
  if (err instanceof TypeError) {
    return 'Connection problem. Please try again.';
  }
  const msg = (err instanceof Error ? err.message : String(err ?? '')).trim();
  if (msg && NETWORK_ERROR_PATTERNS.test(msg)) {
    return 'Connection problem. Please try again.';
  }
  if (msg && JSON_PARSE_PATTERNS.test(msg)) {
    return 'The server returned an unexpected response. Please try again.';
  }
  // Final safety net: if the message looks like a raw browser fetch
  // failure ("Load failed", "NetworkError when attempting to fetch
  // resource", etc.) but somehow slipped past the regex, still return
  // friendly copy rather than echoing the raw string.
  if (msg && /failed|fetch|network|aborted|timeout/i.test(msg)) {
    return 'Connection problem. Please try again.';
  }
  return msg || 'Something went wrong. Please try again.';
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

function createEmptySession(): ChatSession {
  return {
    id: generateId(),
    title: 'New Conversation',
    messages: [],
    updatedAt: new Date(),
    folder: 'none',
  };
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

    const ctrl = new AbortController();
    const timeoutId = setTimeout(() => {
      try { ctrl.abort(); } catch { /* ignore */ }
    }, CHAT_REQUEST_TIMEOUT_MS);

    // Two outcomes flow through the same tail: a successful assistant
    // reply OR a friendly error string. Either way we render an assistant
    // bubble in the thread so failure is NEVER silent — the user always
    // sees a response right after their message, with a "Try Again"
    // affordance when it failed.
    let assistantText: string = '';
    let isErrorTurn = false;

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
        // Non-OK: map common codes to friendly copy. Never echo response
        // bodies — they may contain stack traces or internal field names.
        if (response.status === 429) {
          assistantText = 'Too many requests. Please wait a few seconds and try again.';
        } else if (response.status === 503) {
          assistantText = 'The chat service is temporarily unavailable. Please try again in a moment.';
        } else if (response.status >= 500) {
          assistantText = 'The server hit an error. Please try again in a moment.';
        } else if (response.status === 401 || response.status === 403) {
          assistantText = 'Authentication failed. Please refresh the page and try again.';
        } else {
          assistantText = `The server responded with ${response.status}. Please try again.`;
        }
        isErrorTurn = true;
      } else {
        // JSON parse is its own failure mode (empty body, HTML error
        // page, half-streamed response, etc.). Catch it locally so the
        // outer catch doesn't fire and we keep a single error path.
        let data: Record<string, unknown> | null = null;
        try {
          data = await response.json();
        } catch {
          assistantText = 'The server returned an unexpected response. Please try again.';
          isErrorTurn = true;
        }
        if (!isErrorTurn && data) {
          const reply = data.reply ?? data.response ?? data.message;
          if (typeof reply === 'string' && reply.trim()) {
            assistantText = reply;
          } else {
            assistantText = 'The server returned an empty response. Please try again.';
            isErrorTurn = true;
          }
        }
      }
    } catch (err) {
      // Network / abort / DNS / Safari "Load failed" / Chromium "Failed
      // to fetch" all land here. friendlyErrorMessage() must NEVER let
      // a raw error string reach the UI.
      assistantText = friendlyErrorMessage(err);
      isErrorTurn = true;
    } finally {
      clearTimeout(timeoutId);
    }

    // Defensive: the mapper should always return a non-empty string, but
    // belt-and-suspenders so the assistant bubble cannot ever be empty.
    if (!assistantText.trim()) {
      assistantText = 'Something went wrong. Please try again.';
      isErrorTurn = true;
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
    // Mirror the failure to the existing error/toast UX so the global
    // toast still fires for users who liked that signal.
    if (isErrorTurn) {
      setError(assistantText);
    }
    setIsLoading(false);
  }, [activeSessionId]);

  const sendMessage = useCallback(async (content: string) => {
    await doSend(content);
  }, [doSend]);

  const retry = useCallback(() => {
    if (!lastUserMessage) return;
    // The previous attempt left a [userMessage, assistantErrorMessage]
    // pair (or just [userMessage] if doSend never appended an assistant
    // turn). Strip whichever trailing pair exists so doSend re-creates
    // them cleanly — no duplicate user message in the thread.
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
