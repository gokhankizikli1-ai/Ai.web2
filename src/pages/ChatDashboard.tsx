import { useState, useEffect, useRef } from 'react';
import { useChat } from '@/hooks/useChat';
import Sidebar from '@/components/Sidebar';
import MessageBubble from '@/components/MessageBubble';
import ChatInput from '@/components/ChatInput';
import TypingIndicator from '@/components/TypingIndicator';
import SettingsModal from '@/components/SettingsModal';
import PremiumBadge from '@/components/PremiumBadge';
import { Button } from '@/components/ui/button';
import {
  Settings,
  PanelLeftOpen,
  Sparkles,
  Code2,
  PenTool,
  BarChart3,
  Lightbulb,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';

const suggestions = [
  { icon: Code2, label: 'Debug Python code', prompt: 'Debug this Python function for me' },
  { icon: PenTool, label: 'Write an email', prompt: 'Write a professional email to my manager requesting time off' },
  { icon: BarChart3, label: 'Analyze data', prompt: 'Explain what a p-value means in statistics' },
  { icon: Lightbulb, label: 'Brainstorm ideas', prompt: 'Give me 5 unique startup ideas in the sustainability space' },
];

export default function ChatDashboard() {
  const {
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
  } = useChat();

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [animatedMessageId, setAnimatedMessageId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Smooth auto-scroll to bottom when messages or loading state changes
  useEffect(() => {
    const timer = setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }, 50);
    return () => clearTimeout(timer);
  }, [activeSession.messages, isLoading, error]);

  // Track the latest assistant message for animation
  const lastMessage = activeSession.messages[activeSession.messages.length - 1];
  useEffect(() => {
    if (lastMessage && lastMessage.role === 'assistant' && !isLoading) {
      if (animatedMessageId !== lastMessage.id) {
        setAnimatedMessageId(lastMessage.id);
      }
    }
  }, [lastMessage, isLoading, animatedMessageId]);

  const handleSuggestionClick = (prompt: string) => {
    sendMessage(prompt);
  };

  return (
    <div className="flex h-screen w-full bg-[#0a0a0f] text-foreground overflow-hidden">
      <Sidebar
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen(!sidebarOpen)}
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelect={selectSession}
        onDelete={deleteSession}
        onNewChat={createNewChat}
      />

      {/* Main Content */}
      <div
        className={`flex-1 flex flex-col h-full transition-all duration-300 ${
          sidebarOpen ? 'md:ml-72' : 'ml-0'
        }`}
      >
        {/* Top Bar */}
        <header className="flex items-center justify-between h-14 px-4 border-b border-white/10 bg-[#0a0a0f]/80 backdrop-blur-sm shrink-0">
          <div className="flex items-center gap-3">
            {!sidebarOpen && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setSidebarOpen(true)}
                className="h-8 w-8 text-slate-500 hover:text-white hover:bg-white/5"
              >
                <PanelLeftOpen className="h-4 w-4" />
              </Button>
            )}
            <h2 className="text-sm font-medium text-slate-200 truncate max-w-[200px] md:max-w-md">
              {activeSession.title}
            </h2>
          </div>

          <div className="flex items-center gap-2">
            <PremiumBadge />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSettingsOpen(true)}
              className="h-8 w-8 text-slate-500 hover:text-white hover:bg-white/5"
            >
              <Settings className="h-4 w-4" />
            </Button>
          </div>
        </header>

        {/* Messages Area */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto scrollbar-thin">
          {activeSession.messages.length === 0 && !error ? (
            <div className="flex flex-col items-center justify-center h-full px-6">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-400 to-blue-600 mb-6 shadow-lg shadow-cyan-500/20">
                <Sparkles className="h-8 w-8 text-white" />
              </div>
              <h2 className="text-2xl font-bold text-white mb-2">How can I help you today?</h2>
              <p className="text-slate-500 text-sm mb-8 text-center max-w-md">
                I can write code, analyze data, draft emails, brainstorm ideas, or just chat.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-lg">
                {suggestions.map((s) => (
                  <button
                    key={s.label}
                    onClick={() => handleSuggestionClick(s.prompt)}
                    className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-left hover:bg-white/[0.08] hover:border-white/20 transition-all duration-200"
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-500/20 to-blue-500/20 text-cyan-400">
                      <s.icon className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="text-sm font-medium text-slate-200">{s.label}</div>
                      <div className="text-xs text-slate-500 truncate max-w-[180px]">{s.prompt}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
              {activeSession.messages.map((message) => (
                <MessageBubble
                  key={message.id}
                  role={message.role}
                  content={message.content}
                  shouldAnimate={message.id === animatedMessageId}
                  onRegenerate={message.role === 'assistant' ? () => {} : undefined}
                />
              ))}

              {/* Loading State */}
              {isLoading && (
                <div className="flex gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-cyan-400 to-blue-600">
                    <Sparkles className="h-4 w-4 text-white" />
                  </div>
                  <div className="rounded-2xl rounded-tl-none bg-white/5">
                    <TypingIndicator />
                  </div>
                </div>
              )}

              {/* Error State */}
              {error && (
                <div className="flex gap-3 animate-fade-in">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-500/20">
                    <AlertTriangle className="h-4 w-4 text-red-400" />
                  </div>
                  <div className="rounded-2xl rounded-tl-none bg-red-500/10 border border-red-500/20 px-4 py-3 max-w-[85%] md:max-w-[75%]">
                    <p className="text-sm text-red-300 mb-3">{error}</p>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={retry}
                      className="h-8 gap-2 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      Try Again
                    </Button>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} className="h-1" />
            </div>
          )}
        </div>

        {/* Input Area */}
        <ChatInput onSend={sendMessage} disabled={isLoading} />
      </div>

      <SettingsModal open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}
