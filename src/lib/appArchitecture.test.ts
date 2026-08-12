import { describe, it, expect } from 'vitest';
import {
  deriveAppArchitectureContract, classifyAppType, type AppArchitectureContract,
} from '@/lib/appArchitecture';
import { deriveNavigationContract } from '@/lib/appNavigation';

/** Phase 2 test matrix — the app architecture must be credible AND diverse: the
 *  eight canonical product prompts must not collapse into one shape. */
const MATRIX: Array<{ label: string; prompt: string }> = [
  { label: 'SaaS dashboard', prompt: 'Build a SaaS analytics dashboard with KPIs and reports' },
  { label: 'CRM', prompt: 'Build a CRM for a small sales team with contacts, deals and pipeline' },
  { label: 'ecommerce', prompt: 'Build an ecommerce management app for orders, products and inventory' },
  { label: 'fitness', prompt: 'Build a fitness coaching app with programs, progress tracking and a schedule' },
  { label: 'booking', prompt: 'Build a booking management app with a calendar and clients' },
  { label: 'productivity', prompt: 'Build a personal productivity task manager with projects' },
  { label: 'utility', prompt: 'Build a small calculator utility app' },
  { label: 'simple', prompt: 'Build an intentionally simple single-screen notes app' },
];

function archFor(prompt: string): AppArchitectureContract {
  const arch = deriveAppArchitectureContract({ prompt });
  expect(arch).toBeDefined();
  return arch as AppArchitectureContract;
}

describe('Phase 2 — app architecture diversity', () => {
  const built = MATRIX.map((m) => ({ ...m, arch: archFor(m.prompt) }));

  it('classifies each prompt to a distinct-enough app type', () => {
    expect(classifyAppType(MATRIX[0].prompt)).toBe('analytics-dashboard');
    expect(classifyAppType(MATRIX[1].prompt)).toBe('crm');
    expect(classifyAppType(MATRIX[2].prompt)).toBe('ecommerce-admin');
    expect(classifyAppType(MATRIX[3].prompt)).toBe('fitness');
    expect(classifyAppType(MATRIX[4].prompt)).toBe('booking');
    expect(classifyAppType(MATRIX[5].prompt)).toBe('productivity');
    expect(classifyAppType(MATRIX[6].prompt)).toBe('utility');
  });

  it('does NOT give every app the same screen count', () => {
    const counts = new Set(built.map((b) => b.arch.screens.length));
    expect(counts.size).toBeGreaterThan(1);
  });

  it('does NOT give every app the same shell (not all tabs, not all sidebars)', () => {
    const shells = built.map((b) => b.arch.shell);
    const uniqueShells = new Set(shells);
    expect(uniqueShells.size).toBeGreaterThan(1);
    // Sidebars for functional tools, tab bars for consumer apps — both must appear.
    expect(shells).toContain('sidebar');
    expect(shells).toContain('tab-bar');
    // Not universally one value.
    expect(shells.every((s) => s === 'tab-bar')).toBe(false);
    expect(shells.every((s) => s === 'sidebar')).toBe(false);
  });

  it('the utility and the intentionally-simple app are not over-engineered', () => {
    const utility = built.find((b) => b.label === 'utility')!.arch;
    const simple = built.find((b) => b.label === 'simple')!.arch;
    const crm = built.find((b) => b.label === 'CRM')!.arch;
    expect(utility.screens.length).toBeLessThanOrEqual(3);
    expect(simple.screens.length).toBeLessThanOrEqual(3);
    expect(crm.screens.length).toBeGreaterThan(utility.screens.length);
  });

  it('every screen has a role, a job and a primary action; entry is a real screen', () => {
    for (const { arch } of built) {
      expect(arch.screens.length).toBeGreaterThan(0);
      const ids = new Set(arch.screens.map((s) => s.id));
      expect(ids.has(arch.primaryEntryScreenId)).toBe(true);
      for (const s of arch.screens) {
        expect(s.role).toBeTruthy();
        expect(s.userJob.length).toBeGreaterThan(0);
        expect(s.primaryAction.length).toBeGreaterThan(0);
        if (s.parentId) expect(ids.has(s.parentId)).toBe(true); // no orphan hierarchy
      }
    }
  });

  it('the user prompt is authoritative — a requested feature adds a screen', () => {
    // A CRM without messaging vs a CRM the prompt asks to include messaging.
    const base = archFor('Build a CRM for a sales team');
    const withChat = archFor('Build a CRM for a sales team with built-in messaging and chat');
    const baseHasMsg = base.screens.some((s) => s.role === 'messaging');
    const chatHasMsg = withChat.screens.some((s) => s.role === 'messaging');
    expect(baseHasMsg).toBe(false);
    expect(chatHasMsg).toBe(true);
  });
});

describe('Phase 2 — navigation contract validity', () => {
  it('every route targets a real screen and the default route exists (no dead routes)', () => {
    for (const { prompt } of MATRIX) {
      const arch = archFor(prompt);
      const nav = deriveNavigationContract(arch);
      expect(nav).toBeDefined();
      const ids = new Set(arch.screens.map((s) => s.id));
      const paths = new Set(nav!.routes.map((r) => r.path));
      expect(paths.has(nav!.defaultRoute)).toBe(true);
      for (const r of nav!.routes) {
        expect(ids.has(r.screenId)).toBe(true); // no dead navigation target
        if (r.parentPath) expect(paths.has(r.parentPath)).toBe(true);
      }
      // A top-level screen maps to '/'.
      expect(nav!.routes.some((r) => r.path === '/')).toBe(true);
    }
  });

  it('navigation placement reflects the app shell (tabs vs sidebar vs stack)', () => {
    const crm = deriveNavigationContract(archFor(MATRIX[1].prompt))!;
    const fitness = deriveNavigationContract(archFor(MATRIX[3].prompt))!;
    expect(crm.primaryNav).toBe('sidebar');
    expect(fitness.primaryNav).toBe('tab-bar');
    expect(crm.primaryNav).not.toBe(fitness.primaryNav);
  });

  it('create/edit screens become modal destinations, not dead top-level tabs', () => {
    const ecom = archFor(MATRIX[2].prompt);
    const nav = deriveNavigationContract(ecom)!;
    const editRoutes = nav.routes.filter((r) => {
      const scr = ecom.screens.find((s) => s.id === r.screenId);
      return scr && (scr.role === 'create' || scr.role === 'edit');
    });
    for (const r of editRoutes) {
      expect(r.placement).toBe('modal');
      expect(r.primary).toBe(false);
    }
  });
});
