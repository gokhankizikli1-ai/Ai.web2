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

// Map raw browser/network errors to user-facing copy. Without this, Safari's
// `TypeError: Load failed` and Chrome's `TypeError: Failed to fetch` reach
// the toast verbatim, which is what the user just reported.
const NETWORK_ERROR_PATTERNS =
  /load failed|failed to fetch|network ?error|connection (refused|reset)|err_(internet|connection|name_not_resolved)/i;

function friendlyErrorMessage(err: unknown): string {
  if (err instanceof DOMException && err.name === 'AbortError') {
    return 'Request timed out. Please retry.';
  }
  if (err instanceof TypeError) {
    return 'Connection problem. Please retry.';
  }
  const msg = err instanceof Error ? err.message : '';
  if (msg && NETWORK_ERROR_PATTERNS.test(msg)) {
    return 'Connection problem. Please retry.';
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
        // 4xx/5xx — map a couple of common codes to specific copy, otherwise
        // fall through to a generic message. We deliberately don't echo
        // server response bodies verbatim because they may contain stack
        // traces / internal field names.
        if (response.status === 429) {
          setError('Too many requests. Wait a few seconds and retry.');
        } else if (response.status === 503) {
          setError('Chat service is temporarily unavailable.');
        } else if (response.status >= 500) {
          setError('Server error. Please retry in a moment.');
        } else {
          setError(`Server responded with ${response.status}.`);
        }
        return;
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
      // Translate raw fetch/abort errors so "Load failed" / "Failed to
      // fetch" / abort-on-timeout never reach the toast verbatim.
      setError(friendlyErrorMessage(err));
    } finally {
      clearTimeout(timeoutId);
      setIsLoading(false);
    }
  }, [activeSessionId]);

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
