import { describe, it, expect } from 'vitest';
import {
  SIDEBAR_TOP_NAV,
  NEW_PROJECT_ROUTE,
  projectRoute,
  isTopNavActive,
  sidebarShellClasses,
  isProjectGroupExpanded,
  type SidebarNavItem,
} from '@/lib/sidebarNav';

const byKey = (key: string): SidebarNavItem => {
  const item = SIDEBAR_TOP_NAV.find((i) => i.key === key);
  if (!item) throw new Error(`missing nav item: ${key}`);
  return item;
};

describe('top-level workspace navigation', () => {
  it('exposes BOTH Projects and Connectors as top-level entries', () => {
    expect(SIDEBAR_TOP_NAV.map((i) => i.key)).toEqual(['projects', 'connectors']);
  });

  it('puts Projects first and Connectors directly next to it', () => {
    const keys = SIDEBAR_TOP_NAV.map((i) => i.key);
    expect(keys.indexOf('connectors') - keys.indexOf('projects')).toBe(1);
  });

  it('points Projects at the existing projects overview route', () => {
    expect(byKey('projects').to).toBe('/projects');
  });

  it('points Connectors at the existing connectors page route', () => {
    // Same route the Connectors page has always been mounted on — this refactor
    // moves WHERE the entry point sits, never what it opens.
    expect(byKey('connectors').to).toBe('/settings/integrations');
  });

  it('labels every entry through i18n rather than a hardcoded string', () => {
    for (const item of SIDEBAR_TOP_NAV) {
      expect(item.labelKey).toBeTruthy();
      expect(item.labelKey).toBe(item.key); // both keys exist in every locale
    }
  });
});

describe('new project action', () => {
  it('reuses the existing create-project deep link (no second modal/store/API)', () => {
    expect(NEW_PROJECT_ROUTE).toBe('/projects?new=1');
  });

  it('lands on the projects overview, so the created project renders from the store', () => {
    expect(NEW_PROJECT_ROUTE.startsWith(byKey('projects').to)).toBe(true);
  });
});

describe('projectRoute', () => {
  it('uses the real existing project route', () => {
    expect(projectRoute('p-alpha')).toBe('/projects/p-alpha');
  });

  it('encodes ids so an odd id cannot break the path', () => {
    expect(projectRoute('a/b?c')).toBe('/projects/a%2Fb%3Fc');
  });
});

describe('isTopNavActive', () => {
  const projects = byKey('projects');
  const connectors = byKey('connectors');

  it('matches the exact path', () => {
    expect(isTopNavActive(projects, '/projects')).toBe(true);
    expect(isTopNavActive(connectors, '/settings/integrations')).toBe(true);
  });

  it('matches a child path (a project overview still highlights Projects)', () => {
    expect(isTopNavActive(projects, '/projects/p-alpha')).toBe(true);
  });

  it('does NOT match a mere text prefix', () => {
    expect(isTopNavActive(projects, '/projects-archive')).toBe(false);
  });

  it('does not match an unrelated path, or no path at all', () => {
    expect(isTopNavActive(projects, '/chat')).toBe(false);
    expect(isTopNavActive(connectors, '/settings')).toBe(false);
    expect(isTopNavActive(projects, '')).toBe(false);
  });
});

describe('sidebarShellClasses (mobile + desktop contract)', () => {
  it('is a fixed, viewport-capped overlay below lg in BOTH states', () => {
    for (const open of [true, false]) {
      const c = sidebarShellClasses(open);
      expect(c).toContain('fixed inset-y-0 left-0');
      expect(c).toContain('w-[min(260px,85vw)]');
      expect(c).toContain('max-w-[85vw]'); // can never exceed a phone viewport
    }
  });

  it('slides the mobile overlay in when open and out when closed', () => {
    expect(sidebarShellClasses(true)).toContain('translate-x-0');
    expect(sidebarShellClasses(false)).toContain('-translate-x-full');
  });

  it('becomes a width-locked flex sibling at lg+ when open', () => {
    const c = sidebarShellClasses(true);
    expect(c).toContain('lg:relative');
    expect(c).toContain('lg:flex-none');
    expect(c).toContain('lg:w-[288px]');
    expect(c).toContain('lg:min-w-[288px]');
    expect(c).toContain('lg:max-w-[288px]');
  });

  it('collapses to zero width at lg+ when closed, so main content expands', () => {
    const c = sidebarShellClasses(false);
    expect(c).toContain('lg:w-0');
    expect(c).toContain('lg:min-w-0');
    expect(c).toContain('lg:max-w-0');
  });

  it('never lets a long chat title push past the locked width', () => {
    expect(sidebarShellClasses(true)).toContain('overflow-hidden');
    expect(sidebarShellClasses(true)).toContain('min-w-0');
  });
});

describe('isProjectGroupExpanded (collapsed group behaviour)', () => {
  it('keeps the group owning the active chat open by default', () => {
    expect(isProjectGroupExpanded('p1', {}, 'p1')).toBe(true);
  });

  it('leaves every other group collapsed by default', () => {
    expect(isProjectGroupExpanded('p2', {}, 'p1')).toBe(false);
    expect(isProjectGroupExpanded('p2', {}, null)).toBe(false);
  });

  it('lets an explicit user toggle win in both directions', () => {
    // User collapsed the active group — it stays collapsed.
    expect(isProjectGroupExpanded('p1', { p1: false }, 'p1')).toBe(false);
    // User expanded an inactive group — it stays expanded.
    expect(isProjectGroupExpanded('p2', { p2: true }, 'p1')).toBe(true);
  });

  it('ignores malformed persisted values and falls back to the derived default', () => {
    const toggles = { p1: undefined as unknown as boolean };
    expect(isProjectGroupExpanded('p1', toggles, 'p1')).toBe(true);
    expect(isProjectGroupExpanded('p1', toggles, null)).toBe(false);
  });
});
