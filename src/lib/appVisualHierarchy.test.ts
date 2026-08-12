import { describe, it, expect } from 'vitest';
import { deriveFrontendBuildSpecification, type FrontendBuildSpecInput } from '@/lib/webBuildFrontendSpec';
import { buildFrontendBuilderRequest } from '@/lib/webBuildApi';
import { deriveLayoutPlan } from '@/lib/webBuildLayoutPlan';
import type { WebBuildBrief } from '@/lib/webBuildApi';
import type { FrontendBuildSpecification } from '@/lib/webBuildAgents';

function spec(prompt: string, buildType: 'app' | 'web' = 'app'): FrontendBuildSpecification {
  const brief: WebBuildBrief = { type: buildType === 'app' ? 'app' : 'website' };
  const sections = [
    { id: 'dashboard', name: 'Dashboard' }, { id: 'list', name: 'List' },
    { id: 'detail', name: 'Detail' }, { id: 'settings', name: 'Settings' },
  ];
  const input: FrontendBuildSpecInput = {
    prompt, lang: 'en', buildType, brief,
    sectionItems: sections.map((s) => ({ id: s.id, name: s.name })),
    layoutPlan: deriveLayoutPlan(brief, sections),
  };
  return deriveFrontendBuildSpecification(input);
}

const MATRIX: Array<{ label: string; prompt: string }> = [
  { label: 'finance', prompt: 'Build a personal finance and expense tracker app' },
  { label: 'crm', prompt: 'Build a CRM for a small sales team with contacts and deals' },
  { label: 'fitness', prompt: 'Build a fitness coaching app with programs and progress' },
  { label: 'ecommerce', prompt: 'Build an ecommerce management app for orders and inventory' },
  { label: 'media', prompt: 'Build a media content browsing app' },
  { label: 'analytics', prompt: 'Build a SaaS analytics dashboard' },
  { label: 'booking', prompt: 'Build a booking and appointments management app' },
  { label: 'utility', prompt: 'Build a small unit converter utility app' },
];

describe('UI Quality Phase 2 — context-aware visual hierarchy (not one universal template)', () => {
  const specs = MATRIX.map((m) => ({ ...m, s: spec(m.prompt) }));

  it('every app carries a hierarchy contract that reuses shared tokens (no forced palette)', () => {
    for (const { label, s } of specs) {
      const h = s.appVisual?.hierarchy;
      expect(h, label).toBeDefined();
      expect(h!.layering.toLowerCase(), label).toMatch(/token/);
      expect(h!.colorUsage.toLowerCase(), label).toMatch(/accent/);
      // Chart guidance forbids a new charting dependency.
      expect(h!.dataViz.toLowerCase(), label).toMatch(/recharts|svg/);
    }
  });

  it('density VARIES by context (utility minimal, functional dense, consumer breathable)', () => {
    const byLabel = Object.fromEntries(specs.map((x) => [x.label, x.s.appVisual!.hierarchy.density.toLowerCase()]));
    expect(byLabel.utility).toMatch(/minimal/);
    expect(byLabel.crm).toMatch(/dense/);
    expect(byLabel.analytics).toMatch(/dense/);
    expect(byLabel.fitness).toMatch(/breathable|expressive/);
    // The density strings are not all identical.
    const distinct = new Set(specs.map((x) => x.s.appVisual!.hierarchy.density));
    expect(distinct.size).toBeGreaterThan(1);
  });

  it('NOT all apps become dark — the palette is never force-darkened by the app layer', () => {
    // colour mode is owned by the shared visual system (brand/design tokens), NOT the app layer.
    // The app hierarchy contract must never impose a universal dark theme: no app here is dark,
    // and the layering guidance is phrased around whatever the shared token mode is.
    const modes = specs.map((x) => x.s.visualSystem?.colorMode);
    expect(modes.every((m) => m !== 'dark')).toBe(true); // functional/consumer defaults are not force-dark
    for (const { s } of specs) {
      // the app layer references the token mode rather than hard-coding "dark".
      expect(s.appVisual?.hierarchy.layering.toLowerCase()).not.toContain('force');
    }
  });

  it('NOT all apps become dashboard card grids — shells/app types vary', () => {
    const appTypes = new Set(specs.map((x) => x.s.appVisual?.appType));
    expect(appTypes.size).toBeGreaterThan(2);
    // The utility is not classified as an analytics dashboard.
    const util = specs.find((x) => x.label === 'utility')!;
    expect(util.s.appVisual?.appType).not.toBe('analytics-dashboard');
  });

  it('consumer apps stay expressive (typography allows display type); functional apps forbid marketing headlines', () => {
    const fitness = specs.find((x) => x.label === 'fitness')!.s.appVisual!.hierarchy.typography.toLowerCase();
    const crm = specs.find((x) => x.label === 'crm')!.s.appVisual!.hierarchy.typography.toLowerCase();
    expect(fitness).toMatch(/expressive|display/);
    expect(crm).toMatch(/no oversized marketing|not one size|never one size/);
  });

  it('the hierarchy guidance reaches the app generation request but NEVER the web request', () => {
    const app = buildFrontendBuilderRequest(spec('Build a CRM', 'app'));
    const web = buildFrontendBuilderRequest(spec('Build a bakery landing page', 'web'));
    expect(app).toContain('Visual hierarchy (use the shared brand tokens');
    expect(app).toContain('Data/charts:');
    expect(web).not.toContain('Visual hierarchy (use the shared brand tokens');
  });
});
