import { useState, useCallback, useRef, useEffect } from 'react';
import type { ChatSession, Message, AIMode, WorkspaceTab, ChatFolder } from '@/types';

const generateId = () => Math.random().toString(36).substring(2, 9);

/**
 * Backend API URL.
 *
 * Resolution order:
 *   1. VITE_API_URL env at build time (Vercel project env var) — preferred
 *      because a redeploy can switch endpoints without a code change.
 *   2. The current Railway production hostname as a safe default.
 *
 * IMPORTANT: do NOT hardcode an older "worker-production-*.up.railway.app"
 * here. Previous redesigns regressed this to a dead hostname which made
 * every fetch fail with TypeError("Failed to fetch") — iOS Safari surfaces
 * that exact text as "Load failed" in the chat UI.
 */
const DEFAULT_API_HOST = 'https://korvixai-backend-production.up.railway.app';
const API_URL = `${
  (import.meta.env?.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ||
  DEFAULT_API_HOST
}/chat`;

// Per-request timeout. Long enough for cold starts, short enough that an
// unreachable host doesn't leave the UI spinning forever.
const REQUEST_TIMEOUT_MS = 20_000;

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

    // AbortController so a hung request can't pin the UI on "loading" forever.
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userIdRef.current,
          message: content.trim(),
          chat_id: activeSessionId,
          session_id: activeSessionId,
          platform: 'web',
        }),
        signal: controller.signal,
      });

      // Read the body once; we'll try to parse it as JSON and fall back to
      // text if the server sent something unexpected (e.g. an HTML error
      // page from a CDN). That way we never crash on `.json()` mid-render.
      const rawText = await response.text();
      let data: any = null;
      try {
        data = rawText ? JSON.parse(rawText) : null;
      } catch {
        data = { _raw: rawText };
      }

      // Debug log requested by the operator — visible in browser devtools
      // so they can see the exact backend payload when a chat misbehaves.
      // eslint-disable-next-line no-console
      console.log('CHAT_API_RESPONSE', { status: response.status, data });

      if (!response.ok) {
        // Surface the backend's own message when present; otherwise a
        // generic line. We DON'T re-throw the raw HTTP status as a free-
        // form Error message because it bubbles up as ugly text in the
        // toast and on iOS Safari sometimes truncates to just "Load failed".
        const detail =
          (data && (data.detail?.message || data.error || data.message)) ||
          `Sunucu hatası (HTTP ${response.status}). Lütfen tekrar deneyin.`;
        setError(typeof detail === 'string' ? detail : `HTTP ${response.status}`);
        return;
      }

      // Broader response normalization. Backend has gone through several
      // shapes over phases — accept any of these, in priority order:
      //   data.reply         legacy /chat
      //   data.response      old chat shape
      //   data.message       some tool responses
      //   data.data?.reply   v2 envelope
      //   data.content       generic fallback
      //   data.text          generic fallback
      // If NONE match, render the raw JSON so the user can at least see
      // what came back — better than a blank message + a vague toast.
      const responseText =
        (typeof data?.reply === 'string' && data.reply) ||
        (typeof data?.response === 'string' && data.response) ||
        (typeof data?.message === 'string' && data.message) ||
        (typeof data?.data?.reply === 'string' && data.data.reply) ||
        (typeof data?.content === 'string' && data.content) ||
        (typeof data?.text === 'string' && data.text) ||
        (data && typeof data === 'object' ? JSON.stringify(data, null, 2) : String(data ?? ''));

      const assistantMessage: Message = {
        id: generateId(),
        role: 'assistant',
        content: responseText || '(empty reply)',
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
      // eslint-disable-next-line no-console
      console.error('CHAT_API_ERROR', err);

      // Distinguish failure modes so the user sees something actionable
      // instead of the raw iOS "Load failed" string. Order matters —
      // AbortError must be checked BEFORE TypeError because aborted
      // fetches are reported as a DOMException in some browsers.
      let friendly = 'Bir şeyler ters gitti. Lütfen tekrar deneyin.';
      if (err instanceof DOMException && err.name === 'AbortError') {
        friendly = 'İstek zaman aşımına uğradı. Tekrar dene.';
      } else if (err instanceof TypeError) {
        // Failed to fetch / NetworkError — DNS, CORS, server unreachable.
        friendly = 'Sunucuya ulaşılamadı. Bağlantını kontrol edip tekrar dene.';
      } else if (err instanceof SyntaxError) {
        friendly = 'Yanıt anlaşılamadı. Tekrar dene.';
      } else if (err instanceof Error && err.message) {
        // Keep a backend-supplied message if it's already friendly.
        friendly = err.message;
      }
      setError(friendly);
    } finally {
      window.clearTimeout(timeoutId);
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
