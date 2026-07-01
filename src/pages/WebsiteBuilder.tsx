import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Layout, Gauge, LayoutDashboard, CheckCircle2, ChevronRight,
  Star, DollarSign, HelpCircle, ArrowRight, Palette, Type,
  Eye, FileText, Sparkles,
} from 'lucide-react';
import BrowserFrame from '@/components/builder/BrowserFrame';
import BuilderWorkspaceFrame from '@/components/builder/BuilderWorkspaceFrame';
import BuilderPromptCard from '@/components/builder/BuilderPromptCard';
import BuilderProgressCard from '@/components/builder/BuilderProgressCard';
import BuilderRefinePanel, { type RefinePatch } from '@/components/builder/BuilderRefinePanel';
import WebsitePreviewCanvas from '@/components/builder/WebsitePreviewCanvas';
import DesignInterview from '@/components/builder/DesignInterview';
import { generateSiteContent, type SiteContent } from '@/components/builder/siteContent';
import { CATEGORY_LABELS, paletteForDirection } from '@/components/builder/promptCategory';
import {
  promptHasDesignDetail, resolveBriefAnswers, smartDefaultsFromPrompt, type DesignBriefAnswers,
} from '@/lib/designBrief';

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { delay, duration: 0.45, ease: 'easeOut' as const },
});

const EXAMPLE_PROMPTS = [
  'Build a luxury watch landing page',
  'Build a premium Shopify analytics dashboard for a fashion store',
  'Design a SaaS landing page for AI analytics',
  'Make a portfolio site for a creative agency',
];

const SECTIONS = [
  { id: 'hero', label: 'Hero', icon: Layout },
  { id: 'metrics', label: 'Trust Metrics', icon: Gauge },
  { id: 'showcase', label: 'Showcase', icon: LayoutDashboard },
  { id: 'features', label: 'Features', icon: CheckCircle2 },
  { id: 'pricing', label: 'Pricing', icon: DollarSign },
  { id: 'testimonials', label: 'Testimonials', icon: Star },
  { id: 'faq', label: 'FAQ', icon: HelpCircle },
  { id: 'brand', label: 'Brand Colors', icon: Palette },
  { id: 'typography', label: 'Typography', icon: Type },
  { id: 'cta', label: 'Final CTA', icon: ArrowRight },
] as const;

const SECTION_TITLES: Record<string, string> = {
  hero: 'Hero Section', metrics: 'Trust Metrics', showcase: 'Product Showcase',
  features: 'Key Features', pricing: 'Pricing Tiers', testimonials: 'Testimonials',
  faq: 'FAQ', brand: 'Brand Colors', typography: 'Typography', cta: 'Final CTA',
};

// Structure/Copy tab — the same content the visual canvas renders,
// formatted as plain readable text per section.
function structureText(id: string, c: SiteContent): string {
  switch (id) {
    case 'hero':
      return `Eyebrow: "${c.hero.eyebrow}"\nHeadline: "${c.hero.headline}"\nSubheadline: "${c.hero.subheadline}"\nCTA: "${c.hero.primaryCta}" | "${c.hero.secondaryCta}"`;
    case 'metrics':
      return c.metrics.map((m) => `• ${m.label}: ${m.value}`).join('\n');
    case 'showcase':
      return `"${c.showcase.title}"\n${c.showcase.description}\n\n${c.showcase.points.map((p) => `• ${p}`).join('\n')}`;
    case 'features':
      return c.features.map((f) => `• ${f.title} — ${f.desc}`).join('\n');
    case 'pricing':
      return c.pricing.length
        ? c.pricing.map((p) => `${p.name}: ${p.price}${p.period} — ${p.desc}`).join('\n')
        : 'Not applicable for this product category.';
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

export default function WebsiteBuilder() {
  const [prompt, setPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [activeSection, setActiveSection] = useState('hero');
  const [view, setView] = useState<'preview' | 'structure'>('preview');
  const [lastPrompt, setLastPrompt] = useState('');
  const [brandPrompt, setBrandPrompt] = useState('');
  const [brief, setBrief] = useState<DesignBriefAnswers>(() => smartDefaultsFromPrompt(''));
  const [briefPrompt, setBriefPrompt] = useState<string | null>(null);
  const [brandOverride, setBrandOverride] = useState<string | null>(null);
  const [ctaOverride, setCtaOverride] = useState<string | null>(null);

  const startGeneration = (finalPrompt: string, answers: DesignBriefAnswers) => {
    setGenerating(true);
    setLastPrompt(finalPrompt);
    setBrandPrompt(finalPrompt);
    setBrief(answers);
    setBrandOverride(null);
    setCtaOverride(null);
    setActiveSection('hero');
    setView('preview');
    setTimeout(() => {
      setGenerating(false);
      setGenerated(true);
    }, 1400);
  };

  const handleGenerate = () => {
    if (!prompt.trim()) return;
    if (promptHasDesignDetail(prompt)) {
      startGeneration(prompt, resolveBriefAnswers(prompt));
      return;
    }
    setBriefPrompt(prompt);
  };

  // Post-generation refine — folds a structured settings patch and/or a
  // free-text edit instruction back into the same deterministic build
  // flow used for the initial generation. The instruction is appended to
  // the working prompt, so category-shifting asks ("make it more
  // ecommerce-focused") genuinely re-route the generated content — it's
  // not faked, it just can't rewrite prose no keyword maps to.
  const handleRefine = (patch: RefinePatch) => {
    if (patch.brandName) setBrandOverride(patch.brandName);
    if (patch.ctaText) setCtaOverride(patch.ctaText);
    if (patch.colorDirection || patch.density || patch.layoutType) {
      setBrief((prev) => ({
        ...prev,
        colorDirection: patch.colorDirection || prev.colorDirection,
        density: patch.density || prev.density,
        layoutType: patch.layoutType || prev.layoutType,
      }));
    }
    if (patch.instruction) {
      setLastPrompt((prev) => `${prev} ${patch.instruction}`.trim());
    }
  };

  const content = useMemo(() => {
    const c = generateSiteContent(lastPrompt, brief, brandOverride, brandPrompt);
    if (!ctaOverride) return c;
    return { ...c, hero: { ...c.hero, primaryCta: ctaOverride }, cta: { ...c.cta, button: ctaOverride } };
  }, [lastPrompt, brandPrompt, brief, brandOverride, ctaOverride]);
  const palette = useMemo(() => paletteForDirection(brief.colorDirection), [brief.colorDirection]);
  const siteUrl = `${(content.brandName || 'yourbrand').replace(/\s+/g, '').toLowerCase()}.ai`;
  const visibleSections = SECTIONS.filter((s) => s.id !== 'pricing' || content.pricing.length > 0);

  return (
    <BuilderWorkspaceFrame
      icon={<Layout className="h-4 w-4" style={{ color: '#a78bfa' }} />}
      title="Website Builder"
      subtitle="Describe the website you want — Korvix locks a design direction, then generates a premium, category-aware preview"
      accent="#a78bfa"
      maxWidth="max-w-6xl"
    >
      {/* Prompt input */}
      <motion.div {...fadeUp(0.05)} className="mb-6 max-w-4xl">
        <BuilderPromptCard
          value={prompt}
          onChange={setPrompt}
          onSubmit={handleGenerate}
          placeholder="Describe the website you want to build…"
          ctaLabel="Generate"
          busyLabel="Generating…"
          busy={generating}
          accent="#a78bfa"
          accent2="#22d3ee"
          examples={EXAMPLE_PROMPTS}
          onExampleSelect={setPrompt}
        />
      </motion.div>

      {/* Design Interview — Korvix asks the design questions as chat
          messages inline in the page, never a floating modal. */}
      <AnimatePresence mode="wait">
        {briefPrompt && (
          <motion.div
            key="interview"
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className="mb-6 max-w-2xl mx-auto rounded-2xl border border-white/[0.05] bg-white/[0.012] p-4 sm:p-5"
          >
            <DesignInterview
              prompt={briefPrompt}
              onBuild={(enhanced) => { setBriefPrompt(null); startGeneration(enhanced, resolveBriefAnswers(enhanced)); }}
              onCancel={() => setBriefPrompt(null)}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Generating state */}
      {generating && !briefPrompt && (
        <motion.div {...fadeUp(0)} className="max-w-2xl mx-auto">
          <BuilderProgressCard label="Generating your premium website preview" accent={palette.accent} accent2={palette.accent2} />
        </motion.div>
      )}

      {/* Generated content */}
      {generated && !generating && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
          <BuilderRefinePanel
            accent={palette.accent}
            accent2={palette.accent2}
            palette={palette}
            categoryLabel={CATEGORY_LABELS[content.category]}
            brief={brief}
            brandName={content.brandName}
            brandLabel="Brand name"
            ctaText={content.hero.primaryCta}
            onApply={handleRefine}
          />

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

          <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
            {/* Section selector */}
            <div className="lg:col-span-1 space-y-1">
              {visibleSections.map((s) => (
                <motion.button
                  key={s.id}
                  whileHover={{ x: 2 }}
                  onClick={() => { setActiveSection(s.id); setView('preview'); }}
                  className={`flex items-center gap-2.5 w-full px-3 py-2.5 rounded-xl text-left transition-all ${
                    activeSection === s.id ? 'bg-white/[0.04] border border-white/[0.06]' : 'hover:bg-white/[0.02] border border-transparent'
                  }`}
                >
                  <s.icon className="w-4 h-4" style={{ color: activeSection === s.id ? palette.accent : '#475569' }} />
                  <span className={`text-[12px] ${activeSection === s.id ? 'text-white font-medium' : 'text-slate-500'}`}>{s.label}</span>
                  <ChevronRight className="w-3 h-3 ml-auto" style={{ color: activeSection === s.id ? palette.accent : '#64748B' }} />
                </motion.button>
              ))}
            </div>

            {/* Preview canvas */}
            <div className="lg:col-span-3">
              {view === 'preview' ? (
                <BrowserFrame url={siteUrl} accentColor={palette.accent}>
                  <WebsitePreviewCanvas content={content} activeSection={activeSection} palette={palette} />
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
                    {structureText(activeSection, content)}
                  </div>
                </motion.div>
              )}
            </div>
          </div>
        </motion.div>
      )}

      {!generated && !generating && !briefPrompt && (
        <motion.div {...fadeUp(0.1)} className="max-w-lg mx-auto text-center py-14">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/[0.06] bg-white/[0.02]">
            <Sparkles className="w-6 h-6 text-violet-300/70" />
          </div>
          <h3 className="text-[15px] font-medium text-white mb-2">Describe your website</h3>
          <p className="text-[12px] text-slate-500 leading-relaxed mb-6">
            Korvix locks a design direction, then generates a premium hero, trust metrics, a category-specific
            showcase, features, pricing, testimonials, FAQ and brand system — tailored to your idea.
          </p>
          <div className="flex items-center justify-center gap-2 flex-wrap">
            {['Ecommerce', 'Analytics', 'SaaS', 'AI Product', 'Portfolio', 'Agency'].map((c) => (
              <span key={c} className="px-2.5 py-1 rounded-full bg-white/[0.02] border border-white/[0.05] text-[10px] text-slate-500">{c}</span>
            ))}
          </div>
        </motion.div>
      )}
    </BuilderWorkspaceFrame>
  );
}
