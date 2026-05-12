import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, User, Palette, Cpu, Brain, TrendingUp,
  Building2, Bell, Plug, Shield, FlaskConical,
  Check,
  Save, RotateCcw,
  Download, Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import MemoryGraph from './MemoryGraph';
import { useApp } from '@/contexts/AppContext';
import type { AIMode, WorkspaceTab } from '@/types';

// ─── Types ───
interface SectionDef { id: string; label: string; icon: React.ComponentType<{ className?: string }>; }

interface SettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSettingsChange?: (partial: Record<string, unknown>) => void;
}

interface SettingsState {
  theme: string;
  language: string;
  accentColor: string;
  density: string;
  animationLevel: string;
  fontSize: number;
  sidebarDefault: boolean;
  defaultWorkspace: string;
  defaultMode: string;
  responseStyle: string;
  reasoningDepth: string;
  creativity: number;
  memoryEnabled: boolean;
  maxMemoryItems: number;
  riskProfile: string;
  defaultTimeframe: string;
  paperTrading: boolean;
  soundEnabled: boolean;
  pushNotifications: boolean;
  notifAITasks: boolean;
  notifTrading: boolean;
  notifResearch: boolean;
  notifStartups: boolean;
  notifUpdates: boolean;
  integrations: Record<string, boolean>;
  experimental: Record<string, boolean>;
}

// ─── Constants ───
const SECTIONS: SectionDef[] = [
  { id: 'general', label: 'General', icon: User },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'ai', label: 'AI Behavior', icon: Cpu },
  { id: 'memory', label: 'Memory', icon: Brain },
  { id: 'trading', label: 'Trading', icon: TrendingUp },
  { id: 'business', label: 'Business', icon: Building2 },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'integrations', label: 'Integrations', icon: Plug },
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

const STORAGE_KEY = 'korvixai_settings_v1';

const DEFAULTS: SettingsState = {
  theme: 'dark',
  language: 'English',
  accentColor: 'cyan',
  density: 'Comfortable',
  animationLevel: 'Normal',
  fontSize: 14,
  sidebarDefault: true,
  defaultWorkspace: 'chat',
  defaultMode: 'fast',
  responseStyle: 'Balanced',
  reasoningDepth: 'Normal',
  creativity: 70,
  memoryEnabled: true,
  maxMemoryItems: 50,
  riskProfile: 'Balanced',
  defaultTimeframe: '1h',
  paperTrading: true,
  soundEnabled: true,
  pushNotifications: false,
  notifAITasks: true,
  notifTrading: true,
  notifResearch: true,
  notifStartups: false,
  notifUpdates: true,
  integrations: {
    'slack': false, 'discord': false, 'github': false, 'notion': false,
    'linear': false, 'figma': false, 'tradingview': false, 'metamask': false,
  },
  experimental: {
    'chain-of-thought': false, 'multi-agent': false, 'memory-graph': true,
    'real-time-data': false, 'voice-mode': false, 'vision-analysis': false,
    'code-execution': false, 'plugin-system': false,
  },
};

function load(): SettingsState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return { ...DEFAULTS, ...parsed, integrations: { ...DEFAULTS.integrations, ...parsed.integrations }, experimental: { ...DEFAULTS.experimental, ...parsed.experimental } };
    }
  } catch { /* ignore */ }
  return { ...DEFAULTS };
}

function saveToStorage(s: SettingsState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

// ─── Component ───
export default function SettingsModal({ open, onOpenChange, onSettingsChange }: SettingsModalProps) {
  const [activeSection, setActiveSection] = useState('general');
  const [settings, setSettings] = useState<SettingsState>(load);
  const [saved, setSaved] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const { t } = useApp();

  // ESC to close
  useEffect(() => {
    if (!open) return;
    const handle = (e: KeyboardEvent) => { if (e.key === 'Escape') onOpenChange(false); };
    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  }, [open, onOpenChange]);

  const update = useCallback((partial: Partial<SettingsState>) => {
    setHasChanges(true);
    setSettings((prev) => {
      const next = { ...prev, ...partial };
      saveToStorage(next);
      return next;
    });
    if (onSettingsChange) onSettingsChange(partial as Record<string, unknown>);
  }, [onSettingsChange]);

  const toggleIntegration = useCallback((id: string) => {
    setHasChanges(true);
    setSettings((prev) => {
      const next = { ...prev, integrations: { ...prev.integrations, [id]: !prev.integrations[id] } };
      saveToStorage(next);
      return next;
    });
  }, []);

  const toggleExperimental = useCallback((id: string) => {
    setHasChanges(true);
    setSettings((prev) => {
      const next = { ...prev, experimental: { ...prev.experimental, [id]: !prev.experimental[id] } };
      saveToStorage(next);
      return next;
    });
  }, []);

  const handleSave = useCallback(() => {
    saveToStorage(settings);
    setSaved(true);
    setHasChanges(false);
    if (onSettingsChange) onSettingsChange({});
    setTimeout(() => setSaved(false), 2000);
  }, [settings, onSettingsChange]);

  const handleReset = useCallback(() => {
    setSettings({ ...DEFAULTS });
    saveToStorage(DEFAULTS);
    setHasChanges(true);
    if (onSettingsChange) {
      onSettingsChange({ theme: DEFAULTS.theme, language: DEFAULTS.language, defaultWorkspace: DEFAULTS.defaultWorkspace, defaultMode: DEFAULTS.defaultMode });
    }
  }, [onSettingsChange]);

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
      <div>
        <div className="text-[12px] text-slate-300">{label}</div>
        {description && <div className="text-[11px] text-slate-600 mt-0.5">{description}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );

  if (!open) return null;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 backdrop-blur-md" onClick={() => onOpenChange(false)}>
      <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-2xl mx-4 max-h-[85vh] flex flex-col rounded-2xl border border-white/[0.08] bg-[#0c0c14] shadow-2xl shadow-black/50 overflow-hidden"
        onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.04] shrink-0">
          <h2 className="text-[16px] font-semibold text-white">{t('settings')}</h2>
          <button onClick={() => onOpenChange(false)} className="h-8 w-8 flex items-center justify-center rounded-lg text-slate-600 hover:text-white hover:bg-white/[0.05] transition-all">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar */}
          <div className="w-44 border-r border-white/[0.03] overflow-y-auto scrollbar-thin shrink-0">
            {SECTIONS.map((s) => {
              const isActive = activeSection === s.id;
              return (
                <button key={s.id} onClick={() => setActiveSection(s.id)}
                  className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-left text-[12px] transition-all duration-150 border-l-2 ${isActive ? 'bg-white/[0.04] border-l-cyan-400/50 text-white' : 'border-l-transparent text-slate-500 hover:text-slate-300 hover:bg-white/[0.02]'}`}>
                  <s.icon className={`h-3.5 w-3.5 ${isActive ? 'text-cyan-400/60' : 'text-slate-700'}`} />
                  {s.label}
                </button>
              );
            })}
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto scrollbar-thin">
            <AnimatePresence mode="wait">
              <motion.div key={activeSection} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.15 }} className="p-5">

                {/* ─── General ─── */}
                {activeSection === 'general' && (
                  <div className="space-y-1">
                    <h3 className="text-[13px] font-medium text-white mb-3">General Settings</h3>
                    <SettingRow label="Language" description="Interface language">
                      <Segmented options={[{ value: 'English', label: 'English' }, { value: 'Turkish', label: 'Turkish' }]} value={settings.language} onChange={(v) => update({ language: v })} />
                    </SettingRow>
                    <SettingRow label="Default Workspace" description="Workspace shown on launch">
                      <select value={settings.defaultWorkspace} onChange={(e) => update({ defaultWorkspace: e.target.value })}
                        className="rounded-lg bg-white/[0.05] border border-white/[0.08] px-3 py-1.5 text-[12px] text-slate-300 outline-none focus:border-cyan-500/30 cursor-pointer">
                        {WORKSPACES.map((w) => <option key={w.id} value={w.id} className="bg-[#0c0c14]">{w.label}</option>)}
                      </select>
                    </SettingRow>
                    <SettingRow label="Default AI Mode" description="Starting AI mode for new chats">
                      <select value={settings.defaultMode} onChange={(e) => update({ defaultMode: e.target.value })}
                        className="rounded-lg bg-white/[0.05] border border-white/[0.08] px-3 py-1.5 text-[12px] text-slate-300 outline-none focus:border-cyan-500/30 cursor-pointer">
                        {AI_MODES.map((m) => <option key={m.id} value={m.id} className="bg-[#0c0c14]">{m.label}</option>)}
                      </select>
                    </SettingRow>
                    <SettingRow label="Sidebar" description="Show sidebar by default">
                      <Switch checked={settings.sidebarDefault} onCheckedChange={(c) => update({ sidebarDefault: c })} />
                    </SettingRow>
                  </div>
                )}

                {/* ─── Appearance ─── */}
                {activeSection === 'appearance' && (
                  <div className="space-y-1">
                    <h3 className="text-[13px] font-medium text-white mb-3">Appearance</h3>
                    <SettingRow label="Theme" description="Dark, light, or follow system">
                      <Segmented options={[{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }, { value: 'system', label: 'System' }]} value={settings.theme} onChange={(v) => update({ theme: v })} />
                    </SettingRow>
                    <SettingRow label="Accent Color" description="Primary UI color">
                      <div className="flex gap-1.5">
                        {ACCENT_COLORS.map((c) => (
                          <button key={c.id} onClick={() => update({ accentColor: c.id })} title={c.label}
                            className={`flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br ${c.class} border transition-all ${settings.accentColor === c.id ? 'border-white/30 scale-110' : 'border-transparent opacity-60 hover:opacity-100'}`}>
                            {settings.accentColor === c.id && <Check className="h-3 w-3 text-white" />}
                          </button>
                        ))}
                      </div>
                    </SettingRow>
                    <SettingRow label="Density" description="UI element spacing">
                      <Segmented options={[{ value: 'Compact', label: 'Compact' }, { value: 'Comfortable', label: 'Comfortable' }, { value: 'Spacious', label: 'Spacious' }]} value={settings.density} onChange={(v) => update({ density: v })} />
                    </SettingRow>
                    <SettingRow label="Animations" description="Motion effects level">
                      <Segmented options={[{ value: 'Minimal', label: 'Minimal' }, { value: 'Normal', label: 'Normal' }, { value: 'Full', label: 'Full' }]} value={settings.animationLevel} onChange={(v) => update({ animationLevel: v })} />
                    </SettingRow>
                    <SettingRow label="Font Size" description={`${settings.fontSize}px`}>
                      <input type="range" min={12} max={18} value={settings.fontSize} onChange={(e) => update({ fontSize: Number(e.target.value) })}
                        className="w-24 accent-cyan-400" />
                    </SettingRow>
                  </div>
                )}

                {/* ─── AI Behavior ─── */}
                {activeSection === 'ai' && (
                  <div className="space-y-1">
                    <h3 className="text-[13px] font-medium text-white mb-3">AI Behavior</h3>
                    <SettingRow label="Response Style" description="Tone and verbosity">
                      <Segmented options={[{ value: 'Concise', label: 'Concise' }, { value: 'Balanced', label: 'Balanced' }, { value: 'Detailed', label: 'Detailed' }]} value={settings.responseStyle} onChange={(v) => update({ responseStyle: v })} />
                    </SettingRow>
                    <SettingRow label="Reasoning Depth" description="How deep the AI thinks">
                      <Segmented options={[{ value: 'Quick', label: 'Quick' }, { value: 'Normal', label: 'Normal' }, { value: 'Deep', label: 'Deep' }]} value={settings.reasoningDepth} onChange={(v) => update({ reasoningDepth: v })} />
                    </SettingRow>
                    <SettingRow label="Creativity" description={`${settings.creativity}%`}>
                      <input type="range" min={0} max={100} value={settings.creativity} onChange={(e) => update({ creativity: Number(e.target.value) })}
                        className="w-24 accent-cyan-400" />
                    </SettingRow>
                  </div>
                )}

                {/* ─── Memory ─── */}
                {activeSection === 'memory' && (
                  <div className="space-y-4">
                    <h3 className="text-[13px] font-medium text-white mb-1">Memory</h3>
                    <SettingRow label="Enable Memory" description="Store and reuse context">
                      <Switch checked={settings.memoryEnabled} onCheckedChange={(c) => update({ memoryEnabled: c })} />
                    </SettingRow>
                    <SettingRow label="Max Items" description={`${settings.maxMemoryItems} items`}>
                      <input type="range" min={10} max={200} value={settings.maxMemoryItems} onChange={(e) => update({ maxMemoryItems: Number(e.target.value) })}
                        className="w-24 accent-cyan-400" />
                    </SettingRow>
                    {settings.memoryEnabled && <MemoryGraph />}
                  </div>
                )}

                {/* ─── Trading ─── */}
                {activeSection === 'trading' && (
                  <div className="space-y-1">
                    <h3 className="text-[13px] font-medium text-white mb-3">Trading Settings</h3>
                    <SettingRow label="Risk Profile" description="Trading risk level">
                      <Segmented options={[{ value: 'Conservative', label: 'Conservative' }, { value: 'Balanced', label: 'Balanced' }, { value: 'Aggressive', label: 'Aggressive' }]} value={settings.riskProfile} onChange={(v) => update({ riskProfile: v })} />
                    </SettingRow>
                    <SettingRow label="Default Timeframe" description="Chart analysis timeframe">
                      <Segmented options={[{ value: '15m', label: '15m' }, { value: '1h', label: '1h' }, { value: '4h', label: '4h' }, { value: '1d', label: '1D' }]} value={settings.defaultTimeframe} onChange={(v) => update({ defaultTimeframe: v })} />
                    </SettingRow>
                    <SettingRow label="Paper Trading" description="Simulate trades without real money">
                      <Switch checked={settings.paperTrading} onCheckedChange={(c) => update({ paperTrading: c })} />
                    </SettingRow>
                  </div>
                )}

                {/* ─── Business ─── */}
                {activeSection === 'business' && (
                  <div className="space-y-1">
                    <h3 className="text-[13px] font-medium text-white mb-3">Business Settings</h3>
                    <SettingRow label="Startup Scan Frequency" description="How often to scan for opportunities">
                      <Segmented options={[{ value: 'daily', label: 'Daily' }, { value: 'weekly', label: 'Weekly' }, { value: 'realtime', label: 'Real-time' }]} value="daily" onChange={() => {}} />
                    </SettingRow>
                    <SettingRow label="Market Regions" description="Geographic focus">
                      <Segmented options={[{ value: 'global', label: 'Global' }, { value: 'us', label: 'US' }, { value: 'eu', label: 'EU' }]} value="global" onChange={() => {}} />
                    </SettingRow>
                  </div>
                )}

                {/* ─── Notifications ─── */}
                {activeSection === 'notifications' && (
                  <div className="space-y-1">
                    <h3 className="text-[13px] font-medium text-white mb-3">Notifications</h3>
                    <SettingRow label="Sound Effects" description="Play sounds for actions">
                      <Switch checked={settings.soundEnabled} onCheckedChange={(c) => update({ soundEnabled: c })} />
                    </SettingRow>
                    <SettingRow label="Push Notifications" description="Browser push notifications">
                      <Switch checked={settings.pushNotifications} onCheckedChange={(c) => update({ pushNotifications: c })} />
                    </SettingRow>
                    <div className="border-t border-white/[0.03] pt-2 mt-2 space-y-1">
                      <SettingRow label="AI Task Updates" description="Agent task completions"><Switch checked={settings.notifAITasks} onCheckedChange={(c) => update({ notifAITasks: c })} /></SettingRow>
                      <SettingRow label="Trading Signals" description="New trading opportunities"><Switch checked={settings.notifTrading} onCheckedChange={(c) => update({ notifTrading: c })} /></SettingRow>
                      <SettingRow label="Research Complete" description="Research report ready"><Switch checked={settings.notifResearch} onCheckedChange={(c) => update({ notifResearch: c })} /></SettingRow>
                      <SettingRow label="Startup Alerts" description="New startup discoveries"><Switch checked={settings.notifStartups} onCheckedChange={(c) => update({ notifStartups: c })} /></SettingRow>
                      <SettingRow label="App Updates" description="New features and improvements"><Switch checked={settings.notifUpdates} onCheckedChange={(c) => update({ notifUpdates: c })} /></SettingRow>
                    </div>
                  </div>
                )}

                {/* ─── Integrations ─── */}
                {activeSection === 'integrations' && (
                  <div className="space-y-1">
                    <h3 className="text-[13px] font-medium text-white mb-3">Integrations</h3>
                    {[
                      { id: 'slack', name: 'Slack', desc: 'Team notifications' },
                      { id: 'discord', name: 'Discord', desc: 'Community alerts' },
                      { id: 'github', name: 'GitHub', desc: 'Code repository' },
                      { id: 'notion', name: 'Notion', desc: 'Knowledge base' },
                      { id: 'linear', name: 'Linear', desc: 'Issue tracking' },
                      { id: 'figma', name: 'Figma', desc: 'Design files' },
                      { id: 'tradingview', name: 'TradingView', desc: 'Chart analysis' },
                      { id: 'metamask', name: 'MetaMask', desc: 'Web3 wallet' },
                    ].map((i) => (
                      <SettingRow key={i.id} label={i.name} description={i.desc}>
                        <button onClick={() => toggleIntegration(i.id)}
                          className={`text-[11px] px-3 py-1 rounded-lg border transition-all ${settings.integrations[i.id] ? 'bg-emerald-500/[0.08] text-emerald-400 border-emerald-500/15' : 'bg-white/[0.02] text-slate-500 border-white/[0.05] hover:border-white/[0.08]'}`}>
                          {settings.integrations[i.id] ? 'Connected' : 'Connect'}
                        </button>
                      </SettingRow>
                    ))}
                  </div>
                )}

                {/* ─── Privacy ─── */}
                {activeSection === 'privacy' && (
                  <div className="space-y-1">
                    <h3 className="text-[13px] font-medium text-white mb-3">Privacy & Security</h3>
                    <SettingRow label="Data Encryption" description="End-to-end encryption for sensitive data">
                      <span className="text-[11px] text-emerald-400/60 flex items-center gap-1"><Check className="h-3 w-3" /> Enabled</span>
                    </SettingRow>
                    <SettingRow label="Export Data" description="Download all your data">
                      <Button variant="ghost" size="sm" className="h-7 text-[11px] text-slate-400 hover:text-white gap-1.5"><Download className="h-3 w-3" /> Export</Button>
                    </SettingRow>
                    <SettingRow label="Delete Account" description="Permanently delete all data">
                      <Button variant="ghost" size="sm" className="h-7 text-[11px] text-red-400/60 hover:text-red-400 hover:bg-red-500/10 gap-1.5"><Trash2 className="h-3 w-3" /> Delete</Button>
                    </SettingRow>
                  </div>
                )}

                {/* ─── Experimental ─── */}
                {activeSection === 'experimental' && (
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
                        <Switch checked={settings.experimental[f.id] ?? false} onCheckedChange={() => toggleExperimental(f.id)} />
                      </SettingRow>
                    ))}
                  </div>
                )}

              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-white/[0.04] bg-white/[0.01] shrink-0">
          <button onClick={handleReset} className="flex items-center gap-1.5 text-[11px] text-slate-600 hover:text-slate-400 transition-colors">
            <RotateCcw className="h-3 w-3" /> Reset Defaults
          </button>
          <div className="flex items-center gap-2">
            {saved && (
              <motion.span initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="text-[11px] text-emerald-400/60 flex items-center gap-1">
                <Check className="h-3 w-3" /> Saved
              </motion.span>
            )}
            <Button onClick={handleSave} disabled={!hasChanges}
              className="h-8 px-4 text-[12px] bg-white/[0.06] hover:bg-white/[0.1] text-white border border-white/[0.08] rounded-lg transition-all disabled:opacity-30 disabled:cursor-not-allowed">
              <Save className="h-3.5 w-3.5 mr-1.5" /> {t('saveChanges')}
            </Button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
