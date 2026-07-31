/**
 * Billing return route helpers (fix: blank /billing/return under HashRouter).
 *
 * The app mounts with <HashRouter>, so its real routes live after the `#`
 * (e.g. `/#/billing/return`). Polar (and any external provider) redirects to a
 * PATH-based URL, `https://host/billing/return`, with no hash — which HashRouter
 * reads as the root route `/`, so the return page never mounts and the user is
 * left on the near-white root background (a blank white page).
 *
 * `billingReturnHashRewrite()` computes the pre-render rewrite that lands the
 * browser on the correct hash route, mirroring the existing OAuth bootstrap in
 * main.tsx. It is a PURE function of the location parts so it can be unit-tested
 * without a DOM. It never logs and never inspects tokens.
 *
 * `nextReturnState()` is the pure state contract the return page reflects. It is
 * exported for tests and documents that access is NEVER granted from the URL —
 * `activated` requires the backend's authoritative `active === true`.
 */

/** The canonical external checkout-return path (no hash). */
export const BILLING_RETURN_PATH = '/billing/return';
/** The hash route the SPA actually serves. */
export const BILLING_RETURN_HASH = '#/billing/return';

/**
 * Given the current location's pathname + search + hash, return the URL that
 * should be installed via history.replaceState so HashRouter mounts the billing
 * return page — or null when no rewrite is needed.
 *
 * - Only acts on the exact `/billing/return` path (trailing slash tolerated).
 * - Preserves the original query string (Polar may append `?status=…`), moving
 *   it INTO the hash so the hash-based useSearchParams can read it.
 * - No-ops when the hash already targets the billing return route (so a normal
 *   in-app `#/billing/return` navigation is never disturbed), preventing loops.
 */
export function billingReturnHashRewrite(
  pathname: string,
  search: string,
  hash: string,
): string | null {
  const path = (pathname || '').replace(/\/+$/, '') || '/';
  if (path !== BILLING_RETURN_PATH) return null;
  // Already on the hash route (e.g. `#/billing/return` or with a query) → skip.
  if ((hash || '').replace(/^#/, '').replace(/\?.*$/, '').replace(/\/+$/, '') === BILLING_RETURN_PATH) {
    return null;
  }
  const query = search || '';
  // Clear the real path + search; carry everything into the hash route.
  return `/${BILLING_RETURN_HASH}${query}`;
}

/** The subset of the authoritative account snapshot the return page consumes. */
export interface ReturnAccountSnapshot {
  active?: boolean;
  plan?: string | null;
}

export type ReturnState =
  | 'checking' | 'activated' | 'pending' | 'canceled' | 'failed' | 'not-synced';

export type ReturnHint = 'success' | 'canceled' | 'failed' | null;

/**
 * Pure return-state contract (documents + tests the page's behavior).
 *
 * SECURITY: `activated` is returned ONLY when the backend snapshot reports
 * `active === true`. A URL hint alone NEVER produces `activated` — no access is
 * granted from query parameters or the redirect.
 */
export function nextReturnState(args: {
  snapshot: ReturnAccountSnapshot | null;
  hint: ReturnHint;
  pollsExhausted: boolean;
}): ReturnState {
  const { snapshot, hint, pollsExhausted } = args;
  // Backend truth is the ONLY success signal.
  if (snapshot && snapshot.active === true) return 'activated';
  // Definitive negative hints are terminal (still grant nothing).
  if (hint === 'canceled') return 'canceled';
  if (hint === 'failed') return 'failed';
  if (!pollsExhausted) return hint === 'success' ? 'pending' : 'checking';
  // Exhausted polling without a confirmed grant — reflect honestly.
  return hint === 'success' ? 'pending' : 'not-synced';
}
