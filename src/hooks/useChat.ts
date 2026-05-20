import { useState, useCallback, useRef, useEffect } from 'react';
import type { ChatSession, Message, AIMode, WorkspaceTab, ChatFolder } from '@/types';
import { API_BASE_URL } from '@/lib/apiBase';
import { getActiveUserId, useAuthStore } from '@/stores/authStore';

const generateId = () => Math.random().toString(36).substring(2, 9);

const API_URL = `${API_BASE_URL}/chat`;

function getUserId(): string {
  // Logged-in users bind chat to their stable auth id; guests fall
  // back to the local browser id (preserves anonymous flow).
  return getActiveUserId();
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

/* ═══════════════════════════════════════════
   PERSISTENCE
   Sessions are persisted per user so signing in / out / switching
   accounts never silently merges histories. The active session id
   and the per-tab session map are persisted under the same prefix
   so refresh + route navigation rebuilds the exact same view.
   ═══════════════════════════════════════════ */

const STORAGE_VERSION = 'v2';

function storagePrefix(userId: string): string {
  return `korvix_chat_${STORAGE_VERSION}_${userId || 'anon'}`;
}

interface PersistedShape {
  sessions: ChatSession[];
  activeSessionId: string;
  tabSessionMap: Record<string, string>;
  currentTab: WorkspaceTab;
}

function reviveSessions(raw: unknown): ChatSession[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatSession[] = [];
  for (const s of raw as Array<Record<string, unknown>>) {
    if (!s || typeof s !== 'object') continue;
    const id = typeof s.id === 'string' ? s.id : '';
    if (!id) continue;
    const updatedAt = s.updatedAt ? new Date(s.updatedAt as string) : new Date();
    const messagesRaw = Array.isArray(s.messages) ? (s.messages as Array<Record<string, unknown>>) : [];
    const messages: Message[] = messagesRaw
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .map((m) => ({
        id: typeof m.id === 'string' ? m.id : generateId(),
        role: m.role as Message['role'],
        content: m.content as string,
        timestamp: m.timestamp ? new Date(m.timestamp as string) : new Date(),
      }));
    out.push({
      id,
      title: typeof s.title === 'string' ? s.title : 'New Conversation',
      messages,
      updatedAt: Number.isNaN(updatedAt.getTime()) ? new Date() : updatedAt,
      folder: (s.folder as ChatFolder) || 'none',
      isFavorite: !!s.isFavorite,
      isArchived: !!s.isArchived,
      isDemo: !!s.isDemo,
    });
  }
  return out;
}

function loadPersisted(userId: string): PersistedShape | null {
  try {
    const raw = localStorage.getItem(storagePrefix(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedShape>;
    const sessions = reviveSessions(parsed.sessions);
    if (!sessions.length) return null;
    return {
      sessions,
      activeSessionId: typeof parsed.activeSessionId === 'string' ? parsed.activeSessionId : sessions[0].id,
      tabSessionMap: (parsed.tabSessionMap && typeof parsed.tabSessionMap === 'object')
        ? (parsed.tabSessionMap as Record<string, string>) : {},
      currentTab: ((parsed.currentTab as WorkspaceTab) || 'chat'),
    };
  } catch {
    return null;
  }
}

function savePersisted(userId: string, payload: PersistedShape) {
  try {
    localStorage.setItem(storagePrefix(userId), JSON.stringify(payload));
  } catch {
    /* localStorage may be full or disabled — non-fatal */
  }
}

function buildInitialState(userId: string): PersistedShape {
  const restored = loadPersisted(userId);
  if (restored) return restored;
  const initialSessions = TAB_KEYS.map((tab) =>
    createEmptySession(`New ${tab.charAt(0).toUpperCase() + tab.slice(1)}`),
  );
  return {
    sessions: initialSessions,
    activeSessionId: initialSessions[0].id,
    tabSessionMap: {},
    currentTab: 'chat',
  };
}

export function useChat() {
  // Keep the active identity in a ref so async send/persist paths use
  // the same user id without forcing callback churn.
  const userIdRef = useRef<string>(getUserId());
  const initial = buildInitialState(userIdRef.current);

  const [sessions, setSessions] = useState<ChatSession[]>(initial.sessions);
  const [activeSessionId, setActiveSessionId] = useState<string>(initial.activeSessionId);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUserMessage, setLastUserMessage] = useState<string | null>(null);

  const [aiMode, setAiMode] = useState<AIMode>('fast');
  const [pinnedMessages, setPinnedMessages] = useState<Message[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [inputText, setInputText] = useState('');
  const [activeTools, setActiveTools] = useState<string[]>([]);
  const [memoryRefs, setMemoryRefs] = useState<string[]>([]);

  const [tabSessionMap, setTabSessionMap] = useState<Record<string, string>>(initial.tabSessionMap);
  const [currentTab, setCurrentTab] = useState<WorkspaceTab>(initial.currentTab);

  // Auth identity for server-side restore. Subscribing to the store
  // means a sign-in mid-session will re-hydrate from the backend
  // without forcing a full page reload.
  const authUserId = useAuthStore((s) => s.user?.id ?? '');
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const authToken = useAuthStore((s) => s.token);

  useEffect(() => {
    userIdRef.current = getUserId();
  }, [authUserId, isAuthenticated]);

  // Persist every state change so navigation away (Home, refresh,
  // tab switch) never drops the in-flight conversation.
  useEffect(() => {
    savePersisted(userIdRef.current, {
      sessions,
      activeSessionId,
      tabSessionMap,
      currentTab,
    });
  }, [sessions, activeSessionId, tabSessionMap, currentTab]);

  // One-shot hydration from the backend when the user is authenticated.
  // The local cache is the source of truth for in-flight edits; the
  // server provides cross-device restore + recovery after cache wipe.
  const hydratedForUserRef = useRef<string>('');
  useEffect(() => {
    if (!isAuthenticated || !authUserId || !authToken) return;
    if (hydratedForUserRef.current === authUserId) return;
    hydratedForUserRef.current = authUserId;
    const authHeaders = { Authorization: `Bearer ${authToken}` };

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/chat/history?user_id=${encodeURIComponent(authUserId)}&limit=30`, {
          headers: authHeaders,
        });
        if (!res.ok) return;
        const data = await res.json() as { chats?: Array<{ chat_id: string; title: string; last_at: string; message_count: number }> };
        const remote = Array.isArray(data?.chats) ? data.chats : [];
        if (!remote.length || cancelled) return;

        // Fetch full messages for the most recent N chats so the user
        // sees real history, not just titles, on first paint. Skip any
        // chat we already have locally with the same id — local state
        // is fresher (may contain an in-flight message).
        const detail = await Promise.all(
          remote.slice(0, 10).map(async (c) => {
            try {
              const r = await fetch(`${API_BASE_URL}/chat/messages?user_id=${encodeURIComponent(authUserId)}&chat_id=${encodeURIComponent(c.chat_id)}&limit=200`, {
                headers: authHeaders,
              });
              if (!r.ok) return null;
              const body = await r.json() as { messages?: Array<{ role: 'user' | 'assistant'; content: string; timestamp: string }> };
              return { chat: c, messages: Array.isArray(body?.messages) ? body.messages : [] };
            } catch {
              return null;
            }
          }),
        );

        if (cancelled) return;

        setSessions((prev) => {
          const byId = new Map(prev.map((s) => [s.id, s]));
          for (const entry of detail) {
            if (!entry) continue;
            const { chat, messages } = entry;
            if (byId.has(chat.chat_id)) continue; // local copy wins
            const revived: ChatSession = {
              id: chat.chat_id,
              title: chat.title || 'Conversation',
              folder: 'none',
              updatedAt: chat.last_at ? new Date(chat.last_at) : new Date(),
              messages: messages.map((m) => ({
                id: generateId(),
                role: m.role,
                content: m.content,
                timestamp: m.timestamp ? new Date(m.timestamp) : new Date(),
              })),
            };
            byId.set(revived.id, revived);
          }
          return Array.from(byId.values()).sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
        });
      } catch {
        /* network or parse error — local cache continues to drive UI */
      }
    })();

    return () => { cancelled = true; };
  }, [isAuthenticated, authUserId, authToken]);

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
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
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
