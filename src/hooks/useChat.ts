import { useState, useCallback, useRef } from 'react';
import type { ChatSession, Message, MessageMetadata, AIMode, ChatFolder } from '@/types';
import { placeholderChats } from '@/data/placeholderChats';

const generateId = () => Math.random().toString(36).substring(2, 9);

const API_URL = 'https://worker-production-1345.up.railway.app/chat';

// Phase 5.2 — map fetch failures to user-facing copy + a code the UI can style on.
export type ChatErrorCode = 'rate_limit' | 'timeout' | 'network' | 'server' | 'safety' | 'unknown';
export interface ChatError {
  code: ChatErrorCode;
  message: string;
}

function mapStatusToError(status: number, fallback: string): ChatError {
  if (status === 429) return { code: 'rate_limit', message: 'Çok hızlı mesaj gönderdin. Birkaç saniye bekleyip tekrar dene.' };
  if (status >= 500 && status < 600) return { code: 'server',   message: 'Sunucuda geçici bir sorun var. Lütfen tekrar dene.' };
  if (status === 408 || status === 504) return { code: 'timeout', message: 'İstek zaman aşımına uğradı. Tekrar dener misin?' };
  if (status === 400) return { code: 'unknown', message: 'İsteğinde bir sorun var. Mesajını kontrol edip tekrar dene.' };
  return { code: 'unknown', message: fallback };
}

// Translate the frontend's mode IDs into the backend's canonical mode names
// (or its alias map). Returning undefined falls back to intent-based routing.
function toBackendMode(mode: AIMode): string | undefined {
  switch (mode) {
    case 'fast':       return 'fast';
    case 'deep-think': return 'deep_think';      // alias also accepted by backend
    case 'research':   return 'research';
    case 'coding':     return 'coding';
    case 'study':      return 'study';
    case 'creative':   return undefined;          // no backend mode; let intent routing pick
    default:           return undefined;
  }
}

function mapThrowableToError(err: unknown): ChatError {
  if (err instanceof TypeError) {
    // fetch network failure on web is a TypeError ("Failed to fetch")
    return { code: 'network', message: 'Bağlantı sorunu. İnternetini kontrol et ve tekrar dene.' };
  }
  if (err instanceof DOMException && err.name === 'AbortError') {
    return { code: 'timeout', message: 'İstek zaman aşımına uğradı.' };
  }
  return { code: 'unknown', message: err instanceof Error ? err.message : 'Beklenmeyen bir hata oluştu. Tekrar dener misin?' };
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

export function useChat() {
  const [sessions, setSessions] = useState<ChatSession[]>(placeholderChats);
  const [activeSessionId, setActiveSessionId] = useState<string>(placeholderChats[0].id);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<ChatError | null>(null);
  const [lastUserMessage, setLastUserMessage] = useState<string | null>(null);
  const userIdRef = useRef<string>(getUserId());

  // New state
  const [aiMode, setAiMode] = useState<AIMode>('fast');
  const [pinnedMessages, setPinnedMessages] = useState<Message[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [inputText, setInputText] = useState('');

  const activeSession = sessions.find((s) => s.id === activeSessionId) || sessions[0];

  // Filtered sessions based on search
  const filteredSessions = sessions.filter((s) => {
    if (!searchQuery) return true;
    return s.title.toLowerCase().includes(searchQuery.toLowerCase());
  });

  const createNewChat = useCallback(() => {
    const newSession: ChatSession = {
      id: generateId(),
      title: 'New Conversation',
      messages: [],
      updatedAt: new Date(),
    };
    setSessions((prev) => [newSession, ...prev]);
    setActiveSessionId(newSession.id);
    setError(null);
  }, []);

  const selectSession = useCallback((id: string) => {
    setActiveSessionId(id);
    setError(null);
  }, []);

  const deleteSession = useCallback((id: string) => {
    setSessions((prev) => {
      const filtered = prev.filter((s) => s.id !== id);
      if (filtered.length === 0) {
        const newSession: ChatSession = {
          id: generateId(),
          title: 'New Conversation',
          messages: [],
          updatedAt: new Date(),
        };
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
          ? { ...s, messages: [...s.messages, userMessage], updatedAt: new Date(), title: s.title === 'New Conversation' ? content.slice(0, 30) + '...' : s.title }
          : s
      )
    );

    setIsLoading(true);

    // Phase 5.2 — request-level timeout (60s) so a hung backend doesn't
    // leave the user staring at a forever spinner.
    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), 60_000);

    try {
      const response = await fetch(API_URL, {
        method:  'POST',
        signal:  controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id:    userIdRef.current,
          message:    content.trim(),
          chat_id:    activeSessionId,
          session_id: activeSessionId,
          platform:   'web',
          mode:       toBackendMode(aiMode), // mapped to backend canonical; undefined → intent routing
        }),
      });

      if (!response.ok) {
        setError(mapStatusToError(response.status, `Sunucu hatası (${response.status}).`));
        return;
      }

      const data = await response.json();
      const responseText = data.reply ?? data.response ?? data.message ?? JSON.stringify(data);

      // Pick up the Phase 5 structured metadata if present.
      const metadata: MessageMetadata | undefined = data.metadata
        ? {
            trading_signal:    data.metadata.trading_signal,
            tool_summary:      data.metadata.tool_summary,
            prior_thesis_used: data.metadata.prior_thesis_used,
          }
        : undefined;

      // Safety-rejected requests come back with intent prefix "safety_" — surface
      // them as a soft error chip rather than as a normal AI reply, so the user
      // gets the retry affordance.
      if (typeof data.intent === 'string' && data.intent.startsWith('safety_')) {
        setError({ code: 'safety', message: responseText });
        return;
      }

      const assistantMessage: Message = {
        id:        generateId(),
        role:      'assistant',
        content:   responseText,
        timestamp: new Date(),
        metadata,
      };

      setSessions((prev) =>
        prev.map((s) =>
          s.id === activeSessionId
            ? { ...s, messages: [...s.messages, assistantMessage], updatedAt: new Date() }
            : s
        )
      );
    } catch (err) {
      setError(mapThrowableToError(err));
    } finally {
      clearTimeout(timeoutId);
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

  // Pin/unpin a message
  const togglePin = useCallback((message: Message) => {
    setPinnedMessages((prev) => {
      const exists = prev.find((m) => m.id === message.id);
      if (exists) return prev.filter((m) => m.id !== message.id);
      if (prev.length >= 5) return [...prev.slice(1), message]; // max 5
      return [...prev, message];
    });
  }, []);

  const moveToFolder = useCallback((sessionId: string, folder: ChatFolder) => {
    setSessions((prev) =>
      prev.map((s) => (s.id === sessionId ? { ...s, folder } : s))
    );
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
  };
}
