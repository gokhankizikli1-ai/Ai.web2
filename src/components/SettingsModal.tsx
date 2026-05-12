import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, User, Palette, Cpu, Brain, TrendingUp,
  Bell, Shield, FlaskConical,
  Check, Save, RotateCcw, Download, Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import MemoryGraph from './MemoryGraph';
import { useApp } from '@/contexts/AppContext';
import type { AIMode, WorkspaceTab } from '@/types';

interface SettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSettingsChange?: (partial: Record<string, unknown>) => void;
}

const SECTIONS = [
  { id: 'general', label: 'General', icon: User },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'ai', label: 'AI Behavior', icon: Cpu },
  { id: 'memory', label: 'Memory', icon: Brain },
  { id: 'trading', label: 'Trading', icon: TrendingUp },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'privacy', label: 'Privacy', icon: Shield },
  { id: 'experimental', label: 'Experimental', icon: FlaskConical },
];

const ACCENT_COLORS = [
  { id: 'cyan', label: 'Cyan', class: 'from-cyan-400 to-blue-600', dot: 'bg-cyan-400' },
  { id: 'emerald', label: 'Emerald', class: 'from-emerald-400 to-emerald-600', dot: 'bg-emerald-400' },
  { id: 'violet', label: 'Violet', class: 'from-violet-400 to-purple-600', dot: 'bg-violet-400' },
  { id: 'amber', label: 'Amber', class: 'from-amber-400 to-orange-600', dot: 'bg-amber-400' },
  { id: 'rose', label: 'Rose', class: 'from-rose-400 to-pink-600', dot: 'bg-rose-400' },
];

const AI_MODES: { id: AIMode; label: string }[] = [
  { id: 'fast', label: 'Fast' },
  { id: 'deep-think', label: 'Deep Think' },
  { id: 'research', label: 'Research' },
  { id: 'creative', label: 'Creative' },
  { id: 'coding', label: 'Coding' },
  { id: 'study', label: 'Study' },
];

const WORKSPACES: { id: WorkspaceTab; label: string }[] = [
  { id: 'chat', label: 'Chat' },
  { id: 'research', label: 'Research' },
  { id: 'trading', label: 'Trading' },
  { id: 'business', label: 'Business' },
  { id: 'agents', label: 'Agents' },
  { id: 'coding', label: 'Coding' },
  { id: 'startup', label: 'Startup' },
  { id: 'study', label: 'Study' },
  { id: 'creative', label: 'Creative' },
];

const TIMEZONES = [
  { value: 'UTC', label: 'UTC (Coordinated Universal Time)' },
  { value: 'America/New_York', label: 'EST (New York)' },
  { value: 'America/Chicago', label: 'CST (Chicago)' },
  { value: 'America/Denver', label: 'MST (Denver)' },
  { value: 'America/Los_Angeles', label: 'PST (Los Angeles)' },
  { value: 'Europe/London', label: 'GMT (London)' },
  { value: 'Europe/Paris', label: 'CET (Paris, Berlin)' },
  { value: 'Europe/Istanbul', label: 'TRT (Istanbul)' },
  { value: 'Asia/Tokyo', label: 'JST (Tokyo)' },
  { value: 'Asia/Shanghai', label: 'CST (Shanghai)' },
  { value: 'Asia/Singapore', label: 'SGT (Singapore)' },
  { value: 'Asia/Dubai', label: 'GST (Dubai)' },
  { value: 'Australia/Sydney', label: 'AEST (Sydney)' },
];

/* ═══════════════════════════════════════════
   SettingsModal — FIXED HEIGHT, NO RESIZE
   Key rules:
   - Modal: fixed height (not max-height)
   - Body: flex-1 with min-h-0
   - Content: overflow-y-auto
   - Tab transition: opacity ONLY (no x/y/scale)
   - No AnimatePresence mode="wait"
   ═══════════════════════════════════════════ */

export default function SettingsModal({ open, onOpenChange, onSettingsChange }: SettingsModalProps) {
  const { settings: appSettings, updateSettings, t } = useApp();
  const [activeSection, setActiveSection] = useState('general');
  const [saved, setSaved] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // Local-only state
  const [sidebarDefault, setSidebarDefault] = useState(() => {
    try { return JSON.parse(localStorage.getItem('korvix_sidebar_default') || 'true'); } catch { return true; }
  });
  const [timezone, setTimezone] = useState(() => localStorage.getItem('korvix_timezone') || Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [experimental, setExperimental] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem('korvix_experimental') || '{}'); } catch { return {}; }
  });

  // ESC to close
  useEffect(() => {
    if (!open) return;
    const handle = (e: KeyboardEvent) => { if (e.key === 'Escape') onOpenChange(false); };
    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  }, [open, onOpenChange]);

  const update = useCallback((partial: Partial<typeof appSettings>) => {
    setHasChanges(true);
    updateSettings(partial);
    if (onSettingsChange) onSettingsChange(partial as Record<string, unknown>);
  }, [updateSettings, onSettingsChange]);

  const toggleExperimental = useCallback((id: string) => {
    setHasChanges(true);
    setExperimental((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      localStorage.setItem('korvix_experimental', JSON.stringify(next));
      return next;
    });
  }, []);

  const handleSave = useCallback(() => {
    setSaved(true);
    setHasChanges(false);
    setTimeout(() => setSaved(false), 2000);
  }, []);

  const handleReset = useCallback(() => {
    updateSettings({
      language: 'English', theme: 'dark', accentColor: 'cyan',
      defaultWorkspace: 'chat', defaultMode: 'fast',
      density: 'Comfortable', animationLevel: 'Normal',
      responseStyle: 'Balanced', reasoningDepth: 'Normal',
      creativity: 70, memoryEnabled: true, riskProfile: 'Balanced',
      defaultTimeframe: '1h', paperTrading: true, soundEnabled: true,
      pushNotifications: false, notifAITasks: true, notifTrading: true,
      notifResearch: true, notifStartups: false, notifUpdates: true,
      experimental: {},
    });
    setSidebarDefault(true);
    setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
    setExperimental({});
    localStorage.removeItem('korvix_sidebar_default');
    localStorage.removeItem('korvix_timezone');
    localStorage.removeItem('korvix_experimental');
    setHasChanges(true);
    if (onSettingsChange) onSettingsChange({});
  }, [updateSettings, onSettingsChange]);

  const Segmented = ({ options, value, onChange }: { options: { value: string; label: string }[]; value: string; onChange: (v: string) => void }) => (
    <div className="flex gap-1 rounded-lg bg-white/[0.03] border border-white/[0.04] p-0.5">
      {options.map((o) => (
        <button key={o.value} onClick={() => onChange(o.value)}
          className={`flex-1 rounded-md py-1 text-[11px] font-medium transition-all ${value === o.value ? 'bg-white/[0.08] text-white shadow-sm' : 'text-slate-600 hover:text-slate-400'}`}>
          {o.label}
        </button>
      ))}
    </div>
  );

  const SettingRow = ({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) => (
    <div className="flex items-center justify-between py-2.5">
      <div className="pr-4">
        <div className="text-[12px] text-slate-300">{label}</div>
        {description && <div className="text-[11px] text-slate-600 mt-0.5">{description}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );

  // ─── Tab content renderers ───
  const renderGeneral = () => (
    <div className="space-y-1">
      <h3 className="text-[13px] font-medium text-white mb-3">General Settings</h3>
      <SettingRow label="Language" description="Interface language">
        <Segmented options={[{ value: 'English', label: 'English' }, { value: 'Turkish', label: 'Turkish' }]} value={appSettings.language} onChange={(v) => update({ language: v as 'English' | 'Turkish' })} />
      </SettingRow>
      <SettingRow label="Timezone" description="Local time display">
        <select value={timezone} onChange={(e) => { setHasChanges(true); setTimezone(e.target.value); localStorage.setItem('korvix_timezone', e.target.value); }}
          className="w-44 md:w-48 rounded-lg bg-white/[0.05] border border-white/[0.08] px-3 py-1.5 text-[12px] text-slate-300 outline-none focus:border-cyan-500/30 cursor-pointer appearance-none"
          style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2352525b' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center' }}>
          {TIMEZONES.map((tz) => <option key={tz.value} value={tz.value} className="bg-[#0c0c14]">{tz.label}</option>)}
        </select>
      </SettingRow>
      <SettingRow label="Default Workspace" description="Workspace on launch">
        <select value={appSettings.defaultWorkspace} onChange={(e) => update({ defaultWorkspace: e.target.value as WorkspaceTab })}
          className="rounded-lg bg-white/[0.05] border border-white/[0.08] px-3 py-1.5 text-[12px] text-slate-300 outline-none focus:border-cyan-500/30 cursor-pointer">
          {WORKSPACES.map((w) => <option key={w.id} value={w.id} className="bg-[#0c0c14]">{w.label}</option>)}
        </select>
      </SettingRow>
      <SettingRow label="Default AI Mode" description="Starting AI mode">
        <select value={appSettings.defaultMode} onChange={(e) => update({ defaultMode: e.target.value as AIMode })}
          className="rounded-lg bg-white/[0.05] border border-white/[0.08] px-3 py-1.5 text-[12px] text-slate-300 outline-none focus:border-cyan-500/30 cursor-pointer">
          {AI_MODES.map((m) => <option key={m.id} value={m.id} className="bg-[#0c0c14]">{m.label}</option>)}
        </select>
      </SettingRow>
      <SettingRow label="Sidebar" description="Show by default">
        <Switch checked={sidebarDefault} onCheckedChange={(c) => { setHasChanges(true); setSidebarDefault(c); localStorage.setItem('korvix_sidebar_default', JSON.stringify(c)); }} />
      </SettingRow>
    </div>
  );

  const renderAppearance = () => (
    <div className="space-y-1">
      <h3 className="text-[13px] font-medium text-white mb-3">Appearance</h3>
      <SettingRow label="Theme" description="Dark, light, or system">
        <Segmented options={[{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }, { value: 'system', label: 'System' }]} value={appSettings.theme} onChange={(v) => update({ theme: v as 'dark' | 'light' | 'system' })} />
      </SettingRow>
      <SettingRow label="Accent Color" description="Primary UI color">
        <div className="flex gap-1.5">
          {ACCENT_COLORS.map((c) => (
            <button key={c.id} onClick={() => update({ accentColor: c.id })} title={c.label}
              className={`flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br ${c.class} border transition-all ${appSettings.accentColor === c.id ? 'border-white/30 scale-110' : 'border-transparent opacity-60 hover:opacity-100'}`}>
              {appSettings.accentColor === c.id && <Check className="h-3 w-3 text-white" />}
            </button>
          ))}
        </div>
      </SettingRow>
      <SettingRow label="Density" description="UI element spacing">
        <Segmented options={[{ value: 'Compact', label: 'Compact' }, { value: 'Comfortable', label: 'Comfortable' }, { value: 'Spacious', label: 'Spacious' }]} value={appSettings.density} onChange={(v) => update({ density: v })} />
      </SettingRow>
      <SettingRow label="Animations" description="Motion effects level">
        <Segmented options={[{ value: 'Minimal', label: 'Minimal' }, { value: 'Normal', label: 'Normal' }, { value: 'Full', label: 'Full' }]} value={appSettings.animationLevel} onChange={(v) => update({ animationLevel: v })} />
      </SettingRow>
      <SettingRow label="Creativity" description={`${appSettings.creativity}%`}>
        <input type="range" min={0} max={100} value={appSettings.creativity} onChange={(e) => update({ creativity: Number(e.target.value) })} className="w-24 accent-cyan-400" />
      </SettingRow>
    </div>
  );

  const renderAI = () => (
    <div className="space-y-1">
      <h3 className="text-[13px] font-medium text-white mb-3">AI Behavior</h3>
      <SettingRow label="Response Style" description="Tone and verbosity">
        <Segmented options={[{ value: 'Concise', label: 'Concise' }, { value: 'Balanced', label: 'Balanced' }, { value: 'Detailed', label: 'Detailed' }]} value={appSettings.responseStyle} onChange={(v) => update({ responseStyle: v })} />
      </SettingRow>
      <SettingRow label="Reasoning Depth" description="How deep the AI thinks">
        <Segmented options={[{ value: 'Quick', label: 'Quick' }, { value: 'Normal', label: 'Normal' }, { value: 'Deep', label: 'Deep' }]} value={appSettings.reasoningDepth} onChange={(v) => update({ reasoningDepth: v })} />
      </SettingRow>
    </div>
  );

  const renderMemory = () => (
    <div className="space-y-4">
      <h3 className="text-[13px] font-medium text-white mb-1">Memory</h3>
      <SettingRow label="Enable Memory" description="Store and reuse context">
        <Switch checked={appSettings.memoryEnabled} onCheckedChange={(c) => update({ memoryEnabled: c })} />
      </SettingRow>
      {appSettings.memoryEnabled && <MemoryGraph />}
    </div>
  );

  const renderTrading = () => (
    <div className="space-y-1">
      <h3 className="text-[13px] font-medium text-white mb-3">Trading Settings</h3>
      <SettingRow label="Risk Profile" description="Trading risk level">
        <Segmented options={[{ value: 'Conservative', label: 'Conservative' }, { value: 'Balanced', label: 'Balanced' }, { value: 'Aggressive', label: 'Aggressive' }]} value={appSettings.riskProfile} onChange={(v) => update({ riskProfile: v })} />
      </SettingRow>
      <SettingRow label="Default Timeframe" description="Chart analysis timeframe">
        <Segmented options={[{ value: '15m', label: '15m' }, { value: '1h', label: '1h' }, { value: '4h', label: '4h' }, { value: '1d', label: '1D' }]} value={appSettings.defaultTimeframe} onChange={(v) => update({ defaultTimeframe: v })} />
      </SettingRow>
      <SettingRow label="Paper Trading" description="Simulate without real money">
        <Switch checked={appSettings.paperTrading} onCheckedChange={(c) => update({ paperTrading: c })} />
      </SettingRow>
    </div>
  );

  const renderNotifications = () => (
    <div className="space-y-1">
      <h3 className="text-[13px] font-medium text-white mb-3">Notifications</h3>
      <SettingRow label="Sound Effects" description="Play sounds for actions">
        <Switch checked={appSettings.soundEnabled} onCheckedChange={(c) => update({ soundEnabled: c })} />
      </SettingRow>
      <SettingRow label="Push Notifications" description="Browser push notifications">
        <Switch checked={appSettings.pushNotifications} onCheckedChange={(c) => update({ pushNotifications: c })} />
      </SettingRow>
      <div className="border-t border-white/[0.03] pt-2 mt-2 space-y-1">
        <SettingRow label="AI Task Updates" description="Agent task completions"><Switch checked={appSettings.notifAITasks} onCheckedChange={(c) => update({ notifAITasks: c })} /></SettingRow>
        <SettingRow label="Trading Signals" description="New trading opportunities"><Switch checked={appSettings.notifTrading} onCheckedChange={(c) => update({ notifTrading: c })} /></SettingRow>
        <SettingRow label="Research Complete" description="Research report ready"><Switch checked={appSettings.notifResearch} onCheckedChange={(c) => update({ notifResearch: c })} /></SettingRow>
        <SettingRow label="Startup Alerts" description="New startup discoveries"><Switch checked={appSettings.notifStartups} onCheckedChange={(c) => update({ notifStartups: c })} /></SettingRow>
        <SettingRow label="App Updates" description="New features and improvements"><Switch checked={appSettings.notifUpdates} onCheckedChange={(c) => update({ notifUpdates: c })} /></SettingRow>
      </div>
    </div>
  );

  const renderPrivacy = () => (
    <div className="space-y-1">
      <h3 className="text-[13px] font-medium text-white mb-3">Privacy &amp; Security</h3>
      <SettingRow label="Data Encryption" description="End-to-end encryption">
        <span className="text-[11px] text-emerald-400/60 flex items-center gap-1"><Check className="h-3 w-3" /> Enabled</span>
      </SettingRow>
      <SettingRow label="Export Data" description="Download all your data">
        <Button variant="ghost" size="sm" className="h-7 text-[11px] text-slate-400 hover:text-white gap-1.5"><Download className="h-3 w-3" /> Export</Button>
      </SettingRow>
      <SettingRow label="Delete Account" description="Permanently delete all data">
        <Button variant="ghost" size="sm" className="h-7 text-[11px] text-red-400/60 hover:text-red-400 hover:bg-red-500/10 gap-1.5"><Trash2 className="h-3 w-3" /> Delete</Button>
      </SettingRow>
    </div>
  );

  const renderExperimental = () => (
    <div className="space-y-1">
      <h3 className="text-[13px] font-medium text-white mb-3">Experimental Features</h3>
      {[
        { id: 'chain-of-thought', name: 'Chain of Thought', desc: 'Visible reasoning process' },
        { id: 'multi-agent', name: 'Multi-Agent Orchestration', desc: 'Run multiple agents together' },
        { id: 'memory-graph', name: 'Memory Graph Visualization', desc: 'Interactive memory explorer' },
        { id: 'real-time-data', name: 'Real-time Market Data', desc: 'Live data feeds' },
        { id: 'voice-mode', name: 'Voice Mode', desc: 'Speak with AI' },
        { id: 'vision-analysis', name: 'Vision Analysis', desc: 'Image understanding' },
        { id: 'code-execution', name: 'Code Execution', desc: 'Run code in sandbox' },
        { id: 'plugin-system', name: 'Plugin System', desc: 'Custom extensions' },
      ].map((f) => (
        <SettingRow key={f.id} label={f.name} description={f.desc}>
          <Switch checked={experimental[f.id] ?? false} onCheckedChange={() => toggleExperimental(f.id)} />
        </SettingRow>
      ))}
    </div>
  );

  const TAB_CONTENT: Record<string, React.ReactNode> = {
    general: renderGeneral(),
    appearance: renderAppearance(),
    ai: renderAI(),
    memory: renderMemory(),
    trading: renderTrading(),
    notifications: renderNotifications(),
    privacy: renderPrivacy(),
    experimental: renderExperimental(),
  };

  if (!open) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 backdrop-blur-md p-4"
      onClick={() => onOpenChange(false)}
    >
      {/* ═══ MODAL: Fixed height, never resizes ═══ */}
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        className="
          w-full max-w-2xl
          h-[520px] sm:h-[560px] md:h-[600px]
          flex flex-col
          rounded-2xl
          border border-white/[0.08]
          bg-[#0c0c14]
          shadow-2xl shadow-black/50
          overflow-hidden
        "
        onClick={(e) => e.stopPropagation()}
      >
        {/* ═══ Header: fixed height ═══ */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.04] shrink-0 h-[52px]">
          <h2 className="text-[15px] font-semibold text-white">{t('settings')}</h2>
          <button
            onClick={() => onOpenChange(false)}
            className="h-7 w-7 flex items-center justify-center rounded-lg text-slate-600 hover:text-white hover:bg-white/[0.05] transition-all"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ═══ Body: flex row, fills remaining height ═══ */}
        <div className="flex flex-1 min-h-0 overflow-hidden">

          {/* ═══ Sidebar: fixed width, scrolls independently ═══ */}
          <div className="w-40 sm:w-44 border-r border-white/[0.03] overflow-y-auto scrollbar-thin shrink-0">
            {SECTIONS.map((s) => {
              const isActive = activeSection === s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => setActiveSection(s.id)}
                  className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-left text-[12px] transition-all duration-150 border-l-2 ${
                    isActive
                      ? 'bg-white/[0.04] border-l-cyan-400/50 text-white'
                      : 'border-l-transparent text-slate-500 hover:text-slate-300 hover:bg-white/[0.02]'
                  }`}
                >
                  <s.icon className={`h-3.5 w-3.5 ${isActive ? 'text-cyan-400/60' : 'text-slate-700'}`} />
                  {s.label}
                </button>
              );
            })}
          </div>

          {/* ═══ Content: scrollable, opacity-only transition ═══ */}
          <div className="flex-1 min-w-0 overflow-y-auto scrollbar-thin">
            {/* NO mode="wait" — content swaps immediately with pure opacity fade */}
            <AnimatePresence initial={false}>
              <motion.div
                key={activeSection}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12 }}
                className="p-5"
              >
                {TAB_CONTENT[activeSection]}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        {/* ═══ Footer: fixed height ═══ */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-white/[0.04] bg-white/[0.01] shrink-0 h-[48px]">
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 text-[11px] text-slate-600 hover:text-slate-400 transition-colors"
          >
            <RotateCcw className="h-3 w-3" /> Reset Defaults
          </button>
          <div className="flex items-center gap-2">
            {saved && (
              <motion.span
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-[11px] text-emerald-400/60 flex items-center gap-1"
              >
                <Check className="h-3 w-3" /> Saved
              </motion.span>
            )}
            <Button
              onClick={handleSave}
              disabled={!hasChanges}
              className="h-7 px-4 text-[12px] bg-white/[0.06] hover:bg-white/[0.1] text-white border border-white/[0.08] rounded-lg transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <Save className="h-3.5 w-3.5 mr-1.5" /> {t('saveChanges')}
            </Button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
