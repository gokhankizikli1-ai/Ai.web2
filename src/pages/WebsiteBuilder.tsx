import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Layout, Wand2, Palette, Type,
  CheckCircle2, ChevronRight, Loader2,
  Star, DollarSign, HelpCircle, ArrowRight,
} from 'lucide-react';
import Navigation from '@/components/Navigation';

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { delay, duration: 0.45, ease: 'easeOut' as const },
});

const EXAMPLE_PROMPTS = [
  'Build a luxury watch landing page',
  'Create a Shopify homepage for fitness products',
  'Design a SaaS landing page for AI analytics',
  'Make a portfolio site for a creative agency',
];

const SECTIONS = [
  { id: 'hero', label: 'Hero Section', icon: Layout },
  { id: 'features', label: 'Features', icon: CheckCircle2 },
  { id: 'pricing', label: 'Pricing', icon: DollarSign },
  { id: 'testimonials', label: 'Testimonials', icon: Star },
  { id: 'faq', label: 'FAQ', icon: HelpCircle },
  { id: 'brand', label: 'Brand Colors', icon: Palette },
  { id: 'typography', label: 'Typography', icon: Type },
  { id: 'cta', label: 'Final CTA', icon: ArrowRight },
];

const MOCK_OUTPUT: Record<string, { title: string; content: string }> = {
  hero: { title: 'Hero Section', content: 'Headline: "Transform Your Workflow with AI"\\nSubheadline: "The intelligent platform that automates tasks, analyzes data, and helps your team ship faster."\\nCTA: "Start Free Trial" | "Watch Demo"' },
  features: { title: 'Key Features', content: '• AI-Powered Analytics — Real-time insights from your data\\n• Smart Automation — Eliminate repetitive tasks\\n• Team Collaboration — Work together seamlessly\\n• Enterprise Security — SOC2 compliant, end-to-end encryption' },
  pricing: { title: 'Pricing Tiers', content: 'Starter: $29/mo — 1 user, basic analytics\\nPro: $79/mo — 5 users, advanced features, priority support\\nEnterprise: Custom — Unlimited, SSO, dedicated success manager' },
  testimonials: { title: 'Testimonials', content: '"Cut our reporting time by 80%" — Sarah K., CTO at TechFlow\\n"The AI insights are genuinely game-changing" — Marcus L., VP Product\\n"Best investment we made this year" — Elena R., Founder' },
  faq: { title: 'FAQ', content: 'Q: How does the AI work?\\nA: Our AI analyzes your data patterns and generates insights using proprietary ML models.\\n\\nQ: Is my data secure?\\nA: Yes, we are SOC2 Type II certified with end-to-end encryption.\\n\\nQ: Can I cancel anytime?\\nA: Absolutely, no contracts or hidden fees.' },
  brand: { title: 'Brand Colors', content: 'Primary: #0A0A0A (dark)\\nAccent: #22D3EE (cyan)\\nSecondary: #6366F1 (indigo)\\nSuccess: #34D399 (emerald)\\nText: #FFFFFF / #A1A1AA' },
  typography: { title: 'Typography', content: 'Headlines: Inter, 48-72px, weight 700\\nBody: Inter, 16px, weight 400, line-height 1.6\\nCaptions: Inter, 14px, weight 500\\nCode: JetBrains Mono, 14px' },
  cta: { title: 'Final CTA', content: '"Ready to transform your workflow?"\\nSubtext: "Join 10,000+ teams already using our platform"\\nButton: "Get Started Free" — 14-day trial, no credit card' },
};

export default function WebsiteBuilder() {
  const [prompt, setPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [activeSection, setActiveSection] = useState('hero');

  const handleGenerate = () => {
    if (!prompt.trim()) return;
    setGenerating(true);
    setTimeout(() => {
      setGenerating(false);
      setGenerated(true);
    }, 2000);
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-slate-300 flex flex-col">
      <Navigation />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">

          <motion.div {...fadeUp(0)} className="mb-8">
            <div className="flex items-center gap-3 mb-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/[0.1] border border-violet-500/15">
                <Layout className="h-4 w-4 text-violet-400" />
              </div>
              <h1 className="text-2xl font-semibold text-white tracking-tight">Website Builder</h1>
            </div>
            <p className="text-[13px] text-slate-500 ml-11">Describe the website you want, and AI generates the structure</p>
          </motion.div>

          {/* Prompt Input */}
          <motion.div {...fadeUp(0.05)} className="mb-4">
            <div className="flex gap-2">
              <input
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Describe the website you want to build..."
                className="flex-1 h-12 px-4 rounded-xl bg-white/[0.02] border border-white/[0.04] text-[14px] text-slate-300 placeholder:text-slate-600 focus:outline-none focus:border-violet-500/20 focus:bg-white/[0.03] transition-all"
                onKeyDown={(e) => e.key === 'Enter' && handleGenerate()}
              />
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleGenerate}
                disabled={generating || !prompt.trim()}
                className="h-12 px-6 rounded-xl bg-violet-500/[0.1] border border-violet-500/15 text-violet-400 font-medium text-[13px] hover:bg-violet-500/[0.15] transition-colors disabled:opacity-40 flex items-center gap-2"
              >
                {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                Generate
              </motion.button>
            </div>
          </motion.div>

          {/* Quick Prompts */}
          <motion.div {...fadeUp(0.08)} className="flex gap-2 mb-8 flex-wrap">
            {EXAMPLE_PROMPTS.map((p) => (
              <button
                key={p}
                onClick={() => { setPrompt(p); }}
                className="px-3 py-1.5 rounded-lg bg-white/[0.02] border border-white/[0.03] text-[11px] text-slate-500 hover:text-slate-300 hover:border-white/[0.06] transition-all"
              >
                {p}
              </button>
            ))}
          </motion.div>

          {/* Generated Content */}
          {generated && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Section Selector */}
              <div className="lg:col-span-1 space-y-1">
                {SECTIONS.map((s) => (
                  <motion.button
                    key={s.id}
                    whileHover={{ x: 2 }}
                    onClick={() => setActiveSection(s.id)}
                    className={`flex items-center gap-2.5 w-full px-3 py-2.5 rounded-xl text-left transition-all ${
                      activeSection === s.id ? 'bg-white/[0.04] border border-white/[0.06]' : 'hover:bg-white/[0.02] border border-transparent'
                    }`}
                  >
                    <s.icon className={`w-4 h-4 ${activeSection === s.id ? 'text-violet-400' : 'text-slate-600'}`} />
                    <span className={`text-[12px] ${activeSection === s.id ? 'text-white font-medium' : 'text-slate-500'}`}>{s.label}</span>
                    <ChevronRight className={`w-3 h-3 ml-auto ${activeSection === s.id ? 'text-violet-400' : 'text-[#64748B]'}`} />
                  </motion.button>
                ))}
              </div>

              {/* Section Preview */}
              <motion.div
                key={activeSection}
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                className="lg:col-span-2 p-6 rounded-2xl border border-white/[0.03] bg-white/[0.01]"
              >
                <h3 className="text-sm font-medium text-white mb-4">
                  {MOCK_OUTPUT[activeSection]?.title}
                </h3>
                <div className="whitespace-pre-line text-[13px] text-slate-400 leading-relaxed">
                  {MOCK_OUTPUT[activeSection]?.content}
                </div>
              </motion.div>
            </motion.div>
          )}

          {!generated && !generating && (
            <motion.div {...fadeUp(0.1)} className="text-center py-16">
              <Layout className="w-12 h-12 text-[#64748B] mx-auto mb-4" />
              <h3 className="text-sm font-medium text-white mb-1">Describe your website</h3>
              <p className="text-[12px] text-slate-500">AI will generate hero, features, pricing, testimonials, FAQ, and brand guidelines</p>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
}
