/**
 * Tests — Phase 2: App Architecture & Navigation authorities.
 *
 * Exit gate: for a diverse App Build matrix, the pipeline can DETERMINISTICALLY
 * describe a credible multi-screen architecture — and different app kinds get
 * materially DIFFERENT screens, shells and navigation. They must NOT all collapse to
 * the same dashboard/tabs/sidebar. An intentionally-simple utility is respected (not
 * inflated). Every navigation route resolves to a declared screen (no nav to nowhere).
 */
import { describe, it, expect } from 'vitest';
import {
  deriveAppArchitectureContract, deriveNavigationContract,
  renderAppArchitectureBlock, renderNavigationBlock,
  type AppArchitectureContract, type AppArchitectureInput,
} from '@/lib/appBuildArchitecture';

function arch(prompt: string, over: Partial<AppArchitectureInput> = {}): AppArchitectureContract {
  return deriveAppArchitectureContract({ prompt, ...over });
}
function profileKey(c: AppArchitectureContract): string {
  return `${c.archetype}|${c.shell}|${c.screens.map((s) => `${s.id}:${s.role}`).join(',')}`;
}

const MATRIX: Array<[string, string]> = [
  ['saas-dashboard', 'Build a SaaS analytics dashboard with KPIs and reports'],
  ['crm', 'Build a CRM for a sales team with contacts and a deal pipeline'],
  ['ecommerce', 'Build a shopping app with a product catalog, cart and checkout'],
  ['fitness', 'Build a fitness workout tracker with sessions and progress'],
  ['booking', 'Build an appointment booking app for a salon'],
  ['productivity', 'Build a to-do task manager with a kanban board'],
  ['utility', 'Build a tip calculator'],
  ['simple', 'A unit converter'],
];

describe('app architecture — diverse apps get materially different screens (exit gate)', () => {
  it('the 8-prompt matrix does NOT collapse to one architecture', () => {
    const contracts = MATRIX.map(([, p]) => arch(p));
    for (const c of contracts) expect(c.status).toBe('derived');
    const distinctProfiles = new Set(contracts.map(profileKey));
    // At least 6 distinct architectures across 8 prompts (never all identical).
    expect(distinctProfiles.size).toBeGreaterThanOrEqual(6);
    // The archetypes themselves are distinct.
    expect(new Set(contracts.map((c) => c.archetype)).size).toBeGreaterThanOrEqual(6);
  });

  it('classifies each app kind to its archetype', () => {
    expect(arch(MATRIX[0][1]).archetype).toBe('analytics-dashboard');
    expect(arch(MATRIX[1][1]).archetype).toBe('crm-workspace');
    expect(arch(MATRIX[2][1]).archetype).toBe('commerce-app');
    expect(arch(MATRIX[3][1]).archetype).toBe('fitness-tracker');
    expect(arch(MATRIX[4][1]).archetype).toBe('booking-service');
    expect(arch(MATRIX[5][1]).archetype).toBe('productivity-tool');
    expect(arch(MATRIX[6][1]).archetype).toBe('simple-utility');
    expect(arch(MATRIX[7][1]).archetype).toBe('simple-utility');
  });

  it('operator tools get a sidebar; consumer apps get tabs', () => {
    expect(arch(MATRIX[0][1]).shell).toBe('sidebar-app');   // dashboard
    expect(arch(MATRIX[1][1]).shell).toBe('sidebar-app');   // crm
    expect(arch(MATRIX[2][1]).shell).toBe('tabbed-app');    // commerce
    expect(arch(MATRIX[3][1]).shell).toBe('tabbed-app');    // fitness
  });

  it('screen sets genuinely differ (a CRM is not a store is not a dashboard)', () => {
    const crm = arch(MATRIX[1][1]).screens.map((s) => s.id);
    const store = arch(MATRIX[2][1]).screens.map((s) => s.id);
    const dash = arch(MATRIX[0][1]).screens.map((s) => s.id);
    expect(crm).toContain('pipeline');
    expect(crm).toContain('contact-detail');
    expect(store).toContain('cart');
    expect(store).toContain('checkout');
    expect(dash).toContain('overview');
    expect(store).not.toContain('pipeline');
    expect(dash).not.toContain('cart');
  });

  it('is deterministic', () => {
    expect(JSON.stringify(arch(MATRIX[1][1]))).toBe(JSON.stringify(arch(MATRIX[1][1])));
  });
});

describe('app architecture — intentionally-simple utilities are respected', () => {
  it('a tip calculator is a single-screen app, not a multi-tab product', () => {
    const c = arch('Build a tip calculator');
    expect(c.intentionallySimple).toBe(true);
    expect(c.shell).toBe('single-screen');
    expect(c.screens).toHaveLength(1);
    expect(c.screens[0].role).toBe('utility-primary');
  });

  it('a utility screen only carries the states it needs (no fake loading/empty)', () => {
    const c = arch('A stopwatch');
    const states = c.screens[0].states;
    expect(states).not.toContain('loading');
    expect(states).not.toContain('empty');
  });
});

describe('app architecture — screen lifecycle states are role-derived, not universal', () => {
  it('a form screen has saving/success/error; a list has empty/populated', () => {
    const crm = arch(MATRIX[1][1]);
    const form = crm.screens.find((s) => s.role === 'create-edit-form');
    const list = crm.screens.find((s) => s.role === 'list-browse');
    expect(form?.states).toEqual(expect.arrayContaining(['saving', 'success', 'error']));
    expect(list?.states).toEqual(expect.arrayContaining(['empty', 'populated']));
    // A form is never given a "browse empty" state; a list is never given "saving".
    expect(form?.states).not.toContain('empty');
    expect(list?.states).not.toContain('saving');
  });
});

describe('app navigation — real routes, never dead links', () => {
  it('every route resolves to a declared screen and there is exactly one default', () => {
    const c = arch(MATRIX[1][1]);
    const nav = deriveNavigationContract(c);
    expect(nav).toBeTruthy();
    const screenIds = new Set(c.screens.map((s) => s.id));
    for (const r of nav!.routes) expect(screenIds.has(r.screenId)).toBe(true);
    expect(nav!.routes.filter((r) => r.isDefault)).toHaveLength(1);
    expect(nav!.defaultRoute).toBe('/pipeline');
  });

  it('detail/record screens get a deep-link param route; the pattern matches the shell', () => {
    const store = arch(MATRIX[2][1]);
    const nav = deriveNavigationContract(store)!;
    expect(nav.pattern).toBe('bottom-tabs');
    expect(nav.routes.some((r) => r.path === '/product/:id')).toBe(true);
    const dash = arch(MATRIX[0][1]);
    expect(deriveNavigationContract(dash)!.pattern).toBe('sidebar');
  });

  it('primary destinations are the top-level screens only (details/forms are pushed)', () => {
    const c = arch(MATRIX[1][1]);
    const nav = deriveNavigationContract(c)!;
    expect(nav.primaryDestinations).toContain('pipeline');
    expect(nav.primaryDestinations).toContain('contacts');
    expect(nav.primaryDestinations).not.toContain('contact-detail');
    expect(nav.primaryDestinations).not.toContain('contact-edit');
  });

  it('a single-screen utility has single navigation and no back', () => {
    const nav = deriveNavigationContract(arch('Build a tip calculator'))!;
    expect(nav.pattern).toBe('single');
    expect(nav.backBehavior).toBe('none');
  });
});

describe('app architecture/navigation — bounded builder blocks', () => {
  it('renders bounded, non-empty, app-framed (not section-framed) blocks', () => {
    const c = arch(MATRIX[1][1]);
    const nav = deriveNavigationContract(c);
    const archBlock = renderAppArchitectureBlock(c).join('\n');
    const navBlock = renderNavigationBlock(nav).join('\n');
    expect(archBlock).toMatch(/APP ARCHITECTURE/);
    expect(archBlock).toMatch(/SCREENS/);
    expect(archBlock.length).toBeLessThanOrEqual(2800);
    expect(navBlock).toMatch(/APP NAVIGATION/);
    expect(navBlock).toMatch(/\/pipeline/);
    // App blocks never speak the web funnel language.
    expect(archBlock.toLowerCase()).not.toMatch(/hero section|marketing|landing page/);
  });

  it('empty/invalid inputs fail open to no block (never throw)', () => {
    expect(renderAppArchitectureBlock(undefined)).toEqual([]);
    expect(renderNavigationBlock(undefined)).toEqual([]);
    expect(deriveNavigationContract(undefined)).toBeUndefined();
    expect(deriveAppArchitectureContract(undefined).status).toBe('derived');
  });
});
