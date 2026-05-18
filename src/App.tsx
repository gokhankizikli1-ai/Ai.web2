import { Routes, Route, useLocation, Navigate } from 'react-router';
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

export default function App() {
  return (
    <AppLayout>
      <Routes>
        {/* ═══ Landing ═══ */}
        <Route path="/" element={<LandingPage />} />

        {/* ═══ Marketing pages ═══ */}
        <Route path="/features" element={<AnimatedRoute><FeaturesPage /></AnimatedRoute>} />
        <Route path="/use-cases" element={<AnimatedRoute><UseCasesPage /></AnimatedRoute>} />
        <Route path="/pricing" element={<AnimatedRoute><PricingPage /></AnimatedRoute>} />
        <Route path="/about" element={<AnimatedRoute><AboutPage /></AnimatedRoute>} />

        {/* ═══ Core workspace (CURRENT PRODUCTION) ═══ */}
        <Route path="/chat" element={<ChatDashboard />} />
        <Route path="/workspace" element={<AnimatedRoute><WorkspacePage /></AnimatedRoute>} />
        <Route path="/home" element={<AnimatedRoute><HomeDashboard /></AnimatedRoute>} />

        {/* ═══ Agents (CURRENT PRODUCTION) ═══ */}
        <Route path="/agents" element={<AnimatedRoute><AgentMarketplace /></AnimatedRoute>} />
        <Route path="/agents/builder" element={<AnimatedRoute><AgentBuilder /></AnimatedRoute>} />

        {/* ═══ Tools (optional standalone pages, NOT main routes) ═══ */}
        <Route path="/tools" element={<AnimatedRoute><ToolsPage /></AnimatedRoute>} />
        <Route path="/tools/startup" element={<AnimatedRoute><StartupHub /></AnimatedRoute>} />
        <Route path="/tools/ecommerce" element={<AnimatedRoute><EcommerceOS /></AnimatedRoute>} />
        <Route path="/tools/website-analyzer" element={<AnimatedRoute><WebsiteAnalyzer /></AnimatedRoute>} />
        <Route path="/tools/website-builder" element={<AnimatedRoute><WebsiteBuilder /></AnimatedRoute>} />
        <Route path="/tools/app-builder" element={<AnimatedRoute><AppBuilder /></AnimatedRoute>} />
        <Route path="/tools/brand-builder" element={<AnimatedRoute><BrandBuilder /></AnimatedRoute>} />
        <Route path="/tools/viral-content" element={<AnimatedRoute><ViralContent /></AnimatedRoute>} />
        <Route path="/tools/knowledge-vault" element={<AnimatedRoute><KnowledgeVault /></AnimatedRoute>} />
        <Route path="/tools/automations" element={<AnimatedRoute><Automations /></AnimatedRoute>} />
        <Route path="/tools/swarm" element={<AnimatedRoute><MultiAgentSwarm /></AnimatedRoute>} />

        {/* ═══ Settings / Credits / Auth ═══ */}
        <Route path="/settings" element={<AnimatedRoute><SettingsPage /></AnimatedRoute>} />
        <Route path="/login" element={<AnimatedRoute><AuthPage /></AnimatedRoute>} />
        <Route path="/credits" element={<AnimatedRoute><CreditsPage /></AnimatedRoute>} />

        {/* ═══ Explore ═══ */}
        <Route path="/explore" element={<AnimatedRoute><ExplorePage /></AnimatedRoute>} />

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
