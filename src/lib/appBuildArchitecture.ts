/**
 * App Build — App Architecture & Navigation authorities (Phase 2).
 *
 * The Web Build spine plans a single scrolling PAGE (sections, hero, funnel). An App
 * Build plans a client-routed, multi-SCREEN application. These are the two smallest
 * app-specific PLANNING authorities that make that difference real, without forking
 * the pipeline:
 *
 *   • AppArchitectureContract owns the SCREEN INVENTORY — which screens exist, each
 *     screen's role / user-job / entry conditions / primary info / primary action /
 *     secondary actions / data shape / relevant lifecycle states — plus the entry
 *     screen, the screen relationships, the app shell and the primary flows. It does
 *     NOT impose a fixed screen count: a real utility gets one or two screens, a CRM
 *     gets many. Different app kinds get materially DIFFERENT architectures.
 *
 *   • NavigationContract owns the ROUTES — the route table, the default route, the
 *     navigation pattern (sidebar / bottom-tabs / top-tabs / stack / single), the
 *     back behavior, the deep-link identities and whether react-router is reused or a
 *     bounded internal route-state is used. It reads the architecture; it never
 *     invents a screen the architecture did not declare (no fake nav to nowhere).
 *
 * Both are PURE, deterministic, network-free, bounded, JSON-serializable and
 * fail-open (a bad/empty input yields a small, honest architecture, never a throw).
 * They are DERIVED from the resolved identity + prompt intent; they never call a
 * model. Type-only imports keep this a leaf module (no import cycle).
 */
import type { FrontendSpecIdentity } from '@/lib/webBuildAgents';

/* ── Public contract types ──────────────────────────────────────────────────── */

/** The app archetype — the ONE decision that shapes the whole screen inventory. Not
 *  a business template: it is the interaction shape a product of this kind needs. */
export type AppArchetype =
  | 'analytics-dashboard'   // metrics-first console (drill from overview into detail)
  | 'crm-workspace'         // records + pipeline + activity (operator workspace)
  | 'commerce-app'          // browse → product → cart → checkout → orders
  | 'fitness-tracker'       // today → library → session → progress
  | 'booking-service'       // browse services → detail → booking flow → my bookings
  | 'productivity-tool'     // lists/board → item detail → create/edit
  | 'content-feed'          // feed → item detail → saved → profile
  | 'learning-app'          // course list → lesson → progress
  | 'finance-app'           // accounts overview → transactions → transfer flow
  | 'simple-utility'        // one focused primary screen (+ maybe settings)
  | 'generic-app';          // unclassified but still multi-screen

/** A screen's interaction role — drives its states and its place in navigation. */
export type ScreenRole =
  | 'entry-overview' | 'list-browse' | 'detail' | 'create-edit-form'
  | 'workflow-flow' | 'board-pipeline' | 'feed' | 'progress-analytics'
  | 'settings-profile' | 'search' | 'utility-primary';

/** The lifecycle states that are RELEVANT to a screen — derived from its role, never
 *  a universal set. A static utility screen has no "loading"; a form has no "empty". */
export type ScreenState =
  | 'idle' | 'loading' | 'empty' | 'populated' | 'selected' | 'error'
  | 'saving' | 'success' | 'disabled';

/** The data shape a screen renders — informs which states apply and the honest
 *  simulation model (a `form` may show saving/success; it never claims a real save). */
export type ScreenDataShape = 'static' | 'list' | 'record' | 'form' | 'aggregate' | 'stream';

/** The app shell — the persistent chrome the screens live inside. */
export type AppShell = 'sidebar-app' | 'tabbed-app' | 'stack-app' | 'single-screen';

/** The navigation pattern the shell uses. */
export type NavPattern = 'sidebar' | 'bottom-tabs' | 'top-tabs' | 'stack' | 'single';

export interface AppScreenSpec {
  id: string;
  name: string;
  role: ScreenRole;
  /** What the user is trying to accomplish on this screen. */
  userJob: string;
  /** When/how the user arrives here. */
  entryConditions: string;
  /** The primary information this screen presents. */
  primaryInfo: string;
  /** The single primary action. */
  primaryAction: string;
  /** Supporting actions (bounded). */
  secondaryActions: string[];
  dataShape: ScreenDataShape;
  /** The lifecycle states relevant to THIS screen (role-derived, not universal). */
  states: ScreenState[];
  /** True for the app's entry screen. */
  isEntry: boolean;
  /** True for a persistent top-level destination (surfaced in the nav), false for a
   *  pushed/nested screen (detail / form / flow reached from another screen). */
  topLevel: boolean;
  /** For a detail/record screen, the deep-link identity parameter (e.g. 'id'). */
  deepLinkParam?: string;
}

export interface ScreenRelationship { from: string; to: string; via: string }
export interface AppFlow { id: string; name: string; screenIds: string[] }

export interface AppArchitectureContract {
  version: 'app-architecture-v1';
  status: 'derived';
  archetype: AppArchetype;
  shell: AppShell;
  /** UI density this archetype expects (operator tools are compact; consumer apps
   *  comfortable). Informs the app visual adapter (Phase 4), not decided here. */
  density: 'compact' | 'comfortable';
  /** True for an intentionally-minimal product — never over-engineer it into a
   *  multi-tab app just because other archetypes have many screens. */
  intentionallySimple: boolean;
  screens: AppScreenSpec[];
  entryScreenId: string;
  relationships: ScreenRelationship[];
  flows: AppFlow[];
  notes: string[];
}

export interface AppRoute {
  path: string;
  screenId: string;
  isDefault: boolean;
  /** Deep-link parameter name for a record route (e.g. 'id' → /contacts/:id). */
  param?: string;
}

export interface NavigationContract {
  version: 'app-navigation-v1';
  status: 'derived';
  pattern: NavPattern;
  routes: AppRoute[];
  defaultRoute: string;
  /** The screen ids surfaced in the persistent navigation (top-level destinations). */
  primaryDestinations: string[];
  backBehavior: 'stack-pop' | 'tab-root' | 'none';
  /** Reuse react-router when the project already has it; otherwise a bounded internal
   *  route-state. Either way the routes are REAL — never a dead link to nowhere. */
  usesReactRouter: boolean;
  notes: string[];
}

/* ── Inputs ─────────────────────────────────────────────────────────────────── */

export interface AppArchitectureInput {
  identity?: Partial<FrontendSpecIdentity>;
  /** The raw user prompt — a signal source, never rendered as copy. */
  prompt?: string;
  /** Planned section/screen names from upstream planning (used as screen-name hints
   *  only; the architecture decides the real screen set from the archetype). */
  sectionNames?: string[];
  /** True when the project already depends on react-router (reuse it). Defaults true
   *  (the app is React/Vite; react-router is the conventional router). */
  hasReactRouter?: boolean;
}

/* ── Bounded, deterministic helpers ─────────────────────────────────────────── */

const CAP = 12;
const clean = (xs: Array<string | undefined | null>, cap = CAP): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of xs) {
    const s = (typeof x === 'string' ? x : '').trim();
    if (!s || seen.has(s.toLowerCase())) continue;
    seen.add(s.toLowerCase());
    out.push(s);
    if (out.length >= cap) break;
  }
  return out;
};
const slug = (s: string): string =>
  (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'screen';

/** A single lowercased haystack of every signal we classify from. */
function haystack(input: AppArchitectureInput): string {
  const id = input.identity || {};
  return [
    input.prompt, id.siteType, id.primaryConcept, id.subsector, id.businessModel,
    id.websiteExperienceModel, id.pageScreenModel, id.primaryWebsiteExperience,
    id.primaryConversionIntent, ...(input.sectionNames || []),
  ].map((s) => (typeof s === 'string' ? s : '')).join(' · ').toLowerCase();
}

/* ── Archetype classification (deterministic keyword evidence) ───────────────── */

const ARCHETYPE_SIGNALS: Array<{ archetype: AppArchetype; re: RegExp; weight: number }> = [
  { archetype: 'crm-workspace', re: /\bcrm\b|customer relationship|sales pipeline|\bleads?\b|\bdeals?\b|contacts? (?:manager|list)|account manager/, weight: 3 },
  { archetype: 'finance-app', re: /\bbank(?:ing)?\b|\bwallet\b|\bpayments? app\b|\btransactions?\b|budget(?:ing)?|expenses? tracker|\bportfolio\b|\binvest/, weight: 3 },
  { archetype: 'commerce-app', re: /\bshop(?:ping)?\b|\bstore app\b|\becommerce\b|e-commerce|\bcart\b|checkout|\bcatalog\b|marketplace|product listing/, weight: 3 },
  { archetype: 'fitness-tracker', re: /\bfitness\b|\bworkout\b|\bexercise\b|\bgym\b|\btraining\b|\bruns?\b|steps? tracker|health app|nutrition|calorie/, weight: 3 },
  { archetype: 'booking-service', re: /\bbooking\b|\bappointment\b|\breserv(?:e|ation)\b|\bschedule (?:a|an)\b|\bsalon\b|\bspa\b|\bclinic\b|table booking/, weight: 3 },
  { archetype: 'learning-app', re: /\bcourse\b|\blesson\b|\blearning\b|\bstudy\b|\bquiz\b|\bflashcard\b|\bcurriculum\b|\btutorial app\b|\blms\b/, weight: 3 },
  { archetype: 'content-feed', re: /\bfeed\b|\bsocial\b|\btimeline\b|\bnews app\b|\bstories\b|\bposts?\b|\bcommunity app\b|\bmessaging\b|\bchat app\b/, weight: 2 },
  { archetype: 'productivity-tool', re: /\bto-?do\b|\btask(?:s| manager| app)\b|\bproject management\b|\bkanban\b|\bnotes? app\b|\bplanner\b|\bboard\b|\bissue tracker\b|\bhabit\b/, weight: 2 },
  { archetype: 'analytics-dashboard', re: /\bdashboard\b|\banalytics\b|\bmetrics\b|\bkpis?\b|\breporting\b|\badmin (?:panel|console)\b|\bmonitoring\b|\bconsole\b/, weight: 2 },
];

/** A short, focused prompt with no multi-screen signals → a simple utility. */
const UTILITY_RE = /\b(calculator|converter|timer|stopwatch|counter|generator|picker|clock|flashlight|qr|unit convert|tip calc|bmi)\b/;

function classifyArchetype(h: string): { archetype: AppArchetype; intentionallySimple: boolean } {
  // A clear single-purpose utility wins outright — never inflate it into an app.
  if (UTILITY_RE.test(h)) return { archetype: 'simple-utility', intentionallySimple: true };

  let best: { archetype: AppArchetype; weight: number } | null = null;
  for (const sig of ARCHETYPE_SIGNALS) {
    if (sig.re.test(h) && (!best || sig.weight > best.weight)) {
      best = { archetype: sig.archetype, weight: sig.weight };
    }
  }
  if (best) return { archetype: best.archetype, intentionallySimple: false };

  // No archetype signal AND a very short, single-noun intent → treat as a small
  // utility rather than a generic multi-tab app (respect intentionally-simple).
  const wordCount = h.split(/[^a-z0-9]+/).filter(Boolean).length;
  if (wordCount <= 6) return { archetype: 'simple-utility', intentionallySimple: true };
  return { archetype: 'generic-app', intentionallySimple: false };
}

/* ── Role → relevant lifecycle states (derived, not universal) ───────────────── */

function statesForRole(role: ScreenRole): ScreenState[] {
  switch (role) {
    case 'entry-overview':
    case 'progress-analytics':   return ['loading', 'empty', 'populated'];
    case 'list-browse':
    case 'board-pipeline':       return ['loading', 'empty', 'populated', 'selected'];
    case 'feed':                 return ['loading', 'empty', 'populated'];
    case 'search':               return ['idle', 'loading', 'empty', 'populated'];
    case 'detail':               return ['loading', 'error', 'populated'];
    case 'create-edit-form':     return ['idle', 'saving', 'success', 'error', 'disabled'];
    case 'workflow-flow':        return ['idle', 'saving', 'success', 'error'];
    case 'settings-profile':     return ['idle', 'saving', 'success'];
    case 'utility-primary':      return ['idle', 'populated'];
    default:                     return ['idle', 'populated'];
  }
}

function dataShapeForRole(role: ScreenRole): ScreenDataShape {
  switch (role) {
    case 'entry-overview':
    case 'progress-analytics':   return 'aggregate';
    case 'list-browse':
    case 'board-pipeline':       return 'list';
    case 'feed':                 return 'stream';
    case 'detail':               return 'record';
    case 'create-edit-form':
    case 'workflow-flow':        return 'form';
    case 'settings-profile':     return 'form';
    case 'search':               return 'list';
    case 'utility-primary':      return 'static';
    default:                     return 'static';
  }
}

/* ── Screen blueprints per archetype ─────────────────────────────────────────── */

interface ScreenBlueprint {
  id: string; name: string; role: ScreenRole; userJob: string; entryConditions: string;
  primaryInfo: string; primaryAction: string; secondaryActions?: string[];
  topLevel: boolean; deepLinkParam?: string;
}

function blueprintsFor(archetype: AppArchetype): ScreenBlueprint[] {
  const settings: ScreenBlueprint = {
    id: 'settings', name: 'Settings', role: 'settings-profile',
    userJob: 'adjust preferences and account details', entryConditions: 'from the persistent navigation',
    primaryInfo: 'grouped preference and profile fields', primaryAction: 'Save changes',
    secondaryActions: ['Sign out'], topLevel: true,
  };
  switch (archetype) {
    case 'analytics-dashboard':
      return [
        { id: 'overview', name: 'Overview', role: 'entry-overview', userJob: 'see the health of the system at a glance', entryConditions: 'the default screen on open', primaryInfo: 'headline KPIs, trend charts and recent changes', primaryAction: 'Open a metric', secondaryActions: ['Change date range', 'Filter'], topLevel: true },
        { id: 'reports', name: 'Reports', role: 'list-browse', userJob: 'find a specific report or segment', entryConditions: 'from the navigation', primaryInfo: 'a searchable list of saved reports', primaryAction: 'Open report', secondaryActions: ['Search', 'Sort'], topLevel: true },
        { id: 'report-detail', name: 'Report', role: 'detail', userJob: 'drill into one report’s breakdown', entryConditions: 'from a report in the list or an overview metric', primaryInfo: 'the report’s dimensions, table and chart', primaryAction: 'Export', secondaryActions: ['Change breakdown'], topLevel: false, deepLinkParam: 'id' },
        settings,
      ];
    case 'crm-workspace':
      return [
        { id: 'pipeline', name: 'Pipeline', role: 'board-pipeline', userJob: 'move deals through stages', entryConditions: 'the default operator screen', primaryInfo: 'deal cards grouped by stage', primaryAction: 'Add deal', secondaryActions: ['Filter', 'Search'], topLevel: true },
        { id: 'contacts', name: 'Contacts', role: 'list-browse', userJob: 'find and manage a contact', entryConditions: 'from the navigation', primaryInfo: 'a searchable, sortable contact list', primaryAction: 'Add contact', secondaryActions: ['Search', 'Filter'], topLevel: true },
        { id: 'contact-detail', name: 'Contact', role: 'detail', userJob: 'review a contact’s history and act on it', entryConditions: 'from the contact list or a deal', primaryInfo: 'contact profile, related deals and activity timeline', primaryAction: 'Log activity', secondaryActions: ['Edit', 'Add deal'], topLevel: false, deepLinkParam: 'id' },
        { id: 'contact-edit', name: 'Edit contact', role: 'create-edit-form', userJob: 'create or update a contact record', entryConditions: 'from “Add contact” or “Edit”', primaryInfo: 'the editable contact fields', primaryAction: 'Save contact', secondaryActions: ['Cancel'], topLevel: false },
        settings,
      ];
    case 'commerce-app':
      return [
        { id: 'catalog', name: 'Shop', role: 'list-browse', userJob: 'browse products and find something to buy', entryConditions: 'the default screen on open', primaryInfo: 'a product grid with categories and filters', primaryAction: 'Open product', secondaryActions: ['Search', 'Filter'], topLevel: true },
        { id: 'product', name: 'Product', role: 'detail', userJob: 'evaluate a product and add it to the cart', entryConditions: 'from the catalog or search', primaryInfo: 'product gallery, price, options and description', primaryAction: 'Add to cart', secondaryActions: ['Save for later'], topLevel: false, deepLinkParam: 'id' },
        { id: 'cart', name: 'Cart', role: 'list-browse', userJob: 'review the items to purchase', entryConditions: 'from the cart icon or “Add to cart”', primaryInfo: 'line items, quantities and order total', primaryAction: 'Checkout', secondaryActions: ['Edit quantity', 'Remove'], topLevel: true },
        { id: 'checkout', name: 'Checkout', role: 'workflow-flow', userJob: 'complete the purchase (simulated)', entryConditions: 'from the cart', primaryInfo: 'shipping and payment steps (front-end only, no real charge)', primaryAction: 'Place order', secondaryActions: ['Back to cart'], topLevel: false },
        { id: 'orders', name: 'Orders', role: 'list-browse', userJob: 'see past orders', entryConditions: 'from the navigation', primaryInfo: 'a list of prior orders and their status', primaryAction: 'Open order', secondaryActions: [], topLevel: true },
        settings,
      ];
    case 'fitness-tracker':
      return [
        { id: 'today', name: 'Today', role: 'entry-overview', userJob: 'know what to do today and start it', entryConditions: 'the default screen on open', primaryInfo: 'today’s plan, streak and quick stats', primaryAction: 'Start workout', secondaryActions: ['Log manually'], topLevel: true },
        { id: 'library', name: 'Workouts', role: 'list-browse', userJob: 'pick a workout to do', entryConditions: 'from the navigation', primaryInfo: 'a browsable list of workouts by type', primaryAction: 'Open workout', secondaryActions: ['Filter', 'Search'], topLevel: true },
        { id: 'session', name: 'Session', role: 'workflow-flow', userJob: 'follow an active workout set by set', entryConditions: 'from “Start workout”', primaryInfo: 'the current exercise, timer and set progress', primaryAction: 'Complete set', secondaryActions: ['Skip', 'End session'], topLevel: false, deepLinkParam: 'id' },
        { id: 'progress', name: 'Progress', role: 'progress-analytics', userJob: 'see improvement over time', entryConditions: 'from the navigation', primaryInfo: 'trend charts for volume, streak and personal records', primaryAction: 'Change metric', secondaryActions: [], topLevel: true },
        settings,
      ];
    case 'booking-service':
      return [
        { id: 'services', name: 'Services', role: 'list-browse', userJob: 'browse services to book', entryConditions: 'the default screen on open', primaryInfo: 'a list of services with duration and price', primaryAction: 'Open service', secondaryActions: ['Search', 'Filter'], topLevel: true },
        { id: 'service-detail', name: 'Service', role: 'detail', userJob: 'evaluate a service and start a booking', entryConditions: 'from the services list', primaryInfo: 'service description, provider and availability', primaryAction: 'Book now', secondaryActions: ['See reviews'], topLevel: false, deepLinkParam: 'id' },
        { id: 'booking', name: 'Book', role: 'workflow-flow', userJob: 'choose a time and confirm (simulated)', entryConditions: 'from “Book now”', primaryInfo: 'date/time picker and confirmation summary (front-end only)', primaryAction: 'Confirm booking', secondaryActions: ['Back'], topLevel: false },
        { id: 'my-bookings', name: 'My bookings', role: 'list-browse', userJob: 'see upcoming and past bookings', entryConditions: 'from the navigation', primaryInfo: 'a list of the user’s bookings and status', primaryAction: 'Open booking', secondaryActions: ['Cancel'], topLevel: true },
        settings,
      ];
    case 'productivity-tool':
      return [
        { id: 'board', name: 'Board', role: 'board-pipeline', userJob: 'organize and move work items', entryConditions: 'the default screen on open', primaryInfo: 'task cards grouped by status', primaryAction: 'Add task', secondaryActions: ['Filter', 'Search'], topLevel: true },
        { id: 'list', name: 'List', role: 'list-browse', userJob: 'work through items linearly', entryConditions: 'from the navigation', primaryInfo: 'a filterable list of items', primaryAction: 'Add item', secondaryActions: ['Sort', 'Filter'], topLevel: true },
        { id: 'item', name: 'Item', role: 'detail', userJob: 'review and update one item', entryConditions: 'from the board or list', primaryInfo: 'item description, checklist and metadata', primaryAction: 'Mark done', secondaryActions: ['Edit', 'Delete'], topLevel: false, deepLinkParam: 'id' },
        { id: 'item-edit', name: 'Edit item', role: 'create-edit-form', userJob: 'create or edit an item', entryConditions: 'from “Add task” or “Edit”', primaryInfo: 'the editable item fields', primaryAction: 'Save', secondaryActions: ['Cancel'], topLevel: false },
        settings,
      ];
    case 'content-feed':
      return [
        { id: 'feed', name: 'Feed', role: 'feed', userJob: 'catch up on new content', entryConditions: 'the default screen on open', primaryInfo: 'a scrollable stream of posts', primaryAction: 'Open post', secondaryActions: ['Refresh', 'Like'], topLevel: true },
        { id: 'post', name: 'Post', role: 'detail', userJob: 'read one post and its replies', entryConditions: 'from the feed', primaryInfo: 'the full post and its thread', primaryAction: 'Reply', secondaryActions: ['Like', 'Share'], topLevel: false, deepLinkParam: 'id' },
        { id: 'saved', name: 'Saved', role: 'list-browse', userJob: 'revisit saved content', entryConditions: 'from the navigation', primaryInfo: 'a list of saved posts', primaryAction: 'Open post', secondaryActions: [], topLevel: true },
        { id: 'profile', name: 'Profile', role: 'settings-profile', userJob: 'view and edit the profile', entryConditions: 'from the navigation', primaryInfo: 'profile summary and preferences', primaryAction: 'Edit profile', secondaryActions: ['Sign out'], topLevel: true },
      ];
    case 'learning-app':
      return [
        { id: 'courses', name: 'Courses', role: 'list-browse', userJob: 'choose what to learn', entryConditions: 'the default screen on open', primaryInfo: 'a list of courses with progress', primaryAction: 'Open course', secondaryActions: ['Search', 'Filter'], topLevel: true },
        { id: 'lesson', name: 'Lesson', role: 'workflow-flow', userJob: 'work through a lesson step by step', entryConditions: 'from a course', primaryInfo: 'the current lesson content and checkpoint', primaryAction: 'Continue', secondaryActions: ['Back', 'Mark complete'], topLevel: false, deepLinkParam: 'id' },
        { id: 'progress', name: 'Progress', role: 'progress-analytics', userJob: 'track completion and streaks', entryConditions: 'from the navigation', primaryInfo: 'completion, streak and achievements', primaryAction: 'Resume learning', secondaryActions: [], topLevel: true },
        settings,
      ];
    case 'finance-app':
      return [
        { id: 'accounts', name: 'Accounts', role: 'entry-overview', userJob: 'see balances at a glance', entryConditions: 'the default screen on open', primaryInfo: 'account balances and recent activity', primaryAction: 'Open account', secondaryActions: ['Add account'], topLevel: true },
        { id: 'transactions', name: 'Transactions', role: 'list-browse', userJob: 'review and categorize spending', entryConditions: 'from an account or the navigation', primaryInfo: 'a searchable, filterable transaction list', primaryAction: 'Open transaction', secondaryActions: ['Search', 'Filter'], topLevel: true },
        { id: 'transfer', name: 'Transfer', role: 'workflow-flow', userJob: 'move money between accounts (simulated)', entryConditions: 'from “Transfer”', primaryInfo: 'from/to and amount steps (front-end only, no real transfer)', primaryAction: 'Review transfer', secondaryActions: ['Cancel'], topLevel: false },
        { id: 'insights', name: 'Insights', role: 'progress-analytics', userJob: 'understand spending trends', entryConditions: 'from the navigation', primaryInfo: 'category breakdowns and month-over-month trends', primaryAction: 'Change period', secondaryActions: [], topLevel: true },
        settings,
      ];
    case 'simple-utility':
      return [
        { id: 'main', name: 'Home', role: 'utility-primary', userJob: 'use the single core function', entryConditions: 'the only screen on open', primaryInfo: 'the tool’s inputs and its live result', primaryAction: 'Run', secondaryActions: ['Reset'], topLevel: true },
      ];
    default:
      return [
        { id: 'home', name: 'Home', role: 'entry-overview', userJob: 'reach the app’s core value', entryConditions: 'the default screen on open', primaryInfo: 'the primary content of the app', primaryAction: 'Continue', secondaryActions: [], topLevel: true },
        { id: 'detail', name: 'Detail', role: 'detail', userJob: 'focus on one item', entryConditions: 'from the home screen', primaryInfo: 'the selected item’s content', primaryAction: 'Act', secondaryActions: ['Back'], topLevel: false, deepLinkParam: 'id' },
        { id: 'settings', name: 'Settings', role: 'settings-profile', userJob: 'adjust preferences', entryConditions: 'from the navigation', primaryInfo: 'preference fields', primaryAction: 'Save', secondaryActions: [], topLevel: true },
      ];
  }
}

/* ── Shell selection (operator tools = sidebar; consumer apps = tabs) ─────────── */

function shellFor(archetype: AppArchetype, topLevelCount: number): AppShell {
  if (archetype === 'simple-utility' || topLevelCount <= 1) return 'single-screen';
  switch (archetype) {
    case 'analytics-dashboard':
    case 'crm-workspace':
    case 'productivity-tool':
    case 'finance-app':
      return 'sidebar-app';
    default:
      return 'tabbed-app';
  }
}

function densityFor(archetype: AppArchetype): 'compact' | 'comfortable' {
  return archetype === 'analytics-dashboard' || archetype === 'crm-workspace'
    || archetype === 'productivity-tool' || archetype === 'finance-app'
    ? 'compact' : 'comfortable';
}

/* ── Derivation: AppArchitectureContract ─────────────────────────────────────── */

/** A tiny title-caser for screen-name hints borrowed from planning section names. */
function nameHint(sectionNames: string[] | undefined, id: string, fallback: string): string {
  const hit = (sectionNames || []).find((n) => slug(n) === id || slug(n).includes(id));
  return (hit && hit.trim()) || fallback;
}

export function deriveAppArchitectureContract(
  input: AppArchitectureInput | undefined,
): AppArchitectureContract {
  const safeInput: AppArchitectureInput = input || {};
  try {
    const h = haystack(safeInput);
    const { archetype, intentionallySimple } = classifyArchetype(h);
    const blueprints = blueprintsFor(archetype);

    const screens: AppScreenSpec[] = blueprints.map((b, i) => ({
      id: b.id,
      name: nameHint(safeInput.sectionNames, b.id, b.name),
      role: b.role,
      userJob: b.userJob,
      entryConditions: b.entryConditions,
      primaryInfo: b.primaryInfo,
      primaryAction: b.primaryAction,
      secondaryActions: clean(b.secondaryActions || [], 4),
      dataShape: dataShapeForRole(b.role),
      states: statesForRole(b.role),
      isEntry: i === 0,
      topLevel: b.topLevel,
      deepLinkParam: b.deepLinkParam,
    }));

    const entryScreenId = screens[0]?.id || 'home';
    const topLevelCount = screens.filter((s) => s.topLevel).length;
    const shell = shellFor(archetype, topLevelCount);

    // Relationships: every non-top-level screen is reached FROM the nearest preceding
    // top-level screen (its parent list/overview); top-level peers relate via the nav.
    const relationships: ScreenRelationship[] = [];
    let lastTopLevel = entryScreenId;
    for (const s of screens) {
      if (s.topLevel) { lastTopLevel = s.id; continue; }
      relationships.push({ from: lastTopLevel, to: s.id, via: s.entryConditions });
    }

    // Flows: any workflow-flow / form screen defines a flow from its parent through it.
    const flows: AppFlow[] = screens
      .filter((s) => s.role === 'workflow-flow' || s.role === 'create-edit-form')
      .map((s) => {
        const parent = relationships.find((r) => r.to === s.id)?.from || entryScreenId;
        return { id: `flow-${s.id}`, name: `${s.name} flow`, screenIds: clean([parent, s.id]) };
      });

    const notes = clean([
      `Archetype ${archetype} → ${screens.length} screen(s), ${topLevelCount} top-level, ${shell} shell.`,
      intentionallySimple ? 'Intentionally simple — do not add tabs/sidebars or extra screens.' : undefined,
      'Screens simulate state on the front end only; never claim a real backend save/charge/account.',
    ], 6);

    return {
      version: 'app-architecture-v1',
      status: 'derived',
      archetype,
      shell,
      density: densityFor(archetype),
      intentionallySimple,
      screens,
      entryScreenId,
      relationships,
      flows,
      notes,
    };
  } catch {
    // Fail-open: a minimal, honest single-screen architecture.
    return {
      version: 'app-architecture-v1', status: 'derived', archetype: 'generic-app',
      shell: 'single-screen', density: 'comfortable', intentionallySimple: true,
      screens: [{
        id: 'home', name: 'Home', role: 'entry-overview', userJob: 'reach the app’s core value',
        entryConditions: 'the default screen', primaryInfo: 'the primary content', primaryAction: 'Continue',
        secondaryActions: [], dataShape: 'static', states: ['idle', 'populated'], isEntry: true, topLevel: true,
      }],
      entryScreenId: 'home', relationships: [], flows: [], notes: ['Failed open to a single-screen app.'],
    };
  }
}

/* ── Derivation: NavigationContract ──────────────────────────────────────────── */

function navPatternForShell(shell: AppShell, topLevelCount: number): NavPattern {
  switch (shell) {
    case 'sidebar-app': return 'sidebar';
    case 'tabbed-app':  return topLevelCount > 5 ? 'top-tabs' : 'bottom-tabs';
    case 'stack-app':   return 'stack';
    default:            return 'single';
  }
}

export function deriveNavigationContract(
  architecture: AppArchitectureContract | undefined,
  opts?: { hasReactRouter?: boolean },
): NavigationContract | undefined {
  if (!architecture || architecture.status !== 'derived' || !architecture.screens.length) return undefined;
  try {
    const topLevel = architecture.screens.filter((s) => s.topLevel);
    const pattern = navPatternForShell(architecture.shell, topLevel.length);

    // One REAL route per screen. Record routes carry a deep-link param so a detail
    // screen is addressable; nested screens are children of their parent path where
    // one exists, else top-level.
    const routes: AppRoute[] = architecture.screens.map((s) => {
      const base = `/${slug(s.id)}`;
      const path = s.deepLinkParam ? `${base}/:${s.deepLinkParam}` : base;
      return { path, screenId: s.id, isDefault: s.id === architecture.entryScreenId, param: s.deepLinkParam };
    });
    const defaultRoute = routes.find((r) => r.isDefault)?.path || routes[0]?.path || '/';

    const backBehavior: NavigationContract['backBehavior'] =
      pattern === 'single' ? 'none'
      : pattern === 'sidebar' ? 'stack-pop'
      : 'tab-root';

    const notes = clean([
      `${pattern} navigation across ${topLevel.length} top-level destination(s).`,
      architecture.screens.some((s) => s.deepLinkParam) ? 'Record screens are deep-linkable (param route).' : undefined,
      'Every route resolves to a declared screen — no dead links or nav to nowhere.',
    ], 5);

    return {
      version: 'app-navigation-v1',
      status: 'derived',
      pattern,
      routes,
      defaultRoute,
      primaryDestinations: topLevel.map((s) => s.id),
      backBehavior,
      // React/Vite apps conventionally use react-router; reuse it unless told otherwise.
      usesReactRouter: opts?.hasReactRouter !== false,
      notes,
    };
  } catch {
    return undefined;
  }
}

/* ── Bounded builder blocks (injected into the app generation request) ───────── */

const RENDER_CEIL = 2800;
function bound(lines: string[]): string[] {
  const out: string[] = [];
  let total = 0;
  for (const l of lines) {
    total += l.length + 1;
    if (total > RENDER_CEIL) break;
    out.push(l);
  }
  return out;
}

/** Render the App Architecture as a bounded, implementable builder block. */
export function renderAppArchitectureBlock(c: AppArchitectureContract | undefined): string[] {
  if (!c || c.status !== 'derived' || !c.screens.length) return [];
  const lines: string[] = [
    'APP ARCHITECTURE (binding — build these SCREENS, not marketing sections):',
    `Archetype: ${c.archetype} · shell: ${c.shell} · density: ${c.density}${c.intentionallySimple ? ' · intentionally simple' : ''}.`,
    `Entry screen: ${c.entryScreenId}.`,
    'Screens (id — role — user job — primary action — relevant states):',
    ...c.screens.map((s) =>
      `- ${s.id} — ${s.role} — ${s.userJob} — primary: ${s.primaryAction} — states: ${s.states.join('/')}${s.topLevel ? '' : ' (pushed)'}`),
  ];
  if (c.flows.length) lines.push(`Flows: ${c.flows.map((f) => `${f.name} [${f.screenIds.join(' → ')}]`).join('; ')}.`);
  lines.push('Only build the states listed for each screen — do not add a loading/empty state where none is listed.');
  lines.push('');
  return bound(lines);
}

/** Render the Navigation contract as a bounded builder block. */
export function renderNavigationBlock(n: NavigationContract | undefined): string[] {
  if (!n || n.status !== 'derived' || !n.routes.length) return [];
  const lines: string[] = [
    'APP NAVIGATION (binding — real client routing, never dead links):',
    `Pattern: ${n.pattern} · router: ${n.usesReactRouter ? 'react-router' : 'internal route-state'} · back: ${n.backBehavior}.`,
    `Default route: ${n.defaultRoute}.`,
    `Persistent destinations: ${n.primaryDestinations.join(', ')}.`,
    'Routes:',
    ...n.routes.map((r) => `- ${r.path} → ${r.screenId}${r.isDefault ? ' (default)' : ''}`),
    'Every navigation control MUST target one of these routes; a control with no destination is a defect.',
    '',
  ];
  return bound(lines);
}
