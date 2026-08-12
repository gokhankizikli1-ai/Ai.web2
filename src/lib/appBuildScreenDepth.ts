/**
 * App Build — Screen Depth & App Completeness authority (Phase 3).
 *
 * The Web Build has a SiteDepthContract that asks "is this a COMPLETE, usable website
 * of its type, or a landing page that ends before the visitor can decide?". An app has
 * the same failure mode one level down: a screen that is a heading-only SHELL rather
 * than a usable screen, a control that goes nowhere, or a front-end that lies about a
 * real backend. This authority GENERALIZES those principles for a multi-screen app —
 * it does not copy the site-depth code.
 *
 * It owns two things:
 *   1. A DEPTH CONTRACT (planning): per screen, the substance a screen of that role
 *      must actually render to be real, the app interaction patterns in play, and the
 *      honest-simulation rules (never fake payments / emails / accounts / remote
 *      saves). Depth is role-derived, never a universal count; an intentionally-simple
 *      utility is never forced into browse depth.
 *   2. A CONSERVATIVE COMPLETENESS ANALYSIS (acceptance): over the generated files,
 *      flags a heading-only screen shell, and a dishonest "backend success" claim.
 *      Structural + fail-open — it never blocks on ambiguous or dynamic code.
 *
 * The state LIFECYCLE itself is owned by the App Architecture screen `states`
 * (role-derived) and enforced through the shared binding/experience layer — this
 * module does not re-analyze interactions; it checks depth + honesty. Pure,
 * deterministic, bounded, network-free, JSON-serializable. Type-only imports.
 */
import type {
  AppArchitectureContract, AppArchetype, ScreenRole, AppScreenSpec,
} from '@/lib/appBuildArchitecture';

/* ── Public types ───────────────────────────────────────────────────────────── */

/** The concrete substance a screen of a given role must render to be a real screen. */
export type SubstanceSignal =
  | 'list-items' | 'record-fields' | 'form-fields' | 'metrics' | 'chart'
  | 'primary-action' | 'empty-state' | 'result-output';

/** App interaction patterns a screen may use (supported, honest, front-end only). */
export type AppInteractionPattern =
  | 'tabs' | 'sidebar' | 'search' | 'filter' | 'list-detail' | 'form'
  | 'accordion' | 'modal' | 'sheet' | 'segmented' | 'toggle' | 'onboarding';

export interface ScreenDepthExpectation {
  screenId: string;
  role: ScreenRole;
  /** Substance signals expected for this screen to be considered real (role-derived). */
  expects: SubstanceSignal[];
  /** Interaction patterns this screen legitimately uses. */
  interactionPatterns: AppInteractionPattern[];
  /** True for a screen that is legitimately thin (a single-purpose utility). */
  intentionallyMinimal: boolean;
}

export interface ScreenDepthContract {
  version: 'app-screen-depth-v1';
  status: 'derived';
  archetype: AppArchetype;
  intentionallySimple: boolean;
  screens: ScreenDepthExpectation[];
  /** The app-wide interaction patterns in play (deduped union). */
  interactionPatterns: AppInteractionPattern[];
  /** Honest-simulation rules — front-end simulation only, never a real backend claim. */
  honestSimulation: string[];
  notes: string[];
}

/* ── Analysis (acceptance) types ─────────────────────────────────────────────── */

export type AppCompletenessCode =
  | 'screen-shell-thin' | 'entry-screen-empty' | 'fake-backend-claim';

export interface AppCompletenessIssue {
  code: AppCompletenessCode;
  screenId?: string;
  message: string;
  severity: 'minor' | 'major';
}

export interface AppCompletenessResult {
  status: 'pass' | 'fail';
  /** True only when the analysis actually ran against real inputs (not failed-open). */
  legacy: boolean;
  intentionallySimple: boolean;
  screensSubstantive: number;
  issues: AppCompletenessIssue[];
}

export interface AppSourceFile { path: string; content: string }

/* ── Bounded helpers ────────────────────────────────────────────────────────── */

const CAP = 16;
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
function dedupePatterns(xs: AppInteractionPattern[]): AppInteractionPattern[] {
  const seen = new Set<AppInteractionPattern>(); const out: AppInteractionPattern[] = [];
  for (const p of xs) { if (!seen.has(p)) { seen.add(p); out.push(p); } }
  return out;
}

/* ── Role → expected substance + interaction patterns ────────────────────────── */

function substanceForRole(role: ScreenRole): SubstanceSignal[] {
  switch (role) {
    case 'entry-overview':       return ['metrics', 'primary-action'];
    case 'progress-analytics':   return ['chart', 'metrics'];
    case 'list-browse':          return ['list-items', 'empty-state', 'primary-action'];
    case 'board-pipeline':       return ['list-items', 'primary-action'];
    case 'feed':                 return ['list-items', 'empty-state'];
    case 'search':               return ['list-items', 'empty-state'];
    case 'detail':               return ['record-fields', 'primary-action'];
    case 'create-edit-form':     return ['form-fields', 'primary-action'];
    case 'workflow-flow':        return ['form-fields', 'primary-action'];
    case 'settings-profile':     return ['form-fields', 'primary-action'];
    case 'utility-primary':      return ['result-output', 'primary-action'];
    default:                     return ['primary-action'];
  }
}

function patternsForRole(role: ScreenRole): AppInteractionPattern[] {
  const base: AppInteractionPattern[] = [];
  switch (role) {
    case 'list-browse':      base.push('list-detail', 'search', 'filter'); break;
    case 'board-pipeline':   base.push('list-detail', 'filter'); break;
    case 'feed':             base.push('list-detail'); break;
    case 'search':           base.push('search', 'filter', 'list-detail'); break;
    case 'detail':           base.push('list-detail'); break;
    case 'create-edit-form': base.push('form', 'toggle'); break;
    case 'workflow-flow':    base.push('form', 'segmented'); break;
    case 'settings-profile': base.push('form', 'toggle', 'accordion'); break;
    case 'entry-overview':   base.push('segmented'); break;
    case 'progress-analytics': base.push('segmented'); break;
    default: break;
  }
  return base;
}

/* ── Derivation: ScreenDepthContract ─────────────────────────────────────────── */

const HONEST_SIMULATION_RULES = [
  'Simulate all state on the front end only (local state / in-memory data).',
  'Never claim a real payment, charge, email send, SMS, account creation or server save.',
  'A "submit"/"save"/"pay"/"book" action updates LOCAL state and shows an honest simulated confirmation — it never asserts a real backend completed.',
  'Do not display fake success for an operation the app cannot actually perform.',
];

export function deriveScreenDepthContract(
  architecture: AppArchitectureContract | undefined,
): ScreenDepthContract | undefined {
  if (!architecture || architecture.status !== 'derived' || !architecture.screens.length) return undefined;
  try {
    const screens: ScreenDepthExpectation[] = architecture.screens.map((s) => ({
      screenId: s.id,
      role: s.role,
      expects: substanceForRole(s.role),
      interactionPatterns: patternsForRole(s.role),
      intentionallyMinimal: architecture.intentionallySimple || s.role === 'utility-primary',
    }));
    const appWide = dedupePatterns([
      ...(architecture.shell === 'sidebar-app' ? ['sidebar' as AppInteractionPattern] : []),
      ...(architecture.shell === 'tabbed-app' ? ['tabs' as AppInteractionPattern] : []),
      ...screens.flatMap((s) => s.interactionPatterns),
    ]);
    const notes = clean([
      `Depth is role-derived across ${screens.length} screen(s); not a universal count.`,
      architecture.intentionallySimple ? 'Intentionally simple — do not add browse/list depth this product does not need.' : undefined,
    ], 4);
    return {
      version: 'app-screen-depth-v1',
      status: 'derived',
      archetype: architecture.archetype,
      intentionallySimple: architecture.intentionallySimple,
      screens,
      interactionPatterns: appWide,
      honestSimulation: HONEST_SIMULATION_RULES.slice(),
      notes,
    };
  } catch {
    return undefined;
  }
}

/* ── Conservative completeness analysis (acceptance) ─────────────────────────── */

/** Heuristic substance detectors over a screen's rendered source. Conservative and
 *  fail-open: dynamic rendering (.map / template loops / data arrays) counts as real. */
function screenLooksSubstantive(content: string, expects: SubstanceSignal[]): boolean {
  const c = content || '';
  // Dynamic rendering is always treated as real (never a false "thin" block).
  if (/\.map\s*\(|\bfor\s*\(|\{items|\{data|\brows\b|\bentries\b/.test(c)) return true;
  const has = {
    list: /<(ul|ol|table|li|tr)\b|role=["']list["']|grid|<Card\b/i.test(c),
    fields: /<(input|select|textarea|label)\b|<Field\b|<Form\b/i.test(c),
    metric: /<(canvas|svg)\b|chart|\bkpi\b|stat(?:istic)?|<Metric\b|%|\$\d/i.test(c),
    result: /result|output|=\s*\{?\s*\w+\s*[+\-*/]|total|<output\b/i.test(c),
    action: /<button\b|onClick|role=["']button["']|<a\b|<Link\b/i.test(c),
    interactive: /<(input|select|textarea|button|a|Link)\b|onClick|onChange|onSubmit/i.test(c),
  };
  // A screen with any interactive control + more than a bare heading is substantive.
  const headingOnly = /<h[1-6][^>]*>[^<]*<\/h[1-6]>/i.test(c)
    && !has.interactive && !has.list && !has.fields;
  if (headingOnly) return false;
  // Otherwise require at least ONE of the expected substance signals to be present.
  for (const e of expects) {
    if (e === 'list-items' && has.list) return true;
    if ((e === 'record-fields' || e === 'form-fields') && has.fields) return true;
    if ((e === 'metrics' || e === 'chart') && has.metric) return true;
    if (e === 'result-output' && (has.result || has.fields)) return true;
    if (e === 'primary-action' && has.action) return true;
    if (e === 'empty-state') return true; // empty-state is optional evidence, never a block
  }
  // Fallback: any interactive control at all is enough to not be a shell.
  return has.interactive;
}

/** A dishonest "the backend really did it" claim (front-end apps must not assert this).
 *  Conservative: matches explicit success sentences, not honest simulated wording. */
const FAKE_BACKEND_RE =
  /(payment (?:successful|processed|complete)|charged your card|order has been placed and paid|email (?:has been )?sent to|we(?:'ve| have) emailed you|account (?:created|registered) successfully|saved to (?:the )?server|synced to (?:the )?cloud|data (?:has been )?saved to your account)/i;
/** Honest simulation framing that neutralizes a nearby success word. */
const SIMULATED_RE = /simulat|demo|front-?end only|local(?:ly)?|no (?:real|actual) (?:payment|charge|backend|server)|this is a (?:prototype|preview)/i;

function findScreenContent(files: AppSourceFile[], screen: AppScreenSpec | undefined): string | undefined {
  if (!screen) return undefined;
  const id = screen.id.toLowerCase();
  const name = (screen.name || '').toLowerCase();
  const hit = files.find((f) => {
    const p = (f.path || '').toLowerCase();
    return p.includes(id) || (name && p.includes(name.replace(/\s+/g, '')));
  });
  return hit?.content;
}

export function analyzeAppCompleteness(
  files: AppSourceFile[] | undefined,
  architecture: AppArchitectureContract | undefined,
  depth: ScreenDepthContract | undefined,
): AppCompletenessResult {
  const intentionallySimple = !!(architecture?.intentionallySimple || depth?.intentionallySimple);
  // Fail-open: without real inputs there is nothing to fault.
  if (!architecture || !depth || !Array.isArray(files) || files.length === 0) {
    return { status: 'pass', legacy: false, intentionallySimple, screensSubstantive: 0, issues: [] };
  }
  try {
    const issues: AppCompletenessIssue[] = [];
    let substantive = 0;

    for (const exp of depth.screens) {
      const screen = architecture.screens.find((s) => s.id === exp.screenId);
      const content = findScreenContent(files, screen);
      if (content === undefined) continue; // screen file not found → do not fault (fail-open)
      const ok = screenLooksSubstantive(content, exp.expects);
      if (ok) { substantive += 1; continue; }
      // A thin screen. The entry screen being an empty shell is a MAJOR completeness gap;
      // a secondary screen is MINOR. An intentionally-minimal screen is never faulted.
      if (exp.intentionallyMinimal) { substantive += 1; continue; }
      const isEntry = architecture.entryScreenId === exp.screenId;
      issues.push({
        code: isEntry ? 'entry-screen-empty' : 'screen-shell-thin',
        screenId: exp.screenId,
        message: isEntry
          ? `The entry screen "${exp.screenId}" renders only a heading — it must show real ${exp.expects.join('/')}.`
          : `Screen "${exp.screenId}" is a heading-only shell — it must render real ${exp.expects.join('/')}.`,
        severity: isEntry ? 'major' : 'minor',
      });
    }

    // Honest-simulation check across all files: a bare backend-success claim with no
    // simulated framing nearby is a dishonest-simulation defect.
    for (const f of files) {
      const c = f.content || '';
      const m = FAKE_BACKEND_RE.exec(c);
      if (m) {
        const start = Math.max(0, m.index - 160);
        const window = c.slice(start, m.index + m[0].length + 160);
        if (!SIMULATED_RE.test(window)) {
          issues.push({
            code: 'fake-backend-claim',
            message: `A backend-success claim ("${m[0]}") appears without honest simulated framing in ${f.path}.`,
            severity: 'major',
          });
          break; // one honest-simulation finding is enough to flag repair
        }
      }
    }

    const hasMajor = issues.some((i) => i.severity === 'major');
    return {
      status: hasMajor ? 'fail' : (issues.length ? 'fail' : 'pass'),
      legacy: true,
      intentionallySimple,
      screensSubstantive: substantive,
      issues,
    };
  } catch {
    return { status: 'pass', legacy: false, intentionallySimple, screensSubstantive: 0, issues: [] };
  }
}

/** True when the completeness result carries a blocking (major) finding. */
export function hasBlockingAppCompletenessFindings(res: AppCompletenessResult | undefined): boolean {
  return !!res && res.status === 'fail' && res.issues.some((i) => i.severity === 'major');
}

/* ── Bounded builder block ───────────────────────────────────────────────────── */

const RENDER_CEIL = 2600;
function bound(lines: string[]): string[] {
  const out: string[] = []; let total = 0;
  for (const l of lines) { total += l.length + 1; if (total > RENDER_CEIL) break; out.push(l); }
  return out;
}

export function renderScreenDepthBlock(c: ScreenDepthContract | undefined): string[] {
  if (!c || c.status !== 'derived' || !c.screens.length) return [];
  const lines: string[] = [
    'APP SCREEN DEPTH & COMPLETENESS (binding — each screen must be USABLE, not a shell):',
    `Interaction patterns in play: ${c.interactionPatterns.join(', ') || 'minimal'}.`,
    'Per screen, render REAL substance (a heading alone is a defect):',
    ...c.screens.map((s) =>
      `- ${s.screenId} — must render: ${s.expects.join(', ')}${s.intentionallyMinimal ? ' (keep minimal)' : ''}`),
    'HONEST SIMULATION:',
    ...c.honestSimulation.map((r) => `- ${r}`),
    '',
  ];
  return bound(lines);
}
