import { useState, useCallback, useRef, useEffect } from 'react';
import type { ChatSession, Message, AIMode, WorkspaceTab, ChatFolder } from '@/types';

const generateId = () => Math.random().toString(36).substring(2, 9);

// Canonical Railway backend (per STABLE_CHECKPOINT.md). The 2a49 host that
// appears in some historical commits is a typo whose DNS does not resolve —
// every fetch from it throws TypeError: Load failed (Safari) / Failed to
// fetch (Chromium), which is the exact "Load failed" toast we keep getting
// reports about. If you change this URL, also update STABLE_CHECKPOINT.md.
const API_URL = 'https://worker-production-1345.up.railway.app/chat';

// Hard ceiling so a slow / unreachable backend never leaves the composer
// hanging forever. AbortController fires; the catch block translates the
// abort into a friendly "Request timed out" toast.
const CHAT_REQUEST_TIMEOUT_MS = 60_000;

// Map raw browser/network errors to user-facing copy. Without this, Safari's
// `TypeError: Load failed` and Chrome's `TypeError: Failed to fetch` reach
// the toast verbatim — exactly the symptom reported in production.
const NETWORK_ERROR_PATTERNS =
  /load failed|failed to fetch|network ?error|connection (refused|reset)|err_(internet|connection|name_not_resolved)/i;

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
  // Final safety net: anything that smells like a network / fetch / timeout
  // failure becomes friendly copy. The literal "Load failed" cannot escape.
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

const TAB_KEYS: WorkspaceTab[] = ['chat', 'research', 'coding', 'startup', 'study', 'creative', 'trading', 'business', 'agents'];

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

/* ─── Session-content persistence (Phase 2 — survives refresh) ──────────
   localStorage stores the entire sessions[] array so that after a refresh
   the user sees the same conversations they left. Without this, the tab
   session map points at session ids that no longer exist in memory and
   chat appears wiped. */

const SESSIONS_STORAGE_KEY       = 'korvix_chat_sessions_v1';
const ACTIVE_SESSION_STORAGE_KEY = 'korvix_active_session_id_v1';

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
    };
  }).filter((m): m is Message => m !== null);
  return {
    id:        s.id,
    title:     typeof s.title === 'string' ? s.title : 'Conversation',
    messages,
    updatedAt: new Date((s.updatedAt as string | number) ?? Date.now()),
    folder:    (s.folder as ChatFolder) ?? 'none',
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
    // Quota exceeded / private-mode Safari — local-only mode degrades
    // gracefully. Chat keeps working from in-memory state.
  }
}

export function useChat() {
  // Compute initial state ONCE so both useState initialisers see the same
  // {sessions, activeId} snapshot. Without this, restored sessions and the
  // restored active id could disagree (independent reads of localStorage
  // each calling createEmptySession() generate fresh ids) and doSend's
  // `s.id === activeSessionId` predicate would never match → every
  // message would silently drop on first visit.
  const initialStateRef = useRef<{ sessions: ChatSession[]; activeId: string } | null>(null);
  if (initialStateRef.current === null) {
    const restored = loadSessionsFromStorage();
    let seeded: ChatSession[];
    if (restored.length > 0) {
      seeded = restored;
    } else {
      // First visit — one empty session per tab so each workspace is
      // isolated from the moment the user lands.
      seeded = TAB_KEYS.map((tab) =>
        createEmptySession(`New ${tab.charAt(0).toUpperCase() + tab.slice(1)}`)
      );
    }
    let activeId = seeded[0].id;
    try {
      const stored = localStorage.getItem(ACTIVE_SESSION_STORAGE_KEY);
      if (stored && seeded.some((s) => s.id === stored)) activeId = stored;
    } catch { /* ignore */ }
    initialStateRef.current = { sessions: seeded, activeId };
  }

  const [sessions, setSessions] = useState<ChatSession[]>(initialStateRef.current.sessions);
  const [activeSessionId, setActiveSessionId] = useState<string>(initialStateRef.current.activeId);
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

  // Mirror sessions + active id to localStorage on every change so the
  // user's chat history survives refresh / tab close. Without these two
  // effects the in-memory state is lost on every page load even though
  // tabSessionMap still points at the (now missing) session ids.
  useEffect(() => {
    saveSessionsToStorage(sessions);
  }, [sessions]);

  useEffect(() => {
    try { localStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, activeSessionId); } catch { /* ignore */ }
  }, [activeSessionId]);

  // Persist tab session map
  useEffect(() => {
    saveTabSessions(tabSessionMap);
  }, [tabSessionMap]);

  const activeSession = sessions.find((s) => s.id === activeSessionId) || sessions[0];

  const filteredSessions = sessions.filter((s) => {
    if (!searchQuery) return true;
    return s.title.toLowerCase().includes(searchQuery.toLowerCase());
  });

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

    // 60s ceiling so a slow / unreachable backend never leaves the
    // composer hanging forever. The abort error becomes "Request timed
    // out." in the friendly mapper below.
    const ctrl = new AbortController();
    const timeoutId = setTimeout(() => {
      try { ctrl.abort(); } catch { /* ignore */ }
    }, CHAT_REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        signal: ctrl.signal,
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
        // Map common HTTP codes to friendly copy so the toast never echoes
        // a raw server message verbatim.
        if (response.status === 429) {
          setError('Too many requests. Please wait a few seconds and try again.');
        } else if (response.status === 503) {
          setError('The chat service is temporarily unavailable. Please try again in a moment.');
        } else if (response.status >= 500) {
          setError('The server hit an error. Please try again in a moment.');
        } else if (response.status === 401 || response.status === 403) {
          setError('Authentication failed. Please refresh the page and try again.');
        } else {
          setError(`The server responded with ${response.status}. Please try again.`);
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
