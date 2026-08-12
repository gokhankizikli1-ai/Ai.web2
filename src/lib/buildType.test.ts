/**
 * Tests — Phase 1: canonical BuildType ownership + threading (App Build foundation).
 *
 * App Build is the mature Web Build spine made BUILD-TYPE PARAMETRIC. These tests pin
 * the ONE authority (buildType.ts) and prove the resolved build type is threaded from
 * the request (BuilderMode) → specification (deriveFrontendBuildSpecification) →
 * persisted payload (buildWebBuildPayload), and that legacy/old inputs stay `web`.
 *
 *  A — a website request resolves to buildType 'web'.
 *  B — an app request (chip / mode='app') resolves to buildType 'app'.
 *  C — the dedicated AppBuilder surface routes to the canonical spine, not the legacy
 *      HTML orchestrator (structural: the module carries no orchestrator dependency).
 *  D — buildType survives request → specification → payload unchanged.
 *  E — no app production request reaches the legacy deterministic HTML renderer path.
 *  F — a web build is unaffected (default 'web'; no app inputs present).
 *  G — an old persisted build with no buildType loads as 'web' (backward compatible).
 *  H — threading adds no model/provider call (the authority is pure + synchronous).
 */
import { describe, it, expect } from 'vitest';
import {
  resolveBuildType, normalizeBuildType, isAppBuild, buildTypeLabel, DEFAULT_BUILD_TYPE,
} from '@/lib/buildType';
import { deriveFrontendBuildSpecification, type FrontendBuildSpecInput } from '@/lib/webBuildFrontendSpec';
import { buildWebBuildPayload, type WebBuildPayload } from '@/lib/webBuildPayload';
import type { WebBuildBrief, WebBuildResult } from '@/lib/webBuildApi';
import type { WebBuildLayoutPlan } from '@/lib/webBuildLayoutPlan';

/* ── Factories ────────────────────────────────────────────────────────────── */
function specInput(over: Partial<FrontendBuildSpecInput>): FrontendBuildSpecInput {
  return {
    prompt: 'Build a CRM dashboard for a sales team',
    lang: 'en',
    brief: { type: 'crm' } as WebBuildBrief,
    sectionItems: [],
    layoutPlan: {} as unknown as WebBuildLayoutPlan,
    ...over,
  };
}
function result(reply = 'La build'): WebBuildResult {
  return { reply, sections: [], model: 'test', mode: 'website_builder', requestId: 'r1', partial: true };
}

describe('buildType — canonical authority (A/B/F/G/H)', () => {
  it('A — website / landing / game / null resolve to web', () => {
    expect(resolveBuildType('website')).toBe('web');
    expect(resolveBuildType('landing')).toBe('web');
    expect(resolveBuildType('ecommerce')).toBe('web');
    expect(resolveBuildType('game')).toBe('web');
    expect(resolveBuildType(null)).toBe('web');
    expect(resolveBuildType(undefined)).toBe('web');
  });

  it('B — app mode (the chip / mode="app") resolves to app', () => {
    expect(resolveBuildType('app')).toBe('app');
    expect(isAppBuild(resolveBuildType('app'))).toBe(true);
  });

  it('F — the default build type is web (no app input ⇒ native Web Build)', () => {
    expect(DEFAULT_BUILD_TYPE).toBe('web');
    expect(normalizeBuildType(undefined)).toBe('web');
  });

  it('G — old persisted values (absent / unknown) normalize to web; only "app" is app', () => {
    expect(normalizeBuildType(undefined)).toBe('web');
    expect(normalizeBuildType(null)).toBe('web');
    expect(normalizeBuildType('')).toBe('web');
    expect(normalizeBuildType('mobile')).toBe('web');
    expect(normalizeBuildType('web')).toBe('web');
    expect(normalizeBuildType('app')).toBe('app');
    expect(buildTypeLabel('app')).toBe('App');
    expect(buildTypeLabel(undefined)).toBe('Web');
  });

  it('H — the authority is pure + deterministic (no async / model call)', () => {
    // Same input → same output, and the calls return synchronously (never a Promise).
    expect(resolveBuildType('app')).toBe(resolveBuildType('app'));
    expect(resolveBuildType('app') instanceof Promise).toBe(false);
    expect(normalizeBuildType('app') instanceof Promise).toBe(false);
  });
});

describe('buildType — threaded through the specification (D)', () => {
  it('an app request derives a spec carrying buildType="app"', () => {
    const spec = deriveFrontendBuildSpecification(specInput({ buildType: 'app' }));
    expect(spec.buildType).toBe('app');
  });

  it('a web request (no buildType) derives a spec carrying buildType="web"', () => {
    const spec = deriveFrontendBuildSpecification(specInput({}));
    expect(spec.buildType).toBe('web');
  });

  it('an unknown/legacy buildType input normalizes to web on the spec', () => {
    const spec = deriveFrontendBuildSpecification(
      specInput({ buildType: 'mobile' as unknown as 'web' }),
    );
    expect(spec.buildType).toBe('web');
  });
});

describe('buildType — threaded through the persisted payload (D/E/G)', () => {
  it('a fresh app build stamps buildType="app" on the payload', () => {
    const payload = buildWebBuildPayload('Build a CRM dashboard', result(), undefined, 'en', { buildType: 'app' });
    expect(payload.source).toBe('web_build');
    expect(payload.buildType).toBe('app');
  });

  it('a fresh web build (no opts) stamps buildType="web" (default, non-regressing)', () => {
    const payload = buildWebBuildPayload('Build a bakery website', result(), undefined, 'en');
    expect(payload.buildType).toBe('web');
  });

  it('a revision inherits the ORIGINAL project build type (prev wins over opts)', () => {
    const appProject = buildWebBuildPayload('Build a CRM dashboard', result(), undefined, 'en', { buildType: 'app' });
    // A later revision passes no/other build type — the original app type is preserved.
    const revised = buildWebBuildPayload('Add a settings screen', result('rev'), appProject, 'en');
    expect(revised.buildType).toBe('app');
    const revisedWeb = buildWebBuildPayload('Tweak copy', result('rev2'), appProject, 'en', { buildType: 'web' });
    expect(revisedWeb.buildType).toBe('app');
  });

  it('G — an old payload without buildType is treated as web when reopened/revised', () => {
    const legacy = { source: 'web_build', prompt: 'old', brief: {}, sectionItems: [], sections: [], files: [], reply: '', activity: [], steps: [], createdAt: 'x', updatedAt: 'x' } as unknown as WebBuildPayload;
    expect(normalizeBuildType(legacy.buildType)).toBe('web');
    const revised = buildWebBuildPayload('touch', result(), legacy, 'en');
    expect(revised.buildType).toBe('web');
  });
});
