/**
 * App Visual Adapter (Phase 4) — the app-surface visual authority. It REUSES the
 * shared VisualSystemContract as the token/brand/style source of truth (colour
 * roles, typography, surfaces) and never redefines colours or type. It owns ONLY
 * app-surface concepts the web visual system has no vocabulary for: the application
 * shell, app bar, nav rail / bottom tabs, density, touch/click targets, panel
 * hierarchy, modal/sheet treatment, device (desktop/tablet/narrow) behavior, and —
 * critically — SCREEN composition that replaces the scrolling section/hero model.
 *
 * The first viewport of an app screen is an operational surface (dashboard / list /
 * workspace / task), NOT an automatic giant marketing hero. A marketing-style hero
 * is valid only for a genuine onboarding/marketing screen.
 *
 * Image strategy is context-aware: internal/functional apps (CRM, analytics,
 * ecommerce admin, productivity) prefer icons / charts / avatars over full-bleed
 * stock photography; consumer apps (fitness, media, booking) may use photography.
 *
 * Pure, deterministic, network-free, bounded, JSON-serializable, fail-open.
 */
import type { AppArchitectureContract, AppShellType, AppType, ScreenRole } from '@/lib/appArchitecture';
import type { VisualSystemContract } from '@/lib/webBuildVisualSystem';

export type DeviceTarget = 'desktop' | 'tablet' | 'narrow';
export type AppDensity = 'comfortable' | 'compact' | 'dense';
export type ModalTreatment = 'dialog' | 'sheet' | 'drawer';

export interface AppShellSpec {
  shell: AppShellType;
  /** The persistent nav component that realizes the shell. */
  navComponent: 'sidebar' | 'bottom-tabs' | 'top-nav' | 'none';
  /** The top app bar treatment. */
  appBar: 'top-bar' | 'contextual' | 'none';
  density: AppDensity;
  /** Minimum interactive target size (px) for the primary device. */
  touchTargetPx: number;
  /** How chrome and content share the surface (content must dominate). */
  contentVsChrome: string;
  /** How create/edit surfaces present. */
  modalTreatment: ModalTreatment;
}

export interface ScreenComposition {
  screenId: string;
  role: ScreenRole;
  /** What the FIRST viewport prioritizes — an operational surface, not a hero. */
  firstViewport: string;
  /** The dominant zone of the screen. */
  primaryZone: string;
  /** Supporting zones around the primary zone. */
  supportingZones: string[];
  /** The nav/app-bar chrome for this screen. */
  chrome: string;
  /** How the primary action is made prominent above secondary ones. */
  interactionHierarchy: string;
}

export interface AppImageStrategy {
  /** Whether real photography is appropriate for this product. */
  usePhotography: boolean;
  rationale: string;
  /** Preferred visual vocabulary in priority order. */
  preferredVisuals: string[];
  /** Visual treatments to avoid for this app type. */
  forbid: string[];
}

/**
 * Premium component-quality contract (UI Quality Phase 1). App-specific ADAPTATION of the
 * shared visual system — it adds NO colour/type tokens (those stay in VisualSystemContract);
 * it states how the app's controls must be built and behave so generated UI reads as
 * intentionally designed software, not browser-default filler. Bounded + deterministic.
 */
export interface AppComponentQuality {
  /** How to build controls from the available dependencies — never a new package. */
  buildStrategy: string;
  /** Per control-family quality obligations (compact, one line per family). */
  controls: string[];
  /** Interaction states every interactive control must express (role-appropriate, not forced). */
  interactionStates: string;
  /** Surface / elevation obligations — themed popovers, no theme-mismatched surfaces. */
  surfaces: string;
}

/**
 * Context-aware visual-hierarchy contract (UI Quality Phase 2). It states how to USE the shared
 * brand tokens well — layering, accent/semantic discipline, typography scale, density and chart
 * presentation — WITHOUT imposing any single house palette or one universal look. Guidance varies
 * by app class (functional / consumer / utility) so apps read as art-directed, not generic.
 */
export interface AppVisualHierarchy {
  /** Background → surface → raised → border → text → muted ladder from the shared tokens. */
  layering: string;
  /** Accent + semantic + selected/hover/focus usage discipline (no forced palette). */
  colorUsage: string;
  /** Typography hierarchy for this app class (title / heading / metric / label / metadata). */
  typography: string;
  /** Context-aware density intent for this app type. */
  density: string;
  /** Surface composition — when to use flat groups/dividers/inset instead of a card wall. */
  surfaceComposition: string;
  /** Chart / data-viz presentation obligations (apply only where charts exist). */
  dataViz: string;
}

/**
 * Interaction polish contract (UI Quality Phase 3). The VISUAL/motion layer only — the functional
 * control→handler→state→consequence wiring stays owned by the screen-depth contract (no second
 * interaction engine). It adds restrained micro-interactions, honest local feedback and navigation
 * active-state polish so a built app feels intentional when operated, not just in a screenshot.
 */
export interface AppInteractionPolish {
  /** Restrained, reduced-motion-aware micro-interactions (no new dependency). */
  motion: string;
  /** Visible, honest local feedback (defers functional wiring to screen depth). */
  feedback: string;
  /** Navigation polish — always-clear active route/tab/sidebar item + responsive adaptation. */
  navigation: string;
}

export interface AppVisualContract {
  version: 'app-visual-v1';
  appType: AppType;
  shell: AppShellSpec;
  /** Ordered device targets (first = primary). */
  devices: DeviceTarget[];
  screenComposition: ScreenComposition[];
  imageStrategy: AppImageStrategy;
  /** Premium control/component quality obligations (UI Quality Phase 1). */
  componentQuality: AppComponentQuality;
  /** Context-aware visual hierarchy / palette-usage / density / chart guidance (UI Quality Phase 2). */
  hierarchy: AppVisualHierarchy;
  /** Interaction / micro-polish / feedback / navigation polish (UI Quality Phase 3). */
  interactionPolish: AppInteractionPolish;
  /** App UI anti-patterns to actively avoid. */
  antiPatterns: string[];
  /** How this adapter reuses the shared visual system (no new tokens). */
  tokenReuse: string;
  notes: string[];
}

/* ── Classification helpers ──────────────────────────────────────────────────── */

const FUNCTIONAL: ReadonlySet<AppType> = new Set<AppType>(['crm', 'analytics-dashboard', 'ecommerce-admin', 'productivity']);
const CONSUMER: ReadonlySet<AppType> = new Set<AppType>(['fitness', 'media-content', 'booking', 'messaging']);

function shellToNav(shell: AppShellType): AppShellSpec['navComponent'] {
  switch (shell) {
    case 'sidebar': return 'sidebar';
    case 'tab-bar': return 'bottom-tabs';
    case 'top-nav': return 'top-nav';
    default: return 'none';
  }
}

function densityFor(appType: AppType): AppDensity {
  if (appType === 'analytics-dashboard' || appType === 'ecommerce-admin' || appType === 'crm') return 'compact';
  if (appType === 'utility') return 'comfortable';
  return 'comfortable';
}

/** Primary device order. Functional/desktop tools lead with desktop; consumer apps
 *  lead with a narrow (phone-width) layout; utilities are narrow-first & simple. */
function devicesFor(appType: AppType): DeviceTarget[] {
  if (FUNCTIONAL.has(appType) && appType !== 'productivity') return ['desktop', 'tablet', 'narrow'];
  if (appType === 'utility') return ['narrow', 'tablet', 'desktop'];
  if (CONSUMER.has(appType) || appType === 'productivity') return ['narrow', 'tablet', 'desktop'];
  return ['desktop', 'tablet', 'narrow'];
}

function touchTargetFor(shell: AppShellType): number {
  return shell === 'tab-bar' ? 44 : 36;
}

/* ── Screen composition (replaces section composition) ───────────────────────── */

function firstViewportForRole(role: ScreenRole, appType: AppType): string {
  switch (role) {
    case 'dashboard':
    case 'analytics':
      return 'An operational dashboard surface: KPI/metric tiles and the primary chart above the fold — never a marketing hero.';
    case 'list':
      return 'The content list itself with its search/filter controls in view — not a hero banner.';
    case 'detail':
      return 'The item’s key information and primary action, with a clear back path.';
    case 'home':
      return appType === 'utility'
        ? 'The tool’s primary input and live result.'
        : 'The primary workspace / today surface and entry actions — not a marketing hero.';
    case 'tool':
      return 'The tool’s inputs and its live result.';
    case 'calendar':
    case 'booking':
      return 'The calendar/agenda surface with the current period in view.';
    case 'messaging':
      return 'The conversation list or the active thread.';
    case 'create':
    case 'edit':
      return 'The form fields, presented as a focused sheet/dialog over the context.';
    case 'settings':
      return 'The grouped settings, first group in view.';
    case 'onboarding':
      return 'A focused onboarding step (a marketing-style hero is acceptable here only).';
    default:
      return 'The screen’s primary content surface.';
  }
}

function compositionForScreen(screenId: string, role: ScreenRole, shell: AppShellType, appType: AppType): ScreenComposition {
  const chrome = shell === 'sidebar'
    ? 'Persistent left nav rail + a contextual top bar.'
    : shell === 'tab-bar'
      ? 'Bottom tab bar + a compact top bar per screen.'
      : shell === 'top-nav'
        ? 'A top navigation bar.'
        : 'Minimal chrome; back-driven navigation.';
  const supporting: string[] = role === 'dashboard' || role === 'analytics'
    ? ['Secondary metrics / recent activity', 'Filters or period controls']
    : role === 'list'
      ? ['Filter/sort controls', 'Bulk or add actions']
      : role === 'detail'
        ? ['Related/contextual information', 'Secondary actions']
        : ['Supporting content', 'Secondary actions'];
  return {
    screenId,
    role,
    firstViewport: firstViewportForRole(role, appType),
    primaryZone: role === 'dashboard' || role === 'analytics'
      ? 'The metric/overview grid and primary chart'
      : role === 'list'
        ? 'The list/table of items'
        : role === 'detail'
          ? 'The item detail body'
          : 'The screen’s primary content',
    supportingZones: supporting,
    chrome,
    interactionHierarchy: 'One clearly dominant primary action; secondary actions are visually subordinate — avoid many equally-weighted buttons.',
  };
}

/* ── Image strategy (context-aware) ──────────────────────────────────────────── */

function imageStrategyFor(appType: AppType): AppImageStrategy {
  if (FUNCTIONAL.has(appType)) {
    return {
      usePhotography: false,
      rationale: 'An internal/functional tool communicates through data, not editorial photography.',
      preferredVisuals: ['icons', 'charts', 'avatars', 'status/label chips'],
      forbid: ['full-bleed hero photography', 'decorative stock imagery', 'marketing lifestyle photos'],
    };
  }
  if (appType === 'utility') {
    return {
      usePhotography: false,
      rationale: 'A focused utility needs clarity, not imagery.',
      preferredVisuals: ['icons', 'result typography'],
      forbid: ['hero photography', 'decorative imagery'],
    };
  }
  if (CONSUMER.has(appType)) {
    return {
      usePhotography: true,
      rationale: 'A consumer app benefits from contextual photography where it serves content (thumbnails, covers, avatars) — used purposefully, not as a landing hero.',
      preferredVisuals: ['content thumbnails', 'avatars', 'icons', 'purposeful photography'],
      forbid: ['giant full-bleed marketing hero', 'stock imagery used as filler'],
    };
  }
  return {
    usePhotography: false,
    rationale: 'Default to icons/illustration unless the product clearly calls for photography.',
    preferredVisuals: ['icons', 'illustration'],
    forbid: ['full-bleed marketing hero'],
  };
}

/* ── Component quality (UI Quality Phase 1) ──────────────────────────────────── */

/** The premium component-quality contract. Deterministic; the only variation is a
 *  minimal-utility relaxation and a dark-theme emphasis for popup surfaces. It names the
 *  ALREADY-AVAILABLE primitives (Radix UI / cva / clsx / tailwind-merge / lucide-react) so
 *  the model builds themed controls without any new dependency. */
function componentQualityFor(appType: AppType, colorMode: 'light' | 'dark' | 'mixed' | undefined): AppComponentQuality {
  const minimal = appType === 'utility';
  const darkPopup = colorMode === 'dark'
    ? ' In this dark app a control must NEVER open an unrelated light/white browser-default surface.'
    : '';
  const buildStrategy = minimal
    ? 'Build controls from the shared design tokens. A raw native control is acceptable here, but its closed control must fully inherit the theme (surface, border, text, radius, focus ring) — no unstyled browser-default look.'
    : `Build controls from the shared design tokens using the ALREADY-AVAILABLE primitives — Radix UI (@radix-ui/react-*), class-variance-authority, clsx, tailwind-merge, lucide-react — never add a dependency. Where a browser-native popup (select/menu) would break the premium theme, use a Radix listbox/menu so the OPEN surface is themed too; a raw native control is acceptable only when its trigger AND surface fully inherit the theme.${darkPopup}`;
  const controls = [
    'Buttons: distinct primary / secondary / ghost / destructive variants, exactly one dominant primary per view; consistent height, padding, radius; icon+label aligned — not every button styled as primary.',
    'Inputs: themed field surface, label + placeholder hierarchy, focus ring, and an error/invalid state; height consistent with buttons.',
    'Select / dropdown: a themed trigger AND a themed menu surface, with selected + active-option states, keyboard operation and dismiss — never a white browser-default popup inside a themed app.',
    'Tabs / segmented controls: one unmistakable active state, hover/focus, consistent geometry, and content that actually switches.',
    'Toggles / checkboxes / radios: clear on/off + disabled state, adequate target size, integrated with the theme.',
    'Menus / popovers / modals / sheets: an elevated surface clearly separated from the canvas and derived from the app palette, with dismiss + focus handling — no random white surface in a dark UI.',
    'Tables: row hover, a selected state when rows are selectable, integrated search/filter controls, and consistent row-action affordances.',
  ];
  return {
    buildStrategy,
    controls,
    interactionStates: 'Every interactive control expresses the states its role needs — hover, focus-visible ring, active/pressed, selected, disabled — applied CONSISTENTLY across the app (matching height, radius and focus treatment). Do not force every state onto simple controls.',
    surfaces: 'Elevation and surface hierarchy are theme-derived and consistent: every dropdown, menu and dialog surface inherits the app palette rather than a browser default. Reserve borders + radius for real grouping — do not wrap every element in its own card.',
  };
}

/* ── Visual hierarchy (UI Quality Phase 2) ───────────────────────────────────── */

/** Context-aware hierarchy guidance. It references the SHARED tokens (never a fixed palette)
 *  and varies by app class so a CRM reads dense-but-legible, a fitness app reads breathable and
 *  expressive, and a utility stays minimal — proving the guidance is not one universal template. */
function hierarchyFor(appType: AppType, colorMode: 'light' | 'dark' | 'mixed' | undefined): AppVisualHierarchy {
  const functional = FUNCTIONAL.has(appType);
  const consumer = CONSUMER.has(appType);
  const utility = appType === 'utility';
  const density = utility
    ? 'Minimal density: one clear task per view with generous surrounding space — never a dashboard grid.'
    : functional
      ? 'Information-dense but legible: tighter rows and compact controls for scanning, hierarchy carried by weight and spacing (not just more cards).'
      : consumer
        ? 'Breathable and expressive: larger touch targets, more whitespace, imagery/typography allowed to carry personality where it serves content.'
        : 'Balanced density: comfortable spacing with a clear primary focus per screen.';
  const typography = utility
    ? 'A restrained scale: one clear result/value emphasized, small supporting labels — no marketing headline.'
    : functional
      ? 'Distinct steps for screen title, section heading, metric numerals, table/list text, labels and metadata — never one size/weight everywhere, and no oversized marketing headline in a functional app.'
      : 'A confident title and section rhythm with expressive display type where it fits the product, plus legible body/labels — still not a marketing landing headline.';
  return {
    layering: `Establish a clear background → surface → raised-surface → border → text → muted-text ladder from the shared ${colorMode || 'themed'} tokens so panels read as distinct depths, not one flat field. Avoid gray-on-gray where nothing separates.`,
    colorUsage: 'Spend the shared accent on the single most important action/metric per view, not on everything; reserve semantic success/warning/error for real status; give selected / hover / focus distinct but on-palette treatments; keep muted/secondary text at a legible contrast; do not introduce random accent colours or oversaturated neon unless the brief calls for it.',
    typography,
    density,
    surfaceComposition: 'Not every block needs a border + rounded card. Use flat groups, dividers, section headers, inset surfaces and borderless metric groups where they read better — avoid "card soup" where every element is an equally-prominent card. Give each screen one clearly dominant panel.',
    dataViz: 'Where charts exist: label axes/series and give enough context to read the metric; use a coherent chart palette derived from the shared accent/tokens (never a default rainbow); choose a chart type that fits the data; size responsively; and place the chart in a titled panel integrated with the surface hierarchy — never a bare default-library example with meaningless numbers. Prefer the available recharts or lightweight SVG/CSS; do not add a charting dependency.',
  };
}

/* ── Interaction polish (UI Quality Phase 3) ─────────────────────────────────── */

/** The visual/motion polish contract. Deterministic and compact; it explicitly defers the
 *  functional wiring to the screen-depth authority so there is no duplicated interaction engine. */
const INTERACTION_POLISH: AppInteractionPolish = {
  motion: 'Add restrained, purposeful transitions ONLY where they aid comprehension — tab/route change, dropdown/menu/sheet open, hover elevation, button press, list selection, progress. Keep them short (~150–250ms), never block interaction, and respect prefers-reduced-motion. Do not animate everything or add long/distracting motion. Use CSS transitions or the available framer-motion — no new dependency.',
  feedback: 'Every control that performs a local action shows a visible, HONEST consequence (saved/added/removed/updated, filtered results change, toggled state flips) — never a faked remote success. The functional wiring is owned by the screen-depth contract; this is the polished, visible result.',
  navigation: 'The current route / active tab / active sidebar item is ALWAYS clearly indicated (not hover alone); nav items carry hover + focus-visible states; navigation adapts responsively (sidebar → drawer or bottom tabs at narrow widths). No dead nav.',
};

const APP_ANTI_PATTERNS: string[] = [
  'A giant marketing hero or oversized headline as the first viewport of a functional screen.',
  'Excessive landing-page whitespace between operational elements.',
  'Decorative marketing sections (testimonials, feature grids, pricing) inside a functional app.',
  'Endless identical cards standing in for real data hierarchy.',
  'Fake/empty dashboard metrics or placeholder numbers presented as real.',
  'Content overflowing or clipping at narrow widths (unusable phone layout).',
  'App shell (nav/chrome) visually competing with or dominating the content.',
  'Many equally-dominant primary actions with no clear hierarchy.',
  'Controls with weak affordance (unclear they are interactive).',
];

/* ── Derivation ──────────────────────────────────────────────────────────────── */

export function deriveAppVisualContract(
  arch: AppArchitectureContract | undefined,
  visualSystem?: VisualSystemContract,
): AppVisualContract | undefined {
  if (!arch || !Array.isArray(arch.screens) || arch.screens.length === 0) return undefined;
  try {
    const appType = arch.appType;
    const shellType = arch.shell;
    const shell: AppShellSpec = {
      shell: shellType,
      navComponent: shellToNav(shellType),
      appBar: shellType === 'none' ? 'none' : (shellType === 'sidebar' ? 'contextual' : 'top-bar'),
      density: densityFor(appType),
      touchTargetPx: touchTargetFor(shellType),
      contentVsChrome: 'Content dominates; chrome (nav/app bar) is quiet and subordinate.',
      modalTreatment: shellType === 'tab-bar' ? 'sheet' : 'dialog',
    };
    const screenComposition = arch.screens.map((s) => compositionForScreen(s.id, s.role, shellType, appType));
    const imageStrategy = imageStrategyFor(appType);
    const componentQuality = componentQualityFor(appType, visualSystem?.colorMode);
    const hierarchy = hierarchyFor(appType, visualSystem?.colorMode);
    const tokenReuse = visualSystem
      ? `Reuses the shared visual-system tokens (${visualSystem.colorMode} mode, roles: ${(visualSystem.colorRoles || []).map((r) => r.role).slice(0, 6).join(', ')}). App adapter adds only shell/nav/density/composition — no new colour or type tokens.`
      : 'Reuses the shared visual-system tokens as the brand/style source of truth; the app adapter adds only shell/nav/density/composition — no new colour or type tokens.';

    const notes = [
      `appType=${appType}; shell=${shell.shell}/${shell.navComponent}; density=${shell.density}; primary device=${devicesFor(appType)[0]}.`,
      imageStrategy.usePhotography ? 'Photography allowed (purposeful, content-serving).' : 'Photography suppressed — icons/charts/avatars preferred.',
    ];

    return {
      version: 'app-visual-v1',
      appType,
      shell,
      devices: devicesFor(appType),
      screenComposition,
      imageStrategy,
      componentQuality,
      hierarchy,
      interactionPolish: INTERACTION_POLISH,
      antiPatterns: APP_ANTI_PATTERNS,
      tokenReuse,
      notes,
    };
  } catch {
    return undefined;
  }
}

/* ── Generation block ────────────────────────────────────────────────────────── */

export function renderAppShellBlock(contract: AppVisualContract | undefined): string[] {
  if (!contract) return [];
  const out: string[] = [];
  out.push('[APP VISUAL SYSTEM]');
  out.push(contract.tokenReuse);
  out.push(`Shell: ${contract.shell.shell} (${contract.shell.navComponent}), app bar: ${contract.shell.appBar}, density: ${contract.shell.density}, min touch target: ${contract.shell.touchTargetPx}px. ${contract.shell.contentVsChrome}`);
  out.push(`Devices (primary first): ${contract.devices.join(' > ')}. The layout must be usable at the narrow width — no overflow or clipping.`);
  out.push('This is an APPLICATION, not a scrolling marketing page: the first viewport of each screen is an operational surface, NOT an automatic giant hero.');
  out.push('Screen composition:');
  for (const c of contract.screenComposition) {
    out.push(`- ${c.screenId} [${c.role}]: first viewport = ${c.firstViewport} Primary zone = ${c.primaryZone}. Chrome = ${c.chrome} ${c.interactionHierarchy}`);
  }
  out.push(`Imagery: ${contract.imageStrategy.rationale} Prefer: ${contract.imageStrategy.preferredVisuals.join(', ')}. Avoid: ${contract.imageStrategy.forbid.join(', ')}.`);
  const cq = contract.componentQuality;
  out.push('Component quality (premium, design-system controls — not browser-default filler):');
  out.push(`  ${cq.buildStrategy}`);
  for (const c of cq.controls) out.push(`  • ${c}`);
  out.push(`  States: ${cq.interactionStates}`);
  out.push(`  Surfaces: ${cq.surfaces}`);
  const h = contract.hierarchy;
  out.push('Visual hierarchy (use the shared brand tokens — do NOT invent a new palette):');
  out.push(`  Layering: ${h.layering}`);
  out.push(`  Colour usage: ${h.colorUsage}`);
  out.push(`  Typography: ${h.typography}`);
  out.push(`  Density: ${h.density}`);
  out.push(`  Composition: ${h.surfaceComposition}`);
  out.push(`  Data/charts: ${h.dataViz}`);
  const ip = contract.interactionPolish;
  out.push('Interaction polish (feel intentional when operated — functional wiring is the screen-depth contract):');
  out.push(`  Motion: ${ip.motion}`);
  out.push(`  Feedback: ${ip.feedback}`);
  out.push(`  Navigation: ${ip.navigation}`);
  out.push('Avoid these app UI anti-patterns:');
  for (const a of contract.antiPatterns) out.push(`  • ${a}`);
  return out;
}
