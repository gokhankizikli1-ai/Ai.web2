/**
 * Web Build LAYOUT PLAN layer.
 *
 * The sameness problem was NOT research or color — it was composition. Every
 * build rendered one centered hero and one card grid because structure was
 * chosen by section *kind*, never by the *strategy*. This module fixes that at
 * the architecture level.
 *
 * `deriveLayoutPlan(brief, sections)` turns the strategy (via the already
 * strategy-driven design system + archetype) into a concrete, structural plan:
 * which hero composition to use, which visual module is primary, how each
 * section is composed, the page rhythm, and where CTAs/trust land. It is a PURE,
 * DETERMINISTIC function of its inputs — so the preview renderer and the file
 * synthesizer can each derive it independently and always agree (Part 7). No
 * persistence or prop-threading is required, and old saved builds recompute the
 * exact same plan (backward compatible).
 *
 * Nothing here is a fixed industry template or tied to a specific prompt: the
 * primary signal is the model's own strategy words (through the archetype), with
 * deterministic, hash-based fallbacks only when the strategy is weak.
 */
import { deriveDesignSystemFromStrategy, type Density, type LayoutArchetype } from '@/lib/webBuildDesignSystem';
import type { WebBuildBrief } from '@/lib/webBuildApi';

/* ── Section kind classifier (single source of truth) ─────────────────────
 * Lives here (not in webBuildFiles) so the plan layer owns section semantics
 * and neither module imports the other in a cycle. Re-exported by webBuildFiles
 * for existing callers. */
export type SectionKind =
  | 'hero' | 'gallery' | 'beforeAfter' | 'productDemo' | 'workflow' | 'metrics'
  | 'integrations' | 'inventory' | 'financing' | 'pricing' | 'menu'
  | 'features' | 'testimonial' | 'faq' | 'cta' | 'footer' | 'generic';

export function sectionKind(id: string, sectionName: string): SectionKind {
  const k = `${id} ${sectionName}`.toLowerCase();
  if (/hero/.test(k)) return 'hero';
  if (/footer/.test(k)) return 'footer';
  // Concept CTA sections (explicit ids) — checked early so e.g. "start-project" is
  // a CTA, not a gallery from the word "project".
  if (/researcher-access|quote-cta|request-quote|start-project|donation|volunteers|tickets|pricing-cart-cta/.test(k)) return 'cta';
  // "programs" is a card grid, never a priced plan (avoids fabricated prices).
  if (/\bprograms?\b|programlar/.test(k)) return 'features';
  if (/before.?after|önce.?sonra/.test(k)) return 'beforeAfter';
  if (/product.?demo|chatbot|chat|dashboard|demo/.test(k)) return 'productDemo';
  if (/workflow|how.?it.?works|process|süreç|adım|nasıl|agenda|ajanda|curriculum|müfredat/.test(k)) return 'workflow';
  if (/metric|result|stat|sonuç|rakam/.test(k)) return 'metrics';
  if (/integration|entegrasyon/.test(k)) return 'integrations';
  if (/inventory|vehicle|featured.?(car|vehicle)|araç|araba|envanter/.test(k)) return 'inventory';
  if (/financ|finans|kredi/.test(k)) return 'financing';
  if (/pricing|price|plan|fiyat|paket|enroll/.test(k)) return 'pricing';
  if (/menu|menü/.test(k)) return 'menu';
  if (/gallery|galeri|collection|koleksiyon|material|malzeme|portfolio|portfolyo|proje|project|work|iş|document|belge|filter|filtre|ambien|ambiyans|venue|mekan|speaker|konuşmacı|case.?stud|vaka|featured|öne çıkan/.test(k)) return 'gallery';
  if (/testimonial|social|proof|review|yorum|referans|provenance|menşe|credential|lisans|certif|sertifika|akredit|sponsor|impact|etki|curation|küratör|shipping|kargo|iade/.test(k)) return 'testimonial';
  if (/faq|sıkça|soru/.test(k)) return 'faq';
  if (/cta|final|contact|book|appointment|randevu|form|reservation|rezervasyon|iletişim/.test(k)) return 'cta';
  if (/feature|service|benefit|hizmet|özellik|capabilit|yetenek|yetkinlik|use.?case|senaryo|specification|teknik özellik|outcome|kazanım/.test(k)) return 'features';
  return 'generic';
}

/* ── Plan vocabulary ──────────────────────────────────────────────────── */

/** A reusable hero LAYOUT primitive, selected by strategy — not a demo site. */
export type HeroComposition =
  | 'split-editorial' | 'asymmetric-visual' | 'dashboard-product' | 'immersive-full-bleed'
  | 'membership-application' | 'catalog-collection' | 'data-map' | 'luxury-service'
  | 'story-editorial' | 'event-experience' | 'centered';

/** A structural visual module embedded in hero/key sections (never decoration). */
export type VisualModule =
  | 'data-dashboard' | 'membership-pass' | 'catalog-archive' | 'spatial-floorplan'
  | 'product-showcase' | 'editorial-story' | 'reservation-form' | 'timeline-process'
  | 'comparison' | 'contour-terrain';

/** How a content section is composed — the same "Page Sections" content can be
 *  shown as any of these depending on the strategy. */
export type SectionVariant =
  | 'feature-grid' | 'editorial-split' | 'process-timeline' | 'proof-strip'
  | 'catalog-grid' | 'comparison' | 'application-form' | 'dashboard-data'
  | 'quote-story' | 'collection-archive' | 'spatial-floorplan' | 'pricing-membership'
  | 'faq-cta' | 'showcase' | 'filter-search';

export type NavigationStyle = 'minimal' | 'standard' | 'sidebar' | 'centered-pill' | 'split';
export type CTAPlacement = 'hero-inline' | 'sticky' | 'section-embedded' | 'final-focus' | 'floating-card';
export type TrustPlacement = 'hero-proof' | 'strip-below-hero' | 'inline-sections' | 'pre-footer';
export type RhythmPattern = 'even' | 'alternating' | 'editorial' | 'staggered';
export type MotionPattern = 'minimal' | 'reveal' | 'parallax' | 'kinetic';

/* ── Visual system (the missing layer) ────────────────────────────────────
 * Composition (hero/section variants) already varied, but every build shared
 * ONE visual language: aurora+grid background, glass cards, centered headings.
 * The visual system makes the *look* strategy-driven too, so different ideas no
 * longer just rearrange the same dark panels. All values are dark-safe so no
 * contrast regressions; the difference is in construction, surface and rhythm. */

/** How the page/hero backdrop is constructed (not decoration — it sets the
 *  whole first impression). */
export type BackgroundMotif =
  | 'aurora-grid' | 'blueprint' | 'mesh-duotone' | 'spotlight' | 'editorial-rules'
  | 'dot-matrix' | 'diagonal-split' | 'flat-void' | 'gradient-veil' | 'terrain-lines';

/** The dominant surface treatment for every card/panel/module frame. */
export type SurfaceStyle = 'glass' | 'solid' | 'outline' | 'elevated' | 'flat';

/** Corner language for panels. */
export type PanelShape = 'rounded' | 'soft' | 'sharp';

/** How hard the accent is used (glows vs mono line-work). */
export type AccentMode = 'vivid' | 'duotone' | 'mono';

export type HeadingAlign = 'left' | 'center';

export interface VisualSystem {
  background: BackgroundMotif;
  surface: SurfaceStyle;
  panelShape: PanelShape;
  accentMode: AccentMode;
  headingAlign: HeadingAlign;
  /** Human, real description of the visual metaphor for the timeline. */
  motif: string;
}

export interface PlanSection {
  id: string;
  name: string;
  kind: SectionKind;
  variant: SectionVariant;
  /** True for the one content section that hosts the primary visual module. */
  hostsPrimaryModule?: boolean;
}

export interface WebBuildLayoutPlan {
  archetype: LayoutArchetype;
  /** Human, real description of how the page is organized (activity/plan copy). */
  pageArchitecture: string;
  heroComposition: HeroComposition;
  navigationStyle: NavigationStyle;
  /** Ordered section ids (the composition order for App.tsx / preview). */
  sectionSequence: string[];
  /** id → chosen composition variant. */
  sectionVariants: Record<string, SectionVariant>;
  /** Fully-resolved sections (kind + variant), in sequence. */
  sections: PlanSection[];
  primaryVisualModule: VisualModule;
  secondaryVisualModules: VisualModule[];
  contentDensity: Density;
  rhythm: RhythmPattern;
  ctaPlacement: CTAPlacement;
  trustPlacement: TrustPlacement;
  motionPattern: MotionPattern;
  /** The strategy-driven visual language (backdrop, surface, accent, heading). */
  visualSystem: VisualSystem;
  /** Component names planned for the generated project. */
  componentPlan: string[];
  /** File paths planned for the generated project. */
  filePlan: string[];
  /** True when the anti-sameness guard nudged a weak plan to a distinct one. */
  diversityCorrected: boolean;
}

interface Blueprint {
  hero: HeroComposition;
  module: VisualModule;
  nav: NavigationStyle;
  cta: CTAPlacement;
  trust: TrustPlacement;
  rhythm: RhythmPattern;
}

/**
 * Archetype → structural blueprint. The archetype itself is derived from the
 * model's strategy words (webBuildDesignSystem), so this table is strategy-driven,
 * not a per-industry template. Note `standard` deliberately does NOT default to a
 * centered hero + card grid — the old generic outcome is gone.
 */
const BLUEPRINT: Record<LayoutArchetype, Blueprint> = {
  editorial:        { hero: 'story-editorial',       module: 'editorial-story',  nav: 'minimal',       cta: 'section-embedded', trust: 'inline-sections',  rhythm: 'editorial' },
  dashboard:        { hero: 'dashboard-product',      module: 'data-dashboard',   nav: 'split',         cta: 'hero-inline',      trust: 'strip-below-hero', rhythm: 'staggered' },
  marketplace:      { hero: 'catalog-collection',     module: 'catalog-archive',  nav: 'standard',      cta: 'sticky',           trust: 'strip-below-hero', rhythm: 'even' },
  membership:       { hero: 'membership-application',  module: 'membership-pass',  nav: 'centered-pill', cta: 'floating-card',    trust: 'pre-footer',       rhythm: 'alternating' },
  hospitality:      { hero: 'luxury-service',          module: 'reservation-form', nav: 'centered-pill', cta: 'final-focus',      trust: 'inline-sections',  rhythm: 'editorial' },
  'data-platform':  { hero: 'data-map',                module: 'data-dashboard',   nav: 'split',         cta: 'hero-inline',      trust: 'strip-below-hero', rhythm: 'staggered' },
  archive:          { hero: 'catalog-collection',     module: 'catalog-archive',  nav: 'sidebar',       cta: 'section-embedded', trust: 'inline-sections',  rhythm: 'even' },
  'luxury-service': { hero: 'luxury-service',          module: 'editorial-story',  nav: 'minimal',       cta: 'final-focus',      trust: 'pre-footer',       rhythm: 'editorial' },
  community:        { hero: 'split-editorial',         module: 'membership-pass',  nav: 'standard',      cta: 'floating-card',    trust: 'inline-sections',  rhythm: 'alternating' },
  event:            { hero: 'event-experience',        module: 'timeline-process', nav: 'centered-pill', cta: 'sticky',           trust: 'strip-below-hero', rhythm: 'staggered' },
  portfolio:        { hero: 'asymmetric-visual',       module: 'editorial-story',  nav: 'minimal',       cta: 'section-embedded', trust: 'inline-sections',  rhythm: 'alternating' },
  technical:        { hero: 'dashboard-product',       module: 'data-dashboard',   nav: 'split',         cta: 'hero-inline',      trust: 'strip-below-hero', rhythm: 'staggered' },
  standard:         { hero: 'split-editorial',         module: 'product-showcase', nav: 'standard',      cta: 'hero-inline',      trust: 'strip-below-hero', rhythm: 'alternating' },
};

/** Archetype → visual language. Driven by the same strategy-derived archetype,
 *  so a dashboard reads as a technical blueprint, an editorial brand as ruled
 *  paper, a membership as a spotlit elevated pass — not all as glass-on-aurora. */
const VISUAL_BLUEPRINT: Record<LayoutArchetype, VisualSystem> = {
  editorial:        { background: 'editorial-rules', surface: 'flat',     panelShape: 'sharp',   accentMode: 'mono',    headingAlign: 'left',   motif: 'ruled editorial paper' },
  dashboard:        { background: 'blueprint',       surface: 'outline',  panelShape: 'soft',    accentMode: 'vivid',   headingAlign: 'left',   motif: 'technical blueprint grid' },
  marketplace:      { background: 'gradient-veil',   surface: 'solid',    panelShape: 'rounded', accentMode: 'duotone', headingAlign: 'center', motif: 'retail gradient veil' },
  membership:       { background: 'spotlight',       surface: 'elevated', panelShape: 'rounded', accentMode: 'vivid',   headingAlign: 'center', motif: 'spotlit membership stage' },
  hospitality:      { background: 'gradient-veil',   surface: 'glass',    panelShape: 'soft',    accentMode: 'duotone', headingAlign: 'center', motif: 'warm ambient veil' },
  'data-platform':  { background: 'dot-matrix',      surface: 'outline',  panelShape: 'sharp',   accentMode: 'vivid',   headingAlign: 'left',   motif: 'data dot-matrix field' },
  archive:          { background: 'editorial-rules', surface: 'outline',  panelShape: 'sharp',   accentMode: 'mono',    headingAlign: 'left',   motif: 'museum archive index' },
  'luxury-service': { background: 'spotlight',       surface: 'flat',     panelShape: 'soft',    accentMode: 'mono',    headingAlign: 'center', motif: 'quiet luxury spotlight' },
  community:        { background: 'mesh-duotone',    surface: 'solid',    panelShape: 'rounded', accentMode: 'duotone', headingAlign: 'left',   motif: 'connected duotone mesh' },
  event:            { background: 'diagonal-split',  surface: 'elevated', panelShape: 'soft',    accentMode: 'vivid',   headingAlign: 'center', motif: 'kinetic diagonal energy' },
  portfolio:        { background: 'flat-void',       surface: 'flat',     panelShape: 'sharp',   accentMode: 'mono',    headingAlign: 'left',   motif: 'gallery negative space' },
  technical:        { background: 'blueprint',       surface: 'outline',  panelShape: 'sharp',   accentMode: 'vivid',   headingAlign: 'left',   motif: 'engineering schematic' },
  standard:         { background: 'aurora-grid',     surface: 'glass',    panelShape: 'rounded', accentMode: 'duotone', headingAlign: 'center', motif: 'soft aurora grid' },
};

/** Rotations for the anti-sameness guard — deliberately EXCLUDE the generic
 *  aurora-grid / glass defaults so a corrected plan never reads as the template. */
const BG_ROTATION: BackgroundMotif[] = [
  'blueprint', 'mesh-duotone', 'spotlight', 'editorial-rules', 'dot-matrix', 'diagonal-split', 'gradient-veil',
];
const SURFACE_ROTATION: SurfaceStyle[] = ['outline', 'solid', 'elevated', 'flat'];
const SHAPE_ROTATION: PanelShape[] = ['soft', 'sharp', 'rounded'];
const ACCENT_ROTATION: AccentMode[] = ['vivid', 'mono', 'duotone'];

/** The primary visual module a specific section KIND naturally hosts, used to
 *  populate secondary modules from what the site actually contains. */
const MODULE_FOR_KIND: Partial<Record<SectionKind, VisualModule>> = {
  metrics: 'data-dashboard',
  productDemo: 'data-dashboard',
  gallery: 'catalog-archive',
  inventory: 'catalog-archive',
  menu: 'catalog-archive',
  beforeAfter: 'comparison',
  workflow: 'timeline-process',
  pricing: 'membership-pass',
  testimonial: 'editorial-story',
};

/** Deterministic 32-bit hash (FNV-1a) — no Date/Math.random, so plans are
 *  stable and reproducible for the same idea. */
function hashText(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h | 0);
}

const pascal = (id: string) => {
  const p = id.replace(/(^|[-_ ]+)(\w)/g, (_, __, c) => c.toUpperCase()).replace(/[^a-zA-Z0-9]/g, '');
  return /^[a-z]/.test(p) ? p.charAt(0).toUpperCase() + p.slice(1) : (p || 'Section');
};

/** How a *content* section (features/services/generic) is composed for a given
 *  archetype. This is the main lever against "everything is a card grid": the
 *  identical Page-Sections content renders as an editorial split for an editorial
 *  brand, a data panel for a dashboard, a catalog for a marketplace, etc. */
function contentVariantFor(arch: LayoutArchetype, index: number): SectionVariant {
  switch (arch) {
    case 'editorial':
    case 'luxury-service':
    case 'hospitality':
      return index % 2 === 0 ? 'editorial-split' : 'quote-story';
    case 'portfolio':
      return index % 2 === 0 ? 'editorial-split' : 'showcase';
    case 'dashboard':
    case 'data-platform':
    case 'technical':
      return index % 2 === 0 ? 'dashboard-data' : 'feature-grid';
    case 'marketplace':
    case 'archive':
      return 'catalog-grid';
    case 'membership':
    case 'community':
      return index % 2 === 0 ? 'proof-strip' : 'editorial-split';
    case 'event':
      return index % 2 === 0 ? 'showcase' : 'feature-grid';
    case 'standard':
    default:
      return index % 2 === 0 ? 'editorial-split' : 'feature-grid';
  }
}

/**
 * Refine a resolved variant using the section's concrete ID/name so concept
 * sections render a richer, more accurate surface than their kind alone implies.
 * Only remaps to EXISTING variants (no new invalid kinds) and is applied to both
 * the preview and the file synthesizer (they share this plan), so they stay in
 * lockstep. Never fabricates content — it only picks a better layout shell.
 */
function refineVariantById(id: string, name: string, variant: SectionVariant): SectionVariant {
  const k = `${id} ${name}`.toLowerCase();
  // Search / filter surfaces → a real filter+search UI, not a card grid.
  if (/research.?filter|\bfilters?\b|\bsearch\b|arama|filtre/.test(k)) return 'filter-search';
  // Image-first catalog / gallery surfaces (projects, materials, collections).
  if (/project.?gallery|collection.?index|document.?types|\bmaterials?\b|malzeme|featured.?product|selected.?work|proje.?galeri/.test(k)) return 'catalog-grid';
  // Quote / consultation / request surfaces → a form-like request panel.
  if (/quote.?cta|request.?quote|consultation|danış|teklif.?al|reservation|rezervasyon/.test(k)) return 'application-form';
  return variant;
}

/** Resolve a section's composition variant from its kind + the archetype. */
function variantForSection(kind: SectionKind, arch: LayoutArchetype, contentIndex: number): SectionVariant {
  switch (kind) {
    case 'footer':      return 'faq-cta';
    case 'cta':         return (arch === 'membership' || arch === 'hospitality' || arch === 'community') ? 'application-form' : 'faq-cta';
    case 'faq':         return 'faq-cta';
    case 'pricing':     return 'pricing-membership';
    case 'workflow':    return 'process-timeline';
    case 'metrics':     return 'dashboard-data';
    case 'productDemo': return 'dashboard-data';
    case 'beforeAfter': return 'comparison';
    case 'inventory':   return 'catalog-grid';
    case 'menu':        return 'catalog-grid';
    case 'integrations':return 'proof-strip';
    case 'gallery':     return (arch === 'marketplace' || arch === 'archive') ? 'catalog-grid' : 'collection-archive';
    case 'testimonial': return (arch === 'editorial' || arch === 'luxury-service' || arch === 'hospitality') ? 'quote-story' : 'proof-strip';
    case 'features':
    case 'generic':
    default:            return contentVariantFor(arch, contentIndex);
  }
}

const HERO_ROTATION: HeroComposition[] = [
  'split-editorial', 'asymmetric-visual', 'immersive-full-bleed',
  'catalog-collection', 'dashboard-product', 'story-editorial',
];
const MODULE_ROTATION: VisualModule[] = [
  'product-showcase', 'editorial-story', 'catalog-archive', 'data-dashboard', 'spatial-floorplan',
];

/**
 * Derive the full, deterministic layout plan from the strategy brief + the
 * resolved section list ({ id, name }). Same inputs → same plan, everywhere.
 */
/** Whitelists so an agent-supplied override is honored ONLY when it is a real
 *  member of the vocabulary (malformed values fall back to detection). */
const ARCHETYPE_SET = new Set<LayoutArchetype>(Object.keys(BLUEPRINT) as LayoutArchetype[]);
const HERO_SET = new Set<HeroComposition>([
  'split-editorial', 'asymmetric-visual', 'dashboard-product', 'immersive-full-bleed',
  'membership-application', 'catalog-collection', 'data-map', 'luxury-service',
  'story-editorial', 'event-experience', 'centered',
]);
const MODULE_SET = new Set<VisualModule>([
  'data-dashboard', 'membership-pass', 'catalog-archive', 'spatial-floorplan',
  'product-showcase', 'editorial-story', 'reservation-form', 'timeline-process',
  'comparison', 'contour-terrain',
]);

export function deriveLayoutPlan(
  brief: WebBuildBrief | undefined,
  sections: Array<{ id: string; name: string }>,
): WebBuildLayoutPlan {
  const ds = deriveDesignSystemFromStrategy(brief);
  const b = brief || {};
  // The agent pipeline (via the enriched brief) decides the STRUCTURE. Honor an
  // agent-supplied archetype over prose re-detection — this is what makes the
  // plan (and therefore both preview and files) actually obey the agents. Only a
  // valid vocabulary member wins; anything else falls back to detection.
  const agentArch = b.agentArchetype as LayoutArchetype | undefined;
  const arch: LayoutArchetype = agentArch && ARCHETYPE_SET.has(agentArch) ? agentArch : ds.archetype;
  const bpBase = BLUEPRINT[arch] || BLUEPRINT.standard;
  // The agent may further pin the hero composition and/or primary visual module.
  const agentHero = b.agentHero as HeroComposition | undefined;
  const agentModule = b.agentModule as VisualModule | undefined;
  const bp: Blueprint = {
    ...bpBase,
    hero: agentHero && HERO_SET.has(agentHero) ? agentHero : bpBase.hero,
    module: agentModule && MODULE_SET.has(agentModule) ? agentModule : bpBase.module,
  };

  // Resolve every section to a kind + composition variant.
  let contentIndex = 0;
  const resolved: PlanSection[] = sections.map((s) => {
    const kind = sectionKind(s.id, s.name);
    const isContent = kind === 'features' || kind === 'generic';
    const base = variantForSection(kind, arch, isContent ? contentIndex++ : 0);
    const variant = refineVariantById(s.id, s.name, base);
    return { id: s.id, name: s.name, kind, variant };
  });

  // The primary visual module lives in the hero AND in the first content/gallery
  // section that can host it — so it is structural, not a decorative panel.
  const primaryVisualModule = bp.module;
  const hostIdx = resolved.findIndex((s) =>
    s.kind === 'features' || s.kind === 'generic' || s.kind === 'gallery' || s.kind === 'productDemo' || s.kind === 'metrics');
  if (hostIdx >= 0) resolved[hostIdx].hostsPrimaryModule = true;

  // Secondary modules come from what the site actually contains.
  const secondaryVisualModules = Array.from(
    new Set(resolved.map((s) => MODULE_FOR_KIND[s.kind]).filter((m): m is VisualModule => !!m && m !== primaryVisualModule)),
  ).slice(0, 3);

  const motionPattern: MotionPattern =
    ds.motion === 'minimal' ? 'minimal'
    : ds.motion === 'expressive' ? (arch === 'dashboard' || arch === 'data-platform' || arch === 'technical' ? 'kinetic' : 'parallax')
    : 'reveal';

  let plan: WebBuildLayoutPlan = {
    archetype: arch,
    pageArchitecture: describeArchitecture(bp.hero, arch, resolved),
    heroComposition: bp.hero,
    navigationStyle: bp.nav,
    sectionSequence: resolved.map((s) => s.id),
    sectionVariants: Object.fromEntries(resolved.map((s) => [s.id, s.variant])),
    sections: resolved,
    primaryVisualModule,
    secondaryVisualModules,
    contentDensity: ds.density,
    rhythm: bp.rhythm,
    ctaPlacement: bp.cta,
    trustPlacement: bp.trust,
    motionPattern,
    visualSystem: VISUAL_BLUEPRINT[arch] || VISUAL_BLUEPRINT.standard,
    componentPlan: resolved.map((s) => pascal(s.id)),
    filePlan: [],
    diversityCorrected: false,
  };

  // When the agent pipeline explicitly pinned the archetype, the hero/module/
  // visual system are the AGENTS' decision — the diversity guard must not hash
  // them away. It may still diversify repeated content-section variants (additive).
  const agentPinned = !!(agentArch && ARCHETYPE_SET.has(agentArch));
  plan = enforceDiversity(plan, b, agentPinned);
  plan.filePlan = planFiles(plan);
  return plan;
}

/**
 * Anti-sameness guard (Part 6). If the strategy was weak and the plan collapsed
 * toward the generic default (centered hero, contour-only module, every content
 * section a plain card grid, flat rhythm), apply a DETERMINISTIC diversity
 * correction keyed on a hash of the idea — so two different weak ideas still get
 * distinct heroes, modules, rhythm and section variants. Never loops; one pass.
 */
function enforceDiversity(plan: WebBuildLayoutPlan, brief: WebBuildBrief, agentPinned = false): WebBuildLayoutPlan {
  const contentVariants = plan.sections
    .filter((s) => s.kind === 'features' || s.kind === 'generic')
    .map((s) => s.variant);
  const distinctContent = new Set(contentVariants).size;

  // Distinct section variants across the WHOLE page (Part 8: force ≥3 when the
  // page is large enough to carry them).
  const nonHero = plan.sections.filter((s) => s.kind !== 'hero');
  const distinctAll = new Set(nonHero.map((s) => s.variant)).size;
  const vs = plan.visualSystem;

  // When the agents pinned the archetype, the hero/module/visual system are their
  // decision — only re-vary repeated CONTENT sections (additive; never rewrite the
  // agent's structural choices to a hash).
  if (agentPinned) {
    const needsSpread = (nonHero.length >= 4 && distinctAll < 3)
      || (contentVariants.length >= 2 && distinctContent === 1);
    if (!needsSpread) return plan;
    const seedP = hashText([brief.type, brief.coreIdea, brief.goal].filter(Boolean).join(' ') || 'korvix');
    const wheelP: SectionVariant[] = ['editorial-split', 'proof-strip', 'showcase', 'feature-grid', 'dashboard-data'];
    let cp = 0;
    const spread = plan.sections.map((s) => {
      if (s.kind !== 'features' && s.kind !== 'generic') return s;
      return { ...s, variant: wheelP[(seedP + cp++) % wheelP.length] };
    });
    return {
      ...plan,
      sections: spread,
      sectionVariants: Object.fromEntries(spread.map((s) => [s.id, s.variant])),
      diversityCorrected: true,
    };
  }

  const tooGeneric =
    // A weak strategy resolves to the neutral 'standard' archetype — without a
    // correction every such idea would share one hero + module + visual system,
    // which is just a new flavor of sameness. Diversify by a hash of the idea.
    (plan.archetype === 'standard')
    || (plan.heroComposition === 'centered')
    || (plan.primaryVisualModule === 'contour-terrain')
    || (vs.background === 'aurora-grid' && vs.surface === 'glass')
    || (nonHero.length >= 4 && distinctAll < 3)
    || (plan.rhythm === 'even' && distinctContent <= 1)
    || (contentVariants.length >= 2 && distinctContent === 1 && contentVariants[0] === 'feature-grid');

  if (!tooGeneric) return plan;

  const seed = hashText([
    brief.type, brief.coreIdea, brief.goal, brief.audience, brief.visualMetaphor, brief.style,
  ].filter(Boolean).join(' ') || 'korvix');

  const hero = HERO_ROTATION[seed % HERO_ROTATION.length];
  const module = MODULE_ROTATION[(seed >> 3) % MODULE_ROTATION.length];
  const rhythm: RhythmPattern = (seed >> 5) % 2 === 0 ? 'alternating' : 'staggered';

  // Force a strategy-specific, non-default visual system so the LOOK differs too.
  const visualSystem: VisualSystem = {
    background: BG_ROTATION[(seed >> 2) % BG_ROTATION.length],
    surface: SURFACE_ROTATION[(seed >> 6) % SURFACE_ROTATION.length],
    panelShape: SHAPE_ROTATION[(seed >> 9) % SHAPE_ROTATION.length],
    accentMode: ACCENT_ROTATION[(seed >> 11) % ACCENT_ROTATION.length],
    headingAlign: (seed >> 13) % 2 === 0 ? 'left' : 'center',
    motif: vs.motif,
  };

  // Re-vary content sections so the same content is not one repeated block, and
  // rotate through ≥3 distinct variants (Part 8).
  const wheel: SectionVariant[] = ['editorial-split', 'proof-strip', 'showcase', 'feature-grid', 'dashboard-data'];
  let ci = 0;
  const sections = plan.sections.map((s) => {
    if (s.kind !== 'features' && s.kind !== 'generic') return s;
    const variant = wheel[(seed + ci++) % wheel.length];
    return { ...s, variant };
  });

  return {
    ...plan,
    heroComposition: hero,
    primaryVisualModule: module,
    rhythm,
    visualSystem,
    sections,
    sectionVariants: Object.fromEntries(sections.map((s) => [s.id, s.variant])),
    pageArchitecture: describeArchitecture(hero, plan.archetype, sections),
    diversityCorrected: true,
  };
}

/* ── Visual system → concrete tokens (shared by preview + generated CSS) ── */

/** Surface treatment → CSS values (dark-safe). */
const SURFACE_TOKENS: Record<SurfaceStyle, { bg: string; bgHover: string; border: string }> = {
  glass:    { bg: 'rgba(255,255,255,0.03)', bgHover: 'rgba(255,255,255,0.06)', border: 'rgba(255,255,255,0.10)' },
  solid:    { bg: 'rgba(255,255,255,0.06)', bgHover: 'rgba(255,255,255,0.09)', border: 'rgba(255,255,255,0.08)' },
  outline:  { bg: 'rgba(255,255,255,0.00)', bgHover: 'rgba(255,255,255,0.03)', border: 'rgba(255,255,255,0.18)' },
  elevated: { bg: 'rgba(255,255,255,0.04)', bgHover: 'rgba(255,255,255,0.07)', border: 'rgba(255,255,255,0.10)' },
  flat:     { bg: 'rgba(255,255,255,0.02)', bgHover: 'rgba(255,255,255,0.035)', border: 'rgba(255,255,255,0.06)' },
};

const SHAPE_RADIUS: Record<PanelShape, string> = { rounded: '1rem', soft: '0.65rem', sharp: '0.15rem' };

export interface VisualSystemTokens {
  surfaceBg: string;
  surfaceHover: string;
  border: string;
  radius: string;
  /** 0..1 multiplier for accent glow intensity (drives orbs/shadows). */
  glow: number;
  /** Whether the second accent is used (duotone) or a single accent (mono/vivid). */
  duotone: boolean;
}

/** Resolve the visual system into concrete tokens for rendering. */
export function visualSystemTokens(vs: VisualSystem): VisualSystemTokens {
  const t = SURFACE_TOKENS[vs.surface] || SURFACE_TOKENS.glass;
  return {
    surfaceBg: t.bg,
    surfaceHover: t.bgHover,
    border: t.border,
    radius: SHAPE_RADIUS[vs.panelShape] || '1rem',
    glow: vs.accentMode === 'vivid' ? 1 : vs.accentMode === 'duotone' ? 0.6 : 0.22,
    duotone: vs.accentMode === 'duotone',
  };
}

function describeArchitecture(hero: HeroComposition, arch: LayoutArchetype, sections: PlanSection[]): string {
  const heroLabel = hero.replace(/-/g, ' ');
  const flow = sections.slice(0, 6).map((s) => s.variant.replace(/-/g, ' ')).join(' → ');
  return `${arch} architecture · ${heroLabel} hero · ${flow}`;
}

function planFiles(plan: WebBuildLayoutPlan): string[] {
  const comps = plan.componentPlan.map((n) => `src/components/${n}.tsx`);
  return [
    'src/main.tsx',
    'src/App.tsx',
    ...comps,
    'src/components/VisualModule.tsx',
    'src/lib/designSystem.ts',
    'src/lib/layoutPlan.ts',
    'src/data/siteContent.ts',
    'src/styles.css',
  ];
}

/** Serialize the plan to a real `src/lib/layoutPlan.ts` module in the generated
 *  project — so the generated code openly reflects the chosen composition. */
export function layoutPlanFileContent(plan: WebBuildLayoutPlan): string {
  const obj = {
    archetype: plan.archetype,
    heroComposition: plan.heroComposition,
    navigationStyle: plan.navigationStyle,
    primaryVisualModule: plan.primaryVisualModule,
    secondaryVisualModules: plan.secondaryVisualModules,
    contentDensity: plan.contentDensity,
    rhythm: plan.rhythm,
    ctaPlacement: plan.ctaPlacement,
    trustPlacement: plan.trustPlacement,
    motionPattern: plan.motionPattern,
    visualSystem: plan.visualSystem,
    sectionSequence: plan.sectionSequence,
    sectionVariants: plan.sectionVariants,
  };
  return `/**
 * Layout plan for this site — the structural composition derived from the build
 * strategy (archetype, hero composition, per-section variants, visual modules,
 * rhythm). The hero and every section are composed to match this plan, so a
 * different strategy produces a genuinely different STRUCTURE, not just colors.
 */
export const layoutPlan = ${JSON.stringify(obj, null, 2)} as const;

export type LayoutPlan = typeof layoutPlan;
`;
}
