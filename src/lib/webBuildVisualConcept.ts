/* ────────────────────────────────────────────────────────────────────────────
 * webBuildVisualConcept.ts — AUTHORITATIVE VISUAL-CONCEPT & ART-DIRECTION CONTRACT
 *
 * WHY THIS MODULE EXISTS
 * Korvix already owns, in separate authorities:
 *   • composition       → per-section family, page rhythm, hero LAYOUT, diversity
 *   • visualSystem      → colour/type tokens, surfaces, anti-slop execution
 *   • visualStrategy    → per-slot media TYPE selection (photograph/illustration/…)
 *   • imageCoverage     → the required FLOOR of semantic photography
 *   • motionIntelligence→ a flat MotionStrategy (flag-gated OFF by default)
 *   • experienceQuality → interaction/responsive/accessibility/performance acceptance
 *
 * But NOBODY owns the layer that makes output feel premium at first glance:
 *   1. a deterministic DOMINANT VISUAL IDEA (visual thesis) for the whole build
 *   2. one SIGNATURE hero visual concept (the memorable 5-second moment) chosen
 *      from a family vocabulary by product MEANING, consistent with composition's
 *      hero anchor — not a random floating dashboard
 *   3. per-image ART DIRECTION (subject / medium / crop / focal / lighting / tone /
 *      people / authenticity / loading priority / no-repeat) — absent everywhere today
 *   4. a small, coherent, DESIGNED motion vocabulary (always on, bounded, reduced-
 *      motion mandatory) rather than universal fade-up added afterwards
 *   5. an explicit visual RHYTHM (peak vs breathe) + DISTINCTIVENESS + EXCLUSIONS
 *
 * This module DERIVES that concept deterministically from the already-derived
 * upstream contracts (no new model/network call), RENDERS a hard-bounded builder
 * block, and ACCEPTS only evidence-backed, non-duplicative visual defects (reusing
 * experienceQuality's ONE JSX scanner). Every field is additive & optional so old /
 * reopened builds keep working; every path fails open.
 *
 * OWNERSHIP BOUNDARY (must not duplicate):
 *   • hero LAYOUT / rhythm / diversity          → composition (we READ hero.visualAnchor)
 *   • colour/type/contrast/anti-slop tokens     → visualSystem (we REFERENCE, never re-decide)
 *   • required PHOTO count present              → imageCoverage (we never re-count photos)
 *   • hero-lazy / all-eager / unbounded-motion  → experienceQuality (we never re-check)
 *   • truthful proof / fake claims              → research (we only WARN on décor-as-metric)
 * We add the genuinely-unowned defects: a required NON-photographic signature visual
 * absent, distinct required image ROLES collapsing to one identical URL, and a
 * signature visual rendered as an empty placeholder.
 *
 * Pure: no Date/Math.random/network/import(); JSON-safe; hard-bounded throughout.
 * ──────────────────────────────────────────────────────────────────────────── */
import type {
  FrontendSpecImageSlot,
  FrontendSpecIdentity,
  ArtDirectionArtifact,
  FrontendGeneratedFile,
  FrontendBuilderReviewSeverity,
  FrontendBuilderReviewIssue,
  FrontendBuilderReviewCategory,
} from '@/lib/webBuildAgents';
import type { CompositionContract } from '@/lib/webBuildComposition';
import type { VisualSystemContract } from '@/lib/webBuildVisualSystem';
import type { ImageCoverageRequirement } from '@/lib/webBuildImageCoverage';
import type { ContentNarrativeContract } from '@/lib/webBuildContentNarrative';
import type { ResearchDirectionContract } from '@/lib/webBuildResearchDirection';
import { collectSectionUnits, normId } from '@/lib/webBuildSectionSource';
import { factsFor, scanElements, type SectionFacts } from '@/lib/webBuildExperienceQuality';

/* ── Bounds (mirrors the proven experienceQuality ceilings) ──────────────────── */
const MAX_TEXT = 140;
const MAX_LIST = 8;
const MAX_ROLES = 14;
const MAX_ISSUES = 20;
const MAX_ISSUE_FILES = 4;
const MAX_EVIDENCE = 180;
const MAX_SCAN = 20_000;
const RENDER_CHAR_CEILING = 2800;   // documented hard ceiling for the rendered builder block

/* ── Public vocabulary ───────────────────────────────────────────────────────── */
export type SignatureHeroFamily =
  | 'cinematic-full-bleed' | 'product-interface-theatre' | 'editorial-split'
  | 'layered-collage' | 'living-data-field' | 'visualized-workflow'
  | 'spatial-product-ecosystem' | 'interactive-simulator' | 'typographic-environmental'
  | 'photography-trust' | 'transformation-before-after' | 'diagrammatic-intelligence'
  | 'material-object' | 'ambient-3d-scene';

export type VisualMedium =
  | 'photography' | 'product-ui' | 'data-visualization' | 'abstract-generative'
  | '3d-scene' | 'editorial-collage' | 'technical-diagram' | 'illustration'
  | 'typographic' | 'texture-material' | 'environmental-lifestyle' | 'motion-led' | 'mixed-media';

export type ImageRole =
  | 'hero-signature' | 'trust-lifestyle' | 'product-context' | 'process-illustration'
  | 'social-proof-portrait' | 'feature-explanation' | 'background-atmosphere'
  | 'editorial-break' | 'security-technical' | 'data-diagram' | 'decorative-texture';

export type MotionTechnique =
  | 'svg-path-draw' | 'masked-reveal' | 'clip-path-transition' | 'parallax-depth'
  | 'data-interpolation' | 'progress-construction' | 'orbital-relational'
  | 'animated-gradient-bounded' | 'light-sweep' | 'floating-depth'
  | 'timeline-progression' | 'before-after-transform' | 'card-cluster' | 'cursor-proximity'
  | 'ambient-environmental';

export type PhotographyPosture = 'photo-first' | 'balanced' | 'graphic-first' | 'none';

export interface ImageRoleDirection {
  slotId: string;
  sectionId: string;
  role: ImageRole;
  required: boolean;
  narrativePurpose: string;
  subject: string;
  medium: VisualMedium;
  orientation: 'landscape' | 'portrait' | 'square';
  aspectRatio: string;
  crop: string;
  focalPoint: string;
  placement: string;
  mobileCrop: string;
  lighting: string;
  tone: string;
  peoplePresent: 'required' | 'optional' | 'avoid';
  devicesUseful: boolean;
  authenticity: 'authentic-photo-required' | 'illustrative-ok' | 'generatable';
  remoteAllowed: boolean;
  fallbackAllowed: boolean;
  loadingPriority: 'eager' | 'lazy';   // DECLARED here; ENFORCED by experienceQuality
  altIntent: string;
  noRepeat: boolean;
  expectedContribution: string;
}

export interface SignatureVisual {
  family: SignatureHeroFamily;
  fiveSecondMemory: string;
  dominantSubject: string;
  focalPoint: string;
  layeringStrategy: string;
  copyToVisual: string;
  medium: VisualMedium;
  photographic: boolean;               // true when the signature is a real photograph
  animated: boolean;                   // true when the signature is motion-led
  animatedTechnique?: MotionTechnique;
  placement: string;
  mobileFallback: string;
  emptySpaceBudget: string;
  ctaProminence: string;
  lcpHandling: string;                 // references experienceQuality ownership
  contrastRequirement: string;         // references visualSystem ownership
  reducedMotionFallback: string;
  prohibited: string[];
}

export interface MotionVocabulary {
  ambient: string;
  structural: string;
  interaction: string;
  narrative: string;
  stateTransition: string;
  techniques: MotionTechnique[];
  reducedMotionRule: string;
  avoid: string[];
}

export interface VisualRhythmPlan {
  peakSectionId?: string;
  denseSectionIds: string[];
  breatheSectionIds: string[];
  escalation: string;
  antiUniformity: string;              // references composition's diversity ownership
}

export interface RealImagePhotograph { role: ImageRole; subject: string; purpose: string; }
export interface RealImageStrategy {
  use: boolean;
  posture: PhotographyPosture;
  rationale: string;
  photographs: RealImagePhotograph[];
  forbidDecorativeStock: boolean;
}

export interface VisualConceptContract {
  version: 'visual-concept-v1';
  status: 'derived' | 'legacy';
  category: string;                    // the resolved visual category bucket
  visualThesis: string;
  signature: SignatureVisual;
  media: VisualMedium[];
  imageRoles: ImageRoleDirection[];
  rhythm: VisualRhythmPlan;
  motion: MotionVocabulary;
  realImageStrategy: RealImageStrategy;
  distinctiveness: string;
  exclusions: string[];
  requiredPhotoCount: number;
  requiredAnimatedVisualCount: number;
  reasons: string[];
  /* ── Truthful consumption trace (mirrors composition / experienceQuality). ── */
  upstreamEvidenceUsedToDeriveContract: string[];
  contractPersistedInSpecification: boolean;
  contractRenderedToFrontendBuilder: boolean;
  contractUsedByAcceptance: boolean;
  agentsActuallyConsumingContract: string[];
}

export interface VisualConceptInput {
  identity?: Partial<FrontendSpecIdentity> & { name?: string; category?: string };
  sections?: Array<{ id?: string; name?: string; kind?: string }>;
  composition?: CompositionContract;
  visualSystem?: VisualSystemContract;
  imageCoverage?: ImageCoverageRequirement;
  contentNarrative?: ContentNarrativeContract;
  research?: ResearchDirectionContract;
  imageSlots?: FrontendSpecImageSlot[];
  artDirection?: ArtDirectionArtifact;
  prompt?: string;
}

/* ── Pure helpers (no Date/random/network) ───────────────────────────────────── */
function clip(s: unknown, n = MAX_TEXT): string { return (typeof s === 'string' ? s : '').replace(/\s+/g, ' ').trim().slice(0, n); }
function uniq<T>(a: T[]): T[] { return [...new Set(a)]; }
function capList<T>(a: T[] | undefined, n = MAX_LIST): T[] { return Array.isArray(a) ? a.slice(0, n) : []; }
/** FNV-1a 32-bit — deterministic, stable, non-negative; used ONLY to break ties among
 *  equally-appropriate options so same-category builds diverge (never Math.random). */
function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0);
}
/** Pick from a ranked candidate list deterministically, biased to the front but varied
 *  by the semantic seed so distinct prompts in one category do not always collapse to
 *  the first option. Considers only the top `window` candidates to stay on-brand. */
function pick<T>(cands: T[], seed: number, window = 3): T | undefined {
  const list = cands.filter((x) => x != null);
  if (!list.length) return undefined;
  const w = Math.min(window, list.length);
  return list[seed % w];
}

/* ── Visual category classification (semantic, deterministic) ─────────────────── */
export type VisualCategory =
  | 'software-saas' | 'finance' | 'ecommerce-fashion' | 'architecture' | 'hospitality-luxury'
  | 'healthcare' | 'education' | 'security' | 'food-restaurant' | 'portfolio-creative'
  | 'developer-tool' | 'climate-energy' | 'mobile-app' | 'b2b-enterprise' | 'local-service' | 'generic';

interface CategoryDNA {
  heroFamilies: SignatureHeroFamily[];
  media: VisualMedium[];
  motion: MotionTechnique[];
  photography: PhotographyPosture;
  thesisMotif: string;
  distinctiveness: string;
  exclusions: string[];
}

const CATEGORY_DNA: Record<VisualCategory, CategoryDNA> = {
  'software-saas': {
    heroFamilies: ['living-data-field', 'product-interface-theatre', 'visualized-workflow', 'diagrammatic-intelligence'],
    media: ['product-ui', 'data-visualization', 'abstract-generative', 'mixed-media'],
    motion: ['data-interpolation', 'progress-construction', 'orbital-relational', 'masked-reveal'],
    photography: 'balanced',
    thesisMotif: 'intelligence made tangible as a living, guided interface',
    distinctiveness: 'the product UI is the hero and it visibly does something, not a static screenshot floating on a gradient',
    exclusions: ['a generic floating dashboard as the only visual idea', 'three glowing glass cards over a purple gradient', 'random neon blobs'],
  },
  finance: {
    heroFamilies: ['living-data-field', 'diagrammatic-intelligence', 'product-interface-theatre', 'editorial-split'],
    media: ['data-visualization', 'product-ui', 'environmental-lifestyle', 'abstract-generative'],
    motion: ['data-interpolation', 'progress-construction', 'timeline-progression', 'light-sweep'],
    photography: 'balanced',
    thesisMotif: 'calm, trustworthy clarity where numbers become confident decisions',
    distinctiveness: 'data is rendered as a legible, honest field of guidance rather than decorative fake tickers',
    exclusions: ['fake ticker/price numbers used as decoration', 'meaningless decorative charts', 'neon money/crypto clichés'],
  },
  'ecommerce-fashion': {
    heroFamilies: ['cinematic-full-bleed', 'editorial-split', 'photography-trust', 'material-object'],
    media: ['photography', 'editorial-collage', 'environmental-lifestyle', 'typographic'],
    motion: ['masked-reveal', 'parallax-depth', 'light-sweep', 'card-cluster'],
    photography: 'photo-first',
    thesisMotif: 'editorial confidence where the product is styled like a magazine cover',
    distinctiveness: 'large art-directed product/lifestyle photography and editorial type, never a SaaS dashboard',
    exclusions: ['a product dashboard mockup', 'glass utility cards', 'developer-style tech gradients'],
  },
  architecture: {
    heroFamilies: ['cinematic-full-bleed', 'editorial-split', 'material-object', 'typographic-environmental'],
    media: ['photography', 'environmental-lifestyle', 'editorial-collage', 'typographic'],
    motion: ['masked-reveal', 'parallax-depth', 'timeline-progression', 'ambient-environmental'],
    photography: 'photo-first',
    thesisMotif: 'spatial calm where light, material and negative space carry the story',
    distinctiveness: 'full-bleed architectural photography and restrained editorial type; generous negative space',
    exclusions: ['a product dashboard', 'glass cards', 'neon', 'a generic SaaS gradient'],
  },
  'hospitality-luxury': {
    heroFamilies: ['cinematic-full-bleed', 'photography-trust', 'editorial-split', 'ambient-3d-scene'],
    media: ['photography', 'environmental-lifestyle', 'editorial-collage', 'texture-material'],
    motion: ['ambient-environmental', 'parallax-depth', 'masked-reveal', 'light-sweep'],
    photography: 'photo-first',
    thesisMotif: 'immersive escape where atmosphere and place invite the guest in',
    distinctiveness: 'cinematic environmental photography with slow, gentle motion and refined type',
    exclusions: ['a dashboard or data UI', 'glass cards', 'tech gradients', 'busy interface chrome'],
  },
  healthcare: {
    heroFamilies: ['photography-trust', 'editorial-split', 'diagrammatic-intelligence', 'living-data-field'],
    media: ['photography', 'environmental-lifestyle', 'technical-diagram', 'illustration'],
    motion: ['masked-reveal', 'progress-construction', 'timeline-progression', 'data-interpolation'],
    photography: 'photo-first',
    thesisMotif: 'reassuring competence where human care and clarity coexist',
    distinctiveness: 'warm, authentic human/clinical photography plus clear explanatory diagrams',
    exclusions: ['neon or aggressive motion', 'meaningless decorative charts', 'cold generic stock'],
  },
  education: {
    heroFamilies: ['editorial-split', 'layered-collage', 'typographic-environmental', 'visualized-workflow'],
    media: ['illustration', 'photography', 'editorial-collage', 'typographic'],
    motion: ['masked-reveal', 'timeline-progression', 'card-cluster', 'progress-construction'],
    photography: 'balanced',
    thesisMotif: 'momentum of learning shown as a clear, encouraging progression',
    distinctiveness: 'friendly illustration and real learner moments arranged as a path, not an enterprise console',
    exclusions: ['an enterprise dashboard', 'neon', 'sterile corporate stock'],
  },
  security: {
    heroFamilies: ['diagrammatic-intelligence', 'living-data-field', 'visualized-workflow', 'product-interface-theatre'],
    media: ['technical-diagram', 'data-visualization', 'abstract-generative', 'product-ui'],
    motion: ['orbital-relational', 'data-interpolation', 'light-sweep', 'masked-reveal'],
    photography: 'graphic-first',
    thesisMotif: 'controlled protection visualised as a clear system of guarded relationships',
    distinctiveness: 'an intelligible security topology/diagram, never hacker-in-a-hoodie clichés',
    exclusions: ['a literal hacker-in-a-hoodie photo', 'green matrix code rain', 'neon skull/lock clichés'],
  },
  'food-restaurant': {
    heroFamilies: ['cinematic-full-bleed', 'photography-trust', 'editorial-split', 'material-object'],
    media: ['photography', 'environmental-lifestyle', 'editorial-collage', 'texture-material'],
    motion: ['masked-reveal', 'parallax-depth', 'light-sweep', 'ambient-environmental'],
    photography: 'photo-first',
    thesisMotif: 'appetite and place where food and room feel warm and real',
    distinctiveness: 'rich close-up food and venue photography with editorial warmth, no UI chrome',
    exclusions: ['a dashboard or charts', 'glass cards', 'cold tech gradients'],
  },
  'portfolio-creative': {
    heroFamilies: ['editorial-split', 'layered-collage', 'typographic-environmental', 'cinematic-full-bleed'],
    media: ['photography', 'editorial-collage', 'typographic', 'mixed-media'],
    motion: ['masked-reveal', 'cursor-proximity', 'parallax-depth', 'clip-path-transition'],
    photography: 'photo-first',
    thesisMotif: 'a confident authored point of view where the work speaks loudest',
    distinctiveness: 'expressive editorial layout and large work imagery; deliberately not a corporate template',
    exclusions: ['a corporate dashboard', 'generic SaaS gradient + glass cards'],
  },
  'developer-tool': {
    heroFamilies: ['product-interface-theatre', 'diagrammatic-intelligence', 'visualized-workflow', 'typographic-environmental'],
    media: ['product-ui', 'technical-diagram', 'typographic', 'data-visualization'],
    motion: ['svg-path-draw', 'progress-construction', 'orbital-relational', 'masked-reveal'],
    photography: 'none',
    thesisMotif: 'precise craft where real code and architecture are shown honestly',
    distinctiveness: 'real terminal/editor/diagram surfaces with precise micro-interactions; information dense but ordered',
    exclusions: ['lifestyle stock photos or a smiling office team', 'neon blobs', 'decorative fake dashboards'],
  },
  'climate-energy': {
    heroFamilies: ['living-data-field', 'cinematic-full-bleed', 'diagrammatic-intelligence', 'editorial-split'],
    media: ['data-visualization', 'photography', 'environmental-lifestyle', 'technical-diagram'],
    motion: ['data-interpolation', 'timeline-progression', 'ambient-environmental', 'orbital-relational'],
    photography: 'balanced',
    thesisMotif: 'measurable impact where real-world scenes meet honest, living data',
    distinctiveness: 'environmental photography grounded by legible impact data, not greenwashed decoration',
    exclusions: ['meaningless decorative charts', 'neon', 'generic globe clichés'],
  },
  'mobile-app': {
    heroFamilies: ['product-interface-theatre', 'spatial-product-ecosystem', 'layered-collage', 'cinematic-full-bleed'],
    media: ['product-ui', 'environmental-lifestyle', 'abstract-generative', 'mixed-media'],
    motion: ['masked-reveal', 'floating-depth', 'card-cluster', 'parallax-depth'],
    photography: 'balanced',
    thesisMotif: 'a delightful app-in-hand where the interface feels alive and personal',
    distinctiveness: 'device-framed app screens with depth and in-context lifestyle, not a desktop dashboard',
    exclusions: ['a desktop dashboard or dense data tables', 'glass utility cards', 'neon'],
  },
  'b2b-enterprise': {
    heroFamilies: ['visualized-workflow', 'diagrammatic-intelligence', 'product-interface-theatre', 'living-data-field'],
    media: ['product-ui', 'technical-diagram', 'data-visualization', 'environmental-lifestyle'],
    motion: ['progress-construction', 'orbital-relational', 'data-interpolation', 'timeline-progression'],
    photography: 'balanced',
    thesisMotif: 'orchestrated systems where complex workflow is made calm and legible',
    distinctiveness: 'a clear workflow/architecture visual and trustworthy proof, not three glass cards on a gradient',
    exclusions: ['neon', 'three glass cards over a gradient', 'a generic purple SaaS gradient'],
  },
  'local-service': {
    heroFamilies: ['photography-trust', 'cinematic-full-bleed', 'editorial-split', 'transformation-before-after'],
    media: ['photography', 'environmental-lifestyle', 'editorial-collage', 'illustration'],
    motion: ['masked-reveal', 'before-after-transform', 'parallax-depth', 'timeline-progression'],
    photography: 'photo-first',
    thesisMotif: 'proven local craft where real work and real people build trust',
    distinctiveness: 'authentic on-the-job/results photography and clear proof, not abstract tech visuals',
    exclusions: ['a dashboard or charts', 'glass cards', 'neon', 'abstract SaaS gradients'],
  },
  generic: {
    heroFamilies: ['editorial-split', 'cinematic-full-bleed', 'product-interface-theatre', 'typographic-environmental'],
    media: ['photography', 'typographic', 'abstract-generative', 'mixed-media'],
    motion: ['masked-reveal', 'parallax-depth', 'progress-construction', 'light-sweep'],
    photography: 'balanced',
    thesisMotif: 'one clear, product-true idea carried by a single dominant visual',
    distinctiveness: 'one dominant visual idea rather than many small unrelated elements',
    exclusions: ['a generic floating dashboard in every hero', 'three glass cards over a gradient', 'random neon blobs', 'an unrelated city skyline'],
  },
};

/** Baseline exclusions appended to EVERY build (the universal anti-template guardrails). */
const UNIVERSAL_EXCLUSIONS = [
  'defaulting to a dark-navy background with a blue→purple gradient',
  'repeated identical glass cards',
  'fake partner/customer logos or invented certifications',
  'decorative charts showing meaningless numbers presented as real metrics',
  'mixing multiple unrelated art styles in one page',
  'unreadable text placed directly over busy imagery',
];

const KEYWORD_CATEGORY: Array<{ re: RegExp; cat: VisualCategory }> = [
  { re: /\b(cyber\s?security|infosec|threat|malware|firewall|zero[-\s]?trust|siem|endpoint protection|penetration test|soc\b)/i, cat: 'security' },
  { re: /\b(developer|dev\s?tool|api\b|sdk\b|cli\b|open\s?source|framework|library|compiler|database|devops|terminal|code editor)/i, cat: 'developer-tool' },
  // `portfolio` alone is NOT a finance signal: it is the single most common word in a creative
  // portfolio brief, and matching it here (above `portfolio-creative`) classified every
  // photographer/designer/illustrator site as finance — which handed the whole site
  // data-visualization art direction. Only the finance senses of the word match.
  { re: /\b(bank|banking|invest|investment|fintech|(?:investment|asset|client|stock)\s+portfolio|portfolio\s+(?:management|manager|performance|allocation)|wealth|trading|budget|loan|mortgage|insurance|payment|personal finance|accounting|tax)/i, cat: 'finance' },
  { re: /\b(fashion|apparel|clothing|jewel|jewellery|jewelry|cosmetic|beauty|online shop|online store|ecommerce|e-commerce|catalog|retail)/i, cat: 'ecommerce-fashion' },
  { re: /\b(architect|architecture|interior design|studio|built environment|structural|urban design)/i, cat: 'architecture' },
  { re: /\b(hotel|resort|hospitality|spa\b|luxury|villa|boutique hotel|travel|tourism|getaway|retreat|vineyard)/i, cat: 'hospitality-luxury' },
  { re: /\b(health|clinic|medical|patient|doctor|dental|therapy|wellness|pharma|hospital|care\b|telehealth)/i, cat: 'healthcare' },
  { re: /\b(course|learn|education|school|university|student|tutor|training|academy|curriculum|lms\b|bootcamp)/i, cat: 'education' },
  { re: /\b(restaurant|cafe|café|menu|dining|food|cuisine|chef|bakery|bar\b|bistro|catering)/i, cat: 'food-restaurant' },
  { re: /\b(portfolio|freelanc|photographer|designer|creative|artist|illustrator|filmmaker|agency)/i, cat: 'portfolio-creative' },
  { re: /\b(climate|energy|solar|carbon|renewable|sustainab|green\s?tech|cleantech|emission|battery|grid\b)/i, cat: 'climate-energy' },
  { re: /\b(mobile app|ios\b|android|app store|smartphone|fitness app|companion app|on the go)/i, cat: 'mobile-app' },
  { re: /\b(enterprise|b2b\b|platform|workflow|operations|logistics|supply chain|procurement|erp\b|crm\b)/i, cat: 'b2b-enterprise' },
  { re: /\b(plumb|electric|hvac|landscap|cleaning|roofing|contractor|repair|salon|barber|local service|handyman|dealership|automotive)/i, cat: 'local-service' },
  { re: /\b(saas|dashboard|analytics|ai\b|artificial intelligence|automation|productivity|collaboration|no[-\s]?code)/i, cat: 'software-saas' },
];

const SECTOR_CATEGORY: Record<string, VisualCategory> = {
  'ai-saas': 'software-saas',
  jewelry: 'ecommerce-fashion',
  'furniture-interiors': 'ecommerce-fashion',
  'restaurant-hospitality': 'food-restaurant',
  'travel-tourism': 'hospitality-luxury',
  'real-estate': 'architecture',
  'clinic-healthcare': 'healthcare',
  marketplace: 'ecommerce-fashion',
  'portfolio-agency': 'portfolio-creative',
  'local-service': 'local-service',
  landscaping: 'local-service',
  'automotive-dealership': 'local-service',
  general: 'generic',
};

/** Resolve the visual category from the strongest available semantic signal. Prompt/concept
 *  keywords win (most specific), then the classified sector, then generic. Deterministic. */
export function classifyVisualCategory(input: VisualConceptInput): VisualCategory {
  const text = `${input.identity?.primaryConcept || ''} ${input.identity?.subsector || ''} ${input.identity?.siteType || ''} ${(input as { identity?: { category?: string } }).identity?.category || ''} ${input.prompt || ''}`;
  for (const { re, cat } of KEYWORD_CATEGORY) if (re.test(text)) return cat;
  const sector = input.identity?.sector;
  if (sector && SECTOR_CATEGORY[sector]) return SECTOR_CATEGORY[sector];
  return 'generic';
}

/* ── Signature-hero family selection (semantic-primary, hash-tiebroken, composition-consistent) ── */
const ANCHOR_FAMILY_BIAS: Record<string, SignatureHeroFamily[]> = {
  photograph: ['photography-trust', 'cinematic-full-bleed', 'editorial-split', 'material-object', 'transformation-before-after'],
  'product-ui': ['product-interface-theatre', 'visualized-workflow', 'spatial-product-ecosystem', 'living-data-field', 'interactive-simulator'],
  typographic: ['typographic-environmental', 'editorial-split', 'layered-collage'],
  illustration: ['diagrammatic-intelligence', 'layered-collage', 'editorial-split', 'visualized-workflow'],
  none: ['typographic-environmental', 'editorial-split', 'ambient-3d-scene'],
};

function selectSignatureFamily(dna: CategoryDNA, anchor: string | undefined, seed: number): SignatureHeroFamily {
  const bias = anchor && ANCHOR_FAMILY_BIAS[anchor] ? ANCHOR_FAMILY_BIAS[anchor] : [];
  // Prefer families that are BOTH category-appropriate and composition-anchor-consistent.
  const consistent = dna.heroFamilies.filter((f) => bias.includes(f));
  if (consistent.length) return pick(consistent, seed, consistent.length) as SignatureHeroFamily;
  // No overlap → the composition anchor is authoritative for medium, so honour it if it has a
  // family bias; else fall back to the category's ranked families.
  if (bias.length) return pick(bias, seed, Math.min(2, bias.length)) as SignatureHeroFamily;
  return pick(dna.heroFamilies, seed, 3) as SignatureHeroFamily;
}

const FAMILY_MEDIUM: Record<SignatureHeroFamily, VisualMedium> = {
  'cinematic-full-bleed': 'photography',
  'product-interface-theatre': 'product-ui',
  'editorial-split': 'photography',
  'layered-collage': 'editorial-collage',
  'living-data-field': 'data-visualization',
  'visualized-workflow': 'technical-diagram',
  'spatial-product-ecosystem': 'product-ui',
  'interactive-simulator': 'product-ui',
  'typographic-environmental': 'typographic',
  'photography-trust': 'photography',
  'transformation-before-after': 'photography',
  'diagrammatic-intelligence': 'technical-diagram',
  'material-object': 'photography',
  'ambient-3d-scene': '3d-scene',
};

const FAMILY_MEMORY: Record<SignatureHeroFamily, string> = {
  'cinematic-full-bleed': 'one full-bleed cinematic scene that fills the first screen and sets the mood instantly',
  'product-interface-theatre': 'the real product interface, framed like a stage and visibly doing one meaningful thing',
  'editorial-split': 'a confident editorial split of bold type against one strong image',
  'layered-collage': 'a layered collage with real depth between foreground and background',
  'living-data-field': 'a living field of data that animates into a clear, guided insight',
  'visualized-workflow': 'a workflow that visibly connects step to step as the eye moves',
  'spatial-product-ecosystem': 'the product shown in a spatial ecosystem of related surfaces with depth',
  'interactive-simulator': 'a small interactive simulator the visitor can touch in the hero',
  'typographic-environmental': 'a large typographic statement grounded by one environmental detail',
  'photography-trust': 'one authentic human/place photograph that earns trust immediately',
  'transformation-before-after': 'a before→after transformation that shows the outcome at a glance',
  'diagrammatic-intelligence': 'an intelligible diagram that reveals how the system thinks',
  'material-object': 'a hero object rendered with real material, light and craft',
  'ambient-3d-scene': 'a slow, ambient 3D-inspired scene with gentle depth and light',
};

/* ── Image-role mapping (per-slot art direction — the layer nobody owns today) ── */
function roleForPurpose(purpose: string, hero: boolean): ImageRole {
  const p = (purpose || '').toLowerCase();
  if (hero || /hero|signature|banner|masthead/.test(p)) return 'hero-signature';
  if (/portrait|team|founder|staff|avatar|headshot|testimonial|review|person/.test(p)) return 'social-proof-portrait';
  if (/life|about|story|culture|environment|office|studio|scene/.test(p)) return 'trust-lifestyle';
  if (/product|showcase|catalog|listing|item|device|screen|app|dashboard|ui/.test(p)) return 'product-context';
  if (/step|process|how|workflow|guide|onboard/.test(p)) return 'process-illustration';
  if (/feature|benefit|capab|explain/.test(p)) return 'feature-explanation';
  if (/secure|security|privacy|protect|compliance|encrypt/.test(p)) return 'security-technical';
  if (/data|chart|metric|graph|analytics|stat/.test(p)) return 'data-diagram';
  if (/texture|pattern|grain|noise|surface/.test(p)) return 'decorative-texture';
  if (/editorial|break|feature-image|gallery/.test(p)) return 'editorial-break';
  if (/background|ambient|atmos|backdrop/.test(p)) return 'background-atmosphere';
  return 'feature-explanation';
}

const ROLE_MEDIUM: Record<ImageRole, VisualMedium> = {
  'hero-signature': 'photography',
  'trust-lifestyle': 'environmental-lifestyle',
  'product-context': 'product-ui',
  'process-illustration': 'illustration',
  'social-proof-portrait': 'photography',
  'feature-explanation': 'illustration',
  'background-atmosphere': 'texture-material',
  'editorial-break': 'editorial-collage',
  'security-technical': 'technical-diagram',
  'data-diagram': 'data-visualization',
  'decorative-texture': 'texture-material',
};

const ROLE_ASPECT: Record<ImageRole, { orientation: 'landscape' | 'portrait' | 'square'; aspect: string }> = {
  'hero-signature': { orientation: 'landscape', aspect: '16:9' },
  'trust-lifestyle': { orientation: 'landscape', aspect: '3:2' },
  'product-context': { orientation: 'landscape', aspect: '16:10' },
  'process-illustration': { orientation: 'landscape', aspect: '4:3' },
  'social-proof-portrait': { orientation: 'square', aspect: '1:1' },
  'feature-explanation': { orientation: 'landscape', aspect: '4:3' },
  'background-atmosphere': { orientation: 'landscape', aspect: '21:9' },
  'editorial-break': { orientation: 'portrait', aspect: '4:5' },
  'security-technical': { orientation: 'landscape', aspect: '16:9' },
  'data-diagram': { orientation: 'landscape', aspect: '16:9' },
  'decorative-texture': { orientation: 'landscape', aspect: '21:9' },
};

interface SlotSeed {
  slotId: string; sectionId: string; purpose: string; hero: boolean;
  orientation?: string; query?: string; altText?: string;
  aiAllowed?: boolean; manualRequired?: boolean; authenticityRisk?: string; required?: boolean;
}

/** Merge the upstream image plans (imageCoverage targets + spec image slots) into ONE
 *  de-duplicated seed list. imageCoverage is authoritative for "required"; spec slots add
 *  any already-sourced slots. */
function collectSlotSeeds(input: VisualConceptInput): SlotSeed[] {
  const seeds: SlotSeed[] = [];
  const seen = new Set<string>();
  const push = (s: SlotSeed) => { const k = normId(s.slotId || s.purpose); if (!k || seen.has(k)) return; seen.add(k); seeds.push(s); };
  for (const t of capList(input.imageCoverage?.targets, MAX_ROLES)) {
    push({
      slotId: (t as { purpose?: string }).purpose || 'image', sectionId: '', purpose: (t as { purpose?: string }).purpose || '',
      hero: !!(t as { hero?: boolean }).hero, orientation: (t as { orientation?: string }).orientation,
      query: (t as { query?: string }).query, altText: (t as { altText?: string }).altText,
      aiAllowed: (t as { aiAllowed?: boolean }).aiAllowed, manualRequired: (t as { manualRequired?: boolean }).manualRequired,
      authenticityRisk: (t as { authenticityRisk?: string }).authenticityRisk, required: (t as { required?: boolean }).required,
    });
  }
  for (const s of capList(input.imageSlots, MAX_ROLES)) {
    push({
      slotId: s.id || s.target || s.purpose || 'slot', sectionId: s.target || '', purpose: s.purpose || s.kind || '',
      hero: /hero/i.test(`${s.kind} ${s.purpose} ${s.target}`), altText: s.alt,
      manualRequired: s.manualUploadRecommended, required: false,
    });
  }
  return seeds.slice(0, MAX_ROLES);
}

const CATEGORY_LIGHTING: Partial<Record<VisualCategory, string>> = {
  'hospitality-luxury': 'warm golden-hour, soft directional light',
  'food-restaurant': 'warm natural light with appetising highlights',
  architecture: 'clean daylight raking across surfaces to reveal material',
  healthcare: 'soft, even, reassuring daylight',
  'ecommerce-fashion': 'crisp editorial studio light with intentional shadow',
  security: 'cool, controlled, low-key with a single accent light',
  'developer-tool': 'neutral, high-legibility, low glare',
  finance: 'calm, even, confidence-building light',
};

function deriveImageRoles(input: VisualConceptInput, cat: VisualCategory, dna: CategoryDNA): ImageRoleDirection[] {
  const seeds = collectSlotSeeds(input);
  const lighting = CATEGORY_LIGHTING[cat] || 'natural, on-brand light with clear direction';
  const photoFirst = dna.photography === 'photo-first';
  const graphicFirst = dna.photography === 'graphic-first' || dna.photography === 'none';
  const usedRoles = new Set<ImageRole>();
  const roles: ImageRoleDirection[] = [];
  seeds.forEach((s, i) => {
    let role = roleForPurpose(s.purpose, s.hero);
    // Keep required roles distinct where possible so the build cannot collapse to one image.
    if (usedRoles.has(role) && s.required && role !== 'hero-signature') {
      const alt = (['feature-explanation', 'trust-lifestyle', 'product-context', 'editorial-break', 'process-illustration'] as ImageRole[]).find((r) => !usedRoles.has(r));
      if (alt) role = alt;
    }
    usedRoles.add(role);
    const ar = ROLE_ASPECT[role];
    const orientation = (s.orientation === 'portrait' || s.orientation === 'square' || s.orientation === 'landscape') ? s.orientation : ar.orientation;
    /* ── Medium, then authenticity — in that order, because authenticity is a property OF the
     *    medium. The signature hero used to be typed 'photography' for every non-photo-first
     *    category, so a software product's hero was described as a photograph even though its own
     *    category DNA lists product UI, diagrams and generative media and never photography. It
     *    then inherited "an authentic photograph is required", which is not a statement anyone can
     *    satisfy about a product-UI composition — and downstream that read as "source a real photo
     *    of this software", which is how interface-led products ended up with office stock. The
     *    hero medium now comes from the category's OWN media DNA (photo-first categories still get
     *    photography), and only a genuinely photographic medium can demand an authentic photo. ── */
    const medium: VisualMedium = role === 'hero-signature'
      ? (photoFirst ? 'photography' : (dna.media[0] || ROLE_MEDIUM[role]))
      : ROLE_MEDIUM[role];
    const photographicMedium = medium === 'photography' || medium === 'environmental-lifestyle';
    // Authenticity: proof-heavy real-world imagery must be authentic; illustrative/interface
    // concepts may be generated.
    const proofy = role === 'social-proof-portrait' || role === 'trust-lifestyle' || role === 'hero-signature';
    const authenticity: ImageRoleDirection['authenticity'] = s.manualRequired
      ? 'authentic-photo-required'
      : (proofy && !graphicFirst && photographicMedium && s.authenticityRisk !== 'low'
        ? 'authentic-photo-required'
        : (s.aiAllowed === false ? 'illustrative-ok' : 'generatable'));
    const peoplePresent: ImageRoleDirection['peoplePresent'] = role === 'social-proof-portrait'
      ? 'required'
      : (role === 'trust-lifestyle' ? 'optional' : (graphicFirst || role === 'data-diagram' || role === 'security-technical' || role === 'decorative-texture' ? 'avoid' : 'optional'));
    roles.push({
      slotId: clip(s.slotId, 60), sectionId: clip(s.sectionId, 60), role, required: !!s.required,
      narrativePurpose: clip(s.purpose || role.replace(/-/g, ' '), 100),
      subject: clip(s.query || (input.research?.artDirection?.imageSubjects || [])[i] || `${role.replace(/-/g, ' ')} for a ${cat.replace(/-/g, ' ')} product`, 110),
      medium, orientation, aspectRatio: ar.aspect,
      crop: role === 'hero-signature' ? 'wide, generous headroom for overlaid copy' : 'balanced, subject off-centre on the rule of thirds',
      focalPoint: role === 'hero-signature' ? 'upper-third, leaving a calm zone for the headline' : 'subject-led, single clear focal point',
      placement: role === 'background-atmosphere' || role === 'decorative-texture' ? 'behind content, low contrast' : (role === 'hero-signature' ? 'first viewport, dominant' : 'beside or above its supporting copy'),
      mobileCrop: orientation === 'landscape' ? 're-crop tighter to the subject (portrait-safe) on mobile' : 'keep subject centred and fully visible on mobile',
      lighting, tone: clip(input.research?.artDirection?.emotionalTone || dna.thesisMotif, 90),
      peoplePresent,
      devicesUseful: role === 'product-context' || role === 'feature-explanation' || cat === 'mobile-app' || cat === 'developer-tool',
      authenticity,
      remoteAllowed: authenticity !== 'authentic-photo-required' ? true : true,
      fallbackAllowed: role !== 'hero-signature',
      loadingPriority: role === 'hero-signature' && i === 0 ? 'eager' : 'lazy',
      altIntent: clip(s.altText || `describe the ${role.replace(/-/g, ' ')} meaningfully for screen readers`, 110),
      noRepeat: true,
      expectedContribution: clip(role === 'hero-signature' ? 'carry the signature first impression' : `advance the ${role.replace(/-/g, ' ')} moment without repeating another image`, 110),
    });
  });
  return roles.slice(0, MAX_ROLES);
}

/* ── Motion vocabulary (always present, bounded, reduced-motion mandatory) ────── */
const TECHNIQUE_LABEL: Record<MotionTechnique, string> = {
  'svg-path-draw': 'draw SVG paths on scroll-in',
  'masked-reveal': 'reveal content through a moving mask/clip',
  'clip-path-transition': 'transition sections with a clip-path wipe',
  'parallax-depth': 'gentle multi-layer parallax for depth',
  'data-interpolation': 'interpolate data points into their final values',
  'progress-construction': 'construct charts/progress as they enter view',
  'orbital-relational': 'orbital/relational movement showing connections',
  'animated-gradient-bounded': 'a slow animated gradient kept inside a defined shape',
  'light-sweep': 'a subtle one-pass light sweep across a surface',
  'floating-depth': 'softly floating depth layers',
  'timeline-progression': 'progress a timeline as the section scrolls',
  'before-after-transform': 'a draggable/animated before→after transform',
  'card-cluster': 'cards clustering then expanding into place',
  'cursor-proximity': 'subtle cursor-proximity response on the hero',
  'ambient-environmental': 'slow ambient environmental movement',
};

function deriveMotion(dna: CategoryDNA, seed: number): MotionVocabulary {
  const techniques = uniq(dna.motion).slice(0, 4);
  const ambientTech = techniques[seed % techniques.length] || 'masked-reveal';
  return {
    ambient: clip(`ambient: ${TECHNIQUE_LABEL[ambientTech]} on the signature visual only — never distracting from reading`, 150),
    structural: clip(`structural: use ${TECHNIQUE_LABEL[techniques[1] || 'progress-construction']} to reveal relationships between content, steps or data`, 150),
    interaction: 'interaction: immediate, springy feedback on controls, cards, tabs and CTAs (transform/opacity only)',
    narrative: clip(`narrative: as sections enter, ${TECHNIQUE_LABEL[techniques[2] || 'timeline-progression']} to support the story — staggered, never all-at-once`, 150),
    stateTransition: 'state: animate loading, success, expand, filter and calculate transitions so state changes are perceivable',
    techniques,
    reducedMotionRule: 'every animation MUST have a prefers-reduced-motion fallback that shows the final state instantly with no motion; no motion may block interaction or cause layout shift',
    avoid: ['universal fade-up on every element', 'infinite aggressive bouncing or spinning icons', 'large full-screen blur/filter animations', 'hero motion that starts below the fold or shifts layout', 'fake loading sequences'],
  };
}

/* ── Rhythm plan (references composition ownership, adds peak/breathe intent) ──── */
function deriveRhythm(input: VisualConceptInput): VisualRhythmPlan {
  const sections = capList(input.composition?.sections, 24);
  const heroId = sections.find((s) => /hero/i.test(`${s.name} ${s.id} ${s.narrativeRole}`))?.id || sections[0]?.id;
  const dense: string[] = []; const breathe: string[] = [];
  for (const s of sections) {
    const d = (s as { density?: string }).density;
    if (d === 'rich' || d === 'dense') dense.push(s.id);
    else if (d === 'sparse') breathe.push(s.id);
  }
  return {
    peakSectionId: heroId ? clip(heroId, 60) : undefined,
    denseSectionIds: uniq(dense).slice(0, MAX_LIST),
    breatheSectionIds: uniq(breathe).slice(0, MAX_LIST),
    escalation: 'open with the signature peak, then alternate dense and breathing sections so intensity escalates and releases toward the conversion finale',
    antiUniformity: 'do not reuse the same three-card grid for consecutive sections; vary family, media role and column count (composition owns the diversity constraints)',
  };
}

/* ── Derivation entry point ──────────────────────────────────────────────────── */
export function deriveVisualConceptContract(input: VisualConceptInput): VisualConceptContract | undefined {
  try {
    if (!input || typeof input !== 'object') return undefined;
    const cat = classifyVisualCategory(input);
    const dna = CATEGORY_DNA[cat] || CATEGORY_DNA.generic;
    const seedKey = `${cat}|${input.identity?.primaryConcept || ''}|${input.identity?.sector || ''}|${clip(input.prompt, 120)}`;
    const seed = hashString(seedKey);
    const anchor = input.composition?.hero?.visualAnchor;
    const family = selectSignatureFamily(dna, anchor, seed);
    const familyMedium = FAMILY_MEDIUM[family];
    // The signature medium honours the composition anchor when the anchor names a concrete medium.
    const anchorMedium: VisualMedium | undefined = anchor === 'photograph' ? 'photography'
      : anchor === 'product-ui' ? 'product-ui' : anchor === 'typographic' ? 'typographic'
      : anchor === 'illustration' ? 'illustration' : undefined;
    const medium = anchorMedium || familyMedium;
    const photographic = medium === 'photography' || medium === 'environmental-lifestyle';
    const animated = family === 'living-data-field' || family === 'interactive-simulator'
      || family === 'visualized-workflow' || family === 'ambient-3d-scene' || family === 'diagrammatic-intelligence';
    const animatedTechnique: MotionTechnique | undefined = animated ? (dna.motion[0] || 'data-interpolation') : undefined;

    const evidence: string[] = [];
    if (input.composition) evidence.push('composition.hero.visualAnchor');
    if (input.imageCoverage) evidence.push('imageCoverage.targets/mode');
    if (input.visualSystem) evidence.push('visualSystem.colorMode/antiSlop');
    if (input.research?.artDirection) evidence.push('research.artDirection.visualThesis/imageSubjects');
    if (input.artDirection) evidence.push('artDirection.visualMetaphor/motionDirection');
    if (input.imageSlots?.length) evidence.push('assets.imageSlots');

    const visualThesis = clip(
      input.research?.artDirection?.visualThesis
      || input.artDirection?.visualMetaphor
      || `A ${cat.replace(/-/g, ' ')} experience where ${dna.thesisMotif}.`,
      MAX_TEXT,
    );

    const imageRoles = deriveImageRoles(input, cat, dna);
    const requiredPhotoCount = imageRoles.filter((r) => r.required && (r.medium === 'photography' || r.medium === 'environmental-lifestyle')).length;

    const signature: SignatureVisual = {
      family,
      fiveSecondMemory: FAMILY_MEMORY[family],
      dominantSubject: clip((input.research?.artDirection?.imageSubjects || [])[0] || input.artDirection?.imageryDirection || `the ${cat.replace(/-/g, ' ')} product's single strongest subject`, 120),
      focalPoint: 'one clear focal point in the first viewport; everything else supports it',
      layeringStrategy: photographic
        ? 'foreground copy → mid-ground subject → atmospheric background, with real separation (shadow/scrim/blur), not flat stacking'
        : 'layer the signature graphic with depth: base surface, primary shapes, and a light accent layer',
      copyToVisual: input.composition?.hero?.textMedia === 'media-led'
        ? 'visual dominant; concise headline overlaid with a guaranteed-contrast scrim'
        : 'balanced: headline and visual share the first screen with a clear hierarchy',
      medium,
      photographic,
      animated,
      animatedTechnique,
      placement: family === 'editorial-split' ? 'split: type on one side, visual on the other' : (photographic ? 'full-bleed or large framed within the first viewport' : 'dominant within the first viewport'),
      mobileFallback: 're-compose for mobile: stack headline above a re-cropped visual; never ship the desktop composition unchanged',
      emptySpaceBudget: 'generous but intentional negative space around the focal point — no huge empty void with a tiny visual',
      ctaProminence: 'the primary CTA is unmistakable in the first screen with strong contrast',
      lcpHandling: 'the signature image is the LCP: load it eagerly with fetchpriority=high and a reserved aspect ratio (experienceQuality enforces lazy/eager)',
      contrastRequirement: 'guarantee text contrast over the visual with a scrim/overlay (visualSystem owns the contrast tokens)',
      reducedMotionFallback: animated ? 'under prefers-reduced-motion, render the final composed frame with no animation' : 'no continuous motion required; any entrance respects prefers-reduced-motion',
      prohibited: uniq([
        ...(input.composition?.hero?.prohibited || []),
        'a generic dashboard floating on a gradient (unless the product genuinely is that UI)',
        'identical desktop and mobile composition',
        'hero image lazy-loading',
      ]).slice(0, MAX_LIST),
    };

    const motion = deriveMotion(dna, seed);
    const requiredAnimatedVisualCount = animated ? 1 : 0;

    const posture = dna.photography;
    const realImageStrategy: RealImageStrategy = {
      use: posture !== 'none' && (input.imageCoverage?.mode !== 'none') && !(input.imageCoverage as { explicitNoPhoto?: boolean } | undefined)?.explicitNoPhoto,
      posture,
      rationale: posture === 'photo-first'
        ? 'authentic photography materially builds trust and story for this category'
        : posture === 'none'
          ? 'this category reads as more credible with product/graphic surfaces than stock photography'
          : 'use photography only where human trust or real context genuinely helps; otherwise prefer product/graphic visuals',
      photographs: imageRoles.filter((r) => r.medium === 'photography' || r.medium === 'environmental-lifestyle')
        .map((r) => ({ role: r.role, subject: r.subject, purpose: r.narrativePurpose })).slice(0, MAX_LIST),
      forbidDecorativeStock: true,
    };

    const exclusions = uniq([...dna.exclusions, ...UNIVERSAL_EXCLUSIONS]).slice(0, MAX_LIST + 4);

    const reasons = [
      `category resolved to "${cat}" from ${input.identity?.sector || 'concept/prompt'} signals`,
      `signature family "${family}" chosen for medium ${medium}${anchor ? ` (consistent with composition anchor "${anchor}")` : ''}`,
      `${imageRoles.length} image role(s) art-directed; ${requiredPhotoCount} required photo(s)`,
    ].map((r) => clip(r, MAX_TEXT));

    return {
      version: 'visual-concept-v1',
      status: 'derived',
      category: cat,
      visualThesis,
      signature,
      media: uniq([medium, ...dna.media]).slice(0, 5),
      imageRoles,
      rhythm: deriveRhythm(input),
      motion,
      realImageStrategy,
      distinctiveness: clip(dna.distinctiveness, MAX_TEXT),
      exclusions,
      requiredPhotoCount,
      requiredAnimatedVisualCount,
      reasons,
      upstreamEvidenceUsedToDeriveContract: uniq(evidence).slice(0, MAX_LIST),
      contractPersistedInSpecification: true,
      contractRenderedToFrontendBuilder: false,   // flipped true by the render path
      contractUsedByAcceptance: false,             // flipped true by the analyze path
      agentsActuallyConsumingContract: [],
    };
  } catch {
    return undefined;   // never block the build on visual-concept derivation
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * RENDER — one hard-bounded builder block (≤ RENDER_CHAR_CEILING). Visual-first
 * ordering: thesis → signature → media → rhythm → motion → per-role art direction
 * → real-image strategy → exclusions, so the highest-value instructions lead.
 * ──────────────────────────────────────────────────────────────────────────── */
export function renderVisualConceptBlock(contract: VisualConceptContract | undefined): string[] {
  if (!contract || contract.status !== 'derived') return [];
  const s = contract.signature;
  const out: string[] = [];
  out.push(`BINDING VISUAL CONCEPT (deterministic; the ONE dominant visual idea — make the first screen feel premium; category: ${contract.category}):`);
  out.push(`- Visual thesis: ${clip(contract.visualThesis, MAX_TEXT)}`);
  out.push(`- Signature visual [${s.family}] — the 5-second memory: ${clip(s.fiveSecondMemory, MAX_TEXT)}`);
  out.push(`  · subject: ${clip(s.dominantSubject, 110)}; medium: ${s.medium}; focal: ${clip(s.focalPoint, 90)}`);
  out.push(`  · layering: ${clip(s.layeringStrategy, 130)}`);
  out.push(`  · copy↔visual: ${clip(s.copyToVisual, 110)}; CTA: ${clip(s.ctaProminence, 70)}; space: ${clip(s.emptySpaceBudget, 80)}`);
  out.push(`  · LCP: ${clip(s.lcpHandling, 130)}`);
  out.push(`  · mobile: ${clip(s.mobileFallback, 120)}`);
  if (s.animated) out.push(`  · motion: animated signature (${s.animatedTechnique}); reduced-motion: ${clip(s.reducedMotionFallback, 90)}`);
  out.push(`  · contrast: ${clip(s.contrastRequirement, 100)}`);
  if (s.prohibited.length) out.push(`  · hero must NOT: ${capList(s.prohibited, 5).map((p) => clip(p, 60)).join('; ')}`);
  out.push(`- Media palette (use only what fits, not all): ${contract.media.join(', ')}`);
  out.push(`- Visual rhythm: ${clip(contract.rhythm.escalation, 130)}; ${clip(contract.rhythm.antiUniformity, 130)}`);
  out.push(`- Motion vocabulary (designed, restrained, always reduced-motion-safe):`);
  out.push(`  · ${clip(contract.motion.ambient, 130)}`);
  out.push(`  · ${clip(contract.motion.structural, 130)}`);
  out.push(`  · ${clip(contract.motion.interaction, 130)}`);
  out.push(`  · ${clip(contract.motion.narrative, 130)}`);
  out.push(`  · reduced-motion: ${clip(contract.motion.reducedMotionRule, 130)}`);
  out.push(`  · avoid: ${capList(contract.motion.avoid, 4).join('; ')}`);
  if (contract.imageRoles.length) {
    out.push(`- Image art direction (${contract.imageRoles.length} slot(s); distinct subjects — never reuse one image across roles):`);
    for (const r of contract.imageRoles.slice(0, MAX_ROLES)) {
      out.push(`  · [${r.role}${r.required ? ' REQUIRED' : ''}] ${clip(r.subject, 80)} — ${r.medium}, ${r.orientation} ${r.aspectRatio}, ${clip(r.crop, 44)}; ${r.authenticity}; ${r.loadingPriority}; people:${r.peoplePresent}; alt:${clip(r.altIntent, 40)}`);
    }
  }
  out.push(`- Real-image strategy (${contract.realImageStrategy.posture}): ${clip(contract.realImageStrategy.rationale, 120)}${contract.realImageStrategy.forbidDecorativeStock ? ' — no decorative stock without narrative purpose' : ''}`);
  out.push(`- Distinctiveness: ${clip(contract.distinctiveness, MAX_TEXT)}`);
  out.push(`- NEVER (forbidden generic patterns): ${capList(contract.exclusions, MAX_LIST).map((e) => clip(e, 60)).join('; ')}`);
  out.push('- Creative freedom: within these boundaries, choose the exact imagery, illustration and micro-composition freely; do not invent fake logos, metrics, or certifications.');
  // Hard char ceiling — drop trailing lines rather than overrun the prompt budget.
  let total = 0; const bounded: string[] = [];
  for (const line of out) { total += line.length + 1; if (total > RENDER_CHAR_CEILING) break; bounded.push(line); }
  return bounded;
}

/* ────────────────────────────────────────────────────────────────────────────
 * ACCEPTANCE — conservative, evidence-backed, non-duplicative, fail-open. Reuses
 * experienceQuality's ONE JSX scanner. Blocks only the three genuinely-unowned
 * visual defects; everything ambiguous is a warning.
 * ──────────────────────────────────────────────────────────────────────────── */
export type VisualIssueCode =
  | 'visual-signature-missing' | 'visual-role-collapse' | 'visual-signature-placeholder'
  | 'visual-photo-gradient' | 'visual-animated-absent' | 'visual-repeat-warn' | 'visual-warn';

export interface VisualIssue {
  code: VisualIssueCode;
  severity: FrontendBuilderReviewSeverity;
  subPolicy: 'signature' | 'image-role' | 'motion';
  label: string;
  files: string[];
  evidence: string;
  repairInstruction: string;
}
export interface VisualAcceptanceResult {
  status: 'pass' | 'warning' | 'fail';
  legacy: boolean;
  analyzedFileCount: number;
  renderedImageCount: number;
  repeatedImageCount: number;
  heroLocated: boolean;
  issues: VisualIssue[];
}
const LEGACY_VISUAL: VisualAcceptanceResult = {
  status: 'pass', legacy: true, analyzedFileCount: 0, renderedImageCount: 0, repeatedImageCount: 0, heroLocated: false, issues: [],
};
function capEv(s: string): string { const t = (s || '').replace(/\s+/g, ' ').trim(); return t.length > MAX_EVIDENCE ? t.slice(0, MAX_EVIDENCE) : t; }

interface RenderedImg { path: string; src: string; alt: string; lazy: boolean; }
function srcOf(attr: string): string {
  const m = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*[`'"]([^`'"]*)[`'"]\s*\})/.exec(attr);
  return (m ? (m[1] ?? m[2] ?? m[3] ?? '') : '').trim();
}
function altOf(attr: string): string {
  const m = /\balt\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(attr);
  return (m ? (m[1] ?? m[2] ?? '') : '').trim();
}
const PLACEHOLDER_SRC = /^\s*$|placeholder|placehold\.co|via\.placeholder|example\.com\/(?:image|img)|dummyimage|lorempixel|\bTODO\b/i;
const LOGO_ISH = /logo|icon|favicon|avatar|sprite|badge|flag|symbol/i;
function isRealContentImage(src: string): boolean {
  if (!src || PLACEHOLDER_SRC.test(src)) return false;
  if (LOGO_ISH.test(src)) return false;
  if (/^data:/i.test(src)) return false;          // inline data-uri (dedup would be by payload; skip)
  return /^https?:\/\//i.test(src) || /^\/?assets?\//i.test(src) || /\.(?:jpe?g|png|webp|avif|gif)(?:\?|$)/i.test(src);
}

/** Locate the hero region's cleaned facts, or null when it cannot be confidently found (fail open). */
function heroFacts(files: FrontendGeneratedFile[], contract: VisualConceptContract): SectionFacts | null {
  try {
    const ids = uniq([
      contract.rhythm.peakSectionId || '',
      ...contract.imageRoles.filter((r) => r.role === 'hero-signature').map((r) => r.sectionId),
    ].filter(Boolean));
    if (ids.length) {
      const units = collectSectionUnits(files, ids);
      const u = units[0];
      if (u) return factsFor(u.id, u.path, u.content);
    }
    // Fallback: a file whose path names a hero.
    const heroFile = files.find((f) => /hero/i.test(f.path || ''));
    if (heroFile) return factsFor('hero', heroFile.path, heroFile.content);
    return null;
  } catch { return null; }
}
function hasNonPhotoVisual(f: SectionFacts): boolean {
  const r = f.render; const c = f.clean;
  return /<svg\b/i.test(c) || /<canvas\b/i.test(c)
    || /Chart|Recharts|ResponsiveContainer|<Area|<Bar|<Line|<Pie|<Radar/i.test(c)
    || /\brole=["']img["']/i.test(r)
    || /background(?:-image)?\s*:\s*url\(/i.test(c) || /backgroundImage/i.test(c)
    || /<img\b/i.test(c);
}

export function analyzeVisualContribution(
  files: FrontendGeneratedFile[] | undefined,
  contract: VisualConceptContract | undefined,
): VisualAcceptanceResult {
  try {
    if (!contract || contract.status !== 'derived') return LEGACY_VISUAL;
    const list = Array.isArray(files) ? files : [];
    if (!list.length) return { ...LEGACY_VISUAL, legacy: false };
    const issues: VisualIssue[] = [];
    const push = (x: VisualIssue) => { if (issues.length < MAX_ISSUES) issues.push(x); };

    // Global rendered-image inventory (comment/string-safe via the shared scanner).
    const imgs: RenderedImg[] = [];
    let motionEvidence = false;
    for (const file of list) {
      const content = (file.content || '').slice(0, MAX_SCAN);
      if (!motionEvidence && (/from\s+['"]framer-motion['"]/.test(content) || /\b(?:whileInView|whileHover|animate=|initial=|@keyframes|keyframes|animate-\[|animate-(?:spin|pulse|bounce|ping)|transition-(?:all|transform|opacity|colors)|<animate\b|requestAnimationFrame)\b/.test(content))) motionEvidence = true;
      let els: ReturnType<typeof scanElements> = [];
      try { els = scanElements(content); } catch { els = []; }
      for (const el of els) {
        if (el.tag !== 'img' && el.tag !== 'source') continue;
        imgs.push({ path: file.path || '', src: srcOf(el.attr), alt: altOf(el.attr), lazy: /\bloading\s*=\s*["']lazy["']/i.test(el.attr) });
      }
    }

    // (1) ROLE COLLAPSE — the same real content image reused across ≥2 distinct section files while the
    //     concept requires ≥2 distinct image roles. Cross-role URL dedup is owned by NOBODY else.
    const requiredDistinctRoles = uniq(contract.imageRoles.filter((r) => r.required).map((r) => r.role)).length;
    const bySrc = new Map<string, Set<string>>();
    for (const im of imgs) {
      if (!isRealContentImage(im.src)) continue;
      const key = im.src.split('?')[0];
      if (!bySrc.has(key)) bySrc.set(key, new Set());
      bySrc.get(key)!.add(im.path || im.src);
    }
    const repeated = [...bySrc.entries()].filter(([, paths]) => paths.size >= 2);
    if (repeated.length && requiredDistinctRoles >= 2) {
      const worst = repeated.sort((a, b) => b[1].size - a[1].size)[0];
      push({
        code: 'visual-role-collapse', severity: 'major', subPolicy: 'image-role', label: 'one image reused across roles',
        files: uniq(imgs.filter((im) => im.src.split('?')[0] === worst[0]).map((im) => im.path)).slice(0, MAX_ISSUE_FILES),
        evidence: capEv(`the same image (${clip(worst[0], 80)}) is rendered in ${worst[1].size} different sections although the visual concept requires ${requiredDistinctRoles} DISTINCT image roles — the page collapses to one repeated visual`),
        repairInstruction: 'Give each required image role its own distinct, purpose-specific image; do not reuse one URL across multiple narrative roles.',
      });
    } else if (repeated.length) {
      push({
        code: 'visual-repeat-warn', severity: 'minor', subPolicy: 'image-role', label: 'repeated content image',
        files: uniq(imgs.filter((im) => repeated.some(([k]) => im.src.split('?')[0] === k)).map((im) => im.path)).slice(0, MAX_ISSUE_FILES),
        evidence: capEv(`a content image repeats across ${repeated[0][1].size} sections — verify the repetition is intentional and not a placeholder fill`),
        repairInstruction: 'Prefer distinct imagery per section unless the repeat is intentional.',
      });
    }

    // Hero-scoped checks.
    const hero = heroFacts(list, contract);
    const s = contract.signature;
    if (hero) {
      // (2) SIGNATURE PLACEHOLDER — the hero renders an <img> with an empty/placeholder src.
      const heroImgs = hero.elements.filter((e) => e.tag === 'img');
      const placeholder = heroImgs.find((e) => { const src = srcOf(e.attr); return PLACEHOLDER_SRC.test(src); });
      if (placeholder) {
        push({
          code: 'visual-signature-placeholder', severity: 'major', subPolicy: 'signature', label: 'hero signature is a placeholder',
          files: [hero.path],
          evidence: capEv(`the hero signature image renders a placeholder/empty src ("${clip(srcOf(placeholder.attr), 60)}") — the most memorable visual is a stand-in, not a real asset`),
          repairInstruction: 'Render the hero signature with a real, purpose-built image (or a real SVG/graphic); never ship a placeholder URL as the hero.',
        });
      }
      // (3) NON-PHOTO SIGNATURE MISSING — only for media that CANNOT exist as plain text: data-viz,
      //     technical-diagram and 3d REQUIRE a drawing surface (svg/canvas/chart), and a product-ui
      //     signature that is ALSO sparse (few elements) is an empty stand-in. Typographic / illustration
      //     / collage / abstract signatures are exempt (they may legitimately be text- or CSS-only), and a
      //     rich div-built product mock is exempt (element-dense). imageCoverage owns photo presence.
      else if (!s.photographic && !hasNonPhotoVisual(hero) && !hero.hasChildComponent) {
        const requiresDrawSurface = s.medium === 'data-visualization' || s.medium === 'technical-diagram' || s.medium === '3d-scene';
        const sparseProductUi = s.medium === 'product-ui' && hero.elements.length < 8;
        if (requiresDrawSurface || sparseProductUi) {
          push({
            code: 'visual-signature-missing', severity: 'major', subPolicy: 'signature', label: 'signature visual absent in hero',
            files: [hero.path],
            evidence: capEv(`the hero declares a ${s.medium} signature (${s.family}) but its markup renders no svg/canvas/chart/product surface — only text on a plain surface, so the signature visual is missing`),
            repairInstruction: `Implement the ${s.family} signature as a real ${s.medium} visual (SVG/canvas/chart/product surface) in the first viewport; it is the memorable moment.`,
          });
        }
      }
      // (4) PHOTO-AS-GRADIENT (warn) — a photographic signature that rendered only a gradient, no image.
      else if (s.photographic && !heroImgs.length && !/background(?:-image)?\s*:\s*url\(|backgroundImage/i.test(hero.clean) && /bg-gradient|from-|to-/.test(hero.render) && !hero.hasChildComponent) {
        push({
          code: 'visual-photo-gradient', severity: 'minor', subPolicy: 'signature', label: 'photographic hero rendered as gradient',
          files: [hero.path],
          evidence: capEv('the hero declares a photographic signature but renders only a gradient with no image — verify a real photograph is intended (image coverage owns the required-photo count)'),
          repairInstruction: 'Render the intended hero photograph (or switch the concept to a non-photographic signature); a bare gradient is not the signature.',
        });
      }
    }

    // (5) REQUIRED ANIMATED VISUAL ABSENT (warn) — the concept requires an animated signature but no
    //     motion implementation evidence exists anywhere. Warning only (never a false block on a
    //     perfectly-good static build); experienceQuality owns unbounded/continuous motion.
    if (contract.requiredAnimatedVisualCount >= 1 && !motionEvidence) {
      push({
        code: 'visual-animated-absent', severity: 'minor', subPolicy: 'motion', label: 'required animated visual not evidenced',
        files: [],
        evidence: capEv(`the visual concept calls for an animated ${s.family} signature but no motion implementation (framer-motion, CSS keyframes/animate-*, SVG <animate>, or rAF) was found`),
        repairInstruction: 'Implement the signature motion with a reduced-motion fallback (framer-motion or CSS keyframes); keep it restrained and above the fold.',
      });
    }

    const majors = issues.filter((i) => i.severity !== 'minor').length;
    const status: VisualAcceptanceResult['status'] = majors > 0 ? 'fail' : (issues.length ? 'warning' : 'pass');
    return {
      status, legacy: false,
      analyzedFileCount: list.length,
      renderedImageCount: imgs.filter((im) => isRealContentImage(im.src)).length,
      repeatedImageCount: repeated.length,
      heroLocated: !!hero,
      issues,
    };
  } catch {
    return LEGACY_VISUAL;   // fail open — visual acceptance never hard-errors the build
  }
}

export function hasBlockingVisualFindings(result: VisualAcceptanceResult | undefined): boolean {
  return !!result && result.status === 'fail';
}

const VISUAL_CATEGORY: Record<VisualIssueCode, FrontendBuilderReviewCategory> = {
  'visual-signature-missing': 'visual-hierarchy',
  'visual-role-collapse': 'generic-template',
  'visual-signature-placeholder': 'visual-hierarchy',
  'visual-photo-gradient': 'component-composition',
  'visual-animated-absent': 'motion-and-interaction',
  'visual-repeat-warn': 'generic-template',
  'visual-warn': 'component-composition',
};

export function visualToReviewIssues(result: VisualAcceptanceResult | undefined): FrontendBuilderReviewIssue[] {
  if (!result || !result.issues.length) return [];
  const out: FrontendBuilderReviewIssue[] = [];
  let i = 0;
  for (const issue of result.issues) {
    if (issue.severity === 'minor') continue;    // advisory — never a repair blocker
    out.push({
      id: `visual-${issue.code}-${i += 1}`,
      severity: issue.severity,
      category: VISUAL_CATEGORY[issue.code],
      files: (issue.files || []).slice(0, MAX_ISSUE_FILES),
      evidence: capEv(issue.evidence),
      repairInstruction: capEv(issue.repairInstruction),
    });
    if (out.length >= MAX_ISSUES) break;
  }
  return out;
}

export function visualIssueCodes(result: VisualAcceptanceResult | undefined): string[] {
  return result && result.issues.length ? uniq(result.issues.map((i) => i.code)) : [];
}

/* ── Owner diagnostics (bounded, secret-free) ─────────────────────────────────── */
export interface VisualConceptDiagnostics {
  version: 'visual-concept-v1';
  category: string;
  signatureFamily: SignatureHeroFamily;
  signatureMedium: VisualMedium;
  signatureAnimated: boolean;
  selectedMedia: VisualMedium[];
  imageRoleCount: number;
  requiredPhotoCount: number;
  requiredAnimatedVisualCount: number;
  renderedImageCount: number;
  repeatedImageCount: number;
  heroLocated: boolean;
  acceptanceStatus: 'pass' | 'warning' | 'fail' | 'legacy';
  issueCodes: string[];
  promptCharCount: number;
  contractRenderedToFrontendBuilder: boolean;
  contractUsedByAcceptance: boolean;
  agentsActuallyConsumingContract: string[];
  upstreamEvidenceUsedToDeriveContract: string[];
}

export function buildVisualConceptDiagnostics(
  contract: VisualConceptContract | undefined,
  acceptance: VisualAcceptanceResult | undefined,
  promptCharCount: number,
): VisualConceptDiagnostics | undefined {
  if (!contract || contract.status !== 'derived') return undefined;
  const rendered = promptCharCount > 0;
  const analyzed = !!acceptance && !acceptance.legacy;
  const consumers = uniq([
    ...(rendered ? ['frontend-builder-prompt'] : []),
    ...(analyzed ? ['frontend-acceptance'] : []),
  ]);
  return {
    version: 'visual-concept-v1',
    category: contract.category,
    signatureFamily: contract.signature.family,
    signatureMedium: contract.signature.medium,
    signatureAnimated: contract.signature.animated,
    selectedMedia: contract.media,
    imageRoleCount: contract.imageRoles.length,
    requiredPhotoCount: contract.requiredPhotoCount,
    requiredAnimatedVisualCount: contract.requiredAnimatedVisualCount,
    renderedImageCount: acceptance?.renderedImageCount ?? 0,
    repeatedImageCount: acceptance?.repeatedImageCount ?? 0,
    heroLocated: acceptance?.heroLocated ?? false,
    acceptanceStatus: acceptance ? (acceptance.legacy ? 'legacy' : acceptance.status) : 'legacy',
    issueCodes: visualIssueCodes(acceptance),
    promptCharCount: Math.max(0, Math.round(promptCharCount)),
    contractRenderedToFrontendBuilder: rendered,
    contractUsedByAcceptance: analyzed,
    agentsActuallyConsumingContract: consumers,
    upstreamEvidenceUsedToDeriveContract: contract.upstreamEvidenceUsedToDeriveContract,
  };
}
