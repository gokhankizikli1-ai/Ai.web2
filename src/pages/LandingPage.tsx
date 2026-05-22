import Navbar from '@/sections/Navbar';
import HeroSection from '@/sections/HeroSection';
import WhyKorvixSection from '@/sections/WhyKorvixSection';
import FeatureShowcaseSection from '@/sections/FeatureShowcaseSection';
import StartupOSSection from '@/sections/StartupOSSection';
import EcommerceOSSection from '@/sections/EcommerceOSSection';
import AgentHubSection from '@/sections/AgentHubSection';
import TradingIntelligenceSection from '@/sections/TradingIntelligenceSection';
import HowItWorksSection from '@/sections/HowItWorksSection';
import FinalCTASection from '@/sections/FinalCTASection';
import Footer from '@/sections/Footer';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-gradient-premium text-foreground overflow-x-hidden">
      <Navbar />
      <main>
        <HeroSection />
        <WhyKorvixSection />
        <FeatureShowcaseSection />
        <StartupOSSection />
        <EcommerceOSSection />
        <AgentHubSection />
        <TradingIntelligenceSection />
        <HowItWorksSection />
        <FinalCTASection />
      </main>
      <Footer />
    </div>
  );
}
