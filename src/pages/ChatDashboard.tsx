import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router';
import { useChat } from '@/hooks/useChat';
import { useCommandPalette } from '@/hooks/useCommandPalette';
import { useOnboarding } from '@/hooks/useOnboarding';
import Sidebar from '@/components/Sidebar';
import MessageBubble from '@/components/MessageBubble';
import ChatInput from '@/components/ChatInput';
import TypingIndicator from '@/components/TypingIndicator';
import SettingsModal from '@/components/SettingsModal';
import PremiumBadge from '@/components/PremiumBadge';
import AIModeSelector from '@/components/AIModeSelector';
import PromptLibrary from '@/components/PromptLibrary';
import QuickActionsBar from '@/components/QuickActionsBar';
import PinnedMessages from '@/components/PinnedMessages';
import CommandPalette from '@/components/CommandPalette';
import ExportChat from '@/components/ExportChat';
import Onboarding from '@/components/Onboarding';
import { Button } from '@/components/ui/button';
import {
  Settings, PanelLeftOpen, Sparkles, Code2, PenTool,
  BarChart3, Lightbulb, AlertTriangle, RefreshCw,
  FlaskConical, Command, Bookmark, Download,
} from 'lucide-react';

const suggestions = [
  { icon: Code2, label: 'Debug code', prompt: 'Debug this Python function for me' },
  { icon: PenTool, label: 'Draft content', prompt: 'Write a professional email to my manager' },
  { icon: BarChart3, label: 'Analyze data', prompt: 'Explain what a p-value means in statistics' },
  { icon: Lightbulb, label: 'Brainstorm', prompt: 'Give me 5 startup ideas in sustainability' },
];

export default function ChatDashboard() {
  const navigate = useNavigate();
  const {
    sessions, activeSession, activeSessionId, isLoading, error,
    aiMode, pinnedMessages, searchQuery, inputText, filteredSessions,
    createNewChat, selectSession, deleteSession, sendMessage, retry,
    setAiMode, togglePin, setSearchQuery, setInputText, moveToFolder,
  } = useChat();

  const { open: cmdOpen, setOpen: setCmdOpen } = useCommandPalette();
  const { showOnboarding, dismiss } = useOnboarding();

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [promptLibOpen, setPromptLibOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [animatedMessageId, setAnimatedMessageId] = useState<string | null>(null);
  const [pinnedPanelOpen, setPinnedPanelOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll
  useEffect(() => {
    const timer = setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }, 80);
    return () => clearTimeout(timer);
  }, [activeSession.messages, isLoading, error]);

  // Track latest assistant message for animation
  const lastMessage = activeSession.messages[activeSession.messages.length - 1];
  useEffect(() => {
    if (lastMessage && lastMessage.role === 'assistant' && !isLoading) {
      if (animatedMessageId !== lastMessage.id) {
        setAnimatedMessageId(lastMessage.id);
      }
    }
  }, [lastMessage, isLoading, animatedMessageId]);

  // Mobile sidebar auto-close
  useEffect(() => {
    const checkMobile = () => { if (window.innerWidth < 768) setSidebarOpen(false); };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Derived states
  const currentSession = sessions.find((s) => s.id === activeSessionId);
  const isDemoSession = currentSession?.isDemo ?? false;
  const isEmptyState = activeSession.messages.length === 0 && !error && !isLoading;
  const showOnboardingUI = showOnboarding && isEmptyState;

  // Command palette commands
  const commands = useMemo(() => [
    { id: 'new-chat', label: 'New Chat', shortcut: '', icon: <Sparkles className="h-3.5 w-3.5" />, action: () => createNewChat() },
    { id: 'search-chats', label: 'Search Conversations', shortcut: '', icon: <Command className="h-3.5 w-3.5" />, action: () => { setSidebarOpen(true); (document.querySelector('input[placeholder*=\"Search\"]') as HTMLElement | null)?.focus(); } },
    { id: 'prompt-lib', label: 'Open Prompt Library', shortcut: '', icon: <Bookmark className="h-3.5 w-3.5" />, action: () => setPromptLibOpen(true) },
    { id: 'change-mode', label: 'Change AI Mode', shortcut: '', icon: <Sparkles className="h-3.5 w-3.5" />, action: () => { /* mode is in header */ } },
    { id: 'settings', label: 'Open Settings', shortcut: '', icon: <Settings className="h-3.5 w-3.5" />, action: () => setSettingsOpen(true) },
    { id: 'export', label: 'Export Chat', shortcut: '', icon: <Download className="h-3.5 w-3.5" />, action: () => setExportOpen(true) },
    { id: 'go-home', label: 'Go to Home', shortcut: '', icon: <Sparkles className="h-3.5 w-3.5" />, action: () => navigate('/') },
  ], [createNewChat, navigate]);

  // Insert text into input (from prompt library, quick actions, etc.)
  const insertInput = useCallback((text: string) => {
    setInputText(text);
    setTimeout(() => {
      const el = document.querySelector('textarea') as HTMLTextAreaElement | null;
      if (el) { el.focus(); el.scrollTop = el.scrollHeight; }
    }, 50);
  }, [setInputText]);

  // Send message that includes input text
  const handleSend = useCallback((msg: string) => {
    sendMessage(msg);
    setInputText('');
  }, [sendMessage, setInputText]);

  // Handle response quality action
  const handleResponseAction = useCallback((action: string) => {
    insertInput(action);
  }, [insertInput]);

  // Suggestion click
  const handleSuggestionClick = useCallback((prompt: string) => {
    handleSend(prompt);
  }, [handleSend]);

  // Check if message is pinned
  const isPinned = useCallback((msgId: string) => {
    return pinnedMessages.some((m) => m.id === msgId);
  }, [pinnedMessages]);

  return (
    <div className="flex h-[100dvh] w-full bg-[#0a0a0f] text-foreground overflow-hidden">
      <Sidebar
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen(!sidebarOpen)}
        filteredSessions={filteredSessions}
        activeSessionId={activeSessionId}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onSelect={selectSession}
        onDelete={deleteSession}
        onNewChat={createNewChat}
        onMoveToFolder={moveToFolder}
      />

      {/* Main Content */}
      <div className={`flex-1 flex flex-col h-full transition-all duration-[300ms] ${sidebarOpen ? 'md:ml-[280px]' : 'ml-0'}`}>

        {/* Top Bar */}
        <header className="flex items-center justify-between h-[52px] px-4 border-b border-white/[0.04] bg-[#0a0a0f]/70 backdrop-blur-md shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            {!sidebarOpen && (
              <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(true)}
                className="h-8 w-8 text-slate-500 hover:text-white hover:bg-white/[0.05] rounded-lg transition-all">
                <PanelLeftOpen className="h-4 w-4" />
              </Button>
            )}

            <div className="flex items-center gap-2 min-w-0">
              <h2 className="text-[13px] font-medium text-slate-200 truncate max-w-[120px] sm:max-w-[200px] md:max-w-md">
                {activeSession.title}
              </h2>
              {isDemoSession && (
                <span className="shrink-0 inline-flex items-center gap-1 text-[10px] px-1.5 py-[3px] rounded-md bg-amber-500/[0.08] text-amber-400/70 border border-amber-500/[0.12]">
                  <FlaskConical className="h-2.5 w-2.5" />
                  Demo
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* AI Mode Selector */}
            <AIModeSelector currentMode={aiMode} onModeChange={setAiMode} />

            {/* Prompt Library */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setPromptLibOpen(true)}
              className="h-8 w-8 text-slate-500 hover:text-white hover:bg-white/[0.05] rounded-lg transition-all"
              title="Prompt Library"
            >
              <Bookmark className="h-4 w-4" />
            </Button>

            {/* Export */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setExportOpen(true)}
              className="h-8 w-8 text-slate-500 hover:text-white hover:bg-white/[0.05] rounded-lg transition-all"
              title="Export"
            >
              <Download className="h-4 w-4" />
            </Button>

            <PremiumBadge />

            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSettingsOpen(true)}
              className="h-8 w-8 text-slate-500 hover:text-white hover:bg-white/[0.05] rounded-lg transition-all"
            >
              <Settings className="h-4 w-4" />
            </Button>
          </div>
        </header>

        {/* Pinned Messages */}
        <PinnedMessages
          messages={pinnedMessages}
          onRemove={(id) => togglePin({ id, role: 'assistant', content: '', timestamp: new Date() } as any)}
          open={pinnedPanelOpen}
          onToggle={() => setPinnedPanelOpen(!pinnedPanelOpen)}
        />

        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto scrollbar-thin bg-[#0a0a0f]">
          {/* Onboarding */}
          {showOnboardingUI && (
            <Onboarding
              onDismiss={dismiss}
              onStartChat={(prompt) => {
                handleSend(prompt);
                dismiss();
              }}
            />
          )}

          {/* Empty state (non-onboarding) */}
          {isEmptyState && !showOnboardingUI && (
            <div className="flex flex-col items-center justify-center h-full px-5">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-400 to-blue-600 mb-6 shadow-lg shadow-cyan-500/[0.15] animate-scale-in">
                <Sparkles className="h-7 w-7 text-white" />
              </div>
              <h2 className="text-xl font-semibold text-white mb-1.5 animate-fade-in-up" style={{ animationDelay: '0.05s' }}>
                How can I help?
              </h2>
              <p className="text-slate-600 text-[13px] mb-8 text-center max-w-sm animate-fade-in-up" style={{ animationDelay: '0.1s' }}>
                Code, write, analyze data, or brainstorm your next idea.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-md animate-fade-in-up" style={{ animationDelay: '0.15s' }}>
                {suggestions.map((s) => (
                  <button key={s.label} onClick={() => handleSuggestionClick(s.prompt)}
                    className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-left hover:bg-white/[0.05] hover:border-white/[0.1] transition-all duration-200 group">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-500/[0.12] to-blue-500/[0.12] text-cyan-400/70 group-hover:scale-110 transition-transform duration-300">
                      <s.icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-[13px] font-medium text-slate-300">{s.label}</div>
                      <div className="text-[11px] text-slate-600 truncate max-w-[180px]">{s.prompt}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Messages */}
          {!isEmptyState && (
            <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">
              {/* Demo banner */}
              {isDemoSession && activeSession.messages.length > 0 && (
                <div className="flex items-center gap-2 rounded-lg border border-dashed border-amber-500/[0.12] bg-amber-500/[0.03] px-3 py-2 mb-4 animate-fade-in">
                  <FlaskConical className="h-3.5 w-3.5 text-amber-400/60 shrink-0" />
                  <span className="text-[11px] text-amber-400/60">
                    Demo conversation. Start a new chat for your own private conversation.
                  </span>
                </div>
              )}

              {activeSession.messages.map((message) => (
                <MessageBubble
                  key={message.id}
                  role={message.role}
                  content={message.content}
                  fullMessage={message}
                  shouldAnimate={message.id === animatedMessageId}
                  isPinned={isPinned(message.id)}
                  onPin={togglePin}
                  onRegenerate={message.role === 'assistant' ? () => {} : undefined}
                  onResponseAction={message.role === 'assistant' ? handleResponseAction : undefined}
                />
              ))}

              {/* Loading */}
              {isLoading && (
                <div className="flex gap-3 animate-fade-in">
                  <div className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[10px] bg-gradient-to-br from-cyan-400 to-blue-600 shadow-md shadow-cyan-500/15">
                    <Sparkles className="h-[14px] w-[14px] text-white" />
                  </div>
                  <div className="rounded-[18px] rounded-tl-[6px] bg-white/[0.03] border border-white/[0.06] message-shadow">
                    <TypingIndicator />
                  </div>
                </div>
              )}

              {/* Error */}
              {error && (
                <div className="flex gap-3 animate-fade-in">
                  <div className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[10px] bg-red-500/10">
                    <AlertTriangle className="h-[14px] w-[14px] text-red-400" />
                  </div>
                  <div className="rounded-[18px] rounded-tl-[6px] bg-red-500/[0.06] border border-red-500/[0.12] px-4 py-3 max-w-[85%] md:max-w-[75%]">
                    <p className="text-[13px] text-red-300/80 mb-3">{error}</p>
                    <Button variant="ghost" size="sm" onClick={retry}
                      className="h-7 gap-2 text-[11px] text-red-400/70 hover:text-red-300 hover:bg-red-500/[0.08] rounded-lg">
                      <RefreshCw className="h-3.5 w-3.5" />
                      Try Again
                    </Button>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} className="h-2" />
            </div>
          )}
        </div>

        {/* Quick Actions + Input */}
        {!showOnboardingUI && (
          <div className="shrink-0 px-3 md:px-4 pb-3 md:pb-4 pt-1 bg-[#0a0a0f]/60 backdrop-blur-xl">
            {/* Quick Actions Bar */}
            <div className="max-w-3xl mx-auto mb-1.5">
              <QuickActionsBar onSelect={insertInput} />
            </div>

            {/* Chat Input */}
            <div className="max-w-3xl mx-auto">
              <ChatInput onSend={handleSend} disabled={isLoading} externalValue={inputText} onExternalValueChange={setInputText} />
            </div>
          </div>
        )}
      </div>

      {/* Overlays */}
      <PromptLibrary open={promptLibOpen} onClose={() => setPromptLibOpen(false)} onSelect={insertInput} />
      <ExportChat open={exportOpen} onClose={() => setExportOpen(false)} session={activeSession} />
      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} commands={commands} />
      <SettingsModal open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}
