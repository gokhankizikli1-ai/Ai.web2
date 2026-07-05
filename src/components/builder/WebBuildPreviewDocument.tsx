import { type ReactElement, type CSSProperties } from 'react';
import { motion } from 'framer-motion';
import { designTokensForBrief } from '@/lib/webBuildBrief';
import {
  deriveLayoutPlan, type WebBuildLayoutPlan, type HeroComposition, type SectionVariant,
} from '@/lib/webBuildLayoutPlan';
import VisualModule from '@/components/builder/WebBuildVisualModules';
import type { WebBuildBrief } from '@/lib/webBuildApi';
import type { WebBuildSectionItem } from '@/lib/webBuildPayload';

/**
 * A REAL, premium rendered approximation of the generated site whose STRUCTURE is
 * driven by a strategy-derived Layout Plan — not one universal template.
 *
 * The plan (deriveLayoutPlan) is a pure function of (brief, sections); the file
 * synthesizer derives the identical plan, so preview and generated code always
 * agree. The plan selects one of many HERO COMPOSITIONS and, per section, one of
 * many COMPOSITION VARIANTS, and embeds a strategy-specific VISUAL MODULE. So two
 * different ideas produce genuinely different hero structure, section rhythm and
 * visual language — not the same centered hero + card grid with new colors.
 */
type S = WebBuildSectionItem;

const bulletsOf = (s: S) => (s.bullets?.length ? s.bullets : [s.sub || s.purpose || s.name].filter(Boolean));
const heading = (s: S) => s.headline || s.name;

function Orb({ color, style, delay = 0 }: { color: string; style: React.CSSProperties; delay?: number }) {
  return (
    <motion.div
      aria-hidden className="pointer-events-none absolute rounded-full"
      style={{ filter: 'blur(70px)', opacity: 0.5, background: `radial-gradient(circle, ${color}, transparent 60%)`, ...style }}
      animate={{ x: [0, 26, 0], y: [0, 18, 0], scale: [1, 1.18, 1] }}
      transition={{ duration: 16, repeat: Infinity, ease: 'easeInOut', delay }}
    />
  );
}

const Reveal = ({ children, i = 0 }: { children: React.ReactNode; i?: number }) => (
  <motion.div initial={{ opacity: 0, y: 14 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-40px' }} transition={{ duration: 0.5, delay: i * 0.05 }}>
    {children}
  </motion.div>
);

const H2 = ({ children, align = 'center' }: { children: React.ReactNode; align?: 'center' | 'left' }) => (
  <h2 className={`text-2xl font-semibold text-white sm:text-3xl ${align === 'center' ? 'text-center' : ''}`} style={{ fontFamily: 'var(--hf)', letterSpacing: 'var(--tr)' }}>{children}</h2>
);

const Eyebrow = ({ children }: { children: React.ReactNode }) => (
  <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-medium text-white/80">
    <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--acc)' }} />{children}
  </span>
);

const PrimaryCta = ({ children }: { children: React.ReactNode }) => (
  <span className="rounded-xl px-6 py-3 text-sm font-semibold text-white shadow-lg" style={{ background: 'var(--acc)', boxShadow: '0 10px 30px -10px var(--acc)' }}>{children}</span>
);
const GhostCta = ({ children }: { children: React.ReactNode }) => (
  <span className="rounded-xl border border-white/15 px-6 py-3 text-sm font-medium text-slate-200">{children}</span>
);

/* ── Hero background shell (shared by every composition) ──────────────── */
function HeroBg({ full = false }: { full?: boolean }) {
  return (
    <>
      <div aria-hidden className="absolute inset-0" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.045) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.045) 1px,transparent 1px)', backgroundSize: '44px 44px', WebkitMaskImage: 'radial-gradient(ellipse at center,#000 40%,transparent 75%)', maskImage: 'radial-gradient(ellipse at center,#000 40%,transparent 75%)' }} />
      {full && <div aria-hidden className="pointer-events-none absolute left-1/2 top-0 h-[36rem] w-[52rem] -translate-x-1/2" style={{ background: 'radial-gradient(ellipse at center, color-mix(in srgb, var(--acc) 22%, transparent), transparent 68%)' }} />}
      <Orb color="var(--acc)" style={{ top: '-6rem', left: '-4rem', width: '28rem', height: '28rem' }} />
      <Orb color="var(--acc2)" style={{ top: '3rem', right: '-6rem', width: '24rem', height: '24rem' }} delay={-6} />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-b from-transparent to-black/50" />
    </>
  );
}

const HeroTitle = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => (
  <motion.h1 initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
    className={`font-semibold text-white ${className}`} style={{ fontFamily: 'var(--hf)', letterSpacing: 'var(--tr)' }}>{children}</motion.h1>
);

interface HeroProps { s: S; brief: WebBuildBrief; plan: WebBuildLayoutPlan }

function heroTexts(s: S, brief: WebBuildBrief) {
  return {
    title: s.headline || s.copyPreview?.split(/[.!?\n]/)[0] || brief.type || '',
    eyebrow: brief.type || s.bullets?.[0],
    sub: s.sub || brief.goal,
    cta: s.cta,
    secondary: s.bullets?.[1],
    proof: s.bullets?.[2],
    moduleLabels: s.bullets,
  };
}

/* — Centered (kept as a fallback; the plan rarely selects it) — */
function HeroCentered({ s, brief, plan }: HeroProps) {
  const t = heroTexts(s, brief);
  return (
    <section className="relative isolate overflow-hidden">
      <HeroBg full />
      <div className="relative mx-auto max-w-3xl px-6 py-24 text-center sm:py-28">
        {t.eyebrow && <Eyebrow>{t.eyebrow}</Eyebrow>}
        <HeroTitle className="mt-5 text-3xl sm:text-5xl">{t.title}</HeroTitle>
        {t.sub && <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-slate-300 sm:text-lg">{t.sub}</p>}
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          {t.cta && <PrimaryCta>{t.cta}</PrimaryCta>}
          {t.secondary && <GhostCta>{t.secondary}</GhostCta>}
        </div>
        <div className="mx-auto mt-12 max-w-lg"><VisualModule kind={plan.primaryVisualModule} labels={t.moduleLabels} compact /></div>
      </div>
    </section>
  );
}

/* — Split editorial: left copy, right module — */
function HeroSplit({ s, brief, plan }: HeroProps) {
  const t = heroTexts(s, brief);
  return (
    <section className="relative isolate overflow-hidden">
      <HeroBg />
      <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-6 py-20 sm:py-24 lg:grid-cols-2">
        <div>
          {t.eyebrow && <Eyebrow>{t.eyebrow}</Eyebrow>}
          <HeroTitle className="mt-5 text-3xl sm:text-5xl">{t.title}</HeroTitle>
          {t.sub && <p className="mt-5 max-w-xl text-base leading-relaxed text-slate-300 sm:text-lg">{t.sub}</p>}
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            {t.cta && <PrimaryCta>{t.cta}</PrimaryCta>}
            {t.secondary && <GhostCta>{t.secondary}</GhostCta>}
          </div>
          {t.proof && <p className="mt-6 text-xs text-slate-400">{t.proof}</p>}
        </div>
        <VisualModule kind={plan.primaryVisualModule} labels={t.moduleLabels} />
      </div>
    </section>
  );
}

/* — Asymmetric visual: oversized offset module, overlapping copy — */
function HeroAsymmetric({ s, brief, plan }: HeroProps) {
  const t = heroTexts(s, brief);
  return (
    <section className="relative isolate overflow-hidden">
      <HeroBg />
      <div className="relative mx-auto max-w-6xl px-6 py-20 sm:py-28">
        <div className="ml-auto w-full max-w-3xl opacity-95 lg:w-[62%]"><VisualModule kind={plan.primaryVisualModule} labels={t.moduleLabels} /></div>
        <div className="relative -mt-24 max-w-xl rounded-3xl border border-white/10 bg-black/50 p-8 backdrop-blur-md lg:-mt-40">
          {t.eyebrow && <Eyebrow>{t.eyebrow}</Eyebrow>}
          <HeroTitle className="mt-4 text-3xl sm:text-5xl">{t.title}</HeroTitle>
          {t.sub && <p className="mt-4 text-base leading-relaxed text-slate-300">{t.sub}</p>}
          <div className="mt-7 flex flex-col gap-3 sm:flex-row">
            {t.cta && <PrimaryCta>{t.cta}</PrimaryCta>}
            {t.secondary && <GhostCta>{t.secondary}</GhostCta>}
          </div>
        </div>
      </div>
    </section>
  );
}

/* — Dashboard/product: centered copy, then a wide product panel — */
function HeroDashboard({ s, brief, plan }: HeroProps) {
  const t = heroTexts(s, brief);
  return (
    <section className="relative isolate overflow-hidden">
      <HeroBg full />
      <div className="relative mx-auto max-w-5xl px-6 py-20 text-center sm:py-24">
        {t.eyebrow && <Eyebrow>{t.eyebrow}</Eyebrow>}
        <HeroTitle className="mx-auto mt-5 max-w-3xl text-3xl sm:text-5xl">{t.title}</HeroTitle>
        {t.sub && <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-slate-300 sm:text-lg">{t.sub}</p>}
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          {t.cta && <PrimaryCta>{t.cta}</PrimaryCta>}
          {t.secondary && <GhostCta>{t.secondary}</GhostCta>}
        </div>
        <div className="mt-14"><VisualModule kind={plan.primaryVisualModule} labels={t.moduleLabels} /></div>
      </div>
    </section>
  );
}

/* — Immersive full-bleed: module as backdrop, copy bottom-left — */
function HeroImmersive({ s, brief, plan }: HeroProps) {
  const t = heroTexts(s, brief);
  return (
    <section className="relative isolate flex min-h-[34rem] items-end overflow-hidden">
      <HeroBg />
      <div aria-hidden className="pointer-events-none absolute inset-0 scale-110 opacity-40 blur-[1px]"><VisualModule kind={plan.primaryVisualModule} labels={t.moduleLabels} className="h-full [&>div]:h-full" /></div>
      <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent" />
      <div className="relative mx-auto w-full max-w-6xl px-6 py-16">
        <div className="max-w-2xl">
          {t.eyebrow && <Eyebrow>{t.eyebrow}</Eyebrow>}
          <HeroTitle className="mt-5 text-4xl sm:text-6xl">{t.title}</HeroTitle>
          {t.sub && <p className="mt-5 max-w-xl text-base leading-relaxed text-slate-200 sm:text-lg">{t.sub}</p>}
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            {t.cta && <PrimaryCta>{t.cta}</PrimaryCta>}
            {t.secondary && <GhostCta>{t.secondary}</GhostCta>}
          </div>
        </div>
      </div>
    </section>
  );
}

/* — Membership/application: copy left, elevated pass/access card right — */
function HeroMembership({ s, brief, plan }: HeroProps) {
  const t = heroTexts(s, brief);
  return (
    <section className="relative isolate overflow-hidden">
      <HeroBg />
      <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-6 py-20 sm:py-24 lg:grid-cols-[1.1fr_0.9fr]">
        <div>
          {t.eyebrow && <Eyebrow>{t.eyebrow}</Eyebrow>}
          <HeroTitle className="mt-5 text-3xl sm:text-5xl">{t.title}</HeroTitle>
          {t.sub && <p className="mt-5 max-w-xl text-base leading-relaxed text-slate-300 sm:text-lg">{t.sub}</p>}
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            {t.cta && <PrimaryCta>{t.cta}</PrimaryCta>}
            {t.secondary && <GhostCta>{t.secondary}</GhostCta>}
          </div>
        </div>
        <motion.div animate={{ y: [0, -10, 0] }} transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }} className="rounded-3xl border border-white/10 bg-white/[0.02] p-3 shadow-2xl shadow-black/40">
          <VisualModule kind={plan.primaryVisualModule} labels={t.moduleLabels} />
        </motion.div>
      </div>
    </section>
  );
}

/* — Catalog/collection: headline + CTA left, catalog strip beneath — */
function HeroCatalog({ s, brief, plan }: HeroProps) {
  const t = heroTexts(s, brief);
  return (
    <section className="relative isolate overflow-hidden">
      <HeroBg />
      <div className="relative mx-auto max-w-6xl px-6 py-18 sm:py-20">
        <div className="flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-end">
          <div className="max-w-2xl">
            {t.eyebrow && <Eyebrow>{t.eyebrow}</Eyebrow>}
            <HeroTitle className="mt-4 text-3xl sm:text-5xl">{t.title}</HeroTitle>
            {t.sub && <p className="mt-4 max-w-xl text-base leading-relaxed text-slate-300">{t.sub}</p>}
          </div>
          <div className="flex shrink-0 gap-3">{t.cta && <PrimaryCta>{t.cta}</PrimaryCta>}{t.secondary && <GhostCta>{t.secondary}</GhostCta>}</div>
        </div>
        <div className="mt-10"><VisualModule kind={plan.primaryVisualModule} labels={t.moduleLabels} /></div>
      </div>
    </section>
  );
}

/* — Data/map: copy left, data module right (utility density) — */
function HeroData({ s, brief, plan }: HeroProps) {
  const t = heroTexts(s, brief);
  return (
    <section className="relative isolate overflow-hidden">
      <HeroBg />
      <div className="relative mx-auto grid max-w-6xl items-center gap-10 px-6 py-18 sm:py-20 lg:grid-cols-[0.9fr_1.1fr]">
        <div>
          {t.eyebrow && <Eyebrow>{t.eyebrow}</Eyebrow>}
          <HeroTitle className="mt-5 text-3xl sm:text-5xl">{t.title}</HeroTitle>
          {t.sub && <p className="mt-5 max-w-xl text-base leading-relaxed text-slate-300">{t.sub}</p>}
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            {t.cta && <PrimaryCta>{t.cta}</PrimaryCta>}
            {t.secondary && <GhostCta>{t.secondary}</GhostCta>}
          </div>
        </div>
        <VisualModule kind={plan.primaryVisualModule} labels={t.moduleLabels} />
      </div>
    </section>
  );
}

/* — Luxury service: spacious, serif, minimal, thin editorial band — */
function HeroLuxury({ s, brief, plan }: HeroProps) {
  const t = heroTexts(s, brief);
  return (
    <section className="relative isolate overflow-hidden">
      <HeroBg full />
      <div className="relative mx-auto max-w-3xl px-6 py-28 text-center sm:py-36">
        {t.eyebrow && <span className="text-[11px] uppercase tracking-[0.35em] text-white/60">{t.eyebrow}</span>}
        <HeroTitle className="mt-6 text-4xl leading-[1.1] sm:text-6xl">{t.title}</HeroTitle>
        {t.sub && <p className="mx-auto mt-7 max-w-xl text-base leading-relaxed text-slate-300 sm:text-lg">{t.sub}</p>}
        <div className="mt-10 flex items-center justify-center gap-4">
          {t.cta && <span className="border-b border-white/40 pb-1 text-sm font-medium tracking-wide text-white">{t.cta} →</span>}
        </div>
        <div className="mx-auto mt-14 max-w-md"><VisualModule kind={plan.primaryVisualModule} labels={t.moduleLabels} compact /></div>
      </div>
    </section>
  );
}

/* — Story editorial: oversized headline left, meta + small module right — */
function HeroStory({ s, brief, plan }: HeroProps) {
  const t = heroTexts(s, brief);
  return (
    <section className="relative isolate overflow-hidden">
      <HeroBg />
      <div className="relative mx-auto grid max-w-6xl gap-10 px-6 py-20 sm:py-24 lg:grid-cols-12">
        <div className="lg:col-span-7">
          {t.eyebrow && <Eyebrow>{t.eyebrow}</Eyebrow>}
          <HeroTitle className="mt-5 text-4xl leading-[1.05] sm:text-6xl">{t.title}</HeroTitle>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            {t.cta && <PrimaryCta>{t.cta}</PrimaryCta>}
            {t.secondary && <GhostCta>{t.secondary}</GhostCta>}
          </div>
        </div>
        <div className="lg:col-span-5">
          {t.sub && <p className="border-l-2 pl-5 text-base leading-relaxed text-slate-300" style={{ borderColor: 'var(--acc)' }}>{t.sub}</p>}
          <div className="mt-6"><VisualModule kind={plan.primaryVisualModule} labels={t.moduleLabels} compact /></div>
        </div>
      </div>
    </section>
  );
}

/* — Event/experience: meta row, huge title, module below — */
function HeroEvent({ s, brief, plan }: HeroProps) {
  const t = heroTexts(s, brief);
  const meta = (s.bullets || []).slice(0, 3);
  return (
    <section className="relative isolate overflow-hidden">
      <HeroBg full />
      <div className="relative mx-auto max-w-5xl px-6 py-20 text-center sm:py-24">
        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[12px] uppercase tracking-[0.25em] text-white/70">
          {(meta.length ? meta : [brief.type].filter(Boolean)).map((m, i) => <span key={i} className="flex items-center gap-2">{i > 0 && <span className="h-1 w-1 rounded-full" style={{ background: 'var(--acc)' }} />}{m}</span>)}
        </div>
        <HeroTitle className="mx-auto mt-6 max-w-3xl text-5xl sm:text-7xl">{t.title}</HeroTitle>
        {t.sub && <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-slate-300 sm:text-lg">{t.sub}</p>}
        <div className="mt-9 flex items-center justify-center gap-3">{t.cta && <PrimaryCta>{t.cta}</PrimaryCta>}{t.secondary && <GhostCta>{t.secondary}</GhostCta>}</div>
        <div className="mx-auto mt-12 max-w-lg"><VisualModule kind={plan.primaryVisualModule} labels={t.moduleLabels} compact /></div>
      </div>
    </section>
  );
}

const HEROES: Record<HeroComposition, (p: HeroProps) => ReactElement> = {
  centered: (p) => <HeroCentered {...p} />,
  'split-editorial': (p) => <HeroSplit {...p} />,
  'asymmetric-visual': (p) => <HeroAsymmetric {...p} />,
  'dashboard-product': (p) => <HeroDashboard {...p} />,
  'immersive-full-bleed': (p) => <HeroImmersive {...p} />,
  'membership-application': (p) => <HeroMembership {...p} />,
  'catalog-collection': (p) => <HeroCatalog {...p} />,
  'data-map': (p) => <HeroData {...p} />,
  'luxury-service': (p) => <HeroLuxury {...p} />,
  'story-editorial': (p) => <HeroStory {...p} />,
  'event-experience': (p) => <HeroEvent {...p} />,
};

/* ── Section composition variants ─────────────────────────────────────── */
interface VarProps { s: S; plan: WebBuildLayoutPlan; index: number }

function FeatureGrid({ s }: VarProps) {
  const items = bulletsOf(s).slice(0, 6);
  return (
    <div className="mx-auto max-w-6xl px-6">
      <H2>{heading(s)}</H2>
      {s.sub && <p className="mx-auto mt-3 max-w-2xl text-center text-slate-400">{s.sub}</p>}
      <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((b, i) => (
          <Reveal key={i} i={i}>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 transition hover:-translate-y-1 hover:border-white/20"><div className="mb-4 h-11 w-11 rounded-xl ring-1 ring-white/10" style={{ background: 'linear-gradient(135deg, color-mix(in srgb, var(--acc) 45%, transparent), color-mix(in srgb, var(--acc2) 22%, transparent))' }} /><p className="text-[15px] font-semibold leading-snug text-white">{b}</p></div>
          </Reveal>
        ))}
      </div>
    </div>
  );
}

function EditorialSplit({ s, plan, index }: VarProps) {
  const items = bulletsOf(s).slice(0, 4);
  const flip = index % 2 === 1;
  return (
    <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 lg:grid-cols-2">
      <div className={flip ? 'lg:order-2' : ''}>
        <H2 align="left">{heading(s)}</H2>
        {s.sub && <p className="mt-4 max-w-lg text-base leading-relaxed text-slate-300">{s.sub}</p>}
        <ul className="mt-6 space-y-3">
          {items.map((b, i) => (
            <li key={i} className="flex gap-3 text-[15px] text-slate-200"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: 'var(--acc)' }} />{b}</li>
          ))}
        </ul>
      </div>
      <div className={flip ? 'lg:order-1' : ''}><VisualModule kind={plan.primaryVisualModule} labels={s.bullets} /></div>
    </div>
  );
}

function ProofStrip({ s }: VarProps) {
  const items = bulletsOf(s).slice(0, 4);
  const stats = ['4.9★', '12k+', '98%', '24/7'];
  return (
    <div className="mx-auto max-w-5xl px-6">
      <H2>{heading(s)}</H2>
      <div className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/5 lg:grid-cols-4">
        {items.map((b, i) => (
          <div key={i} className="bg-[#0b0d12] p-6 text-center">
            <div className="text-3xl font-semibold tracking-tight text-white">{stats[i % stats.length]}</div>
            <p className="mt-2 text-sm text-slate-400">{b}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function DashboardData({ s }: VarProps) {
  const labels = bulletsOf(s).slice(0, 4);
  return (
    <div className="mx-auto grid max-w-6xl items-center gap-10 px-6 lg:grid-cols-[1fr_1.15fr]">
      <div>
        <H2 align="left">{heading(s)}</H2>
        {s.sub && <p className="mt-4 max-w-md text-base leading-relaxed text-slate-300">{s.sub}</p>}
        <ul className="mt-6 grid grid-cols-2 gap-3">
          {labels.map((b, i) => (
            <li key={i} className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-[13px] text-slate-200">{b}</li>
          ))}
        </ul>
      </div>
      <VisualModule kind="data-dashboard" labels={s.bullets} />
    </div>
  );
}

function CatalogGrid({ s }: VarProps) {
  const tiles = bulletsOf(s).slice(0, 6);
  return (
    <div className="mx-auto max-w-6xl px-6">
      <H2>{heading(s)}</H2>
      <div className="mt-10 grid grid-cols-2 gap-4 sm:grid-cols-3">
        {tiles.map((b, i) => (
          <Reveal key={i} i={i}>
            <figure className={`group relative overflow-hidden rounded-2xl border border-white/10 ${i % 5 === 0 ? 'sm:col-span-2' : ''}`}>
              <div className="relative aspect-[4/3] w-full transition duration-500 group-hover:scale-[1.04]" style={{ background: i % 3 === 0 ? 'linear-gradient(135deg, color-mix(in srgb, var(--acc) 26%, transparent), color-mix(in srgb, var(--acc2) 14%, transparent))' : 'linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0.01))' }} />
              <figcaption className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/70 to-transparent p-3 text-sm font-medium text-white">{b}</figcaption>
            </figure>
          </Reveal>
        ))}
      </div>
    </div>
  );
}

function CollectionArchive({ s }: VarProps) {
  const rows = bulletsOf(s).slice(0, 6);
  return (
    <div className="mx-auto max-w-4xl px-6">
      <H2 align="left">{heading(s)}</H2>
      <div className="mt-8 divide-y divide-white/10 border-y border-white/10">
        {rows.map((b, i) => (
          <Reveal key={i} i={i}>
            <div className="group flex items-center gap-5 py-5">
              <span className="w-8 text-sm tabular-nums text-slate-500">{String(i + 1).padStart(2, '0')}</span>
              <span className="h-12 w-16 shrink-0 rounded-md border border-white/10" style={{ background: 'linear-gradient(135deg, color-mix(in srgb, var(--acc) 22%, transparent), transparent)' }} />
              <span className="flex-1 text-[15px] font-medium text-white">{b}</span>
              <span className="text-slate-500 transition group-hover:translate-x-1">→</span>
            </div>
          </Reveal>
        ))}
      </div>
    </div>
  );
}

function ProcessTimeline({ s }: VarProps) {
  const steps = bulletsOf(s).slice(0, 4);
  return (
    <div className="mx-auto max-w-6xl px-6">
      <H2>{heading(s)}</H2>
      <ol className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((b, i) => (
          <Reveal key={i} i={i}>
            <li className="relative rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <span className="text-sm font-semibold" style={{ color: 'var(--acc)' }}>0{i + 1}</span>
              <p className="mt-2 text-[15px] font-medium text-white">{b}</p>
            </li>
          </Reveal>
        ))}
      </ol>
    </div>
  );
}

function QuoteStory({ s }: VarProps) {
  const quotes = (s.bullets?.length ? s.bullets : [s.sub || s.name]).slice(0, 2);
  return (
    <div className="mx-auto max-w-4xl px-6">
      <div className="space-y-10">
        {quotes.map((b, i) => (
          <Reveal key={i} i={i}>
            <blockquote className="border-l-2 pl-6" style={{ borderColor: 'var(--acc)' }}>
              <p className="text-xl font-medium leading-relaxed text-white sm:text-2xl" style={{ fontFamily: 'var(--hf)' }}>“{b}”</p>
              <footer className="mt-4 flex items-center gap-3 text-sm text-slate-400"><span className="h-8 w-8 rounded-full" style={{ background: 'linear-gradient(135deg, color-mix(in srgb, var(--acc) 55%, transparent), color-mix(in srgb, var(--acc2) 30%, transparent))' }} />{heading(s)}</footer>
            </blockquote>
          </Reveal>
        ))}
      </div>
    </div>
  );
}

function Showcase({ s, plan }: VarProps) {
  return (
    <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 lg:grid-cols-2">
      <VisualModule kind={plan.primaryVisualModule === 'contour-terrain' ? 'product-showcase' : plan.primaryVisualModule} labels={s.bullets} />
      <div>
        <H2 align="left">{heading(s)}</H2>
        {s.sub && <p className="mt-4 max-w-lg text-base leading-relaxed text-slate-300">{s.sub}</p>}
        {s.cta && <div className="mt-7"><PrimaryCta>{s.cta}</PrimaryCta></div>}
      </div>
    </div>
  );
}

function SpatialFloorplanSection({ s }: VarProps) {
  const labels = bulletsOf(s).slice(0, 4);
  return (
    <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 lg:grid-cols-2">
      <VisualModule kind="spatial-floorplan" labels={s.bullets} />
      <div>
        <H2 align="left">{heading(s)}</H2>
        <ul className="mt-6 space-y-3">
          {labels.map((b, i) => <li key={i} className="flex gap-3 text-[15px] text-slate-200"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: 'var(--acc)' }} />{b}</li>)}
        </ul>
      </div>
    </div>
  );
}

function PricingMembership({ s }: VarProps) {
  const tiers = (s.bullets?.length ? s.bullets : ['Başlangıç', 'Pro', 'Kurumsal']).slice(0, 3);
  return (
    <div className="mx-auto max-w-5xl px-6">
      <H2>{heading(s)}</H2>
      <div className="mt-10 grid gap-5 sm:grid-cols-3">
        {tiers.map((b, i) => (
          <div key={i} className="rounded-2xl border p-6" style={i === 1 ? { borderColor: 'color-mix(in srgb, var(--acc) 40%, transparent)', background: 'color-mix(in srgb, var(--acc) 7%, transparent)' } : { borderColor: 'rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)' }}>
            <p className="text-sm font-medium text-slate-300">{b}</p>
            <div className="mt-3 text-3xl font-semibold text-white">₺{199 + i * 200}<span className="text-sm text-slate-400">/ay</span></div>
            <div className={`mt-5 rounded-lg py-2 text-center text-sm font-semibold ${i === 1 ? 'text-white' : 'border border-white/15 text-slate-200'}`} style={i === 1 ? { background: 'var(--acc)' } : undefined}>{s.cta || 'Seç'}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ApplicationForm({ s, plan }: VarProps) {
  return (
    <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 lg:grid-cols-2">
      <div>
        <H2 align="left">{heading(s)}</H2>
        {s.sub && <p className="mt-4 max-w-md text-base leading-relaxed text-slate-300">{s.sub}</p>}
        {(s.bullets || []).slice(0, 3).map((b, i) => <p key={i} className="mt-3 flex gap-2 text-sm text-slate-300"><span style={{ color: 'var(--acc)' }}>✓</span>{b}</p>)}
      </div>
      <VisualModule kind={plan.primaryVisualModule === 'membership-pass' ? 'membership-pass' : 'reservation-form'} labels={s.cta ? [s.cta, ...(s.bullets || [])] : s.bullets} />
    </div>
  );
}

function FaqCta({ s }: VarProps) {
  const appt = /contact|book|appointment|randevu|form|reservation|rezervasyon|apply|başvuru/.test(`${s.id} ${s.name}`.toLowerCase());
  const isFaq = /faq|sıkça|soru/.test(`${s.id} ${s.name}`.toLowerCase());
  if (isFaq && s.bullets?.length) {
    return (
      <div className="mx-auto max-w-3xl px-6">
        <H2 align="left">{heading(s)}</H2>
        <div className="mt-6 space-y-3">
          {s.bullets.slice(0, 6).map((b, i) => <div key={i} className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-[15px] font-medium text-white">{b}</div>)}
        </div>
      </div>
    );
  }
  return (
    <div className="relative isolate mx-auto max-w-2xl px-6" id="contact">
      <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-10 text-center backdrop-blur">
        <H2>{heading(s)}</H2>
        {s.sub && <p className="mt-3 text-slate-300">{s.sub}</p>}
        {appt ? (
          <div className="mx-auto mt-7 max-w-sm space-y-3 text-left">
            <div className="h-11 rounded-lg border border-white/10 bg-white/[0.02]" />
            <div className="h-11 rounded-lg border border-white/10 bg-white/[0.02]" />
            <div className="flex h-11 items-center justify-center rounded-lg text-sm font-semibold text-white" style={{ background: 'var(--acc)' }}>{s.cta || heading(s)}</div>
          </div>
        ) : (s.cta && <div className="mt-7"><PrimaryCta>{s.cta}</PrimaryCta></div>)}
      </div>
    </div>
  );
}

function Comparison({ s }: VarProps) {
  return (
    <div className="mx-auto max-w-5xl px-6">
      <H2>{heading(s)}</H2>
      <div className="mt-10 grid gap-5 sm:grid-cols-2">
        <div className="relative overflow-hidden rounded-2xl border border-white/10"><span className="absolute left-3 top-3 z-10 rounded-full bg-black/50 px-2.5 py-1 text-xs text-slate-300">Öncesi</span><div className="aspect-[4/3]" style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.05), rgba(255,255,255,0.01))' }} /></div>
        <div className="relative overflow-hidden rounded-2xl border ring-1" style={{ borderColor: 'color-mix(in srgb, var(--acc) 40%, transparent)' }}><span className="absolute left-3 top-3 z-10 rounded-full px-2.5 py-1 text-xs text-white" style={{ background: 'var(--acc)' }}>Sonrası</span><div className="aspect-[4/3]" style={{ background: 'linear-gradient(135deg, color-mix(in srgb, var(--acc) 22%, transparent), color-mix(in srgb, var(--acc2) 12%, transparent))' }} /></div>
      </div>
    </div>
  );
}

function Footer({ s }: { s: S }) {
  return (
    <footer className="border-t border-white/10 px-6 py-10">
      <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-4 sm:flex-row">
        <p className="text-sm text-slate-400">{s.headline || s.copyPreview || s.name}</p>
        <nav className="flex gap-6 text-sm text-slate-400">{(s.bullets?.length ? s.bullets.slice(0, 4) : [s.name]).map((b, i) => <span key={i}>{b}</span>)}</nav>
      </div>
    </footer>
  );
}

const VARIANTS: Record<SectionVariant, (p: VarProps) => ReactElement> = {
  'feature-grid': (p) => <FeatureGrid {...p} />,
  'editorial-split': (p) => <EditorialSplit {...p} />,
  'process-timeline': (p) => <ProcessTimeline {...p} />,
  'proof-strip': (p) => <ProofStrip {...p} />,
  'catalog-grid': (p) => <CatalogGrid {...p} />,
  comparison: (p) => <Comparison {...p} />,
  'application-form': (p) => <ApplicationForm {...p} />,
  'dashboard-data': (p) => <DashboardData {...p} />,
  'quote-story': (p) => <QuoteStory {...p} />,
  'collection-archive': (p) => <CollectionArchive {...p} />,
  'spatial-floorplan': (p) => <SpatialFloorplanSection {...p} />,
  'pricing-membership': (p) => <PricingMembership {...p} />,
  'faq-cta': (p) => <FaqCta {...p} />,
  showcase: (p) => <Showcase {...p} />,
};

/** Vertical padding by content density (spacious/comfortable/compact). */
const PAD: Record<WebBuildLayoutPlan['contentDensity'], string> = {
  compact: 'py-14',
  comfortable: 'py-18 sm:py-20',
  spacious: 'py-24 sm:py-28',
};

export default function WebBuildPreviewDocument({
  sectionItems, brief,
}: {
  sectionItems: WebBuildSectionItem[];
  brief: WebBuildBrief;
}) {
  const ds = designTokensForBrief(brief);
  // The Layout Plan — the SAME pure derivation the file synthesizer uses — drives
  // hero composition, per-section variant, visual module and rhythm.
  const plan = deriveLayoutPlan(brief, sectionItems.map((s) => ({ id: s.id, name: s.name })));
  const variantOf = (id: string): SectionVariant => plan.sectionVariants[id] || 'feature-grid';

  const rootStyle = {
    background: ds.bg,
    fontFamily: ds.bodyFont,
    '--acc': ds.accent,
    '--acc2': ds.accent2,
    '--hf': ds.headingFont,
    '--tr': ds.tracking,
    '--rad': ds.radius,
  } as CSSProperties;

  const banded = plan.rhythm === 'alternating' || plan.rhythm === 'editorial';
  let contentIdx = 0;

  return (
    <div className="text-slate-200 antialiased" style={rootStyle}>
      {sectionItems.map((s) => {
        const kind = plan.sections.find((p) => p.id === s.id)?.kind;
        if (kind === 'hero') {
          const Hero = HEROES[plan.heroComposition] || HEROES['split-editorial'];
          return <Hero key={s.id} s={s} brief={brief} plan={plan} />;
        }
        if (kind === 'footer') return <Footer key={s.id} s={s} />;
        const variant = variantOf(s.id);
        const Render = VARIANTS[variant] || VARIANTS['feature-grid'];
        const i = contentIdx++;
        const band = banded && i % 2 === 1;
        return (
          <section key={s.id} className={`relative ${PAD[plan.contentDensity]}`} style={band ? { background: 'rgba(255,255,255,0.015)' } : undefined}>
            {Render({ s, plan, index: i })}
          </section>
        );
      })}
    </div>
  );
}
