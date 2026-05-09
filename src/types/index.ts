export type AIMode = 'fast' | 'deep-think' | 'research' | 'creative' | 'coding' | 'study';

export type ChatFolder = 'study' | 'coding' | 'startup' | 'finance' | 'personal' | 'none';

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  updatedAt: Date;
  isDemo?: boolean;
  folder?: ChatFolder;
}

export interface PromptItem {
  id: string;
  title: string;
  content: string;
  category: string;
}

export interface AIModeOption {
  id: AIMode;
  label: string;
  description: string;
  icon: string;
}
