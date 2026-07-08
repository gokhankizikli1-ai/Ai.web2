import { Component, Fragment, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode, type ErrorInfo, type CSSProperties, type MouseEvent } from 'react';
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
import {
  anchorId, deriveInteraction, ctaTargetForSection, pickNavSections,
  type InteractionContext,
} from '@/lib/webBuildInteraction';
import {
  deriveInteractionContract,
  type InteractionContract, type InteractionAction, type InteractionActionType,
} from '@/lib/webBuildInteractionContract';
// Type-only import (erased at build) — Phase 5's data-only Visual Asset Plan the
// Preview consumes with CSS/SVG. Never pulls agent logic into the preview bundle.
import type { VisualAssetPlan, HeroVisualType } from '@/lib/webBuildAgents';

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

/* ── Per-section render isolation ─────────────────────────────────────────
 * A single failing section renderer must NEVER take down the whole preview.
 * This boundary contains a section-level render throw to a compact, honest card
 * (no fake data) while the page shell, nav and every OTHER section stay usable.
 * With every section wrapped, the global drawer boundary only ever catches
 * unexpected root-level failures — not the normal outcome. It renders its
 * children with no extra DOM wrapper, so section `id` anchors/scroll are intact. */
class PreviewSectionErrorBoundary extends Component<{ label?: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (typeof console !== 'undefined') console.error('WebBuildPreview section failed', this.props.label, error, info);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="mx-auto max-w-3xl px-6 py-8">
        <div className="rounded-[var(--pr)] border border-[color:var(--bd)] bg-[var(--sf)] px-4 py-6 text-center">
          <p className="text-[13px] font-medium text-white">Section preview unavailable</p>
          {this.props.label && <p className="mt-1 text-[12px] text-slate-400">{this.props.label}</p>}
        </div>
      </div>
    );
  }
}

const bulletsOf = (s: S) => (s.bullets?.length ? s.bullets : [s.sub || s.purpose || s.name].filter(Boolean));
const heading = (s: S) => s.headline || s.name;
/** Trim + de-dupe a set of copy lines (drops blanks). Used to build honest modal /
 *  chat-demo content from a section's OWN real copy — never fabricated. */
const cleanLines = (xs: (string | undefined)[]): string[] => Array.from(new Set(xs.map((x) => (x || '').trim()).filter(Boolean)));

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

/* ── Preview host-app isolation ──────────────────────────────────────────
 * The preview renders INSIDE the Korvix app. A raw <a href="/pricing"> (or a
 * route-like "how-it-works") would navigate the host app out of the builder.
 * resolvePreviewTargetId maps any internal/route-like href to an existing
 * preview section id so a delegated root handler can scroll to it and never let
 * the click reach the host router. Returns 'top' for top, or null when there is
 * no matching section (the handler then does nothing — it never navigates). */
const PREVIEW_LABEL_TARGETS: Record<string, string[]> = {
  pricing: ['pricing', 'pricing-enroll', 'pricing-cart-cta', 'quote-cta', 'request-quote'],
  contact: ['contact', 'quote-cta', 'request-quote', 'researcher-access', 'reservation'],
  'how-it-works': ['process', 'workflow', 'agenda', 'curriculum', 'research-filters'],
  process: ['process', 'workflow', 'agenda', 'curriculum', 'research-filters'],
  demo: ['product-demo'],
  projects: ['project-gallery', 'selected-work'],
  collection: ['collection-index'],
  collections: ['collection-index'],
  research: ['research-filters', 'researcher-access'],
  menu: ['menu'],
  reservation: ['reservation'],
};

function resolvePreviewTargetId(href: string, sectionItems: S[], ctx: InteractionContext): string | null {
  const ids = sectionItems.map((s) => anchorId(s.id));
  const findByFragment = (frag: string) =>
    ids.find((id) => id === frag || id.startsWith(`${frag}-`) || id.endsWith(`-${frag}`) || id.includes(frag)) || '';

  const key = anchorId((href || '').trim().replace(/^#/, '').replace(/^\/+/, '').replace(/[/?#].*$/, ''));
  if (!key || key === 'top') return 'top';
  if (ids.includes(key)) return key;

  const token = findByFragment(key);
  if (token) return token;

  for (const pref of PREVIEW_LABEL_TARGETS[key] || []) {
    const hit = findByFragment(pref);
    if (hit) return hit;
  }

  const strip = (h?: string) => (h || '').replace(/^#/, '');
  const primary = strip(ctx.primaryTarget);
  if (primary && ids.includes(primary)) return primary;
  const conversion = strip(ctx.conversionTarget);
  if (conversion && ids.includes(conversion)) return conversion;
  return null;
}

/* ── Preview page model (router-free, host-URL never changes) ────────────
 * Mirrors the generated App's page illusion but stays entirely local to the
 * preview (no import from generated code): Home + one focused page per nav
 * section. Ids/labels come from the real sections, so no fake/empty pages. */
interface PreviewPage { id: string; label: string; sectionIds: string[] }

function buildPreviewPages(
  sectionItems: S[], plan: WebBuildLayoutPlan, nav: Array<{ id: string; name: string }>, ctx: InteractionContext,
): PreviewPage[] {
  const kindOf = (rawId: string) => plan.sections.find((p) => p.id === rawId)?.kind;
  const meta = sectionItems.map((s) => ({ id: anchorId(s.id), kind: kindOf(s.id) }));
  const heroM = meta.find((m) => m.kind === 'hero');
  const footerM = meta.find((m) => m.kind === 'footer');
  const content = meta.filter((m) => m.kind !== 'hero' && m.kind !== 'footer');
  const exists = (id: string) => meta.some((m) => m.id === id);
  const conv = (ctx.conversionTarget || '').replace(/^#/, '');
  const push = (arr: string[], v?: string) => { if (v && exists(v) && !arr.includes(v)) arr.push(v); };

  // Home: hero + first 2–3 content sections + conversion section + footer.
  const homeIds: string[] = [];
  push(homeIds, heroM?.id);
  content.slice(0, 3).forEach((m) => push(homeIds, m.id));
  push(homeIds, conv);
  push(homeIds, footerM?.id);

  // One focused page per nav section: leader + up-to-2 adjacent content + footer.
  const pages: PreviewPage[] = [{ id: 'home', label: 'Home', sectionIds: homeIds }];
  nav.forEach((n) => {
    const lid = anchorId(n.id);
    const idx = content.findIndex((m) => m.id === lid);
    if (idx < 0) return;
    const group = content.slice(idx, idx + 3).map((m) => m.id);
    if (footerM) group.push(footerM.id);
    if (group.some((id) => content.some((m) => m.id === id))) {
      pages.push({ id: lid, label: n.name || lid, sectionIds: group });
    }
  });
  return pages;
}

/* ── Concept-specific internal card detail ───────────────────────────────
 * Cards/media must never be blank rectangles. CardDetail overlays abstract,
 * concept-specific linework (archive metadata rules + stamp, landscaping terrain
 * curves + swatches, marketplace product structure, industrial spec grid,
 * portfolio crop frame, SaaS data surface). It is pure geometry — no fake text,
 * IDs, names, prices or metrics. */
function CardDetail({ mode }: { mode: ArtRenderMode }): ReactElement {
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

/* CTAs render as real anchors when a target is supplied, so preview buttons
 *  actually scroll (native smooth scroll) — mirroring the generated files. */
const PrimaryCta = ({ children, href }: { children: React.ReactNode; href?: string }) => {
  const cls = 'rounded-xl px-6 py-3 text-sm font-semibold text-white shadow-lg';
  const style = { background: 'var(--acc)', boxShadow: '0 10px 30px -10px var(--acc)' };
  return href ? <a href={href} className={cls} style={style}>{children}</a> : <span className={cls} style={style}>{children}</span>;
};
const GhostCta = ({ children, href }: { children: React.ReactNode; href?: string }) => {
  const cls = 'rounded-xl border border-white/15 px-6 py-3 text-sm font-medium text-slate-200';
  return href ? <a href={href} className={cls}>{children}</a> : <span className={cls}>{children}</span>;
};

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

interface HeroProps { s: S; brief: WebBuildBrief; plan: WebBuildLayoutPlan; ctx: InteractionContext }

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

function heroTexts(s: S, brief: WebBuildBrief, ctx: InteractionContext) {
  return {
    title: s.headline || s.copyPreview?.split(/[.!?\n]/)[0] || brief.type || '',
    eyebrow: brief.type || s.bullets?.[0],
    sub: s.sub || brief.goal,
    cta: s.cta,
    secondary: s.bullets?.[1],
    proof: s.bullets?.[2],
    moduleLabels: s.bullets,
    // Concept-relevant scroll targets for the hero CTAs (never dead).
    ctaHref: ctx.primaryTarget,
    secondaryHref: ctx.secondaryTarget,
  };
}

/* — Centered (kept as a fallback; the plan rarely selects it) — */
function HeroCentered({ s, brief, plan, ctx }: HeroProps) {
  const t = heroTexts(s, brief, ctx);
  return (
    <section className="relative isolate overflow-hidden">
      <HeroBg full plan={plan} brief={brief} />
      <div className="relative mx-auto max-w-3xl px-6 py-24 text-center sm:py-28">
        {t.eyebrow && <Eyebrow>{t.eyebrow}</Eyebrow>}
        <HeroTitle className="mt-5 text-3xl sm:text-5xl">{t.title}</HeroTitle>
        {t.sub && <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-slate-300 sm:text-lg">{t.sub}</p>}
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          {t.cta && <PrimaryCta href={t.ctaHref}>{t.cta}</PrimaryCta>}
          {t.secondary && <GhostCta href={t.secondaryHref}>{t.secondary}</GhostCta>}
        </div>
        <div className="mx-auto mt-12 max-w-lg"><VisualModule kind={plan.primaryVisualModule} labels={t.moduleLabels} compact /></div>
      </div>
    </section>
  );
}

/* — Split editorial: left copy, right module — */
function HeroSplit({ s, brief, plan, ctx }: HeroProps) {
  const t = heroTexts(s, brief, ctx);
  return (
    <section className="relative isolate overflow-hidden">
      <HeroBg plan={plan} brief={brief} />
      <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-6 py-20 sm:py-24 lg:grid-cols-2">
        <div>
          {t.eyebrow && <Eyebrow>{t.eyebrow}</Eyebrow>}
          <HeroTitle className="mt-5 text-3xl sm:text-5xl">{t.title}</HeroTitle>
          {t.sub && <p className="mt-5 max-w-xl text-base leading-relaxed text-slate-300 sm:text-lg">{t.sub}</p>}
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            {t.cta && <PrimaryCta href={t.ctaHref}>{t.cta}</PrimaryCta>}
            {t.secondary && <GhostCta href={t.secondaryHref}>{t.secondary}</GhostCta>}
          </div>
          {t.proof && <p className="mt-6 text-xs text-slate-400">{t.proof}</p>}
        </div>
        <VisualModule kind={plan.primaryVisualModule} labels={t.moduleLabels} />
      </div>
    </section>
  );
}

/* — Asymmetric visual: oversized offset module, overlapping copy — */
function HeroAsymmetric({ s, brief, plan, ctx }: HeroProps) {
  const t = heroTexts(s, brief, ctx);
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
            {t.cta && <PrimaryCta href={t.ctaHref}>{t.cta}</PrimaryCta>}
            {t.secondary && <GhostCta href={t.secondaryHref}>{t.secondary}</GhostCta>}
          </div>
        </div>
      </div>
    </section>
  );
}

/* — Dashboard/product: centered copy, then a wide product panel — */
function HeroDashboard({ s, brief, plan, ctx }: HeroProps) {
  const t = heroTexts(s, brief, ctx);
  return (
    <section className="relative isolate overflow-hidden">
      <HeroBg full plan={plan} brief={brief} />
      <div className="relative mx-auto max-w-5xl px-6 py-20 text-center sm:py-24">
        {t.eyebrow && <Eyebrow>{t.eyebrow}</Eyebrow>}
        <HeroTitle className="mx-auto mt-5 max-w-3xl text-3xl sm:text-5xl">{t.title}</HeroTitle>
        {t.sub && <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-slate-300 sm:text-lg">{t.sub}</p>}
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          {t.cta && <PrimaryCta href={t.ctaHref}>{t.cta}</PrimaryCta>}
          {t.secondary && <GhostCta href={t.secondaryHref}>{t.secondary}</GhostCta>}
        </div>
        <div className="mt-14"><VisualModule kind={plan.primaryVisualModule} labels={t.moduleLabels} /></div>
      </div>
    </section>
  );
}

/* — Immersive full-bleed: module as backdrop, copy bottom-left — */
function HeroImmersive({ s, brief, plan, ctx }: HeroProps) {
  const t = heroTexts(s, brief, ctx);
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
            {t.cta && <PrimaryCta href={t.ctaHref}>{t.cta}</PrimaryCta>}
            {t.secondary && <GhostCta href={t.secondaryHref}>{t.secondary}</GhostCta>}
          </div>
        </div>
      </div>
    </section>
  );
}

/* — Membership/application: copy left, elevated pass/access card right — */
function HeroMembership({ s, brief, plan, ctx }: HeroProps) {
  const t = heroTexts(s, brief, ctx);
  return (
    <section className="relative isolate overflow-hidden">
      <HeroBg plan={plan} brief={brief} />
      <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-6 py-20 sm:py-24 lg:grid-cols-[1.1fr_0.9fr]">
        <div>
          {t.eyebrow && <Eyebrow>{t.eyebrow}</Eyebrow>}
          <HeroTitle className="mt-5 text-3xl sm:text-5xl">{t.title}</HeroTitle>
          {t.sub && <p className="mt-5 max-w-xl text-base leading-relaxed text-slate-300 sm:text-lg">{t.sub}</p>}
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            {t.cta && <PrimaryCta href={t.ctaHref}>{t.cta}</PrimaryCta>}
            {t.secondary && <GhostCta href={t.secondaryHref}>{t.secondary}</GhostCta>}
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
function HeroCatalog({ s, brief, plan, ctx }: HeroProps) {
  const t = heroTexts(s, brief, ctx);
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
          <div className="flex shrink-0 gap-3">{t.cta && <PrimaryCta href={t.ctaHref}>{t.cta}</PrimaryCta>}{t.secondary && <GhostCta href={t.secondaryHref}>{t.secondary}</GhostCta>}</div>
        </div>
        <div className="mt-10"><VisualModule kind={plan.primaryVisualModule} labels={t.moduleLabels} /></div>
      </div>
    </section>
  );
}

/* — Data/map: copy left, data module right (utility density) — */
function HeroData({ s, brief, plan, ctx }: HeroProps) {
  const t = heroTexts(s, brief, ctx);
  return (
    <section className="relative isolate overflow-hidden">
      <HeroBg plan={plan} brief={brief} />
      <div className="relative mx-auto grid max-w-6xl items-center gap-10 px-6 py-18 sm:py-20 lg:grid-cols-[0.9fr_1.1fr]">
        <div>
          {t.eyebrow && <Eyebrow>{t.eyebrow}</Eyebrow>}
          <HeroTitle className="mt-5 text-3xl sm:text-5xl">{t.title}</HeroTitle>
          {t.sub && <p className="mt-5 max-w-xl text-base leading-relaxed text-slate-300">{t.sub}</p>}
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            {t.cta && <PrimaryCta href={t.ctaHref}>{t.cta}</PrimaryCta>}
            {t.secondary && <GhostCta href={t.secondaryHref}>{t.secondary}</GhostCta>}
          </div>
        </div>
        <VisualModule kind={plan.primaryVisualModule} labels={t.moduleLabels} />
      </div>
    </section>
  );
}

/* — Luxury service: spacious, serif, minimal, thin editorial band — */
function HeroLuxury({ s, brief, plan, ctx }: HeroProps) {
  const t = heroTexts(s, brief, ctx);
  return (
    <section className="relative isolate overflow-hidden">
      <HeroBg full plan={plan} brief={brief} />
      <div className="relative mx-auto max-w-3xl px-6 py-28 text-center sm:py-36">
        {t.eyebrow && <span className="text-[11px] uppercase tracking-[0.35em] text-white/60">{t.eyebrow}</span>}
        <HeroTitle className="mt-6 text-4xl leading-[1.1] sm:text-6xl">{t.title}</HeroTitle>
        {t.sub && <p className="mx-auto mt-7 max-w-xl text-base leading-relaxed text-slate-300 sm:text-lg">{t.sub}</p>}
        <div className="mt-10 flex items-center justify-center gap-4">
          {t.cta && <a href={t.ctaHref} className="border-b border-white/40 pb-1 text-sm font-medium tracking-wide text-white">{t.cta} →</a>}
        </div>
        <div className="mx-auto mt-14 max-w-md"><VisualModule kind={plan.primaryVisualModule} labels={t.moduleLabels} compact /></div>
      </div>
    </section>
  );
}

/* — Story editorial: oversized headline left, meta + small module right — */
function HeroStory({ s, brief, plan, ctx }: HeroProps) {
  const t = heroTexts(s, brief, ctx);
  return (
    <section className="relative isolate overflow-hidden">
      <HeroBg plan={plan} brief={brief} />
      <div className="relative mx-auto grid max-w-6xl gap-10 px-6 py-20 sm:py-24 lg:grid-cols-12">
        <div className="lg:col-span-7">
          {t.eyebrow && <Eyebrow>{t.eyebrow}</Eyebrow>}
          <HeroTitle className="mt-5 text-4xl leading-[1.05] sm:text-6xl">{t.title}</HeroTitle>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            {t.cta && <PrimaryCta href={t.ctaHref}>{t.cta}</PrimaryCta>}
            {t.secondary && <GhostCta href={t.secondaryHref}>{t.secondary}</GhostCta>}
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
function HeroEvent({ s, brief, plan, ctx }: HeroProps) {
  const t = heroTexts(s, brief, ctx);
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
        <div className="mt-9 flex items-center justify-center gap-3">{t.cta && <PrimaryCta href={t.ctaHref}>{t.cta}</PrimaryCta>}{t.secondary && <GhostCta href={t.secondaryHref}>{t.secondary}</GhostCta>}</div>
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

/* ── Preview interaction runtime (Phase 2) ───────────────────────────────
 * The strategy's Interaction Contract is turned into REAL in-app behaviour here.
 * Section variants receive an optional runtime so a card / row / chip / CTA can
 * open a chat demo, a detail modal, a lead form, or drive an inline filter —
 * instead of only scrolling. Everything is optional and guarded, so a section
 * renders exactly as before when no contract action applies to it. */
interface PreviewRuntime {
  /** Run a contract action (opens the matching overlay or scrolls). Never throws. */
  run: (action: InteractionAction, section?: S, payload?: { title?: string; lines?: string[] }) => void;
  /** Convenience: open an overlay by action type (used by the Phase 4 demo shells). */
  open: (type: InteractionActionType, section?: S, payload?: { title?: string; lines?: string[] }) => void;
  /** The declared actions for a section id (empty when none / malformed). */
  actionsFor: (rawId: string) => InteractionAction[];
  /** True when a section declares an action of the given type. */
  hasType: (rawId: string, type: InteractionActionType) => boolean;
}

/* ── Section composition variants ─────────────────────────────────────── */
interface VarProps { s: S; plan: WebBuildLayoutPlan; index: number; art: WebBuildArtIdentity; ctx: InteractionContext; rt?: PreviewRuntime }

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

function CatalogGrid({ s, art, rt }: VarProps) {
  const tiles = bulletsOf(s).slice(0, 6);
  // Contract-driven: cards open a detail modal; catalog/inventory can filter inline.
  const detail = rt?.actionsFor(s.id).find((a) => a.type === 'open-detail-modal' || a.type === 'open-record-detail');
  const canFilter = !!rt?.hasType(s.id, 'filter-list');
  const [query, setQuery] = useState('');
  const visible = canFilter && query.trim() ? tiles.filter((t) => t.toLowerCase().includes(query.trim().toLowerCase())) : tiles;
  return (
    <div className="mx-auto max-w-6xl px-6">
      <H2>{heading(s)}</H2>
      {canFilter && (
        <div className="mx-auto mt-6 flex max-w-md items-center gap-2 rounded-[var(--pr)] border border-[color:var(--bd)] bg-[var(--sf)] px-3.5 py-2">
          <span className="text-slate-400" aria-hidden>⌕</span>
          <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={s.sub || 'Filter'} className="w-full bg-transparent text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none" />
        </div>
      )}
      <div className="mt-10 grid grid-cols-2 gap-4 sm:grid-cols-3">
        {visible.map((b, i) => {
          const tile = (
            <figure className={`group relative h-full overflow-hidden rounded-[var(--pr)] border border-[color:var(--bd)] ${art.cardTone} ${i % 5 === 0 ? 'sm:col-span-2' : ''}`}>
              <div className={`relative w-full transition duration-500 group-hover:scale-[1.04] ${art.mediaTone}`} style={{ background: i % 3 === 0 ? 'linear-gradient(135deg, color-mix(in srgb, var(--acc) 26%, transparent), color-mix(in srgb, var(--acc2) 14%, transparent))' : 'linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0.01))' }}>
                <CardDetail mode={art.mode} />
              </div>
              <figcaption className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/70 to-transparent p-3 text-sm font-medium text-white">{b}</figcaption>
            </figure>
          );
          return (
            <Reveal key={i} i={i}>
              {detail && rt
                ? <button type="button" onClick={() => rt.run(detail, s, { title: b, lines: cleanLines([s.sub, ...tiles.filter((x) => x !== b)]) })} className="block w-full text-left">{tile}</button>
                : tile}
            </Reveal>
          );
        })}
      </div>
    </div>
  );
}

function CollectionArchive({ s, art, rt }: VarProps) {
  const rows = bulletsOf(s).slice(0, 6);
  // Contract-driven: rows open a record detail; collections can filter inline.
  const detail = rt?.actionsFor(s.id).find((a) => a.type === 'open-record-detail' || a.type === 'open-detail-modal');
  const canFilter = !!rt?.hasType(s.id, 'filter-list');
  const [query, setQuery] = useState('');
  const visible = canFilter && query.trim() ? rows.filter((r) => r.toLowerCase().includes(query.trim().toLowerCase())) : rows;
  return (
    <div className="mx-auto max-w-4xl px-6">
      <H2 align="left">{heading(s)}</H2>
      {canFilter && (
        <div className="mt-6 flex max-w-md items-center gap-2 rounded-[var(--pr)] border border-[color:var(--bd)] bg-[var(--sf)] px-3.5 py-2">
          <span className="text-slate-400" aria-hidden>⌕</span>
          <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={s.sub || 'Search records'} className="w-full bg-transparent text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none" />
        </div>
      )}
      <div className="mt-8 divide-y divide-white/10 border-y border-[color:var(--bd)]">
        {visible.map((b, i) => {
          const inner = (
            <div className="group flex w-full items-center gap-5 py-5 text-left">
              <span className="w-8 text-sm tabular-nums text-slate-500">{String(i + 1).padStart(2, '0')}</span>
              <span className={`relative h-12 w-16 shrink-0 overflow-hidden rounded-md border border-[color:var(--bd)] ${art.cardTone}`} style={{ background: 'linear-gradient(135deg, color-mix(in srgb, var(--acc) 22%, transparent), transparent)' }}>
                <CardDetail mode={art.mode} />
              </span>
              <span className="flex-1 text-[15px] font-medium text-white">{b}</span>
              <span className="text-slate-500 transition group-hover:translate-x-1">→</span>
            </div>
          );
          return (
            <Reveal key={i} i={i}>
              {detail && rt
                ? <button type="button" onClick={() => rt.run(detail, s, { title: b, lines: cleanLines([s.sub, ...rows.filter((x) => x !== b)]) })} className="block w-full">{inner}</button>
                : inner}
            </Reveal>
          );
        })}
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

function Showcase({ s, plan, ctx }: VarProps) {
  return (
    <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 lg:grid-cols-2">
      <VisualModule kind={plan.primaryVisualModule === 'contour-terrain' ? 'product-showcase' : plan.primaryVisualModule} labels={s.bullets} />
      <div>
        <H2 align="left">{heading(s)}</H2>
        {s.sub && <p className="mt-4 max-w-lg text-base leading-relaxed text-slate-300">{s.sub}</p>}
        {s.cta && <div className="mt-7"><PrimaryCta href={ctaTargetForSection(s.id, ctx)}>{s.cta}</PrimaryCta></div>}
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
function FilterSearch({ s, art, rt }: VarProps) {
  const facets = bulletsOf(s).slice(0, 6);
  // When the preview runtime is present the search bar + chips become LIVE: typing
  // and chip toggles actually filter the result rows (built from real facet copy).
  const interactive = !!rt;
  const [query, setQuery] = useState('');
  const [active, setActive] = useState<string | null>(null);
  const filtered = facets.filter((f) => {
    const q = query.trim().toLowerCase();
    if (q && !f.toLowerCase().includes(q)) return false;
    if (active && f !== active) return false;
    return true;
  });
  const rows = (interactive ? filtered : facets).slice(0, 4);
  return (
    <div className="mx-auto max-w-5xl px-6">
      <H2 align="left">{heading(s)}</H2>
      <div className={`mt-8 rounded-[var(--pr)] border border-[color:var(--bd)] bg-[var(--sf)] p-4 sm:p-5 ${art.cardTone}`}>
        <div className="flex items-center gap-3 rounded-lg border border-[color:var(--bd)] bg-black/20 px-3.5 py-2.5">
          <span className="text-slate-400" aria-hidden>⌕</span>
          {interactive
            ? <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={s.sub || heading(s)} className="w-full bg-transparent text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none" />
            : <span className="text-sm text-slate-500">{s.sub || heading(s)}</span>}
          {interactive && (query || active)
            ? <button type="button" onClick={() => { setQuery(''); setActive(null); }} className="ml-auto rounded-md px-2.5 py-1 text-xs font-medium text-slate-300 transition hover:text-white">Clear</button>
            : <span className="ml-auto rounded-md px-2.5 py-1 text-xs font-medium text-white" style={{ background: 'var(--acc)' }}>{s.cta || 'Ara'}</span>}
        </div>
        {facets.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {facets.map((f, i) => {
              const on = active === f;
              const cls = `inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition ${on ? 'text-white' : 'text-slate-300'}`;
              const style: CSSProperties = on
                ? { borderColor: 'color-mix(in srgb, var(--acc) 55%, transparent)', background: 'color-mix(in srgb, var(--acc) 14%, transparent)' }
                : { borderColor: 'var(--bd)', background: 'rgba(255,255,255,0.03)' };
              const dot = <span className="h-1 w-1 rounded-full" style={{ background: 'var(--acc)' }} />;
              return interactive
                ? <button key={i} type="button" aria-pressed={on} onClick={() => setActive(on ? null : f)} className={cls} style={style}>{dot}{f}</button>
                : <span key={i} className={cls} style={style}>{dot}{f}</span>;
            })}
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

function FaqCta({ s, art, ctx }: VarProps) {
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
    <div className="relative isolate mx-auto max-w-2xl px-6">
      <div className="rounded-3xl border border-[color:var(--bd)] bg-[var(--sf)] p-10 text-center backdrop-blur">
        <H2>{heading(s)}</H2>
        {s.sub && <p className="mt-3 text-slate-300">{s.sub}</p>}
        {appt ? (
          <div className="mx-auto mt-7 max-w-sm space-y-3 text-left">
            <div className="h-11 rounded-lg border border-[color:var(--bd)] bg-[var(--sf)]" />
            <div className="h-11 rounded-lg border border-[color:var(--bd)] bg-[var(--sf)]" />
            <div className="flex h-11 items-center justify-center rounded-lg text-sm font-semibold text-white" style={{ background: 'var(--acc)' }}>{s.cta || heading(s)}</div>
          </div>
        ) : (s.cta && <div className="mt-7"><PrimaryCta href={ctaTargetForSection(s.id, ctx)}>{s.cta}</PrimaryCta></div>)}
      </div>
    </div>
  );
}

function Comparison({ s, art, rt }: VarProps) {
  const reduce = useReducedMotion();
  // Contract-driven: an interactive before/after toggle that emphasises one side.
  const canToggle = !!rt?.hasType(s.id, 'toggle-before-after');
  const [after, setAfter] = useState(false);
  const beforeOn = !canToggle || !after;
  const afterOn = !canToggle || after;
  return (
    <div className="mx-auto max-w-5xl px-6">
      <H2>{heading(s)}</H2>
      {canToggle && (
        <div className="mx-auto mt-6 flex w-fit items-center gap-1 rounded-full border border-[color:var(--bd)] bg-[var(--sf)] p-1 text-xs">
          <button type="button" aria-pressed={!after} onClick={() => setAfter(false)} className={`rounded-full px-3 py-1 font-medium transition ${!after ? 'text-white' : 'text-slate-400'}`} style={!after ? { background: 'var(--acc)' } : undefined}>Öncesi</button>
          <button type="button" aria-pressed={after} onClick={() => setAfter(true)} className={`rounded-full px-3 py-1 font-medium transition ${after ? 'text-white' : 'text-slate-400'}`} style={after ? { background: 'var(--acc)' } : undefined}>Sonrası</button>
        </div>
      )}
      <div className="relative mt-8 grid gap-5 sm:grid-cols-2">
        <div className={`relative overflow-hidden rounded-[var(--pr)] border border-[color:var(--bd)] transition ${art.cardTone} ${beforeOn ? '' : 'opacity-40'}`}><span className="absolute left-3 top-3 z-10 rounded-full bg-black/50 px-2.5 py-1 text-xs text-slate-300">Öncesi</span><div className={`relative ${art.mediaTone}`} style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.05), rgba(255,255,255,0.01))' }}><CardDetail mode={art.mode} /></div></div>
        <div className={`relative overflow-hidden rounded-[var(--pr)] border ring-1 transition ${art.cardTone} ${afterOn ? '' : 'opacity-40'}`} style={{ borderColor: 'color-mix(in srgb, var(--acc) 40%, transparent)' }}><span className="absolute left-3 top-3 z-10 rounded-full px-2.5 py-1 text-xs text-white" style={{ background: 'var(--acc)' }}>Sonrası</span><div className={`relative ${art.mediaTone}`} style={{ background: 'linear-gradient(135deg, color-mix(in srgb, var(--acc) 22%, transparent), color-mix(in srgb, var(--acc2) 12%, transparent))' }}><CardDetail mode={art.mode} /></div></div>
        {!reduce && !canToggle && (
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

/* ── Phase 2 interaction overlays (preview-only) ─────────────────────────
 * Small, premium overlays that make the declared contract actions feel real in
 * the in-app preview. They call NO backend, fabricate NO data (only the section's
 * own real copy is shown), and honestly label themselves as previews. They use
 * the existing CSS variables (--acc/--acc2/--sf/--bd/--pr/--hf) so they inherit
 * the generated site's theme. */
function OverlayShell({ children, onClose, align = 'center' }: { children: ReactNode; onClose: () => void; align?: 'center' | 'right' }) {
  return (
    <div className="fixed inset-0 z-[80] flex" style={{ justifyContent: align === 'right' ? 'flex-end' : 'center', alignItems: align === 'right' ? 'stretch' : 'center' }}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} aria-hidden />
      {children}
    </div>
  );
}

const OverlayClose = ({ onClose }: { onClose: () => void }) => (
  <button type="button" onClick={onClose} aria-label="Close" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-white/10 hover:text-white">✕</button>
);

const PreviewTag = ({ text }: { text: string }) => (
  <span className="rounded-full border border-[color:var(--bd)] bg-white/[0.04] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-slate-400">{text}</span>
);

/** A mini chat/demo panel — sample bubbles are the section's OWN real copy. It is a
 *  preview simulation: no backend, no fabricated AI answers or metrics. */
function ChatDemoPanel({ section, brief, onClose }: { section: S; brief: WebBuildBrief; onClose: () => void }) {
  const msgs = cleanLines([section.sub || section.headline || brief.type, ...bulletsOf(section)]).slice(0, 5);
  return (
    <OverlayShell onClose={onClose} align="right">
      <div className="relative z-10 flex h-full w-full max-w-md flex-col border-l border-[color:var(--bd)] bg-[#0b0e14]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[color:var(--bd)] px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full" style={{ background: 'var(--acc)' }} />
            <span className="text-sm font-semibold text-white" style={{ fontFamily: 'var(--hf)' }}>{heading(section)}</span>
          </div>
          <div className="flex items-center gap-2"><PreviewTag text="Preview" /><OverlayClose onClose={onClose} /></div>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {msgs.map((m, i) => (
            <div key={i} className="max-w-[85%] rounded-2xl rounded-tl-sm border border-[color:var(--bd)] bg-[var(--sf)] px-3.5 py-2.5 text-[13px] leading-relaxed text-slate-200">{m}</div>
          ))}
          {section.cta && <div className="ml-auto max-w-[85%] rounded-2xl rounded-tr-sm px-3.5 py-2.5 text-[13px] font-medium text-white" style={{ background: 'var(--acc)' }}>{section.cta}</div>}
        </div>
        <div className="border-t border-[color:var(--bd)] p-3">
          <div className="flex items-center gap-2 rounded-xl border border-[color:var(--bd)] bg-[var(--sf)] px-3 py-2">
            <span className="flex-1 text-[13px] text-slate-500">Preview simulation — no messages are sent.</span>
            <span className="flex h-7 w-7 items-center justify-center rounded-lg text-white" style={{ background: 'var(--acc)' }} aria-hidden>→</span>
          </div>
        </div>
      </div>
    </OverlayShell>
  );
}

/** A detail/record modal — shows the source section/card's REAL copy lines only. */
function DetailModal({ title, lines, onClose }: { title: string; lines: string[]; onClose: () => void }) {
  return (
    <OverlayShell onClose={onClose}>
      <div className="relative z-10 m-4 w-full max-w-lg rounded-[var(--pr)] border border-[color:var(--bd)] bg-[#0b0e14] p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-4">
          <h3 className="text-lg font-semibold text-white" style={{ fontFamily: 'var(--hf)' }}>{title}</h3>
          <OverlayClose onClose={onClose} />
        </div>
        <div className="mb-4 h-40 overflow-hidden rounded-[var(--pr)] border border-[color:var(--bd)]" style={{ background: 'linear-gradient(135deg, color-mix(in srgb, var(--acc) 22%, transparent), color-mix(in srgb, var(--acc2) 12%, transparent))' }} aria-hidden />
        {lines.length > 0 ? (
          <ul className="space-y-2">
            {lines.slice(0, 8).map((l, i) => (
              <li key={i} className="flex gap-2.5 text-sm text-slate-300"><span className="mt-2 h-1 w-1 shrink-0 rounded-full" style={{ background: 'var(--acc)' }} />{l}</li>
            ))}
          </ul>
        ) : <p className="text-sm text-slate-400">{title}</p>}
        <div className="mt-6 flex justify-end"><PreviewTag text="Preview detail" /></div>
      </div>
    </OverlayShell>
  );
}

type LeadFormType = 'quote' | 'contact' | 'access' | 'lead';
const LEAD_FORM: Record<LeadFormType, { title: string; fields: string[]; cta: string }> = {
  quote: { title: 'Request a quote', fields: ['Name', 'Email or phone', 'Project details'], cta: 'Request preview' },
  contact: { title: 'Contact', fields: ['Name', 'Email or phone', 'Message'], cta: 'Send (preview)' },
  access: { title: 'Request access', fields: ['Name', 'Affiliation', 'Research purpose'], cta: 'Request access (preview)' },
  lead: { title: 'Request info', fields: ['Name', 'Email or phone', 'Message'], cta: 'Request preview' },
};

/** A quote/contact/access/lead form shell — structural placeholder fields only.
 *  It never submits anywhere and never claims a fake "sent / success" state. */
function LeadFormPanel({ type, section, onClose }: { type: LeadFormType; section?: S; onClose: () => void }) {
  const [done, setDone] = useState(false);
  const cfg = LEAD_FORM[type] || LEAD_FORM.lead;
  const title = (section && heading(section)) || cfg.title;
  return (
    <OverlayShell onClose={onClose}>
      <div className="relative z-10 m-4 w-full max-w-md rounded-[var(--pr)] border border-[color:var(--bd)] bg-[#0b0e14] p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-start justify-between gap-4">
          <h3 className="text-lg font-semibold text-white" style={{ fontFamily: 'var(--hf)' }}>{title}</h3>
          <OverlayClose onClose={onClose} />
        </div>
        {section?.sub && <p className="mb-4 text-sm text-slate-400">{section.sub}</p>}
        <div className="mt-3 space-y-3">
          {cfg.fields.map((f, i) => (
            /details|message|purpose/i.test(f)
              ? <textarea key={i} rows={3} disabled placeholder={f} className="w-full resize-none rounded-lg border border-[color:var(--bd)] bg-[var(--sf)] px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500" />
              : <input key={i} type="text" disabled placeholder={f} className="w-full rounded-lg border border-[color:var(--bd)] bg-[var(--sf)] px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500" />
          ))}
        </div>
        <button type="button" onClick={() => setDone(true)} className="mt-4 w-full rounded-lg py-2.5 text-center text-sm font-semibold text-white" style={{ background: 'var(--acc)' }}>{cfg.cta}</button>
        <p className="mt-3 text-center text-[11px] text-slate-500">
          {done ? 'Preview only — nothing was submitted.' : 'This is a preview form — fields are inactive and nothing is sent.'}
        </p>
      </div>
    </OverlayShell>
  );
}

/* ── Phase 6A: premium multi-screen Preview experience ───────────────────
 * The model's Website Experience Plan (carried on the Interaction Contract as
 * experienceMode / navigationModel / websiteExperienceModel / pageScreenModel /
 * primaryWebsiteExperience / suggestedScreens / requiredStatefulComponents) can
 * ask for a real multi-SCREEN website/demo — not one scrolling page with a small
 * widget. resolvePreviewShell now builds a set of internal SCREENS (no routes —
 * local activePage only): for AI/SaaS a premium Product Demo / Chat Experience
 * plus Use Cases / Integrations / Security / Pricing; for marketplace a catalog /
 * detail / financing; for archive a collection / record / access; for service
 * projects / before-after / quote. Every screen is a LOCAL, front-end, STATIC
 * illustration built ONLY from real section copy — no backend, no real AI/DB/
 * payments/search, no fabricated data. Simple landing pages stay single-page. */
type ShellMode =
  | 'single-page' | 'internal-tabs' | 'dedicated-demo-page'
  | 'dashboard-demo-shell' | 'catalog-detail-shell'
  | 'archive-record-shell' | 'service-lead-shell';

/** The kind of premium screen to render (drives the composition, not a route). */
type ScreenKind =
  | 'product-demo' | 'chat' | 'use-cases' | 'integrations' | 'security' | 'pricing'
  | 'catalog' | 'detail' | 'financing'
  | 'collection' | 'record' | 'access'
  | 'projects' | 'before-after' | 'quote'
  | 'generic';

interface PreviewShellScreen { id: string; label: string; purpose: string; kind: ScreenKind; sectionIds: string[]; demoOnly: true }
interface PreviewShell { shellMode: ShellMode; screens: PreviewShellScreen[]; primaryScreenId?: string }

type ShellFamily = 'ai' | 'marketplace' | 'archive' | 'service' | 'none';

const SHELL_RE = {
  demo: /(product-?demo|\bdemo\b|chatbot|\bchat\b|playground|assistant|use-?case)/i,
  chat: /(chat|assistant|\bbot\b|conversation|message|prompt)/i,
  useCase: /(use-?case|scenario|workflow|solution|senaryo|kullanım)/i,
  integrations: /(integration|connect|\bapi\b|plugin|webhook|entegrasyon|bağlan)/i,
  security: /(security|trust|compliance|privacy|güven|güvenlik|gizlilik|uyumluluk)/i,
  pricing: /(pricing|\bplans?\b|\bprice\b|fiyat|abonelik|paket)/i,
  catalog: /(catalog|collection-?grid|inventory|envanter|featured|listings?|products?|vehicles?|araç|araba|\bcars?\b|shop|store|mağaza)/i,
  collection: /(collection|koleksiyon|\bindex\b|archive|arşiv|records?|belge|document|manuscript|research|filter)/i,
  gallery: /(gallery|galeri|project|proje|portfolio|selected-?work|showcase|before-?after|materials?)/i,
  beforeAfter: /(before-?after|önce-?sonra|transformation|dönüşüm)/i,
  quote: /(quote|teklif|estimate|consultation|request-?quote|quote-?cta)/i,
  contact: /(contact|iletişim|reservation|rezervasyon|book|randevu|başvuru)/i,
  access: /(access|erişim|researcher|araştırmacı)/i,
  financing: /(financ|payment|loan|kredi|ödeme|installment|taksit|request-?info)/i,
};

/* Fallback hero-visual type per art render mode, used when the Phase-5
 * VisualAssetPlan is not plumbed through (e.g. the standalone /preview route). */
const FALLBACK_HERO_VISUAL: Record<string, HeroVisualType> = {
  'product-saas': 'dashboard-mockup',
  marketplace: 'product-mockup',
  archive: 'pattern-system',
  landscaping: 'photo-direction',
  portfolio: 'svg-illustration',
  industrial: 'svg-illustration',
};

function resolveHeroVisual(plan: VisualAssetPlan | undefined, artMode: string): HeroVisualType {
  return plan?.heroVisualType || FALLBACK_HERO_VISUAL[artMode] || 'css-abstract';
}

/* ── Premium visual asset layer (CSS/SVG ONLY — no external image/video) ───
 * Consumes the resolved heroVisualType to render a concept-specific ambient
 * behind the hero / demo screens: gradient orbs + an animated mesh / product
 * grid / dashboard mockup lines / archival pattern / organic contours. Respects
 * reduced-motion. Never fetches or generates a real asset. */
function PremiumVisualLayer({ type, animate, className = '' }: { type: HeroVisualType; animate: boolean; className?: string }) {
  const still = !animate;
  // Phase 6E — calmer ambient: hairline-faint lines, a single restrained accent
  // stroke, low opacity so it never competes with the text.
  const line = 'rgba(255,255,255,0.06)';
  const motif = (() => {
    switch (type) {
      case 'dashboard-mockup':
        return (
          <svg aria-hidden viewBox="0 0 400 240" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full" style={{ opacity: 0.35 }}>
            {[60, 120, 180].map((y, k) => <line key={`g${k}`} x1="20" y1={y} x2="380" y2={y} stroke={line} strokeWidth="1" />)}
            <polyline points="20,180 90,150 160,162 230,110 300,132 380,96" fill="none" stroke="var(--acc)" strokeWidth="1.6" opacity="0.55" />
          </svg>
        );
      case 'product-mockup':
        return (
          <svg aria-hidden viewBox="0 0 400 240" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full" style={{ opacity: 0.3 }}>
            {[0, 1].map((r) => [0, 1, 2, 3].map((c) => (
              <rect key={`${r}-${c}`} x={30 + c * 92} y={50 + r * 80} width="76" height="54" rx="8" fill="none" stroke={r === 0 && c === 0 ? 'var(--acc)' : line} strokeWidth="1.2" opacity={r === 0 && c === 0 ? 0.5 : 1} />
            )))}
          </svg>
        );
      case 'pattern-system':
        return (
          <svg aria-hidden viewBox="0 0 400 240" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full" style={{ opacity: 0.28 }}>
            {Array.from({ length: 6 }).map((_, k) => <line key={`v${k}`} x1={30 + k * 68} y1="10" x2={30 + k * 68} y2="230" stroke={line} strokeWidth="1" />)}
            {[80, 160].map((y, k) => <line key={`h${k}`} x1="10" y1={y} x2="390" y2={y} stroke={line} strokeWidth="1" />)}
          </svg>
        );
      case 'photo-direction':
        return (
          <svg aria-hidden viewBox="0 0 400 240" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full" style={{ opacity: 0.3 }}>
            {[70, 130, 190].map((y, k) => <path key={k} d={`M0 ${y} C 100 ${y - 24}, 300 ${y + 24}, 400 ${y}`} fill="none" stroke={k === 1 ? 'var(--acc)' : line} strokeWidth="1.2" opacity={k === 1 ? 0.45 : 1} />)}
          </svg>
        );
      default: // css-abstract / svg-illustration / canvas-motion → soft mesh
        return (
          <svg aria-hidden viewBox="0 0 400 240" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full" style={{ opacity: 0.28 }}>
            {Array.from({ length: 4 }).map((_, k) => <line key={`d${k}`} x1={-40 + k * 130} y1="240" x2={140 + k * 130} y2="0" stroke={line} strokeWidth="1" />)}
            <circle cx="330" cy="64" r="36" fill="none" stroke="var(--acc)" strokeWidth="1.2" opacity="0.35" />
          </svg>
        );
    }
  })();
  return (
    <div aria-hidden className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}>
      <Orb color="var(--acc)" style={{ top: '-14%', right: '-10%', width: 420, height: 420, opacity: 0.16 }} still={still} />
      <Orb color="var(--acc2)" style={{ bottom: '-18%', left: '-12%', width: 360, height: 360, opacity: 0.1 }} delay={2} still={still} />
      {motif}
    </div>
  );
}

/* ── Phase 6E: local visual-calm helpers ─────────────────────────────────────
 * A tiny, LOCAL hierarchy system (not a component library): softer surfaces, one
 * hairline instead of stacked borders, muted secondary text, and accent reserved
 * for the primary CTA / active nav / one key highlight. Used by the teaser and
 * the demo screens so the Preview reads as a calm premium site, not a UI kit. */
const CALM = {
  /** A calm surface: near-transparent fill + a single hairline (no heavy border). */
  surface: 'rounded-[var(--pr)] border border-white/[0.07] bg-white/[0.02]',
  /** An even quieter panel (side rails, secondary blocks). */
  panel: 'rounded-[var(--pr)] border border-white/[0.05] bg-white/[0.015]',
  hairline: 'border-white/[0.06]',
  muted: 'text-slate-400',
  faint: 'text-slate-500',
};
/** Soft accent tint (for the ONE key highlight, never a loud filled block). */
const accentTint = (pct = 12) => ({ background: `color-mix(in srgb, var(--acc) ${pct}%, transparent)` });

function PreviewPill({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'accent' }) {
  const base = 'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider';
  return tone === 'accent'
    ? <span className={`${base} text-white/90`} style={accentTint(16)}>{children}</span>
    : <span className={`${base} border border-white/[0.08] ${CALM.faint}`}>{children}</span>;
}

function PreviewSectionLabel({ children }: { children: ReactNode }) {
  return <p className="text-[11px] font-medium uppercase tracking-widest text-white/40">{children}</p>;
}

/** A calm mockup frame (browser dots + url pill + one status pill) reused by the
 *  teaser and the demo screen so both share one restrained surface language. */
function MockFrameHeader({ url, status }: { url: string; status: string }) {
  return (
    <div className={`flex items-center gap-2 border-b ${CALM.hairline} px-4 py-2.5`}>
      <span className="h-2.5 w-2.5 rounded-full bg-white/12" /><span className="h-2.5 w-2.5 rounded-full bg-white/10" /><span className="h-2.5 w-2.5 rounded-full bg-white/[0.07]" />
      <span className={`ml-3 flex-1 truncate rounded-md px-3 py-1 text-[11px] ${CALM.faint}`} style={{ background: 'rgba(255,255,255,0.03)' }}>{url}</span>
      <PreviewPill>{status}</PreviewPill>
    </div>
  );
}

const uniqStr = (xs: (string | undefined)[]): string[] => Array.from(new Set(xs.map((x) => (x || '').trim()).filter(Boolean)));

/** Map a suggested-screen name to a screen kind (best-effort, never throws). */
function kindFromName(name: string): ScreenKind | undefined {
  const n = (name || '').toLowerCase();
  if (SHELL_RE.chat.test(n)) return 'chat';
  if (SHELL_RE.useCase.test(n)) return 'use-cases';
  if (SHELL_RE.integrations.test(n)) return 'integrations';
  if (SHELL_RE.security.test(n)) return 'security';
  if (SHELL_RE.pricing.test(n)) return 'pricing';
  if (SHELL_RE.beforeAfter.test(n)) return 'before-after';
  if (SHELL_RE.quote.test(n)) return 'quote';
  if (SHELL_RE.access.test(n)) return 'access';
  if (SHELL_RE.financing.test(n)) return 'financing';
  if (/detail|record|preview/.test(n)) return 'detail';
  if (SHELL_RE.catalog.test(n)) return 'catalog';
  if (SHELL_RE.collection.test(n)) return 'collection';
  if (SHELL_RE.gallery.test(n)) return 'projects';
  if (/demo|product/.test(n)) return 'product-demo';
  return undefined;
}

/**
 * Resolve the Preview shell into a set of premium internal SCREENS. Pure; never
 * throws. Returns { screens: [] } for a single-page/landing experience so the
 * existing scrolling preview renders unchanged.
 */
function resolvePreviewShell(
  contract: InteractionContract | undefined,
  brief: WebBuildBrief,
  sectionItems: S[],
): PreviewShell {
  try {
    const content = sectionItems.filter((s) => !/hero|footer/i.test(s.id));
    const secText = (s: S) => `${s.id} ${s.name || ''}`.toLowerCase();
    const matches = (re: RegExp) => content.filter((s) => re.test(secText(s)));
    const idsOf = (secs: S[]) => secs.map((s) => s.id);
    const has = (re: RegExp) => content.some((s) => re.test(secText(s)));

    const concept = (contract?.conceptCategory || '').toLowerCase();
    const mode = (contract?.experienceMode || '').toLowerCase();
    const stateful = (contract?.requiredStatefulComponents || []).join(' ').toLowerCase();
    const hay = [
      contract?.experienceMode, contract?.navigationModel, contract?.websiteExperienceModel,
      contract?.pageScreenModel, contract?.primaryWebsiteExperience,
      brief.navigationModel, brief.websiteExperienceModel, brief.primaryWebsiteExperience,
      brief.pageScreenModel, brief.artDesignArchetype, brief.type,
    ].filter(Boolean).join(' ').toLowerCase();
    const chatImplied = /chat|assistant|\bbot\b|conversational/.test(`${hay} ${stateful} ${concept}`)
      || has(SHELL_RE.chat);

    // Family — the primary concept controls the screen architecture.
    let family: ShellFamily = 'none';
    if (concept === 'ai' || concept === 'saas'
      || /\bai\b|assistant|chatbot|dashboard|\bsaas\b|platform|product\s?demo/.test(hay)
      || /chat|product-?demo|assistant/.test(stateful)) family = 'ai';
    else if (concept === 'marketplace' || concept === 'real_estate'
      || /catalog|marketplace|inventory|listing|storefront/.test(hay)) family = 'marketplace';
    else if (concept === 'archive'
      || /archive|\brecord\b|museum|provenance|collection/.test(hay)) family = 'archive';
    else if (['landscaping', 'local_service', 'legal', 'medical', 'finance', 'hospitality'].includes(concept)
      || /service|quote|lead-?gen|before-?after|\bproject/.test(hay)) family = 'service';

    // Rich-plan gate — only build multi-screen when the model plan calls for it or
    // the concept + real sections clearly support it. Simple landings stay single.
    const richSignal = (!!mode && !['scroll', 'inline'].includes(mode))
      || (contract?.suggestedScreens?.length || 0) >= 1
      || (contract?.requiredStatefulComponents?.length || 0) >= 1
      || /multi-?page|dedicated|dashboard|catalog|internal page tab|demo page|demo screen|product demo/.test(hay);

    if (family === 'none') return { shellMode: 'single-page', screens: [] };

    // Map the model's suggested screens to kinds first (its plan wins).
    type SuggestedScreen = NonNullable<InteractionContract['suggestedScreens']>[number];
    type SuggestedMap = { sn: SuggestedScreen; kind: ScreenKind };
    const suggested: SuggestedMap[] = (contract?.suggestedScreens || [])
      .map((sn) => ({ sn, kind: kindFromName(sn?.name || '') }))
      .filter((x): x is SuggestedMap => !!x.sn && !!x.kind);

    const screens: PreviewShellScreen[] = [];
    const used = new Set<ScreenKind>();
    const add = (kind: ScreenKind, label: string, re: RegExp | null, purpose?: string) => {
      if (used.has(kind) || screens.length >= 5) return;
      const secs = re ? matches(re) : [];
      const sectionIds = idsOf(secs.length ? secs : content);
      const sn = suggested.find((x) => x.kind === kind)?.sn;
      screens.push({
        id: `__scr_${kind}`,
        label: (sn?.name || '').trim() || label,
        purpose: (sn?.purpose || purpose || contract?.primaryWebsiteExperience || label).trim(),
        kind,
        sectionIds,
        demoOnly: true,
      });
      used.add(kind);
    };

    if (family === 'ai') {
      // Landing gate: an AI product with no demo intent AND no rich plan stays a
      // scrolling landing page (don't over-complicate a plain one-pager).
      const demoIntent = chatImplied || richSignal || has(SHELL_RE.demo) || content.length >= 3;
      if (!demoIntent) return { shellMode: 'single-page', screens: [] };
      // Flagship — a real Product Demo / Chat Experience screen.
      if (chatImplied) add('chat', 'Chat Experience', SHELL_RE.demo, contract?.primaryWebsiteExperience);
      else add('product-demo', 'Product Demo', SHELL_RE.demo, contract?.primaryWebsiteExperience);
      // Optional model-native screens, only when there is real content for them.
      if (has(SHELL_RE.useCase)) add('use-cases', 'Use Cases', SHELL_RE.useCase);
      if (has(SHELL_RE.integrations)) add('integrations', 'Integrations', SHELL_RE.integrations);
      if (has(SHELL_RE.security)) add('security', 'Security', SHELL_RE.security);
      if (has(SHELL_RE.pricing)) add('pricing', 'Pricing', SHELL_RE.pricing);
      // Guarantee at least a second screen so it reads multi-screen — synthesize a
      // Use Cases page from the remaining real sections (real copy, no fabrication).
      if (screens.length < 2 && content.length >= 2) add('use-cases', 'Use Cases', null);
    } else if (family === 'marketplace') {
      add('catalog', 'Catalog', SHELL_RE.catalog, contract?.primaryWebsiteExperience);
      add('detail', 'Detail', SHELL_RE.catalog);
      if (has(SHELL_RE.financing) || has(SHELL_RE.contact)) add('financing', 'Request info', has(SHELL_RE.financing) ? SHELL_RE.financing : SHELL_RE.contact);
    } else if (family === 'archive') {
      add('collection', 'Collection', SHELL_RE.collection, contract?.primaryWebsiteExperience);
      add('record', 'Record', SHELL_RE.collection);
      if (has(SHELL_RE.access) || has(SHELL_RE.contact)) add('access', 'Research access', has(SHELL_RE.access) ? SHELL_RE.access : SHELL_RE.contact);
    } else if (family === 'service') {
      // Only escalate to a multi-screen service site when there is real gallery/
      // quote content; otherwise a service landing scrolls fine.
      if (!(has(SHELL_RE.gallery) || has(SHELL_RE.quote) || has(SHELL_RE.beforeAfter) || richSignal)) {
        return { shellMode: 'single-page', screens: [] };
      }
      add('projects', 'Projects', SHELL_RE.gallery, contract?.primaryWebsiteExperience);
      if (has(SHELL_RE.beforeAfter)) add('before-after', 'Before / After', SHELL_RE.beforeAfter);
      add('quote', 'Get a quote', has(SHELL_RE.quote) ? SHELL_RE.quote : SHELL_RE.contact);
    }

    if (!screens.length) return { shellMode: 'single-page', screens: [] };
    const shellMode: ShellMode = family === 'ai' ? 'dedicated-demo-page'
      : family === 'marketplace' ? 'catalog-detail-shell'
      : family === 'archive' ? 'archive-record-shell' : 'service-lead-shell';
    return { shellMode, screens, primaryScreenId: screens[0].id };
  } catch {
    return { shellMode: 'single-page', screens: [] };
  }
}

/* ── Phase 6B: Entry Flow resolution ─────────────────────────────────────────
 * Maps the contract's entry-flow decision (initialScreenId / postEntryScreenId as
 * screen KIND tokens) onto the REAL internal shell screens. A local screen
 * transition only — never a route change, auth gate or real product surface. */
interface EntryFlowResolved {
  initialActivePage: string;      // 'home' or a real shell screen id
  postEntryScreenId?: string;     // a real shell screen id (or undefined)
  primaryEntryCTA?: string;
  secondaryEntryCTA?: string;
  shouldGateWithLanding: boolean;
}

/** Kind aliases — a requested token falls back to a compatible screen kind. */
const ENTRY_KIND_ALIASES: Record<string, ScreenKind[]> = {
  'product-demo': ['product-demo', 'chat'],
  chat: ['chat', 'product-demo'],
  dashboard: ['product-demo', 'chat'],
  catalog: ['catalog', 'detail'],
  detail: ['detail', 'catalog'],
  collection: ['collection', 'record'],
  record: ['record', 'collection'],
  projects: ['projects', 'before-after', 'quote'],
  quote: ['quote', 'projects'],
};

function resolveEntryFlow(
  contract: InteractionContract | null | undefined,
  shell: PreviewShell,
  pages: PreviewPage[],
): EntryFlowResolved {
  try {
    const screens = shell.screens || [];
    const homeId = pages.find((p) => p.id === 'home')?.id || 'home';
    // Map a kind token → a real shell screen id (compatible kind, else any screen).
    const findScreen = (token?: string): string | undefined => {
      if (!token) return undefined;
      const t = token.toLowerCase();
      if (t === 'home') return homeId;
      const wanted = ENTRY_KIND_ALIASES[t] || [t as ScreenKind];
      for (const k of wanted) { const sc = screens.find((s) => s.kind === k); if (sc) return sc.id; }
      return screens[0]?.id;
    };

    const model = (contract?.entryFlowModel || '').toLowerCase();
    const landingRequired = contract?.landingRequired;
    const postEntryScreenId = findScreen(contract?.postEntryScreenId) || findScreen(contract?.initialScreenId);

    // Decide the initial active page. Landing-gated / single-page / no screens →
    // start on Home; direct-demo / dashboard-first / catalog-first / archive-
    // exploration → start INSIDE the matching screen when it actually exists.
    let initialActivePage = homeId;
    let shouldGate = landingRequired !== false;
    const startsInside = landingRequired === false
      && (model === 'direct-demo' || model === 'dashboard-first' || model === 'catalog-first' || model === 'archive-exploration');
    if (startsInside && screens.length) {
      const inside = findScreen(contract?.initialScreenId) || findScreen(contract?.postEntryScreenId);
      if (inside && screens.some((s) => s.id === inside)) { initialActivePage = inside; shouldGate = false; }
    }
    if (!screens.length) { initialActivePage = homeId; shouldGate = false; }
    // Validate — never point at a screen that isn't present.
    if (initialActivePage !== homeId && !screens.some((s) => s.id === initialActivePage)) initialActivePage = homeId;

    return {
      initialActivePage,
      postEntryScreenId: postEntryScreenId && screens.some((s) => s.id === postEntryScreenId) ? postEntryScreenId : undefined,
      primaryEntryCTA: contract?.primaryEntryCTA,
      secondaryEntryCTA: contract?.secondaryEntryCTA,
      shouldGateWithLanding: shouldGate,
    };
  } catch {
    return { initialActivePage: 'home', shouldGateWithLanding: true };
  }
}

/* ── Phase 6C: disciplined preview navigation ────────────────────────────────
 * The old header dumped BOTH content pages AND every demo screen into one nav —
 * so an AI/SaaS build looked like an 8–10 tab admin panel. This caps the visible
 * nav (Home + ≤5), promotes ONE clear experience item (Product Demo / Chat /
 * Catalog / Collection / Projects), removes duplicate demo/chat tabs, and pushes
 * lower-priority screens into an overflow row. No routes — local activePage only. */
interface PreviewNavItem { id: string; label: string; type: 'page' | 'demo'; targetPageId: string }
interface PreviewNav {
  primaryNavItems: PreviewNavItem[];
  overflowItems: PreviewNavItem[];
  entryItem?: PreviewNavItem;
  demoItem?: PreviewNavItem;
  shouldShowExperienceNav: boolean;
}

/** Nav priority per screen kind — the experience screen leads, marketing/proof
 *  screens follow, content pages last. */
const NAV_KIND_ORDER: Record<string, number> = {
  'product-demo': 0, chat: 0, catalog: 0, collection: 0, projects: 0,
  detail: 1, record: 1, financing: 2, access: 2, 'before-after': 2,
  'use-cases': 2, quote: 3, integrations: 3, security: 4, pricing: 5, generic: 6,
};
const NAV_EXPERIENCE_KINDS = new Set<ScreenKind>(['product-demo', 'chat', 'catalog', 'collection', 'projects']);
const NAV_DUP_DEMO_KINDS = new Set<ScreenKind>(['product-demo', 'chat']);
const NAV_PRIMARY_CAP = 5; // non-home items (Home is the brand button → ≤6 total)

/** Resolve a clean, capped nav model. Pure; on any error falls back to the old
 *  (uncapped) pages + demoScreens behaviour so nothing breaks. */
function resolvePreviewNavigation(
  pages: PreviewPage[],
  demoScreens: PreviewShellScreen[],
  entryFlow: EntryFlowResolved,
): PreviewNav {
  try {
    type Item = PreviewNavItem & { kind?: ScreenKind; order: number };
    const items: Item[] = [];
    for (const s of demoScreens) {
      items.push({ id: s.id, label: s.label, type: 'demo', targetPageId: s.id, kind: s.kind, order: NAV_KIND_ORDER[s.kind] ?? 6 });
    }
    for (const p of pages) {
      if (p.id === 'home') continue;
      items.push({ id: p.id, label: p.label, type: 'page', targetPageId: p.id, order: 7 });
    }

    // The ONE clear experience item: the screen the entry flow enters, else the
    // lowest-priority experience-kind demo screen.
    const flagship = items.find((i) => i.type === 'demo' && i.targetPageId === entryFlow.postEntryScreenId)
      || items.find((i) => !!i.kind && NAV_EXPERIENCE_KINDS.has(i.kind));

    // Dedupe: never show two Product Demo / Chat tabs; drop duplicate labels.
    const norm = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
    const seen = new Set<string>();
    const filtered = items.filter((i) => {
      if (flagship && i !== flagship && !!i.kind && NAV_DUP_DEMO_KINDS.has(i.kind)) return false;
      const key = norm(i.label);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    filtered.sort((a, b) => {
      if (flagship) { if (a === flagship) return -1; if (b === flagship) return 1; }
      return a.order - b.order;
    });

    const strip = (i: Item): PreviewNavItem => ({ id: i.id, label: i.label, type: i.type, targetPageId: i.targetPageId });
    const flag = flagship ? strip(flagship) : undefined;
    return {
      primaryNavItems: filtered.slice(0, NAV_PRIMARY_CAP).map(strip),
      overflowItems: filtered.slice(NAV_PRIMARY_CAP).map(strip),
      entryItem: flag,
      demoItem: flag && flagship!.type === 'demo' ? flag : undefined,
      shouldShowExperienceNav: !!flag,
    };
  } catch {
    const primaryNavItems: PreviewNavItem[] = [
      ...pages.filter((p) => p.id !== 'home').map((p) => ({ id: p.id, label: p.label, type: 'page' as const, targetPageId: p.id })),
      ...demoScreens.map((s) => ({ id: s.id, label: s.label, type: 'demo' as const, targetPageId: s.id })),
    ];
    return { primaryNavItems, overflowItems: [], shouldShowExperienceNav: demoScreens.length > 0 };
  }
}

/* ── Premium screen building blocks ──────────────────────────────────────── */

/**
 * Phase 6C: a compact premium LANDING demo teaser (AI/SaaS/product-demo only). A
 * small browser/chat mockup built ONLY from real section copy, clearly labelled
 * "Preview only", with ONE CTA that enters the full Product Demo / Chat Experience
 * screen. Local & static — no backend, no real AI, no claim the product is running.
 */
function LandingDemoTeaser({ sections, brief, chat, ctaLabel, onEnter }: {
  sections: S[]; brief: WebBuildBrief; chat: boolean; ctaLabel: string; onEnter: () => void;
}) {
  const content = sections.filter((s) => !/hero|footer/i.test(s.id));
  const demoSec = content.find((s) => /demo|chat|assistant|playground|product/i.test(`${s.id} ${s.name || ''}`)) || content[0];
  // Phase 6E — a COMPACT preview card: one refined title, ≤2 bubbles, accent only
  // on the CTA + a single subtle user-bubble tint. Calm surface, one hairline.
  const bubbles = cleanLines([demoSec?.sub || demoSec?.headline || brief.type, ...(demoSec ? bulletsOf(demoSec) : [])]).slice(0, 2);
  const q = (demoSec && (demoSec.name || heading(demoSec))) || '';
  const title = chat ? 'Preview the assistant' : 'Preview the experience';
  const url = `${(brief.type || 'preview').toLowerCase().replace(/\s+/g, '')}.app / ${chat ? 'assistant' : 'demo'}`;
  return (
    <div className="relative z-10 mx-auto mt-2 max-w-4xl px-6">
      <div className={`overflow-hidden ${CALM.surface}`}>
        <MockFrameHeader url={url} status="Preview only" />
        <div className="grid gap-0 md:grid-cols-[1fr_13rem]">
          <div className="space-y-2 p-4">
            <PreviewSectionLabel>{title}</PreviewSectionLabel>
            {q && <div className="ml-auto max-w-[78%] rounded-2xl rounded-tr-sm px-3.5 py-2 text-[13px] font-medium text-white/90" style={accentTint(14)}>{q}</div>}
            {bubbles.map((m, i) => <div key={i} className={`max-w-[86%] rounded-2xl rounded-tl-sm px-3.5 py-2 text-[13px] leading-relaxed text-slate-300`} style={{ background: 'rgba(255,255,255,0.03)' }}>{m}</div>)}
          </div>
          <div className={`flex flex-col justify-center gap-2 border-t ${CALM.hairline} p-4 md:border-l md:border-t-0`}>
            <button type="button" onClick={onEnter} className="rounded-xl px-5 py-2.5 text-sm font-semibold text-white" style={{ background: 'var(--acc)', boxShadow: '0 8px 24px -12px var(--acc)' }}>{ctaLabel}</button>
            <span className={`text-center text-[11px] ${CALM.faint}`}>Front-end demo — no real AI or backend.</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ScreenHeader({ label, purpose, onHome }: { label: string; purpose: string; onHome: () => void }) {
  return (
    <div className="relative z-10 mx-auto max-w-6xl px-6 pt-8">
      <button type="button" onClick={onHome} className="text-sm text-slate-400 transition hover:text-white">&larr; Home</button>
      <div className="mt-3 flex flex-wrap items-center gap-2.5">
        <h1 className="text-2xl font-semibold text-white sm:text-3xl" style={{ fontFamily: 'var(--hf)', letterSpacing: 'var(--tr)' }}>{label}</h1>
        <PreviewPill>Front-end demo</PreviewPill>
      </div>
      {purpose && purpose !== label && <p className="mt-2 max-w-2xl text-sm text-slate-400">{purpose}</p>}
    </div>
  );
}

/**
 * Premium AI/SaaS Product Demo / Chat Experience screen — a real front-end demo
 * surface (browser mockup frame + left step rail + central chat/product panel +
 * right inspector) built ONLY from real section copy. Local & static: no backend,
 * no real AI, no sent/success state. CTAs open the existing preview overlays.
 */
function ProductDemoScreen({ label, purpose, screenSections, allSections, brief, rt, onHome, heroVisual, animate, chat }: {
  label: string; purpose: string; screenSections: S[]; allSections: S[]; brief: WebBuildBrief; rt: PreviewRuntime; onHome: () => void; heroVisual: HeroVisualType; animate: boolean; chat: boolean;
}) {
  const content = (screenSections.length ? screenSections : allSections).filter((s) => !/hero|footer/i.test(s.id));
  const pick = (re: RegExp) => content.find((s) => re.test(`${s.id} ${s.name || ''}`));
  const demoSec = pick(SHELL_RE.demo) || content[0];
  // Phase 6E — calmer density: left rail ≤3 steps (rest as a muted "+N more"),
  // right inspector ≤3 items, the central panel is the visual hero. Accent is
  // reserved for the active step, the CTA and one subtle user-bubble tint.
  const allSteps = content;
  const steps = allSteps.slice(0, 3);
  const moreSteps = Math.max(0, allSteps.length - steps.length);
  const answers = uniqStr([demoSec?.sub || demoSec?.headline, ...(demoSec ? bulletsOf(demoSec) : []), ...content.flatMap((s) => bulletsOf(s).slice(0, 1))]).slice(0, 3);
  const questions = uniqStr(steps.map((s) => s.name || heading(s))).slice(0, answers.length || 2);
  const inspector = content.find((s) => SHELL_RE.integrations.test(`${s.id} ${s.name}`)) || content.find((s) => SHELL_RE.security.test(`${s.id} ${s.name}`));
  const inspectorItems = uniqStr(inspector ? bulletsOf(inspector) : content.flatMap((s) => bulletsOf(s)).slice(0, 3)).slice(0, 3);
  const url = `${(brief.type || 'preview').toLowerCase().replace(/\s+/g, '')}.app / ${chat ? 'assistant' : 'demo'}`;

  return (
    <div className="relative pb-16">
      <PremiumVisualLayer type={heroVisual} animate={animate} className="opacity-30" />
      <ScreenHeader label={label} purpose={purpose} onHome={onHome} />
      <div className="relative z-10 mx-auto mt-6 max-w-6xl px-6">
        {/* Browser / product mockup frame — one hairline, calm surface. */}
        <div className={`overflow-hidden ${CALM.surface}`}>
          <MockFrameHeader url={url} status="Preview" />
          <div className="grid gap-0 lg:grid-cols-[12rem_1fr_13rem]">
            {/* Left: demo steps / use cases (≤3 + muted more). */}
            <aside className={`hidden border-r ${CALM.hairline} p-3.5 lg:block`}>
              <PreviewSectionLabel>{chat ? 'Prompts' : 'Steps'}</PreviewSectionLabel>
              <ul className="mt-3 space-y-1">
                {steps.map((s, i) => (
                  <li key={s.id}>
                    <button type="button" onClick={() => rt.open('open-chat-demo', s)} className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13px] transition ${i === 0 ? 'text-white' : `${CALM.muted} hover:text-white`}`} style={i === 0 ? accentTint(12) : undefined}>
                      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[10px] font-semibold ${i === 0 ? 'text-white' : 'text-slate-400'}`} style={i === 0 ? accentTint(40) : { background: 'rgba(255,255,255,0.05)' }}>{i + 1}</span>
                      <span className="truncate">{s.name || heading(s)}</span>
                    </button>
                  </li>
                ))}
                {moreSteps > 0 && <li className={`px-2 pt-1 text-[11px] ${CALM.faint}`}>+{moreSteps} more</li>}
              </ul>
            </aside>
            {/* Center: chat / product experience — the visual hero, generous spacing. */}
            <div className="min-h-[22rem] p-5" style={{ background: 'rgba(0,0,0,0.18)' }}>
              <div className="space-y-4">
                {questions.map((qn, i) => (
                  <div key={`x${i}`} className="space-y-2">
                    <div className="ml-auto max-w-[78%] rounded-2xl rounded-tr-sm px-3.5 py-2.5 text-[13px] font-medium text-white/90" style={accentTint(14)}>{qn}</div>
                    {answers[i] && <div className="max-w-[86%] rounded-2xl rounded-tl-sm px-3.5 py-2.5 text-[13px] leading-relaxed text-slate-300" style={{ background: 'rgba(255,255,255,0.03)' }}>{answers[i]}</div>}
                  </div>
                ))}
              </div>
              {/* Preview-only input — deliberately inert (not a working AI input). */}
              <div className={`mt-5 flex items-center gap-2 rounded-xl border ${CALM.hairline} px-3.5 py-2.5`} style={{ background: 'rgba(255,255,255,0.02)' }}>
                <span className={`flex-1 text-[13px] ${CALM.faint}`}>{chat ? 'Ask the assistant…' : 'Try the demo…'}</span>
                <PreviewPill>Preview only</PreviewPill>
              </div>
            </div>
            {/* Right: inspector / integrations / security (≤3, borderless rows). */}
            <aside className={`hidden border-l ${CALM.hairline} p-3.5 lg:block`}>
              <PreviewSectionLabel>{inspector ? (inspector.name || 'Details') : 'Highlights'}</PreviewSectionLabel>
              <ul className="mt-3 space-y-2.5">
                {inspectorItems.map((b, i) => (
                  <li key={i} className={`flex gap-2 text-[12px] leading-snug ${CALM.muted}`}><span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-white/25" />{b}</li>
                ))}
              </ul>
            </aside>
          </div>
        </div>
        {/* Feature strip — calm surfaces, muted dots (no accent bullets everywhere). */}
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {content.filter((s) => s !== demoSec).slice(0, 3).map((s) => (
            <div key={s.id} className={`${CALM.panel} p-4`}>
              <p className="text-sm font-semibold text-white">{s.name || heading(s)}</p>
              <ul className="mt-2.5 space-y-1.5">
                {bulletsOf(s).slice(0, 2).map((b, i) => <li key={i} className={`flex gap-2 text-[13px] ${CALM.muted}`}><span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-white/25" />{b}</li>)}
              </ul>
            </div>
          ))}
        </div>
        {/* One primary CTA (accent) + a quiet ghost secondary. */}
        {demoSec && (
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => rt.open('open-chat-demo', demoSec)} className="rounded-xl px-6 py-3 text-sm font-semibold text-white" style={{ background: 'var(--acc)', boxShadow: '0 8px 24px -12px var(--acc)' }}>{demoSec.cta || (chat ? 'Open chat demo' : 'Open the demo')}</button>
            <button type="button" onClick={onHome} className={`rounded-xl border ${CALM.hairline} px-5 py-3 text-sm font-medium text-slate-300 transition hover:text-white`}>Back to overview</button>
            <span className={`text-[12px] ${CALM.faint}`}>Front-end demo — no real AI, backend or data.</span>
          </div>
        )}
      </div>
    </div>
  );
}

/** Premium catalog / collection / gallery grid screen (marketplace/archive/service). */
function GridScreen({ label, purpose, screenSections, allSections, brief, art, rt, onHome, kind }: {
  label: string; purpose: string; screenSections: S[]; allSections: S[]; brief: WebBuildBrief; art: WebBuildArtIdentity; rt: PreviewRuntime; onHome: () => void; kind: ScreenKind;
}) {
  const [query, setQuery] = useState('');
  const content = (screenSections.length ? screenSections : allSections).filter((s) => !/hero|footer/i.test(s.id));
  const all = (content.length ? content : allSections).flatMap((s) => bulletsOf(s).map((b) => ({ b, s }))).slice(0, 12);
  const q = query.trim().toLowerCase();
  const visible = q ? all.filter((c) => c.b.toLowerCase().includes(q)) : all;
  const detailType: InteractionActionType = kind === 'collection' || kind === 'record' ? 'open-record-detail' : 'open-detail-modal';
  const ctaType: InteractionActionType = kind === 'access' ? 'request-access' : kind === 'quote' ? 'open-quote-form' : 'request-info';
  const cta = allSections.find((s) => SHELL_RE.contact.test(`${s.id} ${s.name}`)) || allSections.find((s) => SHELL_RE.quote.test(`${s.id} ${s.name}`));
  const listy = kind === 'collection' || kind === 'record';
  return (
    <div className="pb-16"><ScreenHeader label={label} purpose={purpose} onHome={onHome} />
      <div className={`mx-auto mt-6 px-6 ${listy ? 'max-w-4xl' : 'max-w-6xl'}`}>
        <div className="flex flex-wrap items-center gap-3">
          <div className={`flex min-w-[16rem] flex-1 items-center gap-2 ${CALM.surface} px-3.5 py-2`}>
            <span className="text-slate-500" aria-hidden>⌕</span>
            <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={listy ? 'Search the collection' : 'Filter listings'} className="w-full bg-transparent text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none" />
          </div>
          {cta && <button type="button" onClick={() => rt.open(ctaType, cta)} className="rounded-lg px-4 py-2 text-sm font-semibold text-white" style={{ background: 'var(--acc)' }}>{cta.cta || (ctaType === 'open-quote-form' ? 'Request a quote' : ctaType === 'request-access' ? 'Request access' : 'Request info')}</button>}
        </div>
        {listy ? (
          <div className={`mt-6 divide-y divide-white/[0.06] border-y ${CALM.hairline}`}>
            {visible.map(({ b, s }, i) => (
              <button key={i} type="button" onClick={() => rt.open(detailType, s, { title: b, lines: cleanLines([s.sub, ...bulletsOf(s).filter((x) => x !== b)]) })} className="flex w-full items-center gap-5 py-4 text-left">
                <span className="w-8 text-sm tabular-nums text-slate-500">{String(i + 1).padStart(2, '0')}</span>
                <span className={`relative h-11 w-14 shrink-0 overflow-hidden rounded-md border ${CALM.hairline} ${art.cardTone}`} style={accentTint(10)}><CardDetail mode={art.mode} /></span>
                <span className="flex-1 text-[15px] font-medium text-white">{b}</span>
                <span className="text-slate-500">→</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
            {visible.map(({ b, s }, i) => (
              <button key={i} type="button" onClick={() => rt.open(detailType, s, { title: b, lines: cleanLines([s.sub, ...bulletsOf(s).filter((x) => x !== b)]) })} className={`group block overflow-hidden ${CALM.surface} text-left`}>
                <div className={`relative ${art.mediaTone}`} style={{ background: i % 3 === 0 ? 'linear-gradient(135deg, color-mix(in srgb, var(--acc) 12%, transparent), transparent)' : 'linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))' }}><CardDetail mode={art.mode} /></div>
                <div className="p-3"><p className="text-sm font-medium text-white">{b}</p><p className="mt-1 text-[11px] text-slate-500">View details →</p></div>
              </button>
            ))}
          </div>
        )}
        <p className="mt-4 text-[11px] text-slate-500">Front-end demo — {brief.type || 'sample'} content only, nothing is sent.</p>
      </div>
    </div>
  );
}

/** Premium content screen (use-cases / integrations / security / pricing / detail /
 *  financing / projects / before-after / quote) — cards + sticky action rail. */
function ContentScreen({ label, purpose, screenSections, allSections, brief, rt, onHome, kind }: {
  label: string; purpose: string; screenSections: S[]; allSections: S[]; brief: WebBuildBrief; rt: PreviewRuntime; onHome: () => void; kind: ScreenKind;
}) {
  const content = (screenSections.length ? screenSections : allSections).filter((s) => !/hero|footer/i.test(s.id));
  const lead = content[0];
  const cards = (content.length ? content : allSections).filter((s) => !/hero|footer/i.test(s.id)).slice(0, 6);
  const ctaType: InteractionActionType = kind === 'quote' ? 'open-quote-form' : kind === 'financing' ? 'request-info' : kind === 'pricing' ? 'open-contact-form' : 'open-detail-modal';
  const cta = allSections.find((s) => SHELL_RE.quote.test(`${s.id} ${s.name}`)) || allSections.find((s) => SHELL_RE.contact.test(`${s.id} ${s.name}`)) || cards[cards.length - 1];
  return (
    <div className="pb-16"><ScreenHeader label={label} purpose={purpose} onHome={onHome} />
      <div className="mx-auto mt-6 grid max-w-6xl gap-8 px-6 lg:grid-cols-[1fr_16rem]">
        <div className="min-w-0">
          {lead && <p className="max-w-2xl text-base leading-relaxed text-slate-300">{lead.sub || lead.headline || lead.name}</p>}
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {cards.map((s) => (
              <div key={s.id} className={`${CALM.panel} p-5`}>
                <div className="flex items-center gap-3">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg text-sm font-semibold text-white/90" style={accentTint(18)}>{(s.name || 'S').slice(0, 1).toUpperCase()}</span>
                  <p className="text-sm font-semibold text-white">{s.name || heading(s)}</p>
                </div>
                <ul className="mt-3 space-y-1.5">
                  {bulletsOf(s).slice(0, 3).map((b, i) => <li key={i} className={`flex gap-2 text-[13px] ${CALM.muted}`}><span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-white/25" />{b}</li>)}
                </ul>
              </div>
            ))}
          </div>
        </div>
        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          {cta && (
            <div className="rounded-[var(--pr)] border p-5" style={{ borderColor: 'color-mix(in srgb, var(--acc) 40%, transparent)', background: 'color-mix(in srgb, var(--acc) 7%, transparent)' }}>
              <p className="text-sm font-semibold leading-snug text-white">{heading(cta)}</p>
              {cta.sub && <p className="mt-2 text-sm text-slate-300">{cta.sub}</p>}
              <button type="button" onClick={() => rt.open(ctaType, cta)} className="mt-4 w-full rounded-lg py-2.5 text-center text-sm font-semibold text-white" style={{ background: 'var(--acc)' }}>{cta.cta || 'Continue'}</button>
              <p className="mt-2 text-center text-[11px] text-slate-500">Preview — nothing is sent.</p>
            </div>
          )}
        </aside>
      </div>
      <p className="mx-auto mt-6 max-w-6xl px-6 text-[11px] text-slate-500">Front-end demo — {brief.type || 'sample'} content only, nothing is sent.</p>
    </div>
  );
}

/** Dispatch a resolved screen to its premium composition. Never throws. */
function DemoShellScreen({ screen, allSections, brief, art, rt, onHome, heroVisual, animate }: {
  screen: PreviewShellScreen; allSections: S[]; brief: WebBuildBrief; art: WebBuildArtIdentity; rt: PreviewRuntime; onHome: () => void; heroVisual: HeroVisualType; animate: boolean;
}) {
  const screenSections = screen.sectionIds
    .map((id) => allSections.find((s) => s.id === id))
    .filter((s): s is S => !!s);
  const common = { label: screen.label, purpose: screen.purpose, screenSections, allSections, brief, art, rt, onHome };
  switch (screen.kind) {
    case 'product-demo':
    case 'chat':
      return <ProductDemoScreen {...common} heroVisual={heroVisual} animate={animate} chat={screen.kind === 'chat'} />;
    case 'catalog':
    case 'detail':
    case 'collection':
    case 'record':
    case 'access':
      return <GridScreen {...common} kind={screen.kind} />;
    default:
      return <ContentScreen {...common} kind={screen.kind} />;
  }
}

export default function WebBuildPreviewDocument({
  sectionItems: rawSectionItems, brief, interactionContract, visualAssetPlan,
}: {
  sectionItems: WebBuildSectionItem[];
  brief: WebBuildBrief;
  /** Phase 2: the strategy's Interaction Contract (optional → old builds render
   *  unchanged). Preview turns its actions into real in-app behaviour. */
  interactionContract?: InteractionContract;
  /** Phase 5 Visual Asset Plan (data only). Consumed by the premium visual layer
   *  with CSS/SVG. Optional → the standalone route / old builds fall back safely. */
  visualAssetPlan?: VisualAssetPlan;
}) {
  // Normalize every section item to a well-formed shape BEFORE any derived helper
  // runs. The section-level boundaries only cover their own renderers; the plan/
  // interaction/page derivations below run at ROOT render, before any boundary
  // mounts. A section persisted (old/malformed build) or opened full-screen
  // (WebBuildPreview.tsx renders this document with no boundary) without a string
  // `id` would reach deriveLayoutPlan, whose component-name step calls
  // String.prototype.replace on the id — throwing a TypeError at root render and
  // collapsing the ENTIRE preview to the drawer fallback. Synthesizing a stable
  // id/name here keeps every derived plan/anchor/page valid without masking any
  // real section-level error (those still surface in their own boundary).
  const sectionItems = useMemo<WebBuildSectionItem[]>(
    () => (Array.isArray(rawSectionItems) ? rawSectionItems : [])
      .filter((s): s is WebBuildSectionItem => !!s && typeof s === 'object')
      .map((s, i) => {
        const id = typeof s.id === 'string' && s.id.trim() ? s.id : `section-${i}`;
        const name = typeof s.name === 'string' && s.name.trim()
          ? s.name
          : (typeof s.id === 'string' && s.id.trim() ? s.id : `Section ${i + 1}`);
        return id === s.id && name === s.name ? s : { ...s, id, name };
      }),
    [rawSectionItems],
  );
  const ds = designTokensForBrief(brief);
  // The Layout Plan — the SAME pure derivation the file synthesizer uses — drives
  // hero composition, per-section variant, visual module, rhythm AND the visual
  // system (backdrop construction, surface treatment, panel shape, accent mode).
  const plan = deriveLayoutPlan(brief, sectionItems.map((s) => ({ id: s.id, name: s.name })));
  // The SAME art render identity the file synthesizer uses — so preview and
  // generated files apply the same concept-specific surface / proof language.
  const art = deriveWebBuildArtIdentity(brief);
  // Shared interaction routing (SAME as the generated files): real scroll anchors
  // for nav + CTAs, derived from the actual section ids + concept.
  const ctx = deriveInteraction(sectionItems.map((s) => s.id), art.mode);
  const nav = pickNavSections(sectionItems.map((s) => ({ id: s.id, name: s.name })), 6);
  const variantOf = (id: string): SectionVariant => plan.sectionVariants[id] || 'feature-grid';
  const vt = visualSystemTokens(plan.visualSystem);
  const reduce = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const [activePage, setActivePage] = useState('home');
  // Router-free page model + the sections the ACTIVE page renders (never empty).
  const pages = useMemo(() => buildPreviewPages(sectionItems, plan, nav, ctx), [sectionItems, plan, nav, ctx]);
  const byAnchor = useMemo(() => {
    const m = new Map<string, WebBuildSectionItem>();
    sectionItems.forEach((s) => m.set(anchorId(s.id), s));
    return m;
  }, [sectionItems]);

  // ── Phase 2: turn the strategy's Interaction Contract into real preview
  // behaviour. Re-derived against the FINAL rendered sections (so section-action
  // keys always match what we render) but SEEDED by the persisted contract's
  // concept category when the drawer passes it. Fully guarded — a malformed or
  // absent contract simply yields scroll-only behaviour (preview unchanged).
  const contract = useMemo<InteractionContract | null>(() => {
    try {
      const derived = deriveInteractionContract({
        brief,
        conceptCategory: interactionContract?.conceptCategory,
        ctaHierarchy: { primary: brief.primaryCTA, secondary: brief.secondaryCTA },
        sections: sectionItems.map((s) => ({ id: s.id, name: s.name })),
        artMode: art.mode,
        // Phase 6A: PRESERVE the model's own Website Experience Plan so re-deriving
        // the section-action map (for the final section ids) never discards it.
        experiencePlan: interactionContract ? {
          websiteExperienceModel: interactionContract.websiteExperienceModel,
          pageScreenModel: interactionContract.pageScreenModel,
          primaryWebsiteExperience: interactionContract.primaryWebsiteExperience,
          navigationModel: interactionContract.navigationModel,
          statefulDemoComponents: interactionContract.requiredStatefulComponents,
          // Phase 6B: carry the model's ENTRY FLOW decision so re-derivation honours
          // it (landing → demo/catalog/collection/quote, or straight in).
          entryFlowModel: interactionContract.entryFlowModel,
          landingRequired: typeof interactionContract.landingRequired === 'boolean'
            ? (interactionContract.landingRequired ? 'yes' : 'no') : undefined,
          entryScreen: interactionContract.entryScreen,
          postEntryScreen: interactionContract.postEntryScreen,
          primaryEntryCTA: interactionContract.primaryEntryCTA,
          secondaryEntryCTA: interactionContract.secondaryEntryCTA,
          navigationBehavior: interactionContract.navigationBehavior,
        } : undefined,
      });
      if (!interactionContract) return derived;
      // Merge the model-native fields back over the re-derived contract (the model's
      // own plan wins; the re-derivation only fills section-action keys + fallbacks).
      return {
        ...derived,
        websiteExperienceModel: interactionContract.websiteExperienceModel || derived.websiteExperienceModel,
        pageScreenModel: interactionContract.pageScreenModel || derived.pageScreenModel,
        primaryWebsiteExperience: interactionContract.primaryWebsiteExperience || derived.primaryWebsiteExperience,
        navigationModel: interactionContract.navigationModel || derived.navigationModel,
        experienceMode: interactionContract.experienceMode || derived.experienceMode,
        suggestedScreens: (interactionContract.suggestedScreens?.length ? interactionContract.suggestedScreens : derived.suggestedScreens),
        requiredStatefulComponents: uniqStr([...(interactionContract.requiredStatefulComponents || []), ...(derived.requiredStatefulComponents || [])]),
        conceptCategory: interactionContract.conceptCategory || derived.conceptCategory,
        // Phase 6B: prefer the model's own entry-flow decision; keep re-derived
        // screen tokens (initialScreenId/postEntryScreenId) so the Preview can map them.
        entryFlowModel: interactionContract.entryFlowModel || derived.entryFlowModel,
        landingRequired: typeof interactionContract.landingRequired === 'boolean' ? interactionContract.landingRequired : derived.landingRequired,
        entryScreen: interactionContract.entryScreen || derived.entryScreen,
        postEntryScreen: interactionContract.postEntryScreen || derived.postEntryScreen,
        primaryEntryCTA: interactionContract.primaryEntryCTA || derived.primaryEntryCTA,
        secondaryEntryCTA: interactionContract.secondaryEntryCTA || derived.secondaryEntryCTA,
        navigationBehavior: interactionContract.navigationBehavior || derived.navigationBehavior,
        initialScreenId: derived.initialScreenId || interactionContract.initialScreenId,
        postEntryScreenId: derived.postEntryScreenId || interactionContract.postEntryScreenId,
        entryAction: derived.entryAction || interactionContract.entryAction,
      };
    } catch { return interactionContract || null; }
  }, [interactionContract, sectionItems, brief, art.mode]);

  // Overlay state for the three preview surfaces. Guarded; never blocks render.
  const [chatDemo, setChatDemo] = useState<WebBuildSectionItem | null>(null);
  const [detail, setDetail] = useState<{ title: string; lines: string[] } | null>(null);
  const [form, setForm] = useState<{ type: LeadFormType; section?: WebBuildSectionItem } | null>(null);

  // Close overlays on Escape (accessibility). Self-cleaning; only bound when open.
  useEffect(() => {
    if (!chatDemo && !detail && !form) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setChatDemo(null); setDetail(null); setForm(null); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [chatDemo, detail, form]);

  const actionsFor = (rawId: string): InteractionAction[] => {
    const arr = contract?.sectionActions?.[rawId];
    return Array.isArray(arr) ? arr.filter((a): a is InteractionAction => !!a && typeof a === 'object') : [];
  };

  // Execute one contract action → open the matching overlay or scroll. Never throws,
  // never calls a backend, never fabricates data (uses only the section's real copy).
  function runContractAction(action: InteractionAction, section?: WebBuildSectionItem, payload?: { title?: string; lines?: string[] }) {
    try {
      if (!action || typeof action !== 'object') return;
      // Phase 6B: landing-gated entry. When the PRIMARY entry CTA is clicked from the
      // landing (Home) and the entry flow has a real post-entry screen, transition
      // INTO that internal screen (Product Demo / Chat / Catalog / Collection /
      // Projects) instead of only opening an overlay or scrolling. Local screen
      // switch only — no route, no backend. Secondary/supporting CTAs are untouched.
      const entryPrimary = contract?.entryAction || contract?.primaryAction;
      if (entryFlow.postEntryScreenId && activePage === 'home' && entryPrimary
        && (action.id === entryPrimary.id || (action.priority === 'primary' && action.type === entryPrimary.type))) {
        setActivePage(entryFlow.postEntryScreenId);
        return;
      }
      const owner = section
        || (action.sourceSectionId ? byAnchor.get(anchorId(action.sourceSectionId)) : undefined)
        || (action.targetSectionId ? byAnchor.get(anchorId(action.targetSectionId)) : undefined);
      switch (action.type) {
        case 'open-chat-demo': setChatDemo(owner || null); return;
        case 'open-detail-modal':
        case 'open-record-detail': {
          const title = (payload?.title || (owner ? heading(owner) : action.label) || 'Details').trim();
          const lines = (payload?.lines && payload.lines.length ? payload.lines : (owner ? bulletsOf(owner) : [])).slice(0, 8);
          setDetail({ title, lines });
          return;
        }
        case 'open-quote-form': setForm({ type: 'quote', section: owner }); return;
        case 'open-contact-form': setForm({ type: 'contact', section: owner }); return;
        case 'request-access': setForm({ type: 'access', section: owner }); return;
        case 'request-info':
        case 'submit-lead': setForm({ type: 'lead', section: owner }); return;
        default: {
          const target = action.targetSectionId ? anchorId(action.targetSectionId) : (owner ? anchorId(owner.id) : 'top');
          navigateToTarget(target || 'top');
        }
      }
    } catch { /* never break the preview over an interaction */ }
  }

  const rt: PreviewRuntime = {
    run: runContractAction,
    open: (type, section, payload) => runContractAction({ id: `${type}:open`, label: '', type, priority: 'primary', reason: '' }, section, payload),
    actionsFor,
    hasType: (id, type) => actionsFor(id).some((a) => a.type === type),
  };

  // Map every non-scroll contract action to its target ANCHOR, so a delegated CTA/
  // anchor click (hero primary, section CTA, conversion rail) runs the real action
  // instead of only scrolling. Highest-priority action wins per anchor.
  const actionByAnchor = useMemo(() => {
    const m = new Map<string, InteractionAction>();
    if (!contract) return m;
    const rank = (p: InteractionAction['priority']) => (p === 'primary' ? 3 : p === 'secondary' ? 2 : 1);
    const consider = (a?: InteractionAction) => {
      if (!a || typeof a !== 'object' || a.type === 'scroll-to-section') return;
      const key = anchorId(a.targetSectionId || a.sourceSectionId || '');
      if (!key || key === 'section') return;
      const prev = m.get(key);
      if (!prev || rank(a.priority) > rank(prev.priority)) m.set(key, a);
    };
    consider(contract.primaryAction);
    (contract.secondaryActions || []).forEach(consider);
    Object.values(contract.sectionActions || {}).forEach((arr) => (arr || []).forEach(consider));
    return m;
  }, [contract]);

  // ── Phase 4: resolve the model-native Preview shell from the PERSISTED contract
  // (which carries experienceMode / navigationModel / suggestedScreens from the
  // Website Experience Plan). Guarded; falls back to 'single-page' (existing
  // behaviour) when there is no rich plan or no matching sections. The demo screens
  // become extra internal tabs — no routes, no URL change.
  const shell = useMemo(() => resolvePreviewShell(contract || interactionContract, brief, sectionItems), [contract, interactionContract, brief, sectionItems]);
  const demoScreens = shell.screens;
  const activeDemoScreen = demoScreens.find((s) => s.id === activePage);
  // Phase 6A: the concept-specific hero visual (from the Phase-5 Visual Asset Plan
  // when plumbed, else a safe per-mode fallback) + whether ambient motion may run.
  const heroVisual = resolveHeroVisual(visualAssetPlan, art.mode);
  const ambientAllowed = !reduce && motionAmbientAllowed(deriveMotionFit(brief, art, plan));

  // ── Phase 6B: resolve the Entry Flow (landing → experience, or straight in) and
  // map it onto the real internal screens. Then initialize/repair activePage from
  // it: on first settle start where the model decided; on later shell/contract
  // changes keep the current page if still valid, else reset to the entry page.
  const entryFlow = useMemo(() => resolveEntryFlow(contract, shell, pages), [contract, shell, pages]);
  const didInitEntry = useRef(false);
  useEffect(() => {
    setActivePage((cur) => {
      const valid = cur === 'home' || pages.some((p) => p.id === cur) || demoScreens.some((s) => s.id === cur);
      if (!didInitEntry.current) { didInitEntry.current = true; return entryFlow.initialActivePage; }
      return valid ? cur : entryFlow.initialActivePage;
    });
  }, [entryFlow.initialActivePage, demoScreens, pages]);

  // ── Phase 6C: disciplined nav (Home + ≤5, one clear experience item, overflow
  // for the rest) + the landing demo teaser eligibility (AI/SaaS product-demo/chat
  // only). Both pure/guarded — malformed input falls back to safe defaults.
  const previewNav = useMemo(() => resolvePreviewNavigation(pages, demoScreens, entryFlow), [pages, demoScreens, entryFlow]);
  const teaserScreen = demoScreens.find((s) => s.id === entryFlow.postEntryScreenId)
    || demoScreens.find((s) => s.kind === 'chat' || s.kind === 'product-demo');
  const teaserChat = teaserScreen?.kind === 'chat';
  const showLandingTeaser = !!teaserScreen && (teaserScreen.kind === 'chat' || teaserScreen.kind === 'product-demo');
  // Anchors that represent "enter the experience" intent from the landing — the
  // conversion target, the primary/entry action target, and the demo section.
  const entryAnchors = useMemo(() => {
    const set = new Set<string>();
    try {
      const add = (id?: string) => { const a = anchorId((id || '').replace(/^#/, '')); if (a && a !== 'section') set.add(a); };
      add(ctx.conversionTarget);
      const pa = contract?.entryAction || contract?.primaryAction;
      add(pa?.targetSectionId);
      const demoSec = sectionItems.find((s) => /demo|chat|assistant|playground|product/i.test(`${s.id} ${s.name || ''}`));
      add(demoSec?.id);
    } catch { /* ignore — empty set → no fallback entry */ }
    return set;
  }, [ctx, contract, sectionItems]);

  // `current`/`pages[0]` must never be assumed present: buildPreviewPages always
  // returns a Home page today, but a defensive Home fallback (synthesized from the
  // real section anchors) guarantees the preview never throws on an empty model.
  const homeFallback: PreviewPage = { id: 'home', label: 'Home', sectionIds: sectionItems.map((s) => anchorId(s.id)) };
  const current = pages.find((p) => p.id === activePage) || pages[0] || homeFallback;
  const activeItems = current.sectionIds.map((id) => byAnchor.get(id)).filter(Boolean) as WebBuildSectionItem[];
  const renderItems = activeItems.length ? activeItems : ((pages[0]?.sectionIds || homeFallback.sectionIds).map((id) => byAnchor.get(id)).filter(Boolean) as WebBuildSectionItem[]);

  // Host-app isolation + page routing: an internal link click NEVER reaches the
  // host router or changes the URL. A resolved target switches to the page that
  // owns it, then scrolls to it once that page has rendered. Externals pass through.
  function handlePreviewLinkClick(event: MouseEvent<HTMLDivElement>) {
    const link = (event.target as HTMLElement).closest('a');
    if (!link) return;
    const raw = link.getAttribute('href') || '';
    if (!raw) return;
    if (/^(https?:|mailto:|tel:)/i.test(raw)) return; // real external links pass through
    event.preventDefault();
    const targetId = resolvePreviewTargetId(raw, sectionItems, ctx);
    if (!targetId) return; // no matching section → do nothing (never navigate host)
    // Phase 6C: reliable landing → experience. On Home, a click whose target is the
    // primary CTA / conversion target / hero demo anchor enters the post-entry
    // screen — even when no matching contract action exists. Only entry intent is
    // hijacked (entryAnchors), never every link; a local screen switch, no route.
    if (activePage === 'home' && entryFlow.postEntryScreenId && targetId !== 'top' && entryAnchors.has(targetId)) {
      setActivePage(entryFlow.postEntryScreenId);
      return;
    }
    // Phase 2: if the resolved target has a real contract action (open chat demo /
    // form / detail …), run it instead of only scrolling. Anchor scroll is the
    // fallback whenever there is no non-scroll action for the target.
    const contractAction = targetId !== 'top' ? actionByAnchor.get(targetId) : undefined;
    if (contractAction) { runContractAction(contractAction, byAnchor.get(targetId)); return; }
    navigateToTarget(targetId);
  }

  // Single place that switches to the page owning a section, then scrolls to it —
  // used by CTA links, page tabs' chips, the page index and the conversion rail.
  // Never touches the host router or the URL. (Hoisted, so the handler above can
  // call it.)
  function navigateToTarget(targetId: string) {
    const behavior: ScrollBehavior = reduce ? 'auto' : 'smooth';
    if (targetId === 'top') {
      setActivePage('home');
      window.setTimeout(() => rootRef.current?.scrollIntoView({ behavior, block: 'start' }), 0);
      return;
    }
    const owner = pages.find((p) => p.sectionIds.includes(targetId));
    setActivePage(owner ? owner.id : 'home');
    // Scroll after the (possibly new) active page has committed the target section.
    window.setTimeout(() => {
      const root = rootRef.current;
      let el: HTMLElement | null = null;
      if (root && typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
        try { el = root.querySelector(`#${CSS.escape(targetId)}`); } catch { el = null; }
      }
      if (!el) el = document.getElementById(targetId);
      el?.scrollIntoView({ behavior, block: 'start' });
    }, 0);
  }

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

  // If — for any reason — the active page resolves to no renderable sections,
  // show a safe, non-blank preview built from the real section names instead of
  // rendering an empty (black) document. No fabricated copy.
  if (!renderItems.length) {
    const names = sectionItems.map((s) => s?.name).filter(Boolean).slice(0, 4) as string[];
    return (
      <div ref={rootRef} id="top" className="text-slate-200 antialiased" style={rootStyle}>
        <div className="mx-auto max-w-lg px-6 py-20 text-center">
          {brief.type && <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-white/45">{brief.type}</p>}
          <p className="mt-3 text-lg font-semibold text-white" style={{ fontFamily: 'var(--hf)' }}>{names[0] || brief.type || 'Preview'}</p>
          {names.length > 1 && <p className="mt-3 text-sm text-slate-400">{names.slice(1).join(' · ')}</p>}
        </div>
      </div>
    );
  }

  const banded = plan.rhythm === 'alternating' || plan.rhythm === 'editorial';
  const kindOf = (rawId: string) => plan.sections.find((p) => p.id === rawId)?.kind;

  // Render one section (hero / footer / content variant) — shared by Home and the
  // focused page shell, so section ids, scroll-margin and variants stay identical.
  let contentIdx = 0;
  const renderSection = (s: WebBuildSectionItem, idx = 0): ReactElement => {
    // Never assume the section item is well-formed: guard id/name/kind and fall
    // back to safe hero/variant renderers + default padding so a malformed
    // section can't throw before it even reaches its own error boundary.
    const rawId = (s && s.id) || '';
    const sid = anchorId(rawId);
    const key = rawId || `section-${idx}`;
    const label = (s && (s.name || s.headline)) || sid;
    const kind = s ? kindOf(rawId) : undefined;
    let inner: ReactElement;
    if (!s) {
      inner = <div />;
    } else if (kind === 'hero') {
      const Hero = HEROES[plan.heroComposition] || HEROES['split-editorial'];
      inner = (
        <div id={sid} style={{ scrollMarginTop: 72 }}>
          <Hero s={s} brief={brief} plan={plan} ctx={ctx} />
          {/* Concept-specific proof rail, directly under the hero. */}
          <div className="relative z-10 mx-auto max-w-6xl px-6 pb-6">
            <HeroProof brief={brief} />
          </div>
        </div>
      );
    } else if (kind === 'footer') {
      inner = <Footer s={s} />;
    } else {
      const Render = VARIANTS[variantOf(rawId)] || VARIANTS['feature-grid'];
      const i = contentIdx++;
      const band = banded && i % 2 === 1;
      const pad = PAD[plan.contentDensity] || PAD.comfortable;
      inner = (
        <section id={sid} style={{ scrollMarginTop: 72, ...(band ? { background: 'rgba(255,255,255,0.015)' } : {}) }} className={`relative ${pad}`}>
          {Render({ s, plan, index: i, art, ctx, rt })}
        </section>
      );
    }
    // Isolate EVERY section (hero / footer / content variant) so one bad
    // renderer only shows its own compact fallback — the rest stays usable.
    return <PreviewSectionErrorBoundary key={key} label={label}>{inner}</PreviewSectionErrorBoundary>;
  };

  // Focused-page composition (non-home): a real page shell — header + summary +
  // page index + conversion rail + main content — from REAL section copy only.
  const isHome = current.id === 'home';
  const contentSections = renderItems.filter((s) => { const k = kindOf(s.id); return k !== 'hero' && k !== 'footer'; });
  const footerSection = renderItems.find((s) => kindOf(s.id) === 'footer');
  const lead = contentSections[0];
  const subtitle = ((lead && (lead.sub || lead.purpose || lead.copyPreview)) || '').trim();
  const brand = (brief.type || '').trim();
  const convId = (ctx.conversionTarget || '').replace(/^#/, '');
  const convItem = convId ? byAnchor.get(convId) : undefined;
  const convCta = (convItem?.cta || '').trim();

  return (
    <div ref={rootRef} id="top" onClick={handlePreviewLinkClick} className="text-slate-200 antialiased" style={{ ...rootStyle, scrollBehavior: 'smooth' }}>
      {previewNav.primaryNavItems.length > 0 && (
        <header className="sticky top-0 z-50 border-b border-white/[0.06] bg-black/30 backdrop-blur">
          {/* Phase 6C nav behaviour; Phase 6E polish — active item gets a subtle
              accent underline (not bold+loud), overflow is a muted hairline group. */}
          <nav className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-6 py-3" aria-label="Primary">
            <button type="button" onClick={() => setActivePage('home')} className="text-sm font-semibold text-white">{brand || 'Home'}</button>
            <div className="hidden flex-wrap items-center gap-5 text-sm sm:flex">
              {previewNav.primaryNavItems.map((item) => {
                const active = activePage === item.targetPageId;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setActivePage(item.targetPageId)}
                    aria-current={active ? 'page' : undefined}
                    className={active ? 'pb-0.5 text-white' : 'pb-0.5 text-slate-400 transition hover:text-white'}
                    style={active ? { boxShadow: 'inset 0 -2px 0 var(--acc)' } : undefined}
                  >
                    {item.label}
                  </button>
                );
              })}
              {previewNav.overflowItems.length > 0 && (
                <span className="flex flex-wrap items-center gap-4 border-l border-white/[0.06] pl-4 text-[13px] text-slate-500">
                  {previewNav.overflowItems.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setActivePage(item.targetPageId)}
                      aria-current={activePage === item.targetPageId ? 'page' : undefined}
                      className={activePage === item.targetPageId ? 'text-white' : 'transition hover:text-white'}
                    >
                      {item.label}
                    </button>
                  ))}
                </span>
              )}
            </div>
          </nav>
        </header>
      )}

      {activeDemoScreen ? (
        <PreviewSectionErrorBoundary key={activeDemoScreen.id} label={activeDemoScreen.label}>
          <DemoShellScreen
            screen={activeDemoScreen}
            allSections={sectionItems}
            brief={brief}
            art={art}
            rt={rt}
            onHome={() => setActivePage('home')}
            heroVisual={heroVisual}
            animate={ambientAllowed}
          />
        </PreviewSectionErrorBoundary>
      ) : isHome ? (
        <div key={current.id} className="relative">
          {/* Phase 6A: concept-specific ambient visual (CSS/SVG) behind the home
              content. Phase 6E: kept subtle so the headline always dominates. */}
          <PremiumVisualLayer type={heroVisual} animate={ambientAllowed} className="opacity-25" />
          <div className="relative z-10">
            {renderItems.map((s, i) => (
              <Fragment key={(s && s.id) || `home-${i}`}>
                {renderSection(s, i)}
                {/* Phase 6C: compact landing demo teaser right after the hero (AI/SaaS
                    product-demo/chat only). Its CTA enters the full demo screen. */}
                {i === 0 && showLandingTeaser && teaserScreen && (
                  <LandingDemoTeaser
                    sections={sectionItems}
                    brief={brief}
                    chat={teaserChat}
                    ctaLabel={entryFlow.primaryEntryCTA || (teaserChat ? 'Open chat experience' : 'Open product demo')}
                    onEnter={() => setActivePage(teaserScreen.id)}
                  />
                )}
              </Fragment>
            ))}
          </div>
        </div>
      ) : (
        <div key={current.id}>
          {/* Page header (real copy only — no fabricated descriptions). */}
          <div className="mx-auto max-w-6xl px-6 pt-10">
            <button type="button" onClick={() => setActivePage('home')} className="text-sm text-slate-400 transition hover:text-white">&larr; Home</button>
            {brand && <p className="mt-4 text-[11px] font-medium uppercase tracking-[0.25em] text-white/45">{brand}</p>}
            <h1 className="mt-2 text-3xl font-semibold text-white sm:text-4xl" style={{ fontFamily: 'var(--hf)', letterSpacing: 'var(--tr)' }}>{current.label}</h1>
            {subtitle && <p className="mt-3 max-w-2xl text-base leading-relaxed text-slate-300">{subtitle}</p>}
            {contentSections.length > 1 && (
              <div className="mt-5 flex flex-wrap gap-2">
                {contentSections.map((s) => (
                  <button key={s.id} type="button" onClick={() => navigateToTarget(anchorId(s.id))}
                    className="rounded-full border border-[color:var(--bd)] bg-white/[0.03] px-3 py-1 text-xs text-slate-300 transition hover:text-white">
                    {s.name || heading(s)}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Content grid: main column = sections, side column = index + action rail. */}
          <div className="mx-auto mt-6 grid max-w-6xl gap-8 px-6 lg:grid-cols-[1fr_16rem]">
            <div className="min-w-0 space-y-2">
              {contentSections.map(renderSection)}
            </div>
            <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
              {contentSections.length > 0 && (
                <nav className="rounded-[var(--pr)] border border-[color:var(--bd)] bg-[var(--sf)] p-4" aria-label="On this page">
                  <p className="text-[11px] font-medium uppercase tracking-widest text-white/45">On this page</p>
                  <ul className="mt-3 space-y-1.5">
                    {contentSections.map((s) => (
                      <li key={s.id}>
                        <button type="button" onClick={() => navigateToTarget(anchorId(s.id))} className="text-left text-sm text-slate-300 transition hover:text-white">
                          {s.name || heading(s)}
                        </button>
                      </li>
                    ))}
                  </ul>
                </nav>
              )}
              {convItem && (
                <div className="rounded-[var(--pr)] border p-5" style={{ borderColor: 'color-mix(in srgb, var(--acc) 40%, transparent)', background: 'color-mix(in srgb, var(--acc) 7%, transparent)' }}>
                  <p className="text-sm font-semibold leading-snug text-white">{heading(convItem)}</p>
                  <button type="button" onClick={() => navigateToTarget(convId)} className="mt-3 w-full rounded-lg py-2 text-center text-sm font-semibold text-white" style={{ background: 'var(--acc)' }}>
                    {convCta || 'View'}
                  </button>
                </div>
              )}
            </aside>
          </div>

          {footerSection && renderSection(footerSection)}
        </div>
      )}

      {/* Phase 2 interaction overlays — rendered inside the themed root so they
          inherit --acc/--sf/--bd/etc. Guarded by their own state; the section
          error boundaries and page shell above are untouched. */}
      {chatDemo && <ChatDemoPanel section={chatDemo} brief={brief} onClose={() => setChatDemo(null)} />}
      {detail && <DetailModal title={detail.title} lines={detail.lines} onClose={() => setDetail(null)} />}
      {form && <LeadFormPanel type={form.type} section={form.section} onClose={() => setForm(null)} />}
    </div>
  );
}
