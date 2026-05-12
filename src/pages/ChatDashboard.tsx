import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useChat } from '@/hooks/useChat';
import { useCommandPalette } from '@/hooks/useCommandPalette';
import { useToast } from '@/hooks/useToast';
import { useApp } from '@/contexts/AppContext';
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
import GuestBadge from '@/components/GuestBadge';

import {
  Settings, PanelLeftOpen, Command as CmdIcon,
  Bookmark, Download, Sparkles, Zap, Bot, MoreHorizontal,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const DEMO_ACTIVITIES = [
  { id: 'act1', status: 'active' as const, message: 'Deep Research on NVDA Q3 Earnings', progress: 65, detail: 'Analyzing financial statements...', timestamp: new Date() },
  { id: 'act2', status: 'active' as const, message: 'Market Sentiment Scan', progress: 34, detail: 'Processing 12K social posts...', timestamp: new Date() },
  { id: 'act3', status: 'completed' as const, message: 'Portfolio Risk Analysis', timestamp: new Date() },
  { id: 'act4', status: 'queued' as const, message: 'Weekly Trend Forecast', detail: 'Scheduled for 2:00 PM', timestamp: new Date() },
];

// Secondary actions in toolbar dropdown
function ToolbarDropdown({
  onCmd, onPrompts, onExport, onToggleRight, onUpgrade,
}: {
  onCmd: () => void;
  onPrompts: () => void;
  onExport: () => void;
  onToggleRight: () => void;
  onUpgrade: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null!);

  useEffect(() => {
    const handle = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  const items = [
    { label: 'Command Palette', shortcut: 'Cmd+K', icon: CmdIcon, action: () => { onCmd(); setOpen(false); } },
    { label: 'Prompt Library', shortcut: '', icon: Bookmark, action: () => { onPrompts(); setOpen(false); } },
    { label: 'Export Chat', shortcut: '', icon: Download, action: () => { onExport(); setOpen(false); } },
    { label: 'Context Panel', shortcut: '', icon: Sparkles, action: () => { onToggleRight(); setOpen(false); } },
    { label: 'Upgrade Plan', shortcut: '', icon: Zap, action: () => { onUpgrade(); setOpen(false); } },
  ];

  return (
    <div ref={ref} className="relative">
      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => setOpen(!open)}
        className="h-7 w-7 flex items-center justify-center text-slate-700 hover:text-slate-400 hover:bg-white/[0.03] rounded-md transition-all border border-white/[0.04]"
      >
        <MoreHorizontal className="h-3.5 w-3.5" />
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="absolute top-full right-0 mt-1.5 w-48 rounded-xl border border-white/[0.06] bg-[#0e0e14] shadow-2xl overflow-hidden z-50 py-1"
          >
            {items.map((item) => (
              <button
                key={item.label}
                onClick={item.action}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-[12px] text-slate-500 hover:text-slate-300 hover:bg-white/[0.03] transition-all"
              >
                <item.icon className="h-3.5 w-3.5 text-slate-600" />
                <span className="flex-1">{item.label}</span>
                {item.shortcut && <span className="text-[10px] text-slate-800 font-mono">{item.shortcut}</span>}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function ChatDashboard() {
  const { settings, updateSettings, t } = useApp();
  const {
    activeSession, activeSessionId, error, isLoading,
    aiMode, searchQuery, filteredSessions, pinnedMessages, inputText, currentTab,
    createNewChat, selectSession, deleteSession, sendMessage, retry, togglePin,
    setAiMode, setSearchQuery, setInputText, moveToFolder, switchTab,
  } = useChat();

  const { open: cmdOpen, setOpen: setCmdOpen } = useCommandPalette();
  const { toasts, addToast, removeToast } = useToast();

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [rightSidebarOpen, setRightSidebarOpen] = useState(false);
  const [promptLibOpen, setPromptLibOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>(settings.defaultWorkspace);
  const [showTimeline, setShowTimeline] = useState(false);

  // Sync active tab when defaultWorkspace changes
  useEffect(() => {
    setActiveTab(settings.defaultWorkspace);
  }, [settings.defaultWorkspace]);

  // Show agent timeline during loading
  useEffect(() => {
    if (isLoading && (activeTab === 'research' || activeTab === 'agents')) {
      setShowTimeline(true);
    } else if (!isLoading) {
      const timer = setTimeout(() => setShowTimeline(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [isLoading, activeTab]);

  // Mobile sidebar
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

  // ─── Tab change handler: uses isolated session switch ───
  const handleTabChange = useCallback((tab: WorkspaceTab) => {
    setActiveTab(tab);
    switchTab(tab);
  }, [switchTab]);

  // Global New Chat
  const handleNewChat = useCallback(() => {
    createNewChat();
    setActiveTab(currentTab);
    addToast(t('saved') === 'Kaydedildi' ? 'Yeni sohbet baslatildi' : 'New conversation started', 'success');
  }, [createNewChat, addToast, t, currentTab]);

  const handleSelectSession = useCallback((id: string) => {
    selectSession(id);
  }, [selectSession]);

  const handleHoverAction = useCallback((action: string, prompt: string) => {
    setInputText(prompt);
    addToast(`${action} applied`, 'success');
  }, [setInputText, addToast]);

  // Settings change handler
  const handleSettingsChange = useCallback((partial: Partial<typeof settings>) => {
    updateSettings(partial);
    addToast(t('saved') === 'Kaydedildi' ? 'Ayarlar kaydedildi' : 'Settings saved', 'success');
  }, [updateSettings, addToast, t]);

  // Command palette items
  const commandItems = useMemo(() => [
    { id: 'new-chat', label: t('newChat'), shortcut: '', icon: <Sparkles className="h-3.5 w-3.5" />, category: 'Actions', action: handleNewChat },
    { id: 'deep-research', label: 'Deep Research', shortcut: '', icon: <Zap className="h-3.5 w-3.5" />, category: 'Actions', action: () => handleTabChange('research') },
    { id: 'analyze-stock', label: t('trading'), shortcut: '', icon: <Zap className="h-3.5 w-3.5" />, category: 'Actions', action: () => handleTabChange('trading') },
    { id: 'open-agents', label: t('agents'), shortcut: '', icon: <Bot className="h-3.5 w-3.5" />, category: 'Actions', action: () => handleTabChange('agents') },
    { id: 'export', label: t('export'), shortcut: '', icon: <Download className="h-3.5 w-3.5" />, category: 'Actions', action: () => setExportOpen(true) },
    { id: 'upgrade', label: t('upgrade'), shortcut: '', icon: <Zap className="h-3.5 w-3.5" />, category: 'Actions', action: () => setUpgradeOpen(true) },
    { id: 'chat-tab', label: t('chat'), shortcut: '', icon: <Sparkles className="h-3.5 w-3.5" />, category: 'Navigation', action: () => handleTabChange('chat') },
    { id: 'coding-tab', label: t('coding'), shortcut: '', icon: <Sparkles className="h-3.5 w-3.5" />, category: 'Navigation', action: () => handleTabChange('coding') },
    { id: 'research-tab', label: t('research'), shortcut: '', icon: <Zap className="h-3.5 w-3.5" />, category: 'Navigation', action: () => handleTabChange('research') },
    { id: 'trading-tab', label: t('trading'), shortcut: '', icon: <Zap className="h-3.5 w-3.5" />, category: 'Navigation', action: () => handleTabChange('trading') },
    { id: 'business-tab', label: t('business'), shortcut: '', icon: <Bot className="h-3.5 w-3.5" />, category: 'Navigation', action: () => handleTabChange('business') },
    { id: 'startup-tab', label: t('startup'), shortcut: '', icon: <Sparkles className="h-3.5 w-3.5" />, category: 'Navigation', action: () => handleTabChange('startup') },
    { id: 'agents-tab', label: t('agents'), shortcut: '', icon: <Bot className="h-3.5 w-3.5" />, category: 'Navigation', action: () => handleTabChange('agents') },
    { id: 'study-tab', label: t('study'), shortcut: '', icon: <Sparkles className="h-3.5 w-3.5" />, category: 'Navigation', action: () => handleTabChange('study') },
    { id: 'creative-tab', label: t('creative'), shortcut: '', icon: <Sparkles className="h-3.5 w-3.5" />, category: 'Navigation', action: () => handleTabChange('creative') },
    { id: 'prompts', label: t('prompts'), shortcut: '', icon: <Bookmark className="h-3.5 w-3.5" />, category: 'Actions', action: () => setPromptLibOpen(true) },
    { id: 'settings', label: t('settings'), shortcut: '', icon: <Settings className="h-3.5 w-3.5" />, category: 'Actions', action: () => setSettingsOpen(true) },
  ], [handleNewChat, handleTabChange, t]);

  const insertInput = (text: string) => {
    setInputText(text);
  };

  // ─── Render workspace with per-mode isolation ───
  const renderWorkspace = () => {
    const isChatTab = ['chat', 'research', 'coding', 'startup', 'study', 'creative'].includes(activeTab);

    if (isChatTab) {
      return (
        <ChatView
          key={activeSessionId} // Forces remount ONLY when session actually changes
          messages={activeSession.messages}
          isLoading={isLoading}
          error={error}
          inputText={inputText}
          onSend={sendMessage}
          onRetry={retry}
          onSetInput={setInputText}
          onTogglePin={togglePin}
          pinnedMessages={pinnedMessages}
          onHoverAction={handleHoverAction}
          workspace={activeTab}
        />
      );
    }

    switch (activeTab) {
      case 'trading':  return <TradingPanel />;
      case 'business': return <BusinessPanel />;
      case 'agents':   return <AgentsPanel />;
      default:         return (
        <ChatView
          key={activeSessionId}
          messages={activeSession.messages}
          isLoading={isLoading}
          error={error}
          inputText={inputText}
          onSend={sendMessage}
          onRetry={retry}
          onSetInput={setInputText}
          onTogglePin={togglePin}
          pinnedMessages={pinnedMessages}
          onHoverAction={handleHoverAction}
          workspace={activeTab}
        />
      );
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
            <WorkspaceTabs activeTab={activeTab} onTabChange={handleTabChange} />
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <AIModeSelector currentMode={aiMode} onModeChange={setAiMode} />
            <div className="w-px h-3.5 bg-white/[0.03] hidden sm:block" />
            <button onClick={() => setUpgradeOpen(true)} className="hidden sm:block">
              <PremiumBadge />
            </button>
            <div className="hidden sm:block">
              <GuestBadge />
            </div>
            <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} onClick={() => setSettingsOpen(true)}
              className="h-7 w-7 flex items-center justify-center text-slate-700 hover:text-amber-400 hover:bg-amber-500/[0.06] rounded-md transition-all border border-white/[0.04]"
              title={t('settings')}
            >
              <Settings className="h-3.5 w-3.5" />
            </motion.button>
            <ToolbarDropdown
              onCmd={() => setCmdOpen(true)}
              onPrompts={() => setPromptLibOpen(true)}
              onExport={() => setExportOpen(true)}
              onToggleRight={() => setRightSidebarOpen(!rightSidebarOpen)}
              onUpgrade={() => setUpgradeOpen(true)}
            />
          </div>
        </header>

        <AIActivityFeed activities={DEMO_ACTIVITIES} />
        <AgentTimeline isVisible={showTimeline} />
        <AIThinkingPanel isVisible={isLoading} />

        {/* Main content — NO AnimatePresence mode="wait" to prevent composer freeze */}
        <div className="relative flex-1 overflow-hidden flex z-0">
          <div className="flex-1 overflow-hidden">
            {renderWorkspace()}
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
      <SettingsModal open={settingsOpen} onOpenChange={setSettingsOpen} onSettingsChange={handleSettingsChange} />
      <UpgradeModal open={upgradeOpen} onClose={() => setUpgradeOpen(false)} />
      <ToastNotifications toasts={toasts} onRemove={removeToast} />
    </div>
  );
}
