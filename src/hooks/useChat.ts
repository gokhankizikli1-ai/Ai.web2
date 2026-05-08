import { useState, useCallback, useRef } from 'react';
import type { ChatSession, Message } from '@/types';
import { placeholderChats } from '@/data/placeholderChats';

const generateId = () => Math.random().toString(36).substring(2, 9);

export function useChat() {
  const [sessions, setSessions] = useState<ChatSession[]>(placeholderChats);
  const [activeSessionId, setActiveSessionId] = useState<string>(placeholderChats[0].id);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastMessageRef = useRef<string>('');

  const activeSession = sessions.find((s) => s.id === activeSessionId) || sessions[0];

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

  const deleteSession = useCallback(
    (id: string) => {
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
    },
    [activeSessionId]
  );

  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim()) return;

      setError(null);
      lastMessageRef.current = content.trim();

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
                title:
                  s.title === 'New Conversation'
                    ? content.slice(0, 30) + '...'
                    : s.title,
              }
            : s
        )
      );

      setIsLoading(true);
      let responseText = '';

      try {
        const res = await fetch('https://worker-production-2a49.up.railway.app/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            user_id: 'web_user_1',
            message: content.trim(),
            chat_id: activeSessionId,
            platform: 'web',
            session_id: activeSessionId,
          }),
        });

        if (!res.ok) {
          throw new Error('Sunucu hatasi: ' + res.status);
        }

        const data = await res.json();
        responseText =
          data.reply || data.response || data.message || 'Cevap alinamadi.';

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
        setError(
          err instanceof Error
            ? err.message
            : 'Baglanti hatasi olustu. Lutfen tekrar dene.'
        );
      } finally {
        setIsLoading(false);
      }
    },
    [activeSessionId]
  );

  const retry = useCallback(() => {
    if (lastMessageRef.current) {
      // Remove the last failed user message before retrying to avoid duplicates
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== activeSessionId) return s;
          const messages = [...s.messages];
          // Remove last user message so sendMessage can re-add it cleanly
          if (messages.length > 0 && messages[messages.length - 1].role === 'user') {
            messages.pop();
          }
          return { ...s, messages };
        })
      );
      setError(null);
      sendMessage(lastMessageRef.current);
    }
  }, [activeSessionId, sendMessage]);

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

  return {
    sessions,
    activeSession,
    activeSessionId,
    isLoading,
    error,
    createNewChat,
    selectSession,
    deleteSession,
    sendMessage,
    retry,
    clearChat,
  };
}
