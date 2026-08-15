import { describe, it, expect } from 'vitest';
import {
  PRIMARY_NAV, FOOTER_COLUMNS, CONNECTORS, allNavDestinations, allNavLabelKeys,
} from '@/lib/marketingNav';
import { isPublicPath, pathnameOf, PUBLIC_ROUTES } from '@/lib/publicRoutes';
import { LOCALES, SUPPORTED_LANGUAGES, translate } from '@/i18n';
import { formatTitle, DEFAULT_TITLE, SITE_NAME } from '@/lib/documentMeta';

/**
 * Guarantees for the public information architecture. These are the rules the
 * redesign is supposed to hold, expressed as tests so a future edit cannot
 * quietly reintroduce a dead link or an untranslated menu item:
 *
 *   1. every advertised destination resolves to a REGISTERED PUBLIC route,
 *   2. nothing is a placeholder (`#`) or an off-site URL pretending to be a page,
 *   3. every label/description key exists in EVERY shipped locale,
 *   4. no authenticated-only surface is advertised in public navigation.
 */

const APP_ONLY_PREFIXES = [
  '/chat', '/projects', '/settings', '/credits', '/tools', '/agents', '/home',
  '/explore', '/workspace', '/owner',
];

describe('public navigation destinations', () => {
  const destinations = allNavDestinations();

  it('advertises at least the four footer columns and three menus', () => {
    expect(FOOTER_COLUMNS).toHaveLength(4);
    expect(PRIMARY_NAV.filter((e) => e.kind === 'menu')).toHaveLength(3);
    expect(destinations.length).toBeGreaterThan(20);
  });

  it('never uses a placeholder or an external href', () => {
    for (const to of destinations) {
      expect(to.startsWith('/'), `"${to}" must be an app-relative path`).toBe(true);
      expect(to).not.toBe('#');
      expect(to).not.toMatch(/^https?:/);
      expect(to).not.toMatch(/^\/#/);
    }
  });

  it('only points at registered public routes', () => {
    for (const to of destinations) {
      const path = pathnameOf(to);
      expect(isPublicPath(path), `"${to}" is not a registered public route`).toBe(true);
    }
  });

  it('never advertises an authenticated-only app surface', () => {
    for (const to of destinations) {
      const path = pathnameOf(to);
      for (const prefix of APP_ONLY_PREFIXES) {
        expect(
          path === prefix || path.startsWith(`${prefix}/`),
          `"${to}" advertises the authenticated surface ${prefix}`,
        ).toBe(false);
      }
    }
  });

  it('uses in-page anchors only on pages that can host them', () => {
    const anchored = destinations.filter((d) => d.includes('#'));
    expect(anchored.length).toBeGreaterThan(0);
    for (const to of anchored) {
      const [path, hash] = to.split('#');
      expect(['/product', '/solutions', '/'].includes(path), `${to} anchors an unexpected page`).toBe(true);
      expect(hash.length).toBeGreaterThan(0);
    }
  });

  it('has no duplicate destinations inside a single footer column', () => {
    for (const col of FOOTER_COLUMNS) {
      const seen = col.items.map((i) => i.to);
      expect(new Set(seen).size).toBe(seen.length);
    }
  });
});

describe('public navigation labels', () => {
  it('resolves every label/description key in every shipped locale', () => {
    const keys = allNavLabelKeys();
    expect(keys.length).toBeGreaterThan(40);
    for (const lang of SUPPORTED_LANGUAGES.map((l) => l.code)) {
      for (const key of keys) {
        const value = translate(lang, key);
        // A missing key resolves to the raw key — that is the failure we want.
        expect(value, `"${key}" is missing for "${lang}"`).not.toBe(key);
        expect(value.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('keeps English as the master dictionary for every nav key', () => {
    for (const key of allNavLabelKeys()) {
      expect(Object.prototype.hasOwnProperty.call(LOCALES.en, key)).toBe(true);
    }
  });
});

describe('connector catalog', () => {
  it('describes exactly the five connectors the product ships', () => {
    expect(CONNECTORS.map((c) => c.id).sort()).toEqual(
      ['calendar', 'github', 'gmail', 'slack', 'vercel'],
    );
  });

  it('marks only GitHub as event-driven (everything else is sync-only)', () => {
    const events = CONNECTORS.filter((c) => c.refresh === 'events').map((c) => c.id);
    expect(events).toEqual(['github']);
  });
});

describe('public route table', () => {
  it('recognizes the redesigned public surfaces', () => {
    for (const p of ['/', '/product', '/solutions', '/docs', '/tutorials', '/changelog',
      '/help', '/security', '/privacy', '/privacy/regional', '/terms', '/cookies',
      '/acceptable-use', '/kvkk', '/features', '/use-cases']) {
      expect(isPublicPath(p), `${p} should be public`).toBe(true);
    }
  });

  it('recognizes dynamic public children', () => {
    expect(isPublicPath('/tutorials/connect-github')).toBe(true);
    expect(isPublicPath('/privacy/regional/turkiye')).toBe(true);
  });

  it('does not treat app surfaces as public', () => {
    for (const p of ['/chat', '/projects', '/projects/abc', '/settings',
      '/settings/integrations', '/credits', '/tools/app-builder']) {
      expect(isPublicPath(p), `${p} must not be public`).toBe(false);
    }
  });

  it('tolerates a trailing slash', () => {
    expect(isPublicPath('/docs/')).toBe(true);
  });

  it('keeps legacy marketing aliases routable', () => {
    // They redirect, but the paths must stay registered so old links resolve.
    expect(PUBLIC_ROUTES).toContain('/features');
    expect(PUBLIC_ROUTES).toContain('/use-cases');
    expect(PUBLIC_ROUTES).toContain('/kvkk');
  });
});

describe('document titles', () => {
  it('suffixes a page title with the site name', () => {
    expect(formatTitle('Security')).toBe(`Security · ${SITE_NAME}`);
  });

  it('falls back to the homepage title for empty input', () => {
    expect(formatTitle()).toBe(DEFAULT_TITLE);
    expect(formatTitle('   ')).toBe(DEFAULT_TITLE);
    expect(formatTitle(SITE_NAME)).toBe(DEFAULT_TITLE);
  });
});
