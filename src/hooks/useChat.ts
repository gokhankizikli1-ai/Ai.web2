import { useState, useCallback, useRef, useEffect } from 'react';
import type { ChatSession, Message, AIMode, WorkspaceTab, ChatFolder } from '@/types';
import { API_BASE_URL } from '@/lib/apiBase';

const generateId = () => Math.random().toString(36).substring(2, 9);

const API_URL = `${API_BASE_URL}/chat`;

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

    try {
      const requestBody = {
        user_id: userIdRef.current,
        message: content.trim(),
        chat_id: activeSessionId,
        session_id: activeSessionId,
        platform: 'web',
      };
      const bodyJson = JSON.stringify(requestBody);
      console.log('[useChat] ▶ sending request', { url: API_URL, body: requestBody });

      const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: bodyJson,
      });

      console.log('[useChat] ◀ response received', {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        contentType: response.headers.get('content-type'),
      });

      // Safe-parse: read body as TEXT first, then JSON.parse only if
      // non-empty. Some Railway / Cloudflare error pages and the
      // backend's 5xx fallback can return plain text or an empty body —
      // calling response.json() directly would throw "Unexpected end of
      // JSON input" and we'd lose the actual error context. Every parse
      // step is wrapped so we never "Load failed" after an HTTP 200.
      let rawText = '';
      try {
        rawText = await response.text();
      } catch (readErr) {
        console.error('[useChat] response.text() failed:', readErr);
      }
      console.log('[useChat] raw response text (truncated 500):', rawText.slice(0, 500));

      let data: Record<string, unknown> | null = null;
      if (rawText) {
        try {
          data = JSON.parse(rawText) as Record<string, unknown>;
          console.log('[useChat] parsed JSON:', data);
        } catch (parseErr) {
          console.error('[useChat] JSON.parse failed; treating body as plain text:', parseErr);
        }
      } else {
        console.warn('[useChat] empty response body');
      }

      if (!response.ok) {
        const detailMsg = Array.isArray((data as { detail?: unknown })?.detail)
          ? ((data as { detail: Array<{ msg?: string }> }).detail.map((d) => d?.msg).filter(Boolean).join('; '))
          : typeof (data as { detail?: unknown })?.detail === 'string'
            ? ((data as { detail: string }).detail)
            : null;
        const backendMsg =
          (data && (data.error || detailMsg || data.message)) ||
          rawText ||
          `Server responded with ${response.status}.`;
        throw new Error(String(backendMsg));
      }

      // After HTTP 200: ALWAYS create the assistant message from the
      // canonical `reply` field when present; fall through to other
      // common fields only if absent. Never throw here — even if the
      // shape is unexpected we surface the raw text or a friendly note,
      // because "Load failed" after a 200 is the bug we're closing.
      let responseText = '';
      try {
        if (data && typeof data.reply === 'string' && data.reply.trim()) {
          responseText = data.reply;
        } else if (data && typeof data.response === 'string' && data.response.trim()) {
          responseText = data.response;
        } else if (data && typeof data.message === 'string' && data.message.trim()) {
          responseText = data.message;
        } else if (rawText.trim()) {
          responseText = rawText;
        } else {
          responseText = 'The server returned an empty response. Please try again.';
        }
      } catch (extractErr) {
        console.error('[useChat] reply-field extraction failed (non-fatal):', extractErr);
        responseText = rawText || 'The server returned an unexpected response.';
      }

      const assistantMessage: Message = {
        id: generateId(),
        role: 'assistant',
        content: responseText,
        timestamp: new Date(),
      };
      console.log('[useChat] assistant message object:', assistantMessage);

      // Append + log post-state. Wrapped so a render-state error never
      // surfaces as "Load failed" to the user.
      try {
        setSessions((prev) => {
          const next = prev.map((s) =>
            s.id === activeSessionId
              ? { ...s, messages: [...s.messages, assistantMessage], updatedAt: new Date() }
              : s
          );
          const active = next.find((s) => s.id === activeSessionId);
          console.log('[useChat] message state after append:', {
            sessionId: activeSessionId,
            messageCount: active?.messages.length,
            lastMessage: active?.messages[active.messages.length - 1],
          });
          return next;
        });
        console.log('[useChat] ✓ final render state: assistant message appended');
      } catch (renderErr) {
        // Should be unreachable (setState never throws), but guard anyway
        // so a future regression here can't trigger the user-facing
        // "Load failed" path after a successful 200.
        console.error('[useChat] append/render failed AFTER 200 (suppressed):', renderErr);
      }
    } catch (err) {
      console.error('[useChat] send failed:', err);
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
