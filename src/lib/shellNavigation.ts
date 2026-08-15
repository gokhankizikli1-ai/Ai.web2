/**
 * Navigation helpers for KORVIX'S OWN app shell.
 *
 * NAME NOTE — not to be confused with `appNavigation.ts`, which is part of the
 * GENERATION engine (it derives the navigation contract for products Korvix
 * builds for a user). This module is about the Korvix product's own chrome.
 *
 * WHY "BACK" NEEDS A RULE
 * ----------------------
 * A standalone app page (Connectors today, and anything like it later) can be
 * reached two very different ways, and a single hardcoded destination is wrong
 * for one of them:
 *
 *   1. IN-APP — the user clicked through from the chat/workspace surface. The
 *      correct Back is the browser's own previous entry, so they land exactly
 *      where they left, with their scroll and state intact.
 *   2. COLD ENTRY — a bookmark, a hard refresh, or an OAuth callback redirect
 *      (the connector callbacks send the browser to
 *      `/#/settings/integrations?...` as a fresh document load). There is no
 *      in-app history to pop; `history.back()` would leave the app entirely, or
 *      do nothing at all. These need a real route fallback.
 *
 * React Router marks the FIRST entry of a history stack with the location key
 * `"default"`. That is the signal used here — it is router state, not a guess
 * about `history.length` (which counts entries from other origins and is
 * unreliable across browsers).
 *
 * Pure and framework-free on purpose, so the decision is unit-testable without
 * a DOM or a router.
 */

/** Where an app page should send the user when there is no history to pop. */
export const DEFAULT_BACK_ROUTE = '/chat';

/** The router location key given to the first entry in a history stack. */
const INITIAL_LOCATION_KEY = 'default';

export type BackTarget =
  /** Pop one entry — the user navigated here from inside the app. */
  | { kind: 'history' }
  /** Navigate to a concrete in-app route — nothing to pop. */
  | { kind: 'route'; route: string };

export interface ResolveBackTargetInput {
  /**
   * `useLocation().key`. `"default"` (or missing) means this is the first entry
   * of the history stack, i.e. a cold entry with nothing to go back to.
   */
  locationKey?: string | null;
  /**
   * Route to fall back to on a cold entry. Must be an in-app path — never an
   * absolute/external URL, which would bounce the user out of the SPA.
   */
  fallbackRoute?: string;
}

/**
 * Decide whether Back should pop history or navigate to a fallback route.
 *
 * A non-path `fallbackRoute` (absolute URL, protocol-relative, or empty) is
 * rejected in favour of `DEFAULT_BACK_ROUTE`, so a bad value can never turn a
 * Back button into an off-site redirect.
 */
export function resolveBackTarget({
  locationKey,
  fallbackRoute = DEFAULT_BACK_ROUTE,
}: ResolveBackTargetInput = {}): BackTarget {
  const key = (locationKey || '').trim();
  if (key && key !== INITIAL_LOCATION_KEY) return { kind: 'history' };
  return { kind: 'route', route: safeInAppRoute(fallbackRoute) };
}

/**
 * Coerce a fallback to a safe in-app path. Anything that could navigate off the
 * origin (`https://…`, `//host`) or that is not an absolute path collapses to
 * `DEFAULT_BACK_ROUTE`.
 */
export function safeInAppRoute(route: string | null | undefined): string {
  const value = (route || '').trim();
  if (!value.startsWith('/')) return DEFAULT_BACK_ROUTE;
  if (value.startsWith('//')) return DEFAULT_BACK_ROUTE;   // protocol-relative
  return value;
}
