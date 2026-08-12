import { describe, it, expect } from 'vitest';
import { deriveAppArchitectureContract } from '@/lib/appArchitecture';
import {
  deriveScreenDepthContract, findDeadControls, type ScreenDepthContract,
} from '@/lib/appScreenDepth';

function depthFor(prompt: string): ScreenDepthContract {
  const arch = deriveAppArchitectureContract({ prompt });
  const depth = deriveScreenDepthContract(arch);
  expect(depth).toBeDefined();
  return depth as ScreenDepthContract;
}

const screen = (d: ScreenDepthContract, role: string) => d.screens.find((s) => s.role === role);

describe('Phase 3 — screen depth & completeness', () => {
  it('A. a dashboard gets useful functional depth (metrics + control + downstream), not filler', () => {
    const d = depthFor('Build a SaaS analytics dashboard with KPIs and reports');
    const dash = screen(d, 'dashboard');
    expect(dash).toBeDefined();
    expect(dash!.requiredElements.join(' ')).toMatch(/metric|tile/i);
    expect(dash!.requiredElements.join(' ')).toMatch(/control|filter|segment|period/i);
    expect(dash!.interactions.length).toBeGreaterThan(0);
  });

  it('B. list/detail actually navigates (row click → detail route)', () => {
    const d = depthFor('Build a CRM for a sales team with contacts and deals');
    const list = screen(d, 'list');
    expect(list).toBeDefined();
    const rowClick = list!.interactions.find((i) => /row/i.test(i.control));
    expect(rowClick).toBeDefined();
    expect(rowClick!.visibleConsequence).toMatch(/detail/i);
  });

  it('D. filters visibly affect content (search/filter → visible rows change)', () => {
    const d = depthFor('Build an ecommerce management app with orders and products');
    const list = screen(d, 'list');
    const filter = list!.interactions.find((i) => /search|filter/i.test(i.control));
    expect(filter).toBeDefined();
    expect(filter!.visibleConsequence).toMatch(/row|list|change|match/i);
  });

  it('E. forms have local feedback (submit → saving → success/error)', () => {
    const d = depthFor('Build an ecommerce management app with products you can create and edit');
    const form = d.screens.find((s) => s.role === 'edit' || s.role === 'create');
    expect(form).toBeDefined();
    expect(form!.lifecycleStates).toContain('saving');
    expect(form!.lifecycleStates).toEqual(expect.arrayContaining(['success', 'error']));
    const submit = form!.interactions.find((i) => /submit/i.test(i.control));
    expect(submit).toBeDefined();
  });

  it('F. loading/empty/error states are generated only where relevant (not universal)', () => {
    const d = depthFor('Build a CRM for a sales team with contacts and deals');
    const settings = screen(d, 'settings');
    const list = screen(d, 'list');
    // A settings screen does not render a data feed → no 'empty'/'loading' data states forced on it.
    expect(settings!.lifecycleStates).not.toContain('loading');
    expect(settings!.lifecycleStates).not.toContain('empty');
    // A list DOES render data → it must handle loading + empty.
    expect(list!.lifecycleStates).toEqual(expect.arrayContaining(['loading', 'empty']));
  });

  it('G. dead controls are detectable in generated source', () => {
    const good = `<button onClick={handleSave}>Save</button><input onChange={onQuery} />`;
    const bad = `<button>Save</button><input placeholder="search" /><button onClick={go}>Go</button>`;
    expect(findDeadControls('s1', good)).toHaveLength(0);
    const dead = findDeadControls('s1', bad);
    expect(dead.length).toBe(2); // the handler-less button and input
    expect(dead.every((f) => f.screenId === 's1')).toBe(true);
    // A submit input inside a form and a disabled decoration are not flagged.
    expect(findDeadControls('s2', `<input type="submit" value="Go" /><button disabled>…</button>`)).toHaveLength(0);
  });

  it('H. a simple/utility app is not over-engineered with states it does not need', () => {
    const d = depthFor('Build a small calculator utility app');
    const tool = screen(d, 'tool');
    expect(tool).toBeDefined();
    expect(tool!.lifecycleStates).not.toContain('saving');
    expect(tool!.lifecycleStates).not.toContain('error');
  });

  it('I. no fake backend success — the contract forbids simulated remote success', () => {
    const d = depthFor('Build a booking app that takes payments');
    const honesty = d.globalObligations.join(' ');
    expect(honesty).toMatch(/no faked backend success|never simulate real payments/i);
  });
});
