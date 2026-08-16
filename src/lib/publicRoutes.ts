/**
 * The canonical list of PUBLIC (unauthenticated) routes.
 *
 * Two consumers, one source of truth:
 *   • `src/App.tsx` uses `isPublicPath()` to decide whether the authenticated
 *     app chrome (BottomNav, owner toast, verify-email banner) may render.
 *   • `src/lib/marketingNav.ts` destinations are asserted against this list in
 *     tests, so a navigation or footer entry can never advertise a route that
 *     isn't registered and public. (No `href="#"`, no dead destinations, no
 *     authenticated-only surface dressed up as a public page.)
 *
 * Keep in sync with the <Route> registrations in App.tsx. The test
 * `src/lib/marketingNav.test.ts` fails loudly if a nav/footer link points
 * anywhere else.
 */

/** Public routes with a static path. */
export const PUBLIC_ROUTES = [
  '/',
  // marketing
  '/product',
  '/solutions',
  '/pricing',
  '/about',
  // resources
  '/docs',
  '/tutorials',
  '/changelog',
  '/help',
  '/security',
  // legal / trust
  '/privacy',
  '/privacy/regional',
  '/terms',
  '/cookies',
  '/acceptable-use',
  '/kvkk',
  // legacy marketing aliases (kept so external links never 404)
  '/features',
  '/use-cases',
  // auth + session-aware public surfaces
  '/login',
  '/signup',
  '/billing/return',
  '/verify-email',
  // unlinked placeholders (still registered so direct URLs resolve)
  '/blog',
  '/careers',
] as const;

/**
 * Public route PREFIXES that carry a dynamic segment (`/tutorials/:slug`).
 *
 * `/preview/web-build/:runId` is deliberately NOT listed: it is reachable
 * without auth, but it is a Web Build product surface, and this list also
 * decides which routes drop the app chrome. Leaving it out keeps that page's
 * behaviour byte-identical to before this redesign.
 */
export const PUBLIC_ROUTE_PREFIXES = [
  '/tutorials/',
  '/privacy/regional/',
] as const;

const PUBLIC_SET: ReadonlySet<string> = new Set<string>(PUBLIC_ROUTES);

/** Strip a query string / hash so callers can pass a full `to` value. */
export function pathnameOf(href: string): string {
  return href.split('#')[0].split('?')[0] || '/';
}

/** True when `pathname` is a registered public route (exact or dynamic). */
export function isPublicPath(pathname: string): boolean {
  const clean = pathname.length > 1 && pathname.endsWith('/')
    ? pathname.slice(0, -1)
    : pathname;
  if (PUBLIC_SET.has(clean)) return true;
  return PUBLIC_ROUTE_PREFIXES.some((p) => clean.startsWith(p));
}
