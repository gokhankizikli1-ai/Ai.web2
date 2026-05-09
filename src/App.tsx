import { Routes, Route } from 'react-router';
import LandingPage from './pages/LandingPage';
import FeaturesPage from './pages/FeaturesPage';
import UseCasesPage from './pages/UseCasesPage';
import PricingPage from './pages/PricingPage';
import AboutPage from './pages/AboutPage';
import ChatDashboard from './pages/ChatDashboard';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/features" element={<FeaturesPage />} />
      <Route path="/use-cases" element={<UseCasesPage />} />
      <Route path="/pricing" element={<PricingPage />} />
      <Route path="/about" element={<AboutPage />} />
      <Route path="/chat" element={<ChatDashboard />} />
    </Routes>
  );
}
