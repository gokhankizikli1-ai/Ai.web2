import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, User, Palette, Cpu, Brain, TrendingUp,
  Building2, Bell, Plug, Shield, FlaskConical,
  Check, Moon, Sun, Monitor, Settings,
  Save, RotateCcw, Globe, Volume2,
  Download, Trash2,
  Zap, BarChart3, Layers,
  AlertTriangle, Crown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import MemoryGraph from './MemoryGraph';
import type { AIMode } from '@/types';

// ─── Types ───
interface SectionDef {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

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

const RESPONSE_STYLES = ['Concise', 'Balanced', 'Detailed', 'Expert'];
const REASONING_DEPTHS = ['Fast', 'Normal', 'Deep'];
const THEMES = [
  { id: 'dark', label: 'Dark', icon: Moon },
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'system', label: 'System', icon: Monitor },
];
const DENSITIES = ['Compact', 'Comfortable', 'Spacious'];
const GLASS_STRENGTHS = ['Subtle', 'Medium', 'Strong'];
const ANIMATION_LEVELS = ['Minimal', 'Normal', 'Rich'];
const RISK_PROFILES = ['Conservative', 'Balanced', 'Aggressive'];
const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d', '1w'];
const AD_PLATFORMS = ['Meta', 'TikTok', 'Google'];
const TARGET_MARKETS = ['US', 'EU', 'APAC', 'Global'];

const INTEGRATIONS = [
  { id: 'shopify', name: 'Shopify', icon: 'S', color: 'text-green-400' },
  { id: 'stripe', name: 'Stripe', icon: 'St', color: 'text-purple-400' },
  { id: 'meta', name: 'Meta Ads', icon: 'M', color: 'text-blue-400' },
  { id: 'tiktok', name: 'TikTok Ads', icon: 'T', color: 'text-rose-400' },
  { id: 'ga', name: 'Google Analytics', icon: 'G', color: 'text-amber-400' },
  { id: 'tradingview', name: 'TradingView', icon: 'TV', color: 'text-cyan-400' },
  { id: 'binance', name: 'Binance', icon: 'B', color: 'text-yellow-400' },
  { id: 'github', name: 'GitHub', icon: 'GH', color: 'text-slate-300' },
];

const EXPERIMENTAL_FEATURES = [
  { id: 'agent-mode', label: 'Agent Mode', desc: 'Enable autonomous AI agents', icon: Zap },
  { id: 'deep-research', label: 'Deep Research', desc: 'Multi-source research synthesis', icon: Brain },
  { id: 'web-browsing', label: 'Web Browsing', desc: 'Live web search and browsing', icon: Globe },
  { id: 'autonomous-flows', label: 'Autonomous Workflows', desc: 'Self-directed task chains', icon: Layers },
  { id: 'streaming', label: 'Streaming Responses', desc: 'Real-time token streaming', icon: BarChart3 },
  { id: 'voice-mode', label: 'Voice Mode', desc: 'Voice input and output', icon: Volume2 },
  { id: 'advanced-trading', label: 'Advanced Trading Engine', desc: 'Real-time signal generation', icon: TrendingUp },
];

// ─── Settings State ───
interface SettingsState {
  accountName: string;
  language: string;
  defaultWorkspace: string;
  defaultMode: AIMode;
  theme: string;
  accentColor: string;
  density: string;
  animationLevel: string;
  glassStrength: string;
  responseStyle: string;
  reasoningDepth: string;
  creativity: number;
  memoryEnabled: boolean;
  projectMemory: boolean;
  workspaceMemory: boolean;
  riskProfile: string;
  defaultTimeframe: string;
  alertSensitivity: string;
  paperTrading: boolean;
  adPlatform: string;
  targetMarket: string;
  marginThreshold: number;
  competitorScan: boolean;
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

const DEFAULT_SETTINGS: SettingsState = {
  accountName: 'You',
  language: 'English',
  defaultWorkspace: 'Chat',
  defaultMode: 'fast',
  theme: 'dark',
  accentColor: 'cyan',
  density: 'Comfortable',
  animationLevel: 'Rich',
  glassStrength: 'Medium',
  responseStyle: 'Balanced',
  reasoningDepth: 'Normal',
  creativity: 70,
  memoryEnabled: true,
  projectMemory: true,
  workspaceMemory: false,
  riskProfile: 'Balanced',
  defaultTimeframe: '1h',
  alertSensitivity: 'Medium',
  paperTrading: true,
  adPlatform: 'Meta',
  targetMarket: 'US',
  marginThreshold: 30,
  competitorScan: true,
  soundEnabled: true,
  pushNotifications: false,
  notifAITasks: true,
  notifTrading: true,
  notifResearch: true,
  notifStartups: false,
  notifUpdates: true,
  integrations: Object.fromEntries(INTEGRATIONS.map((i) => [i.id, false])),
  experimental: Object.fromEntries(EXPERIMENTAL_FEATURES.map((f) => [f.id, false])),
};

function loadSettings(): SettingsState {
  try {
    const stored = localStorage.getItem('korvixai_settings');
    if (stored) return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
  } catch { /* ignore */ }
  return { ...DEFAULT_SETTINGS };
}

function saveSettingsToStorage(s: SettingsState) {
  localStorage.setItem('korvixai_settings', JSON.stringify(s));
}

// ─── Sub-components ───
function SectionHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-5">
      <h3 className="text-[15px] font-semibold text-white">{title}</h3>
      {description && <p className="text-[12px] text-slate-600 mt-0.5">{description}</p>}
    </div>
  );
}

function SettingRow({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-3.5 gap-4">
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-slate-300">{label}</p>
        {description && <p className="text-[11px] text-slate-600 mt-0.5">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function SegmentedControl({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex rounded-lg bg-white/[0.03] border border-white/[0.06] p-[3px] gap-[2px]">
      {options.map((opt) => (
        <button
          key={opt}
          onClick={() => onChange(opt)}
          className={`px-2.5 py-[5px] rounded-md text-[11px] font-medium transition-all duration-200 ${
            value === opt ? 'bg-white/[0.08] text-white shadow-sm' : 'text-slate-600 hover:text-slate-400'
          }`}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

function Slider({ value, onChange, min = 0, max = 100, suffix = '' }: { value: number; onChange: (v: number) => void; min?: number; max?: number; suffix?: string }) {
  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-24 h-1 bg-white/[0.06] rounded-full appearance-none cursor-pointer accent-cyan-400"
      />
      <span className="text-[11px] text-slate-500 font-mono w-8">{value}{suffix}</span>
    </div>
  );
}

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="bg-white/[0.03] border border-white/[0.06] rounded-lg px-3 py-1.5 text-[12px] text-white outline-none focus:border-cyan-500/30 transition-colors appearance-none cursor-pointer min-w-[100px]"
    >
      {options.map((o) => <option key={o} value={o} className="bg-[#0f0f16]">{o}</option>)}
    </select>
  );
}

// ─── Main Modal ───
interface SettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function SettingsModal({ open, onOpenChange }: SettingsModalProps) {
  const [activeSection, setActiveSection] = useState('general');
  const [settings, setSettings] = useState<SettingsState>(loadSettings);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false);
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onOpenChange]);

  const update = useCallback((partial: Partial<SettingsState>) => {
    setSettings((prev) => {
      const next = { ...prev, ...partial };
      saveSettingsToStorage(next);
      return next;
    });
  }, []);

  const toggleIntegration = useCallback((id: string) => {
    setSettings((prev) => {
      const next = { ...prev, integrations: { ...prev.integrations, [id]: !prev.integrations[id] } };
      saveSettingsToStorage(next);
      return next;
    });
  }, []);

  const toggleExperimental = useCallback((id: string) => {
    setSettings((prev) => {
      const next = { ...prev, experimental: { ...prev.experimental, [id]: !prev.experimental[id] } };
      saveSettingsToStorage(next);
      return next;
    });
  }, []);

  const handleSave = useCallback(() => {
    saveSettingsToStorage(settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, [settings]);

  const handleReset = useCallback(() => {
    setSettings({ ...DEFAULT_SETTINGS });
    saveSettingsToStorage(DEFAULT_SETTINGS);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, []);

  const renderSection = () => {
    switch (activeSection) {
      case 'general':
        return (
          <div className="space-y-1">
            <SectionHeader title="General" description="Manage your account and preferences" />
            <div className="rounded-xl border border-white/[0.04] bg-white/[0.01] p-4 mb-4">
              <div className="flex items-center gap-3 mb-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400 to-blue-600">
                  <Crown className="h-5 w-5 text-white" />
                </div>
                <div>
                  <p className="text-[13px] font-semibold text-white">{settings.accountName}</p>
                  <p className="text-[11px] text-slate-600">Free Plan</p>
                </div>
                <Button variant="ghost" size="sm" className="ml-auto h-7 text-[11px] text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/10 rounded-lg">
                  Upgrade
                </Button>
              </div>
            </div>
            <div className="divide-y divide-white/[0.03]">
              <SettingRow label="Display Name" description="Your name across the workspace"><input value={settings.accountName} onChange={(e) => update({ accountName: e.target.value })} className="bg-white/[0.03] border border-white/[0.06] rounded-lg px-3 py-1.5 text-[12px] text-white outline-none w-40" /></SettingRow>
              <SettingRow label="Language"><Select value={settings.language} onChange={(v) => update({ language: v })} options={['English', 'Spanish', 'French', 'German', 'Chinese', 'Japanese']} /></SettingRow>
              <SettingRow label="Default Workspace"><Select value={settings.defaultWorkspace} onChange={(v) => update({ defaultWorkspace: v })} options={['Chat', 'Research', 'Trading', 'Business', 'Agents']} /></SettingRow>
              <SettingRow label="Default AI Mode"><Select value={settings.defaultMode} onChange={(v) => update({ defaultMode: v as AIMode })} options={AI_MODES.map((m) => m.label)} /></SettingRow>
            </div>
          </div>
        );

      case 'appearance':
        return (
          <div className="space-y-1">
            <SectionHeader title="Appearance" description="Customize the visual experience" />
            <div className="divide-y divide-white/[0.03]">
              <SettingRow label="Theme" description="Choose your color scheme">
                <div className="flex rounded-lg bg-white/[0.03] border border-white/[0.06] p-[3px] gap-[2px]">
                  {THEMES.map((t) => (
                    <button key={t.id} onClick={() => update({ theme: t.id })} className={`flex items-center gap-1.5 px-2.5 py-[5px] rounded-md text-[11px] font-medium transition-all ${settings.theme === t.id ? 'bg-white/[0.08] text-white' : 'text-slate-600 hover:text-slate-400'}`}>
                      <t.icon className="h-3 w-3" />{t.label}
                    </button>
                  ))}
                </div>
              </SettingRow>
              <SettingRow label="Accent Color" description="Primary color throughout the app">
                <div className="flex gap-2">
                  {ACCENT_COLORS.map((c) => (
                    <button key={c.id} onClick={() => update({ accentColor: c.id })} className={`relative flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br ${c.class} transition-transform ${settings.accentColor === c.id ? 'ring-2 ring-white/30 scale-110' : 'hover:scale-105'}`}>
                      {settings.accentColor === c.id && <Check className="h-3 w-3 text-white" />}
                    </button>
                  ))}
                </div>
              </SettingRow>
              <SettingRow label="Layout Density"><SegmentedControl options={DENSITIES} value={settings.density} onChange={(v) => update({ density: v })} /></SettingRow>
              <SettingRow label="Animation Level"><SegmentedControl options={ANIMATION_LEVELS} value={settings.animationLevel} onChange={(v) => update({ animationLevel: v })} /></SettingRow>
              <SettingRow label="Glassmorphism"><SegmentedControl options={GLASS_STRENGTHS} value={settings.glassStrength} onChange={(v) => update({ glassStrength: v })} /></SettingRow>
            </div>
          </div>
        );

      case 'ai':
        return (
          <div className="space-y-1">
            <SectionHeader title="AI Behavior" description="Fine-tune how KorvixAI responds" />
            <div className="divide-y divide-white/[0.03]">
              <SettingRow label="Default Mode"><Select value={AI_MODES.find((m) => m.id === settings.defaultMode)?.label || 'Fast'} onChange={(v) => update({ defaultMode: AI_MODES.find((m) => m.label === v)?.id || 'fast' })} options={AI_MODES.map((m) => m.label)} /></SettingRow>
              <SettingRow label="Response Style"><SegmentedControl options={RESPONSE_STYLES} value={settings.responseStyle} onChange={(v) => update({ responseStyle: v })} /></SettingRow>
              <SettingRow label="Reasoning Depth"><SegmentedControl options={REASONING_DEPTHS} value={settings.reasoningDepth} onChange={(v) => update({ reasoningDepth: v })} /></SettingRow>
              <SettingRow label="Creativity" description="Higher = more imaginative responses"><Slider value={settings.creativity} onChange={(v) => update({ creativity: v })} /></SettingRow>
              <SettingRow label="Context Memory"><Switch checked={settings.memoryEnabled} onCheckedChange={(v) => update({ memoryEnabled: v })} /></SettingRow>
              <SettingRow label="Auto-Tool Usage" description="Allow AI to use tools automatically"><Switch checked={true} onCheckedChange={() => {}} /></SettingRow>
              <SettingRow label="Language Auto-Detect"><Switch checked={true} onCheckedChange={() => {}} /></SettingRow>
            </div>
          </div>
        );

      case 'memory':
        return (
          <div className="space-y-1">
            <SectionHeader title="Memory" description="Control what KorvixAI remembers" />
            <div className="divide-y divide-white/[0.03]">
              <SettingRow label="Memory Enabled" description="Allow KorvixAI to remember context"><Switch checked={settings.memoryEnabled} onCheckedChange={(v) => update({ memoryEnabled: v })} /></SettingRow>
              <SettingRow label="Project Memory" description="Remember per-project context"><Switch checked={settings.projectMemory} onCheckedChange={(v) => update({ projectMemory: v })} /></SettingRow>
              <SettingRow label="Workspace Memory" description="Cross-conversation memory"><Switch checked={settings.workspaceMemory} onCheckedChange={(v) => update({ workspaceMemory: v })} /></SettingRow>
            </div>
            {settings.memoryEnabled && (
              <div className="mt-4 space-y-4">
                {/* Memory Graph */}
                <div>
                  <p className="text-[12px] text-slate-600 mb-2 font-medium">Memory Connections</p>
                  <MemoryGraph />
                </div>

                {/* Memory items */}
                <div className="rounded-xl border border-white/[0.04] bg-white/[0.01] p-4">
                  <p className="text-[12px] text-slate-600 mb-2 font-medium">Saved Memories</p>
                  <div className="space-y-2">
                    {['User prefers concise responses', 'Works primarily with Python and React', 'Interested in fintech and SaaS'].map((m, i) => (
                      <div key={i} className="flex items-center justify-between rounded-lg bg-white/[0.02] px-3 py-2 border border-white/[0.03]">
                        <span className="text-[11px] text-slate-500">{m}</span>
                        <Button variant="ghost" size="sm" className="h-6 text-[10px] text-red-400/60 hover:text-red-400 hover:bg-red-500/10 rounded-md px-2">Delete</Button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        );

      case 'trading':
        return (
          <div className="space-y-1">
            <SectionHeader title="Trading" description="Configure trading signal behavior" />
            <div className="divide-y divide-white/[0.03]">
              <SettingRow label="Risk Profile"><SegmentedControl options={RISK_PROFILES} value={settings.riskProfile} onChange={(v) => update({ riskProfile: v })} /></SettingRow>
              <SettingRow label="Default Timeframe"><SegmentedControl options={TIMEFRAMES} value={settings.defaultTimeframe} onChange={(v) => update({ defaultTimeframe: v })} /></SettingRow>
              <SettingRow label="Alert Sensitivity"><Slider value={70} onChange={() => {}} /></SettingRow>
              <SettingRow label="Show Signal Cards"><Switch checked={true} onCheckedChange={() => {}} /></SettingRow>
              <SettingRow label="Paper Trading Mode" description="Simulate trades without real money"><Switch checked={settings.paperTrading} onCheckedChange={(v) => update({ paperTrading: v })} /></SettingRow>
            </div>
          </div>
        );

      case 'business':
        return (
          <div className="space-y-1">
            <SectionHeader title="Business" description="E-commerce and business intelligence" />
            <div className="divide-y divide-white/[0.03]">
              <SettingRow label="Ad Platform"><SegmentedControl options={AD_PLATFORMS} value={settings.adPlatform} onChange={(v) => update({ adPlatform: v })} /></SettingRow>
              <SettingRow label="Target Market"><SegmentedControl options={TARGET_MARKETS} value={settings.targetMarket} onChange={(v) => update({ targetMarket: v })} /></SettingRow>
              <SettingRow label="Margin Threshold" description="Minimum acceptable margin %"><Slider value={settings.marginThreshold} onChange={(v) => update({ marginThreshold: v })} suffix="%" /></SettingRow>
              <SettingRow label="Competitor Scan" description="Auto-scan competitor landscape"><Switch checked={settings.competitorScan} onCheckedChange={(v) => update({ competitorScan: v })} /></SettingRow>
              <SettingRow label="Shopify Integration"><Switch checked={false} onCheckedChange={() => {}} /></SettingRow>
            </div>
          </div>
        );

      case 'notifications':
        return (
          <div className="space-y-1">
            <SectionHeader title="Notifications" description="Control what alerts you receive" />
            <div className="divide-y divide-white/[0.03]">
              <SettingRow label="AI Tasks Completed"><Switch checked={settings.notifAITasks} onCheckedChange={(v) => update({ notifAITasks: v })} /></SettingRow>
              <SettingRow label="Trading Alerts"><Switch checked={settings.notifTrading} onCheckedChange={(v) => update({ notifTrading: v })} /></SettingRow>
              <SettingRow label="Research Completed"><Switch checked={settings.notifResearch} onCheckedChange={(v) => update({ notifResearch: v })} /></SettingRow>
              <SettingRow label="Startup Opportunities"><Switch checked={settings.notifStartups} onCheckedChange={(v) => update({ notifStartups: v })} /></SettingRow>
              <SettingRow label="System Updates"><Switch checked={settings.notifUpdates} onCheckedChange={(v) => update({ notifUpdates: v })} /></SettingRow>
              <div className="border-t border-white/[0.03] pt-3 mt-3" />
              <SettingRow label="Sound Effects"><Switch checked={settings.soundEnabled} onCheckedChange={(v) => update({ soundEnabled: v })} /></SettingRow>
              <SettingRow label="Push Notifications"><Switch checked={settings.pushNotifications} onCheckedChange={(v) => update({ pushNotifications: v })} /></SettingRow>
            </div>
          </div>
        );

      case 'integrations':
        return (
          <div className="space-y-1">
            <SectionHeader title="Integrations" description="Connect third-party services" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {INTEGRATIONS.map((int) => {
                const connected = settings.integrations[int.id];
                return (
                  <div key={int.id} className={`flex items-center justify-between rounded-xl border p-3.5 transition-all ${connected ? 'border-cyan-500/15 bg-cyan-500/[0.02]' : 'border-white/[0.04] bg-white/[0.01] hover:bg-white/[0.02]'}`}>
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.04] border border-white/[0.05]">
                        <span className={`text-[11px] font-bold ${int.color}`}>{int.icon}</span>
                      </div>
                      <div>
                        <p className="text-[12px] font-medium text-slate-300">{int.name}</p>
                        <p className="text-[10px] text-slate-600">{connected ? 'Connected' : 'Not connected'}</p>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleIntegration(int.id)}
                      className={`h-7 text-[11px] rounded-lg ${connected ? 'text-red-400/60 hover:text-red-400 hover:bg-red-500/10' : 'text-cyan-400/60 hover:text-cyan-400 hover:bg-cyan-500/10'}`}
                    >
                      {connected ? 'Disconnect' : 'Connect'}
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
        );

      case 'privacy':
        return (
          <div className="space-y-1">
            <SectionHeader title="Privacy & Security" description="Control your data and security" />
            <div className="divide-y divide-white/[0.03]">
              <SettingRow label="Data Controls" description="Manage what data is stored"><Button variant="ghost" size="sm" className="h-7 text-[11px] text-cyan-400/60 hover:text-cyan-400 rounded-lg">Manage</Button></SettingRow>
              <SettingRow label="Active Sessions"><span className="text-[11px] text-slate-500">1 active session</span></SettingRow>
              <SettingRow label="API Key Safety"><span className="text-[11px] text-slate-500">Keys never leave your device</span></SettingRow>
              <SettingRow label="Export Data"><Button variant="ghost" size="sm" className="h-7 text-[11px] text-cyan-400/60 hover:text-cyan-400 rounded-lg gap-1"><Download className="h-3 w-3" />Export</Button></SettingRow>
            </div>
            <div className="mt-6 rounded-xl border border-red-500/[0.08] bg-red-500/[0.02] p-4">
              <div className="flex items-center gap-2 mb-2"><AlertTriangle className="h-4 w-4 text-red-400/50" /><h4 className="text-[13px] font-semibold text-red-400/70">Danger Zone</h4></div>
              <p className="text-[11px] text-slate-600 mb-3">These actions cannot be undone.</p>
              <Button variant="ghost" className="h-8 text-[11px] text-red-400/60 hover:text-red-400 hover:bg-red-500/10 border border-red-500/[0.1] rounded-lg gap-1.5"><Trash2 className="h-3.5 w-3.5" />Delete Account</Button>
            </div>
          </div>
        );

      case 'experimental':
        return (
          <div className="space-y-1">
            <SectionHeader title="Experimental" description="Early access features — use with caution" />
            <div className="space-y-2">
              {EXPERIMENTAL_FEATURES.map((feat) => {
                const enabled = settings.experimental[feat.id];
                return (
                  <div key={feat.id} className={`flex items-center justify-between rounded-xl border p-3.5 transition-all ${enabled ? 'border-cyan-500/15 bg-cyan-500/[0.02]' : 'border-white/[0.04] bg-white/[0.01]'}`}>
                    <div className="flex items-center gap-3">
                      <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${enabled ? 'bg-cyan-500/10 text-cyan-400' : 'bg-white/[0.03] text-slate-600'}`}>
                        <feat.icon className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="text-[12px] font-medium text-slate-300">{feat.label}</p>
                        <p className="text-[10px] text-slate-600">{feat.desc}</p>
                      </div>
                    </div>
                    <Switch checked={enabled} onCheckedChange={() => toggleExperimental(feat.id)} />
                  </div>
                );
              })}
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => onOpenChange(false)}>
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 10 }}
        transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-3xl mx-4 h-[85vh] rounded-2xl border border-white/[0.08] bg-[#0b0b10] shadow-2xl overflow-hidden flex"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sidebar nav */}
        <aside className="w-52 shrink-0 border-r border-white/[0.04] bg-white/[0.01] flex flex-col">
          <div className="flex items-center justify-between px-4 py-3.5 border-b border-white/[0.03]">
            <div className="flex items-center gap-2">
              <Settings className="h-4 w-4 text-cyan-400/60" />
              <span className="text-[13px] font-semibold text-white">Settings</span>
            </div>
            <button onClick={() => onOpenChange(false)} className="text-slate-600 hover:text-white transition-colors p-1 rounded-md hover:bg-white/[0.05]">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto scrollbar-thin py-2 px-2 space-y-0.5">
            {SECTIONS.map((section) => {
              const isActive = activeSection === section.id;
              return (
                <button
                  key={section.id}
                  onClick={() => setActiveSection(section.id)}
                  className={`w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[12px] transition-all duration-200 ${
                    isActive ? 'bg-white/[0.06] text-white border border-white/[0.08]' : 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.02] border border-transparent'
                  }`}
                >
                  <section.icon className={`h-3.5 w-3.5 ${isActive ? 'text-cyan-400' : 'text-slate-600'}`} />
                  {section.label}
                </button>
              );
            })}
          </div>

          {/* Footer */}
          <div className="p-3 border-t border-white/[0.03]">
            <Button
              onClick={handleSave}
              className="w-full h-8 bg-white text-slate-950 hover:bg-slate-200 text-[11px] font-medium rounded-lg transition-all gap-1.5"
            >
              {saved ? <><Check className="h-3.5 w-3.5" />Saved</> : <><Save className="h-3.5 w-3.5" />Save Changes</>}
            </Button>
            <Button
              variant="ghost"
              onClick={handleReset}
              className="w-full h-7 mt-1.5 text-[10px] text-slate-600 hover:text-slate-400 gap-1.5"
            >
              <RotateCcw className="h-3 w-3" />Reset Defaults
            </Button>
          </div>
        </aside>

        {/* Content */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 overflow-y-auto scrollbar-thin p-6">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeSection}
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -8 }}
                transition={{ duration: 0.2 }}
              >
                {renderSection()}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
