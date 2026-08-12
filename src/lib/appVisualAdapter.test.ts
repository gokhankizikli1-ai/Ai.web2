import { describe, it, expect } from 'vitest';
import { deriveAppArchitectureContract } from '@/lib/appArchitecture';
import { deriveAppVisualContract, renderAppShellBlock, type AppVisualContract } from '@/lib/appVisualAdapter';

function visualFor(prompt: string): AppVisualContract {
  const arch = deriveAppArchitectureContract({ prompt });
  const v = deriveAppVisualContract(arch);
  expect(v).toBeDefined();
  return v as AppVisualContract;
}

const MATRIX = {
  crm: 'Build a CRM for a sales team with contacts and deals',
  analytics: 'Build a SaaS analytics dashboard with KPIs',
  ecommerce: 'Build an ecommerce management app with orders and products',
  fitness: 'Build a fitness coaching app with programs and progress',
  booking: 'Build a booking management app with a calendar',
  productivity: 'Build a productivity task manager with projects',
  media: 'Build a media content browsing app with a library',
};

describe('Phase 4 — app visual adapter', () => {
  it('reuses the shared visual-system tokens (adds no new colour/type system)', () => {
    const v = visualFor(MATRIX.crm);
    expect(v.tokenReuse.toLowerCase()).toMatch(/reuse|shared visual-system/);
    expect(v.tokenReuse.toLowerCase()).toMatch(/no new colour|no new color/);
  });

  it('does NOT give every app the same shell (app shell adapts by product type)', () => {
    const shells = Object.values(MATRIX).map((p) => visualFor(p).shell.navComponent);
    const unique = new Set(shells);
    expect(unique.size).toBeGreaterThan(1);
    expect(shells).toContain('sidebar');       // functional tools
    expect(shells).toContain('bottom-tabs');   // consumer apps
  });

  it('no screen first-viewport PRESCRIBES a giant marketing hero (functional apps)', () => {
    for (const p of [MATRIX.crm, MATRIX.analytics, MATRIX.ecommerce, MATRIX.productivity]) {
      const v = visualFor(p);
      for (const c of v.screenComposition) {
        // It may say "never a hero"; it must not PRESCRIBE one (a leading hero directive).
        expect(c.firstViewport.toLowerCase()).not.toMatch(/^(a |an )?(giant |large |full[- ]bleed )?(marketing )?hero/);
      }
      // A dashboard's first viewport is an operational surface, explicitly not a hero.
      const dash = v.screenComposition.find((c) => c.role === 'dashboard' || c.role === 'analytics');
      if (dash) {
        expect(dash.firstViewport.toLowerCase()).toMatch(/operational|metric|kpi|dashboard/);
        expect(dash.firstViewport.toLowerCase()).toMatch(/never a marketing hero/);
      }
    }
  });

  it('photography is context-aware: suppressed for internal tools, allowed for consumer apps', () => {
    expect(visualFor(MATRIX.crm).imageStrategy.usePhotography).toBe(false);
    expect(visualFor(MATRIX.analytics).imageStrategy.usePhotography).toBe(false);
    expect(visualFor(MATRIX.ecommerce).imageStrategy.usePhotography).toBe(false);
    expect(visualFor(MATRIX.fitness).imageStrategy.usePhotography).toBe(true);
    expect(visualFor(MATRIX.media).imageStrategy.usePhotography).toBe(true);
    // Internal tools explicitly forbid full-bleed hero photography.
    expect(visualFor(MATRIX.crm).imageStrategy.forbid.join(' ')).toMatch(/hero photography|stock imagery/i);
  });

  it('declares device targets and demands a usable narrow layout (no website-in-a-phone)', () => {
    const v = visualFor(MATRIX.fitness);
    expect(v.devices).toContain('narrow');
    const block = renderAppShellBlock(v).join('\n').toLowerCase();
    expect(block).toMatch(/application, not a scrolling marketing page/);
    expect(block).toMatch(/narrow width|no overflow|clipping/);
  });

  it('the generation block lists app anti-patterns (giant hero, marketing sections, dead cards)', () => {
    const block = renderAppShellBlock(visualFor(MATRIX.analytics)).join('\n').toLowerCase();
    expect(block).toMatch(/giant marketing hero|oversized headline/);
    expect(block).toMatch(/marketing sections/);
    expect(block).toMatch(/identical cards/);
    expect(block).toMatch(/fake\/empty dashboard metrics|placeholder numbers/);
  });
});
