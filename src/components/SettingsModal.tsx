import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, User, Palette, Cpu, Brain, TrendingUp,
  Bell, Shield, FlaskConical,
  Check, Save, RotateCcw, Download, Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import MemoryGraph from './MemoryGraph';
import PremiumSlider from './PremiumSlider';
import { useApp } from '@/contexts/AppContext';
import type { AppSettings } from '@/contexts/AppContext';
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
  { value: 'UTC', label: 'UTC' },
  { value: 'America/New_York', label: 'EST (New York)' },
  { value: 'America/Chicago', label: 'CST (Chicago)' },
  { value: 'America/Los_Angeles', label: 'PST (Los Angeles)' },
  { value: 'Europe/London', label: 'GMT (London)' },
  { value: 'Europe/Paris', label: 'CET (Paris)' },
  { value: 'Europe/Istanbul', label: 'TRT (Istanbul)' },
  { value: 'Asia/Tokyo', label: 'JST (Tokyo)' },
  { value: 'Asia/Shanghai', label: 'CST (Shanghai)' },
  { value: 'Asia/Singapore', label: 'SGT (Singapore)' },
  { value: 'Asia/Dubai', label: 'GST (Dubai)' },
  { value: 'Australia/Sydney', label: 'AEST (Sydney)' },
];

export default function SettingsModal({ open, onOpenChange, onSettingsChange }: SettingsModalProps) {
  const { settings: appSettings, updateSettings, t } = useApp();
  const [activeSection, setActiveSection] = useState('general');
  const [saved, setSaved] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ═══════════════════════════════════════════════════════
  // DRAFT STATE — changes accumulate locally, persist only
  // on "Save Changes" click. No auto-save on drag/click.
  // ═══════════════════════════════════════════════════════
  const [draft, setDraft] = useState<AppSettings>(appSettings);

  // Sync draft from appSettings when modal opens
  useEffect(() => {
    if (open) {
      setDraft(appSettings);
      setHasChanges(false);
      setSaved(false);
    }
  }, [open, appSettings]);

  // Reset saved toast timer on unmount
  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const handle = (e: KeyboardEvent) => { if (e.key === 'Escape') onOpenChange(false); };
    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  }, [open, onOpenChange]);

  // Local draft updater — marks hasChanges but does NOT persist
  const updateDraft = useCallback(<K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setHasChanges(true);
  }, []);

  // ─── Save Changes: single persist call, single toast ───
  const handleSave = useCallback(() => {
    // Persist entire draft at once
    const draftPartial: Partial<AppSettings> = {};
    (Object.keys(draft) as Array<keyof AppSettings>).forEach((key) => {
      if (draft[key] !== appSettings[key]) {
        (draftPartial as Record<string, unknown>)[key] = draft[key];
      }
    });
    updateSettings(draftPartial);
    if (onSettingsChange) onSettingsChange(draftPartial as Record<string, unknown>);

    setSaved(true);
    setHasChanges(false);

    // Single toast — clear any existing timer
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setSaved(false), 2000);
  }, [draft, appSettings, updateSettings, onSettingsChange]);

  const handleReset = useCallback(() => {
    setDraft(appSettings);
    setHasChanges(false);
    if (onSettingsChange) onSettingsChange({});
  }, [appSettings, onSettingsChange]);

  // ─── Sidebar / other local settings ───
  const [sidebarDefault, setSidebarDefault] = useState(() => {
    try { return JSON.parse(localStorage.getItem('korvix_sidebar_default') || 'true'); } catch { return true; }
  });
  const [timezone, setTimezone] = useState(() => localStorage.getItem('korvix_timezone') || Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [experimental, setExperimental] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem('korvix_experimental') || '{}'); } catch { return {}; }
  });

  const toggleExperimental = useCallback((id: string) => {
    setHasChanges(true);
    setExperimental((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      localStorage.setItem('korvix_experimental', JSON.stringify(next));
      return next;
    });
  }, []);

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

  // ─── Tab Content — reads from DRAFT, not appSettings ───
  const renderGeneral = () => (
    <div className="space-y-1">
      <h3 className="text-[13px] font-medium text-white mb-3">General</h3>
      <SettingRow label="Language" description="Interface language">
        <Segmented options={[{ value: 'English', label: 'English' }, { value: 'Turkish', label: 'Turkish' }]} value={draft.language} onChange={(v) => updateDraft('language', v as 'English' | 'Turkish')} />
      </SettingRow>
      <SettingRow label="Timezone" description="Local time display">
        <select value={timezone} onChange={(e) => { setHasChanges(true); setTimezone(e.target.value); localStorage.setItem('korvix_timezone', e.target.value); }}
          className="w-40 md:w-44 rounded-lg bg-white/[0.05] border border-white/[0.08] px-3 py-1.5 text-[12px] text-slate-300 outline-none focus:border-cyan-500/30 cursor-pointer appearance-none"
          style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2352525b' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center' }}>
          {TIMEZONES.map((tz) => <option key={tz.value} value={tz.value} className="bg-[#0c0c14]">{tz.label}</option>)}
        </select>
      </SettingRow>
      <SettingRow label="Default Workspace" description="On launch">
        <select value={draft.defaultWorkspace} onChange={(e) => updateDraft('defaultWorkspace', e.target.value as WorkspaceTab)}
          className="rounded-lg bg-white/[0.05] border border-white/[0.08] px-3 py-1.5 text-[12px] text-slate-300 outline-none focus:border-cyan-500/30 cursor-pointer">
          {WORKSPACES.map((w) => <option key={w.id} value={w.id} className="bg-[#0c0c14]">{w.label}</option>)}
        </select>
      </SettingRow>
      <SettingRow label="Default AI Mode" description="Starting mode">
        <select value={draft.defaultMode} onChange={(e) => updateDraft('defaultMode', e.target.value as AIMode)}
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
        <Segmented options={[{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }, { value: 'system', label: 'System' }]} value={draft.theme} onChange={(v) => updateDraft('theme', v as 'dark' | 'light' | 'system')} />
      </SettingRow>
      <SettingRow label="Accent Color" description="Primary UI color">
        <div className="flex gap-1.5">
          {ACCENT_COLORS.map((c) => (
            <button key={c.id} onClick={() => updateDraft('accentColor', c.id)} title={c.label}
              className={`flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br ${c.class} border transition-all ${draft.accentColor === c.id ? 'border-white/30 scale-110' : 'border-transparent opacity-60 hover:opacity-100'}`}>
              {draft.accentColor === c.id && <Check className="h-3 w-3 text-white" />}
            </button>
          ))}
        </div>
      </SettingRow>
      <SettingRow label="Density" description="UI spacing">
        <Segmented options={[{ value: 'Compact', label: 'Compact' }, { value: 'Comfortable', label: 'Comfortable' }, { value: 'Spacious', label: 'Spacious' }]} value={draft.density} onChange={(v) => updateDraft('density', v)} />
      </SettingRow>
      <SettingRow label="Animations" description="Motion level">
        <Segmented options={[{ value: 'Minimal', label: 'Minimal' }, { value: 'Normal', label: 'Normal' }, { value: 'Full', label: 'Full' }]} value={draft.animationLevel} onChange={(v) => updateDraft('animationLevel', v)} />
      </SettingRow>
    </div>
  );

  const renderAI = () => (
    <div className="space-y-1">
      <h3 className="text-[13px] font-medium text-white mb-3">AI Behavior</h3>

      <SettingRow label="Tone" description="How the AI communicates">
        <Segmented options={[
          { value: 'Natural', label: 'Natural' },
          { value: 'Professional', label: 'Pro' },
          { value: 'Friendly', label: 'Friendly' },
          { value: 'Concise', label: 'Concise' },
        ]} value={draft.tone} onChange={(v) => updateDraft('tone', v as 'Natural' | 'Professional' | 'Friendly' | 'Concise')} />
      </SettingRow>

      <SettingRow label="Response Length" description="Output verbosity">
        <Segmented options={[
          { value: 'Short', label: 'Short' },
          { value: 'Balanced', label: 'Balanced' },
          { value: 'Detailed', label: 'Detailed' },
        ]} value={draft.responseLength} onChange={(v) => updateDraft('responseLength', v as 'Short' | 'Balanced' | 'Detailed')} />
      </SettingRow>

      <SettingRow label="Reasoning Depth" description="How deep the AI thinks">
        <Segmented options={[{ value: 'Fast', label: 'Fast' }, { value: 'Balanced', label: 'Balanced' }, { value: 'Deep', label: 'Deep' }]} value={draft.reasoningDepth} onChange={(v) => updateDraft('reasoningDepth', v)} />
      </SettingRow>

      <SettingRow label="AI Language" description="Response language">
        <Segmented options={[
          { value: 'Auto-detect', label: 'Auto' },
          { value: 'Turkish', label: 'Turkish' },
          { value: 'English', label: 'English' },
        ]} value={draft.aiLanguageBehavior} onChange={(v) => updateDraft('aiLanguageBehavior', v as 'Auto-detect' | 'Turkish' | 'English')} />
      </SettingRow>

      <SettingRow label="Emoji Usage" description="In AI responses">
        <Segmented options={[{ value: 'Off', label: 'Off' }, { value: 'Low', label: 'Low' }, { value: 'Normal', label: 'Normal' }]} value={draft.emojiUsage} onChange={(v) => updateDraft('emojiUsage', v as 'Off' | 'Low' | 'Normal')} />
      </SettingRow>

      <div className="pt-3 border-t border-white/[0.03]">
        <p className="text-[11px] text-slate-600 mb-2">Creativity</p>
        <PremiumSlider value={draft.creativity} onChange={(v) => updateDraft('creativity', v)} showValue valueFormatter={(v) => `${v}%`} />
      </div>
    </div>
  );

  const renderMemory = () => (
    <div className="space-y-4">
      <h3 className="text-[13px] font-medium text-white mb-1">Memory</h3>
      <div className="flex items-center justify-between py-2.5">
        <div>
          <div className="text-[12px] text-slate-300">Enable Memory</div>
          <div className="text-[11px] text-slate-600 mt-0.5">Store and reuse conversation context</div>
        </div>
        <Switch checked={draft.memoryEnabled} onCheckedChange={(c) => updateDraft('memoryEnabled', c)} />
      </div>
      {draft.memoryEnabled && <MemoryGraph />}
    </div>
  );

  const renderTrading = () => (
    <div className="space-y-1">
      <h3 className="text-[13px] font-medium text-white mb-3">Trading</h3>
      <SettingRow label="Risk Profile" description="Risk tolerance">
        <Segmented options={[{ value: 'Conservative', label: 'Conservative' }, { value: 'Balanced', label: 'Balanced' }, { value: 'Aggressive', label: 'Aggressive' }]} value={draft.riskProfile} onChange={(v) => updateDraft('riskProfile', v)} />
      </SettingRow>
      <SettingRow label="Default Timeframe" description="Chart timeframe">
        <Segmented options={[{ value: '15m', label: '15m' }, { value: '1h', label: '1h' }, { value: '4h', label: '4h' }, { value: '1d', label: '1D' }]} value={draft.defaultTimeframe} onChange={(v) => updateDraft('defaultTimeframe', v)} />
      </SettingRow>
      <SettingRow label="Paper Trading" description="Simulate without real money">
        <Switch checked={draft.paperTrading} onCheckedChange={(c) => updateDraft('paperTrading', c)} />
      </SettingRow>
    </div>
  );

  const renderNotifications = () => (
    <div className="space-y-1">
      <h3 className="text-[13px] font-medium text-white mb-3">Notifications</h3>
      <SettingRow label="Sound Effects" description="Action sounds"><Switch checked={draft.soundEnabled} onCheckedChange={(c) => updateDraft('soundEnabled', c)} /></SettingRow>
      <SettingRow label="Push Notifications" description="Browser push"><Switch checked={draft.pushNotifications} onCheckedChange={(c) => updateDraft('pushNotifications', c)} /></SettingRow>
      <div className="border-t border-white/[0.03] pt-2 mt-2 space-y-1">
        <SettingRow label="AI Task Updates" description=""><Switch checked={draft.notifAITasks} onCheckedChange={(c) => updateDraft('notifAITasks', c)} /></SettingRow>
        <SettingRow label="Trading Signals" description=""><Switch checked={draft.notifTrading} onCheckedChange={(c) => updateDraft('notifTrading', c)} /></SettingRow>
        <SettingRow label="Research Complete" description=""><Switch checked={draft.notifResearch} onCheckedChange={(c) => updateDraft('notifResearch', c)} /></SettingRow>
        <SettingRow label="Startup Alerts" description=""><Switch checked={draft.notifStartups} onCheckedChange={(c) => updateDraft('notifStartups', c)} /></SettingRow>
        <SettingRow label="App Updates" description=""><Switch checked={draft.notifUpdates} onCheckedChange={(c) => updateDraft('notifUpdates', c)} /></SettingRow>
      </div>
    </div>
  );

  const renderPrivacy = () => (
    <div className="space-y-1">
      <h3 className="text-[13px] font-medium text-white mb-3">Privacy &amp; Security</h3>
      <SettingRow label="Data Encryption" description="End-to-end"><span className="text-[11px] text-emerald-400/60 flex items-center gap-1"><Check className="h-3 w-3" /> On</span></SettingRow>
      <SettingRow label="Export Data" description="Download all data"><Button variant="ghost" size="sm" className="h-7 text-[11px] text-slate-400 hover:text-white gap-1.5"><Download className="h-3 w-3" /> Export</Button></SettingRow>
      <SettingRow label="Delete Account" description=""><Button variant="ghost" size="sm" className="h-7 text-[11px] text-red-400/60 hover:text-red-400 hover:bg-red-500/10 gap-1.5"><Trash2 className="h-3 w-3" /> Delete</Button></SettingRow>
    </div>
  );

  const renderExperimental = () => (
    <div className="space-y-1">
      <h3 className="text-[13px] font-medium text-white mb-3">Experimental</h3>
      {[
        { id: 'chain-of-thought', name: 'Chain of Thought', desc: 'Visible reasoning' },
        { id: 'multi-agent', name: 'Multi-Agent', desc: 'Multiple agents together' },
        { id: 'memory-graph', name: 'Memory Graph', desc: 'Interactive memory' },
        { id: 'real-time-data', name: 'Real-time Data', desc: 'Live data feeds' },
        { id: 'voice-mode', name: 'Voice Mode', desc: 'Speak with AI' },
        { id: 'vision-analysis', name: 'Vision Analysis', desc: 'Image understanding' },
        { id: 'code-execution', name: 'Code Execution', desc: 'Sandbox execution' },
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
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 backdrop-blur-md p-4" onClick={() => onOpenChange(false)}>
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] as const }}
        className="w-full max-w-2xl h-[520px] sm:h-[560px] md:h-[600px] flex flex-col rounded-2xl border border-white/[0.08] bg-[#0c0c14] shadow-2xl shadow-black/50 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.04] shrink-0 h-[52px]">
          <h2 className="text-[15px] font-semibold text-white">{t('settings')}</h2>
          <button onClick={() => onOpenChange(false)} className="h-7 w-7 flex items-center justify-center rounded-lg text-slate-600 hover:text-white hover:bg-white/[0.05] transition-all">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Sidebar */}
          <div className="w-36 sm:w-40 border-r border-white/[0.03] overflow-y-auto scrollbar-thin shrink-0">
            {SECTIONS.map((s) => {
              const isActive = activeSection === s.id;
              return (
                <button key={s.id} onClick={() => setActiveSection(s.id)}
                  className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-left text-[11px] sm:text-[12px] transition-all duration-150 border-l-2 ${isActive ? 'bg-white/[0.04] border-l-cyan-400/50 text-white' : 'border-l-transparent text-slate-500 hover:text-slate-300 hover:bg-white/[0.02]'}`}>
                  <s.icon className={`h-3.5 w-3.5 ${isActive ? 'text-cyan-400/60' : 'text-slate-700'}`} />
                  {s.label}
                </button>
              );
            })}
          </div>

          {/* Content — opacity-only transition */}
          <div className="flex-1 min-w-0 overflow-y-auto scrollbar-thin">
            <AnimatePresence initial={false}>
              <motion.div key={activeSection} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }} className="p-5">
                {TAB_CONTENT[activeSection]}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-white/[0.04] bg-white/[0.01] shrink-0 h-[48px]">
          <button onClick={handleReset} className="flex items-center gap-1.5 text-[11px] text-slate-600 hover:text-slate-400 transition-colors">
            <RotateCcw className="h-3 w-3" /> Reset
          </button>
          <div className="flex items-center gap-2">
            {saved && (
              <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-[11px] text-emerald-400/60 flex items-center gap-1">
                <Check className="h-3 w-3" /> Saved
              </motion.span>
            )}
            <Button onClick={handleSave} disabled={!hasChanges}
              className="h-7 px-4 text-[12px] bg-white/[0.06] hover:bg-white/[0.1] text-white border border-white/[0.08] rounded-lg transition-all disabled:opacity-30">
              <Save className="h-3.5 w-3.5 mr-1.5" /> {t('saveChanges')}
            </Button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
