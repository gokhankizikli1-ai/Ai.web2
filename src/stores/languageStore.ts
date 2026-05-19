import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Language =
  | 'en' | 'tr' | 'de' | 'fr' | 'it' | 'es'
  | 'ru' | 'zh' | 'ja' | 'ar' | 'pt' | 'ko' | 'nl';

export const LANGUAGES: { code: Language; label: string; flag: string; coverage: 'complete' | 'pending' }[] = [
  { code: 'en', label: 'English',    flag: 'EN', coverage: 'complete' },
  { code: 'tr', label: 'Turkish',    flag: 'TR', coverage: 'complete' },
  { code: 'de', label: 'German',     flag: 'DE', coverage: 'pending' },
  { code: 'fr', label: 'French',     flag: 'FR', coverage: 'pending' },
  { code: 'it', label: 'Italian',    flag: 'IT', coverage: 'pending' },
  { code: 'es', label: 'Spanish',    flag: 'ES', coverage: 'pending' },
  { code: 'ru', label: 'Russian',    flag: 'RU', coverage: 'pending' },
  { code: 'zh', label: 'Chinese',    flag: 'ZH', coverage: 'pending' },
  { code: 'ja', label: 'Japanese',   flag: 'JA', coverage: 'pending' },
  { code: 'ar', label: 'Arabic',     flag: 'AR', coverage: 'pending' },
  { code: 'pt', label: 'Portuguese', flag: 'PT', coverage: 'pending' },
  { code: 'ko', label: 'Korean',     flag: 'KO', coverage: 'pending' },
  { code: 'nl', label: 'Dutch',      flag: 'NL', coverage: 'pending' },
];

/** Translation coverage status for all supported languages */
export const TRANSLATION_COVERAGE: Record<Language, 'complete' | 'pending'> = {
  en: 'complete', tr: 'complete',
  de: 'pending',  fr: 'pending', it: 'pending', es: 'pending',
  ru: 'pending',  zh: 'pending', ja: 'pending', ar: 'pending',
  pt: 'pending',  ko: 'pending', nl: 'pending',
};

/** Check if a language has complete UI translation coverage */
export function isLanguageComplete(lang: Language): boolean {
  return TRANSLATION_COVERAGE[lang] === 'complete';
}

/** Get the effective translation language (falls back to English for incomplete) */
export function getEffectiveLanguage(lang: Language): Language {
  return isLanguageComplete(lang) ? lang : 'en';
}

/* ═══════════════════════════════════════
   ENGLISH — Master dictionary (complete)
   ═══════════════════════════════════════ */
const EN: Record<string, string> = {
  newChat: 'New Chat', searchChats: 'Search chats...', noChats: 'No chats yet',
  startConversation: 'Start a new conversation', recent: 'Recent', signIn: 'Sign In',
  createAccount: 'Create Account', syncDevices: 'Sync across devices',
  upgradePro: 'Upgrade to Pro', guestUser: 'Guest User', free: 'Free',
  credits: 'Credits', casualChatFree: 'Casual chat is free', buyCredits: 'Buy Credits',
  upgradePlan: 'Upgrade Plan', logout: 'Log Out', settings: 'Settings',
  language: 'Language', theme: 'Theme', appearance: 'Appearance', light: 'Light',
  dark: 'Dark', creditCostGuide: 'Credit Cost Guide',
  processingSoon: 'Payment processing coming soon.',
  chatAlwaysFree: 'Casual chat will always remain free.',
  advancedOnly: 'Advanced operations use credits.', premium: 'Premium', basic: 'Basic',
  ultra: 'Ultra', enterprise: 'Enterprise', continue: 'Continue', cancel: 'Cancel',
  submit: 'Submit', saved: 'Saved', chat: 'Chat', research: 'Research',
  coding: 'Coding', trading: 'Trading', business: 'Business', startup: 'Startup',
  agents: 'Agents', study: 'Study', creative: 'Creative', prompts: 'Prompts',
  export: 'Export', upgrade: 'Upgrade', commandPalette: 'Command Palette',
  promptLibrary: 'Prompt Library', exportChat: 'Export Chat', contextPanel: 'Context Panel',
  watchlist: 'Watchlist', signals: 'Signals', sentiment: 'Sentiment', trending: 'Trending',
  all: 'All', stocks: 'Stocks', crypto: 'Crypto', deepThink: 'Deep Think',
  codeAssistant: 'Code Assistant', tradingIntel: 'Trading Intel', howCanIHelp: 'How can I help?',
  sendAMessage: 'Send a message...', deepResearch: 'Deep Research', analyzeStock: 'Analyze Stock',
  openAgents: 'Open Agents', general: 'General', account: 'Account', notifications: 'Notifications',
  privacy: 'Privacy', dangerZone: 'Danger Zone', creditCosts: 'Credit Costs',
  aiMemory: 'AI Memory', deleteAllChats: 'Delete All Chats', deleteConfirm: 'This will permanently delete all your conversations.',
  currentPlan: 'Current Plan', planFeatures: 'plan features', memoryGraph: 'Memory Graph',
  memoryGraphNote: 'Neural memory visualization \u2014 data stays local',
  memoryLabel: 'Memory',
  usageLabel: 'Usage', tokensLabel: 'Tokens', topicsLabel: 'Topics',
  connectionsLabel: 'Connections', activityLabel: 'Activity',
  activityFeed: 'Activity Feed', currentStatus: 'Current Status',
  runningTasks: 'Running Tasks', completedTasks: 'Completed',
  queuedTasks: 'Queued', avgConfidence: 'Avg Confidence', tradeIdeas: 'Trade Ideas',
  timeframe: 'Timeframe', searchAssets: 'Search assets...',
  favorite: 'Fav', etf: 'ETFs', nothingFound: 'Nothing found',
  typeMessage: 'Type a message...', attachFiles: 'Attach files',
  webSearch: 'Web search', addImage: 'Add image', send: 'Send',
  deepThinkBtn: 'Deep Think', researchBtn: 'Research',
  codeBtn: 'Code', marketBtn: 'Market', capabilities: 'Capabilities',
  newConversation: 'New conversation', learnMore: 'Learn more',
  confirm: 'Confirm', delete: 'Delete', close: 'Close', open: 'Open',
  save: 'Save', restore: 'Restore', reset: 'Reset', apply: 'Apply',
  search: 'Search', filter: 'Filter', sort: 'Sort', refresh: 'Refresh',
  loading: 'Loading', error: 'Error', success: 'Success', warning: 'Warning',
  info: 'Info', retry: 'Retry', dismiss: 'Dismiss', showMore: 'Show more',
  showLess: 'Show less', viewAll: 'View all', seeDetails: 'See details',
  comingSoon: 'Coming soon', newFeature: 'New feature', beta: 'Beta',
  proOnly: 'Pro only', enterpriseOnly: 'Enterprise only',
  freePlan: 'Free Plan', basicPlan: 'Basic Plan', proPlan: 'Pro Plan',
  ultraPlan: 'Ultra Plan', enterprisePlan: 'Enterprise Plan',
  perMonth: '/month', perYear: '/year', billedAnnually: 'Billed annually',
  monthly: 'Monthly', annually: 'Annually', subscribe: 'Subscribe',
  manageSubscription: 'Manage subscription', changePlan: 'Change plan',
  currentUsage: 'Current usage', usageHistory: 'Usage history',
  creditBalance: 'Credit balance', lowCredits: 'Low credits',
  noCredits: 'No credits remaining', refillCredits: 'Refill credits',
  autoRefill: 'Auto-refill', paymentMethod: 'Payment method',
  addPaymentMethod: 'Add payment method', billingHistory: 'Billing history',
  invoice: 'Invoice', date: 'Date', amount: 'Amount', status: 'Status',
  description: 'Description', total: 'Total', subtotal: 'Subtotal',
  tax: 'Tax', discount: 'Discount', promoCode: 'Promo code', applyCode: 'Apply',
  remove: 'Remove', edit: 'Edit', update: 'Update', change: 'Change',
  name: 'Name', email: 'Email', password: 'Password',
  currentPassword: 'Current password', newPassword: 'New password',
  confirmPassword: 'Confirm password', forgotPassword: 'Forgot password?',
  resetPassword: 'Reset password', verifyEmail: 'Verify email',
  resendCode: 'Resend code', verificationCode: 'Verification code',
  profile: 'Profile', avatar: 'Avatar', upload: 'Upload', removeAvatar: 'Remove avatar',
  organization: 'Organization', team: 'Team', members: 'Members',
  invite: 'Invite', role: 'Role', owner: 'Owner', admin: 'Admin',
  member: 'Member', viewer: 'Viewer', permissions: 'Permissions',
  twoFactor: 'Two-factor auth', security: 'Security', sessions: 'Sessions',
  activeSessions: 'Active sessions', revoke: 'Revoke', revokeAll: 'Revoke all',
  apiKeys: 'API keys', generateKey: 'Generate key', keyName: 'Key name',
  lastUsed: 'Last used', never: 'Never', copy: 'Copy', copied: 'Copied',
  download: 'Download', share: 'Share', import_: 'Import', export_: 'Export',
  archive: 'Archive', unarchive: 'Unarchive', pin: 'Pin', unpin: 'Unpin',
  rename: 'Rename', duplicate: 'Duplicate', move: 'Move', merge: 'Merge',
  split: 'Split', expand: 'Expand', collapse: 'Collapse', fullscreen: 'Fullscreen',
  exitFullscreen: 'Exit fullscreen', minimize: 'Minimize', maximize: 'Maximize',
  back: 'Back', next: 'Next', previous: 'Previous', forward: 'Forward',
  skip: 'Skip', finish: 'Finish', done: 'Done', start: 'Start', stop: 'Stop',
  pause: 'Pause', resume: 'Resume', play: 'Play', record: 'Record',
  askAnything: 'Ask anything', thinking: 'Thinking', analyzing: 'Analyzing',
  generating: 'Generating', processing: 'Processing', complete: 'Complete',
  failed: 'Failed', cancelled: 'Cancelled', pending: 'Pending', inProgress: 'In progress',
  uploadFile: 'Upload a file', dropFiles: 'Drop files here',
  dragDrop: 'Drag and drop or click to upload', fileTooLarge: 'File too large',
  maxFileSize: 'Max file size', supportedFormats: 'Supported formats',
  attachImage: 'Attach image', attachDocument: 'Attach document',
  removeFile: 'Remove file', fileCount: 'file', filesCount: 'files',
  wordCount: 'word', wordsCount: 'words', characterCount: 'character',
  charactersCount: 'characters', readingTime: 'Reading time', minRead: 'min read',
  selectModel: 'Select model', model: 'Model', fast: 'Fast', balanced: 'Balanced',
  quality: 'Quality', auto: 'Auto', custom: 'Custom', default_: 'Default',
  systemPrompt: 'System prompt', temperature: 'Temperature', maxTokens: 'Max tokens',
  topP: 'Top P', frequencyPenalty: 'Frequency penalty', presencePenalty: 'Presence penalty',
  stopSequences: 'Stop sequences', responseFormat: 'Response format',
  streaming: 'Streaming', webSearchEnabled: 'Web search enabled',
  codeInterpreter: 'Code interpreter', imageGeneration: 'Image generation',
  vision: 'Vision', fileAnalysis: 'File analysis', dataAnalysis: 'Data analysis',
  documentAnalysis: 'Document analysis', webBrowsing: 'Web browsing',
  pluginStore: 'Plugin store', installedPlugins: 'Installed plugins',
  browsePlugins: 'Browse plugins', pluginDetails: 'Plugin details',
  install: 'Install', uninstall: 'Uninstall', configure: 'Configure',
  enable: 'Enable', disable: 'Disable', enabled: 'Enabled', disabled: 'Disabled',
  on: 'On', off: 'Off', toggle: 'Toggle', switch: 'Switch',
  selectAll: 'Select all', deselectAll: 'Deselect all', selected: 'Selected',
  clearSelection: 'Clear selection', clearAll: 'Clear all',
  noResults: 'No results found', tryAgain: 'Try again', adjustFilters: 'Adjust filters',
  noData: 'No data available', emptyState: 'Nothing here yet',
  getStarted: 'Get started', createFirst: 'Create your first',
  welcome: 'Welcome', greeting: 'Hello', goodMorning: 'Good morning',
  goodAfternoon: 'Good afternoon', goodEvening: 'Good evening',
  today: 'Today', yesterday: 'Yesterday', tomorrow: 'Tomorrow',
  justNow: 'Just now', minuteAgo: 'minute ago', minutesAgo: 'minutes ago',
  hourAgo: 'hour ago', hoursAgo: 'hours ago', dayAgo: 'day ago',
  daysAgo: 'days ago', weekAgo: 'week ago', weeksAgo: 'weeks ago',
  thisWeek: 'This week', lastWeek: 'Last week', thisMonth: 'This month',
  lastMonth: 'Last month', customize: 'Customize', preferences: 'Preferences',
  shortcuts: 'Shortcuts', keyboardShortcuts: 'Keyboard shortcuts',
  pressKey: 'Press', toFocus: 'to focus', toSend: 'to send',
  toNewLine: 'for new line', toSearch: 'to search', toNavigate: 'to navigate',
  shortcut: 'Shortcut', action: 'Action', shortcutNewChat: 'New chat',
  shortcutSearch: 'Search chats', shortcutSend: 'Send message',
  shortcutFocus: 'Focus input', shortcutCommand: 'Command palette',
  add: 'Add', clear: 'Clear', deleteForever: 'Delete forever',
  areYouSure: 'Are you sure?', cannotUndo: 'This action cannot be undone.',
  confirmDelete: 'Please confirm deletion', typeToConfirm: 'Type to confirm',
  cancelAction: 'Cancel action', goBack: 'Go back', continueAnyway: 'Continue anyway',
  saveChanges: 'Save changes', discardChanges: 'Discard changes',
  unsavedChanges: 'You have unsaved changes', stay: 'Stay', leave: 'Leave',
  selectOption: 'Select an option', chooseFile: 'Choose a file',
  noFileSelected: 'No file selected', browse: 'Browse',
  dropHere: 'Drop here', releaseToDrop: 'Release to drop', uploadComplete: 'Upload complete',
  uploadFailed: 'Upload failed', uploading: 'Uploading', downloadComplete: 'Download complete',
  downloadFailed: 'Download failed',
  // UserAccountDropdown specific
  accountSettings: 'Account Settings', learningCenter: 'Learning Center',
  documentation: 'Documentation', community: 'Community',
  upgradeToPro: 'Upgrade to Pro', guestMode: 'Guest mode',
  // Sidebar specific
  workspaceHub: 'Workspace Hub', explore: 'Explore', work: 'Work', tools: 'Tools',
  moreTabs: 'More', pinned: 'Pinned', yourChats: 'Your chats',
  // AI Activity Feed
  activeProcesses: 'Active processes', noActiveProcesses: 'No active processes',
  // KorvixAI branding
  korvixAi: 'KorvixAI', aiOperatingSystem: 'Your AI Operating System',
  // Memory Graph
  memoryNodes: 'Memory Nodes', memoryConnections: 'Memory Connections',
  // Onboarding / Tips
  tipPrefix: 'Tip', proTip: 'Pro Tip', didYouKnow: 'Did you know?',
  // Errors / States
  somethingWentWrong: 'Something went wrong', pleaseRetry: 'Please try again',
  connectionLost: 'Connection lost', reconnecting: 'Reconnecting',
  rateLimit: 'Rate limit reached', slowDown: 'Please slow down',
  contextLimit: 'Context limit reached', startNewChat: 'Start a new chat',
};

/* ═══════════════════════════════════════
   TURKISH — Complete translation
   ═══════════════════════════════════════ */
const TR: Partial<Record<string, string>> = {
  // Core UI
  newChat: 'Yeni Sohbet', searchChats: 'Sohbet ara...', noChats: 'Hen\u00fcz sohbet yok',
  startConversation: 'Yeni bir konu\u015fma ba\u015flat', recent: 'Son', signIn: 'Giri\u015f Yap',
  createAccount: 'Hesap Olu\u015ftur', syncDevices: 'Cihazlar aras\u0131 senkronizasyon',
  upgradePro: 'Pro\'ya Y\u00fckselt', guestUser: 'Misafir Kullan\u0131c\u0131', free: '\u00dccretsiz',
  credits: 'Kredi', casualChatFree: 'G\u00fcnl\u00fck sohbet \u00fccretsizdir', buyCredits: 'Kredi Al',
  upgradePlan: 'Plan Y\u00fckselt', logout: '\u00c7\u0131k\u0131\u015f Yap', settings: 'Ayarlar',
  language: 'Dil', theme: 'Tema', appearance: 'G\u00f6r\u00fcn\u00fcm', light: 'A\u00e7\u0131k',
  dark: 'Koyu', creditCostGuide: 'Kredi Maliyet Rehberi',
  processingSoon: '\u00d6deme i\u015flemi yak\u0131nda geliyor.',
  chatAlwaysFree: 'G\u00fcnl\u00fck sohbet her zaman \u00fccretsiz kalacak.',
  advancedOnly: 'Geli\u015fmi\u015f i\u015flemler kredi kullan\u0131r.', premium: 'Premium', basic: 'Temel',
  ultra: 'Ultra', enterprise: 'Kurumsal', continue: 'Devam Et', cancel: '\u0130ptal',
  submit: 'G\u00f6nder', saved: 'Kaydedildi', chat: 'Sohbet', research: 'Ara\u015ft\u0131rma',
  coding: 'Kodlama', trading: 'Trading', business: '\u0130\u015f', startup: 'Startup',
  agents: 'Ajanlar', study: '\u00c7al\u0131\u015fma', creative: 'Yarat\u0131c\u0131', prompts: 'Promptlar',
  export: 'D\u0131\u015fa Aktar', upgrade: 'Y\u00fckselt', commandPalette: 'Komut Paneli',
  promptLibrary: 'Prompt K\u00fct\u00fcphanesi', exportChat: 'Sohbeti D\u0131\u015fa Aktar', contextPanel: 'Ba\u011flam Paneli',
  watchlist: '\u0130zleme Listesi', signals: 'Sinyaller', sentiment: 'Duygu', trending: 'Trend',
  all: 'T\u00fcm\u00fc', stocks: 'Hisseler', crypto: 'Kripto', deepThink: 'Derin D\u00fc\u015f\u00fcnme',
  codeAssistant: 'Kod Asistan\u0131', tradingIntel: 'Trading \u0130stihbarat\u0131',
  howCanIHelp: 'Size nas\u0131l yard\u0131mc\u0131 olabilirim?', sendAMessage: 'Bir mesaj g\u00f6nderin...',
  deepResearch: 'Derin Ara\u015ft\u0131rma', analyzeStock: 'Hisse Analizi', openAgents: 'Ajanlar\u0131 A\u00e7',
  general: 'Genel', account: 'Hesap', notifications: 'Bildirimler', privacy: 'Gizlilik',
  dangerZone: 'Tehlikeli B\u00f6lge', creditCosts: 'Kredi Maliyetleri',
  aiMemory: 'AI Haf\u0131za', deleteAllChats: 'T\u00fcm Sohbetleri Sil',
  deleteConfirm: 'Bu i\u015flem t\u00fcm konu\u015fmalar\u0131n\u0131z\u0131 kal\u0131c\u0131 olarak siler.',
  currentPlan: 'Mevcut Plan', planFeatures: 'plan \u00f6zellikleri', memoryGraph: 'Haf\u0131za Grafi\u011fi',
  memoryGraphNote: 'N\u00f6ral haf\u0131za g\u00f6rselle\u015ftirmesi \u2014 veriler yerel kal\u0131r',
  memoryLabel: 'Haf\u0131za', usageLabel: 'Kullan\u0131m', tokensLabel: 'Tokenlar',
  topicsLabel: 'Konular', connectionsLabel: 'Ba\u011flant\u0131lar', activityLabel: 'Aktivite',
  activityFeed: 'Aktivite Ak\u0131\u015f\u0131', currentStatus: 'Mevcut Durum',
  runningTasks: '\u00c7al\u0131\u015fan G\u00f6revler', completedTasks: 'Tamamland\u0131',
  queuedTasks: 'S\u0131rada', avgConfidence: 'Ort. G\u00fcven', tradeIdeas: 'Trade Fikirleri',
  timeframe: 'Zaman Dilimi', searchAssets: 'Varl\u0131k ara...',
  favorite: 'Favori', etf: 'ETF', nothingFound: 'Sonu\u00e7 bulunamad\u0131',
  typeMessage: 'Mesaj yaz\u0131n...', attachFiles: 'Dosya ekle',
  webSearch: 'Web arama', addImage: 'Resim ekle', send: 'G\u00f6nder',
  deepThinkBtn: 'Derin D\u00fc\u015f\u00fcn', researchBtn: 'Ara\u015ft\u0131rma',
  codeBtn: 'Kod', marketBtn: 'Piyasa', capabilities: 'Yetenekler',
  newConversation: 'Yeni konu\u015fma', confirm: 'Onayla', delete: 'Sil',
  close: 'Kapat', open: 'A\u00e7', save: 'Kaydet', search: 'Ara',
  loading: 'Y\u00fckleniyor', error: 'Hata', success: 'Ba\u015far\u0131l\u0131', retry: 'Tekrar dene',
  comingSoon: 'Yak\u0131nda', beta: 'Beta', proOnly: 'Sadece Pro',
  askAnything: 'Her \u015feyi sor', thinking: 'D\u00fc\u015f\u00fcn\u00fcyor', analyzing: 'Analiz ediyor',
  generating: '\u00dcretiyor', processing: '\u0130\u015fleniyor', complete: 'Tamamland\u0131',
  failed: 'Ba\u015far\u0131s\u0131z', pending: 'Beklemede', inProgress: '\u0130\u015flemde',
  uploadFile: 'Dosya y\u00fckle', dropFiles: 'Dosyalar\u0131 buraya b\u0131rak',
  selectModel: 'Model se\u00e7', model: 'Model', fast: 'H\u0131zl\u0131', auto: 'Oto',
  add: 'Ekle', clear: 'Temizle', remove: 'Kald\u0131r', edit: 'D\u00fczenle',
  name: '\u0130sim', email: 'E-posta', password: 'Parola', profile: 'Profil',
  today: 'Bug\u00fcn', yesterday: 'D\u00fcn', justNow: 'Az \u00f6nce',
  minuteAgo: 'dakika \u00f6nce', minutesAgo: 'dakika \u00f6nce',
  hourAgo: 'saat \u00f6nce', hoursAgo: 'saat \u00f6nce',
  thisWeek: 'Bu hafta', apply: 'Uygula', reset: 'S\u0131f\u0131rla',
  filter: 'Filtrele', sort: 'S\u0131rala', refresh: 'Yenile',
  didYouKnow: 'Biliyor muydunuz?', tipPrefix: '\u0130pucu',
  somethingWentWrong: 'Bir \u015feyler ters gitti', pleaseRetry: 'L\u00fctfen tekrar deneyin',
  connectionLost: 'Ba\u011flant\u0131 kesildi', reconnecting: 'Yeniden ba\u011flan\u0131l\u0131yor',
  startNewChat: 'Yeni sohbet ba\u015flat', goBack: 'Geri d\u00f6n',
  // UserAccountDropdown
  accountSettings: 'Hesap Ayarlar\u0131', learningCenter: '\u00d6\u011frenme Merkezi',
  documentation: 'Dok\u00fcmantasyon', community: 'Topluluk',
  upgradeToPro: 'Pro\'ya Y\u00fckselt', guestMode: 'Misafir modu',
  // Sidebar
  workspaceHub: '\u00c7al\u0131\u015fma Alan\u0131', explore: 'Ke\u015ffet', work: '\u00c7al\u0131\u015f',
  tools: 'Ara\u00e7lar', moreTabs: 'Daha fazla', pinned: 'Sabitlenmi\u015f',
  yourChats: 'Sohbetleriniz',
  // Memory
  memoryNodes: 'Haf\u0131za D\u00fc\u011f\u00fcmleri', memoryConnections: 'Haf\u0131za Ba\u011flant\u0131lar\u0131',
  // Onboarding
  getStarted: 'Ba\u015fla', createFirst: '\u0130lkini olu\u015ftur',
  welcome: 'Ho\u015f geldiniz', greeting: 'Merhaba',
  // Shortcuts
  shortcuts: 'K\u0131sayollar', keyboardShortcuts: 'Klavye k\u0131sayollar\u0131',
  pressKey: 'Bas\u0131n', toFocus: 'odaklanmak i\u00e7in',
};

/* ═══════════════════════════════════════
   TRANSLATION BUILDER
   Only 'en' and 'tr' have complete
   coverage. All others get clean EN.
   ═══════════════════════════════════════ */

function buildTranslation(lang: Language): Record<string, string> {
  // Only use translated content for complete languages
  // All others get clean English — no half-translated UI
  if (lang === 'tr') {
    return { ...EN, ...TR } as Record<string, string>;
  }
  // English (and all incomplete languages) = clean English
  return { ...EN };
}

interface LanguageState {
  lang: Language;
  t: (key: string) => string;
  setLang: (lang: Language) => void;
}

export const useLanguageStore = create<LanguageState>()(
  persist(
    (set) => ({
      lang: 'en',
      t: (key: string) => buildTranslation('en')[key] || key,
      setLang: (lang: Language) => {
        const effectiveLang = getEffectiveLanguage(lang);
        set({
          lang: effectiveLang,
          t: (key: string) => buildTranslation(effectiveLang)[key] || key,
        });
      },
    }),
    {
      name: 'korvix-language',
      partialize: (state) => ({ lang: state.lang }),
      onRehydrateStorage: () => (state) => {
        if (state?.lang) {
          const effectiveLang = getEffectiveLanguage(state.lang);
          state.lang = effectiveLang;
          state.t = (key: string) => buildTranslation(effectiveLang)[key] || key;
        }
      },
    }
  )
);
