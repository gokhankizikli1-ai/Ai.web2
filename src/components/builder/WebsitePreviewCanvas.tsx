// WebsitePreviewCanvas — premium visual landing-page mockup rendered from the
// generated site content. Lives inside BrowserFrame on the Website Builder
// result view; the left-hand section list scrolls/highlights this canvas
// instead of only swapping a text panel.
import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  Check, Star, ArrowRight, Sparkles,
  BarChart3, Zap, Users, ShieldCheck,
} from 'lucide-react';
import type { SiteContent } from './siteContent';

const FEATURE_ICONS = [BarChart3, Zap, Users, ShieldCheck];

interface WebsitePreviewCanvasProps {
  content: SiteContent;
  activeSection: string;
  siteName: string;
}

export default function WebsitePreviewCanvas({ content, activeSection, siteName }: WebsitePreviewCanvasProps) {
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    const el = sectionRefs.current[activeSection];
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [activeSection]);

  const setRef = (id: string) => (el: HTMLDivElement | null) => { sectionRefs.current[id] = el; };
  const ring = (id: string) => (activeSection === id ? 'ring-1 ring-violet-500/40' : 'ring-1 ring-transparent');

  return (
    <div
      className="max-h-[70vh] overflow-y-auto text-white"
      style={{ background: 'radial-gradient(120% 100% at 50% 0%, #14121f 0%, #0a0a0e 55%, #08080b 100%)' }}
    >
      {/* Nav */}
      <div ref={setRef('nav')} className={`sticky top-0 z-10 flex items-center justify-between px-6 sm:px-10 py-4 backdrop-blur-xl bg-black/30 border-b border-white/[0.05] transition-all rounded-lg ${ring('nav')}`}>
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-gradient-to-br from-violet-500 to-cyan-400" />
          <span className="text-[13px] font-semibold tracking-tight">{siteName}</span>
        </div>
        <div className="hidden md:flex items-center gap-6">
          {content.nav.map((link) => (
            <span key={link} className="text-[12px] text-slate-400">{link}</span>
          ))}
        </div>
        <button className="text-[11px] font-medium px-3.5 py-1.5 rounded-full bg-white text-black">
          {content.hero.primaryCta}
        </button>
      </div>

      {/* Hero */}
      <div ref={setRef('hero')} className={`relative px-6 sm:px-10 py-16 sm:py-24 text-center overflow-hidden rounded-lg transition-all ${ring('hero')}`}>
        <div className="absolute inset-0 -z-10 opacity-40" style={{ background: 'radial-gradient(60% 60% at 50% 20%, rgba(139,92,246,0.35), transparent 70%)' }} />
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/[0.05] border border-white/[0.08] text-[11px] text-violet-300 mb-6">
          <Sparkles className="w-3 h-3" /> {content.hero.badge}
        </motion.div>
        <h1 className="text-3xl sm:text-5xl font-semibold tracking-tight max-w-2xl mx-auto leading-tight">
          {content.hero.headline}
        </h1>
        <p className="mt-5 text-[14px] sm:text-base text-slate-400 max-w-lg mx-auto leading-relaxed">
          {content.hero.subheadline}
        </p>
        <div className="mt-8 flex items-center justify-center gap-3 flex-wrap">
          <button className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-violet-500 to-cyan-400 text-black text-[13px] font-semibold flex items-center gap-1.5 shadow-lg shadow-violet-500/20">
            {content.hero.primaryCta} <ArrowRight className="w-3.5 h-3.5" />
          </button>
          <button className="px-5 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-[13px] font-medium text-slate-200">
            {content.hero.secondaryCta}
          </button>
        </div>
        <div className="mt-14 mx-auto max-w-3xl rounded-2xl border border-white/[0.06] bg-white/[0.02] backdrop-blur-xl p-2 shadow-2xl">
          <div className="rounded-xl bg-gradient-to-br from-white/[0.04] to-transparent h-40 sm:h-56 flex items-center justify-center border border-white/[0.04]">
            <BarChart3 className="w-10 h-10 text-slate-700" />
          </div>
        </div>
      </div>

      {/* Features */}
      <div ref={setRef('features')} className={`px-6 sm:px-10 py-16 rounded-lg transition-all ${ring('features')}`}>
        <h2 className="text-center text-xl sm:text-2xl font-semibold mb-10">Everything you need</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-3xl mx-auto">
          {content.features.map((f, i) => {
            const Icon = FEATURE_ICONS[i % FEATURE_ICONS.length];
            return (
              <div key={f.title} className="p-5 rounded-2xl border border-white/[0.06] bg-white/[0.02] backdrop-blur-xl hover:bg-white/[0.03] transition-colors">
                <div className="w-9 h-9 rounded-lg bg-violet-500/[0.12] border border-violet-500/20 flex items-center justify-center mb-3">
                  <Icon className="w-4 h-4 text-violet-300" />
                </div>
                <h3 className="text-[13px] font-medium text-white mb-1">{f.title}</h3>
                <p className="text-[12px] text-slate-400 leading-relaxed">{f.desc}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Pricing */}
      <div ref={setRef('pricing')} className={`px-6 sm:px-10 py-16 rounded-lg transition-all ${ring('pricing')}`}>
        <h2 className="text-center text-xl sm:text-2xl font-semibold mb-10">Simple, transparent pricing</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-3xl mx-auto items-stretch">
          {content.pricing.map((tier) => (
            <div
              key={tier.name}
              className={`p-5 rounded-2xl border backdrop-blur-xl flex flex-col ${
                tier.highlighted ? 'border-violet-500/40 bg-gradient-to-b from-violet-500/[0.08] to-transparent' : 'border-white/[0.06] bg-white/[0.02]'
              }`}
            >
              {tier.highlighted && (
                <span className="self-start mb-2 px-2 py-0.5 rounded-full bg-violet-500/20 text-violet-300 text-[9px] font-medium">Most popular</span>
              )}
              <h3 className="text-[13px] font-medium text-white">{tier.name}</h3>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="text-2xl font-semibold text-white">{tier.price}</span>
                {tier.period && <span className="text-[11px] text-slate-500">{tier.period}</span>}
              </div>
              <p className="mt-2 text-[11px] text-slate-400 leading-relaxed flex-1">{tier.desc}</p>
              <div className="mt-3 flex items-center gap-1.5 text-[10px] text-emerald-400">
                <Check className="w-3 h-3" /> Included features
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Testimonials */}
      <div ref={setRef('testimonials')} className={`px-6 sm:px-10 py-16 rounded-lg transition-all ${ring('testimonials')}`}>
        <h2 className="text-center text-xl sm:text-2xl font-semibold mb-10">Loved by teams everywhere</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-3xl mx-auto">
          {content.testimonials.map((t) => (
            <div key={t.name} className="p-5 rounded-2xl border border-white/[0.06] bg-white/[0.02] backdrop-blur-xl">
              <div className="flex gap-0.5 mb-3">
                {Array.from({ length: 5 }).map((_, i) => <Star key={i} className="w-3 h-3 fill-amber-400 text-amber-400" />)}
              </div>
              <p className="text-[12px] text-slate-300 leading-relaxed mb-3">&ldquo;{t.quote}&rdquo;</p>
              <p className="text-[11px] text-slate-500">{t.name} — {t.role}</p>
            </div>
          ))}
        </div>
      </div>

      {/* FAQ */}
      <div ref={setRef('faq')} className={`px-6 sm:px-10 py-16 rounded-lg transition-all ${ring('faq')}`}>
        <h2 className="text-center text-xl sm:text-2xl font-semibold mb-10">Frequently asked questions</h2>
        <div className="max-w-xl mx-auto space-y-2">
          {content.faq.map((qa) => (
            <div key={qa.q} className="p-4 rounded-xl border border-white/[0.06] bg-white/[0.02]">
              <p className="text-[12px] font-medium text-white mb-1">{qa.q}</p>
              <p className="text-[11px] text-slate-400 leading-relaxed">{qa.a}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Brand + typography */}
      <div ref={setRef('brand')} className={`px-6 sm:px-10 py-16 rounded-lg transition-all ${ring('brand')}`}>
        <h2 className="text-center text-xl sm:text-2xl font-semibold mb-10">Brand system</h2>
        <div className="flex items-center justify-center gap-3 flex-wrap max-w-3xl mx-auto">
          {content.brand.map((c) => (
            <div key={c.hex} className="text-center">
              <div className="w-16 h-16 rounded-2xl border border-white/[0.08] shadow-lg mb-2" style={{ background: c.hex }} />
              <p className="text-[10px] text-slate-500 font-mono">{c.hex}</p>
              <p className="text-[10px] text-slate-600">{c.label}</p>
            </div>
          ))}
        </div>
      </div>
      <div ref={setRef('typography')} className={`px-6 sm:px-10 py-10 rounded-lg transition-all ${ring('typography')}`}>
        <p className="text-center text-3xl font-semibold tracking-tight">Aa</p>
        <p className="text-center text-[11px] text-slate-500 mt-1">{content.typography}</p>
      </div>

      {/* Final CTA */}
      <div ref={setRef('cta')} className={`px-6 sm:px-10 py-16 pb-20 rounded-lg transition-all ${ring('cta')}`}>
        <div className="max-w-2xl mx-auto text-center rounded-2xl border border-white/[0.08] p-10 bg-gradient-to-b from-violet-500/[0.08] to-transparent backdrop-blur-xl">
          <h2 className="text-xl sm:text-2xl font-semibold mb-2">{content.cta.headline}</h2>
          <p className="text-[12px] text-slate-400 mb-6">{content.cta.subtext}</p>
          <button className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-violet-500 to-cyan-400 text-black text-[13px] font-semibold">
            {content.cta.button}
          </button>
        </div>
      </div>
    </div>
  );
}
