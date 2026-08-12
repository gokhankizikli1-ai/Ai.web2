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

export interface AppVisualContract {
  version: 'app-visual-v1';
  appType: AppType;
  shell: AppShellSpec;
  /** Ordered device targets (first = primary). */
  devices: DeviceTarget[];
  screenComposition: ScreenComposition[];
  imageStrategy: AppImageStrategy;
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
  out.push('Avoid these app UI anti-patterns:');
  for (const a of contract.antiPatterns) out.push(`  • ${a}`);
  return out;
}
