import { useState, useCallback, useRef } from 'react';
import type { ChatSession, Message, AIMode, ChatFolder } from '@/types';

const generateId = () => Math.random().toString(36).substring(2, 9);

const API_URL = 'https://worker-production-2a49.up.railway.app/chat';

// Network-style error messages emitted by various browsers when fetch fails
// (Safari: "Load failed", Chrome: "Failed to fetch", Firefox: "NetworkError when...").
// We match by string so even environments where `instanceof TypeError` fails
// (cross-realm, instrumented runtimes) still produce a user-friendly message
// instead of leaking the raw browser string to the toast.
const NETWORK_ERROR_PATTERNS = /load failed|failed to fetch|network ?error|connection (refused|reset)|err_(internet|connection|name_not_resolved)/i;

function friendlyErrorMessage(err: unknown): string {
  // Aborted requests
  if (err instanceof DOMException && err.name === 'AbortError') {
    return 'İstek zaman aşımına uğradı. Tekrar dener misin?';
  }
  // Browser-level network failure (Safari "Load failed", Chrome "Failed to fetch", ...)
  if (err instanceof TypeError) {
    return 'Bağlantı sorunu. Sunucuya ulaşılamadı. Tekrar dener misin?';
  }
  // Same as above but message-string-matched, for runtimes where `instanceof TypeError`
  // fails (cross-realm errors, bundler edge cases). This is the path that was leaking
  // Safari's verbatim "Load failed" to the UI.
  const msg = err instanceof Error ? err.message : '';
  if (msg && NETWORK_ERROR_PATTERNS.test(msg)) {
    return 'Bağlantı sorunu. Sunucuya ulaşılamadı. Tekrar dener misin?';
  }
  return msg || 'Beklenmeyen bir hata oluştu. Tekrar dener misin?';
}

function getUserId(): string {
  const key = 'korvix_user_id';
  try {
    let id = localStorage.getItem(key);
    if (!id) {
      id = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : generateId() + generateId();
      localStorage.setItem(key, id);
    }
    return id;
  } catch {
    // Private-mode Safari throws on localStorage access — fall back to memory id.
    return generateId() + generateId();
  }
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

    // 60s client-side abort so a hung server never leaves the user
    // staring at a forever spinner.
    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), 60_000);

    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userIdRef.current,
          message: content.trim(),
          chat_id: activeSessionId,
          session_id: activeSessionId,
          platform: 'web',
        }),
      });

      if (!response.ok) {
        // Surface non-2xx as a friendly message; don't throw a raw Error whose
        // .message would leak HTTP status text directly into the toast.
        if (response.status === 429) {
          setError('Çok hızlı mesaj gönderdin. Birkaç saniye bekleyip tekrar dene.');
        } else if (response.status >= 500) {
          setError('Sunucuda geçici bir sorun var. Lütfen tekrar dene.');
        } else if (response.status === 408 || response.status === 504) {
          setError('İstek zaman aşımına uğradı. Tekrar dener misin?');
        } else {
          setError(`Sunucu hatası (${response.status}). Tekrar dener misin?`);
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
      // Translate browser-level fetch failures (Safari "Load failed",
      // Chrome "Failed to fetch", abort, …) into friendly Turkish copy.
      // Never leak the raw err.message into the toast.
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
