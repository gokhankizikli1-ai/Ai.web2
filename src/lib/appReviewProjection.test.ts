import { describe, it, expect } from 'vitest';
import { deriveFrontendBuildSpecification, type FrontendBuildSpecInput } from '@/lib/webBuildFrontendSpec';
import { buildFrontendBuilderReviewRequest, fitReviewRequestUnderCap } from '@/lib/webBuildApi';
import { buildReviewScopedSpecProjection } from '@/lib/webBuildQualityContext';
import { deriveLayoutPlan } from '@/lib/webBuildLayoutPlan';
import type { WebBuildBrief } from '@/lib/webBuildApi';
import type { WebBuildFile } from '@/lib/webBuildPayload';
import type { FrontendBuildSpecification } from '@/lib/webBuildAgents';

function spec(prompt: string, buildType: 'app' | 'web'): FrontendBuildSpecification {
  const brief: WebBuildBrief = { type: buildType === 'app' ? 'app' : 'website' };
  const sections = [
    { id: 'dashboard', name: 'Dashboard' }, { id: 'contacts', name: 'Contacts' },
    { id: 'contact-detail', name: 'Contact Detail' }, { id: 'deals', name: 'Deals' }, { id: 'settings', name: 'Settings' },
  ];
  const input: FrontendBuildSpecInput = {
    prompt, lang: 'en', buildType, brief,
    sectionItems: sections.map((s) => ({ id: s.id, name: s.name })),
    layoutPlan: deriveLayoutPlan(brief, sections),
  };
  return deriveFrontendBuildSpecification(input);
}

const FILES: WebBuildFile[] = [
  { path: 'src/main.tsx', content: 'import App from "./App";', language: 'tsx', status: 'unchanged', added: 0, removed: 0 },
  { path: 'src/App.tsx', content: 'export default function App(){return null}', language: 'tsx', status: 'unchanged', added: 0, removed: 0 },
  { path: 'src/styles.css', content: '@tailwind base;', language: 'css', status: 'unchanged', added: 0, removed: 0 },
];

describe('Phase 1 — lean app review projection', () => {
  const appSpec = spec('Build a CRM for a sales team with contacts and deals', 'app');
  const webSpec = spec('Build a bakery landing page', 'web');

  it('C. app review request is materially smaller (projection applied proactively)', () => {
    const fit = fitReviewRequestUnderCap(appSpec, FILES, 'initial', undefined, undefined, undefined);
    expect(fit.specCharsFull).toBeGreaterThan(0);
    expect(fit.specCharsProjected).toBeLessThan(fit.specCharsFull!);
    expect(fit.projectionReductionPct).toBeGreaterThan(10); // materially smaller
  });

  it('B. web review is byte-for-byte unchanged (full spec, no digest, no projection diagnostics)', () => {
    const fit = fitReviewRequestUnderCap(webSpec, FILES, 'initial', undefined, undefined, undefined);
    expect(fit.specCharsFull).toBeUndefined(); // no proactive projection for web
    // The web review request equals the direct full-spec builder output (unchanged path).
    const direct = buildFrontendBuilderReviewRequest(webSpec, FILES, 'initial');
    expect(fit.message).toBe(direct);
    expect(fit.message).not.toContain('authorityDigest');
  });

  it('A/G. the projected app review keeps app authorities + a digest of dropped obligations', () => {
    // The projection drops the heavy web generator authorities but keeps the app authorities.
    const projected = buildReviewScopedSpecProjection(appSpec);
    expect(projected.appArchitecture).toBeDefined();
    expect(projected.navigation).toBeDefined();
    expect(projected.screenDepth).toBeDefined();
    expect(projected.appVisual).toBeDefined();
    expect(projected.outputContract).toBeDefined();
    expect(projected.honestyRules).toBeDefined();
    // The heavy fields are dropped from the projected spec...
    expect(projected.visualSystem).toBeUndefined();
    expect(projected.experienceQuality).toBeUndefined();
    // ...but the app review request still carries their obligations via the authority digest.
    const fit = fitReviewRequestUnderCap(appSpec, FILES, 'initial', undefined, undefined, undefined);
    expect(fit.message).toContain('authorityDigest');
    // App-judging instruction + app authorities remain visible.
    expect(fit.message).toContain('CLIENT-ROUTED MULTI-SCREEN APPLICATION');
    expect(fit.message).toContain('app-architecture-v1');
    expect(fit.message).toContain('app-navigation-v1');
    expect(fit.message).toContain('app-screen-depth-v1');
  });

  it('D/F. review structure/threshold is unchanged — same task + contract + stage', () => {
    const req = buildFrontendBuilderReviewRequest(
      buildReviewScopedSpecProjection(appSpec), FILES, 'initial', undefined, undefined, undefined, { requiredBindings: [] },
    );
    expect(req).toContain('[FRONTEND REVIEW REQUEST]');
    expect(req).toContain('frontend-review-v1');
    expect(req).toContain('"stage":"initial"');
    // Source files are still fully present (source review requires them).
    expect(req).toContain('src/App.tsx');
  });

  it('E. no projection diagnostics leak into a web request; app reduction is real', () => {
    const appFit = fitReviewRequestUnderCap(appSpec, FILES, 'initial', undefined, undefined, undefined);
    const webFit = fitReviewRequestUnderCap(webSpec, FILES, 'initial', undefined, undefined, undefined);
    expect(appFit.message.length).toBeLessThan(webFit.message.length + appSpec.prompt.length + 5000);
    expect(appFit.projectionReductionPct).toBeGreaterThan(0);
    expect(webFit.projectionReductionPct).toBeUndefined();
  });
});
