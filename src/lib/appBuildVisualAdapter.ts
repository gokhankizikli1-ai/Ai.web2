/**
 * App Build — App Visual Adapter, Screen Composition & App-Defect detection (Phase 4).
 *
 * The Web Build's VisualSystem is the token/brand authority (colour roles, typography
 * roles, surface language). App Build REUSES it unchanged — it never creates a second
 * token system. This adapter owns ONLY the app-surface concepts the web page model has
 * no word for: the app shell, app-bar / nav / sidebar / tabs / toolbar placement, UI
 * density, touch-target sizing, modal/sheet chrome, device layout and the chrome-vs-
 * content split.
 *
 * It also replaces the web page's COUPLED trio (hero composition / marketing visual
 * concept / funnel content narrative) with a per-screen SCREEN COMPOSITION: a primary
 * content zone, supporting zones, the chrome, and the interaction hierarchy — so an
 * app gets a real screen layout, not a giant landing hero and marketing sections
 * squeezed into a phone frame. And it carries a context-aware image strategy
 * (dashboards → icons/charts/avatars; consumer apps → photography) and an app-UI
 * defect analyzer (giant useless hero, marketing-section leak, competing primary
 * actions) so "a website in a phone frame" is a detectable defect.
 *
 * Pure, deterministic, bounded, network-free, JSON-serializable, fail-open. Type-only
 * imports (leaf module).
 */
import type {
  AppArchitectureContract, AppArchetype, AppShell,
} from '@/lib/appBuildArchitecture';
import type { AppSourceFile } from '@/lib/appBuildScreenDepth';

/* ── Public types ───────────────────────────────────────────────────────────── */

export type NavPlacement = 'left-sidebar' | 'bottom-bar' | 'top-bar' | 'none';
export type ImageStrategy = 'iconographic' | 'photographic' | 'mixed' | 'minimal';

export interface ScreenComposition {
  screenId: string;
  /** The dominant content zone of the screen (what fills the space). */
  primaryZone: string;
  /** Secondary zones around the primary one. */
  supporting: string[];
  /** The persistent app chrome present on this screen. */
  chrome: string[];
  /** Where the single primary action sits and how it ranks over the rest. */
  interactionHierarchy: string;
}

export interface AppVisualAdapter {
  version: 'app-visual-adapter-v1';
  status: 'derived';
  shell: AppShell;
  navPlacement: NavPlacement;
  density: 'compact' | 'comfortable';
  /** Minimum interactive target size in px (comfortable touch = 44; dense desktop = 32). */
  touchTargetPx: number;
  /** How chrome and content divide the surface. */
  chromeVsContent: string;
  imageStrategy: ImageStrategy;
  screens: ScreenComposition[];
  /** Web-page patterns that must NOT appear in an app surface. */
  forbiddenPatterns: string[];
  /** Always true — the adapter reuses the shared VisualSystem tokens/brand. */
  usesSharedTokens: boolean;
  notes: string[];
}

/* ── App-defect analysis types ───────────────────────────────────────────────── */

export type AppVisualDefectCode =
  | 'app-giant-hero' | 'app-marketing-leak' | 'app-competing-primary-actions';

export interface AppVisualDefect {
  code: AppVisualDefectCode;
  file?: string;
  message: string;
  severity: 'minor' | 'major';
}

export interface AppVisualDefectResult {
  status: 'pass' | 'fail';
  legacy: boolean;
  defects: AppVisualDefect[];
}

/* ── Bounded helpers ────────────────────────────────────────────────────────── */

const CAP = 12;
const clean = (xs: Array<string | undefined | null>, cap = CAP): string[] => {
  const out: string[] = []; const seen = new Set<string>();
  for (const x of xs) {
    const s = (typeof x === 'string' ? x : '').trim();
    if (!s || seen.has(s.toLowerCase())) continue;
    seen.add(s.toLowerCase()); out.push(s);
    if (out.length >= cap) break;
  }
  return out;
};

/* ── Derivation helpers ─────────────────────────────────────────────────────── */

function navPlacementFor(shell: AppShell, pattern?: string): NavPlacement {
  switch (shell) {
    case 'sidebar-app': return 'left-sidebar';
    case 'tabbed-app':  return pattern === 'top-tabs' ? 'top-bar' : 'bottom-bar';
    case 'stack-app':   return 'top-bar';
    default:            return 'none';
  }
}

function imageStrategyFor(archetype: AppArchetype): ImageStrategy {
  switch (archetype) {
    case 'analytics-dashboard':
    case 'crm-workspace':
    case 'productivity-tool':
    case 'finance-app':
      return 'iconographic';               // icons, charts, avatars — not stock photography
    case 'commerce-app':
    case 'content-feed':
      return 'photographic';               // product / content imagery is the point
    case 'fitness-tracker':
    case 'booking-service':
    case 'learning-app':
      return 'mixed';
    case 'simple-utility':
      return 'minimal';
    default:
      return 'mixed';
  }
}

function primaryZoneForRole(role: string): string {
  switch (role) {
    case 'entry-overview':     return 'a metric/summary grid as the focal zone';
    case 'progress-analytics': return 'a primary chart with supporting stats';
    case 'list-browse':        return 'a scrollable list/grid of records';
    case 'board-pipeline':     return 'columns of draggable cards';
    case 'feed':               return 'a vertical stream of content cards';
    case 'search':             return 'a results list beneath a prominent search field';
    case 'detail':             return 'the record’s key fields and content';
    case 'create-edit-form':   return 'a focused form with grouped fields';
    case 'workflow-flow':      return 'the current step with clear progress';
    case 'settings-profile':   return 'grouped preference rows';
    case 'utility-primary':    return 'the tool’s inputs and its live result';
    default:                   return 'the screen’s primary content';
  }
}

/* ── Derivation: AppVisualAdapter ────────────────────────────────────────────── */

export function deriveAppVisualAdapter(
  architecture: AppArchitectureContract | undefined,
  opts?: { navPattern?: string },
): AppVisualAdapter | undefined {
  if (!architecture || architecture.status !== 'derived' || !architecture.screens.length) return undefined;
  try {
    const navPlacement = navPlacementFor(architecture.shell, opts?.navPattern);
    const density = architecture.density;
    const touchTargetPx = density === 'compact' ? 36 : 44;
    const imageStrategy = imageStrategyFor(architecture.archetype);

    const chromeBase = clean([
      navPlacement === 'left-sidebar' ? 'left sidebar' : undefined,
      navPlacement === 'bottom-bar' ? 'bottom tab bar' : undefined,
      navPlacement === 'top-bar' ? 'top tab/app bar' : undefined,
      'top app bar with screen title and primary action',
    ], 3);

    const screens: ScreenComposition[] = architecture.screens.map((s) => ({
      screenId: s.id,
      primaryZone: primaryZoneForRole(s.role),
      supporting: clean(s.secondaryActions.length ? ['a secondary-action row'] : [], 2),
      chrome: s.topLevel ? chromeBase : clean(['a back-aware app bar', ...chromeBase], 3),
      interactionHierarchy: `“${s.primaryAction}” is the single dominant action; secondary actions are visually quieter`,
    }));

    const forbiddenPatterns = clean([
      'no giant marketing hero or oversized display heading occupying a full screen',
      'no marketing sections (pricing tables, testimonials, “trusted by”, feature-grid landing sections)',
      'no decorative full-bleed landing whitespace — app screens are content-dense and functional',
      'no endless identical placeholder cards; no fabricated dashboard metrics presented as real',
      imageStrategy === 'iconographic' ? 'no hero stock photography — use icons, charts and avatars' : undefined,
    ], 6);

    const notes = clean([
      `Reuses the shared VisualSystem tokens/brand — no new colour/type system.`,
      `${architecture.shell} · ${navPlacement} · ${density} · touch target ${touchTargetPx}px · images ${imageStrategy}.`,
      'Screen composition replaces the web hero/section/funnel model.',
    ], 4);

    return {
      version: 'app-visual-adapter-v1',
      status: 'derived',
      shell: architecture.shell,
      navPlacement,
      density,
      touchTargetPx,
      chromeVsContent: navPlacement === 'left-sidebar'
        ? 'a fixed left sidebar for navigation; the rest is a content region with a slim top bar'
        : navPlacement === 'bottom-bar'
          ? 'a persistent bottom tab bar; the rest is content with a compact top bar'
          : 'a slim top bar; the rest is content',
      imageStrategy,
      screens,
      forbiddenPatterns,
      usesSharedTokens: true,
      notes,
    };
  } catch {
    return undefined;
  }
}

/* ── App-UI defect analysis (a website in a phone frame is a DEFECT) ─────────── */

// A display-size heading typical of a marketing hero, not an app screen title.
const GIANT_HERO_RE = /class(?:Name)?=["'][^"']*\btext-(?:6|7|8|9)xl\b|font-size:\s*(?:[6-9]\d|1\d\d)px|\btext-\[(?:[6-9]\d|1\d\d)px\]/i;
// Marketing/landing section language that does not belong inside a functional app.
const MARKETING_LEAK_RE = /\b(trusted by|as seen in|pricing plans?|testimonials?|start(?:ed)? for free|no credit card required|book a demo|our customers love|join \d[\d,]* (?:users|customers)|limited time offer)\b/i;
// More than one element explicitly styled as the primary CTA on one screen.
const PRIMARY_CTA_RE = /class(?:Name)?=["'][^"']*\b(btn-primary|primary-button|cta-primary)\b/gi;

export function analyzeAppVisualDefects(
  files: AppSourceFile[] | undefined,
  adapter: AppVisualAdapter | undefined,
): AppVisualDefectResult {
  if (!adapter || !Array.isArray(files) || files.length === 0) {
    return { status: 'pass', legacy: false, defects: [] };
  }
  try {
    const defects: AppVisualDefect[] = [];
    // A consumer app legitimately uses photography and larger headings; the giant-hero /
    // marketing checks target FUNCTIONAL (iconographic/minimal) app surfaces most strongly.
    const functional = adapter.imageStrategy === 'iconographic' || adapter.imageStrategy === 'minimal';
    for (const f of files) {
      const c = f.content || '';
      if (functional && GIANT_HERO_RE.test(c)) {
        defects.push({ code: 'app-giant-hero', file: f.path, severity: 'major',
          message: `A marketing-scale hero heading appears in a functional app screen (${f.path}). App screens use titles, not landing heroes.` });
      }
      if (MARKETING_LEAK_RE.test(c)) {
        defects.push({ code: 'app-marketing-leak', file: f.path, severity: functional ? 'major' : 'minor',
          message: `Marketing/landing section language leaked into an app screen (${f.path}).` });
      }
      const primaryCount = (c.match(PRIMARY_CTA_RE) || []).length;
      if (primaryCount >= 2) {
        defects.push({ code: 'app-competing-primary-actions', file: f.path, severity: 'minor',
          message: `${primaryCount} elements claim the primary action on one screen (${f.path}); only one action should dominate.` });
      }
    }
    const hasMajor = defects.some((d) => d.severity === 'major');
    return { status: (hasMajor || defects.length) ? 'fail' : 'pass', legacy: true, defects };
  } catch {
    return { status: 'pass', legacy: false, defects: [] };
  }
}

export function hasBlockingAppVisualDefects(res: AppVisualDefectResult | undefined): boolean {
  return !!res && res.status === 'fail' && res.defects.some((d) => d.severity === 'major');
}

/* ── Bounded builder block ───────────────────────────────────────────────────── */

const RENDER_CEIL = 2600;
function bound(lines: string[]): string[] {
  const out: string[] = []; let total = 0;
  for (const l of lines) { total += l.length + 1; if (total > RENDER_CEIL) break; out.push(l); }
  return out;
}

export function renderAppVisualAdapterBlock(a: AppVisualAdapter | undefined): string[] {
  if (!a || a.status !== 'derived') return [];
  const lines: string[] = [
    'APP SURFACE & SCREEN COMPOSITION (binding — build an APP, not a website in a frame):',
    `Shell: ${a.shell} · nav: ${a.navPlacement} · density: ${a.density} · min touch target: ${a.touchTargetPx}px.`,
    `Chrome vs content: ${a.chromeVsContent}.`,
    `Image strategy: ${a.imageStrategy}.`,
    'Reuse the SHARED VisualSystem tokens/brand — do NOT invent a new colour or type system.',
    'Per-screen composition (primary zone → interaction hierarchy):',
    ...a.screens.map((s) => `- ${s.screenId}: ${s.primaryZone}; ${s.interactionHierarchy}`),
    'FORBIDDEN (app must not look like a landing page):',
    ...a.forbiddenPatterns.map((p) => `- ${p}`),
    '',
  ];
  return bound(lines);
}
