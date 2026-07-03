/**
 * Centralized public-navigation routing for the landing page and shared
 * marketing chrome (Navbar / Footer).
 *
 * Rule: a logged-OUT visitor must never be routed into the app. Every
 * landing CTA / product / footer / resource / company link resolves to
 * `/signup` for anonymous users — the two exceptions are:
 *   • "Sign in"        → /login
 *   • Legal/policy      → stay public (Privacy, Terms, Security)
 *
 * A logged-IN user gets the real in-app destination for each target.
 *
 * This is the single source of truth for those hrefs; callers pass a
 * semantic `NavTarget` plus the current auth state and render whatever
 * `getLandingHref` returns. (Route-level guards in App.tsx enforce the
 * same rule for anyone who types an app URL directly.)
 */

export type NavTarget =
  // auth
  | 'signup'
  | 'signin'
  // app / product surfaces
  | 'workspace'
  | 'startup'
  | 'ecommerce'
  | 'game'
  | 'app-builder'
  | 'agents'
  | 'projects'
  // marketing / resources / company
  | 'features'
  | 'pricing'
  | 'use-cases'
  | 'about'
  | 'contact'
  // legal (always public)
  | 'privacy'
  | 'terms'
  | 'security';

/** Real destination for an authenticated user. */
const AUTHED_HREF: Record<NavTarget, string> = {
  signup: '/signup',
  signin: '/login',
  workspace: '/workspace',
  startup: '/chat?tab=startup',
  ecommerce: '/chat?tab=business',
  game: '/tools/game-builder',
  'app-builder': '/tools/app-builder',
  agents: '/agents',
  projects: '/projects',
  features: '/features',
  pricing: '/pricing',
  'use-cases': '/use-cases',
  about: '/about',
  contact: '/chat',
  privacy: '/privacy',
  terms: '/terms',
  security: '/security',
};

/** Legal/policy targets stay public for everyone (never forced to signup). */
const PUBLIC_LEGAL: ReadonlySet<NavTarget> = new Set<NavTarget>(['privacy', 'terms', 'security']);

/**
 * Resolve a navigation target to an href given the viewer's auth state.
 *
 * @param target  semantic destination
 * @param isAuthed  whether the viewer is a logged-in account
 */
export function getLandingHref(target: NavTarget, isAuthed: boolean): string {
  if (isAuthed) return AUTHED_HREF[target];
  // Logged-out visitors:
  if (target === 'signin') return '/login';
  if (PUBLIC_LEGAL.has(target)) return AUTHED_HREF[target];
  // Everything else — product, workspace, marketing, resources, company,
  // and the primary CTAs — funnels to signup. Never into the app.
  return '/signup';
}
