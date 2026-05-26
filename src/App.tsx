import { useEffect } from 'react';
import { Routes, Route, useLocation, Navigate } from 'react-router';
import { useAuthStore } from '@/stores/authStore';
import LandingPage from './pages/LandingPage';
import FeaturesPage from './pages/FeaturesPage';
import UseCasesPage from './pages/UseCasesPage';
import PricingPage from './pages/PricingPage';
import AboutPage from './pages/AboutPage';
import ChatDashboard from './pages/ChatDashboard';
import SettingsPage from './pages/SettingsPage';
import HomeDashboard from './pages/HomeDashboard';
import StartupHub from './pages/StartupHub';
import EcommerceOS from './pages/EcommerceOS';
import AgentBuilder from './pages/AgentBuilder';
import ToolsPage from './pages/ToolsPage';
import ExplorePage from './pages/ExplorePage';
import WebsiteAnalyzer from './pages/WebsiteAnalyzer';
import WebsiteBuilder from './pages/WebsiteBuilder';
import AppBuilder from './pages/AppBuilder';
import BrandBuilder from './pages/BrandBuilder';
import ViralContent from './pages/ViralContent';
import KnowledgeVault from './pages/KnowledgeVault';
import Automations from './pages/Automations';
import MultiAgentSwarm from './pages/MultiAgentSwarm';
import ComingSoon from './pages/ComingSoon';
import AuthPage from './pages/AuthPage';
import ProjectsDashboard from './pages/ProjectsDashboard';
import ProjectWorkspace from './pages/ProjectWorkspace';
import AgentsPage from './pages/AgentsPage';
import AgentChatPage from './pages/AgentChatPage';
import CreditsPage from './pages/CreditsPage';
import BottomNav from './components/BottomNav';
import FloatingParticles from './components/FloatingParticles';
import PageTransition from './components/PageTransition';
import ProtectedRoute from './components/ProtectedRoute';
import BuildInfoOverlay from './components/BuildInfoOverlay';
import OwnerWelcomeToast from './components/OwnerWelcomeToast';

function AnimatedRoute({ children }: { children: React.ReactNode }) {
  return (
    <PageTransition>
      {children}
    </PageTransition>
  );
}

function AppLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const isLanding = location.pathname === '/';
  const showBottomNav = !isLanding;
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
  ];
  const isPublicRoute = (
    location.pathname === '/' ||
    PUBLIC_ROUTE_PREFIXES.some((p) => p !== '/' && location.pathname.startsWith(p))
  );

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
      <Routes>
        {/* ═══ Landing ═══ */}
        <Route path="/" element={<LandingPage />} />

        {/* ═══ Marketing pages — guest allowed ═══ */}
        <Route path="/features" element={<ProtectedRoute guestAllowed><AnimatedRoute><FeaturesPage /></AnimatedRoute></ProtectedRoute>} />
        <Route path="/use-cases" element={<ProtectedRoute guestAllowed><AnimatedRoute><UseCasesPage /></AnimatedRoute></ProtectedRoute>} />
        <Route path="/pricing" element={<ProtectedRoute guestAllowed><AnimatedRoute><PricingPage /></AnimatedRoute></ProtectedRoute>} />
        <Route path="/about" element={<ProtectedRoute guestAllowed><AnimatedRoute><AboutPage /></AnimatedRoute></ProtectedRoute>} />

        {/* ═══ Core workspace — guest allowed ═══ */}
        <Route path="/chat" element={<ProtectedRoute guestAllowed><ChatDashboard /></ProtectedRoute>} />
        <Route path="/workspace" element={<Navigate to="/chat" replace />} />
        <Route path="/home" element={<ProtectedRoute guestAllowed><AnimatedRoute><HomeDashboard /></AnimatedRoute></ProtectedRoute>} />

        {/* ═══ Project-based Multi-Agent Workspace — guest allowed ═══ */}
        <Route path="/projects" element={<ProtectedRoute guestAllowed><ProjectsDashboard /></ProtectedRoute>} />
        <Route path="/projects/:projectId" element={<ProtectedRoute guestAllowed><ProjectWorkspace /></ProtectedRoute>} />

        {/* ═══ Agents — guest allowed ═══ */}
        <Route path="/agents" element={<ProtectedRoute guestAllowed><AgentsPage /></ProtectedRoute>} />
        <Route path="/agents/:agentId" element={<ProtectedRoute guestAllowed><AgentChatPage /></ProtectedRoute>} />
        <Route path="/agents/builder" element={<ProtectedRoute guestAllowed><AgentBuilder /></ProtectedRoute>} />

        {/* ═══ Tools (optional standalone pages, NOT main routes) — guest allowed ═══ */}
        <Route path="/tools" element={<ProtectedRoute guestAllowed><AnimatedRoute><ToolsPage /></AnimatedRoute></ProtectedRoute>} />
        <Route path="/tools/startup" element={<ProtectedRoute guestAllowed><AnimatedRoute><StartupHub /></AnimatedRoute></ProtectedRoute>} />
        <Route path="/tools/ecommerce" element={<ProtectedRoute guestAllowed><AnimatedRoute><EcommerceOS /></AnimatedRoute></ProtectedRoute>} />
        <Route path="/tools/website-analyzer" element={<ProtectedRoute guestAllowed><AnimatedRoute><WebsiteAnalyzer /></AnimatedRoute></ProtectedRoute>} />
        <Route path="/tools/website-builder" element={<ProtectedRoute guestAllowed><AnimatedRoute><WebsiteBuilder /></AnimatedRoute></ProtectedRoute>} />
        <Route path="/tools/app-builder" element={<ProtectedRoute guestAllowed><AnimatedRoute><AppBuilder /></AnimatedRoute></ProtectedRoute>} />
        <Route path="/tools/brand-builder" element={<ProtectedRoute guestAllowed><AnimatedRoute><BrandBuilder /></AnimatedRoute></ProtectedRoute>} />
        <Route path="/tools/viral-content" element={<ProtectedRoute guestAllowed><AnimatedRoute><ViralContent /></AnimatedRoute></ProtectedRoute>} />
        <Route path="/tools/knowledge-vault" element={<ProtectedRoute guestAllowed><AnimatedRoute><KnowledgeVault /></AnimatedRoute></ProtectedRoute>} />
        <Route path="/tools/automations" element={<ProtectedRoute guestAllowed><AnimatedRoute><Automations /></AnimatedRoute></ProtectedRoute>} />
        <Route path="/tools/swarm" element={<ProtectedRoute guestAllowed><AnimatedRoute><MultiAgentSwarm /></AnimatedRoute></ProtectedRoute>} />

        {/* ═══ Settings / Credits / Auth ═══ */}
        <Route path="/settings" element={<ProtectedRoute guestAllowed={false}><AnimatedRoute><SettingsPage /></AnimatedRoute></ProtectedRoute>} />
        <Route path="/login" element={<AnimatedRoute><AuthPage /></AnimatedRoute>} />
        <Route path="/signup" element={<AnimatedRoute><AuthPage mode="signup" /></AnimatedRoute>} />
        <Route path="/credits" element={<ProtectedRoute guestAllowed><AnimatedRoute><CreditsPage /></AnimatedRoute></ProtectedRoute>} />

        {/* ═══ Explore — guest allowed ═══ */}
        <Route path="/explore" element={<ProtectedRoute guestAllowed><AnimatedRoute><ExplorePage /></AnimatedRoute></ProtectedRoute>} />

        {/* ═══ Redirect old workspace routes to /chat ═══ */}
        <Route path="/tools/startup" element={<Navigate to="/chat?tab=startup" replace />} />
        <Route path="/tools/ecommerce" element={<Navigate to="/chat?tab=business" replace />} />
        <Route path="/tools/*" element={<Navigate to="/chat" replace />} />
        <Route path="/startup" element={<Navigate to="/chat?tab=startup" replace />} />
        <Route path="/ecommerce" element={<Navigate to="/chat?tab=business" replace />} />
        <Route path="/trading" element={<Navigate to="/chat?tab=trading" replace />} />
        {/* Note: /agents is kept for the standalone marketplace; but workspace agents goes to /chat?tab=agents */}

        {/* ═══ Coming soon placeholders ═══ */}
        <Route path="/blog" element={<AnimatedRoute><ComingSoon title="Blog" pageType="blog" /></AnimatedRoute>} />
        <Route path="/careers" element={<AnimatedRoute><ComingSoon title="Careers" pageType="careers" /></AnimatedRoute>} />
        <Route path="/privacy" element={<AnimatedRoute><ComingSoon title="Privacy Policy" pageType="legal" /></AnimatedRoute>} />
        <Route path="/terms" element={<AnimatedRoute><ComingSoon title="Terms of Service" pageType="legal" /></AnimatedRoute>} />
      </Routes>
    </AppLayout>
  );
}
