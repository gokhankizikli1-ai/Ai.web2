/**
 * APP BUILD QUALITY V2 — the single app-specific ACCEPTANCE authority.
 *
 * WHAT WAS MISSING (the root gap this closes)
 * App Build already had strong app-specific PLANNING authorities (`appArchitecture`,
 * `appNavigation`, `appScreenDepth`, `appVisualAdapter`) and a handful of app-specific
 * STATIC detectors (`appUiQuality.detectAppUiQuality`, `appScreenDepth.findDeadControls`,
 * the validator's router/reachability checks). But every one of those app findings was an
 * ADVISORY validator warning:
 *
 *   • not in the severe-warning gate → a model "pass" could approve an app whose primary
 *     navigation does not work;
 *   • not a candidate dimension → best-candidate selection was blind to app quality, so a
 *     repair that BROKE navigation could still be promoted over the original;
 *   • not in the deterministic acceptance gate → nothing app-specific could ever reject a
 *     repair.
 *
 * At the same time the ten deterministic blocking analyzers the shared pipeline runs are all
 * WEB analyzers (composition / content narrative / site depth / visual concept / experience
 * identity / motion execution are deliberately not even derived for `buildType='app'`), so an
 * app build reached candidate comparison with almost no live quality dimension at all.
 *
 * This module is that missing authority. It follows the EXACT contract the existing analyzers
 * use (`analyzeX` → `xToReviewIssues` → `hasBlockingXFindings` → `xIssueCodes` →
 * `buildXDiagnostics`) so it plugs into the SAME single review → single bounded repair →
 * re-verify → best-candidate loop. It creates NO second pipeline, NO second repair, NO extra
 * model or provider call.
 *
 * It composes (never duplicates) the existing detectors:
 *   • `appUiQuality.detectAppUiQuality` — premium-control / theme / dashboard / nav-state defects
 *   • `appScreenDepth.findDeadControls`  — unwired interactive controls
 *   • `appArchitecture.screenComponentName` — the canonical screen→file mapping
 * and adds the dimensions nobody owned: routing reachability as an ACCEPTANCE fact, RENDERED
 * navigation truth, responsive/touch/clipping truth measured across the real app viewports,
 * screen-composition uniformity and PRODUCT FIT.
 *
 * PRIORITY CONTRACT (P0 highest). Every issue carries its priority so the bounded repair
 * receives the most damaging obligations first:
 *   P0 runtime/build failure                (owned by validation + the rendered evaluator)
 *   P1 blank / unreachable primary screen   → app-screen-unreachable
 *   P2 broken routing / navigation / core interaction
 *                                           → app-router-missing, app-nav-dead,
 *                                             app-dead-control, app-interaction-state-missing,
 *                                             app-nav-active-state
 *   P3 severe responsive / layout failure   → app-nav-unreachable-narrow, app-content-clipped,
 *                                             app-fixed-width
 *   P4 major accessibility / usability      → app-touch-target, app-surface-theme-mismatch,
 *                                             app-native-control-theme
 *   P5 severe product-fit / composition     → app-product-fit, app-generic-dashboard,
 *                                             app-screen-uniformity, app-button-hierarchy
 *
 * BLOCKING is deliberately narrow: only strongly-proven P1–P3 defects, a genuinely dead control
 * surface, and a TOTAL product-fit miss reject approval. Everything else is repaired but never
 * blocks. Blocking here rejects a REPAIR / withholds APPROVAL — it can never demote a
 * structurally renderable model-native project to Safe Preview (that authority is unchanged).
 *
 * Pure, deterministic, network-free, bounded, JSON-serializable, fail-open (never throws).
 */
import type { FrontendGeneratedFile, RenderedScreenshotMeta } from '@/lib/webBuildAgents';
import type { FrontendBuilderReviewIssue, FrontendBuilderReviewCategory } from '@/lib/webBuildAgents';
import type { AppArchitectureContract, AppType } from '@/lib/appArchitecture';
import type { NavigationContract } from '@/lib/appNavigation';
import { screenComponentName } from '@/lib/appArchitecture';
import { findDeadControls } from '@/lib/appScreenDepth';
import { detectAppUiQuality } from '@/lib/appUiQuality';

/* ── Public types ─────────────────────────────────────────────────────────────── */

export type AppQualityDimension =
  | 'structure'
  | 'navigation'
  | 'interaction'
  | 'responsive'
  | 'accessibility'
  | 'composition'
  | 'product-fit';

export type AppQualitySeverity = 'blocker' | 'major' | 'minor';

/** Bounded, stable issue codes. Persisted in diagnostics — never renamed casually. */
export type AppQualityCode =
  | 'app-screen-unreachable'
  | 'app-router-missing'
  | 'app-nav-dead'
  | 'app-nav-active-state'
  | 'app-dead-control'
  | 'app-interaction-state-missing'
  | 'app-nav-unreachable-narrow'
  | 'app-content-clipped'
  | 'app-fixed-width'
  | 'app-touch-target'
  | 'app-surface-theme-mismatch'
  | 'app-native-control-theme'
  | 'app-product-fit'
  | 'app-generic-dashboard'
  | 'app-screen-uniformity'
  | 'app-button-hierarchy';

export interface AppQualityIssue {
  code: AppQualityCode;
  dimension: AppQualityDimension;
  severity: AppQualitySeverity;
  /** Repair priority — 0 (most damaging) … 5. Drives the bounded repair ordering. */
  priority: 0 | 1 | 2 | 3 | 4 | 5;
  /** Short human label (bounded, safe). */
  label: string;
  /** What was measured (counts / paths only — never source or copy). */
  evidence: string;
  /** The concrete, preserving repair instruction. */
  repairInstruction: string;
  files: string[];
  /** True when the evidence came from the RENDERED runtime, not source inference. */
  rendered: boolean;
  /** True when this finding rejects approval / a repair. */
  blocking: boolean;
}

export type AppQualityStatus = 'skipped' | 'pass' | 'issues' | 'blocked';

export interface AppQualityAcceptanceResult {
  version: 'app-quality-v1';
  status: AppQualityStatus;
  appType?: AppType;
  screenCount: number;
  routeCount: number;
  issues: AppQualityIssue[];
  blockingCount: number;
  /** Distinct viewport widths that produced a usable measurement (empty ⇒ source-only). */
  measuredWidths: number[];
  /** True when at least one rendered fact contributed. */
  renderedEvidence: boolean;
}

/** Bounded, secret-free diagnostics persisted on the acceptance artifact. */
export interface AppQualityDiagnostics {
  version: 'app-quality-diagnostics-v1';
  appType?: AppType;
  screenCount: number;
  routeCount: number;
  initialStatus?: AppQualityStatus;
  postRepairStatus?: AppQualityStatus;
  initialIssueCount: number;
  postRepairIssueCount?: number;
  initialBlockingCount: number;
  postRepairBlockingCount?: number;
  /** Bounded issue codes on the candidate that is being judged. */
  issueCodes: string[];
  measuredWidths: number[];
  renderedEvidence: boolean;
}

export interface AppQualityInput {
  files: FrontendGeneratedFile[] | undefined;
  architecture: AppArchitectureContract | undefined;
  navigation?: NavigationContract;
  /** Shared visual-system colour mode — enables the dark-surface mismatch detector. */
  colorMode?: 'light' | 'dark' | 'mixed';
  /** Rendered measurements for THIS candidate (all measured viewports). */
  screenshots?: ReadonlyArray<RenderedScreenshotMeta>;
}

/* ── Bounds ───────────────────────────────────────────────────────────────────── */

const MAX_ISSUES = 12;
const MAX_FILES_PER_ISSUE = 5;
/** Below this many unwired controls the finding is reported but never blocks. */
const DEAD_CONTROL_BLOCK_THRESHOLD = 4;
/** Widths at or below this are treated as the phone regime for touch/nav reachability. */
const NARROW_WIDTH_MAX = 480;
/** Small-target count that proves the phone layout is genuinely hard to operate. */
const SMALL_TARGET_BLOCK_THRESHOLD = 6;
/** How many screens must share one composition signature before uniformity is provable. */
const UNIFORM_SCREEN_THRESHOLD = 3;
/** Navigation controls that must have been probed before "none of them worked" is conclusive.
 *  With a single probed control a false negative is plausible (it may target the current screen),
 *  so one control alone is reported but never blocks. */
const NAV_PROBE_BLOCK_MIN = 2;
/** Hard-clipped elements at a WIDE viewport before the clipping is treated as blocking rather
 *  than merely reported. Real-browser measurement showed that a catastrophically desktop-only app
 *  registers only ONE clipped element (the container, not each row it hides), so counting is the
 *  wrong axis at desktop — but clipping at a PHONE width is a severe responsive failure at any
 *  count, which is why `narrowShots` clipping blocks on its own below. */
const CLIPPED_WIDE_BLOCK_THRESHOLD = 2;

const cut = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/* ── Issue construction ───────────────────────────────────────────────────────── */

interface IssueSeed {
  code: AppQualityCode;
  dimension: AppQualityDimension;
  severity: AppQualitySeverity;
  priority: AppQualityIssue['priority'];
  label: string;
  evidence: string;
  repairInstruction: string;
  files?: string[];
  rendered?: boolean;
  blocking?: boolean;
}

/** The shared preservation clause every app repair instruction carries, so a local defect can
 *  never be answered with a whole-app redesign. It is APPENDED after truncation (never truncated
 *  itself): a bounded instruction that loses its preservation clause is exactly how a repair ends
 *  up rewriting a working app, so the clause is the part that must always survive. */
const PRESERVE = ' Keep every existing screen, route, feature and asset — fix only this defect.';
/** Total instruction budget; the specific half is truncated to fit alongside PRESERVE. */
const INSTRUCTION_MAX = 240;

function issue(seed: IssueSeed): AppQualityIssue {
  return {
    code: seed.code,
    dimension: seed.dimension,
    severity: seed.severity,
    priority: seed.priority,
    label: cut(seed.label, 80),
    evidence: cut(seed.evidence, 240),
    repairInstruction: `${cut(seed.repairInstruction.trim(), INSTRUCTION_MAX - PRESERVE.length)}${PRESERVE}`,
    files: (seed.files || []).filter((f): f is string => typeof f === 'string' && !!f).slice(0, MAX_FILES_PER_ISSUE),
    rendered: seed.rendered === true,
    blocking: seed.blocking === true,
  };
}

/* ── Source helpers ───────────────────────────────────────────────────────────── */

function uiFiles(files: FrontendGeneratedFile[]): FrontendGeneratedFile[] {
  return files.filter((f) => f.language !== 'css' && f.path !== 'src/main.tsx');
}

function screenFiles(files: FrontendGeneratedFile[]): FrontendGeneratedFile[] {
  return files.filter((f) => f.language !== 'css' && /^src\/screens\/[^/]+\.tsx?$/.test(f.path));
}

const ROUTER_RE = /react-router|createBrowserRouter|createHashRouter|<Routes\b|<Route\b|useRoutes\b|RouterProvider|<HashRouter\b|<BrowserRouter\b|<MemoryRouter\b/;

/* ── Fixed-width detection (source) ───────────────────────────────────────────────
 * A hard pixel width on a LAYOUT container with no responsive escape hatch. Conservative:
 * only widths large enough to break a phone (≥ 700px) and only when the same element does
 * not also declare a responsive width / max-width fallback. */
const FIXED_WIDTH_CLASS_RE = /\b(?:min-)?w-\[(\d{3,4})px\]/g;
const FIXED_WIDTH_STYLE_RE = /(?:min-)?width\s*:\s*(\d{3,4})px/g;
const RESPONSIVE_ESCAPE_RE = /\bmax-w-|\bw-full\b|\bw-screen\b|\bflex-1\b|\bmin-w-0\b|@media|\b(?:sm|md|lg|xl):/;
const FIXED_WIDTH_MIN_PX = 700;

function findFixedWidths(files: FrontendGeneratedFile[]): { paths: string[]; count: number; maxPx: number } {
  const paths = new Set<string>();
  let count = 0;
  let maxPx = 0;
  for (const f of files) {
    const hasEscape = RESPONSIVE_ESCAPE_RE.test(f.content);
    const widths: number[] = [];
    for (const re of [FIXED_WIDTH_CLASS_RE, FIXED_WIDTH_STYLE_RE]) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(f.content)) !== null) {
        const px = Number(m[1]);
        if (Number.isFinite(px) && px >= FIXED_WIDTH_MIN_PX) widths.push(px);
      }
    }
    // A file that never declares any responsive width AND pins a big pixel width is a real
    // desktop-only assumption. A file that also uses max-w/w-full/breakpoints is left alone.
    if (widths.length && !hasEscape) {
      paths.add(f.path);
      count += widths.length;
      maxPx = Math.max(maxPx, ...widths);
    }
  }
  return { paths: [...paths], count, maxPx };
}

/* ── Screen composition signature (uniformity) ─────────────────────────────────────
 * A coarse, deterministic structural fingerprint of a screen. Two screens sharing it render
 * the same shape regardless of their copy — the "every screen looks identical" pathology. */
const SIGNATURE_PROBES: ReadonlyArray<[string, RegExp]> = [
  ['table', /<table\b|<TableBody\b|role=["']table["']/i],
  ['chart', /<(?:Line|Bar|Area|Pie|Radar|Scatter)Chart\b|<ResponsiveContainer\b|<canvas\b|<svg\b[^>]*data-chart/i],
  ['form', /<form\b|<input\b|<textarea\b/i],
  ['list', /\.map\s*\(/],
  ['grid', /\bgrid-cols-\d/],
  ['card', /\brounded-(?:lg|xl|2xl|3xl)\b/],
  ['calendar', /calendar|weekday|\bday\s*grid\b/i],
  ['thread', /message|conversation|thread|bubble/i],
  ['media', /<img\b|thumbnail|poster|cover/i],
  ['kpi', /\b(?:StatCard|KpiCard|MetricCard|stat-card|kpi-card|metric-card)\b/],
];

function compositionSignature(source: string): string {
  const bits: string[] = [];
  for (const [name, re] of SIGNATURE_PROBES) {
    re.lastIndex = 0;
    if (re.test(source)) bits.push(name);
  }
  // Bucket the grid column count so 3-col vs 4-col grids are not treated as different shapes.
  return bits.length ? bits.join('+') : 'bare';
}

/* ── Product fit ──────────────────────────────────────────────────────────────────
 * The planner ALREADY classified the app type (`appArchitecture.appType`) from the user's own
 * prompt — no extra model call is made to re-classify anything here.
 *
 * The check has to be narrow to be honest. Two things make a naive "does the source mention the
 * product?" test worthless:
 *   • identifiers and route strings are DERIVED from the plan, so a booking app's source always
 *     contains the word "booking" no matter what it actually renders; and
 *   • a false accusation is expensive — it would spend the single bounded repair telling a
 *     correct app to rebuild its content.
 * So this reads only the VISIBLE COPY (JSX text + string literals, with import statements
 * removed), and it fires only on the exact failure the requirement names: the product's own
 * vocabulary appears NOWHERE in what the app displays, WHILE the app displays the vocabulary of
 * a generic analytics dashboard instead. Anything less conclusive is left to the composition and
 * uniformity findings. */
const PRODUCT_MARKERS: Partial<Record<AppType, RegExp>> = {
  crm: /contact|deal|pipeline|lead|opportunit|account|stage|customer/i,
  'ecommerce-admin': /order|product|inventor|fulfil|fulfill|sku|refund|shipping|catalog/i,
  fitness: /workout|exercise|\brep\b|\bsets?\b|program|training|streak|calorie/i,
  booking: /book|appointment|reserv|schedul|slot|availabilit|client|calendar/i,
  productivity: /task|to-?do|subtask|due|priorit|project|checklist/i,
  messaging: /message|conversation|thread|chat|inbox|reply|unread|compose/i,
  'media-content': /browse|librar|watch|listen|episode|article|playlist|feed|track|album|series/i,
};

/** The unmistakable vocabulary of a generic analytics dashboard — the shape App Build collapses
 *  into when it ignores the requested product. */
const GENERIC_DASHBOARD_COPY_RE =
  /\bKPI\b|total revenue|conversion rate|\bMRR\b|\bARR\b|active users|churn|growth rate|vs\.? last (?:month|period)|month over month/i;

const IMPORT_LINE_RE = /^[ \t]*import\b[^\n]*$/gm;
const JSX_TEXT_RE = />([^<>{}]{2,})</g;
const STRING_LITERAL_RE = /(['"])((?:\\.|(?!\1)[^\\\n])*)\1/g;
const MAX_COPY_CHARS = 40_000;

/** Extract the text this file would actually DISPLAY: JSX text nodes plus string literals, with
 *  import statements stripped so module paths and plan-derived component names never count.
 *  Bounded; fail-open to the raw source only if extraction throws. */
function visibleCopy(source: string): string {
  try {
    const body = source.replace(IMPORT_LINE_RE, ' ').slice(0, MAX_COPY_CHARS);
    const parts: string[] = [];
    JSX_TEXT_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = JSX_TEXT_RE.exec(body)) !== null) parts.push(m[1]);
    STRING_LITERAL_RE.lastIndex = 0;
    while ((m = STRING_LITERAL_RE.exec(body)) !== null) parts.push(m[2]);
    return parts.join(' ');
  } catch {
    return source.slice(0, MAX_COPY_CHARS);
  }
}

interface ProductFitEvidence {
  /** Files whose visible copy carries the requested product's vocabulary. */
  productHits: number;
  /** Files whose visible copy carries generic-analytics-dashboard vocabulary. */
  dashboardHits: number;
  /** False when this app type has no distinctive vocabulary to require (utility / generic). */
  applicable: boolean;
}

function productFitEvidence(appType: AppType, files: FrontendGeneratedFile[]): ProductFitEvidence {
  const re = PRODUCT_MARKERS[appType];
  if (!re) return { productHits: 0, dashboardHits: 0, applicable: false };
  let productHits = 0;
  let dashboardHits = 0;
  for (const f of files) {
    const copy = visibleCopy(f.content);
    re.lastIndex = 0;
    if (re.test(copy)) productHits += 1;
    GENERIC_DASHBOARD_COPY_RE.lastIndex = 0;
    if (GENERIC_DASHBOARD_COPY_RE.test(copy)) dashboardHits += 1;
  }
  return { productHits, dashboardHits, applicable: true };
}

/* ── Rendered helpers ─────────────────────────────────────────────────────────────
 * Every rendered fact is read from the SAME `RenderedScreenshotMeta` the shared measurement
 * producer already emits — there is no second measurement channel. The WORST observation
 * across viewports wins, so a good desktop measurement can never mask a broken phone layout. */

function widthOf(s: RenderedScreenshotMeta): number {
  return typeof s.width === 'number' && Number.isFinite(s.width) ? Math.round(s.width) : 0;
}

function narrowShots(shots: ReadonlyArray<RenderedScreenshotMeta>): RenderedScreenshotMeta[] {
  return shots.filter((s) => widthOf(s) > 0 && widthOf(s) <= NARROW_WIDTH_MAX);
}

/* ── Analysis ─────────────────────────────────────────────────────────────────────── */

const SKIPPED: AppQualityAcceptanceResult = {
  version: 'app-quality-v1',
  status: 'skipped',
  screenCount: 0,
  routeCount: 0,
  issues: [],
  blockingCount: 0,
  measuredWidths: [],
  renderedEvidence: false,
};

/**
 * Analyze an App Build candidate. Returns a `skipped` result (and therefore never blocks) for
 * a non-app build, a build with no app architecture, or an empty file set — so Web Build is
 * byte-for-byte unaffected. Pure, deterministic and fail-open.
 */
export function analyzeAppBuildQuality(input: AppQualityInput): AppQualityAcceptanceResult {
  try {
    const files = Array.isArray(input.files) ? input.files.filter((f) => !!f && typeof f.content === 'string') : [];
    const arch = input.architecture;
    if (!arch || !Array.isArray(arch.screens) || arch.screens.length === 0 || files.length === 0) return SKIPPED;

    const shots = (input.screenshots || []).filter((s) => !!s && typeof s === 'object');
    const measuredWidths = Array.from(new Set(shots.map(widthOf).filter((w) => w > 0))).sort((a, b) => b - a);
    const ui = uiFiles(files);
    const screens = screenFiles(files);
    const byPath = new Map(files.map((f) => [f.path, f]));
    const appFile = byPath.get('src/App.tsx');
    const routesFile = byPath.get('src/app/routes.tsx');
    const found: AppQualityIssue[] = [];

    /* ── P1 — unreachable screens (a planned screen the app can never show). ── */
    const unreachable: string[] = [];
    for (const s of arch.screens) {
      const comp = screenComponentName(s.id);
      const path = `src/screens/${comp}.tsx`;
      const file = byPath.get(path);
      if (!file) continue;                       // absence is already a validation ERROR
      const re = new RegExp(`\\b${comp}\\b`);
      const referenced = files.some((f) => f.path !== path && re.test(f.content));
      if (!referenced) unreachable.push(path);
    }
    if (unreachable.length) {
      found.push(issue({
        code: 'app-screen-unreachable', dimension: 'structure', severity: 'blocker', priority: 1,
        label: 'A planned screen is unreachable',
        evidence: `${unreachable.length} generated screen(s) are never imported by the app or any route, so the user can never reach them: ${unreachable.slice(0, 3).join(', ')}.`,
        repairInstruction: `Import and route every listed screen so it is reachable from the app's navigation.`,
        files: unreachable, blocking: true,
      }));
    }

    /* ── P2 — routing not wired at all for a multi-screen app. ── */
    const routingHaystack = `${appFile?.content || ''}\n${routesFile?.content || ''}`;
    if (arch.screens.length >= 2 && !ROUTER_RE.test(routingHaystack)) {
      found.push(issue({
        code: 'app-router-missing', dimension: 'navigation', severity: 'blocker', priority: 2,
        label: 'Multi-screen app has no router',
        evidence: `The app declares ${arch.screens.length} screens but no client router is wired in src/App.tsx or src/app/routes.tsx.`,
        repairInstruction: `Wire react-router (already available) in src/App.tsx so every planned screen has a real route and the navigation actually changes screens.`,
        files: ['src/App.tsx'], blocking: true,
      }));
    }

    /* ── P2 — RENDERED navigation truth. The runtime operated the primary navigation
     *        controls; if controls exist but none of them changed the rendered screen, the
     *        navigation is decorative. This is the single strongest app-quality fact and it
     *        cannot be inferred from source. ── */
    const navProbes = shots.filter((s) => typeof s.navProbedCount === 'number' && (s.navProbedCount ?? 0) > 0);
    if (navProbes.length) {
      const probed = Math.max(...navProbes.map((s) => s.navProbedCount ?? 0));
      const working = Math.max(...navProbes.map((s) => s.navWorkingCount ?? 0));
      if (working === 0) {
        const conclusive = probed >= NAV_PROBE_BLOCK_MIN;
        found.push(issue({
          code: 'app-nav-dead', dimension: 'navigation', severity: conclusive ? 'blocker' : 'major', priority: 2,
          label: 'Primary navigation does not work',
          evidence: `${probed} primary navigation control(s) were operated in the rendered app and none of them changed the route or the rendered screen.`,
          repairInstruction: `Make every primary navigation control actually navigate: bind it to the router (NavLink/navigate) so activating it renders the target screen.`,
          files: ['src/App.tsx'], rendered: true, blocking: conclusive,
        }));
      } else if (working < probed) {
        found.push(issue({
          code: 'app-nav-dead', dimension: 'navigation', severity: 'major', priority: 2,
          label: 'Some navigation controls are dead',
          evidence: `${probed - working} of ${probed} primary navigation control(s) did not change the route or the rendered screen when operated.`,
          repairInstruction: `Wire the navigation controls that do nothing to their target routes, or remove the affordance so the app shows no fake navigation.`,
          files: ['src/App.tsx'], rendered: true,
        }));
      }
    }

    /* ── P2/P3 — RENDERED navigation reachability at phone widths. A sidebar that simply
     *        disappears below its breakpoint, with no menu/drawer trigger, leaves the phone
     *        layout with no way to change screens. ── */
    const narrow = narrowShots(shots);
    const navMeasuredNarrow = narrow.filter((s) => typeof s.navReachable === 'boolean');
    if (arch.screens.length >= 2 && navMeasuredNarrow.length && navMeasuredNarrow.every((s) => s.navReachable === false)) {
      const w = Math.min(...navMeasuredNarrow.map(widthOf));
      found.push(issue({
        code: 'app-nav-unreachable-narrow', dimension: 'responsive', severity: 'blocker', priority: 3,
        label: 'No navigation at phone width',
        evidence: `At ${w}px the rendered app exposes no reachable navigation control (no visible nav items and no menu/drawer trigger).`,
        repairInstruction: `Adapt the app shell responsively: below the sidebar breakpoint expose bottom tabs or a menu/drawer trigger so every top-level screen stays reachable on a phone.`,
        // The shell owns the responsive navigation, so the repair is scoped to it rather than
        // left file-less (a file-less obligation gives the bounded repair nothing to target).
        files: ['src/App.tsx'], rendered: true, blocking: true,
      }));
    }

    /* ── P3 — RENDERED clipping. Content that is cut off (an element whose own content
     *        overflows its box without a scroll affordance) is measured, not inferred. ── */
    const clipped = shots.filter((s) => (s.clippedElementCount ?? 0) > 0);
    if (clipped.length) {
      const worst = clipped.reduce((a, b) => ((b.clippedElementCount ?? 0) > (a.clippedElementCount ?? 0) ? b : a));
      const n = worst.clippedElementCount ?? 0;
      // Clipped content at a phone width is a severe responsive failure regardless of count;
      // at desktop it takes more than one occurrence to be conclusive.
      const clippedNarrow = clipped.some((s) => widthOf(s) > 0 && widthOf(s) <= NARROW_WIDTH_MAX);
      const severe = clippedNarrow || n >= CLIPPED_WIDE_BLOCK_THRESHOLD;
      found.push(issue({
        code: 'app-content-clipped', dimension: 'responsive', severity: severe ? 'blocker' : 'major', priority: 3,
        label: 'Content is clipped',
        evidence: `${n} element(s) render with content cut off at ${widthOf(worst)}px (their content is wider than their box with no scroll affordance).`,
        repairInstruction: `Let the affected regions wrap or scroll at narrow widths (min-w-0, flex-wrap, overflow-x-auto on the table/row) so no content is cut off.`,
        // Clipping is a layout fact without a single owning file, so the obligation is scoped to
        // the shell plus the screens — the surfaces that can actually carry the fix.
        files: ['src/App.tsx', ...screens.map((f) => f.path)], rendered: true, blocking: severe,
      }));
    }

    /* ── P3 — fixed-width desktop assumptions in source (no responsive escape). ── */
    const fixed = findFixedWidths(ui);
    if (fixed.paths.length) {
      found.push(issue({
        code: 'app-fixed-width', dimension: 'responsive', severity: 'major', priority: 3,
        label: 'Fixed-width desktop layout',
        evidence: `${fixed.count} hard pixel width(s) up to ${fixed.maxPx}px are declared with no responsive width, max-width or breakpoint in the same file: ${fixed.paths.slice(0, 3).join(', ')}.`,
        repairInstruction: `Replace the hard pixel widths with fluid widths (w-full + max-w-*) or breakpoint variants so the layout adapts from 1440px down to 390px.`,
        files: fixed.paths,
      }));
    }

    /* ── P4 — RENDERED touch targets at phone widths. ── */
    const targetShots = narrow.filter((s) => typeof s.smallTouchTargetCount === 'number');
    if (targetShots.length) {
      const worst = targetShots.reduce((a, b) => ((b.smallTouchTargetCount ?? 0) > (a.smallTouchTargetCount ?? 0) ? b : a));
      const n = worst.smallTouchTargetCount ?? 0;
      if (n >= SMALL_TARGET_BLOCK_THRESHOLD) {
        found.push(issue({
          code: 'app-touch-target', dimension: 'accessibility', severity: 'major', priority: 4,
          label: 'Touch targets too small on phone',
          evidence: `${n} interactive control(s) render smaller than 32px on their shortest side at ${widthOf(worst)}px.`,
          repairInstruction: `Give interactive controls an adequate hit area at phone widths (min-height/min-width ≈ 40px, or padding that reaches it) without changing the desktop density.`,
          files: ['src/App.tsx', ...screens.map((f) => f.path)], rendered: true,
        }));
      }
    }

    /* ── P2 — dead controls (source). Composes the EXISTING screen-depth detector. ── */
    const deadPaths: string[] = [];
    let deadCount = 0;
    for (const s of arch.screens) {
      const path = `src/screens/${screenComponentName(s.id)}.tsx`;
      const file = byPath.get(path);
      if (!file) continue;
      const dead = findDeadControls(s.id, file.content);
      if (dead.length) { deadCount += dead.length; deadPaths.push(path); }
    }
    if (deadCount > 0) {
      const blocking = deadCount >= DEAD_CONTROL_BLOCK_THRESHOLD;
      found.push(issue({
        code: 'app-dead-control', dimension: 'interaction', severity: blocking ? 'blocker' : 'major', priority: 2,
        label: 'Interactive controls do nothing',
        evidence: `${deadCount} interactive control(s) across ${deadPaths.length} screen(s) carry no event handler, so operating them has no effect: ${deadPaths.slice(0, 3).join(', ')}.`,
        repairInstruction: `Wire each listed control to a handler that updates local state and produces a visible consequence, or remove the control so the app shows no dead affordance.`,
        files: deadPaths, blocking,
      }));
    }

    /* ── P2/P4/P5 — the EXISTING premium-UI detectors, promoted from advisory warnings to
     *        first-class app-quality issues with an explicit priority. No new detector. ── */
    const uiFindings = detectAppUiQuality({
      files: files.map((f) => ({ path: f.path, content: f.content, language: f.language })),
      appType: arch.appType,
      colorMode: input.colorMode,
    });
    for (const uf of uiFindings) {
      switch (uf.code) {
        case 'app-navigation-active-state':
          found.push(issue({
            code: 'app-nav-active-state', dimension: 'navigation', severity: 'major', priority: 2,
            label: 'No active-route indication',
            evidence: uf.message, files: uf.files,
            repairInstruction: `Indicate the current route on the navigation (NavLink isActive / aria-current + a distinct active treatment) so the user always knows where they are.`,
          }));
          break;
        case 'app-interaction-state-missing':
          found.push(issue({
            code: 'app-interaction-state-missing', dimension: 'interaction', severity: 'major', priority: 2,
            label: 'Tabs do not switch',
            evidence: uf.message, files: uf.files,
            repairInstruction: `Track the selected tab in state and render the matching panel so switching a tab visibly changes the content.`,
          }));
          break;
        case 'app-surface-theme-mismatch':
          found.push(issue({
            code: 'app-surface-theme-mismatch', dimension: 'accessibility', severity: 'major', priority: 4,
            label: 'Light popup surface in a dark app',
            evidence: uf.message, files: uf.files,
            repairInstruction: `Give the menu/dialog/popover surfaces the app's own dark palette so no browser-default light surface opens over the UI.`,
          }));
          break;
        case 'app-native-control-theme':
          found.push(issue({
            code: 'app-native-control-theme', dimension: 'accessibility', severity: 'minor', priority: 4,
            label: 'Unthemed native control',
            evidence: uf.message, files: uf.files,
            repairInstruction: `Style the control from the design system (or use the available Radix primitive) so its trigger and its open surface both inherit the theme.`,
          }));
          break;
        case 'app-generic-dashboard-pattern':
          found.push(issue({
            code: 'app-generic-dashboard', dimension: 'composition', severity: 'major', priority: 5,
            label: 'Wall of identical KPI cards',
            evidence: uf.message, files: uf.files,
            repairInstruction: `Give the screen one dominant panel (the real content for this product) and reduce the repeated stat cards to a supporting row — do not add a new page or remove features.`,
          }));
          break;
        case 'app-button-hierarchy':
          found.push(issue({
            code: 'app-button-hierarchy', dimension: 'composition', severity: 'minor', priority: 5,
            label: 'No action hierarchy',
            evidence: uf.message, files: uf.files,
            repairInstruction: `Keep one dominant primary action per view and restyle the rest as secondary/ghost so the primary action reads first.`,
          }));
          break;
        default:
          break;
      }
    }

    /* ── P5 — screen uniformity: several screens rendering the identical structural shape. ── */
    if (screens.length >= UNIFORM_SCREEN_THRESHOLD) {
      const bySignature = new Map<string, string[]>();
      for (const f of screens) {
        const sig = compositionSignature(f.content);
        const list = bySignature.get(sig) || [];
        list.push(f.path);
        bySignature.set(sig, list);
      }
      for (const [sig, paths] of bySignature) {
        if (paths.length >= UNIFORM_SCREEN_THRESHOLD && paths.length >= Math.ceil(screens.length * 0.6)) {
          found.push(issue({
            code: 'app-screen-uniformity', dimension: 'composition', severity: 'major', priority: 5,
            label: 'Every screen is the same shape',
            evidence: `${paths.length} of ${screens.length} screens render the identical structural composition (${sig}): ${paths.slice(0, 3).join(', ')}.`,
            repairInstruction: `Compose each screen for its own job — a list screen leads with its list and filters, a detail screen with the record, a calendar with the period — instead of repeating one card grid.`,
            files: paths,
          }));
          break;                                       // one uniformity finding is enough
        }
      }
    }

    /* ── P5 — PRODUCT FIT. Uses ONLY the app type the planner already derived, and only the
     *        VISIBLE copy of the screens/components (never App.tsx or the route table, whose text
     *        is generated from the plan and therefore always "fits"). ── */
    if (screens.length > 0) {
      const fitFiles = ui.filter((f) => f.path !== 'src/App.tsx' && f.path !== 'src/app/routes.tsx');
      const fit = productFitEvidence(arch.appType, fitFiles);
      if (fit.applicable && fit.productHits === 0 && fit.dashboardHits > 0) {
        found.push(issue({
          code: 'app-product-fit', dimension: 'product-fit', severity: 'blocker', priority: 5,
          label: 'The app is not the requested product',
          evidence: `None of the ${fitFiles.length} generated UI files display any vocabulary of the requested product (${arch.appType}), while ${fit.dashboardHits} of them display generic analytics-dashboard copy instead.`,
          repairInstruction: `Rebuild the screen CONTENT around the requested product (${arch.productSummary}) using its real objects and actions instead of generic dashboard metrics. Change what the screens show, not the app structure.`,
          files: screens.slice(0, MAX_FILES_PER_ISSUE).map((f) => f.path), blocking: true,
        }));
      }
    }

    const issues = found
      .sort((a, b) => a.priority - b.priority)
      .slice(0, MAX_ISSUES);
    const blockingCount = issues.filter((i) => i.blocking).length;
    const renderedEvidence = shots.length > 0;
    const status: AppQualityStatus = blockingCount > 0 ? 'blocked' : issues.length ? 'issues' : 'pass';

    return {
      version: 'app-quality-v1',
      status,
      appType: arch.appType,
      screenCount: arch.screens.length,
      routeCount: input.navigation?.routes?.length ?? 0,
      issues,
      blockingCount,
      measuredWidths,
      renderedEvidence,
    };
  } catch {
    return SKIPPED;                                    // fail-open — never break a build
  }
}

/* ── Pipeline adapters (the SAME contract every other analyzer exposes) ─────────── */

/** Map an app dimension onto an EXISTING review category so findings ride the EXISTING
 *  bounded repair. No new repair category is introduced. */
const DIMENSION_TO_CATEGORY: Record<AppQualityDimension, FrontendBuilderReviewCategory> = {
  structure: 'contract-fidelity',
  navigation: 'motion-and-interaction',
  interaction: 'motion-and-interaction',
  responsive: 'responsive-intent',
  accessibility: 'accessibility-intent',
  composition: 'component-composition',
  'product-fit': 'concept-fidelity',
};

/**
 * Convert app-quality findings into review issues for the EXISTING single bounded repair.
 *
 * Every issue is tagged `gateCritical` so a blocking app obligation is never collapsed away by
 * the category dedup when it collides with another finding that shares its review category —
 * the same guarantee the web analyzers already get. Ordered by priority so the most damaging
 * obligation is first in the bounded selection.
 */
export function appQualityToReviewIssues(
  result: AppQualityAcceptanceResult | undefined,
): FrontendBuilderReviewIssue[] {
  if (!result || result.version !== 'app-quality-v1') return [];
  return result.issues
    .slice()
    .sort((a, b) => a.priority - b.priority)
    .map((i) => ({
      id: `app:${i.code}`.slice(0, 80),
      severity: i.severity,
      category: DIMENSION_TO_CATEGORY[i.dimension] || 'contract-fidelity',
      files: i.files.slice(0, MAX_FILES_PER_ISSUE),
      evidence: cut(`App quality (P${i.priority}, ${i.rendered ? 'rendered' : 'static'}): ${i.evidence}`, 240),
      repairInstruction: i.repairInstruction,
      gateCritical: true,
    }));
}

/** True when an app-quality finding must reject approval / a repair. Fails open to false. */
export function hasBlockingAppQualityFindings(result: AppQualityAcceptanceResult | undefined): boolean {
  return !!result && result.version === 'app-quality-v1' && result.blockingCount > 0;
}

/** Bounded issue codes for the rejection message + diagnostics. */
export function appQualityIssueCodes(result: AppQualityAcceptanceResult | undefined): string[] {
  if (!result || result.version !== 'app-quality-v1') return [];
  return result.issues.map((i) => i.code).slice(0, 8);
}

/** The total finding count — used by best-candidate selection as a deterministic dimension so a
 *  repair that adds app defects (without adding a BLOCKING one) can never be promoted. */
export function appQualityIssueCount(result: AppQualityAcceptanceResult | undefined): number {
  if (!result || result.version !== 'app-quality-v1') return 0;
  return result.issues.length;
}

/** Bounded, secret-free diagnostics for the acceptance artifact. */
export function buildAppQualityDiagnostics(
  initial: AppQualityAcceptanceResult | undefined,
  postRepair?: AppQualityAcceptanceResult | undefined,
): AppQualityDiagnostics | undefined {
  const primary = postRepair && postRepair.version === 'app-quality-v1' ? postRepair : initial;
  if (!initial || initial.version !== 'app-quality-v1' || initial.status === 'skipped') return undefined;
  return {
    version: 'app-quality-diagnostics-v1',
    ...(primary?.appType ? { appType: primary.appType } : {}),
    screenCount: primary?.screenCount ?? initial.screenCount,
    routeCount: primary?.routeCount ?? initial.routeCount,
    initialStatus: initial.status,
    ...(postRepair && postRepair.version === 'app-quality-v1' ? { postRepairStatus: postRepair.status } : {}),
    initialIssueCount: initial.issues.length,
    ...(postRepair && postRepair.version === 'app-quality-v1' ? { postRepairIssueCount: postRepair.issues.length } : {}),
    initialBlockingCount: initial.blockingCount,
    ...(postRepair && postRepair.version === 'app-quality-v1' ? { postRepairBlockingCount: postRepair.blockingCount } : {}),
    issueCodes: appQualityIssueCodes(primary),
    measuredWidths: (primary?.measuredWidths ?? []).slice(0, 8),
    renderedEvidence: primary?.renderedEvidence === true,
  };
}
