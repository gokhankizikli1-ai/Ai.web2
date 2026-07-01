import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Layout, Wand2, Palette, Type,
  CheckCircle2, ChevronRight, Loader2,
  Star, DollarSign, HelpCircle, ArrowRight,
  Eye, FileText,
} from 'lucide-react';
import Navigation from '@/components/Navigation';
import BrowserFrame from '@/components/builder/BrowserFrame';
import WebsitePreviewCanvas from '@/components/builder/WebsitePreviewCanvas';
import DesignInterview from '@/components/builder/DesignInterview';
import { SITE_CONTENT, siteNameFromPrompt } from '@/components/builder/siteContent';
import { promptHasDesignDetail } from '@/lib/designBrief';

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

// Structure/Copy tab — same content the visual canvas renders, formatted as
// plain readable text per section.
function structureText(id: string): string {
  const c = SITE_CONTENT;
  switch (id) {
    case 'hero':
      return `Headline: "${c.hero.headline}"\nSubheadline: "${c.hero.subheadline}"\nCTA: "${c.hero.primaryCta}" | "${c.hero.secondaryCta}"`;
    case 'features':
      return c.features.map((f) => `• ${f.title} — ${f.desc}`).join('\n');
    case 'pricing':
      return c.pricing.map((p) => `${p.name}: ${p.price}${p.period} — ${p.desc}`).join('\n');
    case 'testimonials':
      return c.testimonials.map((t) => `"${t.quote}" — ${t.name}, ${t.role}`).join('\n');
    case 'faq':
      return c.faq.map((qa) => `Q: ${qa.q}\nA: ${qa.a}`).join('\n\n');
    case 'brand':
      return c.brand.map((b) => `${b.label}: ${b.hex}`).join('\n');
    case 'typography':
      return c.typography;
    case 'cta':
      return `"${c.cta.headline}"\nSubtext: "${c.cta.subtext}"\nButton: "${c.cta.button}"`;
    default:
      return '';
  }
}

const SECTION_TITLES: Record<string, string> = {
  hero: 'Hero Section', features: 'Key Features', pricing: 'Pricing Tiers',
  testimonials: 'Testimonials', faq: 'FAQ', brand: 'Brand Colors',
  typography: 'Typography', cta: 'Final CTA',
};

export default function WebsiteBuilder() {
  const [prompt, setPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [activeSection, setActiveSection] = useState('hero');
  const [view, setView] = useState<'preview' | 'structure'>('preview');
  const [lastPrompt, setLastPrompt] = useState('');
  const [briefPrompt, setBriefPrompt] = useState<string | null>(null);

  const startGeneration = (finalPrompt: string) => {
    setGenerating(true);
    setLastPrompt(finalPrompt);
    setTimeout(() => {
      setGenerating(false);
      setGenerated(true);
    }, 2000);
  };

  const handleGenerate = () => {
    if (!prompt.trim()) return;
    if (promptHasDesignDetail(prompt)) { startGeneration(prompt); return; }
    setBriefPrompt(prompt);
  };

  const siteName = `${siteNameFromPrompt(lastPrompt)}.ai`;

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-slate-300 flex flex-col">
      <Navigation />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">

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
          <motion.div {...fadeUp(0.05)} className="mb-4 max-w-4xl">
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
          <motion.div {...fadeUp(0.08)} className="flex gap-2 mb-8 flex-wrap max-w-4xl">
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

          {/* Design Interview — Korvix asks the design questions as chat
              messages inline in the page, never a floating modal. */}
          {briefPrompt && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mb-6 max-w-2xl">
              <DesignInterview
                prompt={briefPrompt}
                onBuild={(enhanced) => { setBriefPrompt(null); startGeneration(enhanced); }}
                onCancel={() => setBriefPrompt(null)}
              />
            </motion.div>
          )}

          {/* Generating state */}
          {generating && !briefPrompt && (
            <motion.div {...fadeUp(0)} className="rounded-2xl border border-white/[0.05] bg-white/[0.01] p-10 text-center">
              <Loader2 className="w-8 h-8 text-violet-400 animate-spin mx-auto mb-3" />
              <p className="text-[13px] text-slate-400">Generating your premium website preview…</p>
            </motion.div>
          )}

          {/* Generated Content */}
          {generated && !generating && !briefPrompt && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="grid grid-cols-1 lg:grid-cols-4 gap-4">
              {/* Section Selector */}
              <div className="lg:col-span-1 space-y-1">
                {SECTIONS.map((s) => (
                  <motion.button
                    key={s.id}
                    whileHover={{ x: 2 }}
                    onClick={() => { setActiveSection(s.id); setView('preview'); }}
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

              {/* Preview canvas */}
              <div className="lg:col-span-3 space-y-3">
                <div className="flex items-center justify-end">
                  <div className="flex items-center gap-0.5 rounded-lg bg-white/[0.02] border border-white/[0.04] p-0.5">
                    <button
                      onClick={() => setView('preview')}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium transition-colors ${
                        view === 'preview' ? 'bg-white/[0.06] text-white' : 'text-slate-500 hover:text-slate-300'
                      }`}
                    >
                      <Eye className="w-3 h-3" /> Preview
                    </button>
                    <button
                      onClick={() => setView('structure')}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium transition-colors ${
                        view === 'structure' ? 'bg-white/[0.06] text-white' : 'text-slate-500 hover:text-slate-300'
                      }`}
                    >
                      <FileText className="w-3 h-3" /> Structure / Copy
                    </button>
                  </div>
                </div>

                {view === 'preview' ? (
                  <BrowserFrame url={siteName} accent="violet">
                    <WebsitePreviewCanvas content={SITE_CONTENT} activeSection={activeSection} siteName={siteNameFromPrompt(lastPrompt) || 'Brand'} />
                  </BrowserFrame>
                ) : (
                  <motion.div
                    key={activeSection}
                    initial={{ opacity: 0, x: 8 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="p-6 rounded-2xl border border-white/[0.03] bg-white/[0.01]"
                  >
                    <h3 className="text-sm font-medium text-white mb-4">{SECTION_TITLES[activeSection]}</h3>
                    <div className="whitespace-pre-line text-[13px] text-slate-400 leading-relaxed">
                      {structureText(activeSection)}
                    </div>
                  </motion.div>
                )}
              </div>
            </motion.div>
          )}

          {!generated && !generating && !briefPrompt && (
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
