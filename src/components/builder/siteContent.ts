// siteContent — structured mock copy for the Website Builder preview.
//
// Same content the old plain-text panel showed, restructured into typed
// fields so it can drive both the visual canvas and the Structure/Copy tab
// without duplicating strings.
export interface SiteContent {
  nav: string[];
  hero: { badge: string; headline: string; subheadline: string; primaryCta: string; secondaryCta: string };
  features: Array<{ title: string; desc: string }>;
  pricing: Array<{ name: string; price: string; period: string; desc: string; highlighted: boolean }>;
  testimonials: Array<{ quote: string; name: string; role: string }>;
  faq: Array<{ q: string; a: string }>;
  brand: Array<{ hex: string; label: string }>;
  typography: string;
  cta: { headline: string; subtext: string; button: string };
}

export const SITE_CONTENT: SiteContent = {
  nav: ['Product', 'Features', 'Pricing', 'Customers'],
  hero: {
    badge: 'AI-Powered Platform',
    headline: 'Transform Your Workflow with AI',
    subheadline: 'The intelligent platform that automates tasks, analyzes data, and helps your team ship faster.',
    primaryCta: 'Start Free Trial',
    secondaryCta: 'Watch Demo',
  },
  features: [
    { title: 'AI-Powered Analytics', desc: 'Real-time insights from your data' },
    { title: 'Smart Automation', desc: 'Eliminate repetitive tasks' },
    { title: 'Team Collaboration', desc: 'Work together seamlessly' },
    { title: 'Enterprise Security', desc: 'SOC2 compliant, end-to-end encryption' },
  ],
  pricing: [
    { name: 'Starter', price: '$29', period: '/mo', desc: '1 user, basic analytics', highlighted: false },
    { name: 'Pro', price: '$79', period: '/mo', desc: '5 users, advanced features, priority support', highlighted: true },
    { name: 'Enterprise', price: 'Custom', period: '', desc: 'Unlimited, SSO, dedicated success manager', highlighted: false },
  ],
  testimonials: [
    { quote: 'Cut our reporting time by 80%', name: 'Sarah K.', role: 'CTO at TechFlow' },
    { quote: 'The AI insights are genuinely game-changing', name: 'Marcus L.', role: 'VP Product' },
    { quote: 'Best investment we made this year', name: 'Elena R.', role: 'Founder' },
  ],
  faq: [
    { q: 'How does the AI work?', a: 'Our AI analyzes your data patterns and generates insights using proprietary ML models.' },
    { q: 'Is my data secure?', a: 'Yes, we are SOC2 Type II certified with end-to-end encryption.' },
    { q: 'Can I cancel anytime?', a: 'Absolutely, no contracts or hidden fees.' },
  ],
  brand: [
    { hex: '#0A0A0A', label: 'Dark' },
    { hex: '#22D3EE', label: 'Accent' },
    { hex: '#6366F1', label: 'Secondary' },
    { hex: '#34D399', label: 'Success' },
  ],
  typography: 'Inter · Headlines 48–72px / 700 · Body 16px / 400 · Code: JetBrains Mono',
  cta: {
    headline: 'Ready to transform your workflow?',
    subtext: 'Join 10,000+ teams already using our platform',
    button: 'Get Started Free',
  },
};

// A short, url-safe "domain" derived from the user's prompt, for the fake
// browser address bar — purely cosmetic, no navigation happens.
export function siteNameFromPrompt(prompt: string): string {
  const words = prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => !['a', 'an', 'the', 'for', 'build', 'create', 'design', 'make', 'website', 'landing', 'page', 'site'].includes(w));
  const slug = words.slice(0, 2).join('') || 'yourbrand';
  return slug;
}
