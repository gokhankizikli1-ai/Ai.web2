import { describe, it, expect } from 'vitest';
import { deriveFrontendBuildSpecification, type FrontendBuildSpecInput } from '@/lib/webBuildFrontendSpec';
import { buildFrontendBuilderRequest } from '@/lib/webBuildApi';
import { deriveLayoutPlan } from '@/lib/webBuildLayoutPlan';
import type { WebBuildBrief } from '@/lib/webBuildApi';
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

const APP_PROMPTS = [
  'Build a CRM for a small sales team', 'Build a fitness coaching app with programs and progress',
  'Build an ecommerce management app', 'Build a booking management app', 'Build a SaaS analytics dashboard',
  'Build a productivity task manager', 'Build a media content browsing app', 'Build a small calculator utility app',
];

describe('Phase 5 — app contract dedup with quality parity', () => {
  const appReq = buildFrontendBuilderRequest(spec('Build a CRM for a sales team with contacts and deals', 'app'));
  const webReq = buildFrontendBuilderRequest(spec('Build a bakery landing page', 'web'));

  it('A/B/C. shared quality obligations (responsive + a11y + visual hierarchy) are PRESERVED for every app', () => {
    for (const p of APP_PROMPTS) {
      const req = buildFrontendBuilderRequest(spec(p, 'app'));
      expect(req).toContain('SHARED QUALITY OBLIGATIONS');
      // Accessibility preserved (semantic landmarks / keyboard / focus / contrast).
      expect(req).toMatch(/semantic landmarks|keyboard-operable|focus ring|contrast/i);
      // Responsive preserved (mobile collapse / 44px targets).
      expect(req).toMatch(/one readable column on mobile|44px targets|full-width/i);
      // Visual hierarchy / tokens preserved (visualSystem block + appVisual).
      expect(req).toContain('[APP VISUAL SYSTEM]');
    }
  });

  it('E/F. per-screen state + interaction obligations are still owned (ScreenDepth), not lost', () => {
    expect(appReq).toContain('[APP SCREEN DEPTH & STATE LIFECYCLE]');
    expect(appReq).toMatch(/control.*handler.*state|no dead controls/i);
  });

  it('obligation OWNERSHIP map — every quality obligation has exactly one owner in the app request', () => {
    // screens/roles/flows → App Architecture; routes → Navigation; per-screen completeness/state →
    // Screen Depth; app shell/device/composition → App Visual; shared a11y/responsive/perf → Shared block.
    expect(appReq).toContain('[APP ARCHITECTURE]');
    expect(appReq).toContain('[APP NAVIGATION]');
    expect(appReq).toContain('[APP SCREEN DEPTH & STATE LIFECYCLE]');
    expect(appReq).toContain('[APP VISUAL SYSTEM]');
    expect(appReq).toContain('SHARED QUALITY OBLIGATIONS');
  });

  it('the app request DROPS the duplicate web page/section/whole-page framing from the experience block', () => {
    // These are the per-section / whole-page-rhythm obligations owned by ScreenDepth + AppVisual for
    // an app — removed as proven duplicates (and website vocabulary wrong for an app).
    expect(appReq).not.toContain('Whole-page rhythm');
    expect(appReq).not.toContain('Per-section experience obligations');
    expect(appReq).not.toContain('across the whole page, not isolated sections');
  });

  it('G/H. WEB generation is unchanged — full experience block with per-section + whole-page rhythm', () => {
    expect(webReq).toContain('BINDING INTEGRATED EXPERIENCE');
    expect(webReq).toContain('Whole-page rhythm');
    expect(webReq).toContain('Per-section experience obligations');
    expect(webReq).not.toContain('SHARED QUALITY OBLIGATIONS'); // web uses the full block, not the app-global one
  });

  it('I. the app experience block is materially smaller than the full web block (dedup real)', () => {
    // Same underlying contract; the app renders global-only, the web renders full per-section.
    const appExp = appReq.slice(appReq.indexOf('SHARED QUALITY OBLIGATIONS'), appReq.indexOf('SHARED QUALITY OBLIGATIONS') + 2000);
    expect(appExp).not.toContain('focal:'); // no per-section focal obligations in the app block
    // Whole app request still carries all app authorities + shared obligations.
    expect(appReq.length).toBeGreaterThan(5000);
  });
});
