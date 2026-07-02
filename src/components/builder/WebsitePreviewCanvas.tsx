// WebsitePreviewCanvas — premium visual landing-page mockup rendered from
// the generated site content. Lives inside BrowserFrame on the Website
// Builder result view. Every color that used to be a hardcoded
// violet/cyan Tailwind class now follows the resolved Design Brief palette,
// and product visuals are CSS/SVG mockups selected per category — never a
// broken <img> placeholder.
import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  Check, Star, ArrowRight, Sparkles,
  BarChart3, Zap, Users, ShieldCheck, ShoppingCart, Tag, CreditCard,
  Package, Layers, Gauge, Activity, GraduationCap, Rocket, Crown,
  Building2, Wrench, Globe, MessageCircle,
} from 'lucide-react';
import type { SiteContent, MockupKind, FeatureIcon } from './siteContent';
import type { BuilderPalette } from './promptCategory';

const FEATURE_ICONS: Record<FeatureIcon, React.ComponentType<{ className?: string; style?: React.CSSProperties }>> = {
  chart: BarChart3, bolt: Zap, users: Users, shield: ShieldCheck, cart: ShoppingCart,
  tag: Tag, card: CreditCard, package: Package, layers: Layers, gauge: Gauge,
  pie: BarChart3, activity: Activity, graduation: GraduationCap, rocket: Rocket,
  crown: Crown, building: Building2, wrench: Wrench, globe: Globe,
  chat: MessageCircle, sparkles: Sparkles,
};

interface WebsitePreviewCanvasProps {
  content: SiteContent;
  activeSection: string;
  palette: BuilderPalette;
}

export default function WebsitePreviewCanvas({ content, activeSection, palette }: WebsitePreviewCanvasProps) {
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    const el = sectionRefs.current[activeSection];
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [activeSection]);

  const setRef = (id: string) => (el: HTMLDivElement | null) => { sectionRefs.current[id] = el; };
  const ringStyle = (id: string): React.CSSProperties =>
    activeSection === id ? { boxShadow: `inset 0 0 0 1px ${palette.ring}` } : { boxShadow: 'inset 0 0 0 1px transparent' };

  const grad = `linear-gradient(135deg, ${palette.accent}, ${palette.accent2})`;
  const gradSoft = `linear-gradient(135deg, ${palette.accent}22, ${palette.accent2}18)`;

  return (
    <div
      className="max-h-[70vh] overflow-y-auto text-white"
      style={{ background: `radial-gradient(120% 100% at 50% 0%, ${palette.glow} 0%, #0a0a0e 55%, #08080b 100%)` }}
    >
      {/* Nav */}
      <div ref={setRef('nav')} className="sticky top-0 z-10 flex items-center justify-between px-6 sm:px-10 py-4 backdrop-blur-xl bg-black/30 border-b border-white/[0.05] transition-all rounded-lg" style={ringStyle('nav')}>
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md" style={{ background: grad }} />
          <span className="text-[13px] font-semibold tracking-tight">{content.brandName}</span>
        </div>
        <div className="hidden md:flex items-center gap-6">
          {content.nav.map((link) => (
            <span key={link} className="text-[12px] text-[#CBD5E1]">{link}</span>
          ))}
        </div>
        <button className="text-[11px] font-medium px-3.5 py-1.5 rounded-full bg-white text-black">
          {content.hero.primaryCta}
        </button>
      </div>

      {/* Hero */}
      <div ref={setRef('hero')} className="relative px-6 sm:px-10 py-16 sm:py-24 text-center overflow-hidden rounded-lg transition-all" style={ringStyle('hero')}>
        <div className="absolute inset-0 -z-10 opacity-50" style={{ background: `radial-gradient(60% 60% at 50% 20%, ${palette.glow}, transparent 70%)` }} />
        <motion.div
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-[11px] mb-6"
          style={{ background: gradSoft, borderColor: palette.ring, color: palette.accent }}
        >
          <Sparkles className="w-3 h-3" /> {content.hero.eyebrow}
        </motion.div>
        <h1 className="text-3xl sm:text-5xl font-semibold tracking-tight max-w-2xl mx-auto leading-tight">
          {content.hero.headline}
        </h1>
        <p className="mt-5 text-[14px] sm:text-base text-[#CBD5E1] max-w-lg mx-auto leading-relaxed">
          {content.hero.subheadline}
        </p>
        <div className="mt-8 flex items-center justify-center gap-3 flex-wrap">
          <button
            className="px-5 py-2.5 rounded-xl text-[13px] font-semibold flex items-center gap-1.5 shadow-lg"
            style={{ background: grad, color: palette.onAccent, boxShadow: `0 12px 30px -14px ${palette.accent}88` }}
          >
            {content.hero.primaryCta} <ArrowRight className="w-3.5 h-3.5" />
          </button>
          <button className="px-5 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-[13px] font-medium text-slate-200">
            {content.hero.secondaryCta}
          </button>
        </div>
        <div className="mt-14 mx-auto max-w-3xl">
          <ProductMockup kind={content.hero.mockup} palette={palette} size="lg" />
        </div>
      </div>

      {/* Trust metrics */}
      <div ref={setRef('metrics')} className="px-6 sm:px-10 py-10 rounded-lg transition-all" style={ringStyle('metrics')}>
        <div className="max-w-3xl mx-auto grid grid-cols-3 gap-4 rounded-2xl border border-white/[0.06] bg-white/[0.015] py-6">
          {content.metrics.map((m) => (
            <div key={m.label} className="text-center px-2">
              <p className="text-xl sm:text-2xl font-semibold tracking-tight" style={{ color: palette.accent }}>{m.value}</p>
              <p className="text-[11px] text-[#94A3B8] mt-1">{m.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Showcase — the category-specific product/analytics view */}
      <div
        ref={setRef('showcase')}
        className="px-6 sm:px-10 py-16 sm:py-20 rounded-lg transition-all"
        style={{ ...ringStyle('showcase'), background: `radial-gradient(80% 60% at 50% 0%, ${palette.glow}, transparent 70%)` }}
      >
        <p className="text-center text-[10px] font-semibold tracking-[0.2em] mb-3" style={{ color: palette.accent }}>{content.showcase.eyebrow}</p>
        <h2 className="text-center text-xl sm:text-2xl font-semibold mb-4 max-w-xl mx-auto">{content.showcase.title}</h2>
        <p className="text-center text-[13px] text-[#CBD5E1] max-w-lg mx-auto mb-10 leading-relaxed">{content.showcase.description}</p>
        <div className="max-w-3xl mx-auto">
          <ProductMockup kind={content.showcase.kind} palette={palette} size="md" />
        </div>
        <div className="max-w-3xl mx-auto mt-6 flex items-center justify-center gap-2 flex-wrap">
          {content.showcase.points.map((p) => (
            <span key={p} className="px-3 py-1.5 rounded-full bg-white/[0.03] border border-white/[0.06] text-[11px] text-slate-300">
              {p}
            </span>
          ))}
        </div>
      </div>

      {/* Features */}
      <div ref={setRef('features')} className="px-6 sm:px-10 py-16 sm:py-20 rounded-lg transition-all" style={ringStyle('features')}>
        <p className="text-center text-[10px] font-semibold tracking-[0.2em] mb-3" style={{ color: palette.accent }}>FEATURES</p>
        <h2 className="text-center text-xl sm:text-2xl font-semibold mb-10">Built for how {content.brandName} actually works</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-3xl mx-auto">
          {content.features.map((f) => {
            const Icon = FEATURE_ICONS[f.icon] || Sparkles;
            return (
              <div key={f.title} className="p-5 rounded-2xl border border-white/[0.06] bg-white/[0.02] backdrop-blur-xl hover:bg-white/[0.04] hover:border-white/[0.12] hover:-translate-y-0.5 transition-all">
                <div className="w-9 h-9 rounded-lg border flex items-center justify-center mb-3" style={{ background: gradSoft, borderColor: palette.ring }}>
                  <Icon className="w-4 h-4" style={{ color: palette.accent }} />
                </div>
                <h3 className="text-[13px] font-medium text-white mb-1">{f.title}</h3>
                <p className="text-[12px] text-[#CBD5E1] leading-relaxed">{f.desc}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Pricing — only when the category has one */}
      {content.pricing.length > 0 && (
        <div ref={setRef('pricing')} className="px-6 sm:px-10 py-16 sm:py-20 rounded-lg transition-all" style={ringStyle('pricing')}>
          <p className="text-center text-[10px] font-semibold tracking-[0.2em] mb-3" style={{ color: palette.accent2 }}>PRICING</p>
          <h2 className="text-center text-xl sm:text-2xl font-semibold mb-10">Simple, transparent pricing</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-3xl mx-auto items-stretch">
            {content.pricing.map((tier) => (
              <div
                key={tier.name}
                className="p-5 rounded-2xl border backdrop-blur-xl flex flex-col transition-all hover:-translate-y-0.5"
                style={tier.highlighted
                  ? { borderColor: palette.ring, background: `linear-gradient(180deg, ${palette.accent}1a, transparent)`, boxShadow: `0 20px 40px -28px ${palette.accent}66` }
                  : { borderColor: 'rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.02)' }}
              >
                {tier.highlighted && (
                  <span className="self-start mb-2 px-2 py-0.5 rounded-full text-[9px] font-medium" style={{ background: `${palette.accent}33`, color: palette.accent }}>
                    Most popular
                  </span>
                )}
                <h3 className="text-[13px] font-medium text-white">{tier.name}</h3>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="text-2xl font-semibold text-white">{tier.price}</span>
                  {tier.period && <span className="text-[11px] text-[#94A3B8]">{tier.period}</span>}
                </div>
                <p className="mt-2 text-[11px] text-[#CBD5E1] leading-relaxed flex-1">{tier.desc}</p>
                <div className="mt-3 flex items-center gap-1.5 text-[10px] text-[#4ADE80]">
                  <Check className="w-3 h-3" /> Included features
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Testimonials */}
      <div
        ref={setRef('testimonials')}
        className="px-6 sm:px-10 py-16 sm:py-20 rounded-lg transition-all"
        style={{ ...ringStyle('testimonials'), background: `radial-gradient(80% 60% at 50% 0%, ${palette.glow}, transparent 70%)` }}
      >
        <p className="text-center text-[10px] font-semibold tracking-[0.2em] mb-3" style={{ color: palette.accent }}>TESTIMONIALS</p>
        <h2 className="text-center text-xl sm:text-2xl font-semibold mb-10">What early customers are saying</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-3xl mx-auto">
          {content.testimonials.map((t) => (
            <div key={t.name} className="p-5 rounded-2xl border border-white/[0.06] bg-white/[0.02] backdrop-blur-xl hover:border-white/[0.12] hover:-translate-y-0.5 transition-all">
              <div className="flex gap-0.5 mb-3">
                {Array.from({ length: 5 }).map((_, i) => <Star key={i} className="w-3 h-3 fill-[#FACC15] text-[#FACC15]" />)}
              </div>
              <p className="text-[12px] text-slate-300 leading-relaxed mb-3">&ldquo;{t.quote}&rdquo;</p>
              <p className="text-[11px] text-[#94A3B8]">{t.name} — {t.role}</p>
            </div>
          ))}
        </div>
      </div>

      {/* FAQ */}
      <div ref={setRef('faq')} className="px-6 sm:px-10 py-16 sm:py-20 rounded-lg transition-all" style={ringStyle('faq')}>
        <p className="text-center text-[10px] font-semibold tracking-[0.2em] mb-3" style={{ color: palette.accent2 }}>FAQ</p>
        <h2 className="text-center text-xl sm:text-2xl font-semibold mb-10">Frequently asked questions</h2>
        <div className="max-w-xl mx-auto space-y-2">
          {content.faq.map((qa) => (
            <div key={qa.q} className="p-4 rounded-xl border border-white/[0.06] bg-white/[0.02]">
              <p className="text-[12px] font-medium text-white mb-1">{qa.q}</p>
              <p className="text-[11px] text-[#CBD5E1] leading-relaxed">{qa.a}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Brand + typography */}
      <div ref={setRef('brand')} className="px-6 sm:px-10 py-16 sm:py-20 rounded-lg transition-all" style={ringStyle('brand')}>
        <p className="text-center text-[10px] font-semibold tracking-[0.2em] mb-3" style={{ color: palette.accent }}>BRAND SYSTEM</p>
        <h2 className="text-center text-xl sm:text-2xl font-semibold mb-10">Brand system</h2>
        <div className="flex items-center justify-center gap-3 flex-wrap max-w-3xl mx-auto">
          {content.brand.map((c) => (
            <div key={c.hex} className="text-center">
              <div className="w-16 h-16 rounded-2xl border border-white/[0.08] shadow-lg mb-2" style={{ background: c.hex }} />
              <p className="text-[10px] text-[#94A3B8] font-mono">{c.hex}</p>
              <p className="text-[10px] text-[#94A3B8]">{c.label}</p>
            </div>
          ))}
        </div>
      </div>
      <div ref={setRef('typography')} className="px-6 sm:px-10 py-10 rounded-lg transition-all" style={ringStyle('typography')}>
        <p className="text-center text-3xl font-semibold tracking-tight">Aa</p>
        <p className="text-center text-[11px] text-[#94A3B8] mt-1">{content.typography}</p>
      </div>

      {/* Final CTA */}
      <div ref={setRef('cta')} className="px-6 sm:px-10 py-16 pb-20 rounded-lg transition-all" style={ringStyle('cta')}>
        <div
          className="max-w-2xl mx-auto text-center rounded-2xl border p-10 backdrop-blur-xl"
          style={{ borderColor: palette.ring, background: `linear-gradient(180deg, ${palette.accent}14, transparent)` }}
        >
          <h2 className="text-xl sm:text-2xl font-semibold mb-2">{content.cta.headline}</h2>
          <p className="text-[12px] text-[#CBD5E1] mb-6">{content.cta.subtext}</p>
          <button
            className="px-6 py-2.5 rounded-xl text-[13px] font-semibold"
            style={{ background: grad, color: palette.onAccent }}
          >
            {content.cta.button}
          </button>
        </div>
      </div>

      {/* Footer */}
      <footer className="px-6 sm:px-10 py-8 border-t border-white/[0.05] flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-md" style={{ background: grad }} />
          <span className="text-[12px] font-medium text-slate-300">{content.brandName}</span>
        </div>
        <span className="text-[11px] text-[#94A3B8]">Crafted with Korvix</span>
      </footer>
    </div>
  );
}

// ── ProductMockup — CSS/SVG-only product visuals, keyed by category. ──────
// Never an <img>, so there's never a broken image placeholder. Reused for
// both the hero's product visual and the dedicated showcase section.

function ProductMockup({ kind, palette, size }: { kind: MockupKind; palette: BuilderPalette; size: 'lg' | 'md' }) {
  const grad = `linear-gradient(135deg, ${palette.accent}, ${palette.accent2})`;
  const height = size === 'lg' ? 'h-44 sm:h-60' : 'h-40 sm:h-52';

  return (
    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] backdrop-blur-xl p-2 shadow-2xl shadow-black/50">
      <div className="rounded-xl border border-white/[0.05] bg-[#0d0d13] overflow-hidden text-left">
        <div className="flex items-center gap-1.5 px-3 py-2 border-b border-white/[0.05]">
          <span className="w-2 h-2 rounded-full bg-[#ff5f57]/70" />
          <span className="w-2 h-2 rounded-full bg-[#febc2e]/70" />
          <span className="w-2 h-2 rounded-full bg-[#28c840]/70" />
          <span className="ml-2 h-1.5 w-24 rounded-full bg-white/[0.06]" />
        </div>
        <div className={`flex ${height}`}>
          {kind === 'dashboard' && <DashboardMockup palette={palette} grad={grad} />}
          {kind === 'commerce' && <CommerceMockup palette={palette} grad={grad} />}
          {kind === 'gallery' && <GalleryMockup grad={grad} />}
          {kind === 'chat' && <ChatMockup palette={palette} grad={grad} />}
          {kind === 'timeline' && <TimelineMockup palette={palette} grad={grad} />}
          {kind === 'workflow' && <WorkflowMockup palette={palette} grad={grad} />}
        </div>
      </div>
    </div>
  );
}

function DashboardMockup({ palette, grad }: { palette: BuilderPalette; grad: string }) {
  return (
    <>
      <div className="hidden sm:block w-28 shrink-0 border-r border-white/[0.05] p-3 space-y-2">
        <div className="h-2 w-14 rounded bg-white/[0.08]" />
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-6 rounded-md" style={{ background: i === 0 ? `${palette.accent}30` : 'rgba(255,255,255,0.03)' }} />
        ))}
      </div>
      <div className="flex-1 min-w-0 p-3 sm:p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="h-2 w-20 rounded bg-white/[0.1]" />
          <div className="h-5 w-14 rounded-md" style={{ background: `linear-gradient(90deg, ${palette.accent}40, ${palette.accent2}40)` }} />
        </div>
        <div className="grid grid-cols-3 gap-2 mb-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-10 rounded-lg bg-white/[0.04] border border-white/[0.05]" />
          ))}
        </div>
        <div className="flex items-end gap-1.5 h-16 sm:h-24 px-1">
          {[38, 62, 45, 80, 55, 70, 40, 90, 60].map((h, i) => (
            <div key={i} className="flex-1 rounded-sm" style={{ height: `${h}%`, background: grad, opacity: 0.55 + (i % 3) * 0.12 }} />
          ))}
        </div>
      </div>
    </>
  );
}

function CommerceMockup({ palette, grad }: { palette: BuilderPalette; grad: string }) {
  return (
    <div className="flex-1 min-w-0 p-3 sm:p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="h-2 w-16 rounded bg-white/[0.1]" />
        <div className="h-5 w-16 rounded-full" style={{ background: `${palette.accent}30` }} />
      </div>
      <div className="grid grid-cols-3 gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-white/[0.05] bg-white/[0.03] p-1.5">
            <div className="h-10 sm:h-14 rounded-md mb-1.5" style={{ background: `linear-gradient(135deg, ${palette.accent}2a, ${palette.accent2}22)` }} />
            <div className="h-1.5 w-3/4 rounded bg-white/[0.08] mb-1" />
            <div className="h-1.5 w-1/2 rounded" style={{ background: grad, opacity: 0.6 }} />
          </div>
        ))}
      </div>
    </div>
  );
}

function GalleryMockup({ grad }: { grad: string }) {
  const sizes = ['h-16', 'h-10', 'h-12', 'h-9', 'h-14', 'h-11'];
  return (
    <div className="flex-1 min-w-0 p-3 sm:p-4 grid grid-cols-3 gap-2 content-start">
      {sizes.map((h, i) => (
        <div
          key={i}
          className={`${h} rounded-lg border border-white/[0.06]`}
          style={{ background: i % 2 === 0 ? grad : 'rgba(255,255,255,0.04)', opacity: i % 2 === 0 ? 0.35 : 1 }}
        />
      ))}
    </div>
  );
}

function ChatMockup({ palette, grad }: { palette: BuilderPalette; grad: string }) {
  return (
    <div className="flex-1 min-w-0 p-3 sm:p-4 flex flex-col justify-end gap-2">
      <div className="self-start max-w-[70%] rounded-xl rounded-bl-sm bg-white/[0.05] px-3 py-2">
        <div className="h-1.5 w-24 rounded bg-white/[0.15] mb-1" />
        <div className="h-1.5 w-16 rounded bg-white/[0.1]" />
      </div>
      <div className="self-end max-w-[70%] rounded-xl rounded-br-sm px-3 py-2" style={{ background: `${palette.accent}22` }}>
        <div className="h-1.5 w-20 rounded mb-1" style={{ background: grad, opacity: 0.7 }} />
        <div className="h-1.5 w-28 rounded" style={{ background: grad, opacity: 0.45 }} />
      </div>
      <div className="self-start flex items-center gap-1 rounded-xl bg-white/[0.05] px-3 py-2 w-fit">
        {[0, 1, 2].map((i) => (
          <span key={i} className="w-1.5 h-1.5 rounded-full bg-white/30 animate-pulse-soft" style={{ animationDelay: `${i * 160}ms` }} />
        ))}
      </div>
    </div>
  );
}

function TimelineMockup({ palette, grad }: { palette: BuilderPalette; grad: string }) {
  return (
    <div className="flex-1 min-w-0 p-3 sm:p-4">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-3 mb-3 last:mb-0">
          <div
            className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-semibold shrink-0"
            style={{ background: i <= 1 ? grad : 'rgba(255,255,255,0.06)', color: i <= 1 ? palette.onAccent : 'rgba(255,255,255,0.4)' }}
          >
            {i + 1}
          </div>
          <div className="flex-1 h-2 rounded-full" style={{ background: i <= 1 ? `${palette.accent}30` : 'rgba(255,255,255,0.04)', width: `${80 - i * 12}%` }} />
        </div>
      ))}
    </div>
  );
}

function WorkflowMockup({ palette, grad }: { palette: BuilderPalette; grad: string }) {
  const cols = [{ label: 'To do', n: 3 }, { label: 'In progress', n: 2 }, { label: 'Done', n: 2 }];
  return (
    <div className="flex-1 min-w-0 p-3 sm:p-4 grid grid-cols-3 gap-2">
      {cols.map((col, ci) => (
        <div key={col.label} className="rounded-lg bg-white/[0.02] border border-white/[0.05] p-1.5 space-y-1.5">
          <div className="h-1.5 w-10 rounded bg-white/[0.12] mb-1" />
          {Array.from({ length: col.n }).map((_, i) => (
            <div
              key={i}
              className="h-5 rounded-md"
              style={{ background: ci === 1 ? `linear-gradient(90deg, ${palette.accent}30, ${palette.accent2}20)` : 'rgba(255,255,255,0.04)' }}
            />
          ))}
          {ci === 2 && <div className="h-1 w-full rounded" style={{ background: grad, opacity: 0.5 }} />}
        </div>
      ))}
    </div>
  );
}
