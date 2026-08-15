import { describe, it, expect } from 'vitest';
import {
  resolveBackTarget, safeInAppRoute, DEFAULT_BACK_ROUTE,
} from '@/lib/shellNavigation';

/**
 * Back-navigation resolution for Korvix's own standalone app pages (Connectors
 * today).
 *
 * The regression this locks down: Back must return an in-app user to where they
 * came from, while a cold entry — bookmark, hard refresh, or a connector OAuth
 * callback, which lands as a brand-new document with no in-app history — still
 * gets a real route instead of a dead button or a bounce out of the SPA.
 */

describe('resolveBackTarget', () => {
  it('pops history when the user navigated here from inside the app', () => {
    // React Router assigns a fresh key to every pushed entry.
    expect(resolveBackTarget({ locationKey: 'x7f2a1' })).toEqual({ kind: 'history' });
  });

  it('falls back to the chat route on the first entry of the stack', () => {
    // "default" is the key React Router gives the initial location — a cold
    // entry, so there is nothing to pop.
    expect(resolveBackTarget({ locationKey: 'default' }))
      .toEqual({ kind: 'route', route: DEFAULT_BACK_ROUTE });
  });

  it('falls back when the key is missing or empty', () => {
    expect(resolveBackTarget({})).toEqual({ kind: 'route', route: DEFAULT_BACK_ROUTE });
    expect(resolveBackTarget()).toEqual({ kind: 'route', route: DEFAULT_BACK_ROUTE });
    expect(resolveBackTarget({ locationKey: null }))
      .toEqual({ kind: 'route', route: DEFAULT_BACK_ROUTE });
    expect(resolveBackTarget({ locationKey: '   ' }))
      .toEqual({ kind: 'route', route: DEFAULT_BACK_ROUTE });
  });

  it('honours an explicit in-app fallback route', () => {
    expect(resolveBackTarget({ locationKey: 'default', fallbackRoute: '/projects' }))
      .toEqual({ kind: 'route', route: '/projects' });
  });

  it('never lets the fallback leave the app', () => {
    // A Back button must not become an off-site redirect, whatever it is handed.
    for (const hostile of ['https://evil.example.com', 'http://x.dev',
                           '//evil.example.com', 'chat', '', '  ']) {
      expect(resolveBackTarget({ locationKey: 'default', fallbackRoute: hostile }))
        .toEqual({ kind: 'route', route: DEFAULT_BACK_ROUTE });
    }
  });

  it('does not consult the fallback at all when history is available', () => {
    expect(resolveBackTarget({ locationKey: 'abc', fallbackRoute: 'https://evil.example.com' }))
      .toEqual({ kind: 'history' });
  });
});

describe('safeInAppRoute', () => {
  it('passes through absolute in-app paths', () => {
    expect(safeInAppRoute('/chat')).toBe('/chat');
    expect(safeInAppRoute('/projects/abc')).toBe('/projects/abc');
    expect(safeInAppRoute('/settings/integrations?x=1')).toBe('/settings/integrations?x=1');
  });

  it('rejects anything that could navigate off-origin', () => {
    expect(safeInAppRoute('https://evil.example.com')).toBe(DEFAULT_BACK_ROUTE);
    expect(safeInAppRoute('//evil.example.com')).toBe(DEFAULT_BACK_ROUTE);
    expect(safeInAppRoute('relative/path')).toBe(DEFAULT_BACK_ROUTE);
    expect(safeInAppRoute(null)).toBe(DEFAULT_BACK_ROUTE);
    expect(safeInAppRoute(undefined)).toBe(DEFAULT_BACK_ROUTE);
  });

  it('trims surrounding whitespace before deciding', () => {
    expect(safeInAppRoute('  /chat  ')).toBe('/chat');
  });
});
