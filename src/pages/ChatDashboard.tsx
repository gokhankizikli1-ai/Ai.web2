import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router';
import { useChat, TAB_KEYS } from '@/hooks/useChat';
import { useCommandPalette } from '@/hooks/useCommandPalette';
import { useJobActivities } from '@/hooks/useJobs';
import { useToast } from '@/hooks/useToast';
import { useApp } from '@/contexts/AppContext';
import type { WorkspaceTab } from '@/types';

import Sidebar from '@/components/Sidebar';
import RightSidebar from '@/components/RightSidebar';
import ChatView from '@/components/ChatView';
import TradingPanel from '@/components/TradingPanel';
import BusinessPanel from '@/components/BusinessPanel';
import WorkspaceTabs from '@/components/WorkspaceTabs';
import AIActivityFeed from '@/components/AIActivityFeed';
import AgentTimeline from '@/components/AgentTimeline';

import CommandPalette from '@/components/CommandPalette';
import PromptLibrary from '@/components/PromptLibrary';
import ExportChat from '@/components/ExportChat';
import ToastNotifications from '@/components/ToastNotifications';
import AIModeSelector from '@/components/AIModeSelector';
import PremiumBadge from '@/components/PremiumBadge';
import SettingsModal from '@/components/SettingsModal';
import UpgradeModal from '@/components/UpgradeModal';
import GuestBadge from '@/components/GuestBadge';
// OwnerModeChip is the always-visible entry point for owner mode.
// It self-renders both the locked (paste-token) and unlocked (open
// AdminPanel) states, so we don't need a separate AdminBadge slot.
// OwnerSessionIndicator stays as the click-to-expand permission
// surface for confirmed owners (no-op render for non-owners).
import OwnerModeChip from '@/components/OwnerModeChip';
import OwnerSessionIndicator from '@/components/OwnerSessionIndicator';
// Owner-greeting effect inside ChatDashboard reads these on mount.
import { useOwnerMode } from '@/hooks/useOwnerMode';
import { useAuthStore } from '@/stores/authStore';

import {
  Settings, PanelLeftOpen, Command as CmdIcon,
  Bookmark, Download, Sparkles, Zap, Bot, MoreHorizontal,
  FolderOpen,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const DEMO_ACTIVITIES = [
  { id: 'act1', status: 'active' as const, message: 'Deep Research on NVDA Q3 Earnings', progress: 65, detail: 'Analyzing financial statements...', timestamp: new Date() },
  { id: 'act2', status: 'active' as const, message: 'Market Sentiment Scan', progress: 34, detail: 'Processing 12K social posts...', timestamp: new Date() },
  { id: 'act3', status: 'completed' as const, message: 'Portfolio Risk Analysis', timestamp: new Date() },
  { id: 'act4', status: 'queued' as const, message: 'Weekly Trend Forecast', detail: 'Scheduled for 2:00 PM', timestamp: new Date() },
];

// Secondary actions in toolbar dropdown.
//
// NOTE: there is intentionally NO "Owner Mode" entry here. Owner mode
// activates automatically when an authenticated user's verified email
// matches the OWNER_EMAIL env var on the backend (see
// backend/services/admin/owner.py). Exposing a manual unlock to
// every visitor leaked the existence of admin mode and let curious
// users hammer the token endpoint. The token-only unlock path still
// exists for the maintainer (via the keyboard shortcut Ctrl/Cmd+Shift+O
// inside OwnerModeChip, which only fires when the chip is mounted —
// the chip itself is gated on isOwner OR a stored token, so casual
// users never see it).
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
        className="h-7 w-7 flex items-center justify-center rounded-md transition-all border hover:text-slate-300 hover:bg-white/[0.04]"
        style={{ color: 'rgba(148,163,184,0.4)', borderColor: 'rgba(255,255,255,0.05)' }}
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
            className="absolute top-full right-0 mt-1.5 w-48 rounded-xl border shadow-2xl overflow-hidden z-50 py-1"
            style={{ borderColor: 'rgba(255,255,255,0.06)', background: 'rgba(23,28,36,0.96)', backdropFilter: 'blur(24px)' }}
          >
            {items.map((item) => (
              <button
                key={item.label}
                onClick={item.action}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-[12px] transition-all hover:bg-white/[0.04]"
                style={{ color: 'rgba(148,163,184,0.6)' }}
              >
                <item.icon className="h-3.5 w-3.5" style={{ color: 'rgba(148,163,184,0.35)' }} />
                <span className="flex-1 hover:text-slate-200 transition-colors">{item.label}</span>
                {item.shortcut && <span className="text-[10px] font-mono" style={{ color: 'rgba(148,163,184,0.2)' }}>{item.shortcut}</span>}
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
    createNewChat, selectSession, deleteSession, insertSystemMessage,
    sendMessage, retry, togglePin,
    setAiMode, setSearchQuery, setInputText, switchTab,
  } = useChat();

  const { open: cmdOpen, setOpen: setCmdOpen } = useCommandPalette();
  const { toasts, addToast, removeToast } = useToast();

  // ── Owner chat greeting ─────────────────────────────────────────────
  // When an owner session activates AND the user is on a chat surface,
  // drop a one-time assistant greeting into the active session. Gated
  // on:
  //   - !isHydrating  (don't fire before auth resolves)
  //   - isOwner       (confirmed by backend /v2/admin/status)
  //   - sessionStorage flag (once-per-session, not once-per-render)
  // The greeting is fixed Turkish text per spec; falls back to a
  // neutral English variant when no display name is known.
  const ownerGreetingFiredRef = useRef<boolean>(false);
  const ownerModeForGreeting = useOwnerMode();
  const ownerAuthUser = useAuthStore((s) => s.user);
  const ownerIsHydrating = useAuthStore((s) => s.isHydrating);
  useEffect(() => {
    if (ownerIsHydrating) return;
    if (!ownerModeForGreeting.isOwner) return;
    if (ownerGreetingFiredRef.current) return;
    // sessionStorage guard — prevents replay on every internal route
    // change or component remount during the same browser session.
    try {
      if (sessionStorage.getItem('korvix_owner_greeting_shown') === '1') {
        ownerGreetingFiredRef.current = true; // catch up
        return;
      }
    } catch { /* ignore */ }
    // Need an active session to insert into. Skip silently if there
    // isn't one yet (will retry when activeSession populates).
    if (!activeSession?.id) return;

    const first = (ownerAuthUser?.name || ownerAuthUser?.email?.split('@')[0] || '').trim().split(/\s+/)[0];
    const greeting = first
      ? `Hoş geldiniz ${first} Bey. KorvixAI Owner Session aktif. Bugün hangi stratejik konuda ilerleyelim?`
      : 'Welcome back. KorvixAI Owner Session is active. Where would you like to focus today?';

    insertSystemMessage(greeting);
    ownerGreetingFiredRef.current = true;
    try { sessionStorage.setItem('korvix_owner_greeting_shown', '1'); }
    catch { /* ignore */ }
  }, [ownerIsHydrating, ownerModeForGreeting.isOwner, activeSession?.id, ownerAuthUser, insertSystemMessage]);

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [rightSidebarOpen, setRightSidebarOpen] = useState(false);
  const [promptLibOpen, setPromptLibOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  // Phase 7 — real job state feeds the AI Activity badge. When /v2/jobs
  // is reachable for the authed user we use those rows; otherwise (guest
  // / queue disabled) we fall back to the marketing-demo entries so the
  // feed isn't empty on first impression. `isAvailable` flips true only
  // after a successful response, so the demo never bleeds into a real
  // session.
  const { activities: realJobActivities, isAvailable: jobsAvailable } = useJobActivities();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<WorkspaceTab>(
    (searchParams.get('tab') as WorkspaceTab) || settings.defaultWorkspace
  );
  // Timeline only shows for research/agent deep operations

  // Sync active tab when defaultWorkspace changes
  useEffect(() => {
    // Only sync if no URL tab param is present
    if (!searchParams.get('tab')) {
      setActiveTab(settings.defaultWorkspace);
    }
  }, [settings.defaultWorkspace, searchParams]);

  // Agent timeline visibility: only for research/agents deep mode
  const showTimeline = isLoading && activeTab === 'research';

  // Responsive sidebar — close on tablet/mobile, open on desktop
  useEffect(() => {
    const check = () => {
      const w = window.innerWidth;
      if (w < 1024) setSidebarOpen(false);
      else setSidebarOpen(true);
      if (w < 1280) setRightSidebarOpen(false);
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
    if (tab === 'agents') {
      navigate('/projects');
      return;
    }
    setActiveTab(tab);
    switchTab(tab);
    // Sync URL param for deep-linking
    setSearchParams({ tab }, { replace: true });
  }, [switchTab, setSearchParams, navigate]);

  // Listen for workspace switch events from sidebar mode shortcuts
  useEffect(() => {
    const handler = (e: Event) => {
      const workspace = (e as CustomEvent).detail as WorkspaceTab;
      if (workspace && TAB_KEYS.includes(workspace)) {
        handleTabChange(workspace);
      }
    };
    window.addEventListener('korvix-switch-workspace', handler);
    return () => window.removeEventListener('korvix-switch-workspace', handler);
  }, [handleTabChange]);

  // Listen for route-to-chat events from business panel AI actions
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { prompt: string; workspace?: WorkspaceTab };
      if (detail?.prompt) {
        // Switch to chat tab and populate input
        handleTabChange('chat');
        setInputText(detail.prompt);
        addToast('Prompt ready — press Enter to send', 'success');
      }
    };
    window.addEventListener('korvix-route-to-chat', handler);
    return () => window.removeEventListener('korvix-route-to-chat', handler);
  }, [handleTabChange, setInputText, addToast]);

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
    { id: 'open-projects', label: t('projects') || 'Projects', shortcut: '', icon: <FolderOpen className="h-3.5 w-3.5" />, category: 'Actions', action: () => navigate('/projects') },
    { id: 'export', label: t('export'), shortcut: '', icon: <Download className="h-3.5 w-3.5" />, category: 'Actions', action: () => setExportOpen(true) },
    { id: 'upgrade', label: t('upgrade'), shortcut: '', icon: <Zap className="h-3.5 w-3.5" />, category: 'Actions', action: () => setUpgradeOpen(true) },
    { id: 'chat-tab', label: t('chat'), shortcut: '', icon: <Sparkles className="h-3.5 w-3.5" />, category: 'Navigation', action: () => handleTabChange('chat') },
    { id: 'coding-tab', label: t('coding'), shortcut: '', icon: <Sparkles className="h-3.5 w-3.5" />, category: 'Navigation', action: () => handleTabChange('coding') },
    { id: 'research-tab', label: t('research'), shortcut: '', icon: <Zap className="h-3.5 w-3.5" />, category: 'Navigation', action: () => handleTabChange('research') },
    { id: 'trading-tab', label: t('trading'), shortcut: '', icon: <Zap className="h-3.5 w-3.5" />, category: 'Navigation', action: () => handleTabChange('trading') },
    { id: 'business-tab', label: t('business'), shortcut: '', icon: <Bot className="h-3.5 w-3.5" />, category: 'Navigation', action: () => handleTabChange('business') },
    { id: 'startup-tab', label: t('startup'), shortcut: '', icon: <Sparkles className="h-3.5 w-3.5" />, category: 'Navigation', action: () => handleTabChange('startup') },
    { id: 'projects-tab', label: t('projects') || 'Projects', shortcut: '', icon: <FolderOpen className="h-3.5 w-3.5" />, category: 'Navigation', action: () => navigate('/projects') },
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
      case 'agents': return null;
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
    <div className="relative flex h-[100dvh] w-full max-w-full overflow-hidden" style={{ background: '#11151C', color: '#E2E8F0' }}>
      {/* Ambient background layers */}
      <div className="absolute inset-0 pointer-events-none">
        {/* Base gradient */}
        <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, #11151C 0%, #171C24 40%, #141821 100%)' }} />
        {/* Top-right cyan ambient glow */}
        <div className="absolute -top-[200px] -right-[200px] w-[600px] h-[600px] rounded-full opacity-[0.04]" style={{ background: 'radial-gradient(circle, #22D3EE 0%, transparent 70%)' }} />
        {/* Bottom-left blue ambient glow */}
        <div className="absolute -bottom-[200px] -left-[200px] w-[500px] h-[500px] rounded-full opacity-[0.03]" style={{ background: 'radial-gradient(circle, #3B82F6 0%, transparent 70%)' }} />
        {/* Center subtle depth */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] rounded-full opacity-[0.015]" style={{ background: 'radial-gradient(circle, #22D3EE 0%, transparent 60%)' }} />
        {/* Subtle grid overlay */}
        <div className="absolute inset-0 opacity-[0.008]" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)', backgroundSize: '80px 80px' }} />
      </div>

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

        onOpenSettings={() => setSettingsOpen(true)}
        onOpenUpgrade={() => setUpgradeOpen(true)}
      />

      <div
        // `flex-1 min-w-0 overflow-hidden` is what lets this column
        // shrink to fit the space the sidebar leaves — required so a
        // wide child (chat content, long URL, code block) cannot push
        // the viewport into horizontal scroll.
        //
        // No left-margin needed: on lg+ the sidebar is a relative
        // flex sibling that occupies its own 320px; on sub-lg the
        // sidebar is a fixed overlay (out of flow) so main is full
        // width either way.
        className="relative flex-1 min-w-0 flex flex-col h-[100dvh] overflow-hidden transition-all duration-300 ease-out"
        style={{ paddingBottom: 'var(--safe-area-inset-bottom, 0px)' }}
      >
        {/* Top Bar — NOTE: NO `overflow-hidden` here. The header used
            to carry overflow-hidden as a belt-and-suspenders against
            horizontal bleed, but it ALSO clipped the ToolbarDropdown
            (which opens DOWNWARD via `absolute top-full`), making the
            three-dot menu invisible. Horizontal bleed protection now
            lives at the parent (`flex-1 min-w-0 overflow-hidden` on
            the content pane) and at the tabs wrapper (`overflow-x-auto
            scrollbar-none`), so we get bleed protection AND popovers
            that escape the header bounds. */}
        <header className="relative flex items-center justify-between gap-2 h-11 px-3 border-b shrink-0 z-20" style={{ borderColor: 'rgba(255,255,255,0.04)', background: 'rgba(17,21,28,0.7)', backdropFilter: 'blur(20px)' }}>
          <div className="flex items-center gap-2 min-w-0 flex-1 overflow-x-auto scrollbar-none">
            {!sidebarOpen && (
              <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                onClick={() => setSidebarOpen(true)}
                className="h-7 w-7 shrink-0 flex items-center justify-center rounded-md transition-all border hover:text-cyan-400 hover:bg-white/[0.04] hover:border-cyan-500/15"
                style={{ color: 'rgba(148,163,184,0.5)', borderColor: 'rgba(255,255,255,0.05)' }}
              >
                <PanelLeftOpen className="h-3.5 w-3.5" />
              </motion.button>
            )}
            <WorkspaceTabs activeTab={activeTab} onTabChange={handleTabChange} />
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <AIModeSelector currentMode={aiMode} onModeChange={setAiMode} />
            <div className="w-px h-3.5 bg-border hidden sm:block" />
            <button onClick={() => setUpgradeOpen(true)} className="hidden sm:block">
              <PremiumBadge />
            </button>
            <div className="hidden sm:block">
              <GuestBadge />
            </div>
            {/* Owner-mode entry point. ALWAYS rendered:
                  - locked  → shield-with-question icon, click opens
                              OwnerUnlockModal to paste OWNER_TOKEN
                  - unlocked → amber pulsing chip, click opens AdminPanel
                The locked variant is the project owner's bootstrap
                from a fresh browser — without it they'd have to type
                localStorage.setItem(...) in the dev console. */}
            <OwnerModeChip />
            {/* Permission popover, visible only when confirmed owner. */}
            <OwnerSessionIndicator />
            <ToolbarDropdown
              onCmd={() => setCmdOpen(true)}
              onPrompts={() => setPromptLibOpen(true)}
              onExport={() => setExportOpen(true)}
              onToggleRight={() => setRightSidebarOpen(!rightSidebarOpen)}
              onUpgrade={() => setUpgradeOpen(true)}
            />
          </div>
        </header>

        <AIActivityFeed activities={jobsAvailable ? realJobActivities : DEMO_ACTIVITIES} />
        <AgentTimeline isVisible={showTimeline} />

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
