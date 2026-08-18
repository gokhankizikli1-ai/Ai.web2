/**
 * App Architecture Contract (Phase 2) — the app-specific planning authority the
 * mature Build spine gains for buildType='app'. It uniquely owns the SCREEN model
 * (inventory, role, hierarchy, primary entry screen, shell) and the PRIMARY USER
 * FLOWS. It is the app analogue of the web section-architecture, but thinks in
 * screens/routes/flows rather than scroll sections and hero beats.
 *
 * It does NOT duplicate research / product / brand intelligence — it is FED by the
 * already-derived identity (sector / business model / product concept), the binding
 * user-requirements (functional signals extracted from the prompt), the research
 * direction and the raw prompt, and composes them into a credible multi-screen
 * architecture. The user prompt stays authoritative: feature signals detected in the
 * prompt/binding add or drop screens on top of the per-type base playbook, so a CRM,
 * a fitness app, a booking app and a tiny utility do NOT get the same screens, the
 * same shell, or the same screen count.
 *
 * Pure, deterministic, network-free, bounded, JSON-serializable, fail-open: any
 * error (or a non-app build) returns undefined and the spec omits the field.
 */
import type { FrontendSpecIdentity } from '@/lib/webBuildAgents';
import type { FrontendBindingRequirements } from '@/lib/webBuildAgents';
import type { ResearchDirectionContract } from '@/lib/webBuildResearchDirection';

/* ── Public types ─────────────────────────────────────────────────────────── */

export type ScreenRole =
  | 'home' | 'dashboard' | 'list' | 'detail' | 'search' | 'create' | 'edit'
  | 'profile' | 'settings' | 'analytics' | 'calendar' | 'booking' | 'messaging'
  | 'cart' | 'checkout' | 'onboarding' | 'auth' | 'admin' | 'content' | 'tool'
  | 'other';

/** How the app frames its top-level navigation. Deliberately varied per app type
 *  so functional/desktop tools get a sidebar, consumer apps get a tab bar,
 *  browse-led apps get top nav, and tiny utilities get little or no chrome. */
export type AppShellType = 'sidebar' | 'tab-bar' | 'top-nav' | 'stacked' | 'none';

export interface AppScreenIdentity {
  /** Route-safe, stable id (also the route segment). */
  id: string;
  /** Human screen name. */
  name: string;
  role: ScreenRole;
  /** The concrete job the user accomplishes on this screen. */
  userJob: string;
  /** When the user reaches this screen (entry conditions), when non-trivial. */
  entryConditions?: string;
  /** The primary information this screen presents. */
  primaryInformation: string;
  /** The single primary action. */
  primaryAction: string;
  /** Supporting secondary actions. */
  secondaryActions: string[];
  /** What data/state the screen expects to render. */
  dataExpectations: string[];
  /** True ⇒ a top-level, nav-reachable destination (part of the app shell).
   *  False ⇒ a local screen reached by drilling in (e.g. a detail/edit). */
  global: boolean;
  /** Hierarchy: a detail/edit screen names the list/home it drills in from. */
  parentId?: string;
}

export interface AppUserFlow {
  id: string;
  name: string;
  /** Ordered screen ids the flow traverses. */
  steps: string[];
}

/**
 * App Build Quality V2 — the lightweight PRODUCT DIRECTION the planner establishes BEFORE
 * generation, from the user's actual app type.
 *
 * The repetition problem in App Build was never that the model lacked instructions — it was that
 * every app received the SAME instructions, so every app converged on the same left-sidebar +
 * top-bar + KPI-cards + 3-column shape. This contract fixes that at the planning authority: the
 * six axes below genuinely differ per app type, so a booking app is told to lead with a
 * time-based surface, a messaging app with a two-pane thread model, and a media app with a
 * browse-led shelf — before a single line of code is generated.
 *
 * It is NOT a house template and NOT randomization: it is a deterministic, per-archetype
 * direction. It adds NO model call — every field is derived from the already-classified app type.
 */
export interface AppProductDirection {
  /** How the user moves between top-level destinations. */
  navigationModel: string;
  /** How much information a screen should carry. */
  informationDensity: string;
  /** The single interaction the product lives or dies by. */
  primaryInteractionModel: string;
  /** What dominates a screen, and what is subordinate to it. */
  screenHierarchy: string;
  /** How the composition changes between a wide desktop and a phone. */
  responsiveComposition: string;
  /** The intended character — explicitly NOT generic AI-SaaS. */
  visualCharacter: string;
}

export interface AppArchitectureContract {
  version: 'app-architecture-v1';
  /** The classified app archetype (drives the base playbook + shell). */
  appType: AppType;
  /** The per-archetype product/visual direction established before generation. */
  direction?: AppProductDirection;
  /** A short, honest description of the product this architecture serves. */
  productSummary: string;
  /** Application shell / top-level navigation model. */
  shell: AppShellType;
  /** The screen the app opens on. */
  primaryEntryScreenId: string;
  /** Full screen inventory (global + local). */
  screens: AppScreenIdentity[];
  /** Ids of the global (top-level nav) screens, in nav order. */
  globalScreenIds: string[];
  /** The primary user flows through the app. */
  primaryFlows: AppUserFlow[];
  /** Bounded planning notes (why these screens / this shell). */
  notes: string[];
}

export type AppType =
  | 'crm' | 'analytics-dashboard' | 'ecommerce-admin' | 'fitness' | 'booking'
  | 'productivity' | 'messaging' | 'media-content' | 'utility' | 'generic-app';

export interface AppArchitectureInput {
  identity?: FrontendSpecIdentity;
  binding?: FrontendBindingRequirements;
  research?: ResearchDirectionContract;
  /** Planning-derived section names — used only as supplementary naming hints. */
  sectionNames?: string[];
  prompt: string;
}

/* ── Bounded helpers (no Date/random/network; JSON-safe) ─────────────────────── */

const SCREEN_CAP = 9;
const FLOW_CAP = 4;
const NOTE_CAP = 6;

const lc = (s: unknown): string => (typeof s === 'string' ? s.toLowerCase() : '');
const has = (hay: string, ...needles: string[]): boolean => needles.some((n) => hay.includes(n));
const uniq = <T,>(xs: T[]): T[] => Array.from(new Set(xs));

/** PascalCase component name for a screen id (deterministic). */
export function screenComponentName(id: string): string {
  const parts = (id || 'screen').split(/[^a-z0-9]+/i).filter(Boolean);
  const pascal = parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('') || 'Screen';
  return /screen$/i.test(pascal) ? pascal : `${pascal}Screen`;
}

/** The canonical generated file path for a screen (single source of truth shared
 *  by the output contract and the generation request). */
export function screenFilePath(id: string): string {
  return `src/screens/${screenComponentName(id)}.tsx`;
}

/** Route-safe id from a name (deterministic, ascii, hyphenated, bounded). */
function toId(name: string): string {
  return (name || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'screen';
}

/* ── App-type classification (prompt-authoritative) ──────────────────────────── */

/** Classify the app archetype from the prompt (primary) + the derived identity.
 *  The prompt wins: identity sector/business-model only breaks ties. */
/**
 * Turkish app-type vocabulary. Korvix treats Turkish as a first-class prompt language, but every
 * keyword group below was English-only, so a Turkish app request could match nothing and fall
 * through to `generic-app` — measured: "küçük bir işletme için randevu yönetimi uygulaması"
 * (an appointment-management app) classified as generic-app, losing the booking playbook, its
 * shell and its screens. Matched WITHOUT `\b` anchors because JS word boundaries are ASCII-only
 * and would never fire before "ş"/"ö"/"ğ"; the terms are distinctive enough for substring matching.
 */
const APP_TYPE_TR: Array<{ type: AppType; re: RegExp }> = [
  { type: 'utility', re: /(hesap makinesi|çevirici|dönüştürücü|kronometre|zamanlayıcı|bahşiş hesap)/ },
  { type: 'crm', re: /(müşteri ilişkileri|satış ekibi|satış hunisi|potansiyel müşteri|cari hesap|müşteri yönetimi)/ },
  { type: 'analytics-dashboard', re: /(analitik panel|raporlama paneli|metrik panel|iş zekası|gösterge paneli)/ },
  { type: 'ecommerce-admin', re: /(e-?ticaret yönetim|sipariş yönetim|stok yönetim|mağaza yönetim|ürün yönetim)/ },
  { type: 'fitness', re: /(antrenman|egzersiz|fitness|spor takip|kilo takip|koşu takip)/ },
  { type: 'booking', re: /(randevu|rezervasyon|takvim yönetimi|müsaitlik)/ },
  { type: 'messaging', re: /(mesajlaşma|sohbet uygulaması|gelen kutusu|konuşmalar)/ },
  { type: 'productivity', re: /(görev yönetimi|yapılacaklar|not uygulaması|proje yönetimi|kanban|planlayıcı)/ },
  { type: 'media-content', re: /(içerik uygulaması|makale okuma|müzik uygulaması|video uygulaması|podcast uygulaması|haber uygulaması|içerik kütüphane)/ },
];

/**
 * German app-type vocabulary. Symmetric with the Turkish table above and added for the same
 * measured reason — the keyword groups were English-only, so a concise German app request
 * matched nothing and fell through to `generic-app` (measured: "eine App zur Aufgabenverwaltung"
 * → generic-app, losing the productivity playbook). Matched WITHOUT `\b` anchors: JS word
 * boundaries are ASCII-only and never fire before "ä"/"ö"/"ü"/"ß", and German compounds glue the
 * meaningful stem inside a longer word ("Aufgabenverwaltung"). Every term is long and distinctive
 * enough for safe substring matching.
 */
const APP_TYPE_DE: Array<{ type: AppType; re: RegExp }> = [
  { type: 'utility', re: /(taschenrechner|umrechner|stoppuhr|zeitmesser|trinkgeldrechner|einheitenrechner)/ },
  { type: 'crm', re: /(kundenverwaltung|kundenbeziehung|vertriebsteam|vertriebspipeline|kontaktverwaltung|lead-verwaltung)/ },
  { type: 'analytics-dashboard', re: /(analyse-dashboard|analysedashboard|kennzahlen|berichts-dashboard|auswertungs|business intelligence)/ },
  { type: 'ecommerce-admin', re: /(shop-verwaltung|shopverwaltung|bestellverwaltung|lagerverwaltung|produktverwaltung|warenwirtschaft)/ },
  { type: 'fitness', re: /(trainingsplan|workout|fitness|trainingsverfolgung|gewichtsverfolgung|laufverfolgung)/ },
  { type: 'booking', re: /(terminbuchung|terminverwaltung|reservierung|buchungssystem|verfügbarkeiten)/ },
  { type: 'messaging', re: /(nachrichten-app|chat-app|posteingang|unterhaltungen|direktnachrichten)/ },
  { type: 'productivity', re: /(aufgabenverwaltung|aufgabenliste|projektverwaltung|notiz-app|notizen-app|kanban|wochenplaner)/ },
  { type: 'media-content', re: /(inhalte-app|artikel lesen|musik-app|video-app|podcast-app|nachrichten-app|mediathek)/ },
];

export function classifyAppType(prompt: string, identity?: FrontendSpecIdentity): AppType {
  const p = lc(prompt);
  const concept = `${lc(identity?.primaryConcept)} ${lc(identity?.subsector)} ${lc(identity?.siteType)}`;
  const t = `${p} ${concept}`;

  // Turkish and German vocabulary are checked FIRST, in the same precedence order as the
  // English groups below (utility first so an intentionally tiny tool is not over-built). A
  // request that matches neither still falls through to the English groups unchanged, and all
  // three channels run against every request — the declared language is inferred and requests
  // routinely mix languages, so selecting a channel by that inference would blind the scorer.
  for (const entry of APP_TYPE_TR) {
    if (entry.re.test(t)) return entry.type;
  }
  for (const entry of APP_TYPE_DE) {
    if (entry.re.test(t)) return entry.type;
  }

  // Small utility / intentionally simple — checked first so "simple task app" that
  // is really a utility is not over-built, but a "task manager" still gets more.
  if (has(t, 'calculator', 'converter', 'timer', 'stopwatch', 'unit convert', 'tip calc', 'bmi'))
    return 'utility';

  if (has(t, 'crm', 'sales team', 'pipeline', 'lead', 'deals', 'contacts manager', 'customer relationship'))
    return 'crm';
  if (has(t, 'analytics dashboard', 'saas analytics', 'kpi', 'metrics dashboard', 'reporting dashboard', 'business intelligence'))
    return 'analytics-dashboard';
  if (has(t, 'ecommerce', 'e-commerce', 'store management', 'orders', 'inventory', 'shopify', 'product catalog admin', 'commerce admin'))
    return 'ecommerce-admin';
  if (has(t, 'fitness', 'workout', 'training', 'coaching', 'exercise', 'gym', 'programs and progress', 'progress tracking'))
    return 'fitness';
  if (has(t, 'booking', 'appointment', 'reservation', 'scheduling', 'schedule management', 'calendar booking'))
    return 'booking';
  if (has(t, 'messaging', 'chat app', 'inbox', 'conversations', 'direct message', 'messenger'))
    return 'messaging';
  if (has(t, 'task', 'to-do', 'todo', 'productivity', 'kanban', 'notes app', 'project management', 'planner'))
    return 'productivity';
  if (has(t, 'media', 'content browsing', 'streaming', 'feed', 'library', 'articles', 'podcast', 'video app', 'news app'))
    return 'media-content';

  // Identity-based tie-breakers.
  if (identity?.sector === 'marketplace') return 'ecommerce-admin';
  // App Build Quality V2 — the previous rule sent EVERY subscription/AI-SaaS-flavoured app that
  // matched no keyword above to `analytics-dashboard`, whose playbook is KPI tiles + charts +
  // segments behind a sidebar. That single tie-breaker was the biggest structural reason
  // unrelated prompts kept producing the same "sidebar + KPI cards + 3-column dashboard" app.
  // A SaaS-shaped product is only an analytics dashboard when it actually asks for measurement;
  // otherwise it is a generic app, whose playbook is a home → detail → settings shape that the
  // prompt's own feature signals then extend. Explicit analytics prompts still classify above.
  if ((identity?.businessModel === 'subscription-product' || identity?.sector === 'ai-saas')
    && has(t, 'dashboard', 'analytics', 'metric', 'report', 'chart', 'insight', 'monitor', 'track performance')) {
    return 'analytics-dashboard';
  }

  return 'generic-app';
}

/** The default shell per app type. Functional/desktop tools ⇒ sidebar; consumer
 *  apps ⇒ tab bar; browse-led ⇒ top nav; tiny utilities ⇒ minimal/none. */
function defaultShell(appType: AppType): AppShellType {
  switch (appType) {
    case 'crm':
    case 'analytics-dashboard':
    case 'ecommerce-admin':
      return 'sidebar';
    case 'fitness':
    case 'booking':
    case 'productivity':
    case 'messaging':
      return 'tab-bar';
    case 'media-content':
      return 'top-nav';
    case 'utility':
      return 'none';
    default:
      return 'top-nav';
  }
}

/* ── Screen builder ──────────────────────────────────────────────────────────── */

type ScreenSeed = Omit<AppScreenIdentity, 'id'> & { id?: string };
const screen = (name: string, role: ScreenRole, s: Partial<ScreenSeed> & { userJob: string; primaryInformation: string; primaryAction: string }): AppScreenIdentity => ({
  id: s.id || toId(name),
  name,
  role,
  userJob: s.userJob,
  entryConditions: s.entryConditions,
  primaryInformation: s.primaryInformation,
  primaryAction: s.primaryAction,
  secondaryActions: (s.secondaryActions || []).slice(0, 5),
  dataExpectations: (s.dataExpectations || []).slice(0, 5),
  global: s.global ?? false,
  parentId: s.parentId,
});

/* ── Per-type base playbooks ──────────────────────────────────────────────────
 * Each returns an ordered screen inventory. The FIRST global screen is the entry.
 * Screen COUNT varies by type on purpose. Feature-signal screens are layered on
 * top of these in deriveAppArchitectureContract, so the prompt stays authoritative. */

function playbook(appType: AppType): AppScreenIdentity[] {
  switch (appType) {
    case 'crm':
      return [
        screen('Dashboard', 'dashboard', { global: true, userJob: 'See pipeline health and what needs attention today', primaryInformation: 'Pipeline value, deals by stage, tasks due, recent activity', primaryAction: 'Open a deal that needs action', secondaryActions: ['Filter by owner', 'Jump to a stage'], dataExpectations: ['pipeline summary', 'activity feed', 'tasks due'] }),
        screen('Contacts', 'list', { global: true, userJob: 'Find and manage people and companies', primaryInformation: 'Searchable, filterable list of contacts with status', primaryAction: 'Open a contact', secondaryActions: ['Search', 'Filter by segment', 'Add contact'], dataExpectations: ['contact rows', 'filter state', 'empty state'] }),
        screen('Contact Detail', 'detail', { parentId: 'contacts', userJob: 'Review one contact and log activity', primaryInformation: 'Contact profile, deals, timeline of interactions', primaryAction: 'Log an activity or note', secondaryActions: ['Edit contact', 'Create deal', 'Email'], dataExpectations: ['contact record', 'related deals', 'activity timeline'] }),
        screen('Deals', 'list', { global: true, userJob: 'Work the pipeline stage by stage', primaryInformation: 'Kanban board of deals across pipeline stages', primaryAction: 'Move a deal to the next stage', secondaryActions: ['Filter', 'Add deal', 'Sort by value'], dataExpectations: ['deals grouped by stage', 'drag state', 'empty column'] }),
        screen('Settings', 'settings', { global: true, userJob: 'Configure the workspace and preferences', primaryInformation: 'Grouped workspace, pipeline and notification settings', primaryAction: 'Save changes', secondaryActions: ['Manage team', 'Edit stages'], dataExpectations: ['settings groups', 'toggle state', 'save state'] }),
      ];
    case 'analytics-dashboard':
      return [
        screen('Overview', 'dashboard', { global: true, userJob: 'Understand headline performance at a glance', primaryInformation: 'KPI tiles, trend charts, period comparison', primaryAction: 'Change the reporting period', secondaryActions: ['Compare periods', 'Segment', 'Export'], dataExpectations: ['metric tiles', 'time series', 'loading state'] }),
        screen('Reports', 'analytics', { global: true, userJob: 'Explore a metric in depth', primaryInformation: 'Detailed breakdown tables and drilldown charts', primaryAction: 'Drill into a dimension', secondaryActions: ['Filter', 'Group by', 'Export'], dataExpectations: ['breakdown table', 'chart', 'empty results'] }),
        screen('Segments', 'list', { global: true, userJob: 'Manage saved segments and cohorts', primaryInformation: 'List of segments with size and last-updated', primaryAction: 'Open a segment', secondaryActions: ['Create segment', 'Duplicate'], dataExpectations: ['segment rows', 'empty state'] }),
        screen('Segment Detail', 'detail', { parentId: 'segments', userJob: 'Inspect one segment and its metrics', primaryInformation: 'Segment definition and its performance charts', primaryAction: 'Edit the segment definition', secondaryActions: ['Export', 'Compare'], dataExpectations: ['segment definition', 'metrics', 'chart'] }),
        screen('Settings', 'settings', { global: true, userJob: 'Configure data sources and preferences', primaryInformation: 'Grouped account, data and alert settings', primaryAction: 'Save changes', secondaryActions: ['Manage alerts'], dataExpectations: ['settings groups', 'toggle state'] }),
      ];
    case 'ecommerce-admin':
      return [
        screen('Dashboard', 'dashboard', { global: true, userJob: 'See sales performance and store health', primaryInformation: 'Revenue, orders today, low-stock alerts, top products', primaryAction: 'Open an order that needs action', secondaryActions: ['Change period', 'View alerts'], dataExpectations: ['sales summary', 'alerts', 'top products'] }),
        screen('Orders', 'list', { global: true, userJob: 'Process and track orders', primaryInformation: 'Filterable orders list with status and total', primaryAction: 'Open an order', secondaryActions: ['Filter by status', 'Search', 'Export'], dataExpectations: ['order rows', 'status filter', 'empty state'] }),
        screen('Order Detail', 'detail', { parentId: 'orders', userJob: 'Fulfil and manage one order', primaryInformation: 'Line items, customer, shipping and payment status', primaryAction: 'Update fulfilment status', secondaryActions: ['Refund', 'Print', 'Contact customer'], dataExpectations: ['order record', 'line items', 'status'] }),
        screen('Products', 'list', { global: true, userJob: 'Manage the catalog and inventory', primaryInformation: 'Products with price, stock and status', primaryAction: 'Edit a product', secondaryActions: ['Add product', 'Filter', 'Search'], dataExpectations: ['product rows', 'stock levels', 'empty state'] }),
        screen('Product Edit', 'edit', { parentId: 'products', userJob: 'Create or update a product', primaryInformation: 'Product fields: title, price, inventory, media', primaryAction: 'Save the product', secondaryActions: ['Cancel', 'Duplicate'], dataExpectations: ['form fields', 'validation', 'save state'] }),
        screen('Settings', 'settings', { global: true, userJob: 'Configure store settings', primaryInformation: 'Grouped store, shipping and payment settings', primaryAction: 'Save changes', secondaryActions: ['Manage staff'], dataExpectations: ['settings groups', 'toggle state'] }),
      ];
    case 'fitness':
      return [
        screen('Today', 'home', { global: true, userJob: "See today's plan and start training", primaryInformation: "Today's workout, streak, next session", primaryAction: 'Start the workout', secondaryActions: ['View program', 'Log a metric'], dataExpectations: ['today plan', 'streak', 'empty rest-day state'] }),
        screen('Programs', 'list', { global: true, userJob: 'Browse and choose a training program', primaryInformation: 'List of programs with focus and duration', primaryAction: 'Open a program', secondaryActions: ['Filter by goal', 'Search'], dataExpectations: ['program cards', 'empty state'] }),
        screen('Workout Detail', 'detail', { parentId: 'programs', userJob: 'Follow a workout set by set', primaryInformation: 'Exercises, sets, reps and rest for the session', primaryAction: 'Mark a set complete', secondaryActions: ['Swap exercise', 'Add note'], dataExpectations: ['exercise list', 'set progress', 'completion state'] }),
        screen('Progress', 'analytics', { global: true, userJob: 'Track progress over time', primaryInformation: 'Charts of volume, weight and streaks', primaryAction: 'Log a new measurement', secondaryActions: ['Change metric', 'Change range'], dataExpectations: ['progress charts', 'empty state'] }),
        screen('Profile', 'profile', { global: true, userJob: 'Manage goals and preferences', primaryInformation: 'Goals, personal records and settings', primaryAction: 'Edit goals', secondaryActions: ['Units', 'Notifications'], dataExpectations: ['profile', 'records', 'toggle state'] }),
      ];
    case 'booking':
      return [
        screen('Today', 'home', { global: true, userJob: "See today's bookings at a glance", primaryInformation: "Upcoming appointments, gaps, quick stats", primaryAction: 'Open the next appointment', secondaryActions: ['New booking', 'Jump to date'], dataExpectations: ['today bookings', 'empty state'] }),
        screen('Calendar', 'calendar', { global: true, userJob: 'View and manage the schedule', primaryInformation: 'Day/week calendar of bookings', primaryAction: 'Create a booking in a slot', secondaryActions: ['Switch view', 'Filter by resource'], dataExpectations: ['calendar events', 'selected slot', 'empty day'] }),
        screen('Booking Detail', 'detail', { parentId: 'calendar', userJob: 'Manage one booking', primaryInformation: 'Client, service, time and status', primaryAction: 'Confirm or reschedule', secondaryActions: ['Cancel', 'Message client'], dataExpectations: ['booking record', 'status'] }),
        screen('New Booking', 'create', { parentId: 'calendar', userJob: 'Create a booking', primaryInformation: 'Client, service, date/time selection', primaryAction: 'Create the booking', secondaryActions: ['Cancel'], dataExpectations: ['form fields', 'availability', 'validation'] }),
        screen('Clients', 'list', { global: true, userJob: 'Manage clients', primaryInformation: 'Client list with contact and history', primaryAction: 'Open a client', secondaryActions: ['Search', 'Add client'], dataExpectations: ['client rows', 'empty state'] }),
        screen('Settings', 'settings', { global: true, userJob: 'Configure services and availability', primaryInformation: 'Grouped services, hours and notification settings', primaryAction: 'Save changes', secondaryActions: ['Edit services'], dataExpectations: ['settings groups', 'toggle state'] }),
      ];
    case 'productivity':
      return [
        screen('Today', 'home', { global: true, userJob: 'Focus on what to do today', primaryInformation: "Today's tasks, due soon, quick add", primaryAction: 'Complete or add a task', secondaryActions: ['Add task', 'Reorder'], dataExpectations: ['today tasks', 'empty state'] }),
        screen('Tasks', 'list', { global: true, userJob: 'Manage all tasks', primaryInformation: 'Filterable task list with status and priority', primaryAction: 'Toggle a task complete', secondaryActions: ['Filter', 'Sort', 'Add task'], dataExpectations: ['task rows', 'filter state', 'empty state'] }),
        screen('Task Detail', 'detail', { parentId: 'tasks', userJob: 'Edit one task in depth', primaryInformation: 'Task fields, subtasks, notes and due date', primaryAction: 'Save the task', secondaryActions: ['Add subtask', 'Delete'], dataExpectations: ['task record', 'subtasks', 'save state'] }),
        screen('Projects', 'list', { global: true, userJob: 'Organize tasks into projects', primaryInformation: 'Projects with progress and task counts', primaryAction: 'Open a project', secondaryActions: ['Add project', 'Archive'], dataExpectations: ['project cards', 'empty state'] }),
        screen('Settings', 'settings', { global: true, userJob: 'Configure preferences', primaryInformation: 'Grouped account and workflow settings', primaryAction: 'Save changes', secondaryActions: ['Theme'], dataExpectations: ['settings groups', 'toggle state'] }),
      ];
    case 'messaging':
      return [
        screen('Inbox', 'list', { global: true, userJob: 'Triage conversations', primaryInformation: 'Conversation list with last message and unread', primaryAction: 'Open a conversation', secondaryActions: ['Search', 'Filter unread', 'New message'], dataExpectations: ['conversation rows', 'unread state', 'empty state'] }),
        screen('Conversation', 'messaging', { parentId: 'inbox', userJob: 'Read and reply in a thread', primaryInformation: 'Message thread with composer', primaryAction: 'Send a message', secondaryActions: ['Attach', 'React'], dataExpectations: ['messages', 'typing/send state', 'empty thread'] }),
        screen('Contacts', 'list', { global: true, userJob: 'Find people to message', primaryInformation: 'Searchable contacts list', primaryAction: 'Start a conversation', secondaryActions: ['Search'], dataExpectations: ['contact rows', 'empty state'] }),
        screen('Profile', 'profile', { global: true, userJob: 'Manage account and status', primaryInformation: 'Profile, status and preferences', primaryAction: 'Edit profile', secondaryActions: ['Notifications'], dataExpectations: ['profile', 'toggle state'] }),
      ];
    case 'media-content':
      return [
        screen('Browse', 'home', { global: true, userJob: 'Discover content', primaryInformation: 'Curated shelves and categories of content', primaryAction: 'Open an item', secondaryActions: ['Search', 'Filter by category'], dataExpectations: ['content shelves', 'loading state'] }),
        screen('Search', 'search', { global: true, userJob: 'Find specific content', primaryInformation: 'Query input with live results', primaryAction: 'Open a result', secondaryActions: ['Filter', 'Recent searches'], dataExpectations: ['query state', 'results', 'empty results'] }),
        screen('Detail', 'detail', { parentId: 'browse', userJob: 'View one item', primaryInformation: 'Item media, description and related items', primaryAction: 'Play / read / save', secondaryActions: ['Add to library', 'Share'], dataExpectations: ['item record', 'related items'] }),
        screen('Library', 'list', { global: true, userJob: 'Return to saved content', primaryInformation: 'Saved and recently viewed items', primaryAction: 'Open a saved item', secondaryActions: ['Filter', 'Remove'], dataExpectations: ['saved items', 'empty state'] }),
      ];
    case 'utility':
      return [
        screen('Tool', 'tool', { global: true, userJob: 'Use the tool to get a result', primaryInformation: 'The primary input controls and live result', primaryAction: 'Compute / apply', secondaryActions: ['Clear', 'Copy result'], dataExpectations: ['input state', 'live result'] }),
        screen('History', 'list', { global: true, userJob: 'Revisit previous results', primaryInformation: 'List of recent local results', primaryAction: 'Reuse a result', secondaryActions: ['Clear history'], dataExpectations: ['history rows', 'empty state'] }),
      ];
    default:
      return [
        screen('Home', 'home', { global: true, userJob: 'Start using the app', primaryInformation: 'The primary content and entry actions', primaryAction: 'Do the primary action', secondaryActions: ['Search'], dataExpectations: ['primary content', 'empty state'] }),
        screen('Detail', 'detail', { parentId: 'home', userJob: 'View one item in depth', primaryInformation: 'Item detail and actions', primaryAction: 'Act on the item', secondaryActions: ['Back'], dataExpectations: ['item record'] }),
        screen('Settings', 'settings', { global: true, userJob: 'Configure preferences', primaryInformation: 'Grouped preferences', primaryAction: 'Save changes', secondaryActions: ['Theme'], dataExpectations: ['settings groups', 'toggle state'] }),
      ];
  }
}

/* ── Feature-signal screens (prompt-authoritative augmentation) ──────────────── */

/** Optional screens added ONLY when the prompt/binding explicitly asks for them,
 *  so the architecture reflects the user's request, not just the base playbook. */
function featureScreens(text: string, present: Set<ScreenRole>): AppScreenIdentity[] {
  const add: AppScreenIdentity[] = [];
  const wants = (...n: string[]) => has(text, ...n);
  if (wants('schedule', 'calendar', 'agenda') && !present.has('calendar'))
    add.push(screen('Schedule', 'calendar', { global: true, userJob: 'See and manage the schedule', primaryInformation: 'Calendar of scheduled items', primaryAction: 'Add to the schedule', secondaryActions: ['Switch view'], dataExpectations: ['calendar events', 'empty day'] }));
  if (wants('message', 'chat', 'inbox') && !present.has('messaging'))
    add.push(screen('Messages', 'messaging', { global: true, userJob: 'Communicate in-app', primaryInformation: 'Conversations and message threads', primaryAction: 'Send a message', secondaryActions: ['New message'], dataExpectations: ['conversations', 'empty state'] }));
  if (wants('progress', 'tracking', 'stats', 'analytics', 'insights') && !present.has('analytics'))
    add.push(screen('Insights', 'analytics', { global: true, userJob: 'Track progress and trends', primaryInformation: 'Charts and trend metrics', primaryAction: 'Change the metric or range', secondaryActions: ['Export'], dataExpectations: ['charts', 'empty state'] }));
  if (wants('profile', 'account') && !present.has('profile') && !present.has('settings'))
    add.push(screen('Profile', 'profile', { global: true, userJob: 'Manage the account', primaryInformation: 'Profile and preferences', primaryAction: 'Edit profile', secondaryActions: ['Sign out'], dataExpectations: ['profile', 'toggle state'] }));
  return add;
}

/** Simplicity signal — collapses the architecture toward a minimal screen set.
 *  Deliberately narrow: it must describe the APP ("simple app", "single-screen"),
 *  not the customer ("small sales team", "small business"), so bare "small"/"basic"
 *  are excluded to avoid false positives that would under-build a real product. */
function isIntentionallySimple(text: string): boolean {
  return has(
    text,
    'simple app', 'minimal app', 'minimalist', 'tiny app', 'single-screen', 'single screen',
    'one screen', 'one-screen', 'lightweight app', 'bare-bones', 'no-frills',
  ) || /\bintentionally simple\b/.test(text) || /\bkeep it simple\b/.test(text);
}

/* ── Product direction (App Build Quality V2) ─────────────────────────────────────
 * One entry per archetype. Each row is deliberately DIFFERENT on every axis: if two archetypes
 * ever read the same here, the direction has stopped doing its job. The `generic-app` row is the
 * honest fallback for an unclassified product — it is intentionally the least prescriptive, so an
 * unclassified app is not forced into any house shape either. */
const DIRECTIONS: Record<AppType, AppProductDirection> = {
  crm: {
    navigationModel: 'Persistent left rail for the few working areas; everything else is drill-in from a record.',
    informationDensity: 'High — the user scans many records at once; rows over cards, compact controls, no oversized padding.',
    primaryInteractionModel: 'Find a record, open it, act on it and log the outcome.',
    screenHierarchy: 'The record list or pipeline board dominates; summary numbers are a thin supporting strip, never the point of the screen.',
    responsiveComposition: 'Rail collapses to a drawer under 1024; tables become stacked record rows on a phone.',
    visualCharacter: 'Quiet, dense, professional working software — not a marketing dashboard.',
  },
  'analytics-dashboard': {
    navigationModel: 'Left rail of report areas plus a persistent period/segment control.',
    informationDensity: 'High, but ranked — one headline metric, one primary chart, then supporting breakdowns.',
    primaryInteractionModel: 'Change the period or segment and read how the numbers move; drill into a dimension.',
    screenHierarchy: 'One dominant chart owns the screen; metric tiles are a supporting row above it, never a wall of equals.',
    responsiveComposition: 'Multi-column charts become one column under 1024; tiles wrap to two-up then one-up on a phone.',
    visualCharacter: 'Precise and data-led — restrained colour, meaning carried by the data, not by decoration.',
  },
  'ecommerce-admin': {
    navigationModel: 'Left rail of operational areas (orders, products, customers) with a status-driven work queue.',
    informationDensity: 'High — operators triage volume; status chips, sortable tables, bulk actions.',
    primaryInteractionModel: 'Pick the item that needs action from a queue and change its status.',
    screenHierarchy: 'The work queue dominates; alerts and totals are a compact banner, not a card grid.',
    responsiveComposition: 'Tables scroll horizontally inside their own container; the rail becomes a drawer under 1024.',
    visualCharacter: 'Utilitarian back-office — legible status colour, no consumer gloss.',
  },
  fitness: {
    navigationModel: 'Bottom tab bar; the session itself is a full-screen focused flow.',
    informationDensity: 'Low per screen — one clear thing to do now, large numbers, generous spacing.',
    primaryInteractionModel: 'Start a session and mark progress set by set.',
    screenHierarchy: "Today's action dominates the first viewport; history and stats sit below it.",
    responsiveComposition: 'Phone-first single column; wider screens centre the same column and add a side summary — never a dashboard grid.',
    visualCharacter: 'Energetic and physical — strong typography, imagery that shows the activity, high-contrast progress.',
  },
  booking: {
    navigationModel: 'Bottom tabs between today / calendar / clients; booking creation is a sheet over the calendar.',
    informationDensity: 'Medium — time is the organising axis, so the schedule needs room to be readable.',
    primaryInteractionModel: 'Pick a time slot and confirm or reschedule a booking.',
    screenHierarchy: 'A time-based surface (agenda or calendar) dominates every main screen; counts are secondary.',
    responsiveComposition: 'Week grid on desktop degrades to a day agenda list under 768 — never a squeezed grid.',
    visualCharacter: 'Calm and service-oriented — clear time typography, status colour that means confirmed/pending/cancelled.',
  },
  productivity: {
    navigationModel: 'Bottom tabs (or a slim rail on desktop) between today / all work / projects.',
    informationDensity: 'Medium — scannable lines of work with fast inline actions, not cards.',
    primaryInteractionModel: 'Capture an item, then complete or reschedule it inline without leaving the list.',
    screenHierarchy: 'The list of work owns the screen; a compact header carries the filter and the quick-add.',
    responsiveComposition: 'Single column everywhere; desktop adds an optional detail pane beside the list.',
    visualCharacter: 'Calm, typographic and low-chrome — the content is the interface.',
  },
  messaging: {
    navigationModel: 'Conversation list and thread — two panes on desktop, push/pop navigation on a phone.',
    informationDensity: 'Medium in the list, low in the thread — messages need breathing room to be readable.',
    primaryInteractionModel: 'Open a conversation and send a message; the thread updates immediately.',
    screenHierarchy: 'The thread and its composer dominate; the list is a subordinate column, and neither is a card grid.',
    responsiveComposition: 'Two panes above 1024; below it the list and the thread are separate full-screen views.',
    visualCharacter: 'Conversational and personal — avatars, message bubbles, clear unread state.',
  },
  'media-content': {
    navigationModel: 'Top navigation across browse / search / library — discovery-led, not tool-led.',
    informationDensity: 'Low text, high visual — content shelves and covers carry the screen.',
    primaryInteractionModel: 'Browse or search, open an item, then play/read/save it.',
    screenHierarchy: 'A featured item or shelf dominates the first viewport; supporting shelves scroll beneath it.',
    responsiveComposition: 'Horizontally scrolling shelves at every width; item counts per shelf shrink instead of the layout collapsing.',
    visualCharacter: 'Editorial and image-led — content imagery, not decorative stock photography.',
  },
  utility: {
    navigationModel: 'Effectively none — one surface, with history reachable behind a single control.',
    informationDensity: 'Minimal — the input and the result, nothing else.',
    primaryInteractionModel: 'Change an input and read the result immediately.',
    screenHierarchy: 'The result is the largest element on the screen; inputs sit directly beneath it.',
    responsiveComposition: 'One centred column at every width.',
    visualCharacter: 'Sharp and focused — no chrome, no cards, no dashboard.',
  },
  'generic-app': {
    navigationModel: 'Top navigation across the few real destinations this product needs — no more chrome than the content justifies.',
    informationDensity: 'Match the content: dense where the user scans many items, spacious where they do one thing.',
    primaryInteractionModel: 'The one action named in the request, reachable from the first screen.',
    screenHierarchy: 'Each screen has ONE dominant region that is the reason the screen exists; everything else is subordinate.',
    responsiveComposition: 'Fluid single-column base that gains columns with width — never a fixed desktop canvas.',
    visualCharacter: "Derive the character from the product itself; do NOT reach for the default AI-SaaS look (purple/blue gradient, sidebar, KPI tiles).",
  },
};

/** The product direction for an archetype. Deterministic; never randomized. */
export function directionFor(appType: AppType): AppProductDirection {
  return DIRECTIONS[appType] || DIRECTIONS['generic-app'];
}

/* ── Derivation ──────────────────────────────────────────────────────────────── */

/**
 * Derive the app architecture contract. Pure/deterministic/fail-open. Returns
 * undefined on any error so the spec simply omits the field (legacy-safe).
 */
export function deriveAppArchitectureContract(input: AppArchitectureInput): AppArchitectureContract | undefined {
  try {
    const prompt = typeof input.prompt === 'string' ? input.prompt : '';
    const bindingText = (input.binding?.requirements || [])
      .map((r) => `${lc(r.label)} ${lc(r.detail)} ${lc(r.evidence)}`).join(' ');
    const text = `${lc(prompt)} ${bindingText}`.trim();
    const appType = classifyAppType(prompt, input.identity);

    let screens = playbook(appType);

    // Prompt-authoritative augmentation — add explicitly-requested screens.
    const presentRoles = new Set<ScreenRole>(screens.map((s) => s.role));
    const extra = featureScreens(text, presentRoles).filter((e) => !screens.some((s) => s.id === e.id));
    screens = [...screens, ...extra];

    // Simplicity collapse — a "simple/minimal" app keeps only the entry screen,
    // one drill-in and (if present) settings, so it is not over-engineered.
    if (isIntentionallySimple(text) && appType !== 'utility') {
      const entry = screens.find((s) => s.global) || screens[0];
      const drill = screens.find((s) => s.parentId === entry?.id);
      const settings = screens.find((s) => s.role === 'settings');
      screens = uniq([entry, drill, settings].filter(Boolean) as AppScreenIdentity[]);
    }

    // Bound the inventory (never silently — capped deterministically).
    screens = screens.slice(0, SCREEN_CAP);

    // Repair hierarchy: any parentId that fell outside the cap is dropped to a
    // top-level screen so no screen references a missing parent.
    const ids = new Set(screens.map((s) => s.id));
    screens = screens.map((s) => (s.parentId && !ids.has(s.parentId) ? { ...s, parentId: undefined, global: true } : s));

    const globalScreens = screens.filter((s) => s.global);
    const globalScreenIds = globalScreens.map((s) => s.id);
    const primaryEntryScreenId = (globalScreens[0] || screens[0])?.id || 'home';

    const shell = resolveShell(appType, globalScreenIds.length);
    const primaryFlows = buildFlows(screens).slice(0, FLOW_CAP);
    const productSummary = buildSummary(appType, input.identity, prompt);

    const notes: string[] = uniq([
      `Classified as ${appType}; shell=${shell}.`,
      `${screens.length} screens (${globalScreenIds.length} top-level), entry=${primaryEntryScreenId}.`,
      extra.length ? `Prompt added: ${extra.map((e) => e.name).join(', ')}.` : '',
      isIntentionallySimple(text) ? 'Simplicity signal detected — architecture kept minimal.' : '',
    ].filter(Boolean)).slice(0, NOTE_CAP);

    return {
      version: 'app-architecture-v1',
      appType,
      direction: directionFor(appType),
      productSummary,
      shell,
      primaryEntryScreenId,
      screens,
      globalScreenIds,
      primaryFlows,
      notes,
    };
  } catch {
    return undefined;
  }
}

/** Shell resolution — the base per-type shell, downgraded when there are too few
 *  top-level screens to justify heavy chrome (2 or fewer ⇒ stacked/none). */
function resolveShell(appType: AppType, globalCount: number): AppShellType {
  const base = defaultShell(appType);
  if (appType === 'utility') return globalCount <= 1 ? 'none' : 'stacked';
  if (globalCount <= 1) return 'none';
  if (globalCount === 2 && (base === 'sidebar' || base === 'tab-bar')) return 'top-nav';
  return base;
}

function buildFlows(screens: AppScreenIdentity[]): AppUserFlow[] {
  const byRole = (role: ScreenRole) => screens.find((s) => s.role === role);
  const entry = screens.find((s) => s.global) || screens[0];
  const flows: AppUserFlow[] = [];
  // Universal list → detail drill-in flow when one exists.
  const list = screens.find((s) => s.role === 'list');
  const detail = screens.find((s) => s.role === 'detail' || s.role === 'messaging');
  if (list && detail) flows.push({ id: 'browse-detail', name: `${list.name} → ${detail.name}`, steps: [list.id, detail.id] });
  // A create/edit flow when one exists.
  const create = byRole('create') || byRole('edit');
  if (create) flows.push({ id: 'create', name: `Create via ${create.name}`, steps: [create.parentId || entry?.id || create.id, create.id] });
  // The primary daily flow from the entry screen.
  if (entry) flows.push({ id: 'daily', name: `Daily use from ${entry.name}`, steps: [entry.id, ...(detail ? [detail.id] : [])].filter(Boolean) as string[] });
  return flows.filter((f) => f.steps.length >= 1);
}

function buildSummary(appType: AppType, identity: FrontendSpecIdentity | undefined, prompt: string): string {
  const label: Record<AppType, string> = {
    crm: 'a CRM for managing contacts, deals and pipeline',
    'analytics-dashboard': 'a SaaS analytics dashboard',
    'ecommerce-admin': 'an ecommerce management app',
    fitness: 'a fitness/training app',
    booking: 'a booking management app',
    productivity: 'a productivity/task app',
    messaging: 'a messaging app',
    'media-content': 'a media/content browsing app',
    utility: 'a focused utility app',
    'generic-app': 'a multi-screen application',
  };
  const concept = identity?.primaryConcept || identity?.subsector;
  const base = label[appType];
  return concept ? `${base} for ${concept}`.slice(0, 160) : (prompt ? `${base}`.slice(0, 160) : base);
}

/* ── Generation block (bounded model-facing prose) ───────────────────────────── */

/** Render the app architecture as concise builder-facing lines. Returns [] when
 *  the contract is absent so the generation request is unchanged for web builds. */
export function renderAppArchitectureBlock(arch: AppArchitectureContract | undefined): string[] {
  if (!arch) return [];
  const out: string[] = [];
  out.push('[APP ARCHITECTURE]');
  out.push(`App type: ${arch.appType}. Product: ${arch.productSummary}.`);
  out.push(`Application shell: ${arch.shell}. Entry screen: ${arch.primaryEntryScreenId}.`);
  // App Build Quality V2 — the per-archetype product direction, stated BEFORE the screen list so
  // the model composes the screens for THIS product instead of reaching for the default
  // sidebar + KPI-cards dashboard it produces when every app is briefed identically.
  const d = arch.direction;
  if (d) {
    out.push('Product direction for THIS app type (do not substitute a generic dashboard for it):');
    out.push(`- Navigation model: ${d.navigationModel}`);
    out.push(`- Information density: ${d.informationDensity}`);
    out.push(`- Primary interaction: ${d.primaryInteractionModel}`);
    out.push(`- Screen hierarchy: ${d.screenHierarchy}`);
    out.push(`- Desktop → phone composition: ${d.responsiveComposition}`);
    out.push(`- Visual character: ${d.visualCharacter}`);
    out.push('Do NOT default to the generic AI-SaaS app look (left sidebar + top bar + a row of KPI cards + a 3-column grid + a purple/blue gradient) unless the direction above actually calls for it.');
  }
  out.push('This is a client-routed, multi-SCREEN application (screens + routes + navigation + stateful flows) — NOT a scrolling marketing page. Build the screens below as routed views, not stacked page sections.');
  out.push('Screens (each is a real routed view with its own state):');
  for (const s of arch.screens) {
    const scope = s.global ? 'top-level' : `drill-in from ${s.parentId || 'parent'}`;
    out.push(`- ${s.name} [${s.role}, ${scope}] — job: ${s.userJob}. Shows: ${s.primaryInformation}. Primary action: ${s.primaryAction}.${s.secondaryActions.length ? ` Secondary: ${s.secondaryActions.join(', ')}.` : ''}`);
  }
  if (arch.primaryFlows.length) {
    out.push('Primary user flows:');
    for (const f of arch.primaryFlows) out.push(`- ${f.name}: ${f.steps.join(' → ')}`);
  }
  return out;
}
