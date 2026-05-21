import { Routes, Route, useLocation, Navigate } from 'react-router';
import { useEffect } from 'react';
import { useAuthStore } from '@/stores/authStore';
import LandingPage from './pages/LandingPage';
import FeaturesPage from './pages/FeaturesPage';
import UseCasesPage from './pages/UseCasesPage';
import PricingPage from './pages/PricingPage';
import AboutPage from './pages/AboutPage';
import ChatDashboard from './pages/ChatDashboard';
import SettingsPage from './pages/SettingsPage';
import HomeDashboard from './pages/HomeDashboard';
import WorkspacePage from './pages/WorkspacePage';
import StartupHub from './pages/StartupHub';
import EcommerceOS from './pages/EcommerceOS';
import AgentMarketplace from './pages/AgentMarketplace';
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
import CreditsPage from './pages/CreditsPage';
import BottomNav from './components/BottomNav';
import FloatingOrb from './components/FloatingOrb';
import FloatingParticles from './components/FloatingParticles';
import PageTransition from './components/PageTransition';
import ProtectedRoute from './components/ProtectedRoute';

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
  const showOrb = !isLanding;
  const showParticles = !isLanding;

  return (
    <div className={`min-h-[100dvh] bg-[#0a0a0a] ${showBottomNav ? 'pb-16 sm:pb-0' : ''}`}>
      {children}
      {showBottomNav && <BottomNav />}
      {showOrb && <FloatingOrb />}
      {showParticles && <FloatingParticles />}
    </div>
  );
}

// One-shot guard so a Strict-Mode double-mount doesn't issue /auth/me twice.
let _authBootChecked = false;

export default function App() {
  // Validate the persisted token against the backend on every app boot.
  // Zustand-persist already restores user/isAuthenticated synchronously
  // from localStorage so the landing-page CTA swap works immediately;
  // this just refreshes the user (incl. backend-driven is_owner) and
  // clears auth state if the token has expired or been revoked. The
  // call is a no-op when no token is stored, so guests are unaffected.
  useEffect(() => {
    if (_authBootChecked) return;
    _authBootChecked = true;
    useAuthStore.getState().checkAuth();
  }, []);

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

        {/* ═══ Core workspace (CURRENT PRODUCTION) — guest allowed ═══ */}
        <Route path="/chat" element={<ProtectedRoute guestAllowed><ChatDashboard /></ProtectedRoute>} />
        <Route path="/workspace" element={<ProtectedRoute guestAllowed><AnimatedRoute><WorkspacePage /></AnimatedRoute></ProtectedRoute>} />
        <Route path="/home" element={<ProtectedRoute guestAllowed><AnimatedRoute><HomeDashboard /></AnimatedRoute></ProtectedRoute>} />

        {/* ═══ Agents (CURRENT PRODUCTION) — guest allowed ═══ */}
        <Route path="/agents" element={<ProtectedRoute guestAllowed><AnimatedRoute><AgentMarketplace /></AnimatedRoute></ProtectedRoute>} />
        <Route path="/agents/builder" element={<ProtectedRoute guestAllowed><AnimatedRoute><AgentBuilder /></AnimatedRoute></ProtectedRoute>} />

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
