/**
 * APP BUILD QUALITY V2 — parity, persistence and runtime-integrity validation.
 *
 *   G. SAVE / REOPEN        the DELIVERED candidate is what persists and what reopens
 *   H. ENTRY-POINT PARITY   every App Build entry point reaches the identical pipeline
 *   I. RUNTIME INTEGRITY    the injected measurement runtime is valid, bounded, app-aware
 *   J. NO EXTRA CALLS       App Build Quality V2 adds no model/provider call and no dependency
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { attachFrontendBuilderQualityResult, type WebBuildPayload, type WebBuildFile } from '@/lib/webBuildPayload';
import { saveWebBuildPayloadToProject } from '@/lib/webBuildProject';
import { getProject } from '@/stores/projectStore';
import { VE_RUNTIME_SOURCE } from '@/lib/candidateVisualEditRuntimeSource';
import { buildAppQualityDiagnostics, analyzeAppBuildQuality } from '@/lib/appBuildQuality';
import { deriveAppArchitectureContract } from '@/lib/appArchitecture';
import type { FrontendGeneratedFile } from '@/lib/webBuildAgents';

const src = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

/* ── in-memory localStorage (same approach as the existing persistence tests) ── */
function installStorage(): void {
  const m = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => { m.set(k, String(v)); },
    removeItem: (k: string) => { m.delete(k); },
    clear: () => m.clear(),
    key: (i: number) => Array.from(m.keys())[i] ?? null,
    get length() { return m.size; },
  } as unknown as Storage;
}
const asUser = (id: string) => localStorage.setItem('korvix-auth', JSON.stringify({ state: { user: { id } } }));

const webFile = (path: string, content: string): WebBuildFile =>
  ({ path, content, language: 'tsx', status: 'unchanged', added: 0, removed: 0 }) as WebBuildFile;
const genFile = (path: string, content: string): FrontendGeneratedFile =>
  ({ path, content, language: 'tsx', charCount: content.length, lineCount: 1 }) as FrontendGeneratedFile;

/* ══ G. SAVE / REOPEN ════════════════════════════════════════════════════════════════════════ */

describe('G. the DELIVERED app candidate is what persists and reopens', () => {
  beforeEach(() => { installStorage(); asUser('U'); });

  /** A payload whose active files are the INITIAL candidate. */
  const initialPayload = (): WebBuildPayload => ({
    prompt: 'a booking management app', brief: {}, sectionItems: [], activity: [],
    buildType: 'app',
    files: [webFile('src/App.tsx', 'INITIAL-APP'), webFile('src/screens/TodayScreen.tsx', 'INITIAL-TODAY')],
    steps: [{ id: 's1', files: [webFile('src/App.tsx', 'INITIAL-APP')], artifacts: {} }],
  }) as unknown as WebBuildPayload;

  const repaired = [
    genFile('src/App.tsx', 'REPAIRED-APP'),
    genFile('src/screens/TodayScreen.tsx', 'REPAIRED-TODAY'),
  ];
  const repairedValidation = {
    version: 'frontend-builder-validation-v1', status: 'valid', readyForConsumption: true,
    files: repaired, fileCount: repaired.length, totalCharCount: 24, errors: [], warnings: [],
  } as never;

  it('a PROMOTED better app candidate is the one that persists and reopens', () => {
    const next = attachFrontendBuilderQualityResult(initialPayload(), {
      ran: true,
      acceptance: {
        version: 'frontend-acceptance-v1', status: 'manual-review-required',
        activeProject: 'repaired-model-native', initialReviewPassed: false, repairAttempted: true,
        repairAccepted: false, finalReviewPassed: false, renderedVisualTestStatus: 'pending-manual-test',
        renderedScreenshotReviewed: false, runtimeCompilationReviewed: false, reason: 'promoted',
      },
      bestCandidatePromoted: true,
      acceptedRepairedFiles: repaired,
      acceptedRepairedValidation: repairedValidation,
    } as never);

    // The delivered candidate replaced the active project in memory…
    expect(next.files?.find((f) => f.path === 'src/App.tsx')?.content).toBe('REPAIRED-APP');
    const res = saveWebBuildPayloadToProject(next);
    expect(res.ok).toBe(true);
    // …and it is the SAME content that comes back on reopen — no stale candidate.
    const reopened = getProject(res.project.id)?.webBuild as WebBuildPayload | undefined;
    expect(reopened?.files?.find((f) => f.path === 'src/App.tsx')?.content).toBe('REPAIRED-APP');
    expect(reopened?.files?.find((f) => f.path === 'src/screens/TodayScreen.tsx')?.content).toBe('REPAIRED-TODAY');
    expect(reopened?.buildType).toBe('app');
    expect(JSON.stringify(reopened)).not.toContain('INITIAL-APP');
  });

  it('a REJECTED, non-promoted repair leaves the earlier app candidate as the delivered one', () => {
    const next = attachFrontendBuilderQualityResult(initialPayload(), {
      ran: true,
      acceptance: {
        version: 'frontend-acceptance-v1', status: 'manual-review-required',
        activeProject: 'initial-model-native', initialReviewPassed: false, repairAttempted: true,
        repairAccepted: false, finalReviewPassed: false, renderedVisualTestStatus: 'pending-manual-test',
        renderedScreenshotReviewed: false, runtimeCompilationReviewed: false, reason: 'rejected',
      },
      bestCandidatePromoted: false,
      acceptedRepairedFiles: repaired,
      acceptedRepairedValidation: repairedValidation,
    } as never);
    expect(next.files?.find((f) => f.path === 'src/App.tsx')?.content).toBe('INITIAL-APP');
    const res = saveWebBuildPayloadToProject(next);
    const reopened = getProject(res.project.id)?.webBuild as WebBuildPayload | undefined;
    expect(reopened?.files?.find((f) => f.path === 'src/App.tsx')?.content).toBe('INITIAL-APP');
    expect(JSON.stringify(reopened)).not.toContain('REPAIRED-APP');
  });

  it('app-quality diagnostics survive a JSON round trip and carry no source', () => {
    const arch = deriveAppArchitectureContract({ prompt: 'a booking management app' })!;
    const result = analyzeAppBuildQuality({
      files: [genFile('src/App.tsx', 'export default function App() { return <div />; }')],
      architecture: arch,
    });
    const d = buildAppQualityDiagnostics(result)!;
    const round = JSON.parse(JSON.stringify(d));
    expect(round).toEqual(d);
    expect(JSON.stringify(round)).not.toMatch(/export default|function App/);
  });
});

/* ══ H. ENTRY-POINT PARITY ═══════════════════════════════════════════════════════════════════ */

describe('H. every App Build entry point reaches the identical pipeline', () => {
  const chat = src('src/components/ChatWebBuild.tsx');
  const websiteBuilder = src('src/pages/WebsiteBuilder.tsx');
  const appBuilder = src('src/pages/AppBuilder.tsx');

  it('the App Builder page is a thin entry onto the SAME shared build spine', () => {
    // It must not fork a parallel pipeline — it delegates to ChatWebBuild with mode="app".
    expect(appBuilder).toContain('initialMode="app"');
    expect(appBuilder).not.toContain('runFrontendBuilderQualityPipeline');
    expect(appBuilder).not.toContain('generateFrontendBuilderRaw');
  });

  it('both pipeline entry points pass the measurement AND vision producers', () => {
    for (const [name, code] of [['ChatWebBuild', chat], ['WebsiteBuilder', websiteBuilder]] as const) {
      expect(`${name}: ${code.includes('createMeasurementProducer')}`).toBe(`${name}: true`);
      expect(`${name}: ${code.includes('createVisionReviewProducer')}`).toBe(`${name}: true`);
      expect(`${name}: ${code.includes('renderedVisualProducer')}`).toBe(`${name}: true`);
      expect(`${name}: ${code.includes('runFrontendBuilderQualityPipeline')}`).toBe(`${name}: true`);
      // Both carry the canonical build type onto the payload, so the app branch engages.
      expect(`${name}: ${code.includes('buildTypeFromBuilderMode')}`).toBe(`${name}: true`);
    }
  });

  it('there is exactly ONE quality-pipeline orchestrator, and one app-analyzer call site', () => {
    const quality = src('src/lib/webBuildFrontendQuality.ts');
    expect((quality.match(/export async function runFrontendBuilderQualityPipeline/g) || []).length).toBe(1);
    // The app analyzer has exactly ONE consumer in the whole app: that orchestrator. (Its own
    // module and the tests are excluded; nothing else may build a parallel app-quality path.)
    const consumers = [
      'src/lib/webBuildFrontendQuality.ts', 'src/lib/webBuildFrontendValidation.ts',
      'src/lib/webBuildApi.ts', 'src/components/ChatWebBuild.tsx', 'src/pages/WebsiteBuilder.tsx',
      'src/pages/AppBuilder.tsx', 'src/lib/runHeadlessBuild.ts',
    ].filter((p) => src(p).includes('analyzeAppBuildQuality'));
    expect(consumers).toEqual(['src/lib/webBuildFrontendQuality.ts']);
  });

  it('the app measurement decision is made in ONE place, from the canonical build type', () => {
    const host = src('src/components/builder/WebBuildMeasurementHost.tsx');
    const producer = src('src/lib/webBuildPreviewMeasurement.ts');
    expect(host).toContain("job.spec?.buildType === 'app'");
    expect(producer).toContain("ctx.spec?.buildType === 'app'");
  });
});

/* ══ I. RUNTIME INTEGRITY ════════════════════════════════════════════════════════════════════ */

describe('I. the injected measurement runtime stays valid and bounded', () => {
  it('parses as valid JavaScript and is not truncated', () => {
    expect(() => new Function(VE_RUNTIME_SOURCE)).not.toThrow();
    // A stray backtick inside the template literal silently TRUNCATES the injected runtime (this
    // happened once while building App Build Quality V2 — a backtick inside a code comment). The
    // IIFE terminator proves the whole runtime survived, which a parse check alone would not.
    expect(VE_RUNTIME_SOURCE.trimEnd().endsWith('})();')).toBe(true);
    expect(VE_RUNTIME_SOURCE).not.toContain('`');
    expect(VE_RUNTIME_SOURCE.length).toBeGreaterThan(30_000);
  });

  it('measures the app-surface facts and probes navigation only in app mode', () => {
    expect(VE_RUNTIME_SOURCE).toContain('measureNavReachable');
    expect(VE_RUNTIME_SOURCE).toContain('measureSmallTouchTargets');
    expect(VE_RUNTIME_SOURCE).toContain('measureClippedElements');
    expect(VE_RUNTIME_SOURCE).toContain('probeNavigation');
    // Guarded behind appMode, so a website measurement is byte-for-byte what it was.
    expect(VE_RUNTIME_SOURCE).toMatch(/if \(appMode\) \{/);
    expect(VE_RUNTIME_SOURCE).toMatch(/appMode && p\.probeNav === true/);
  });

  it('bounds the navigation probe and keeps it read-only otherwise', () => {
    // A hard time ceiling, a bounded control count, and no generic DOM/eval command.
    expect(VE_RUNTIME_SOURCE).toMatch(/setTimeout\(function \(\) \{ finish\(probed, working\); \}, 3000\)/);
    expect(VE_RUNTIME_SOURCE).toMatch(/Math\.min\(items\.length, 4\)/);
    expect(VE_RUNTIME_SOURCE).not.toMatch(/\beval\s*\(/);
    expect(VE_RUNTIME_SOURCE).not.toMatch(/new Function\s*\(/);
  });

  it('never reports a marketing hero on an app screen that has an operational surface', () => {
    expect(VE_RUNTIME_SOURCE).toContain('hasOperationalSurface');
  });
});

/* ══ J. NO EXTRA CALLS / DEPENDENCIES ════════════════════════════════════════════════════════ */

describe('J. App Build Quality V2 adds no provider call and no dependency', () => {
  it('the app-quality analyzer is pure: no fetch, no import.meta.env, no model call', () => {
    const mod = src('src/lib/appBuildQuality.ts');
    expect(mod).not.toMatch(/\bfetch\s*\(/);
    expect(mod).not.toMatch(/import\.meta/);
    expect(mod).not.toMatch(/generate[A-Za-z]*Raw/);
    expect(mod).not.toMatch(/Date\.now|Math\.random/);
  });

  it('never promotes a candidate whose rendered evidence was LOST', () => {
    // Guard for the "broken app promoted" vector: if the initial app was measured and the
    // repaired one was not, promotion is refused outright — we would be shipping the candidate we
    // know LESS about. Both flags are undefined for a website build, so Web Build is unaffected.
    const quality = src('src/lib/webBuildFrontendQuality.ts');
    expect(quality).toContain('const lostRenderedEvidence =');
    expect(quality).toContain('bestCandidatePromoted = promotesUnapprovedRepair(v2.selection) && !lostRenderedEvidence;');
    // …and the comparison itself is width-set based, not a boolean "was it measured at all".
    expect(quality).toContain('sameRenderedEvidenceBasis(initialAppQuality, repairAppQuality)');
  });

  it('the pipeline still makes at most one review, one repair and one post-repair review', () => {
    const quality = src('src/lib/webBuildFrontendQuality.ts');
    expect((quality.match(/await generateFrontendBuilderReviewRaw\(/g) || []).length).toBe(2);   // initial + post-repair
    expect((quality.match(/await generateFrontendBuilderRepairRaw\(/g) || []).length).toBe(1);
    expect((quality.match(/await generateFrontendBuilderDeltaRepairRaw\(/g) || []).length).toBe(1);
    expect((quality.match(/await generateFrontendBuilderRaw\(/g) || []).length).toBe(1);
  });

  it('introduces no new runtime dependency', () => {
    const pkg = JSON.parse(src('package.json')) as { dependencies: Record<string, string> };
    // Everything the app path uses is already shipped.
    for (const dep of ['react-router', 'react', '@codesandbox/sandpack-react']) {
      expect(Object.keys(pkg.dependencies)).toContain(dep);
    }
    expect(src('src/lib/appBuildQuality.ts')).not.toMatch(/from '(?!@\/lib\/)/);
  });
});
