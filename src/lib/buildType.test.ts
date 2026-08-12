import { describe, it, expect } from 'vitest';
import {
  buildTypeFromBuilderMode, resolveBuildType, isAppBuild, buildTypeLabel, DEFAULT_BUILD_TYPE,
} from '@/lib/buildType';
import { deriveFrontendBuildSpecification } from '@/lib/webBuildFrontendSpec';
import { deriveLayoutPlan } from '@/lib/webBuildLayoutPlan';
import type { WebBuildBrief } from '@/lib/webBuildApi';
import type { FrontendBuildSpecInput } from '@/lib/webBuildFrontendSpec';

/**
 * Phase 1 — the canonical BuildType axis: it must resolve deterministically from
 * the builder mode, survive request → spec derivation, and default legacy
 * (buildType-less) builds to `web` so old persisted projects never break.
 */
describe('buildType — canonical resolution', () => {
  it('A/F. website / landing / ecommerce / game / null resolve to web', () => {
    expect(buildTypeFromBuilderMode('website')).toBe('web');
    expect(buildTypeFromBuilderMode('landing')).toBe('web');
    expect(buildTypeFromBuilderMode('ecommerce')).toBe('web');
    expect(buildTypeFromBuilderMode('game')).toBe('web');
    expect(buildTypeFromBuilderMode(null)).toBe('web');
    expect(buildTypeFromBuilderMode(undefined)).toBe('web');
  });

  it('B/C. the app chip and the App Builder page both resolve to app', () => {
    expect(buildTypeFromBuilderMode('app')).toBe('app');
    expect(isAppBuild('app')).toBe(true);
    expect(isAppBuild(buildTypeFromBuilderMode('app'))).toBe(true);
  });

  it('G. unknown / legacy / missing values default to web (backward compatible)', () => {
    expect(DEFAULT_BUILD_TYPE).toBe('web');
    expect(resolveBuildType(undefined)).toBe('web');
    expect(resolveBuildType(null)).toBe('web');
    expect(resolveBuildType('mobile')).toBe('web');
    expect(resolveBuildType('')).toBe('web');
    expect(resolveBuildType('app')).toBe('app');
    expect(isAppBuild(undefined)).toBe(false);
  });

  it('labels the build type for project category/name', () => {
    expect(buildTypeLabel('app')).toBe('App');
    expect(buildTypeLabel('web')).toBe('Website');
  });
});

function makeSpecInput(overrides: Partial<FrontendBuildSpecInput>): FrontendBuildSpecInput {
  const brief: WebBuildBrief = { type: 'app', audience: 'teams', goal: 'manage work', style: 'clean' };
  const sections = [
    { id: 'home', name: 'Home' },
    { id: 'detail', name: 'Detail' },
  ];
  return {
    prompt: 'Build a CRM for a small sales team',
    lang: 'en',
    brief,
    sectionItems: sections.map((s) => ({ id: s.id, name: s.name })),
    layoutPlan: deriveLayoutPlan(brief, sections),
    ...overrides,
  };
}

describe('buildType — survives request → spec derivation (Phase 1 test D)', () => {
  it('an app request derives a spec carrying buildType=app', () => {
    const spec = deriveFrontendBuildSpecification(makeSpecInput({ buildType: 'app' }));
    expect(spec.buildType).toBe('app');
  });

  it('a web request derives a spec carrying buildType=web', () => {
    const spec = deriveFrontendBuildSpecification(makeSpecInput({ buildType: 'web' }));
    expect(spec.buildType).toBe('web');
  });

  it('a spec input with no buildType defaults to web (legacy compatibility)', () => {
    const spec = deriveFrontendBuildSpecification(makeSpecInput({}));
    expect(spec.buildType).toBe('web');
  });
});
