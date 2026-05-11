import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router';
import { useChat } from '@/hooks/useChat';
import { useCommandPalette } from '@/hooks/useCommandPalette';
import { useToast } from '@/hooks/useToast';
import type { WorkspaceTab } from '@/types';

import Sidebar from '@/components/Sidebar';
import RightSidebar from '@/components/RightSidebar';
import ChatView from '@/components/ChatView';
import TradingPanel from '@/components/TradingPanel';
import BusinessPanel from '@/components/BusinessPanel';
import AgentsPanel from '@/components/AgentsPanel';
import WorkspaceTabs from '@/components/WorkspaceTabs';
import AIActivityFeed from '@/components/AIActivityFeed';
import AIThinkingPanel from '@/components/AIThinkingPanel';
import AgentTimeline from '@/components/AgentTimeline';
import AdaptiveBackground from '@/components/AdaptiveBackground';
import CommandPalette from '@/components/CommandPalette';
import PromptLibrary from '@/components/PromptLibrary';
import ExportChat from '@/components/ExportChat';
import ToastNotifications from '@/components/ToastNotifications';
import AIModeSelector from '@/components/AIModeSelector';
import PremiumBadge from '@/components/PremiumBadge';
import SettingsModal from '@/components/SettingsModal';
import UpgradeModal from '@/components/UpgradeModal';

import {
  Settings, PanelLeftOpen, Command as CmdIcon,
  Bookmark, Download, Sparkles, Zap, Bot,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const DEMO_ACTIVITIES = [
  { id: 'act1', status: 'active' as const, message: 'Deep Research on NVDA Q3 Earnings', progress: 65, detail: 'Analyzing financial statements...', timestamp: new Date() },
  { id: 'act2', status: 'active' as const, message: 'Market Sentiment Scan', progress: 34, detail: 'Processing 12K social posts...', timestamp: new Date() },
  { id: 'act3', status: 'completed' as const, message: 'Portfolio Risk Analysis', timestamp: new Date() },
  { id: 'act4', status: 'queued' as const, message: 'Weekly Trend Forecast', detail: 'Scheduled for 2:00 PM', timestamp: new Date() },
];



export default function ChatDashboard() {
  const navigate = useNavigate();
  const {
    activeSession, activeSessionId, error, isLoading,
    aiMode, searchQuery, filteredSessions, pinnedMessages, inputText,
    createNewChat, selectSession, deleteSession, sendMessage, retry, togglePin,
    setAiMode, setSearchQuery, setInputText, moveToFolder,
  } = useChat();

  const { open: cmdOpen, setOpen: setCmdOpen } = useCommandPalette();
  const { toasts, addToast, removeToast } = useToast();

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [rightSidebarOpen, setRightSidebarOpen] = useState(false);
  const [promptLibOpen, setPromptLibOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('chat');
  const [showTimeline, setShowTimeline] = useState(false);

  // Show agent timeline during loading on research
  useEffect(() => {
    if (isLoading && (activeTab === 'research' || activeTab === 'agents')) {
      setShowTimeline(true);
    } else if (!isLoading) {
      const timer = setTimeout(() => setShowTimeline(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [isLoading, activeTab]);

  // Mobile sidebar auto-close
  useEffect(() => {
    const check = () => {
      if (window.innerWidth < 768) setSidebarOpen(false);
      if (window.innerWidth < 1024) setRightSidebarOpen(false);
    };
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // Toast on error
  useEffect(() => {
    if (error) addToast(error, 'error', 5000);
  }, [error, addToast]);

  // Global New Chat
  const handleNewChat = useCallback(() => {
    createNewChat();
    setActiveTab('chat');
    addToast('New conversation started', 'success');
    setTimeout(() => {
      const el = document.querySelector('textarea') as HTMLTextAreaElement | null;
      if (el) el.focus();
    }, 150);
  }, [createNewChat, addToast]);

  const handleSelectSession = useCallback((id: string) => {
    selectSession(id);
    setActiveTab('chat');
  }, [selectSession]);

  const handleHoverAction = useCallback((action: string, prompt: string) => {
    setInputText(prompt);
    addToast(`${action} applied`, 'success');
    setTimeout(() => {
      const el = document.querySelector('textarea') as HTMLTextAreaElement | null;
      if (el) { el.focus(); el.scrollTop = el.scrollHeight; }
    }, 50);
  }, [setInputText, addToast]);

  // Command palette items
  const commandItems = useMemo(() => [
    { id: 'new-chat', label: 'New Chat', shortcut: 'Create a conversation', icon: <Sparkles className="h-3.5 w-3.5" />, category: 'Actions', action: handleNewChat },
    { id: 'deep-research', label: 'Start Deep Research', shortcut: 'Multi-source research', icon: <Zap className="h-3.5 w-3.5" />, category: 'Actions', action: () => { setActiveTab('research'); addToast('Deep Research mode activated', 'info'); } },
    { id: 'analyze-stock', label: 'Analyze Stock', shortcut: 'Trading signal analysis', icon: <Zap className="h-3.5 w-3.5" />, category: 'Actions', action: () => { setActiveTab('trading'); addToast('Switched to Trading', 'info'); } },
    { id: 'open-agents', label: 'Open Agents', shortcut: 'AI agent workspace', icon: <Bot className="h-3.5 w-3.5" />, category: 'Actions', action: () => { setActiveTab('agents'); addToast('Switched to Agents', 'info'); } },
    { id: 'export', label: 'Export Chat', shortcut: 'Download conversation', icon: <Download className="h-3.5 w-3.5" />, category: 'Actions', action: () => setExportOpen(true) },
    { id: 'upgrade', label: 'Upgrade Plan', shortcut: 'Unlock premium features', icon: <Sparkles className="h-3.5 w-3.5" />, category: 'Actions', action: () => setUpgradeOpen(true) },
    { id: 'chat-tab', label: 'Chat', shortcut: 'Chat workspace', icon: <Sparkles className="h-3.5 w-3.5" />, category: 'Navigation', action: () => setActiveTab('chat') },
    { id: 'coding-tab', label: 'Coding', shortcut: 'Coding workspace', icon: <Sparkles className="h-3.5 w-3.5" />, category: 'Navigation', action: () => setActiveTab('coding') },
    { id: 'research-tab', label: 'Research', shortcut: 'Research workspace', icon: <Zap className="h-3.5 w-3.5" />, category: 'Navigation', action: () => setActiveTab('research') },
    { id: 'trading-tab', label: 'Trading', shortcut: 'Trading workspace', icon: <Zap className="h-3.5 w-3.5" />, category: 'Navigation', action: () => setActiveTab('trading') },
    { id: 'business-tab', label: 'Business', shortcut: 'Business workspace', icon: <Bot className="h-3.5 w-3.5" />, category: 'Navigation', action: () => setActiveTab('business') },
    { id: 'startup-tab', label: 'Startup', shortcut: 'Startup workspace', icon: <Sparkles className="h-3.5 w-3.5" />, category: 'Navigation', action: () => setActiveTab('startup') },
    { id: 'agents-tab', label: 'Agents', shortcut: 'Agents workspace', icon: <Bot className="h-3.5 w-3.5" />, category: 'Navigation', action: () => setActiveTab('agents') },
    { id: 'study-tab', label: 'Study', shortcut: 'Study workspace', icon: <Sparkles className="h-3.5 w-3.5" />, category: 'Navigation', action: () => setActiveTab('study') },
    { id: 'creative-tab', label: 'Creative', shortcut: 'Creative workspace', icon: <Sparkles className="h-3.5 w-3.5" />, category: 'Navigation', action: () => setActiveTab('creative') },
    { id: 'prompts', label: 'Prompt Library', shortcut: 'Browse saved prompts', icon: <Bookmark className="h-3.5 w-3.5" />, category: 'Actions', action: () => setPromptLibOpen(true) },
    { id: 'settings', label: 'Settings', shortcut: 'Configure preferences', icon: <Settings className="h-3.5 w-3.5" />, category: 'Actions', action: () => setSettingsOpen(true) },
    { id: 'home', label: 'Go to Home', shortcut: 'Return to landing page', icon: <Sparkles className="h-3.5 w-3.5" />, category: 'Navigation', action: () => navigate('/') },
  ], [handleNewChat, navigate, addToast]);

  const insertInput = (text: string) => {
    setInputText(text);
    setTimeout(() => {
      const el = document.querySelector('textarea') as HTMLTextAreaElement | null;
      if (el) { el.focus(); el.scrollTop = el.scrollHeight; }
    }, 50);
  };

  // Render the active workspace content
  const renderWorkspace = () => {
    const chatProps = {
      messages: activeSession.messages,
      isLoading, error, inputText,
      onSend: sendMessage, onRetry: retry, onSetInput: setInputText,
      onTogglePin: togglePin, pinnedMessages, onHoverAction: handleHoverAction,
      title: activeSession.title, workspace: activeTab,
    };

    switch (activeTab) {
      case 'chat':     return <ChatView {...chatProps} />;
      case 'research': return <ChatView {...chatProps} />;
      case 'coding':   return <ChatView {...chatProps} />;
      case 'startup':  return <ChatView {...chatProps} />;
      case 'study':    return <ChatView {...chatProps} />;
      case 'creative': return <ChatView {...chatProps} />;
      case 'trading':  return <TradingPanel />;
      case 'business': return <BusinessPanel />;
      case 'agents':   return <AgentsPanel />;
      default:         return <ChatView {...chatProps} />;
    }
  };

  return (
    <div className="relative flex h-[100dvh] w-full bg-[#0a0a0a] text-foreground overflow-hidden">
      <AdaptiveBackground activeTab={activeTab} />

      <Sidebar
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen(!sidebarOpen)}
        filteredSessions={filteredSessions}
        activeSessionId={activeSessionId}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onSelect={handleSelectSession}
        onDelete={deleteSession}
        onNewChat={handleNewChat}
        onMoveToFolder={moveToFolder}
      />

      <div className={`relative flex-1 flex flex-col h-full transition-all duration-[300ms] ${sidebarOpen ? 'md:ml-[260px]' : 'ml-0'}`}>
        {/* Top Bar */}
        <header className="relative flex items-center justify-between h-11 px-3 border-b border-white/[0.02] bg-[#0a0a0a]/60 backdrop-blur-xl shrink-0 z-10">
          <div className="flex items-center gap-2 min-w-0">
            {!sidebarOpen && (
              <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                onClick={() => setSidebarOpen(true)}
                className="h-7 w-7 flex items-center justify-center text-slate-700 hover:text-cyan-400 hover:bg-cyan-500/[0.06] rounded-md transition-all border border-white/[0.04]"
              >
                <PanelLeftOpen className="h-3.5 w-3.5" />
              </motion.button>
            )}
            <WorkspaceTabs activeTab={activeTab} onTabChange={setActiveTab} />
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <AIModeSelector currentMode={aiMode} onModeChange={setAiMode} />
            <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} onClick={() => setCmdOpen(true)}
              className="h-7 w-7 hidden sm:flex items-center justify-center text-slate-700 hover:text-cyan-400 hover:bg-cyan-500/[0.06] rounded-md transition-all border border-white/[0.04]"
              title="Command Palette (Cmd+K)"
            >
              <CmdIcon className="h-3.5 w-3.5" />
            </motion.button>
            <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} onClick={() => setPromptLibOpen(true)}
              className="h-7 w-7 flex items-center justify-center text-slate-700 hover:text-violet-400 hover:bg-violet-500/[0.06] rounded-md transition-all border border-white/[0.04]"
              title="Prompts"
            >
              <Bookmark className="h-3.5 w-3.5" />
            </motion.button>
            <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} onClick={() => setExportOpen(true)}
              className="h-7 w-7 flex items-center justify-center text-slate-700 hover:text-emerald-400 hover:bg-emerald-500/[0.06] rounded-md transition-all border border-white/[0.04]"
              title="Export"
            >
              <Download className="h-3.5 w-3.5" />
            </motion.button>
            <div className="w-px h-3.5 bg-white/[0.03] mx-0.5" />
            <button onClick={() => setUpgradeOpen(true)}>
              <PremiumBadge />
            </button>
            <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} onClick={() => setSettingsOpen(true)}
              className="h-7 w-7 flex items-center justify-center text-slate-700 hover:text-amber-400 hover:bg-amber-500/[0.06] rounded-md transition-all border border-white/[0.04]"
              title="Settings"
            >
              <Settings className="h-3.5 w-3.5" />
            </motion.button>
            <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
              onClick={() => setRightSidebarOpen(!rightSidebarOpen)}
              className="h-7 w-7 hidden lg:flex items-center justify-center text-slate-700 hover:text-cyan-400 hover:bg-cyan-500/[0.06] rounded-md transition-all border border-white/[0.04] ml-0.5"
              title="Toggle context panel"
            >
              <Sparkles className="h-3.5 w-3.5" />
            </motion.button>
          </div>
        </header>

        <AIActivityFeed activities={DEMO_ACTIVITIES} />
        <AgentTimeline isVisible={showTimeline} />
        <AIThinkingPanel isVisible={isLoading} />

        <div className="relative flex-1 overflow-hidden flex z-0">
          <div className="flex-1 overflow-hidden">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 12 }}
                transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                className="h-full"
              >
                {renderWorkspace()}
              </motion.div>
            </AnimatePresence>
          </div>

          <RightSidebar
            isOpen={rightSidebarOpen}
            onToggle={() => setRightSidebarOpen(!rightSidebarOpen)}
            activeSession={activeSession}
            activeTools={[]}
            aiMode={aiMode}
            pinnedMessages={pinnedMessages}
            memoryRefs={[]}
            isLoading={isLoading}
            activeTab={activeTab}
          />
        </div>
      </div>

      {/* Overlays */}
      <PromptLibrary open={promptLibOpen} onClose={() => setPromptLibOpen(false)} onSelect={insertInput} />
      <ExportChat open={exportOpen} onClose={() => setExportOpen(false)} session={activeSession} />
      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} commands={commandItems} />
      <SettingsModal open={settingsOpen} onOpenChange={setSettingsOpen} />
      <UpgradeModal open={upgradeOpen} onClose={() => setUpgradeOpen(false)} />
      <ToastNotifications toasts={toasts} onRemove={removeToast} />
    </div>
  );
}
