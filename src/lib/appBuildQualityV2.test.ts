/**
 * APP BUILD QUALITY V2 — production-readiness validation.
 *
 * Every test here is a falsifiable statement about App Build behaviour, not coverage. Sections:
 *
 *   A. PLANNING VARIETY      different product types must produce different apps (anti-template)
 *   B. DEFECT DETECTION      intentionally defective candidates must be detected, per defect
 *   C. RENDERED TRUTH        app-only runtime facts, worst-across-viewport severity, app viewports
 *   D. CANDIDATE COMPARISON  the six required original-vs-repair outcomes
 *   E. GATE + PRIORITY       what blocks, what only reports, and the P0–P5 repair ordering
 *   F. WEB PARITY / SAFETY   Web Build must be untouched; Safe Preview must stay structural
 */
import { describe, it, expect } from 'vitest';
import {
  analyzeAppBuildQuality, appQualityToReviewIssues, hasBlockingAppQualityFindings,
  appQualityIssueCodes, appQualityIssueCount, buildAppQualityDiagnostics,
} from '@/lib/appBuildQuality';
import {
  deriveAppArchitectureContract, classifyAppType, directionFor, screenFilePath,
  renderAppArchitectureBlock, type AppArchitectureContract, type AppType,
} from '@/lib/appArchitecture';
import { deriveNavigationContract } from '@/lib/appNavigation';
import { evaluateRenderedVisual } from '@/lib/webBuildRenderedVisualEvaluation';
import { compareRenderedEvaluations, rendersWorseAfterRepair } from '@/lib/webBuildRenderRegression';
import { summarizeCandidate, selectBestCandidate, promotesUnapprovedRepair } from '@/lib/webBuildQualityCandidates';
import { evaluateAcceptanceGate } from '@/lib/webBuildAcceptanceGate';
import { deriveMeasureExpectations, APP_MEASURE_VIEWPORTS, DEFAULT_MEASURE_VIEWPORTS } from '@/lib/webBuildPreviewMeasurement';
import { sanitizeMeasurement } from '@/lib/visualEditProtocol';
import { selectBoundedRepairIssues } from '@/lib/webBuildApi';
import { mergeDeterministicIssues } from '@/lib/webBuildFrontendReview';
import { resolvePreviewMode, deriveModelNativeCandidate } from '@/lib/webBuildRuntimePreview';
import { analyzeOptimization } from '@/lib/webBuildOptimizationPass';
import type {
  FrontendGeneratedFile, RenderedScreenshotMeta, FrontendBuilderValidationArtifact,
  WebBuildCandidateSummary,
} from '@/lib/webBuildAgents';

/* ══ Fixtures ═════════════════════════════════════════════════════════════════════════════════ */

const file = (path: string, content: string): FrontendGeneratedFile => ({
  path,
  content,
  language: path.endsWith('.css') ? 'css' : path.endsWith('.ts') ? 'ts' : 'tsx',
  charCount: content.length,
  lineCount: content.split('\n').length,
});

/** A credible generated app: a wired router, a nav with active state, real domain vocabulary and
 *  distinct screen compositions. This is the HEALTHY baseline every defect fixture mutates. */
function healthyApp(arch: AppArchitectureContract, vocabulary: string[]): FrontendGeneratedFile[] {
  const screens = arch.screens;
  const navItems = arch.globalScreenIds
    .map((id) => `<NavLink to="/${id}" className={({ isActive }) => isActive ? 'active' : ''}>${id}</NavLink>`)
    .join('\n      ');
  const routes = screens
    .map((s) => `<Route path="/${s.id}" element={<${compName(s.id)} />} />`)
    .join('\n        ');
  const imports = screens.map((s) => `import ${compName(s.id)} from './screens/${compName(s.id)}';`).join('\n');
  const app = file('src/App.tsx', `import { BrowserRouter, Routes, Route, NavLink } from 'react-router';
${imports}

export default function App() {
  return (
    <BrowserRouter>
      <nav aria-label="Main">
      ${navItems}
      </nav>
      <main className="w-full max-w-6xl">
        <Routes>
        ${routes}
        </Routes>
      </main>
    </BrowserRouter>
  );
}
`);
  // Each screen gets a DIFFERENT structural shape, so the uniformity detector stays quiet on a
  // healthy app and only fires on the fixture that deliberately repeats one shape.
  const shapes = [
    (v: string) => `<table><tbody>{rows.map((r) => (<tr key={r.id}><td>{r.${v}}</td></tr>))}</tbody></table>`,
    (v: string) => `<form onSubmit={save}><input value={${v}} onChange={(e) => set(e.target.value)} /><button type="submit">Save</button></form>`,
    (v: string) => `<section><h2>{${v}}</h2><p className="max-w-prose">{detail}</p><button onClick={act}>Act</button></section>`,
    (v: string) => `<ul>{items.map((i) => (<li key={i.id}>{i.${v}}</li>))}</ul>`,
    (v: string) => `<div className="w-full"><LineChart data={${v}} /></div>`,
  ];
  const screenFiles = screens.map((s, i) => {
    const term = vocabulary[i % vocabulary.length];
    return file(screenFilePath(s.id), `import { useState } from 'react';

export default function ${compName(s.id)}() {
  const [${term}, set] = useState('');
  const rows = []; const items = []; const detail = ''; const save = () => {}; const act = () => {};
  return (
    <div className="w-full max-w-5xl">
      <h1>${s.name}</h1>
      ${shapes[i % shapes.length](term)}
      <button onClick={act}>${s.primaryAction}</button>
    </div>
  );
}
`);
  });
  return [
    file('src/main.tsx', "import App from './App';\nexport default App;"),
    app,
    ...screenFiles,
    file('src/styles.css', ':root { --bg: #0b0f19; }'),
  ];
}

function compName(id: string): string {
  const pascal = id.split(/[^a-z0-9]+/i).filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('') || 'Screen';
  return /screen$/i.test(pascal) ? pascal : `${pascal}Screen`;
}

function archFor(prompt: string): AppArchitectureContract {
  const a = deriveAppArchitectureContract({ prompt });
  if (!a) throw new Error(`no architecture derived for: ${prompt}`);
  return a;
}

const VOCAB: Record<string, string[]> = {
  crm: ['contact', 'deal', 'pipeline', 'lead', 'account'],
  booking: ['booking', 'appointment', 'client', 'slot', 'schedule'],
  productivity: ['task', 'project', 'due', 'subtask', 'checklist'],
  'media-content': ['article', 'playlist', 'library', 'episode', 'feed'],
  'ecommerce-admin': ['order', 'product', 'inventory', 'sku', 'refund'],
  messaging: ['message', 'conversation', 'thread', 'inbox', 'reply'],
  fitness: ['workout', 'exercise', 'program', 'progress', 'streak'],
  'analytics-dashboard': ['metric', 'report', 'segment', 'trend', 'conversion'],
  'generic-app': ['item', 'record', 'entry', 'detail', 'note'],
  utility: ['value', 'result', 'input', 'history', 'unit'],
};

function analyze(
  arch: AppArchitectureContract,
  files: FrontendGeneratedFile[],
  screenshots?: RenderedScreenshotMeta[],
) {
  return analyzeAppBuildQuality({
    files,
    architecture: arch,
    navigation: deriveNavigationContract(arch),
    screenshots,
  });
}

function shot(
  viewport: RenderedScreenshotMeta['viewport'],
  width: number,
  over: Partial<RenderedScreenshotMeta> = {},
): RenderedScreenshotMeta {
  return {
    viewport, width, height: 800, contentHeight: 1600,
    horizontalOverflow: false, whitespaceRatio: 0.2, blank: false, runtimeError: false,
    ...over,
  };
}

/* ══ A. PLANNING VARIETY — different products must produce different apps ═════════════════════
 * The single biggest App Build complaint was that every prompt produced the same left-sidebar +
 * KPI-cards dashboard. These tests make "the plan actually differs per product" falsifiable. */

describe('A. planning produces genuinely different apps per product type', () => {
  const PROMPTS: Array<[string, AppType]> = [
    ['Build a personal productivity task manager with projects and due dates', 'productivity'],
    ['Build a marketplace admin for orders, products and inventory', 'ecommerce-admin'],
    ['Build a booking management app for appointments and clients', 'booking'],
    ['Build a content community app for browsing articles and building a library', 'media-content'],
    ['Build a CRM for a small sales team with contacts and deals', 'crm'],
  ];

  it('classifies each representative product correctly', () => {
    for (const [prompt, expected] of PROMPTS) {
      expect(classifyAppType(prompt)).toBe(expected);
    }
  });

  it('gives each product a different shell, screen set and product direction', () => {
    const shells = new Set<string>();
    const screenSets = new Set<string>();
    const directions = new Set<string>();
    for (const [prompt] of PROMPTS) {
      const a = archFor(prompt);
      shells.add(a.shell);
      screenSets.add(a.screens.map((s) => s.id).sort().join(','));
      directions.add(JSON.stringify(a.direction));
    }
    // Five products must NOT collapse onto one shell / one screen set / one direction.
    expect(shells.size).toBeGreaterThanOrEqual(3);
    expect(screenSets.size).toBe(PROMPTS.length);
    expect(directions.size).toBe(PROMPTS.length);
  });

  it('every archetype direction differs on every axis from the generic one', () => {
    const generic = directionFor('generic-app');
    const types: AppType[] = ['crm', 'booking', 'messaging', 'media-content', 'fitness', 'utility'];
    for (const t of types) {
      const d = directionFor(t);
      expect(d.navigationModel).not.toBe(generic.navigationModel);
      expect(d.primaryInteractionModel).not.toBe(generic.primaryInteractionModel);
      expect(d.screenHierarchy).not.toBe(generic.screenHierarchy);
      expect(d.visualCharacter).not.toBe(generic.visualCharacter);
    }
  });

  it('does NOT funnel an unclassified SaaS product into a KPI dashboard', () => {
    // The previous identity tie-breaker sent every subscription/AI-SaaS-shaped prompt to
    // `analytics-dashboard` (sidebar + KPI tiles + charts), which is the structural reason
    // unrelated prompts kept producing the same app.
    const identity = { sector: 'ai-saas', businessModel: 'subscription-product' } as never;
    expect(classifyAppType('Build an app that helps teams share short updates', identity)).toBe('generic-app');
    // An explicit analytics request still classifies as one.
    expect(classifyAppType('Build a metrics dashboard for subscription analytics', identity)).toBe('analytics-dashboard');
  });

  it('states the product direction in the generation block and forbids the default AI-SaaS look', () => {
    const block = renderAppArchitectureBlock(archFor('Build a booking management app')).join('\n');
    expect(block).toContain('Product direction for THIS app type');
    expect(block).toContain('Navigation model:');
    expect(block).toContain('Primary interaction:');
    expect(block).toMatch(/Do NOT default to the generic AI-SaaS app look/);
  });
});

/* ══ B. DEFECT DETECTION — intentionally defective candidates ════════════════════════════════ */

describe('B. a healthy app is clean; each intentional defect is detected', () => {
  it('a healthy, well-composed app produces no blocking app-quality finding', () => {
    for (const prompt of [
      'Build a CRM for a small sales team with contacts and deals',
      'Build a booking management app for appointments and clients',
      'Build a personal productivity task manager with projects',
      'Build a content community app for browsing articles',
      'Build a marketplace admin for orders and inventory',
    ]) {
      const arch = archFor(prompt);
      const res = analyze(arch, healthyApp(arch, VOCAB[arch.appType] || VOCAB['generic-app']));
      expect(
        { prompt, codes: appQualityIssueCodes(res) },
      ).toEqual({ prompt, codes: expect.not.arrayContaining(['app-screen-unreachable', 'app-router-missing', 'app-product-fit']) });
      expect(hasBlockingAppQualityFindings(res)).toBe(false);
    }
  });

  it('detects an UNREACHABLE screen (generated but never routed)', () => {
    const arch = archFor('Build a CRM for a small sales team');
    const files = healthyApp(arch, VOCAB.crm);
    const orphan = arch.screens[arch.screens.length - 1];
    const app = files.find((f) => f.path === 'src/App.tsx')!;
    const stripped = app.content
      .split('\n')
      .filter((l) => !l.includes(compName(orphan.id)))
      .join('\n');
    const res = analyze(arch, files.map((f) => (f.path === 'src/App.tsx' ? file(f.path, stripped) : f)));
    expect(appQualityIssueCodes(res)).toContain('app-screen-unreachable');
    expect(hasBlockingAppQualityFindings(res)).toBe(true);
  });

  it('detects a MISSING ROUTER in a multi-screen app', () => {
    const arch = archFor('Build a CRM for a small sales team');
    const files = healthyApp(arch, VOCAB.crm).map((f) =>
      f.path === 'src/App.tsx'
        ? file(f.path, `${arch.screens.map((s) => `import ${compName(s.id)} from './screens/${compName(s.id)}';`).join('\n')}
export default function App() { return <div>${arch.screens.map((s) => `<${compName(s.id)} />`).join('')}</div>; }`)
        : f);
    const res = analyze(arch, files);
    expect(appQualityIssueCodes(res)).toContain('app-router-missing');
    expect(hasBlockingAppQualityFindings(res)).toBe(true);
  });

  it('detects DEAD navigation from RENDERED truth (controls exist, none navigate)', () => {
    const arch = archFor('Build a CRM for a small sales team');
    const files = healthyApp(arch, VOCAB.crm);
    const res = analyze(arch, files, [shot('desktop', 1440, { navProbedCount: 4, navWorkingCount: 0 })]);
    expect(appQualityIssueCodes(res)).toContain('app-nav-dead');
    expect(hasBlockingAppQualityFindings(res)).toBe(true);
    // The source alone could never have found this — the same files with a working probe are clean.
    const working = analyze(arch, files, [shot('desktop', 1440, { navProbedCount: 4, navWorkingCount: 4 })]);
    expect(appQualityIssueCodes(working)).not.toContain('app-nav-dead');
  });

  it('does NOT block on a single probed control (one control is inconclusive)', () => {
    const arch = archFor('Build a CRM for a small sales team');
    const res = analyze(arch, healthyApp(arch, VOCAB.crm), [shot('desktop', 1440, { navProbedCount: 1, navWorkingCount: 0 })]);
    expect(appQualityIssueCodes(res)).toContain('app-nav-dead');
    expect(hasBlockingAppQualityFindings(res)).toBe(false);
  });

  it('detects NO NAVIGATION at phone width', () => {
    const arch = archFor('Build a CRM for a small sales team');
    const res = analyze(arch, healthyApp(arch, VOCAB.crm), [
      shot('desktop', 1440, { navReachable: true }),
      shot('mobile-large', 430, { navReachable: false }),
      shot('mobile', 390, { navReachable: false }),
    ]);
    expect(appQualityIssueCodes(res)).toContain('app-nav-unreachable-narrow');
    expect(hasBlockingAppQualityFindings(res)).toBe(true);
  });

  it('does NOT flag phone navigation when a menu trigger keeps it reachable', () => {
    const arch = archFor('Build a CRM for a small sales team');
    const res = analyze(arch, healthyApp(arch, VOCAB.crm), [
      shot('desktop', 1440, { navReachable: true }),
      shot('mobile', 390, { navReachable: true }),
    ]);
    expect(appQualityIssueCodes(res)).not.toContain('app-nav-unreachable-narrow');
  });

  it('detects a FIXED-WIDTH desktop layout with no responsive escape', () => {
    const arch = archFor('Build a CRM for a small sales team');
    const files = healthyApp(arch, VOCAB.crm);
    const target = files.find((f) => f.path.startsWith('src/screens/'))!;
    const broken = file(target.path, `export default function S() { return <div className="w-[1440px]"><table /><span>contact</span></div>; }`);
    const res = analyze(arch, files.map((f) => (f.path === target.path ? broken : f)));
    expect(appQualityIssueCodes(res)).toContain('app-fixed-width');
  });

  it('detects CLIPPED content from rendered truth, with phone clipping treated as severe', () => {
    // Real-browser measurement of a catastrophically desktop-only app returned clippedElementCount
    // = 1 (the container hides the rows; the rows themselves are not individually clipped), so the
    // severity axis is WHERE it happens, not how many. Clipping at a phone width is severe on its
    // own; a single occurrence at desktop is reported but does not block.
    const arch = archFor('Build a CRM for a small sales team');
    const files = healthyApp(arch, VOCAB.crm);
    const desktopOnce = analyze(arch, files, [shot('desktop', 1440, { clippedElementCount: 1 })]);
    expect(appQualityIssueCodes(desktopOnce)).toContain('app-content-clipped');
    expect(hasBlockingAppQualityFindings(desktopOnce)).toBe(false);
    const desktopSeveral = analyze(arch, files, [shot('desktop', 1440, { clippedElementCount: 3 })]);
    expect(hasBlockingAppQualityFindings(desktopSeveral)).toBe(true);
    const onPhone = analyze(arch, files, [shot('mobile', 390, { clippedElementCount: 1 })]);
    expect(hasBlockingAppQualityFindings(onPhone)).toBe(true);
  });

  it('detects DEAD PRIMARY INTERACTION (controls with no handler)', () => {
    const arch = archFor('Build a CRM for a small sales team');
    const files = healthyApp(arch, VOCAB.crm);
    const screens = files.filter((f) => f.path.startsWith('src/screens/')).slice(0, 2);
    const dead = files.map((f) => (screens.some((s) => s.path === f.path)
      ? file(f.path, `export default function S() { return (<div><span>contact</span><button>Save</button><button>Delete</button><input /><select /></div>); }`)
      : f));
    const res = analyze(arch, dead);
    expect(appQualityIssueCodes(res)).toContain('app-dead-control');
    expect(hasBlockingAppQualityFindings(res)).toBe(true);
  });

  it('detects the REPEATED-TEMPLATE pathology (every screen the same shape)', () => {
    const arch = archFor('Build a CRM for a small sales team');
    const files = healthyApp(arch, VOCAB.crm);
    const same = files.map((f) => (f.path.startsWith('src/screens/')
      ? file(f.path, `export default function S() {
  const act = () => {};
  return (<div className="grid grid-cols-3"><div className="rounded-xl">{items.map((i) => <span key={i}>contact</span>)}</div><button onClick={act}>Go</button></div>);
}`)
      : f));
    const res = analyze(arch, same);
    expect(appQualityIssueCodes(res)).toContain('app-screen-uniformity');
  });

  it('detects a SEVERE ACCESSIBILITY defect (unusable touch targets on a phone)', () => {
    const arch = archFor('Build a booking management app');
    const res = analyze(arch, healthyApp(arch, VOCAB.booking), [
      shot('desktop', 1440, { smallTouchTargetCount: 0 }),
      shot('mobile', 390, { smallTouchTargetCount: 14 }),
    ]);
    expect(appQualityIssueCodes(res)).toContain('app-touch-target');
  });

  it('detects a PRODUCT-FIT miss (a booking app that became a generic analytics dashboard)', () => {
    const arch = archFor('Build a booking management app for appointments and clients');
    // Structurally fine — every planned screen file exists and is routed — but what the screens
    // DISPLAY is generic dashboard metrics, with none of the requested product in sight.
    const wrong = healthyApp(arch, VOCAB.booking).map((f) => (f.path.startsWith('src/screens/')
      ? file(f.path, `import { useState } from 'react';
export default function S() {
  const [v, set] = useState(0);
  return (<div className="w-full"><h1>Overview</h1><p>Total revenue</p><p>Conversion rate</p><p>KPI</p><button onClick={() => set(v + 1)}>Refresh</button></div>);
}`)
      : f));
    const res = analyze(arch, wrong);
    expect(appQualityIssueCodes(res)).toContain('app-product-fit');
    expect(hasBlockingAppQualityFindings(res)).toBe(true);
    // The SAME structure showing the product's own vocabulary is clean.
    const right = analyze(arch, healthyApp(arch, VOCAB.booking));
    expect(appQualityIssueCodes(right)).not.toContain('app-product-fit');
  });

  it('never accuses a correct app of product drift just because identifiers are plan-derived', () => {
    // The scan reads only what the app DISPLAYS, so a booking app whose screens show real booking
    // copy is clean, and a booking app whose screens show unrelated but non-dashboard copy is
    // reported through composition findings rather than a false product-drift blocker.
    const arch = archFor('Build a booking management app for appointments and clients');
    const neutral = healthyApp(arch, VOCAB.booking).map((f) => (f.path.startsWith('src/screens/')
      ? file(f.path, `export default function S() { const act = () => {}; return (<div><h2>Details</h2><button onClick={act}>Continue</button></div>); }`)
      : f));
    expect(appQualityIssueCodes(analyze(arch, neutral))).not.toContain('app-product-fit');
  });

  it('returns `skipped` (and therefore never blocks) for a build with no app architecture', () => {
    const res = analyzeAppBuildQuality({ files: [file('src/App.tsx', 'export default () => null;')], architecture: undefined });
    expect(res.status).toBe('skipped');
    expect(hasBlockingAppQualityFindings(res)).toBe(false);
    expect(appQualityToReviewIssues(res)).toEqual([]);
    expect(appQualityIssueCount(res)).toBe(0);
    expect(buildAppQualityDiagnostics(res)).toBeUndefined();
  });
});

/* ══ C. RENDERED TRUTH — app viewports, app expectations, worst-across-viewports ═════════════ */

describe('C. app rendered measurement', () => {
  it('measures the five app layout regimes, and leaves the website set unchanged', () => {
    expect(APP_MEASURE_VIEWPORTS.map((v) => v.width)).toEqual([1440, 1024, 768, 430, 390]);
    // Web Build's declared set is untouched by App Build Quality V2.
    expect(DEFAULT_MEASURE_VIEWPORTS.map((v) => v.width)).toEqual([1440, 768, 390]);
  });

  it('never asks an APP for a landing hero or an above-the-fold marketing CTA', () => {
    // This was the defect that pushed App Build toward a marketing look: a correct dashboard
    // screen measured as `rendered-hero-missing` (HIGH) and the one repair was spent adding a hero.
    const websitePlan = {
      version: 'experience-arch-v1', landingRequired: true, heroContentPriority: 'headline',
      entryPattern: 'value-first',
    } as never;
    expect(deriveMeasureExpectations(websitePlan)).toMatchObject({ expectHero: true, expectCta: true, appFirst: false });
    expect(deriveMeasureExpectations(websitePlan, true)).toEqual({ expectHero: false, expectCta: false, appFirst: true, appMode: true });
  });

  it('accepts the two new viewport labels and the app-only measurement fields', () => {
    const m = sanitizeMeasurement({
      viewport: 'mobile-large', runId: 'r1', width: 430, height: 932, contentHeight: 2000,
      horizontalOverflow: true, whitespaceRatio: 0.3, blank: false, runtimeCompiled: true, runtimeError: false,
      navProbedCount: 4, navWorkingCount: 9, navReachable: false, smallTouchTargetCount: 7, clippedElementCount: 2,
    });
    expect(m?.viewport).toBe('mobile-large');
    expect(m?.navReachable).toBe(false);
    expect(m?.smallTouchTargetCount).toBe(7);
    // A malformed runtime can never report more working nav than it probed.
    expect(m?.navWorkingCount).toBe(4);
    expect(sanitizeMeasurement({ viewport: 'nonsense', runId: 'r1', width: 1, height: 1 })).toBeNull();
  });

  it('treats 430 as a phone: a phone-only overflow keeps HIGH severity', () => {
    const at430 = evaluateRenderedVisual({
      screenshots: [shot('desktop', 1440), shot('mobile-large', 430, { horizontalOverflow: true })],
      runtimeCompiled: true, files: [],
    });
    const issue = at430.issues.find((i) => i.code === 'rendered-horizontal-overflow')!;
    expect(issue.severity).toBe('high');
    expect(at430.passed).toBe(false);
  });

  it('preserves the WORST severity across the five app viewports (desktop measured first)', () => {
    const all = evaluateRenderedVisual({
      screenshots: [
        shot('desktop', 1440, { horizontalOverflow: true }),
        shot('laptop', 1024, { horizontalOverflow: true }),
        shot('tablet', 768, { horizontalOverflow: true }),
        shot('mobile-large', 430, { horizontalOverflow: true }),
        shot('mobile', 390, { horizontalOverflow: true }),
      ],
      runtimeCompiled: true, files: [],
    });
    expect(all.issues.filter((i) => i.code === 'rendered-horizontal-overflow')).toHaveLength(1);
    expect(all.issues.find((i) => i.code === 'rendered-horizontal-overflow')!.severity).toBe('high');
  });

  it('a good desktop cannot mask a catastrophic phone layout (required case 3)', () => {
    const desktopOnlyMeasured = evaluateRenderedVisual({
      screenshots: [shot('desktop', 1440)], runtimeCompiled: true, files: [],
    });
    expect(desktopOnlyMeasured.passed).toBe(true);
    // The SAME candidate, once the phone widths are actually measured, cannot pass.
    const fullyMeasured = evaluateRenderedVisual({
      screenshots: [
        shot('desktop', 1440),
        shot('mobile-large', 430, { horizontalOverflow: true }),
        shot('mobile', 390, { horizontalOverflow: true, blank: false }),
      ],
      runtimeCompiled: true, files: [],
    });
    expect(fullyMeasured.passed).toBe(false);

    const arch = archFor('Build a CRM for a small sales team');
    const appSide = analyze(arch, healthyApp(arch, VOCAB.crm), [
      shot('desktop', 1440, { navReachable: true, clippedElementCount: 0 }),
      shot('mobile-large', 430, { navReachable: false, clippedElementCount: 4 }),
      shot('mobile', 390, { navReachable: false, clippedElementCount: 4 }),
    ]);
    expect(hasBlockingAppQualityFindings(appSide)).toBe(true);
  });
});

/* ══ D. CANDIDATE COMPARISON — the six required outcomes ═════════════════════════════════════ */

const validation = (over: Partial<FrontendBuilderValidationArtifact> = {}): FrontendBuilderValidationArtifact => ({
  version: 'frontend-builder-validation-v1', status: 'valid', format: 'frontend-files-v1',
  sourceRawStatus: 'completed', didParse: true, readyForConsumption: true,
  files: [file('src/App.tsx', 'x')], fileCount: 6, totalCharCount: 9000,
  requiredFileCount: 3, requiredSectionFileCount: 0, presentRequiredFileCount: 3,
  presentRequiredSectionFileCount: 0, missingRequiredFiles: [], missingRequiredSectionFiles: [],
  duplicatePaths: [], unresolvedRelativeImports: [], unsupportedPackageImports: [],
  unreachableRequiredSectionFiles: [], missingCriticalCopy: [], missingSupportingCopy: [],
  forbiddenPatternMatches: [], errors: [], warnings: [], reason: 'ok',
  ...over,
}) as FrontendBuilderValidationArtifact;

const candidate = (
  label: WebBuildCandidateSummary['label'],
  over: Partial<Parameters<typeof summarizeCandidate>[0]> = {},
) => summarizeCandidate({ label, validation: validation(), blocking: {}, ...over });

describe('D. best-candidate delivery for App Build', () => {
  it('1. a repair that fixes several serious app defects and adds one minor issue WINS', () => {
    const sel = selectBestCandidate({
      initial: candidate('initial', {
        blocking: { app: true, binding: true }, appQualityIssueCount: 6, reviewScore: 61,
      }),
      repaired: candidate('repaired', {
        blocking: {}, appQualityIssueCount: 2, reviewScore: 74,
      }),
      strictGateAccepted: false, obligationRegressionRejects: false,
      renderRegressed: false, preservationPassed: true,
    });
    expect(sel.winner).toBe('repaired');
    expect(sel.reason).toBe('repaired-strictly-better');
    expect(sel.improvedDimensions).toEqual(expect.arrayContaining(['app', 'binding']));
    expect(promotesUnapprovedRepair(sel)).toBe(true);
  });

  it('2. a repair that introduces a runtime crash LOSES', () => {
    const sel = selectBestCandidate({
      initial: candidate('initial', { blocking: { app: true }, appQualityIssueCount: 4 }),
      repaired: candidate('repaired', { blocking: {}, appQualityIssueCount: 0, runtimeFailure: true, renderedHighFindingCount: 1 }),
      strictGateAccepted: false, obligationRegressionRejects: false,
      renderRegressed: false, preservationPassed: true,
    });
    expect(sel.winner).toBe('initial');
    expect(sel.reason).toBe('repaired-regressed-render');
  });

  it('2b. a repair that breaks the app navigation LOSES even when it improves everything else', () => {
    const sel = selectBestCandidate({
      initial: candidate('initial', { blocking: { binding: true, research: true }, appQualityIssueCount: 1 }),
      repaired: candidate('repaired', { blocking: { app: true }, appQualityIssueCount: 3 }),
      strictGateAccepted: false, obligationRegressionRejects: false,
      renderRegressed: false, preservationPassed: true,
    });
    expect(sel.winner).toBe('initial');
    expect(sel.reason).toBe('repaired-not-better');
    expect(sel.regressedDimensions).toContain('app');
  });

  it('2c. a repair that adds app defects without adding a BLOCKING one still loses', () => {
    const sel = selectBestCandidate({
      initial: candidate('initial', { blocking: { binding: true }, appQualityIssueCount: 1 }),
      repaired: candidate('repaired', { blocking: {}, appQualityIssueCount: 4 }),
      strictGateAccepted: false, obligationRegressionRejects: false,
      renderRegressed: false, preservationPassed: true,
    });
    expect(sel.winner).toBe('initial');
    expect(sel.reason).toBe('repaired-not-better');
  });

  it('4. an optimization that improves measured efficiency with no rendered regression WINS', () => {
    const before = evaluateRenderedVisual({ screenshots: [shot('desktop', 1440), shot('mobile', 390, { horizontalOverflow: true })], runtimeCompiled: true, files: [] });
    const after = evaluateRenderedVisual({ screenshots: [shot('desktop', 1440), shot('mobile', 390)], runtimeCompiled: true, files: [] });
    const reg = compareRenderedEvaluations(before, after);
    expect(rendersWorseAfterRepair(reg)).toBe(false);
    const sel = selectBestCandidate({
      initial: candidate('initial', { renderedHighFindingCount: 1, appQualityIssueCount: 2 }),
      repaired: candidate('repaired', { renderedHighFindingCount: 0, appQualityIssueCount: 1 }),
      strictGateAccepted: false, obligationRegressionRejects: false,
      renderRegressed: false, preservationPassed: true,
    });
    expect(sel.winner).toBe('repaired');
  });

  it('5. an optimization that creates a rendered regression LOSES to the prior candidate', () => {
    const before = evaluateRenderedVisual({ screenshots: [shot('desktop', 1440)], runtimeCompiled: true, files: [] });
    const after = evaluateRenderedVisual({ screenshots: [shot('desktop', 1440, { blank: true })], runtimeCompiled: true, files: [] });
    const reg = compareRenderedEvaluations(before, after);
    expect(rendersWorseAfterRepair(reg)).toBe(true);
    const sel = selectBestCandidate({
      initial: candidate('initial', { appQualityIssueCount: 3 }),
      repaired: candidate('repaired', { appQualityIssueCount: 0 }),
      strictGateAccepted: false, obligationRegressionRejects: false,
      renderRegressed: true, preservationPassed: true,
    });
    expect(sel.winner).toBe('initial');
    expect(sel.reason).toBe('repaired-regressed-render');
  });

  it('6. a LOW-quality but structurally renderable app never becomes Safe Preview', () => {
    // A candidate that is structurally valid + consumed is model-native regardless of how many
    // app-quality defects it carries. Only a genuinely non-render-safe project reaches the safe
    // renderer — quality score has no route to it.
    const files = [
      { path: 'src/main.tsx', content: 'x', language: 'tsx' as const },
      { path: 'src/App.tsx', content: 'x', language: 'tsx' as const },
      { path: 'src/styles.css', content: 'x', language: 'css' as const },
    ];
    const step = {
      artifacts: {
        frontendBuilderConsumption: { status: 'model-native', previewSource: 'model-native-sandbox' },
        frontendBuilderValidation: { status: 'valid', readyForConsumption: true, files },
        frontendBuilderAcceptance: { status: 'manual-review-required', activeProject: 'initial-model-native' },
      },
    } as never;
    const cand = deriveModelNativeCandidate(step, files as never);
    expect(cand.safeToRenderModelNativePreview).toBe(true);
    // Not approved (the app-quality gate withheld approval) — but still model-native, for the
    // owner and for a normal user alike. Quality has no route to the safe renderer.
    expect(cand.approvedForUserPreview).toBe(false);
    expect(resolvePreviewMode(cand, false, undefined)).toBe('provisional-model-native');
    expect(resolvePreviewMode(cand, true, undefined)).not.toBe('safe-fallback');
  });
});

/* ══ E. GATE + PRIORITY ══════════════════════════════════════════════════════════════════════ */

const gateInput = (over: Record<string, unknown> = {}) => ({
  finalReviewCompleted: true, finalReviewPassed: true, initialScore: 70, finalScore: 90,
  minRequiredScore: 82, blockerCount: 0, majorCount: 0, severeWarningGatePassed: true,
  blockingBinding: false, blockingResearch: false, blockingComposition: false,
  blockingVisualSystem: false, blockingContent: false, blockingExperience: false,
  blockingVisual: false, blockingExperienceIdentity: false, blockingMotionExecution: false,
  obligationRegressionRejects: false,
  ...over,
}) as never;

describe('E. acceptance gate + repair priority', () => {
  it('a blocking app defect rejects an otherwise perfect repair', () => {
    expect(evaluateAcceptanceGate(gateInput()).accept).toBe(true);
    const blocked = evaluateAcceptanceGate(gateInput({ blockingAppQuality: true }));
    expect(blocked.accept).toBe(false);
    expect(blocked.reasonCode).toBe('blocking-app-quality');
    expect(blocked.diagnostics.blockingAppQuality).toBe(true);
    expect(blocked.diagnostics.anyBlockingAnalyzer).toBe(true);
  });

  it('omitting the app gate (every website build) reaches the identical decision', () => {
    const withoutField = evaluateAcceptanceGate(gateInput());
    const explicitlyFalse = evaluateAcceptanceGate(gateInput({ blockingAppQuality: false }));
    expect(withoutField.accept).toBe(explicitlyFalse.accept);
    expect(withoutField.reasonCode).toBe(explicitlyFalse.reasonCode);
    expect(withoutField.diagnostics.blockingAppQuality).toBeUndefined();
  });

  it('a proven rendered regression still outranks the app gate', () => {
    const r = evaluateAcceptanceGate(gateInput({ blockingAppQuality: true, renderedRegressionRejects: true }));
    expect(r.reasonCode).toBe('rendered-regression');
  });

  it('a candidate is never promoted for having been measured LESS', () => {
    // The hole this closes: if the post-repair measurement times out, the repaired candidate has
    // no rendered app findings — absence of evidence, not evidence of absence. The pipeline
    // re-analyzes BOTH sides source-only when the evidence bases differ, so the comparison sees
    // the same counts and the repair is not promoted on a measurement failure.
    const arch = archFor('Build a CRM for a small sales team');
    const files = healthyApp(arch, VOCAB.crm);
    const measured = analyze(arch, files, [shot('desktop', 1440, { navProbedCount: 3, navWorkingCount: 0 })]);
    const unmeasured = analyze(arch, files);
    expect(measured.renderedEvidence).toBe(true);
    expect(unmeasured.renderedEvidence).toBe(false);
    expect(appQualityIssueCount(measured)).toBeGreaterThan(appQualityIssueCount(unmeasured));
    // Compared like-for-like (both source-only) the two identical projects are a tie, and a tie
    // keeps the earlier candidate.
    const sel = selectBestCandidate({
      initial: candidate('initial', { appQualityIssueCount: appQualityIssueCount(unmeasured) }),
      repaired: candidate('repaired', { appQualityIssueCount: appQualityIssueCount(unmeasured) }),
      strictGateAccepted: false, obligationRegressionRejects: false,
      renderRegressed: false, preservationPassed: true,
    });
    expect(sel.winner).toBe('initial');
  });

  it('orders app obligations P0→P5 and never drops a P1/P2 for a P5', () => {
    const arch = archFor('Build a CRM for a small sales team');
    // A candidate with defects across the whole priority range.
    const files = healthyApp(arch, ['widget', 'panel', 'figure']).map((f) => (f.path.startsWith('src/screens/')
      ? file(f.path, `export default function S() { return (<div className="grid grid-cols-3 rounded-xl"><button>Go</button><input /><select /><table /></div>); }`)
      : f));
    const res = analyze(arch, files, [
      shot('desktop', 1440, { navProbedCount: 3, navWorkingCount: 0 }),
      shot('mobile', 390, { navReachable: false, smallTouchTargetCount: 12 }),
    ]);
    const issues = appQualityToReviewIssues(res);
    expect(issues.length).toBeGreaterThan(3);
    // The emitted order is the priority order.
    const priorities = res.issues.map((i) => i.priority);
    expect([...priorities].sort((a, b) => a - b)).toEqual(priorities);
    // Every app obligation is gate-critical, so the bounded repair selection keeps them ahead of
    // ordinary model issues rather than dropping them.
    const filler = Array.from({ length: 8 }, (_, i) => ({
      id: `model-${i}`, severity: 'major' as const, category: 'typography' as const,
      files: [], evidence: 'x', repairInstruction: 'y',
    }));
    const merged = mergeDeterministicIssues(filler, issues);
    const selected = selectBoundedRepairIssues(merged.issues);
    const topCodes = selected.map((i) => i.id);
    expect(topCodes.some((id) => id.startsWith('app:'))).toBe(true);
    // A P5 composition finding must never be the only app obligation that survived.
    const survivingApp = topCodes.filter((id) => id.startsWith('app:'));
    expect(survivingApp).not.toEqual(['app:app-screen-uniformity']);
  });

  it('every app repair instruction forbids a whole-app redesign', () => {
    const arch = archFor('Build a booking management app');
    const res = analyze(arch, healthyApp(arch, ['widget', 'panel']).map((f) => (f.path === 'src/App.tsx'
      ? file(f.path, 'export default function App() { return <div />; }') : f)));
    for (const i of appQualityToReviewIssues(res)) {
      expect(i.repairInstruction).toMatch(/fix only this defect/);
      expect(i.gateCritical).toBe(true);
    }
  });

  it('diagnostics are bounded, secret-free and carry pre/post counts', () => {
    const arch = archFor('Build a CRM for a small sales team');
    const initial = analyze(arch, healthyApp(arch, ['widget']).map((f) => (f.path === 'src/App.tsx'
      ? file(f.path, 'export default function App() { return <div />; }') : f)));
    const post = analyze(arch, healthyApp(arch, VOCAB.crm));
    const d = buildAppQualityDiagnostics(initial, post)!;
    expect(d.version).toBe('app-quality-diagnostics-v1');
    expect(d.initialBlockingCount).toBeGreaterThan(0);
    expect(d.postRepairBlockingCount).toBe(0);
    expect(d.issueCodes.length).toBeLessThanOrEqual(8);
    expect(JSON.stringify(d)).not.toMatch(/export default|useState/);
  });
});

/* ══ F. WEB PARITY / SAFETY ══════════════════════════════════════════════════════════════════ */

describe('F. Web Build is untouched by App Build Quality V2', () => {
  it('the app dimension is never blocking for a website candidate', () => {
    const web = candidate('initial', { blocking: { binding: true } });
    expect(web.blockingDimensions).not.toContain('app');
    expect(web.appQualityIssueCount).toBe(0);
  });

  it('a website measurement carries no app-only fields', () => {
    const m = sanitizeMeasurement({
      viewport: 'desktop', runId: 'r', width: 1440, height: 900, contentHeight: 3000,
      horizontalOverflow: false, whitespaceRatio: 0.2, blank: false, runtimeCompiled: true, runtimeError: false,
    })!;
    expect(m.navReachable).toBeUndefined();
    expect(m.navProbedCount).toBeUndefined();
    expect(m.smallTouchTargetCount).toBeUndefined();
    expect(m.clippedElementCount).toBeUndefined();
  });

  it('the deterministic optimization pass is unchanged and still skips app screens', () => {
    const report = analyzeOptimization([
      file('src/App.tsx', "import { useState } from 'react';\nexport default function App() { return <div />; }"),
      file('src/screens/HomeScreen.tsx', 'export default function HomeScreen() { return <div />; }'),
      file('src/components/Unused.tsx', 'export default function Unused() { return <div />; }'),
    ]);
    // `useState` is imported and never used → a real dead import.
    expect(report.measured.deadImportCount).toBeGreaterThan(0);
    // An unwired SCREEN is the app analyzer's business, not the optimizer's (no double charge).
    expect(report.findings.find((f) => f.code === 'unreferenced-component')?.files ?? [])
      .not.toContain('src/screens/HomeScreen.tsx');
  });
});
