import { describe, it, expect } from 'vitest';
import { deriveFrontendBuildSpecification, type FrontendBuildSpecInput } from '@/lib/webBuildFrontendSpec';
import { buildFrontendBuilderReviewRequest, fitReviewRequestUnderCap } from '@/lib/webBuildApi';
import { buildReviewScopedSpecProjection } from '@/lib/webBuildQualityContext';
import { deriveLayoutPlan } from '@/lib/webBuildLayoutPlan';
import type { WebBuildBrief } from '@/lib/webBuildApi';
import type { WebBuildFile } from '@/lib/webBuildPayload';
import type { FrontendBuildSpecification } from '@/lib/webBuildAgents';
import type { FrontendBuilderReviewArtifact } from '@/lib/webBuildAgents';

function spec(prompt: string, buildType: 'app' | 'web'): FrontendBuildSpecification {
  const brief: WebBuildBrief = { type: buildType === 'app' ? 'app' : 'website' };
  const sections = [{ id: 'dashboard', name: 'Dashboard' }, { id: 'contacts', name: 'Contacts' }, { id: 'settings', name: 'Settings' }];
  const input: FrontendBuildSpecInput = {
    prompt, lang: 'en', buildType, brief,
    sectionItems: sections.map((s) => ({ id: s.id, name: s.name })),
    layoutPlan: deriveLayoutPlan(brief, sections),
  };
  return deriveFrontendBuildSpecification(input);
}
const files = (v: string): WebBuildFile[] => [
  { path: 'src/main.tsx', content: `import App from "./App"; // ${v}`, language: 'tsx', status: 'unchanged', added: 0, removed: 0 },
  { path: 'src/App.tsx', content: `export default function App(){return ${v ? 'null' : '<div/>'}}`, language: 'tsx', status: 'unchanged', added: 0, removed: 0 },
  { path: 'src/styles.css', content: '@tailwind base;', language: 'css', status: 'unchanged', added: 0, removed: 0 },
];
const prevReview = { issues: [{ id: 'x', category: 'visual-hierarchy', severity: 'major', repairInstruction: 'fix' }] } as unknown as FrontendBuilderReviewArtifact;
const commonPrefixLen = (a: string, b: string): number => { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return i; };

describe('Phase 2 — cache-friendly stable prefix (app)', () => {
  const appSpec = spec('Build a CRM for a sales team', 'app');
  const projected = buildReviewScopedSpecProjection(appSpec);
  const digest = { requiredBindings: [] };

  it('A. repeated identical app review requests are byte-identical (deterministic)', () => {
    const a = buildFrontendBuilderReviewRequest(projected, files('v1'), 'initial', undefined, undefined, undefined, digest);
    const b = buildFrontendBuilderReviewRequest(projected, files('v1'), 'initial', undefined, undefined, undefined, digest);
    expect(a).toBe(b);
  });

  it('the initial + post-repair app reviews share a large stable prefix (spec projection cacheable)', () => {
    const initial = buildFrontendBuilderReviewRequest(projected, files('v1'), 'initial', undefined, undefined, undefined, digest);
    const postRepair = buildFrontendBuilderReviewRequest(projected, files('v2'), 'post-repair', prevReview, undefined, undefined, digest);
    const shared = commonPrefixLen(initial, postRepair);
    // The shared prefix must include the whole spec projection (it must reach past "stage").
    const stageIdx = initial.indexOf('"stage":');
    expect(stageIdx).toBeGreaterThan(1000);
    expect(shared).toBeGreaterThanOrEqual(stageIdx); // identical up to the varying "stage" field
    // The stable prefix is the bulk of the request (spec dominates); the varying tail is smaller.
    expect(shared).toBeGreaterThan(initial.length * 0.4);
  });

  it('B. app leading prose is stage-independent and stable (no varying stage/compact in the header)', () => {
    const initial = buildFrontendBuilderReviewRequest(projected, files('v1'), 'initial', undefined, undefined, undefined, digest);
    const post = buildFrontendBuilderReviewRequest(projected, files('v1'), 'post-repair', prevReview, undefined, undefined, digest);
    // The prose header (before BEGIN_ JSON) is identical for both stages.
    const head = (s: string) => s.slice(0, s.indexOf('BEGIN_FRONTEND_BUILD_SPEC_JSON'));
    expect(head(initial)).toBe(head(post));
    expect(head(initial)).not.toContain('stage:'); // stage not in the prose header
  });

  it('C. web review is byte-for-byte unchanged (stage stays in the prose header)', () => {
    const webSpec = spec('Build a bakery landing page', 'web');
    const req = buildFrontendBuilderReviewRequest(webSpec, files('v1'), 'initial');
    expect(req).toContain('(stage: initial)'); // web keeps the stage in the header
    expect(req).not.toContain('authorityDigest');
    expect(req).not.toContain('contextNote');
    // web input order unchanged: stage precedes specification.
    expect(req.indexOf('"stage":')).toBeLessThan(req.indexOf('"specification":'));
  });

  it('D. no instruction disappears — app review keeps its judging + honesty rules', () => {
    const initial = buildFrontendBuilderReviewRequest(projected, files('v1'), 'initial', undefined, undefined, undefined, digest);
    expect(initial).toContain('frontend-review-v1');
    expect(initial).toContain('CLIENT-ROUTED MULTI-SCREEN APPLICATION');
    expect(initial).toContain('never claim you did');
    expect(initial).toContain('"stage":"initial"');
  });

  it('diagnostics report the stable prefix vs variable payload for app', () => {
    const fit = fitReviewRequestUnderCap(appSpec, files('v1'), 'initial', undefined, undefined, undefined);
    expect(fit.stablePrefixChars).toBeGreaterThan(0);
    expect(fit.variablePayloadChars).toBeGreaterThan(0);
    expect(fit.stablePrefixChars! + fit.variablePayloadChars!).toBe(fit.message.length);
  });
});
