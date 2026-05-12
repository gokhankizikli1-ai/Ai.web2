import { Routes, Route, useLocation } from 'react-router';
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
import AgentMarketplace from './pages/AgentMarketplace';
import AgentBuilder from './pages/AgentBuilder';
import ToolsPage from './pages/ToolsPage';
import ExplorePage from './pages/ExplorePage';
import WorkspacePage from './pages/WorkspacePage';
import WebsiteAnalyzer from './pages/WebsiteAnalyzer';
import WebsiteBuilder from './pages/WebsiteBuilder';
import AppBuilder from './pages/AppBuilder';
import BrandBuilder from './pages/BrandBuilder';
import ViralContent from './pages/ViralContent';
import KnowledgeVault from './pages/KnowledgeVault';
import Automations from './pages/Automations';
import MultiAgentSwarm from './pages/MultiAgentSwarm';
import BottomNav from './components/BottomNav';
import FloatingOrb from './components/FloatingOrb';

function AppLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const isLanding = location.pathname === '/';
  const showBottomNav = !isLanding;
  const showOrb = !isLanding;

  return (
    <div className={`min-h-screen bg-[#0a0a0a] ${showBottomNav ? 'pb-16 sm:pb-0' : ''}`}>
      {children}
      {showBottomNav && <BottomNav />}
      {showOrb && <FloatingOrb />}
    </div>
  );
}

export default function App() {
  return (
    <AppLayout>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/features" element={<FeaturesPage />} />
        <Route path="/use-cases" element={<UseCasesPage />} />
        <Route path="/pricing" element={<PricingPage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/chat" element={<ChatDashboard />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/home" element={<HomeDashboard />} />
        <Route path="/workspace" element={<WorkspacePage />} />
        <Route path="/startup" element={<StartupHub />} />
        <Route path="/ecommerce" element={<EcommerceOS />} />
        <Route path="/agents" element={<AgentMarketplace />} />
        <Route path="/agents/builder" element={<AgentBuilder />} />
        <Route path="/tools" element={<ToolsPage />} />
        <Route path="/tools/website-analyzer" element={<WebsiteAnalyzer />} />
        <Route path="/tools/website-builder" element={<WebsiteBuilder />} />
        <Route path="/tools/app-builder" element={<AppBuilder />} />
        <Route path="/tools/brand-builder" element={<BrandBuilder />} />
        <Route path="/tools/viral-content" element={<ViralContent />} />
        <Route path="/tools/knowledge-vault" element={<KnowledgeVault />} />
        <Route path="/tools/automations" element={<Automations />} />
        <Route path="/tools/swarm" element={<MultiAgentSwarm />} />
        <Route path="/explore" element={<ExplorePage />} />
      </Routes>
    </AppLayout>
  );
}
