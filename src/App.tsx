import { useEffect, useState, lazy, Suspense } from 'react';
import { Routes, Route, useLocation, Navigate } from 'react-router';
import { useAuthStore } from '@/stores/authStore';
import { currentStorageScope, IDENTITY_CHANGED_EVENT } from '@/lib/storageScope';

// ── Startup performance (Phase 14I.2) ───────────────────────────────────
// CONCRETE bottleneck: every page module below used to be a STATIC import,
// so the landing/first-paint bundle eagerly pulled in the entire
// authenticated app — ChatDashboard, the Website/App/Game builders,
// MultiAgentSwarm, the project workspaces, etc. — even though a logged-out
// visitor on `/` never renders any of them. Those authenticated surfaces are
// the heaviest modules in the tree.
//
// FIX (not speculative — this is the "lazy-load app routes from landing"
// allowed by the sprint): keep every PUBLIC route eager (landing + marketing
// + auth + ComingSoon) so the public experience has zero extra round-trips,
// and code-split each AUTHENTICATED surface behind React.lazy so it downloads
// only when that route is actually visited (all of them sit behind
// ProtectedRoute, so a logged-out landing visitor never fetches them). This
// removes ~two dozen heavy modules from the initial bundle without changing
// any routing or auth behavior. Suspense (below) covers the one-time chunk
// fetch with a neutral fallback.
import LandingPage from './pages/LandingPage';
import FeaturesPage from './pages/FeaturesPage';
import UseCasesPage from './pages/UseCasesPage';
import PricingPage from './pages/PricingPage';
import AboutPage from './pages/AboutPage';
import LegalPage from './pages/LegalPage';
import ComingSoon from './pages/ComingSoon';
import AuthPage from './pages/AuthPage';

// Authenticated app surfaces — code-split (see note above).
const ChatDashboard = lazy(() => import('./pages/ChatDashboard'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const HomeDashboard = lazy(() => import('./pages/HomeDashboard'));
const StartupHub = lazy(() => import('./pages/StartupHub'));
const EcommerceOS = lazy(() => import('./pages/EcommerceOS'));
const AgentBuilder = lazy(() => import('./pages/AgentBuilder'));
const ToolsPage = lazy(() => import('./pages/ToolsPage'));
const ExplorePage = lazy(() => import('./pages/ExplorePage'));
const WebsiteAnalyzer = lazy(() => import('./pages/WebsiteAnalyzer'));
const WebsiteBuilder = lazy(() => import('./pages/WebsiteBuilder'));
const WebBuildPreview = lazy(() => import('./pages/WebBuildPreview'));
const AppBuilder = lazy(() => import('./pages/AppBuilder'));
const GameBuilder = lazy(() => import('./pages/GameBuilder'));
const BrandBuilder = lazy(() => import('./pages/BrandBuilder'));
const ViralContent = lazy(() => import('./pages/ViralContent'));
const KnowledgeVault = lazy(() => import('./pages/KnowledgeVault'));
const Automations = lazy(() => import('./pages/Automations'));
const MultiAgentSwarm = lazy(() => import('./pages/MultiAgentSwarm'));
const ProjectsDashboard = lazy(() => import('./pages/ProjectsDashboard'));
const ProjectWorkspace = lazy(() => import('./pages/ProjectWorkspace'));
const ProjectResults = lazy(() => import('./pages/ProjectResults'));
const AgentsPage = lazy(() => import('./pages/AgentsPage'));
const AgentChatPage = lazy(() => import('./pages/AgentChatPage'));
const CreditsPage = lazy(() => import('./pages/CreditsPage'));

import BottomNav from './components/BottomNav';
import FloatingParticles from './components/FloatingParticles';
import PageTransition from './components/PageTransition';
import ProtectedRoute from './components/ProtectedRoute';
import OwnerRoute from './components/OwnerRoute';
import BuildInfoOverlay from './components/BuildInfoOverlay';
import OwnerWelcomeToast from './components/OwnerWelcomeToast';

function AnimatedRoute({ children }: { children: React.ReactNode }) {
  return (
    <PageTransition>
      {children}
    </PageTransition>
  );
}

/**
 * Suspense fallback for a code-split route's one-time chunk fetch (Phase
 * 14I.2). Neutral centered spinner on a tall region (inherits the layout's
 * bg-background from AppLayout) so the transition into a lazily-loaded
 * authenticated surface reads as a brief load rather than a flash of empty
 * page. Public routes are eager and never hit this.
 */
function RouteFallback() {
  return (
    <div
      className="flex min-h-[60vh] w-full items-center justify-center"
      role="status"
      aria-live="polite"
    >
      <span className="sr-only">Loading…</span>
      <span
        className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground/25 border-t-muted-foreground/70"
        aria-hidden="true"
      />
    </div>
  );
}

/**
 * Phase 14D.1 — identity-change REHYDRATION boundary.
 * Phase 14D.3 — hardened so it NEVER remounts on a logout / token-expiry.
 *
 * Data hooks read their scoped localStorage ONCE into React state (via
 * `useState(() => load())`), so an in-app switch to a DIFFERENT authenticated
 * account that only re-points the storage scope would leave the previous
 * account's rows sitting in memory. Keying this subtree by the authenticated
 * scope remounts every data container when the account actually changes,
 * forcing each hook to re-read from the NEW scope. No data is destroyed: each
 * identity's rows stay in their own keys, so the same user re-reads them on
 * re-login.
 *
 * CRITICAL (14D.3): we key ONLY on a change to a different authenticated
 * (`user_*`) scope. A transition to a GUEST scope — logout, or a background
 * /auth/me 401 that removes `korvix-auth` — is deliberately IGNORED here: that
 * case is already handled cleanly by ProtectedRoute redirecting the logged-out
 * user to /signup, which unmounts the authenticated surfaces. Remounting the
 * entire routed tree on top of that redirect is what produced the black-screen
 * blank flash. Guests never render user-scoped data, so skipping the remount
 * cannot leak the previous account's rows.
 *
 * The scope is seeded synchronously from localStorage, so the first mount uses
 * the persisted identity's key (no spurious remount on boot). We dedupe on the
 * scope STRING, so a same-identity notification (a profile refresh) never
 * remounts.
 */
function useIdentityScope(): string {
  const [scope, setScope] = useState(() => currentStorageScope());
  useEffect(() => {
    const sync = () => {
      const next = currentStorageScope();
      // Only a switch to a DIFFERENT authenticated account remounts. Logout /
      // token-expiry (→ a guest scope) is handled by ProtectedRoute's redirect;
      // remounting here as well would flash a blank frame.
      if (!next.startsWith('user_')) return;
      setScope((prev) => (prev === next ? prev : next));
    };
    // Same-tab: authStore fires IDENTITY_CHANGED_EVENT ONLY when the effective
    // scope actually changes (see notifyIdentityChanged).
    const onIdentity = () => sync();
    // Cross-tab: react ONLY to identity-owning keys. Chat/session/project/prompt
    // writes in another tab must never recompute (let alone remount) identity.
    const onStorage = (event: StorageEvent) => {
      if (
        event.key !== null &&
        event.key !== 'korvix-auth' &&
        event.key !== 'korvix_access_token' &&
        event.key !== 'korvix_user_id'
      ) {
        return;
      }
      sync();
    };
    window.addEventListener(IDENTITY_CHANGED_EVENT, onIdentity);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(IDENTITY_CHANGED_EVENT, onIdentity);
      window.removeEventListener('storage', onStorage);
    };
  }, []);
  return scope;
}

function IdentityScopeBoundary({ children }: { children: React.ReactNode }) {
  const scope = useIdentityScope();
  // display:contents keeps the wrapper layout-neutral — the remount key lives
  // on a node that adds no box to the tree.
  return <div style={{ display: 'contents' }} key={scope}>{children}</div>;
}

function AppLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const isLanding = location.pathname === '/';
  const showParticles = !isLanding;
  // Public / unauthenticated marketing + auth surfaces. The owner
  // welcome toast must never render here — it would either leak the
  // existence of an owner session to other visitors on a shared
  // screen, or simply look out of place on a marketing page.
  // Everything NOT in this set is treated as authenticated app shell
  // (chat, projects, settings, etc.) where the toast is allowed.
  const PUBLIC_ROUTE_PREFIXES = [
    '/',          // landing
    '/features',
    '/use-cases',
    '/pricing',
    '/about',
    '/login',
    '/signup',
    '/blog',
    '/careers',
    '/privacy',
    '/terms',
    '/cookies',
    '/kvkk',
    '/acceptable-use',
  ];
  const isPublicRoute = (
    location.pathname === '/' ||
    PUBLIC_ROUTE_PREFIXES.some((p) => p !== '/' && location.pathname.startsWith(p))
  );
  // Phase 14I.1 — the mobile BottomNav is AUTHENTICATED app navigation (Chat /
  // Web Build / Projects, all guest-blocked). It must never render on public
  // routes — especially /login and /signup, where it showed a misleading
  // "active" app tab that just bounced the visitor to sign-up. Gate it on the
  // canonical public-route check (which already includes the auth routes), so
  // authenticated app routes keep it exactly as before and no empty reserved
  // bar is left on auth pages (the bottom padding below is tied to the same flag).
  const showBottomNav = !isPublicRoute;

  // Kick auth hydration exactly once on app boot. authStore's checkAuth
  // reads the persisted session synchronously when present (no network),
  // then validates the JWT against /auth/me in the background. Without
  // this call, isHydrating stays true forever and consumers that gate
  // on it (Sidebar guest CTA, OwnerModeChip, OwnerWelcomeToast) hide
  // their state-dependent UI permanently. Single-fire — checkAuth
  // dedupes via the persisted state path.
  useEffect(() => {
    useAuthStore.getState().checkAuth();
  }, []);

  // overflow-x-hidden + max-w-full at the layout root so any rogue
  // wide child (a code block, a long URL, a fixed-width child) can
  // never push the viewport into horizontal scroll on iPad / mobile.
  // The CSS-level guard in src/index.css covers iOS Safari edge cases
  // where layout-level guards alone aren't enough.
  return (
    <div
      className={`min-h-[100dvh] w-full max-w-full overflow-x-hidden bg-background ${showBottomNav ? 'pb-16 sm:pb-0' : ''}`}
    >
      {children}
      {showBottomNav && <BottomNav />}
      {showParticles && <FloatingParticles />}
      {/* BuildInfoOverlay renders NOTHING for normal users. Visible
          only to owners or with ?debug=1 / localStorage korvix_debug=1.
          Shows FE+BE commit SHAs side by side so you can immediately
          see which deploy is actually live and whether they match. */}
      <BuildInfoOverlay />
      {/* OwnerWelcomeToast — one-shot premium greeting that fires
          when an owner session activates. Renders NOTHING for
          non-owners, after the per-session show flag is set, OR on
          any public/marketing route (landing, features, pricing,
          auth pages — places where the toast would feel jarring or
          leak owner existence to non-owners on a shared screen). */}
      {!isPublicRoute && <OwnerWelcomeToast />}
    </div>
  );
}

export default function App() {
  return (
    <AppLayout>
      <IdentityScopeBoundary>
      <Suspense fallback={<RouteFallback />}>
      <Routes>
        {/* ═══ Landing ═══ */}
        <Route path="/" element={<LandingPage />} />

        {/* ═══ Marketing pages — fully public (viewable while logged out) ═══ */}
        <Route path="/features" element={<AnimatedRoute><FeaturesPage /></AnimatedRoute>} />
        <Route path="/use-cases" element={<AnimatedRoute><UseCasesPage /></AnimatedRoute>} />
        <Route path="/pricing" element={<AnimatedRoute><PricingPage /></AnimatedRoute>} />
        <Route path="/about" element={<AnimatedRoute><AboutPage /></AnimatedRoute>} />

        {/* ═══ App surfaces — REQUIRE an account. A logged-out visitor
             (incl. anonymous guests) is redirected to /signup and never
             lands in the app. Authenticated owner/admin sessions are
             unaffected. ═══ */}
        {/* Core workspace */}
        <Route path="/chat" element={<ProtectedRoute guestAllowed={false} redirectTo="/signup"><ChatDashboard /></ProtectedRoute>} />
        <Route path="/workspace" element={<Navigate to="/chat" replace />} />
        <Route path="/home" element={<ProtectedRoute guestAllowed={false} redirectTo="/signup"><AnimatedRoute><HomeDashboard /></AnimatedRoute></ProtectedRoute>} />

        {/* Project-based Multi-Agent Workspace */}
        <Route path="/projects" element={<ProtectedRoute guestAllowed={false} redirectTo="/signup"><ProjectsDashboard /></ProtectedRoute>} />
        <Route path="/projects/:projectId" element={<ProtectedRoute guestAllowed={false} redirectTo="/signup"><ProjectWorkspace /></ProtectedRoute>} />
        <Route path="/projects/:projectId/runs" element={<ProtectedRoute guestAllowed={false} redirectTo="/signup"><ProjectResults /></ProtectedRoute>} />

        {/* Agents */}
        <Route path="/agents" element={<ProtectedRoute guestAllowed={false} redirectTo="/signup"><OwnerRoute><AgentsPage /></OwnerRoute></ProtectedRoute>} />
        <Route path="/agents/:agentId" element={<ProtectedRoute guestAllowed={false} redirectTo="/signup"><OwnerRoute><AgentChatPage /></OwnerRoute></ProtectedRoute>} />
        <Route path="/agents/builder" element={<ProtectedRoute guestAllowed={false} redirectTo="/signup"><OwnerRoute><AgentBuilder /></OwnerRoute></ProtectedRoute>} />

        {/* Tools (standalone pages) */}
        <Route path="/tools" element={<ProtectedRoute guestAllowed={false} redirectTo="/signup"><AnimatedRoute><ToolsPage /></AnimatedRoute></ProtectedRoute>} />
        <Route path="/tools/startup" element={<ProtectedRoute guestAllowed={false} redirectTo="/signup"><OwnerRoute><AnimatedRoute><StartupHub /></AnimatedRoute></OwnerRoute></ProtectedRoute>} />
        <Route path="/tools/ecommerce" element={<ProtectedRoute guestAllowed={false} redirectTo="/signup"><OwnerRoute><AnimatedRoute><EcommerceOS /></AnimatedRoute></OwnerRoute></ProtectedRoute>} />
        <Route path="/tools/website-analyzer" element={<ProtectedRoute guestAllowed={false} redirectTo="/signup"><AnimatedRoute><WebsiteAnalyzer /></AnimatedRoute></ProtectedRoute>} />
        <Route path="/tools/website-builder" element={<ProtectedRoute guestAllowed={false} redirectTo="/signup"><AnimatedRoute><WebsiteBuilder /></AnimatedRoute></ProtectedRoute>} />
        <Route path="/tools/app-builder" element={<ProtectedRoute guestAllowed={false} redirectTo="/signup"><AnimatedRoute><AppBuilder /></AnimatedRoute></ProtectedRoute>} />
        {/* Phase 14A — Game Builder is an unfinished launch surface: gate the authoritative
             client screen behind OwnerRoute (same guard already used by startup/ecommerce/
             agents). A normal user reaching this via any launch point, a direct URL, or a
             restored route is safely returned to /chat; an owner session ending while this
             screen is open re-renders and falls back without a refresh. Frontend gating only —
             backend authorization is unchanged and reviewed separately in the security audit. */}
        <Route path="/tools/game-builder" element={<ProtectedRoute guestAllowed={false} redirectTo="/signup"><OwnerRoute><AnimatedRoute><GameBuilder /></AnimatedRoute></OwnerRoute></ProtectedRoute>} />
        <Route path="/tools/brand-builder" element={<ProtectedRoute guestAllowed={false} redirectTo="/signup"><AnimatedRoute><BrandBuilder /></AnimatedRoute></ProtectedRoute>} />
        <Route path="/tools/viral-content" element={<ProtectedRoute guestAllowed={false} redirectTo="/signup"><AnimatedRoute><ViralContent /></AnimatedRoute></ProtectedRoute>} />
        <Route path="/tools/knowledge-vault" element={<ProtectedRoute guestAllowed={false} redirectTo="/signup"><AnimatedRoute><KnowledgeVault /></AnimatedRoute></ProtectedRoute>} />
        <Route path="/tools/automations" element={<ProtectedRoute guestAllowed={false} redirectTo="/signup"><AnimatedRoute><Automations /></AnimatedRoute></ProtectedRoute>} />
        <Route path="/tools/swarm" element={<ProtectedRoute guestAllowed={false} redirectTo="/signup"><AnimatedRoute><MultiAgentSwarm /></AnimatedRoute></ProtectedRoute>} />

        {/* ═══ Settings / Credits / Auth ═══ */}
        <Route path="/settings" element={<ProtectedRoute guestAllowed={false}><AnimatedRoute><SettingsPage /></AnimatedRoute></ProtectedRoute>} />
        <Route path="/login" element={<AnimatedRoute><AuthPage /></AnimatedRoute>} />
        <Route path="/signup" element={<AnimatedRoute><AuthPage mode="signup" /></AnimatedRoute>} />
        <Route path="/credits" element={<ProtectedRoute guestAllowed={false} redirectTo="/signup"><AnimatedRoute><CreditsPage /></AnimatedRoute></ProtectedRoute>} />

        {/* ═══ Explore — requires account ═══ */}
        <Route path="/explore" element={<ProtectedRoute guestAllowed={false} redirectTo="/signup"><AnimatedRoute><ExplorePage /></AnimatedRoute></ProtectedRoute>} />

        {/* ═══ Redirect old workspace routes to /chat ═══ */}
        <Route path="/tools/startup" element={<Navigate to="/chat?tab=startup" replace />} />
        <Route path="/tools/ecommerce" element={<Navigate to="/chat?tab=business" replace />} />
        <Route path="/tools/*" element={<Navigate to="/chat" replace />} />
        <Route path="/startup" element={<Navigate to="/chat?tab=startup" replace />} />
        <Route path="/ecommerce" element={<Navigate to="/chat?tab=business" replace />} />
        <Route path="/trading" element={<Navigate to="/chat?tab=trading" replace />} />
        {/* Note: /agents is kept for the standalone marketplace; but workspace agents goes to /chat?tab=agents */}

        {/* Standalone generated Web Build preview (real openable URL, client-side). */}
        <Route path="/preview/web-build/:runId" element={<WebBuildPreview />} />

        {/* ═══ Public legal / policy pages — fully public (no auth). Rendered by
             the shared data-driven LegalPage; routes are also listed in
             PUBLIC_ROUTE_PREFIXES above so no authenticated app chrome
             (BottomNav / owner toast) appears and direct-load / refresh works. ═══ */}
        <Route path="/privacy" element={<AnimatedRoute><LegalPage doc="privacy" /></AnimatedRoute>} />
        <Route path="/terms" element={<AnimatedRoute><LegalPage doc="terms" /></AnimatedRoute>} />
        <Route path="/cookies" element={<AnimatedRoute><LegalPage doc="cookies" /></AnimatedRoute>} />
        <Route path="/kvkk" element={<AnimatedRoute><LegalPage doc="kvkk" /></AnimatedRoute>} />
        <Route path="/acceptable-use" element={<AnimatedRoute><LegalPage doc="acceptableUse" /></AnimatedRoute>} />

        {/* ═══ Coming soon placeholders ═══ */}
        <Route path="/blog" element={<AnimatedRoute><ComingSoon title="Blog" pageType="blog" /></AnimatedRoute>} />
        <Route path="/careers" element={<AnimatedRoute><ComingSoon title="Careers" pageType="careers" /></AnimatedRoute>} />
      </Routes>
      </Suspense>
      </IdentityScopeBoundary>
    </AppLayout>
  );
}
