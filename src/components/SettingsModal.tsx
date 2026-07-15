import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, User, Palette, Brain, Sparkles,
  Bell, Shield, FlaskConical, Zap, Plus,
  Check, Save, RotateCcw, Download, Trash2,
  Globe, ChevronDown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import MemoryGraph from './MemoryGraph';
import { useApp } from '@/contexts/AppContext';
import type { AppSettings } from '@/contexts/AppContext';
import { useLanguageStore, LANGUAGES } from '@/stores/languageStore';
import type { LangMode } from '@/stores/languageStore';

interface SettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSettingsChange?: (partial: Record<string, unknown>) => void;
}

// `label` holds a central locale KEY (resolved with t() at render), so the
// Settings nav follows the runtime language (Phase 14C.3).
const SECTIONS = [
  { id: 'general', label: 'general', icon: User },
  { id: 'appearance', label: 'appearance', icon: Palette },
  { id: 'about', label: 'stTabAboutYou', icon: Sparkles },
  { id: 'memory', label: 'stTabMemory', icon: Brain },
  { id: 'notifications', label: 'notifications', icon: Bell },
  { id: 'privacy', label: 'privacy', icon: Shield },
  { id: 'experimental', label: 'stTabExperimental', icon: FlaskConical },
];

const ACCENT_COLORS = [
  { id: 'cyan', label: 'Cyan', class: 'from-[#60A5FA] to-[#3B82F6]', dot: 'bg-[#60A5FA]' },
  { id: 'emerald', label: 'Emerald', class: 'from-[#4ADE80] to-[#4ADE80]', dot: 'bg-[#4ADE80]' },
  { id: 'violet', label: 'Blue', class: 'from-[#60A5FA] to-[#3B82F6]', dot: 'bg-[#60A5FA]' },
  { id: 'amber', label: 'Amber', class: 'from-[#FACC15] to-[#FACC15]', dot: 'bg-[#FACC15]' },
  { id: 'rose', label: 'Rose', class: 'from-[#F87171] to-[#3B82F6]', dot: 'bg-[#F87171]' },
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
  const { settings: appSettings, updateSettings } = useApp();
  const { mode: langMode, setMode, t } = useLanguageStore();
  const [activeSection, setActiveSection] = useState('general');
  const [saved, setSaved] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
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

    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setSaved(false), 2000);
  }, [draft, appSettings, updateSettings, onSettingsChange]);

  const handleReset = useCallback(() => {
    setDraft(appSettings);
    setHasChanges(false);
    if (onSettingsChange) onSettingsChange({});
  }, [appSettings, onSettingsChange]);

  // ─── Sidebar / other local settings ───
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

  // ═══════════════════════════════════════════
  //  PREMIUM UI COMPONENTS
  // ═══════════════════════════════════════════

  const Segmented = ({ options, value, onChange }: { options: { value: string; label: string }[]; value: string; onChange: (v: string) => void }) => (
    <div className="inline-flex rounded-lg p-0.5" style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.04)' }}>
      {options.map((o) => (
        <button key={o.value} onClick={() => onChange(o.value)}
          className={`px-3 py-[5px] rounded-md text-[11px] font-medium transition-all duration-200 whitespace-nowrap ${value === o.value ? 'text-white' : 'text-[#94A3B8] hover:text-slate-300'}`}
          style={value === o.value ? { background: 'rgba(255,255,255,0.07)' } : { background: 'transparent' }}>
          {o.label}
        </button>
      ))}
    </div>
  );

  const SettingRow = ({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) => (
    <div className="flex items-center justify-between py-3.5 gap-6">
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-white/80">{label}</p>
        {description && <p className="text-[12px] text-[#94A3B8] mt-0.5">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );

  const SectionCard = ({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) => (
    <div className="mb-6">
      <div className="mb-4">
        <h3 className="text-[15px] font-semibold text-white/90 tracking-tight">{title}</h3>
        {subtitle && <p className="text-[12px] text-[#94A3B8] mt-0.5">{subtitle}</p>}
      </div>
      <div
        className="rounded-xl p-4"
        style={{
          background: 'rgba(255,255,255,0.015)',
          border: '1px solid rgba(255,255,255,0.04)',
        }}
      >
        {children}
      </div>
    </div>
  );

  const Divider = () => <div style={{ borderTop: '1px solid rgba(255,255,255,0.03)' }} className="my-1" />;

  // ═══════════════════════════════════════════
  //  TAB CONTENT
  // ═══════════════════════════════════════════

  // Auto (follows browser/device locale, and — for AI replies — the language
  // of the latest message) + every language we ship a complete dictionary for.
  const LANG_OPTIONS: { mode: LangMode; label: string; sub: string }[] = [
    { mode: 'auto', label: t('stAuto'), sub: t('stAutoSub') },
    ...LANGUAGES.map((l) => ({ mode: l.code as LangMode, label: l.label, sub: l.flag })),
  ];
  const currentLangOption = LANG_OPTIONS.find((o) => o.mode === langMode) || LANG_OPTIONS[0];

  const renderGeneral = () => (
    <SectionCard title={t('stLanguageRegion')} subtitle={t('stLanguageRegionSub')}>
      <SettingRow label={t('language')} description={t('stLanguageDesc')}>
        <div className="relative">
          <button
            onClick={() => setLangOpen(!langOpen)}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-[12px] text-white/80 hover:text-white transition-all min-w-[150px]"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
          >
            <Globe className="w-3.5 h-3.5 text-[#94A3B8]" />
            <span className="flex-1 text-left">{currentLangOption.label}</span>
            <ChevronDown className={`w-3 h-3 text-[#94A3B8] transition-transform ${langOpen ? 'rotate-180' : ''}`} />
          </button>
          <AnimatePresence>
            {langOpen && (
              <motion.div
                initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.15 }}
                className="absolute right-0 top-full mt-1.5 w-48 rounded-xl overflow-hidden z-50"
                style={{ background: 'linear-gradient(180deg, #151C28, #171C24)', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 16px 40px rgba(0,0,0,0.4)' }}
              >
                <div className="p-1.5 max-h-[240px] overflow-y-auto scrollbar-thin">
                  {LANG_OPTIONS.map((o) => (
                    <button key={String(o.mode)} onClick={() => { setMode(o.mode); setLangOpen(false); setHasChanges(true); updateDraft('language', (o.mode === 'tr' ? 'Turkish' : 'English') as 'English' | 'Turkish'); }}
                      className={`w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[12px] transition-all ${langMode === o.mode ? 'bg-white/[0.05] text-white' : 'text-[#94A3B8] hover:text-slate-300 hover:bg-white/[0.03]'}`}>
                      <Globe className="w-3.5 h-3.5 text-[#94A3B8] shrink-0" />
                      <span className="flex-1">{o.label}<span className="ml-1.5 text-[10px] text-[#64748B]">{o.sub}</span></span>
                      {langMode === o.mode && <Check className="h-3 w-3 text-[#3B82F6] shrink-0" />}
                    </button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </SettingRow>
      <Divider />
      <SettingRow label={t('stTimezone')} description={t('stTimezoneDesc')}>
        <select value={timezone} onChange={(e) => { setHasChanges(true); setTimezone(e.target.value); localStorage.setItem('korvix_timezone', e.target.value); }}
          className="w-44 rounded-lg px-3 py-2 text-[12px] text-white/80 outline-none cursor-pointer appearance-none transition-all"
          style={{
            background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
            backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center',
          }}>
          {TIMEZONES.map((tz) => <option key={tz.value} value={tz.value} className="bg-[#171C24]">{tz.label}</option>)}
        </select>
      </SettingRow>
    </SectionCard>
  );

  const renderAppearance = () => (
    <>
      <SectionCard title={t('theme')} subtitle={t('stThemeSub')}>
        <SettingRow label={t('theme')} description={t('stThemeDesc')}>
          <Segmented options={[{ value: 'dark', label: t('dark') }, { value: 'light', label: t('light') }, { value: 'system', label: t('stSystem') }]} value={draft.theme} onChange={(v) => updateDraft('theme', v as 'dark' | 'light' | 'system')} />
        </SettingRow>
        <Divider />
        <SettingRow label={t('stAccentColor')} description={t('stAccentDesc')}>
          <div className="flex gap-2">
            {ACCENT_COLORS.map((c) => (
              <button key={c.id} onClick={() => updateDraft('accentColor', c.id)} title={c.label}
                className={`flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br ${c.class} transition-all duration-200 ${draft.accentColor === c.id ? 'ring-2 ring-white/20 scale-110 shadow-lg' : 'opacity-40 hover:opacity-100'}`}>
                {draft.accentColor === c.id && <Check className="h-3.5 w-3.5 text-white drop-shadow-sm" />}
              </button>
            ))}
          </div>
        </SettingRow>
      </SectionCard>

      <SectionCard title={t('stInterface')} subtitle={t('stInterfaceSub')}>
        <SettingRow label={t('stDensity')} description={t('stDensityDesc')}>
          <Segmented options={[{ value: 'Compact', label: t('stCompact') }, { value: 'Comfortable', label: t('stComfortable') }, { value: 'Spacious', label: t('stSpacious') }]} value={draft.density} onChange={(v) => updateDraft('density', v)} />
        </SettingRow>
        <Divider />
        <SettingRow label={t('stAnimations')} description={t('stMotionLevel')}>
          <Segmented options={[{ value: 'Minimal', label: t('stMinimal') }, { value: 'Normal', label: t('stNormal') }, { value: 'Full', label: t('stFull') }]} value={draft.animationLevel} onChange={(v) => updateDraft('animationLevel', v)} />
        </SettingRow>
      </SectionCard>
    </>
  );

  /* ─── Memory profile state (local) ─── */
  const [memoryProfile, setMemoryProfile] = useState('');
  const [memoryTags, setMemoryTags] = useState<string[]>(['Startup Founder', 'Short Responses', 'Coding']);
  const [newTag, setNewTag] = useState('');
  const SUGGESTED_TAGS = ['Ecommerce', 'Trading', 'Student', 'AI Research', 'Turkish', 'Long-form Analysis', 'Design', 'Finance', 'Marketing', 'Engineering'];

  const addTag = (tag: string) => {
    if (tag && !memoryTags.includes(tag)) { setMemoryTags(p => [...p, tag]); setHasChanges(true); }
  };
  const removeTag = (tag: string) => { setMemoryTags(p => p.filter(t => t !== tag)); setHasChanges(true); };

  const renderAboutYou = () => (
    <>
      {/* Intro card */}
      <div className="mb-6">
        <h3 className="text-[15px] font-semibold text-white/90 tracking-tight">{t('stTabAboutYou')}</h3>
        <p className="text-[12px] text-[#94A3B8] mt-0.5">{t('stAboutYouSub')}</p>
      </div>

      {/* Memory textarea */}
      <div className="mb-6">
        <div
          className="rounded-xl p-4 transition-all"
          style={{
            background: 'rgba(255,255,255,0.015)',
            border: '1px solid rgba(255,255,255,0.04)',
          }}
        >
          <label className="text-[12px] font-medium text-white/60 mb-2 block">
            {t('stTellAbout')}
          </label>
          <textarea
            value={memoryProfile}
            onChange={(e) => { setMemoryProfile(e.target.value); setHasChanges(true); }}
            placeholder={t('stAboutPlaceholder')}
            rows={4}
            className="w-full bg-transparent text-[13px] text-white/80 placeholder:text-white/15 outline-none resize-none leading-relaxed"
          />
        </div>
        <p className="text-[10px] text-[#94A3B8] mt-1.5 ml-1">
          {t('stAboutHelp')}
        </p>
      </div>

      {/* Your tags */}
      {memoryTags.length > 0 && (
        <div className="mb-5">
          <label className="text-[12px] font-medium text-white/50 mb-2.5 block">{t('stWhatDescribes')}</label>
          <div className="flex flex-wrap gap-1.5">
            {memoryTags.map((tag) => (
              <motion.button
                key={tag}
                whileTap={{ scale: 0.95 }}
                onClick={() => removeTag(tag)}
                className="group flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] text-white/60 transition-all duration-200 hover:text-white/90"
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.06)',
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(201, 130, 130,0.2)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.06)'; }}
              >
                <span>{tag}</span>
                <X className="h-2.5 w-2.5 text-white/20 group-hover:text-[#F87171]/60 transition-colors" />
              </motion.button>
            ))}
          </div>
        </div>
      )}

      {/* Suggested tags */}
      <div className="mb-6">
        <label className="text-[12px] font-medium text-white/40 mb-2.5 block">{t('stSuggestions')}</label>
        <div className="flex flex-wrap gap-1.5">
          {SUGGESTED_TAGS.filter(t => !memoryTags.includes(t)).map((tag) => (
            <motion.button
              key={tag}
              whileTap={{ scale: 0.95 }}
              onClick={() => addTag(tag)}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] text-[#94A3B8] hover:text-slate-300 transition-all duration-200"
              style={{
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(255,255,255,0.04)',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)';
                (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.08)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.02)';
                (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.04)';
              }}
            >
              <Plus className="h-2.5 w-2.5" />
              <span>{tag}</span>
            </motion.button>
          ))}
        </div>
      </div>

      {/* Custom tag input */}
      <div className="flex items-center gap-2">
        <div
          className="flex-1 flex items-center gap-2 px-3 py-2 rounded-xl"
          style={{ background: 'rgba(255,255,255,0.015)', border: '1px solid rgba(255,255,255,0.04)' }}
        >
          <Plus className="h-3 w-3 text-white/15 shrink-0" />
          <input
            type="text"
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { addTag(newTag); setNewTag(''); } }}
            placeholder={t('stAddYourOwn')}
            className="flex-1 bg-transparent text-[12px] text-white/60 placeholder:text-white/15 outline-none"
          />
        </div>
        {newTag && (
          <motion.button
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => { addTag(newTag); setNewTag(''); }}
            className="px-3 py-2 rounded-lg text-[11px] font-medium text-[#3B82F6]/70 hover:text-[#60A5FA] transition-all"
            style={{ background: 'rgba(59, 130, 246,0.06)', border: '1px solid rgba(59, 130, 246,0.1)' }}
          >
            {t('stAdd')}
          </motion.button>
        )}
      </div>
    </>
  );

  const renderMemory = () => (
    <>
      <div className="mb-5">
        <h3 className="text-[15px] font-semibold text-white/90 tracking-tight">{t('stTabMemory')}</h3>
        <p className="text-[12px] text-[#94A3B8] mt-0.5">{t('stMemorySub')}</p>
      </div>

      {/* Enable Memory toggle */}
      <div
        className="flex items-center justify-between px-4 py-3.5 rounded-xl mb-5"
        style={{
          background: draft.memoryEnabled ? 'rgba(59, 130, 246,0.02)' : 'rgba(255,255,255,0.015)',
          border: `1px solid ${draft.memoryEnabled ? 'rgba(59, 130, 246,0.08)' : 'rgba(255,255,255,0.04)'}`,
        }}
      >
        <div className="flex items-center gap-3">
          <div
            className="flex h-8 w-8 items-center justify-center rounded-lg"
            style={{
              background: draft.memoryEnabled ? 'rgba(59, 130, 246,0.08)' : 'rgba(255,255,255,0.03)',
              border: `1px solid ${draft.memoryEnabled ? 'rgba(59, 130, 246,0.12)' : 'rgba(255,255,255,0.05)'}`,
              boxShadow: draft.memoryEnabled ? '0 0 8px rgba(59, 130, 246,0.06)' : 'none',
            }}
          >
            <Brain className="h-4 w-4" style={{ color: draft.memoryEnabled ? 'rgba(59, 130, 246,0.7)' : 'rgba(203, 213, 225,0.3)' }} />
          </div>
          <div>
            <p className="text-[13px] text-white/80 font-medium">{t('stEnableMemory')}</p>
            <p className="text-[11px] text-[#94A3B8] mt-0.5">{t('stEnableMemoryDesc')}</p>
          </div>
        </div>
        <Switch checked={draft.memoryEnabled} onCheckedChange={(c) => updateDraft('memoryEnabled', c)} />
      </div>

      {draft.memoryEnabled && (
        <div className="space-y-2">
          <p className="text-[10px] text-[#94A3B8] flex items-center gap-1.5">
            <Zap className="h-2.5 w-2.5 text-[#3B82F6]/40" />
            {t('stMemoryMapHint')}
          </p>
          <MemoryGraph />
        </div>
      )}

      {!draft.memoryEnabled && (
        <div className="flex items-center justify-center py-16">
          <div className="text-center">
            <Brain className="h-8 w-8 text-white/[0.06] mx-auto mb-2" />
            <p className="text-[12px] text-[#94A3B8]">{t('stMemoryDisabled')}</p>
          </div>
        </div>
      )}
    </>
  );

  const renderNotifications = () => (
    <>
      <SectionCard title={t('general')} subtitle={t('stNotifGeneralSub')}>
        <SettingRow label={t('stSoundEffects')} description={t('stSoundDesc')}><Switch checked={draft.soundEnabled} onCheckedChange={(c) => updateDraft('soundEnabled', c)} /></SettingRow>
        <Divider />
        <SettingRow label={t('stPushNotif')} description={t('stPushDesc')}><Switch checked={draft.pushNotifications} onCheckedChange={(c) => updateDraft('pushNotifications', c)} /></SettingRow>
      </SectionCard>

      <SectionCard title={t('stNotifWorkspace')} subtitle={t('stNotifWorkspaceSub')}>
        <SettingRow label={t('stAITaskUpdates')} description={t('stAITaskDesc')}><Switch checked={draft.notifAITasks} onCheckedChange={(c) => updateDraft('notifAITasks', c)} /></SettingRow>
        <Divider />
        <SettingRow label={t('stTradingSignals')} description={t('stTradingSignalsDesc')}><Switch checked={draft.notifTrading} onCheckedChange={(c) => updateDraft('notifTrading', c)} /></SettingRow>
        <Divider />
        <SettingRow label={t('stResearchComplete')} description={t('stResearchCompleteDesc')}><Switch checked={draft.notifResearch} onCheckedChange={(c) => updateDraft('notifResearch', c)} /></SettingRow>
        <Divider />
        <SettingRow label={t('stStartupAlerts')} description={t('stStartupAlertsDesc')}><Switch checked={draft.notifStartups} onCheckedChange={(c) => updateDraft('notifStartups', c)} /></SettingRow>
        <Divider />
        <SettingRow label={t('stAppUpdatesNotif')} description={t('stAppUpdatesDesc')}><Switch checked={draft.notifUpdates} onCheckedChange={(c) => updateDraft('notifUpdates', c)} /></SettingRow>
      </SectionCard>
    </>
  );

  const renderPrivacy = () => (
    <>
      <SectionCard title={t('stSecurity')} subtitle={t('stSecuritySub')}>
        <SettingRow label={t('stDataEncryption')} description={t('stDataEncryptionDesc')}>
          <span className="text-[12px] text-[#4ADE80]/70 flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-[#4ADE80]" style={{ boxShadow: '0 0 4px rgba(134, 168, 139,0.4)' }} />
            {t('stActive')}
          </span>
        </SettingRow>
      </SectionCard>

      <SectionCard title={t('stDataSection')} subtitle={t('stDataSectionSub')}>
        <SettingRow label={t('stExportData')} description={t('stExportDataDesc')}>
          <Button variant="ghost" size="sm" className="h-8 text-[12px] text-[#CBD5E1] hover:text-white gap-2" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
            <Download className="h-3.5 w-3.5" /> {t('export')}
          </Button>
        </SettingRow>
        <Divider />
        <SettingRow label={t('stDeleteAccount')} description={t('stDeleteAccountDesc')}>
          <Button variant="ghost" size="sm" className="h-8 text-[12px] text-[#F87171]/60 hover:text-[#F87171] hover:bg-[#F87171]/[0.06] gap-2" style={{ border: '1px solid rgba(201, 130, 130,0.08)' }}>
            <Trash2 className="h-3.5 w-3.5" /> {t('delete')}
          </Button>
        </SettingRow>
      </SectionCard>
    </>
  );

  const renderExperimental = () => (
    <>
      <SectionCard title={t('stFeatures')} subtitle={t('stFeaturesSub')}>
        {[
          { id: 'chain-of-thought', name: 'Chain of Thought', desc: 'Visible reasoning steps' },
          { id: 'multi-agent', name: 'Multi-Agent', desc: 'Multiple agents working together' },
          { id: 'memory-graph', name: 'Memory Graph', desc: 'Interactive memory visualization' },
          { id: 'real-time-data', name: 'Real-time Data', desc: 'Live data feeds' },
          { id: 'voice-mode', name: 'Voice Mode', desc: 'Speak with AI' },
          { id: 'vision-analysis', name: 'Vision Analysis', desc: 'Image understanding' },
          { id: 'code-execution', name: 'Code Execution', desc: 'Sandbox execution' },
          { id: 'plugin-system', name: 'Plugin System', desc: 'Custom extensions' },
        ].map((f, i, arr) => (
          <div key={f.id}>
            <SettingRow label={f.name} description={f.desc}>
              <Switch checked={experimental[f.id] ?? false} onCheckedChange={() => toggleExperimental(f.id)} />
            </SettingRow>
            {i < arr.length - 1 && <Divider />}
          </div>
        ))}
      </SectionCard>
    </>
  );

  const TAB_CONTENT: Record<string, React.ReactNode> = {
    general: renderGeneral(),
    appearance: renderAppearance(),
    about: renderAboutYou(),
    memory: renderMemory(),
    notifications: renderNotifications(),
    privacy: renderPrivacy(),
    experimental: renderExperimental(),
  };

  if (!open) return null;

  // ═══════════════════════════════════════════
  //  MAIN LAYOUT
  // ═══════════════════════════════════════════

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[90] flex items-center justify-center p-4 sm:p-6" style={{ background: 'rgba(8,12,22,0.7)', backdropFilter: 'blur(20px)' }} onClick={() => onOpenChange(false)}>
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 8 }}
        transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] as const }}
        className="w-full max-w-3xl h-[560px] sm:h-[600px] md:h-[640px] flex flex-col rounded-2xl overflow-hidden"
        style={{
          background: 'linear-gradient(180deg, rgba(30,38,52,0.98) 0%, rgba(20,25,36,0.98) 100%)',
          border: '1px solid rgba(255,255,255,0.06)',
          boxShadow: '0 32px 80px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.03)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ═── Header ─══ */}
        <div className="flex items-center justify-between px-6 py-4 shrink-0" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
          <div>
            <h2 className="text-[16px] font-semibold text-white tracking-tight">{t('settings')}</h2>
            <p className="text-[11px] text-[#94A3B8] mt-0.5">{t('stManagePrefs')}</p>
          </div>
          <button onClick={() => onOpenChange(false)} className="h-8 w-8 flex items-center justify-center rounded-lg text-[#94A3B8] hover:text-white hover:bg-white/[0.05] transition-all">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ═── Body ─══ */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* ── Sidebar ── */}
          <div className="w-48 sm:w-52 shrink-0 overflow-y-auto scrollbar-thin py-3 px-2" style={{ borderRight: '1px solid rgba(255,255,255,0.04)' }}>
            {SECTIONS.map((s) => {
              const isActive = activeSection === s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => setActiveSection(s.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all duration-200 mb-0.5 ${
                    isActive ? 'text-white' : 'text-[#94A3B8] hover:text-slate-300'
                  }`}
                  style={{
                    background: isActive ? 'rgba(255,255,255,0.05)' : 'transparent',
                    border: isActive ? '1px solid rgba(255,255,255,0.06)' : '1px solid transparent',
                  }}
                >
                  <div
                    className="flex h-7 w-7 items-center justify-center rounded-md shrink-0"
                    style={{
                      background: isActive ? 'rgba(59, 130, 246,0.08)' : 'rgba(255,255,255,0.02)',
                      border: `1px solid ${isActive ? 'rgba(59, 130, 246,0.12)' : 'rgba(255,255,255,0.04)'}`,
                    }}
                  >
                    <s.icon className="h-3.5 w-3.5" style={{ color: isActive ? 'rgba(59, 130, 246,0.7)' : 'rgba(203, 213, 225,0.35)' }} />
                  </div>
                  <span className={`text-[13px] ${isActive ? 'font-medium' : ''}`}>{t(s.label)}</span>
                  {isActive && <div className="ml-auto w-1 h-1 rounded-full bg-[#3B82F6]/50 shrink-0" style={{ boxShadow: '0 0 4px rgba(59, 130, 246,0.3)' }} />}
                </button>
              );
            })}
          </div>

          {/* ── Content ── */}
          <div className="flex-1 min-w-0 overflow-y-auto scrollbar-thin">
            <AnimatePresence initial={false} mode="wait">
              <motion.div
                key={activeSection}
                initial={{ opacity: 0, x: 6 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -6 }}
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                className="p-6"
              >
                {TAB_CONTENT[activeSection]}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        {/* ═── Footer ─══ */}
        <div className="flex items-center justify-between px-6 py-3.5 shrink-0" style={{ borderTop: '1px solid rgba(255,255,255,0.04)', background: 'rgba(255,255,255,0.01)' }}>
          <button onClick={handleReset} className="flex items-center gap-2 text-[12px] text-[#94A3B8] hover:text-slate-300 transition-colors">
            <RotateCcw className="h-3 w-3" /> {t('stReset')}
          </button>
          <div className="flex items-center gap-3">
            {saved && (
              <motion.span initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 8 }} className="text-[12px] text-[#4ADE80]/70 flex items-center gap-1.5">
                <Check className="h-3.5 w-3.5" /> {t('saved')}
              </motion.span>
            )}
            <Button onClick={handleSave} disabled={!hasChanges}
              className="h-8 px-5 text-[12px] font-medium transition-all disabled:opacity-30"
              style={{
                background: hasChanges ? 'linear-gradient(135deg, rgba(59, 130, 246,0.8), rgba(156, 187, 209,0.8))' : 'rgba(255,255,255,0.05)',
                color: 'white',
                border: 'none',
                boxShadow: hasChanges ? '0 4px 16px rgba(59, 130, 246,0.15)' : 'none',
              }}>
              <Save className="h-3.5 w-3.5 mr-1.5" /> {t('stSaveChanges')}
            </Button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
