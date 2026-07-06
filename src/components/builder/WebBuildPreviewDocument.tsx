import { type ReactElement, type CSSProperties } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { designTokensForBrief } from '@/lib/webBuildBrief';
import {
  deriveLayoutPlan, visualSystemTokens,
  type WebBuildLayoutPlan, type HeroComposition, type SectionVariant,
} from '@/lib/webBuildLayoutPlan';
import VisualModule from '@/components/builder/WebBuildVisualModules';
import type { WebBuildBrief } from '@/lib/webBuildApi';
import type { WebBuildSectionItem } from '@/lib/webBuildPayload';
import {
  deriveWebBuildArtIdentity, deriveMotionFit, motionAmbientAllowed,
  type WebBuildArtIdentity, type ArtRenderMode,
} from '@/lib/webBuildArtIdentity';

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

/* ── Honest proof / price primitives ─────────────────────────────────────
 * The old ProofStrip/PricingMembership hardcoded fabricated ratings, counts and
 * prices (4.9★ / 12k+ / 98% / 24/7, ₺199…). These helpers keep proof and pricing
 * HONEST: they surface only real section copy (bullets / art proof rules / trust
 * signals) or clearly-structural, non-factual module labels — never an invented
 * metric, rating, price or compliance claim. */

/** True when a string reads like a factual metric/rating/price/compliance claim.
 *  Used to keep structural fallbacks free of numbers we cannot substantiate. */
const isFactualMetricLike = (t: string): boolean =>
  /\d/.test(t) && /(%|★|\/\s?7|\/\s?24|\bk\+|\buptime\b|\bsoc\s?2\b|\biso\b|[$€₺]|\bmüşteri\b|\bcustomers?\b|\bclients?\b|\brating\b|\breview|\byorum\b)/i.test(t);

/** Structural, non-factual proof labels per render mode — used only when a section
 *  carries no real proof copy. These are module/section labels, not claims. */
const PROOF_LABELS: Partial<Record<ArtRenderMode, string[]>> = {
  archive: ['Curation workflow', 'Metadata clarity', 'Research access'],
  landscaping: ['Project process', 'Material clarity', 'Consultation path'],
  'trust-service': ['Credentials', 'Clear process', 'Contact path'],
  'product-saas': ['Demo flow', 'Security review', 'Integration path'],
  hospitality: ['Menu clarity', 'Reservation path', 'Location details'],
  marketplace: ['Catalog clarity', 'Shipping & returns', 'Support path'],
  industrial: ['Capabilities', 'Specifications', 'Request path'],
  portfolio: ['Selected work', 'Process', 'Start a project'],
};
const proofLabelForMode = (mode: ArtRenderMode, index: number): string => {
  const set = (PROOF_LABELS[mode] || ['Clear process', 'What to expect', 'How to start']).filter((l) => !isFactualMetricLike(l));
  return set[index % set.length];
};

/** Real proof items for a section: prefer the section's own bullets, then the art
 *  identity proof rules, then structural mode labels. Never fabricates. */
function safeProofItems(s: S, art: WebBuildArtIdentity, n = 4): string[] {
  const bullets = (s.bullets || []).map((b) => (b || '').trim()).filter(Boolean);
  if (bullets.length) return bullets.slice(0, n);
  if (art.proofRules?.length) return art.proofRules.slice(0, n);
  return Array.from({ length: Math.min(n, 3) }, (_, i) => proofLabelForMode(art.mode, i));
}

/** An honest proof card — a structural label with a check glyph, never a metric. */
function renderProofCard(label: string, i: number, art: WebBuildArtIdentity): ReactElement {
  return (
    <Reveal key={i} i={i}>
      <div className={`h-full rounded-[var(--pr)] border border-[color:var(--bd)] bg-[var(--sf)] p-5 ${art.cardTone}`}>
        <span className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg text-sm font-semibold" style={{ background: 'color-mix(in srgb, var(--acc) 16%, transparent)', color: 'var(--acc)' }} aria-hidden>✓</span>
        <p className="text-[14px] font-medium leading-snug text-white">{label}</p>
      </div>
    </Reveal>
  );
}

const isProofSection = (s: S) => /proof|provenance|menşe|credential|referans|trust|güven|kanıt|curation|küratör/i.test(`${s.id} ${s.name}`);
const isTestimonialSection = (s: S) => /testimonial|review|yorum|müşteri|client|referans/i.test(`${s.id} ${s.name}`);

/** Extract an explicit price already present in section copy (₺/$/€ or "TL/USD").
 *  Returns undefined when there is no real price — we never invent one. */
function explicitPrice(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const m = text.match(/([$€₺]\s?\d[\d.,]*|\d[\d.,]*\s?(?:tl|usd|eur|₺))/i);
  return m ? m[0].replace(/\s+/g, ' ').trim() : undefined;
}

/* ── Concept-specific internal card detail ───────────────────────────────
 * Cards/media must never be blank rectangles. CardDetail overlays abstract,
 * concept-specific linework (archive metadata rules + stamp, landscaping terrain
 * curves + swatches, marketplace product structure, industrial spec grid,
 * portfolio crop frame, SaaS data surface). It is pure geometry — no fake text,
 * IDs, names, prices or metrics. */
function CardDetail({ mode, i = 0 }: { mode: ArtRenderMode; i?: number }): ReactElement {
  const line = 'rgba(255,255,255,0.22)';
  switch (mode) {
    case 'archive':
      return (
        <svg aria-hidden viewBox="0 0 120 120" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" style={{ opacity: 0.5 }}>
          {[30, 44, 58, 72].map((y, k) => <line key={k} x1="14" y1={y} x2={k % 2 ? 88 : 100} y2={y} stroke={line} strokeWidth="1.5" />)}
          <circle cx="94" cy="26" r="9" fill="none" stroke="var(--acc)" strokeWidth="1.5" />
          <rect x="14" y="90" width="40" height="6" rx="2" fill="var(--acc)" opacity="0.5" />
        </svg>
      );
    case 'landscaping':
      return (
        <svg aria-hidden viewBox="0 0 120 90" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" style={{ opacity: 0.55 }}>
          {[20, 34, 48, 62].map((y, k) => <path key={k} d={`M0 ${y} C 30 ${y - 12}, 90 ${y + 12}, 120 ${y}`} fill="none" stroke={k % 2 ? 'var(--acc)' : line} strokeWidth="1.4" />)}
          {[18, 34, 50].map((x, k) => <circle key={k} cx={x} cy="78" r="4.5" fill="var(--acc2)" opacity="0.55" />)}
        </svg>
      );
    case 'marketplace':
      return (
        <svg aria-hidden viewBox="0 0 120 120" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" style={{ opacity: 0.4 }}>
          <rect x="34" y="26" width="52" height="46" rx="6" fill="none" stroke={line} strokeWidth="1.5" />
          <line x1="34" y1="88" x2="74" y2="88" stroke={line} strokeWidth="2" />
          <line x1="34" y1="98" x2="60" y2="98" stroke="var(--acc)" strokeWidth="2" />
        </svg>
      );
    case 'industrial':
      return (
        <svg aria-hidden viewBox="0 0 120 120" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" style={{ opacity: 0.4 }}>
          {[24, 48, 72, 96].map((x, k) => <line key={`v${k}`} x1={x} y1="12" x2={x} y2="108" stroke={line} strokeWidth="1" />)}
          {[36, 60, 84].map((y, k) => <line key={`h${k}`} x1="12" y1={y} x2="108" y2={y} stroke={line} strokeWidth="1" />)}
          <rect x="24" y="36" width="24" height="24" fill="var(--acc)" opacity="0.4" />
        </svg>
      );
    case 'portfolio':
      return (
        <svg aria-hidden viewBox="0 0 120 120" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" style={{ opacity: 0.45 }}>
          <rect x="16" y="16" width="88" height="88" fill="none" stroke={line} strokeWidth="1.5" />
          <line x1="16" y1="80" x2="104" y2="40" stroke="var(--acc)" strokeWidth="1.5" />
        </svg>
      );
    case 'product-saas':
      return (
        <svg aria-hidden viewBox="0 0 120 90" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" style={{ opacity: 0.5 }}>
          <polyline points="6,66 30,44 54,54 78,24 108,36" fill="none" stroke="var(--acc)" strokeWidth="2" />
          {[6, 30, 54, 78].map((x, k) => <rect key={k} x={x} y={70} width="14" height={8 + (k % 3) * 6} rx="2" fill={k % 2 ? 'var(--acc2)' : 'var(--acc)'} opacity="0.5" />)}
        </svg>
      );
    default:
      return (
        <svg aria-hidden viewBox="0 0 120 120" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" style={{ opacity: 0.35 }}>
          {[0, 1, 2].map((k) => <line key={k} x1={-20 + k * 40} y1="120" x2={40 + k * 40} y2="0" stroke={line} strokeWidth="1" />)}
        </svg>
      );
  }
}

function Orb({ color, style, delay = 0, still = false }: { color: string; style: React.CSSProperties; delay?: number; still?: boolean }) {
  const base = { filter: 'blur(70px)', opacity: 0.5, background: `radial-gradient(circle, ${color}, transparent 60%)`, ...style };
  // A restrained concept keeps the orb but does not drift it — calm, not flashy.
  if (still) return <div aria-hidden className="pointer-events-none absolute rounded-full" style={base} />;
  return (
    <motion.div
      aria-hidden className="pointer-events-none absolute rounded-full"
      style={base}
      animate={{ x: [0, 26, 0], y: [0, 18, 0], scale: [1, 1.18, 1] }}
      transition={{ duration: 16, repeat: Infinity, ease: 'easeInOut', delay }}
    />
  );
}

/** A slow, subtle sweeping line — the ambient motion for calm concepts (archive
 *  rule-scan, blueprint scan). Renders a static line when motion is not allowed. */
function ScanLine({ vertical = false, still = false, color = 'var(--acc)' }: { vertical?: boolean; still?: boolean; color?: string }) {
  const common = vertical
    ? { top: 0, bottom: 0, width: '2px', left: '18%' }
    : { left: 0, right: 0, height: '2px', top: '30%' };
  const style: React.CSSProperties = { position: 'absolute', background: `linear-gradient(${vertical ? '180deg' : '90deg'}, transparent, ${color}, transparent)`, opacity: 0.35, ...common };
  if (still) return <div aria-hidden style={{ ...style, opacity: 0.18 }} />;
  return (
    <motion.div
      aria-hidden style={style}
      animate={vertical ? { y: ['-20%', '120%'] } : { x: ['-20%', '120%'] }}
      transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut' }}
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
  <span className="inline-flex items-center gap-2 rounded-full border border-[color:var(--bd)] bg-white/[0.04] px-3 py-1 text-[11px] font-medium text-white/80">
    <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--acc)' }} />{children}
  </span>
);

const PrimaryCta = ({ children }: { children: React.ReactNode }) => (
  <span className="rounded-xl px-6 py-3 text-sm font-semibold text-white shadow-lg" style={{ background: 'var(--acc)', boxShadow: '0 10px 30px -10px var(--acc)' }}>{children}</span>
);
const GhostCta = ({ children }: { children: React.ReactNode }) => (
  <span className="rounded-xl border border-white/15 px-6 py-3 text-sm font-medium text-slate-200">{children}</span>
);

/* ── Backdrop construction (strategy-driven, not one universal grid) ─────
 * The single biggest sameness driver was that every hero used the same
 * aurora+grid. Backdrop renders a genuinely different construction per visual
 * system, so the first impression changes with the strategy. All motifs are
 * dark-safe (no contrast regressions). */
type BgMotif = WebBuildLayoutPlan['visualSystem']['background'];
type AccMode = WebBuildLayoutPlan['visualSystem']['accentMode'];

function Backdrop({ motif, accent, full = false, animate = true }: { motif: BgMotif; accent: AccMode; full?: boolean; animate?: boolean }) {
  // `animate` is the concept-gated Motion Fit: when false (archive / legal /
  // medical / marketplace) the ambient background is completely still — no drift,
  // no scan — so serious concepts read as calm and credible.
  const reduce = useReducedMotion();
  const still = !animate || !!reduce;
  const glow = accent === 'vivid' ? 0.55 : accent === 'duotone' ? 0.4 : 0.16;
  const seam = <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-b from-transparent to-black/50" />;
  const grid = (size: number, op: number) => (
    <div aria-hidden className="absolute inset-0" style={{ backgroundImage: `linear-gradient(rgba(255,255,255,${op}) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,${op}) 1px,transparent 1px)`, backgroundSize: `${size}px ${size}px`, WebkitMaskImage: 'radial-gradient(ellipse at center,#000 40%,transparent 75%)', maskImage: 'radial-gradient(ellipse at center,#000 40%,transparent 75%)' }} />
  );
  switch (motif) {
    case 'blueprint':
      return (<>{grid(26, 0.06)}<div aria-hidden className="absolute inset-0" style={{ backgroundImage: 'linear-gradient(var(--acc) 1px,transparent 1px),linear-gradient(90deg,var(--acc) 1px,transparent 1px)', backgroundSize: '130px 130px', opacity: 0.12 }} /><svg aria-hidden className="absolute right-8 top-8 h-16 w-16" style={{ opacity: 0.5 }} viewBox="0 0 40 40"><path d="M0 8 H40 M0 8 V0 M32 8 V0 M0 32 H40" stroke="var(--acc)" strokeWidth="1" fill="none" /></svg><ScanLine vertical still={still} />{seam}</>);
    case 'mesh-duotone':
      return (<><Orb color="var(--acc)" style={{ top: '-8rem', left: '-6rem', width: '34rem', height: '34rem', opacity: glow }} still={still} /><Orb color="var(--acc2)" style={{ bottom: '-10rem', right: '-6rem', width: '30rem', height: '30rem', opacity: glow }} delay={-8} still={still} />{seam}</>);
    case 'spotlight':
      return (<><div aria-hidden className="pointer-events-none absolute left-1/2 top-[-8rem] h-[42rem] w-[46rem] -translate-x-1/2" style={{ background: `radial-gradient(ellipse at center, color-mix(in srgb, var(--acc) ${Math.round(glow * 60)}%, transparent), transparent 70%)` }} /><div aria-hidden className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at 50% 30%, transparent 40%, rgba(0,0,0,0.55) 100%)' }} />{!still && <motion.div aria-hidden className="pointer-events-none absolute left-1/2 top-[-8rem] h-[42rem] w-[46rem] -translate-x-1/2" style={{ background: 'radial-gradient(ellipse at center, color-mix(in srgb, var(--acc) 22%, transparent), transparent 70%)' }} animate={{ opacity: [0.4, 0.75, 0.4] }} transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut' }} />}{seam}</>);
    case 'editorial-rules':
      return (<><div aria-hidden className="absolute inset-y-0 left-[12%] w-px bg-white/10" /><div aria-hidden className="absolute inset-y-0 right-[12%] w-px bg-white/10" /><div aria-hidden className="absolute inset-x-0 top-24 h-px bg-white/10" /><div aria-hidden className="absolute inset-x-0 bottom-24 h-px" style={{ background: 'var(--acc)', opacity: 0.25 }} /><ScanLine still={still} />{seam}</>);
    case 'dot-matrix':
      return (<><div aria-hidden className="absolute inset-0" style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,0.14) 1px, transparent 1px)', backgroundSize: '22px 22px', WebkitMaskImage: 'radial-gradient(ellipse at center,#000 45%,transparent 80%)', maskImage: 'radial-gradient(ellipse at center,#000 45%,transparent 80%)' }} /><Orb color="var(--acc)" style={{ top: '-4rem', right: '-4rem', width: '22rem', height: '22rem', opacity: glow }} still={still} />{seam}</>);
    case 'diagonal-split':
      return (<><div aria-hidden className="absolute inset-0 overflow-hidden">{still ? <div className="absolute -inset-x-1/4 top-1/3 h-[60%] -rotate-6" style={{ background: `linear-gradient(90deg, transparent, color-mix(in srgb, var(--acc) ${Math.round(glow * 34)}%, transparent), transparent)` }} /> : <motion.div className="absolute -inset-x-1/4 top-1/3 h-[60%] -rotate-6" style={{ background: `linear-gradient(90deg, transparent, color-mix(in srgb, var(--acc) ${Math.round(glow * 34)}%, transparent), transparent)` }} animate={{ x: ['-8%', '8%', '-8%'] }} transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }} />}</div>{grid(40, 0.03)}{seam}</>);
    case 'flat-void':
      return (<><div aria-hidden className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at 50% 40%, transparent 55%, rgba(0,0,0,0.5) 100%)' }} /><Orb color="var(--acc)" style={{ bottom: '-10rem', left: '20%', width: '24rem', height: '20rem', opacity: glow * 0.7 }} still={still} />{seam}</>);
    case 'gradient-veil':
      return (<><div aria-hidden className="absolute inset-0" style={{ background: `linear-gradient(180deg, color-mix(in srgb, var(--acc) ${Math.round(glow * 20)}%, transparent), transparent 55%)` }} />{grid(48, 0.035)}<Orb color="var(--acc2)" style={{ top: '2rem', right: '-6rem', width: '22rem', height: '22rem', opacity: glow * 0.8 }} delay={-6} still={still} />{seam}</>);
    case 'terrain-lines':
      return (<><svg aria-hidden viewBox="0 0 1200 400" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" style={{ opacity: 0.4 }}>{Array.from({ length: 9 }).map((_, i) => (still
        ? <path key={i} d={`M0 ${40 + i * 40} C 300 ${i * 40}, 900 ${100 + i * 40}, 1200 ${40 + i * 40}`} fill="none" stroke={i % 3 === 0 ? 'var(--acc)' : 'rgba(255,255,255,0.14)'} strokeWidth="1" />
        : <motion.path key={i} d={`M0 ${40 + i * 40} C 300 ${i * 40}, 900 ${100 + i * 40}, 1200 ${40 + i * 40}`} fill="none" stroke={i % 3 === 0 ? 'var(--acc)' : 'rgba(255,255,255,0.14)'} strokeWidth="1" animate={{ opacity: [0.4, 0.85, 0.4] }} transition={{ duration: 6 + i * 0.4, repeat: Infinity, ease: 'easeInOut', delay: i * 0.2 }} />))}</svg>{seam}</>);
    case 'aurora-grid':
    default:
      return (<>{grid(44, 0.045)}{full && <div aria-hidden className="pointer-events-none absolute left-1/2 top-0 h-[36rem] w-[52rem] -translate-x-1/2" style={{ background: 'radial-gradient(ellipse at center, color-mix(in srgb, var(--acc) 22%, transparent), transparent 68%)' }} />}<Orb color="var(--acc)" style={{ top: '-6rem', left: '-4rem', width: '28rem', height: '28rem', opacity: glow }} still={still} /><Orb color="var(--acc2)" style={{ top: '3rem', right: '-6rem', width: '24rem', height: '24rem', opacity: glow }} delay={-6} still={still} />{seam}</>);
  }
}

/* ── Hero background shell — delegates to the strategy's Backdrop motif, with
 *  ambient motion gated by the concept's Motion Fit (never universal). ─── */
function HeroBg({ full = false, plan, brief }: { full?: boolean; plan: WebBuildLayoutPlan; brief: WebBuildBrief }) {
  const animate = motionAmbientAllowed(deriveMotionFit(brief, deriveWebBuildArtIdentity(brief), plan));
  return <Backdrop motif={plan.visualSystem.background} accent={plan.visualSystem.accentMode} full={full} animate={animate} />;
}

const HeroTitle = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => (
  <motion.h1 initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
    className={`font-semibold text-white ${className}`} style={{ fontFamily: 'var(--hf)', letterSpacing: 'var(--tr)' }}>{children}</motion.h1>
);

interface HeroProps { s: S; brief: WebBuildBrief; plan: WebBuildLayoutPlan }

/* ── Art-identity hero proof rail — concept-specific proof chips under the hero
 * CTA, plus a subtle identity eyebrow. Derives the shared art identity from the
 * brief, so it reads the SAME decision the generated files use. Renders nothing
 * when there is no proof to show (old builds stay clean). No debug labels. */
function HeroProof({ brief }: { brief: WebBuildBrief }) {
  const art = deriveWebBuildArtIdentity(brief);
  const chips = art.proofRules.slice(0, 4);
  const identity = art.signature ? art.signature.split(/[—–]/)[0].trim() : '';
  if (!chips.length && !identity) return null;
  return (
    <div>
      {identity && (
        <div className={`mb-2.5 text-[10px] font-medium text-white/45 ${art.eyebrowTone || 'tracking-wide'}`}>{identity}</div>
      )}
      {chips.length > 0 && (
        <ul className="flex flex-wrap items-center gap-2">
          {chips.map((c, i) => (
            <li key={i} className={`inline-flex items-center gap-1.5 border border-[color:var(--bd)] bg-white/[0.03] px-2.5 py-1 text-[11px] text-slate-300 ${art.proofTone}`}>
              <span className="h-1 w-1 rounded-full" style={{ background: 'var(--acc)' }} />{c}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

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
      <HeroBg full plan={plan} brief={brief} />
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
      <HeroBg plan={plan} brief={brief} />
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
      <HeroBg plan={plan} brief={brief} />
      <div className="relative mx-auto max-w-6xl px-6 py-20 sm:py-28">
        <div className="ml-auto w-full max-w-3xl opacity-95 lg:w-[62%]"><VisualModule kind={plan.primaryVisualModule} labels={t.moduleLabels} /></div>
        <div className="relative -mt-24 max-w-xl rounded-3xl border border-[color:var(--bd)] bg-black/50 p-8 backdrop-blur-md lg:-mt-40">
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
      <HeroBg full plan={plan} brief={brief} />
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
      <HeroBg plan={plan} brief={brief} />
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
      <HeroBg plan={plan} brief={brief} />
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
        <motion.div animate={{ y: [0, -10, 0] }} transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }} className="rounded-3xl border border-[color:var(--bd)] bg-[var(--sf)] p-3 shadow-2xl shadow-black/40">
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
      <HeroBg plan={plan} brief={brief} />
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
      <HeroBg plan={plan} brief={brief} />
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
      <HeroBg full plan={plan} brief={brief} />
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
      <HeroBg plan={plan} brief={brief} />
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
      <HeroBg full plan={plan} brief={brief} />
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
interface VarProps { s: S; plan: WebBuildLayoutPlan; index: number; art: WebBuildArtIdentity }

function FeatureGrid({ s, art }: VarProps) {
  const items = bulletsOf(s).slice(0, 6);
  return (
    <div className="mx-auto max-w-6xl px-6">
      <H2>{heading(s)}</H2>
      {s.sub && <p className="mx-auto mt-3 max-w-2xl text-center text-slate-400">{s.sub}</p>}
      <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((b, i) => (
          <Reveal key={i} i={i}>
            <div className={`rounded-[var(--pr)] border border-[color:var(--bd)] bg-[var(--sf)] p-6 transition hover:-translate-y-1 hover:border-white/20 ${art.cardTone}`} style={art.mode === 'archive' ? { borderLeftColor: 'var(--acc)' } : undefined}><div className="mb-4 h-11 w-11 rounded-xl ring-1 ring-white/10" style={{ background: 'linear-gradient(135deg, color-mix(in srgb, var(--acc) 45%, transparent), color-mix(in srgb, var(--acc2) 22%, transparent))' }} /><p className="text-[15px] font-semibold leading-snug text-white">{b}</p></div>
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

function ProofStrip({ s, art }: VarProps) {
  // Honest proof: real section copy or structural labels — never fabricated
  // ratings / counts / uptime. Rendered as labelled proof cards, not big numbers.
  const items = safeProofItems(s, art, 4);
  return (
    <div className="mx-auto max-w-5xl px-6">
      <H2>{heading(s)}</H2>
      {s.sub && <p className="mx-auto mt-3 max-w-2xl text-center text-slate-400">{s.sub}</p>}
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((b, i) => renderProofCard(b, i, art))}
      </div>
    </div>
  );
}

function DashboardData({ s, art }: VarProps) {
  const labels = bulletsOf(s).slice(0, 4);
  return (
    <div className="mx-auto grid max-w-6xl items-center gap-10 px-6 lg:grid-cols-[1fr_1.15fr]">
      <div>
        <H2 align="left">{heading(s)}</H2>
        {s.sub && <p className="mt-4 max-w-md text-base leading-relaxed text-slate-300">{s.sub}</p>}
        <ul className="mt-6 grid grid-cols-2 gap-3">
          {labels.map((b, i) => (
            <li key={i} className={`rounded-xl border border-[color:var(--bd)] bg-[var(--sf)] px-4 py-3 text-[13px] text-slate-200 ${art.cardTone}`}>{b}</li>
          ))}
        </ul>
      </div>
      <VisualModule kind="data-dashboard" labels={s.bullets} />
    </div>
  );
}

function CatalogGrid({ s, art }: VarProps) {
  const tiles = bulletsOf(s).slice(0, 6);
  return (
    <div className="mx-auto max-w-6xl px-6">
      <H2>{heading(s)}</H2>
      <div className="mt-10 grid grid-cols-2 gap-4 sm:grid-cols-3">
        {tiles.map((b, i) => (
          <Reveal key={i} i={i}>
            <figure className={`group relative overflow-hidden rounded-[var(--pr)] border border-[color:var(--bd)] ${art.cardTone} ${i % 5 === 0 ? 'sm:col-span-2' : ''}`}>
              <div className={`relative w-full transition duration-500 group-hover:scale-[1.04] ${art.mediaTone}`} style={{ background: i % 3 === 0 ? 'linear-gradient(135deg, color-mix(in srgb, var(--acc) 26%, transparent), color-mix(in srgb, var(--acc2) 14%, transparent))' : 'linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0.01))' }}>
                <CardDetail mode={art.mode} i={i} />
              </div>
              <figcaption className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/70 to-transparent p-3 text-sm font-medium text-white">{b}</figcaption>
            </figure>
          </Reveal>
        ))}
      </div>
    </div>
  );
}

function CollectionArchive({ s, art }: VarProps) {
  const rows = bulletsOf(s).slice(0, 6);
  return (
    <div className="mx-auto max-w-4xl px-6">
      <H2 align="left">{heading(s)}</H2>
      <div className="mt-8 divide-y divide-white/10 border-y border-[color:var(--bd)]">
        {rows.map((b, i) => (
          <Reveal key={i} i={i}>
            <div className="group flex items-center gap-5 py-5">
              <span className="w-8 text-sm tabular-nums text-slate-500">{String(i + 1).padStart(2, '0')}</span>
              <span className={`relative h-12 w-16 shrink-0 overflow-hidden rounded-md border border-[color:var(--bd)] ${art.cardTone}`} style={{ background: 'linear-gradient(135deg, color-mix(in srgb, var(--acc) 22%, transparent), transparent)' }}>
                <CardDetail mode={art.mode} i={i} />
              </span>
              <span className="flex-1 text-[15px] font-medium text-white">{b}</span>
              <span className="text-slate-500 transition group-hover:translate-x-1">→</span>
            </div>
          </Reveal>
        ))}
      </div>
    </div>
  );
}

function ProcessTimeline({ s, art }: VarProps) {
  const steps = bulletsOf(s).slice(0, 4);
  return (
    <div className="mx-auto max-w-6xl px-6">
      <H2>{heading(s)}</H2>
      <ol className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((b, i) => (
          <Reveal key={i} i={i}>
            <li className={`relative rounded-[var(--pr)] border border-[color:var(--bd)] bg-[var(--sf)] p-5 ${art.cardTone}`}>
              <span className="text-sm font-semibold" style={{ color: 'var(--acc)' }}>0{i + 1}</span>
              <p className="mt-2 text-[15px] font-medium text-white">{b}</p>
            </li>
          </Reveal>
        ))}
      </ol>
    </div>
  );
}

function QuoteStory({ s, art }: VarProps) {
  // A proof/local-proof/trust-proof section is NOT a testimonial wall — render
  // honest proof cards instead of fake customer quotes.
  if (isProofSection(s) && !isTestimonialSection(s)) {
    const items = safeProofItems(s, art, 4);
    return (
      <div className="mx-auto max-w-5xl px-6">
        <H2>{heading(s)}</H2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {items.map((b, i) => renderProofCard(b, i, art))}
        </div>
      </div>
    );
  }
  // Otherwise render the section's own copy as an editorial statement. No fake
  // avatar/person is attached — attribution is the section label only, so a
  // generic content bullet is never presented as a real customer testimonial.
  const quotes = (s.bullets?.length ? s.bullets : [s.sub || s.name]).slice(0, 2);
  return (
    <div className="mx-auto max-w-4xl px-6">
      <div className="space-y-10">
        {quotes.map((b, i) => (
          <Reveal key={i} i={i}>
            <blockquote className="border-l-2 pl-6" style={{ borderColor: 'var(--acc)' }}>
              <p className="text-xl font-medium leading-relaxed text-white sm:text-2xl" style={{ fontFamily: 'var(--hf)' }}>“{b}”</p>
              <footer className="mt-4 text-sm text-slate-400">{heading(s)}</footer>
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

function PricingMembership({ s, art }: VarProps) {
  const tiers = (s.bullets?.length ? s.bullets : ['Başlangıç', 'Pro', 'Kurumsal']).slice(0, 3);
  return (
    <div className="mx-auto max-w-5xl px-6">
      <H2>{heading(s)}</H2>
      <div className="mt-10 grid gap-5 sm:grid-cols-3">
        {tiers.map((b, i) => {
          // Show a price ONLY when the section copy actually contains one — never
          // a fabricated monthly figure. Otherwise the card leads with its CTA.
          const price = explicitPrice(b) || explicitPrice(s.headline);
          return (
            <div key={i} className={`rounded-[var(--pr)] border p-6 ${art.cardTone}`} style={i === 1 ? { borderColor: 'color-mix(in srgb, var(--acc) 40%, transparent)', background: 'color-mix(in srgb, var(--acc) 7%, transparent)' } : { borderColor: 'rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)' }}>
              <p className="text-sm font-medium text-slate-300">{b}</p>
              {price
                ? <div className="mt-3 text-3xl font-semibold text-white">{price}</div>
                : <div className="mt-3 text-lg font-medium text-slate-200">{s.cta || 'Detaylı bilgi'}</div>}
              <div className={`mt-5 rounded-lg py-2 text-center text-sm font-semibold ${i === 1 ? 'text-white' : 'border border-white/15 text-slate-200'}`} style={i === 1 ? { background: 'var(--acc)' } : undefined}>{s.cta || 'İletişime geç'}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* — Filter/search surface: a real search bar + filter chips + result rows built
 *  from the section's own facet copy. No fabricated result counts. — */
function FilterSearch({ s, art }: VarProps) {
  const facets = bulletsOf(s).slice(0, 6);
  const rows = facets.slice(0, 4);
  return (
    <div className="mx-auto max-w-5xl px-6">
      <H2 align="left">{heading(s)}</H2>
      <div className={`mt-8 rounded-[var(--pr)] border border-[color:var(--bd)] bg-[var(--sf)] p-4 sm:p-5 ${art.cardTone}`}>
        <div className="flex items-center gap-3 rounded-lg border border-[color:var(--bd)] bg-black/20 px-3.5 py-2.5">
          <span className="text-slate-400" aria-hidden>⌕</span>
          <span className="text-sm text-slate-500">{s.sub || heading(s)}</span>
          <span className="ml-auto rounded-md px-2.5 py-1 text-xs font-medium text-white" style={{ background: 'var(--acc)' }}>{s.cta || 'Ara'}</span>
        </div>
        {facets.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {facets.map((f, i) => (
              <span key={i} className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--bd)] bg-white/[0.03] px-3 py-1 text-xs text-slate-300">
                <span className="h-1 w-1 rounded-full" style={{ background: 'var(--acc)' }} />{f}
              </span>
            ))}
          </div>
        )}
        {rows.length > 0 && (
          <div className="mt-5 space-y-2">
            {rows.map((f, i) => (
              <div key={i} className="flex items-center gap-3 rounded-lg border border-[color:var(--bd)] bg-[var(--sf)] px-3 py-2.5">
                <span className="h-8 w-8 shrink-0 rounded-md border border-[color:var(--bd)]" style={{ background: 'linear-gradient(135deg, color-mix(in srgb, var(--acc) 20%, transparent), transparent)' }} />
                <span className="flex-1 text-sm text-slate-200">{f}</span>
                <span className="text-slate-500">→</span>
              </div>
            ))}
          </div>
        )}
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

function FaqCta({ s, art }: VarProps) {
  const appt = /contact|book|appointment|randevu|form|reservation|rezervasyon|apply|başvuru/.test(`${s.id} ${s.name}`.toLowerCase());
  const isFaq = /faq|sıkça|soru/.test(`${s.id} ${s.name}`.toLowerCase());
  if (isFaq && s.bullets?.length) {
    return (
      <div className="mx-auto max-w-3xl px-6">
        <H2 align="left">{heading(s)}</H2>
        <div className="mt-6 space-y-3">
          {s.bullets.slice(0, 6).map((b, i) => <div key={i} className={`rounded-xl border border-[color:var(--bd)] bg-[var(--sf)] p-4 text-[15px] font-medium text-white ${art.cardTone}`}>{b}</div>)}
        </div>
      </div>
    );
  }
  return (
    <div className="relative isolate mx-auto max-w-2xl px-6" id="contact">
      <div className="rounded-3xl border border-[color:var(--bd)] bg-[var(--sf)] p-10 text-center backdrop-blur">
        <H2>{heading(s)}</H2>
        {s.sub && <p className="mt-3 text-slate-300">{s.sub}</p>}
        {appt ? (
          <div className="mx-auto mt-7 max-w-sm space-y-3 text-left">
            <div className="h-11 rounded-lg border border-[color:var(--bd)] bg-[var(--sf)]" />
            <div className="h-11 rounded-lg border border-[color:var(--bd)] bg-[var(--sf)]" />
            <div className="flex h-11 items-center justify-center rounded-lg text-sm font-semibold text-white" style={{ background: 'var(--acc)' }}>{s.cta || heading(s)}</div>
          </div>
        ) : (s.cta && <div className="mt-7"><PrimaryCta>{s.cta}</PrimaryCta></div>)}
      </div>
    </div>
  );
}

function Comparison({ s, art }: VarProps) {
  const reduce = useReducedMotion();
  return (
    <div className="mx-auto max-w-5xl px-6">
      <H2>{heading(s)}</H2>
      <div className="relative mt-10 grid gap-5 sm:grid-cols-2">
        <div className={`relative overflow-hidden rounded-[var(--pr)] border border-[color:var(--bd)] ${art.cardTone}`}><span className="absolute left-3 top-3 z-10 rounded-full bg-black/50 px-2.5 py-1 text-xs text-slate-300">Öncesi</span><div className={`relative ${art.mediaTone}`} style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.05), rgba(255,255,255,0.01))' }}><CardDetail mode={art.mode} i={0} /></div></div>
        <div className={`relative overflow-hidden rounded-[var(--pr)] border ring-1 ${art.cardTone}`} style={{ borderColor: 'color-mix(in srgb, var(--acc) 40%, transparent)' }}><span className="absolute left-3 top-3 z-10 rounded-full px-2.5 py-1 text-xs text-white" style={{ background: 'var(--acc)' }}>Sonrası</span><div className={`relative ${art.mediaTone}`} style={{ background: 'linear-gradient(135deg, color-mix(in srgb, var(--acc) 22%, transparent), color-mix(in srgb, var(--acc2) 12%, transparent))' }}><CardDetail mode={art.mode} i={1} /></div></div>
        {!reduce && (
          <motion.div
            aria-hidden className="pointer-events-none absolute inset-y-0 left-1/2 hidden w-px -translate-x-1/2 sm:block"
            style={{ background: 'linear-gradient(180deg, transparent, var(--acc), transparent)' }}
            animate={{ opacity: [0.3, 0.9, 0.3] }} transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
          />
        )}
      </div>
    </div>
  );
}

function Footer({ s }: { s: S }) {
  return (
    <footer className="border-t border-[color:var(--bd)] px-6 py-10">
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
  'filter-search': (p) => <FilterSearch {...p} />,
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
  // hero composition, per-section variant, visual module, rhythm AND the visual
  // system (backdrop construction, surface treatment, panel shape, accent mode).
  const plan = deriveLayoutPlan(brief, sectionItems.map((s) => ({ id: s.id, name: s.name })));
  // The SAME art render identity the file synthesizer uses — so preview and
  // generated files apply the same concept-specific surface / proof language.
  const art = deriveWebBuildArtIdentity(brief);
  const variantOf = (id: string): SectionVariant => plan.sectionVariants[id] || 'feature-grid';
  const vt = visualSystemTokens(plan.visualSystem);

  const rootStyle = {
    background: ds.bg,
    fontFamily: ds.bodyFont,
    '--acc': ds.accent,
    '--acc2': plan.visualSystem.accentMode === 'mono' ? ds.accent : ds.accent2,
    '--hf': ds.headingFont,
    '--tr': ds.tracking,
    '--rad': ds.radius,
    // Visual-system surface tokens consumed by every card/panel/module.
    '--sf': vt.surfaceBg,
    '--sfh': vt.surfaceHover,
    '--bd': vt.border,
    '--pr': vt.radius,
  } as CSSProperties;

  const banded = plan.rhythm === 'alternating' || plan.rhythm === 'editorial';
  let contentIdx = 0;

  return (
    <div className="text-slate-200 antialiased" style={rootStyle}>
      {sectionItems.map((s) => {
        const kind = plan.sections.find((p) => p.id === s.id)?.kind;
        if (kind === 'hero') {
          const Hero = HEROES[plan.heroComposition] || HEROES['split-editorial'];
          return (
            <div key={s.id}>
              <Hero s={s} brief={brief} plan={plan} />
              {/* Concept-specific proof rail, directly under the hero. */}
              <div className="relative z-10 mx-auto max-w-6xl px-6 pb-6">
                <HeroProof brief={brief} />
              </div>
            </div>
          );
        }
        if (kind === 'footer') return <Footer key={s.id} s={s} />;
        const variant = variantOf(s.id);
        const Render = VARIANTS[variant] || VARIANTS['feature-grid'];
        const i = contentIdx++;
        const band = banded && i % 2 === 1;
        return (
          <section key={s.id} className={`relative ${PAD[plan.contentDensity]}`} style={band ? { background: 'rgba(255,255,255,0.015)' } : undefined}>
            {Render({ s, plan, index: i, art })}
          </section>
        );
      })}
    </div>
  );
}
