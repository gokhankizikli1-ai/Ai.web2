/**
 * Tests — Phase 4: App Visual Adapter, Screen Composition & App-Defect detection.
 *
 * Exit gate: generated products look like APPS, not websites in a phone frame. The
 * adapter reuses the shared VisualSystem tokens (no independent token system), owns
 * only app-surface concepts, drives a context-aware image strategy, and a giant
 * marketing hero / marketing-section leak in a functional app is a DETECTABLE defect.
 */
import { describe, it, expect } from 'vitest';
import { deriveAppArchitectureContract } from '@/lib/appBuildArchitecture';
import {
  deriveAppVisualAdapter, analyzeAppVisualDefects, hasBlockingAppVisualDefects,
  renderAppVisualAdapterBlock,
} from '@/lib/appBuildVisualAdapter';
import type { AppSourceFile } from '@/lib/appBuildScreenDepth';

const adapterFor = (p: string) => deriveAppVisualAdapter(deriveAppArchitectureContract({ prompt: p }))!;
const file = (path: string, content: string): AppSourceFile => ({ path, content });

const DASH = 'Build a SaaS analytics dashboard with KPIs and reports';
const CRM = 'Build a CRM for a sales team with contacts and a deal pipeline';
const STORE = 'Build a shopping app with a product catalog, cart and checkout';
const TIP = 'Build a tip calculator';

describe('app visual adapter — app-surface concepts + shared tokens', () => {
  it('reuses the shared VisualSystem tokens (never an independent token system)', () => {
    expect(adapterFor(DASH).usesSharedTokens).toBe(true);
  });

  it('operator tools get a left sidebar + compact density; consumer apps a bottom bar', () => {
    const dash = adapterFor(DASH);
    expect(dash.navPlacement).toBe('left-sidebar');
    expect(dash.density).toBe('compact');
    const store = adapterFor(STORE);
    expect(store.navPlacement).toBe('bottom-bar');
    expect(store.density).toBe('comfortable');
    expect(store.touchTargetPx).toBe(44);
  });

  it('image strategy is context-aware: dashboards iconographic, commerce photographic', () => {
    expect(adapterFor(DASH).imageStrategy).toBe('iconographic');
    expect(adapterFor(CRM).imageStrategy).toBe('iconographic');
    expect(adapterFor(STORE).imageStrategy).toBe('photographic');
    expect(adapterFor(TIP).imageStrategy).toBe('minimal');
  });

  it('provides a per-screen composition (primary zone, not a hero/section)', () => {
    const dash = adapterFor(DASH);
    expect(dash.screens.length).toBe(deriveAppArchitectureContract({ prompt: DASH }).screens.length);
    const overview = dash.screens.find((s) => s.screenId === 'overview')!;
    expect(overview.primaryZone.toLowerCase()).toMatch(/metric|grid/);
    expect(overview.interactionHierarchy.toLowerCase()).toMatch(/single dominant action|dominant/);
  });

  it('forbids landing-page patterns and is deterministic', () => {
    const a = adapterFor(DASH);
    const joined = a.forbiddenPatterns.join(' ').toLowerCase();
    expect(joined).toMatch(/hero/);
    expect(joined).toMatch(/marketing/);
    expect(JSON.stringify(adapterFor(DASH))).toBe(JSON.stringify(adapterFor(DASH)));
  });
});

describe('app visual defects — a website in a phone frame is detectable', () => {
  const dashAdapter = adapterFor(DASH);
  const cleanApp: AppSourceFile[] = [
    file('src/screens/overview.tsx', '<div className="grid"><Metric/><Metric/><button className="btn-primary">Open</button></div>'),
    file('src/screens/reports.tsx', '<ul>{reports.map(r => <li key={r.id}/>)}</ul>'),
  ];

  it('catches a giant marketing hero heading in a functional app', () => {
    const files = [
      file('src/screens/overview.tsx', '<section><h1 className="text-7xl font-bold">Grow your business</h1></section>'),
      ...cleanApp.slice(1),
    ];
    const res = analyzeAppVisualDefects(files, dashAdapter);
    expect(res.defects.map((d) => d.code)).toContain('app-giant-hero');
    expect(hasBlockingAppVisualDefects(res)).toBe(true);
  });

  it('catches marketing-section language leaking into an app', () => {
    const files = [file('src/screens/overview.tsx', '<div>Trusted by 10,000 users. Pricing plans below. <button>Start for free</button></div>')];
    const res = analyzeAppVisualDefects(files, dashAdapter);
    expect(res.defects.map((d) => d.code)).toContain('app-marketing-leak');
  });

  it('catches competing primary actions on one screen', () => {
    const files = [file('src/screens/overview.tsx', '<div><button className="btn-primary">A</button><button className="btn-primary">B</button></div>')];
    const res = analyzeAppVisualDefects(files, dashAdapter);
    expect(res.defects.map((d) => d.code)).toContain('app-competing-primary-actions');
  });

  it('does NOT fault a clean, app-like functional screen', () => {
    const res = analyzeAppVisualDefects(cleanApp, dashAdapter);
    expect(res.status).toBe('pass');
    expect(res.defects).toHaveLength(0);
  });

  it('fails open on empty inputs', () => {
    expect(analyzeAppVisualDefects(undefined, dashAdapter).legacy).toBe(false);
    expect(analyzeAppVisualDefects([], dashAdapter).status).toBe('pass');
    expect(analyzeAppVisualDefects([file('x.tsx', '<div/>')], undefined).status).toBe('pass');
  });
});

describe('app visual adapter — bounded builder block', () => {
  it('renders a bounded, app-framed block that reuses shared tokens', () => {
    const block = renderAppVisualAdapterBlock(adapterFor(CRM)).join('\n');
    expect(block).toMatch(/APP SURFACE & SCREEN COMPOSITION/);
    expect(block).toMatch(/SHARED VisualSystem tokens/);
    expect(block).toMatch(/FORBIDDEN/);
    expect(block.length).toBeLessThanOrEqual(2600);
    expect(renderAppVisualAdapterBlock(undefined)).toEqual([]);
  });
});
