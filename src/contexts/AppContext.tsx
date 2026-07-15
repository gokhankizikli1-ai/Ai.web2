import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { AIMode, WorkspaceTab } from '@/types';
import { useLanguageStore } from '@/stores/languageStore';
import { translate } from '@/i18n';

// ─── Types ───
export interface AppSettings {
  language: 'English' | 'Turkish';
  theme: 'dark' | 'light' | 'system';
  accentColor: string;
  defaultWorkspace: WorkspaceTab;
  defaultMode: AIMode;
  density: string;
  animationLevel: string;
  responseStyle: string;
  reasoningDepth: string;
  creativity: number;
  memoryEnabled: boolean;
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
  experimental: Record<string, boolean>;
  // AI Behavior (new)
  tone: 'Natural' | 'Professional' | 'Friendly' | 'Concise';
  responseLength: 'Short' | 'Balanced' | 'Detailed';
  emojiUsage: 'Off' | 'Low' | 'Normal';
  aiLanguageBehavior: 'Auto-detect' | 'Turkish' | 'English';
  // Credits (new)
  creditsRemaining: number;
  creditsTotal: number;
  plan: 'free' | 'basic' | 'pro' | 'ultra' | 'enterprise';
}

export interface AppContextValue {
  settings: AppSettings;
  updateSettings: (partial: Partial<AppSettings>) => void;
  resetSettings: () => void;
  resolvedTheme: 'dark' | 'light';
  t: (key: string) => string;
}

const STORAGE_KEY = 'korvixai_settings_v2';

const DEFAULTS: AppSettings = {
  language: 'English',
  theme: 'dark',
  accentColor: 'cyan',
  defaultWorkspace: 'chat',
  defaultMode: 'fast',
  density: 'Comfortable',
  animationLevel: 'Normal',
  responseStyle: 'Balanced',
  reasoningDepth: 'Normal',
  creativity: 70,
  memoryEnabled: true,
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
  experimental: {},
  // AI Behavior defaults
  tone: 'Natural',
  responseLength: 'Balanced',
  emojiUsage: 'Low',
  aiLanguageBehavior: 'Auto-detect',
  // Credits defaults (match Pro plan: 300/mo)
  creditsRemaining: 153,
  creditsTotal: 300,
  plan: 'pro',
};

function load(): AppSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return { ...DEFAULTS, ...JSON.parse(stored) };
  } catch { /* ignore */ }
  return { ...DEFAULTS };
}

function save(s: AppSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

// ─── Label Dictionary ───
const LABELS: Record<string, Record<string, string>> = {
  English: {
    newChat: 'New Chat',
    searchConversations: 'Search conversations...',
    settings: 'Settings',
    saveChanges: 'Save Changes',
    saved: 'Saved',
    resetDefaults: 'Reset Defaults',
    upgrade: 'Upgrade to Pro',
    freePlan: 'Free Plan',
    tradingSignals: 'Trading Signals',
    liveDataUnavailable: 'Live data unavailable',
    retryConnection: 'Retry Connection',
    exit: 'Exit',
    recent: 'Recent',
    results: 'Results',
    noConversations: 'No conversations yet',
    noResults: 'No results found',
    chat: 'Chat',
    research: 'Research',
    trading: 'Trading',
    business: 'Business',
    agents: 'Agents',
    coding: 'Coding',
    startup: 'Startup',
    study: 'Study',
    creative: 'Creative',
    more: 'More',
    commandPalette: 'Command Palette',
    prompts: 'Prompts',
    export: 'Export',
    whatBuild: 'What do you want to build today?',
    trustLine: 'Your data is encrypted and never used for training',
    all: 'All',
  },
  Turkish: {
    newChat: 'Yeni Sohbet',
    searchConversations: 'Sohbetleri ara...',
    settings: 'Ayarlar',
    saveChanges: 'Değişiklikleri Kaydet',
    saved: 'Kaydedildi',
    resetDefaults: 'Varsayılana Sıfırla',
    upgrade: 'Pro\'ya Yükselt',
    freePlan: 'Ücretsiz Plan',
    tradingSignals: 'Ticaret Sinyalleri',
    liveDataUnavailable: 'Canlı veri mevcut değil',
    retryConnection: 'Bağlantıyı Yeniden Dene',
    exit: 'Çıkış',
    recent: 'Son',
    results: 'Sonuçlar',
    noConversations: 'Henüz sohbet yok',
    noResults: 'Sonuç bulunamadı',
    chat: 'Sohbet',
    research: 'Araştırma',
    trading: 'Ticaret',
    business: 'İş',
    agents: 'Ajanlar',
    coding: 'Kodlama',
    startup: 'Girişim',
    study: 'Çalışma',
    creative: 'Yaratıcı',
    more: 'Daha Fazla',
    commandPalette: 'Komut Paleti',
    prompts: 'Promptlar',
    export: 'Dışa Aktar',
    whatBuild: 'Bugün ne inşa etmek istersin?',
    trustLine: 'Verileriniz şifrelenir ve eğitim için kullanılmaz',
    all: 'Tümü',
  },
};

// ─── Context ───
const AppContext = createContext<AppContextValue | null>(null);

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be inside AppProvider');
  return ctx;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(load);

  // Resolve theme (system → actual)
  const resolvedTheme: 'dark' | 'light' = (() => {
    if (settings.theme === 'system') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return settings.theme;
  })();

  // Apply theme to document
  useEffect(() => {
    const root = document.documentElement;
    if (resolvedTheme === 'dark') {
      root.classList.add('dark');
      root.classList.remove('light');
    } else {
      root.classList.add('light');
      root.classList.remove('dark');
    }
  }, [resolvedTheme]);

  // Listen for system theme changes
  useEffect(() => {
    if (settings.theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      setSettings((prev) => ({ ...prev })); // force re-render
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [settings.theme]);

  const updateSettings = useCallback((partial: Partial<AppSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...partial };
      save(next);
      return next;
    });
  }, []);

  const resetSettings = useCallback(() => {
    setSettings({ ...DEFAULTS });
    save(DEFAULTS);
  }, []);

  // Phase 14H — ONE runtime language authority. `t` now resolves through the
  // central i18n layer (en/tr/de), so components using `useApp().t` update on a
  // language change exactly like `useLanguageStore().t` — no more German→English
  // fallback via the local en/tr LABELS. The LABELS table is kept ONLY as a
  // last-resort fallback for any legacy key not yet migrated into the central
  // dictionaries (those stay en/tr, but every launch-critical key lives centrally).
  const lang = useLanguageStore((s) => s.lang);
  const t = useCallback(
    (key: string) => {
      const central = translate(lang, key);
      if (central !== key) return central;          // central dict had it (en/tr/de)
      const legacy = settings.language === 'Turkish' ? 'Turkish' : 'English';
      return LABELS[legacy]?.[key] || LABELS.English[key] || key;
    },
    [lang, settings.language],
  );

  return (
    <AppContext.Provider value={{ settings, updateSettings, resetSettings, resolvedTheme, t }}>
      {children}
    </AppContext.Provider>
  );
}
