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
    <div className="min-h-screen bg-[#0a0a0f] text-foreground overflow-x-hidden">
      <Navbar />
      <main>
        {/* Hero — existing */}
        <HeroSection />

        {/* Why KorvixAI — NEW */}
        <WhyKorvixSection />

        {/* Feature Showcase — NEW */}
        <FeatureShowcaseSection />

        {/* Startup OS — NEW */}
        <StartupOSSection />

        {/* Ecommerce OS — NEW */}
        <EcommerceOSSection />

        {/* Agent Hub — NEW */}
        <AgentHubSection />

        {/* Trading Intelligence — NEW */}
        <TradingIntelligenceSection />

        {/* How It Works — NEW */}
        <HowItWorksSection />

        {/* Premium CTA — NEW */}
        <FinalCTASection />
      </main>
      <Footer />
    </div>
  );
}
