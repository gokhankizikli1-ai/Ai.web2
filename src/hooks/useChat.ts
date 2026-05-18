import { useState, useCallback, useRef, useEffect } from 'react';
import type { ChatSession, Message, AIMode, WorkspaceTab, ChatFolder } from '@/types';

const generateId = () => Math.random().toString(36).substring(2, 9);

/**
 * Chat backend base URL.
 *
 * Same resolution as src/hooks/useTradingSignals.ts: read VITE_API_URL at
 * build time, fall back to the live Railway host.
 *
 * IMPORTANT: never hardcode the dead "worker-production-2a49.up.railway.app".
 * fetch() against that host raises a TypeError which WebKit surfaces to the
 * user as the opaque "Load failed" — the chat root-cause this replaces.
 */
const DEFAULT_API_HOST = 'https://korvixai-backend-production.up.railway.app';
const API_BASE = `${
  (import.meta.env?.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ||
  DEFAULT_API_HOST
}`;
const API_URL = `${API_BASE}/chat`;

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
  // Initialize one session per tab for isolation
  const initialSessions = TAB_KEYS.map((tab) => createEmptySession(`New ${tab.charAt(0).toUpperCase() + tab.slice(1)}`));
  const [sessions, setSessions] = useState<ChatSession[]>(initialSessions);
  const [activeSessionId, setActiveSessionId] = useState<string>(initialSessions[0].id);
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

    const requestBody = {
      user_id: userIdRef.current,
      message: content.trim(),
      chat_id: activeSessionId,
      session_id: activeSessionId,
      platform: 'web',
    };

    try {
      if (import.meta.env.DEV) {
        console.info('[useChat] POST', API_URL, requestBody);
      }

      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      // Read the body ONCE as text so dev logging and non-JSON / empty
      // response recovery can share the same payload.
      const rawBody = await response.text();
      if (import.meta.env.DEV) {
        console.info(
          '[useChat] response',
          response.status,
          response.statusText,
          rawBody,
        );
      }

      let data: any = null;
      if (rawBody) {
        try {
          data = JSON.parse(rawBody);
        } catch (parseErr) {
          console.error('[useChat] response is not valid JSON', parseErr, rawBody);
        }
      }

      if (!response.ok) {
        // Surface the ACTUAL backend error, not a generic string. The
        // backend 500 fallback returns { reply, error, code }; FastAPI
        // validation (422) returns { detail: [...] }.
        const detailMsg = Array.isArray(data?.detail)
          ? data.detail.map((d: any) => d?.msg).filter(Boolean).join('; ')
          : typeof data?.detail === 'string'
            ? data.detail
            : null;
        const backendMsg =
          (data && (data.error || data.reply || data.message || detailMsg)) ||
          rawBody ||
          `Server responded with ${response.status}.`;
        console.error('[useChat] request failed', response.status, backendMsg);
        throw new Error(String(backendMsg));
      }

      // Backend contract (backend/routes/chat.py ChatResponse) is a
      // top-level `reply` string. Stay resilient to legacy aliases, a
      // nested envelope, and a non-JSON body.
      const responseText: unknown =
        (data &&
          (data.reply ??
            data.response ??
            data.message ??
            data.text ??
            data?.data?.reply ??
            data?.data?.message)) ??
        (rawBody && !data ? rawBody : null);

      if (!responseText || typeof responseText !== 'string') {
        console.error('[useChat] no usable reply field in response', data);
        throw new Error(
          'The server returned an unexpected response. Please try again.',
        );
      }

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
      // TypeError here = network/CORS/DNS failure (WebKit: "Load failed").
      console.error('[useChat] send failed', API_URL, err);
      const msg =
        err instanceof Error
          ? err.message === 'Load failed' || err.message === 'Failed to fetch'
            ? `Cannot reach the server (${API_BASE}). Check connection / backend.`
            : err.message
          : 'Something went wrong. Please try again.';
      setError(msg);
    } finally {
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
