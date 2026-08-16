import MarketingPage from '@/components/marketing/MarketingPage';
import HeroSection from '@/components/marketing/landing/HeroSection';
import ContextSection from '@/components/marketing/landing/ContextSection';
import ConnectedSection from '@/components/marketing/landing/ConnectedSection';
import BuildSection from '@/components/marketing/landing/BuildSection';
import ResearchSection from '@/components/marketing/landing/ResearchSection';
import SolutionsSection from '@/components/marketing/landing/SolutionsSection';
import WorkflowSection from '@/components/marketing/landing/WorkflowSection';
import PricingTeaserSection from '@/components/marketing/landing/PricingTeaserSection';
import FaqSection from '@/components/marketing/landing/FaqSection';
import FinalCtaSection from '@/components/marketing/landing/FinalCtaSection';

/**
 * KorvixAI public landing.
 *
 * The page is now a PRODUCT STORY rather than a Web-Build pitch: it answers
 * "what is Korvix / what can I do / why is it different / where do I start"
 * before it sells any single capability.
 *
 * Section order and the reasoning behind it:
 *   1. Hero              — the proposition + a composed product panel where a
 *                          project's context comes together   (motion moment 1)
 *   2. Shared context    — why one project beats a folder of disconnected tools
 *   3. Connected         — the five real read-only connectors  (motion moment 2)
 *   4. Build             — Web Build + App Build, then the existing three-step
 *                          walkthrough                          (motion moment 3)
 *   5. Research          — research inside chat, carried into the project
 *   6. Who it's for      — four audiences, editorial, no card spam
 *   7. Workflow          — the end-to-end story in five plain steps
 *   8. Pricing teaser    — summarizes the one pricing authority, links to it
 *   9. FAQ               — the honest questions, answered from real behaviour
 *  10. Final CTA         — quiet close
 *
 * Surface rhythm alternates porcelain → deep navy so the dark Korvix product UI
 * reads as a contrast device inside a bright shell (roughly 70/30 light/deep),
 * and no two adjacent sections share a composition.
 */
export default function LandingPage() {
  return (
    <MarketingPage announcement>
      <HeroSection />
      <ContextSection />
      <ConnectedSection />
      <BuildSection />
      <ResearchSection />
      <SolutionsSection />
      <WorkflowSection />
      <PricingTeaserSection />
      <FaqSection />
      <FinalCtaSection />
    </MarketingPage>
  );
}
