import { useState, useCallback } from 'react';
import type { ChatSession, Message } from '@/types';
import { placeholderChats } from '@/data/placeholderChats';

const generateId = () => Math.random().toString(36).substring(2, 9);

const genericResponses = [
  "That's an interesting question. Let me break it down for you.\n\nThe key thing to understand is that complex systems often have emergent properties that aren't obvious from their individual components. Whether we're talking about software architecture, biological systems, or social networks, the interactions between parts create behaviors that no single part exhibits alone.\n\nTo apply this practically, start by identifying the core relationships in your system. Map out dependencies, feedback loops, and bottlenecks. Once you have that map, you can optimize for resilience rather than just speed.",
  "I love this topic! Here's my perspective on it.\n\nFirst, context matters more than rules. What works in one environment might fail in another because the constraints and incentives differ. So before adopting any best practice, ask: 'What are the specific conditions where this succeeds?'\n\nSecond, simplicity usually wins. Complex solutions create technical debt, cognitive load, and fragility. If you can't explain your approach to a junior colleague in five minutes, it might be too complicated.\n\nFinally, iterate based on feedback. Theoretical perfection is less valuable than empirical validation.",
  "Great point. I think the answer depends on your specific goals and constraints.\n\nIf you're optimizing for speed, then parallelization and automation are your best friends. Identify repetitive tasks and script them. Use tools that integrate well with your existing workflow rather than forcing a complete overhaul.\n\nIf you're optimizing for quality, then depth beats breadth. Spend more time understanding the fundamentals. Read source code, write tests, and document your assumptions.\n\nAnd if you're optimizing for sustainability, build habits and systems, not just outputs. Consistency over intensity.",
];

export function useChat() {
  const [sessions, setSessions] = useState<ChatSession[]>(placeholderChats);
  const [activeSessionId, setActiveSessionId] = useState<string>(placeholderChats[0].id);
  const [isLoading, setIsLoading] = useState(false);

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
  }, []);

  const selectSession = useCallback((id: string) => {
    setActiveSessionId(id);
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
  }, [activeSessionId]);

  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim()) return;

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

try {
  const res = await fetch('https://worker-production-2a49.up.railway.app/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      user_id: 'web_user_1',
      message: content.trim(),
      platform: 'web',
    }),
  });

  const data = await res.json();
  responseText = data.reply || data.response || data.message || 'Cevap alınamadı.';
} catch (error) {
  responseText = 'Bağlantı hatası oluştu. Lütfen tekrar dene.';
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

    setIsLoading(false);
  }, [activeSessionId]);

  const clearChat = useCallback(() => {
    setSessions((prev) =>
      prev.map((s) =>
        s.id === activeSessionId
          ? { ...s, messages: [], updatedAt: new Date(), title: 'New Conversation' }
          : s
      )
    );
  }, [activeSessionId]);

  return {
    sessions,
    activeSession,
    activeSessionId,
    isLoading,
    createNewChat,
    selectSession,
    deleteSession,
    sendMessage,
    clearChat,
  };
}
