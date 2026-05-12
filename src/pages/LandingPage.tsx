import Navbar from '@/sections/Navbar';
import HeroSection from '@/sections/HeroSection';
import WhyKorvixStrip from '@/sections/WhyKorvixStrip';
import LiveActivityBar from '@/sections/LiveActivityBar';
import AiMockupSection from '@/sections/AiMockupSection';
import FeaturesSection from '@/sections/FeaturesSection';
import UseCasesSection from '@/sections/UseCasesSection';
import PricingSection from '@/sections/PricingSection';
import TestimonialsSection from '@/sections/TestimonialsSection';
import CTASection from '@/sections/CTASection';
import Footer from '@/sections/Footer';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#0a0a0f] text-foreground">
      <Navbar />
      <main>
        <HeroSection />
        <WhyKorvixStrip />
        <LiveActivityBar />
        <AiMockupSection />
        <FeaturesSection />
        <UseCasesSection />
        <PricingSection />
        <TestimonialsSection />
        <CTASection />
      </main>
      <Footer />
    </div>
  );
}
