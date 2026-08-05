/**
 * Web Build — BINDING PAGE COMPOSITION contract + section-rhythm + responsive hierarchy (Phase).
 *
 * ONE authoritative, additive, JSON-safe composition contract that turns the EXISTING descriptive
 * layout signals (FrontendSpecSection, PageBlueprint, Art Direction, research direction, binding
 * requirements, image coverage) into a BINDING, per-section spatial contract across the COMPLETE
 * ordered page — controlling each section's composition family, priority/hierarchy, alignment,
 * text↔media relationship, media role, density, whitespace, interaction emphasis, adjacency rhythm
 * and desktop/mobile order. It exists to stop the generic "hero → centered copy → three equal cards
 * → grid → testimonials → CTA" collapse WITHOUT forcing every sector into one aesthetic.
 *
 * Design rules: composition FAMILIES are primitives, never whole-site templates; selection is
 * derived from each section's own purpose/media/interaction + the researched decision journey +
 * sector appropriateness; adjacency resolution is DETERMINISTIC (no Math.random / time / ids) so the
 * same normalized input yields the same contract; legitimate internal repetition (a catalog of
 * product cards inside ONE section) is never confused with repeating the same TOP-LEVEL composition
 * across unrelated sections. Cards, grids, split layouts, gradients, dark themes and glass remain
 * allowed when justified — only unjustified repetition and missing hierarchy are the defect.
 *
 * Acceptance is conservative and SECTION/COMPONENT-SCOPED (never global token composition): the only
 * hard blocker is a proven top-level template collapse; hero weakness, low diversity, flat visual
 * weight and responsive risks are manual-review warnings. Functional depth defers to PR #558, image
 * coverage to PR #559, sector/claims to PR #560. Fail-open; additive/optional for old builds.
 */
import type {
  FrontendGeneratedFile, FrontendBuilderReviewIssue, FrontendBuilderReviewSeverity, FrontendBuilderReviewCategory,
  FrontendSpecIdentity, FrontendSpecSection, PageBlueprint, ArtDirectionArtifact,
  FrontendBindingRequirements, FrontendSpecImageSlot, StrategicThinkingLedger,
} from '@/lib/webBuildAgents';
import type { ResearchDirectionContract } from '@/lib/webBuildResearchDirection';
import type { ImageCoverageRequirement } from '@/lib/webBuildImageCoverage';
// Shared, authoritative section-source correlation/extraction (single source of truth; see PR #561).
import { collectSectionUnits } from '@/lib/webBuildSectionSource';

/* ── Bounds (named, mandatory) ─────────────────────────────────────────────── */
const MAX_SECTIONS = 24;
const MAX_LIST = 8;
const MAX_TEXT = 160;
const MAX_SLOT_IDS = 6;
const MAX_ISSUES = 24;
const MAX_ISSUE_FILES = 4;
const MAX_EVIDENCE = 180;
const COLLAPSE_MIN = 4;            // ≥ this many DISTINCT top-level sections identical → collapse
const CONSECUTIVE_COLLAPSE = 3;    // ≥ this many CONSECUTIVE identical top-level sections → collapse

/* ── Public contract types (persisted, all additive/optional for old builds) ── */
export type CompositionFamily =
  | 'immersive-hero' | 'editorial-split' | 'asymmetric-media' | 'narrative-rail'
  | 'comparison-band' | 'feature-mosaic' | 'sequential-steps' | 'gallery-strip'
  | 'focused-tool' | 'proof-ledger' | 'catalog-index' | 'full-bleed-transition'
  | 'compact-utility' | 'conversion-finale' | 'standard-stack';
export type CompositionPriority = 'primary' | 'secondary' | 'supporting';
export type CompositionAlignment = 'left' | 'center' | 'split' | 'asymmetric' | 'full-bleed';
export type CompositionContainer = 'contained' | 'wide' | 'full-bleed';
export type CompositionDensity = 'sparse' | 'balanced' | 'rich' | 'dense';
export type TextMediaRelation = 'text-only' | 'text-led' | 'balanced' | 'media-led';
export type MediaRole = 'none' | 'anchor' | 'support' | 'background';
export type MobileStack = 'stack' | 'reorder' | 'collapse' | 'carousel-accessible';
export type CompositionWhitespace = 'tight' | 'comfortable' | 'generous';
export type CompositionSurface = 'flat' | 'raised' | 'bordered' | 'gradient' | 'glass';

export interface SectionCompositionContract {
  id: string;
  name: string;
  purpose: string;
  narrativeRole: string;
  priority: CompositionPriority;
  hierarchyLevel: number;              // 1 dominant … 3 supporting
  family: CompositionFamily;
  alignment: CompositionAlignment;
  container: CompositionContainer;
  textMedia: TextMediaRelation;
  mediaRole: MediaRole;
  approvedSlotIds: string[];
  visualAnchor: string;
  density: CompositionDensity;
  interactionEmphasis: 'none' | 'secondary' | 'primary';
  bindingRequirementId?: string;
  surface: CompositionSurface;
  whitespace: CompositionWhitespace;
  desktopOrder: number;
  mobileOrder: number;
  mobileStack: MobileStack;
  allowedPrimitives: string[];
  forbidImmediateRepeat: boolean;
  reasons: string[];
}

export interface HeroCompositionContract {
  narrativeRole: string;
  textMedia: TextMediaRelation;
  headlineHierarchy: string;
  ctaModel: 'single' | 'primary+secondary';
  visualAnchor: 'photograph' | 'typographic' | 'product-ui' | 'illustration' | 'none';
  aboveFoldBudget: string;
  mediaTreatment: string;
  trustPlacement: string;
  interactionPresent: boolean;
  desktopOrder: string;
  mobileOrder: string;
  minBreathingRoom: string;
  prohibited: string[];
}

export interface ResponsiveSection { id: string; desktopOrder: number; mobileOrder: number; mobileStack: MobileStack; }
export interface ResponsiveContract {
  preserveDomOrder: boolean;
  noHorizontalOverflow: boolean;
  minTouchTargetPx: number;
  sections: ResponsiveSection[];
  obligations: string[];
}

export interface CompositionTransition { fromId: string; toId: string; relationship: string; }

/* ── Whole-page RHYTHM (Phase — the deliberate intensity/contrast sequence across the page so the
 *  page has one climax and a real build-up/release, not a flat run of equally-loud sections). Derived
 *  from the SAME per-section signals already computed (hierarchyLevel, density, surface, family,
 *  interactionEmphasis) — never a new narrative architecture. Optional/bounded/deterministic. */
export type PageBeatRole =
  | 'opening' | 'build-up' | 'demonstration' | 'reveal' | 'proof' | 'pause'
  | 'secondary-peak' | 'conversion' | 'resolution';
export type BeatIntensity = 'low' | 'medium' | 'high' | 'peak';
export type BeatBackground = 'canvas' | 'tinted' | 'inverted' | 'media';
export interface PageRhythmBeat {
  sectionId: string;
  role: PageBeatRole;
  intensity: BeatIntensity;
  background: BeatBackground;
  contrastWithPrev: 'same' | 'step-up' | 'step-down' | 'flip';
}
export interface PageRhythm {
  beats: PageRhythmBeat[];
  peakSectionId: string;     // the single visual climax (never two adjacent peaks)
  summary: string;
}

export interface CompositionContract {
  version: 'composition-v1';
  status: 'derived' | 'legacy';
  compositionThesis: string;
  narrativeArc: string;
  densityProfile: string;
  globalRhythm: string;
  maxConsecutiveSimilarSections: number;
  hero: HeroCompositionContract;
  sections: SectionCompositionContract[];
  transitions: CompositionTransition[];
  /** Whole-page intensity/contrast rhythm (optional; absent for legacy contracts). */
  pageRhythm?: PageRhythm;
  responsive: ResponsiveContract;
  diversityConstraints: string[];
  dominantSectionCount: number;
  familyDistribution: Record<string, number>;
  consecutiveRepeatResolutions: number;
  reasons: string[];
  /* ── Truthful consumption trace. ── */
  upstreamEvidenceUsedToDeriveContract: string[];
  contractPersistedInSpecification: boolean;
  contractRenderedToFrontendBuilder: boolean;
  contractUsedByAcceptance: boolean;
  agentsActuallyConsumingContract: string[];
}

/* ── Small pure helpers ────────────────────────────────────────────────────── */
function clip(s: unknown, n = MAX_TEXT): string { return (typeof s === 'string' ? s : '').replace(/\s+/g, ' ').trim().slice(0, n); }
function uniq<T>(a: T[]): T[] { return [...new Set(a)]; }
function has(hay: string, re: RegExp): boolean { return re.test(hay); }

/* ── Composition family specs (executable defaults per primitive). EXHAUSTIVE. ── */
interface FamilySpec { alignment: CompositionAlignment; container: CompositionContainer; textMedia: TextMediaRelation; density: CompositionDensity; surface: CompositionSurface; primitives: string[]; }
const FAMILY_SPEC: Record<CompositionFamily, FamilySpec> = {
  'immersive-hero': { alignment: 'full-bleed', container: 'full-bleed', textMedia: 'media-led', density: 'sparse', surface: 'gradient', primitives: ['full-bleed media', 'overlaid headline', 'single primary CTA'] },
  'editorial-split': { alignment: 'split', container: 'contained', textMedia: 'balanced', density: 'balanced', surface: 'flat', primitives: ['two-column split', 'text + single media', 'asymmetric ratio'] },
  'asymmetric-media': { alignment: 'asymmetric', container: 'wide', textMedia: 'media-led', density: 'balanced', surface: 'flat', primitives: ['off-grid media', 'overlapping caption', 'generous whitespace'] },
  'narrative-rail': { alignment: 'left', container: 'contained', textMedia: 'text-led', density: 'balanced', surface: 'flat', primitives: ['reading measure column', 'inline emphasis', 'quiet supporting media'] },
  'comparison-band': { alignment: 'center', container: 'wide', textMedia: 'text-led', density: 'rich', surface: 'bordered', primitives: ['comparison columns', 'differentiated emphasis', 'one recommended option'] },
  'feature-mosaic': { alignment: 'left', container: 'wide', textMedia: 'balanced', density: 'rich', surface: 'raised', primitives: ['uneven mosaic', 'one feature emphasized', 'mixed tile sizes'] },
  'sequential-steps': { alignment: 'left', container: 'contained', textMedia: 'text-led', density: 'balanced', surface: 'flat', primitives: ['numbered steps', 'connective flow', 'progress rhythm'] },
  'gallery-strip': { alignment: 'full-bleed', container: 'wide', textMedia: 'media-led', density: 'rich', surface: 'flat', primitives: ['story gallery', 'varied crop sizes', 'accessible horizontal or masonry'] },
  'focused-tool': { alignment: 'split', container: 'contained', textMedia: 'balanced', density: 'balanced', surface: 'raised', primitives: ['controls + live output', 'clear result panel', 'labelled inputs'] },
  'proof-ledger': { alignment: 'center', container: 'wide', textMedia: 'text-led', density: 'balanced', surface: 'flat', primitives: ['real proof only', 'quote or credential', 'no invented metrics'] },
  'catalog-index': { alignment: 'left', container: 'wide', textMedia: 'media-led', density: 'dense', surface: 'flat', primitives: ['product/index grid', 'consistent card unit', 'filter or sort where useful'] },
  'full-bleed-transition': { alignment: 'full-bleed', container: 'full-bleed', textMedia: 'media-led', density: 'sparse', surface: 'gradient', primitives: ['full-bleed break', 'single statement', 'palette shift'] },
  'compact-utility': { alignment: 'center', container: 'contained', textMedia: 'text-only', density: 'sparse', surface: 'flat', primitives: ['one-line utility', 'inline action', 'minimal chrome'] },
  'conversion-finale': { alignment: 'center', container: 'contained', textMedia: 'text-led', density: 'balanced', surface: 'gradient', primitives: ['decisive CTA', 'reassurance line', 'no competing links'] },
  'standard-stack': { alignment: 'left', container: 'contained', textMedia: 'text-led', density: 'balanced', surface: 'flat', primitives: ['clear heading', 'supporting content', 'single focal element'] },
};

// Deterministic, purpose-appropriate alternatives for adjacency resolution. EXHAUSTIVE.
const ALT_BY_FAMILY: Record<CompositionFamily, CompositionFamily[]> = {
  'immersive-hero': ['editorial-split', 'asymmetric-media'],
  'editorial-split': ['asymmetric-media', 'narrative-rail', 'feature-mosaic'],
  'asymmetric-media': ['editorial-split', 'gallery-strip', 'narrative-rail'],
  'narrative-rail': ['editorial-split', 'sequential-steps', 'asymmetric-media'],
  'comparison-band': ['feature-mosaic', 'proof-ledger', 'sequential-steps'],
  'feature-mosaic': ['editorial-split', 'sequential-steps', 'asymmetric-media', 'comparison-band'],
  'sequential-steps': ['narrative-rail', 'feature-mosaic', 'editorial-split'],
  'gallery-strip': ['asymmetric-media', 'editorial-split', 'catalog-index'],
  'focused-tool': ['editorial-split', 'sequential-steps'],
  'proof-ledger': ['narrative-rail', 'comparison-band', 'editorial-split'],
  'catalog-index': ['gallery-strip', 'feature-mosaic'],
  'full-bleed-transition': ['asymmetric-media', 'editorial-split'],
  'compact-utility': ['standard-stack', 'conversion-finale'],
  'conversion-finale': ['full-bleed-transition', 'editorial-split'],
  'standard-stack': ['editorial-split', 'narrative-rail', 'asymmetric-media'],
};

const IMAGE_SECTORS = new Set(['travel-tourism', 'restaurant-hospitality', 'real-estate', 'portfolio-agency', 'furniture-interiors', 'jewelry', 'automotive-dealership', 'landscaping']);
const SOFTWARE_SECTORS = new Set(['ai-saas', 'marketplace']);

/* ────────────────────────────────────────────────────────────────────────────
 * DERIVATION — one binding composition contract from existing authoritative artifacts.
 * ──────────────────────────────────────────────────────────────────────────── */
export interface CompositionInput {
  identity: FrontendSpecIdentity;
  sections: FrontendSpecSection[];
  blueprint?: PageBlueprint;
  research?: ResearchDirectionContract;
  artDirection?: ArtDirectionArtifact;
  binding?: FrontendBindingRequirements;
  imageCoverage?: ImageCoverageRequirement;
  imageSlots?: FrontendSpecImageSlot[];
  ledger?: StrategicThinkingLedger;
}

function sectionText(s: FrontendSpecSection): string {
  return `${s.purpose || ''} ${s.name || ''} ${s.componentHint || ''} ${s.visualModule || ''} ${s.layoutVariant || ''} ${(s.interactionHints || []).join(' ')}`.toLowerCase();
}
function sectionHasMedia(s: FrontendSpecSection): boolean { return (s.assetSlotIds || []).length > 0 || /image|photo|gallery|media|visual|hero/.test(`${s.visualModule || ''} ${s.componentHint || ''}`.toLowerCase()); }

/** Does this section correspond to an explicit binding interactive requirement? Returns its id. */
function bindingInteractiveId(s: FrontendSpecSection, binding: FrontendBindingRequirements | undefined): string | undefined {
  if (!binding || !Array.isArray(binding.requirements)) return undefined;
  const p = sectionText(s);
  const req = binding.requirements.find((r) => r.required && (r.kind === 'interactive-experience' || r.kind === 'dynamic-outcome')
    && (p.includes((r.label || '').toLowerCase().split(/\s+/)[0] || '') || (r.aliases || []).some((a) => a && p.includes(a.toLowerCase()))));
  return req?.id;
}

function classifyFamily(s: FrontendSpecSection, index: number, total: number, functional: boolean): CompositionFamily {
  const p = sectionText(s);
  const media = sectionHasMedia(s);
  if (index === 0) return media ? 'immersive-hero' : 'editorial-split';
  if (functional) return 'focused-tool';
  if (has(p, /gallery|portfolio|showcase|\bwork\b|projects|lookbook|destinations?/)) return 'gallery-strip';
  if (has(p, /\bstep|process|how it works|journey|timeline|itinerary|workflow/)) return 'sequential-steps';
  if (has(p, /compar|pricing|plans?|packages?|tiers?|membership/)) return 'comparison-band';
  if (has(p, /testimonial|review|proof|trusted|logos|clients?|press|awards?|stats?|results|credential|accredit/)) return 'proof-ledger';
  if (has(p, /catalog|products?|\bmenu\b|listings?|rooms?|inventory|collection|shop|store|fleet|properties/)) return 'catalog-index';
  if (has(p, /feature|benefit|service|offer|capabilit|amenit|highlight|what we|why /)) return 'feature-mosaic';
  if (has(p, /about|story|mission|team|values|who we|philosophy|heritage/)) return media ? 'editorial-split' : 'narrative-rail';
  if (index === total - 1 || has(p, /\bcta\b|contact|get started|book now|sign up|enquir|reserve|final|newsletter|subscribe|join/)) return 'conversion-finale';
  if (has(p, /banner|quote|statement|manifesto/)) return 'full-bleed-transition';
  return media ? 'asymmetric-media' : 'standard-stack';
}

function pickDensity(s: FrontendSpecSection, fam: CompositionFamily): CompositionDensity {
  const d = (s.density || '').toLowerCase();
  if (/minimal|airy|sparse|low/.test(d)) return 'sparse';
  if (/dense|high|compact/.test(d)) return 'dense';
  if (/rich|editorial|immersive/.test(d)) return 'rich';
  return FAMILY_SPEC[fam].density;
}

/* ── Whole-page rhythm derivation. Reuses per-section hierarchy/density/surface/family already
 *  computed; picks exactly ONE climax (the dominant non-hero section, else the hero) so the page has a
 *  single peak with deliberate build-up and release. Bounded + deterministic. ── */
const INTENSITY_RANK: Record<BeatIntensity, number> = { low: 0, medium: 1, high: 2, peak: 3 };
function beatBackground(s: SectionCompositionContract): BeatBackground {
  if (s.mediaRole === 'background') return 'media';
  if (s.surface === 'glass' || s.surface === 'gradient') return 'inverted';
  if (s.surface === 'raised' || s.surface === 'bordered') return 'tinted';
  return 'canvas';
}
function beatRole(s: SectionCompositionContract, i: number, last: number, isSecondDominant: boolean): PageBeatRole {
  if (i === 0) return 'opening';
  if (s.family === 'conversion-finale') return 'conversion';
  if (s.interactionEmphasis === 'primary' || s.family === 'focused-tool') return 'demonstration';
  if (s.family === 'proof-ledger' || /proof|testimonial|trust|review|result|case/i.test(s.narrativeRole)) return 'proof';
  if (s.family === 'gallery-strip' || s.family === 'full-bleed-transition') return 'reveal';
  if (isSecondDominant) return 'secondary-peak';
  if (i === last) return 'resolution';
  if (s.density === 'sparse' && s.hierarchyLevel === 3) return 'pause';
  return 'build-up';
}
function derivePageRhythm(sections: SectionCompositionContract[]): PageRhythm | undefined {
  if (!sections.length) return undefined;
  const last = sections.length - 1;
  const climaxIdx = sections.findIndex((s, i) => i > 0 && s.hierarchyLevel === 1);
  const peakIdx = climaxIdx >= 0 ? climaxIdx : 0;
  const beats: PageRhythmBeat[] = [];
  for (let i = 0; i < sections.length; i += 1) {
    const s = sections[i];
    const isSecondDominant = s.hierarchyLevel === 1 && i > 0 && i !== peakIdx;
    const intensity: BeatIntensity = i === peakIdx ? 'peak'
      : s.hierarchyLevel === 1 ? 'high' : s.hierarchyLevel === 2 ? 'medium' : 'low';
    const background = beatBackground(s);
    const prev = beats[beats.length - 1];
    let contrastWithPrev: PageRhythmBeat['contrastWithPrev'] = 'same';
    if (prev) {
      const prevDark = prev.background === 'inverted' || prev.background === 'media';
      const curDark = background === 'inverted' || background === 'media';
      if (prevDark !== curDark) contrastWithPrev = 'flip';
      else if (INTENSITY_RANK[intensity] > INTENSITY_RANK[prev.intensity]) contrastWithPrev = 'step-up';
      else if (INTENSITY_RANK[intensity] < INTENSITY_RANK[prev.intensity]) contrastWithPrev = 'step-down';
    }
    beats.push({ sectionId: s.id, role: beatRole(s, i, last, isSecondDominant), intensity, background, contrastWithPrev });
    if (beats.length >= MAX_SECTIONS) break;
  }
  const seq = beats.slice(0, 8).map((b) => `${b.role}(${b.intensity})`).join(' → ');
  return {
    beats,
    peakSectionId: sections[peakIdx]?.id || sections[0].id,
    summary: clip(`${seq}${beats.length > 8 ? ' → …' : ''}; single visual climax at "${sections[peakIdx]?.id || sections[0].id}", release toward the footer`, MAX_TEXT),
  };
}

export function deriveCompositionContract(input: CompositionInput): CompositionContract | undefined {
  const id = input.identity || ({} as FrontendSpecIdentity);
  const rawSections = (input.sections || []).filter((s) => s && s.id).slice(0, MAX_SECTIONS);
  if (rawSections.length === 0) return undefined;
  const ordered = [...rawSections].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const total = ordered.length;
  const sector = clip(id.sector || input.research?.sector || 'general', 40);
  const isSoftware = SOFTWARE_SECTORS.has(sector);
  const isImageLed = IMAGE_SECTORS.has(sector) || input.imageCoverage?.mode === 'image-led';
  const explicitNoPhoto = input.imageCoverage?.explicitNoPhoto === true;
  const ad = input.artDirection;
  const research = input.research;

  const approvedSlotSet = new Set((input.imageSlots || []).filter((s) => s && s.id).map((s) => s.id));

  // ── 1. Initial per-section family + role. ──
  interface Draft { s: FrontendSpecSection; family: CompositionFamily; functional: boolean; bindingId?: string; media: boolean; reasons: string[]; }
  const drafts: Draft[] = ordered.map((s, i) => {
    const bindingId = bindingInteractiveId(s, input.binding);
    const functional = !!bindingId || (s.interactionHints || []).length > 0;
    const family = classifyFamily(s, i, total, functional);
    return { s, family, functional, bindingId, media: sectionHasMedia(s), reasons: [] };
  });

  // ── 2. Deterministic adjacency resolution — no two adjacent top-level sections share a family. ──
  let consecutiveRepeatResolutions = 0;
  for (let i = 1; i < drafts.length; i += 1) {
    const prev = drafts[i - 1].family;
    if (drafts[i].family !== prev) continue;
    // Catalog/gallery may legitimately sit adjacent to a DIFFERENT-purpose sibling, but two identical
    // top-level families in a row is the template-collapse smell — reassign the LATER one deterministically.
    const nextFam = drafts[i + 1]?.family;
    const alt = ALT_BY_FAMILY[drafts[i].family].find((a) => a !== prev && a !== nextFam)
      || ALT_BY_FAMILY[drafts[i].family].find((a) => a !== prev);
    if (alt && alt !== drafts[i].family) {
      drafts[i].reasons.push(`varied from repeated ${drafts[i].family} → ${alt} (adjacency rhythm)`);
      drafts[i].family = alt;
      consecutiveRepeatResolutions += 1;
    }
  }

  // ── 3. Hierarchy / priority — 1–2 dominant moments, not every section a hero. ──
  const primaryIdx = new Set<number>();
  primaryIdx.add(0);                                             // hero is always dominant
  const firstFunctional = drafts.findIndex((d) => d.functional);
  if (firstFunctional > 0) primaryIdx.add(firstFunctional);     // the requested tool is a dominant moment
  // cap dominant moments at 2
  const primaries = [...primaryIdx].slice(0, 2);
  const dominant = new Set(primaries);

  const sections: SectionCompositionContract[] = drafts.map((d, i) => {
    const fam = d.family;
    const spec = FAMILY_SPEC[fam];
    const isDominant = dominant.has(i);
    const priority: CompositionPriority = isDominant ? 'primary' : (i <= Math.min(total - 1, 4) ? 'secondary' : 'supporting');
    const hierarchyLevel = isDominant ? 1 : priority === 'secondary' ? 2 : 3;
    const media = d.media && !explicitNoPhoto;
    const textMedia: TextMediaRelation = explicitNoPhoto ? 'text-only' : (media ? spec.textMedia : (spec.textMedia === 'media-led' ? 'text-led' : spec.textMedia));
    const mediaRole: MediaRole = !media ? 'none' : (fam === 'immersive-hero' || fam === 'full-bleed-transition' ? 'background' : (spec.textMedia === 'media-led' ? 'anchor' : 'support'));
    const approvedSlotIds = uniq((d.s.assetSlotIds || []).filter((x) => approvedSlotSet.has(x))).slice(0, MAX_SLOT_IDS);
    const density = pickDensity(d.s, fam);
    const interactionEmphasis: SectionCompositionContract['interactionEmphasis'] = d.functional ? (isDominant ? 'primary' : 'secondary') : 'none';
    const whitespace: CompositionWhitespace = density === 'dense' ? 'tight' : isDominant ? 'generous' : 'comfortable';
    const mobileStack: MobileStack = fam === 'catalog-index' || fam === 'gallery-strip' ? 'carousel-accessible'
      : fam === 'comparison-band' ? 'collapse' : 'stack';
    return {
      id: d.s.id, name: clip(d.s.name, 60), purpose: clip(d.s.purpose || d.s.name, 100),
      narrativeRole: clip(d.s.purpose || fam.replace(/-/g, ' '), 80),
      priority, hierarchyLevel, family: fam, alignment: spec.alignment, container: spec.container,
      textMedia, mediaRole, approvedSlotIds,
      visualAnchor: media ? clip((research?.artDirection?.imageSubjects || [])[0] || 'sector-relevant imagery', 60) : (density === 'sparse' ? 'headline typography' : 'primary content'),
      density, interactionEmphasis, ...(d.bindingId ? { bindingRequirementId: d.bindingId } : {}),
      surface: spec.surface, whitespace,
      desktopOrder: i, mobileOrder: i, mobileStack,
      allowedPrimitives: spec.primitives.slice(0, MAX_LIST),
      forbidImmediateRepeat: true,
      reasons: d.reasons.slice(0, 3),
    };
  });

  // ── 4. Hero contract. ──
  const heroMedia = sections[0]?.mediaRole !== 'none' && !explicitNoPhoto;
  const heroVisualAnchor: HeroCompositionContract['visualAnchor'] = explicitNoPhoto ? 'typographic'
    : isSoftware && !heroMedia ? 'product-ui'
    : heroMedia ? 'photograph' : 'typographic';
  const hero: HeroCompositionContract = {
    narrativeRole: clip(research?.artDirection?.compositionModel || ad?.heroDirection || 'a decisive, sector-true opening statement', MAX_TEXT),
    textMedia: sections[0]?.textMedia || 'text-led',
    headlineHierarchy: clip(ad?.typographyDirection || 'one dominant headline, clear supporting subhead', 120),
    ctaModel: 'primary+secondary',
    visualAnchor: heroVisualAnchor,
    aboveFoldBudget: 'headline + one supporting line + primary CTA (+ optional trust cue); not every idea above the fold',
    mediaTreatment: clip(research?.artDirection?.imageRole || 'a real, relevant hero visual with legible text contrast', 120),
    trustPlacement: clip((research?.artDirection?.trustPresentation) || 'one honest proof cue near the CTA', 100),
    interactionPresent: sections[0]?.interactionEmphasis === 'primary',
    desktopOrder: 'headline → media/anchor → CTA',
    mobileOrder: 'headline → CTA → media (preserve reading order)',
    minBreathingRoom: 'generous vertical rhythm; no tiny centered text floating in empty space',
    prohibited: uniq([
      'tiny centered text floating in empty space',
      ...(isSoftware ? [] : ['an arbitrary dashboard/product-UI mockup for a non-software business']),
      'hero image hidden behind an unreadable overlay',
      'more than two competing CTAs',
      'decorative/fabricated metrics',
      'the same badge/headline/paragraph/button hero repeated as every section',
    ]).slice(0, MAX_LIST),
  };

  // ── 5. Responsive contract (desktop + mobile designed together, semantic order preserved). ──
  const responsive: ResponsiveContract = {
    preserveDomOrder: true,
    noHorizontalOverflow: true,
    minTouchTargetPx: 44,
    sections: sections.map((s) => ({ id: s.id, desktopOrder: s.desktopOrder, mobileOrder: s.mobileOrder, mobileStack: s.mobileStack })),
    obligations: [
      'preserve semantic DOM reading/tab order; CSS order must not break accessibility',
      'no horizontal page overflow; card strips need an accessible interaction model',
      'controls stack to full-width on narrow screens (min 44px touch targets)',
      'no fixed heights that clip text; no absolute-positioned essential content without a mobile fallback',
      'images crop without removing the subject; reduced-motion respected',
    ],
  };

  // ── 6. Transitions + diversity + distribution. ──
  const transitions: CompositionTransition[] = [];
  for (let i = 1; i < sections.length; i += 1) {
    const a = sections[i - 1]; const b = sections[i];
    const rel = a.family === b.family ? 'continue' : a.density !== b.density ? 'contrast' : 'build';
    transitions.push({ fromId: a.id, toId: b.id, relationship: rel });
    if (transitions.length >= MAX_SECTIONS) break;
  }
  const familyDistribution: Record<string, number> = {};
  for (const s of sections) familyDistribution[s.family] = (familyDistribution[s.family] || 0) + 1;
  const dominantSectionCount = sections.filter((s) => s.hierarchyLevel === 1).length;

  const diversityConstraints = [
    `no more than ${1} adjacent top-level sections may share a composition family`,
    'alignment and container width must vary across the page — not one uniform column throughout',
    'maintain one or two dominant moments; supporting sections must not all read as equal heroes',
    'a repeated card grid may exist INSIDE one catalog/index section, never as the top-level composition of many unrelated sections',
    ...(isImageLed ? ['imagery-led sections must carry real, relevant media, not decorative filler'] : []),
  ].slice(0, MAX_LIST);

  const upstream = uniq([
    input.sections?.length ? 'architectureSections' : '',
    input.blueprint ? 'pageBlueprint' : '',
    ad ? 'artDirection' : '',
    research ? 'researchDirection' : '',
    input.binding ? 'bindingRequirements' : '',
    input.imageCoverage ? 'imageCoverage' : '',
    input.ledger ? 'thinkingLedger' : '',
  ].filter(Boolean));

  const reasons: string[] = [];
  if (consecutiveRepeatResolutions > 0) reasons.push(`${consecutiveRepeatResolutions} adjacent repeat(s) deterministically varied`);
  if (explicitNoPhoto) reasons.push('explicit no-photo — composition stays typographic');

  return {
    version: 'composition-v1', status: 'derived',
    compositionThesis: clip(research?.artDirection?.visualThesis || ad?.visualMetaphor || `${clip(id.primaryConcept || id.siteType || sector, 60)}: a distinctive, sector-true page composition`, MAX_TEXT),
    narrativeArc: clip(research?.artDirection?.sectionRhythm || ad?.sectionRhythmDirection || 'open strong → build understanding → prove → convert', MAX_TEXT),
    densityProfile: clip(research?.artDirection?.contentDensity || String(ad?.density || 'balanced'), 40),
    globalRhythm: clip(ad?.sectionRhythmDirection || 'intentional density/whitespace variation across the page', 120),
    maxConsecutiveSimilarSections: 1,
    hero, sections, transitions, pageRhythm: derivePageRhythm(sections), responsive, diversityConstraints,
    dominantSectionCount, familyDistribution, consecutiveRepeatResolutions, reasons,
    upstreamEvidenceUsedToDeriveContract: upstream,
    contractPersistedInSpecification: true,
    contractRenderedToFrontendBuilder: true,
    contractUsedByAcceptance: true,
    agentsActuallyConsumingContract: [],
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * RENDER — one compact BINDING PAGE COMPOSITION block for the builder. Bounded.
 * ──────────────────────────────────────────────────────────────────────────── */
export function renderCompositionBlock(contract: CompositionContract | undefined): string[] {
  if (!contract || !contract.sections.length) return [];
  const h = contract.hero;
  const beatById = new Map((contract.pageRhythm?.beats || []).map((b) => [b.sectionId, b]));
  const secLines = contract.sections.slice(0, MAX_SECTIONS).map((s) => {
    const media = s.mediaRole === 'none' ? 'no-media' : `${s.mediaRole}${s.approvedSlotIds.length ? ` [${s.approvedSlotIds.slice(0, 3).join(',')}]` : ''}`;
    const fn = s.bindingRequirementId ? ` · functional(${s.bindingRequirementId})` : '';
    const b = beatById.get(s.id);
    const beat = b ? ` · beat:${b.role}/${b.intensity}/${b.background}` : '';
    return `- ${s.id} · ${s.family} · ${s.priority}/h${s.hierarchyLevel} · ${s.alignment}/${s.container} · ${s.textMedia} · media:${media} · density:${s.density} · mobile:${s.mobileStack}${beat}${fn}`;
  });
  const out = [
    'BINDING PAGE COMPOSITION:',
    `Composition thesis: ${clip(contract.compositionThesis, MAX_TEXT)}`,
    `Narrative arc: ${clip(contract.narrativeArc, MAX_TEXT)} · rhythm: ${clip(contract.globalRhythm, 100)}`,
    ...(contract.pageRhythm ? [
      `WHOLE-PAGE RHYTHM (deliberate build-up/release, ONE climax — not a flat run of equally-loud sections): ${clip(contract.pageRhythm.summary, MAX_TEXT)}`,
      `  Use contrast between adjacent sections (dense↔quiet, dark↔light, wide↔contained). Only "${contract.pageRhythm.peakSectionId}" is the visual peak; the footer resolves/releases. Do not stack two maximal sections back-to-back.`,
    ] : []),
    'Implement EACH section below with its assigned composition family, priority/hierarchy, alignment,',
    'container width, text↔media relationship, media role and density. Do NOT collapse the page into a',
    'repeated hero→three-cards→grid→testimonials→CTA template. Tag each top-level section root with',
    'data-korvix-section="<section id>". Section obligations (by stable section id):',
    ...secLines,
    `Hero: ${h.visualAnchor} anchor · ${h.textMedia} · ${clip(h.headlineHierarchy, 80)} · CTA ${h.ctaModel} · ${clip(h.aboveFoldBudget, 90)}`,
    `Hero prohibits: ${h.prohibited.slice(0, 5).join('; ')}`,
    `Adjacency/diversity: ${contract.diversityConstraints.slice(0, 4).join('; ')}`,
    `Responsive: desktop+mobile designed together — ${contract.responsive.obligations.slice(0, 4).join('; ')}`,
    'Do NOT: substitute a decorative repeated card grid for a planned composition; delete a required',
    'section; hide required content; bury a required interactive tool inside a static/decorative card.',
    'Build production-quality with the project’s existing stack; keep semantic DOM order for accessibility.',
    '',
  ];
  return out;
}

/* ────────────────────────────────────────────────────────────────────────────
 * ACCEPTANCE — conservative, section/component-scoped. Only a proven TOP-LEVEL
 * template collapse blocks; everything else is manual-review warning. Fail-open.
 * ──────────────────────────────────────────────────────────────────────────── */
export type CompositionIssueCode =
  | 'composition-template-collapse'
  | 'composition-hero-weak'
  | 'composition-low-diversity'
  | 'composition-visual-weight-flat'
  | 'composition-responsive-risk'
  | 'composition-media-role-unrendered';

export interface CompositionIssue {
  code: CompositionIssueCode;
  severity: FrontendBuilderReviewSeverity;
  label: string;
  files: string[];
  evidence: string;
  repairInstruction: string;
}
export interface CompositionAcceptanceResult {
  status: 'pass' | 'warning' | 'fail';
  legacy: boolean;
  analyzedSectionCount: number;
  distinctFamilySignatureCount: number;
  templateCollapse: boolean;
  issues: CompositionIssue[];
}
const LEGACY_COMPOSITION: CompositionAcceptanceResult = {
  status: 'pass', legacy: true, analyzedSectionCount: 0, distinctFamilySignatureCount: 0, templateCollapse: false, issues: [],
};

function capEv(s: string): string { const t = (s || '').replace(/\s+/g, ' ').trim(); return t.length > MAX_EVIDENCE ? t.slice(0, MAX_EVIDENCE) : t; }

/** A coarse top-level composition signature for one section's rendered source. */
function compositionSignature(content: string): string {
  const grid3 = /(?:sm:|md:|lg:|xl:)?grid-cols-3\b/i.test(content);
  const grid4 = /(?:sm:|md:|lg:|xl:)?grid-cols-[45]\b/i.test(content);
  const grid2 = /(?:sm:|md:|lg:|xl:)?grid-cols-2\b/i.test(content);
  const cards = (content.match(/rounded-(?:lg|xl|2xl|3xl)[^"'`]{0,80}(?:shadow|border)/gi) || []).length;
  const media = /<img\b|<picture\b|background-image|data-korvix-image-slot/i.test(content);
  const centered = /text-center/i.test(content) && /mx-auto/i.test(content);
  if (grid3 && cards >= 3) return 'grid3-cards';
  if (grid4 && cards >= 3) return 'gridN-cards';
  if (grid2 && media) return 'media-split';
  if (grid2 && cards >= 2) return 'grid2-cards';
  if (media && !grid2 && !grid3) return 'media-led';
  if (centered && cards < 2 && !media) return 'centered-copy';
  return 'other';
}

export function analyzeComposition(
  files: FrontendGeneratedFile[] | undefined,
  contract: CompositionContract | undefined,
): CompositionAcceptanceResult {
  try {
    if (!contract || contract.status !== 'derived') return LEGACY_COMPOSITION;
    const list = Array.isArray(files) ? files : [];
    if (!list.length) return { ...LEGACY_COMPOSITION, legacy: false };
    const units = collectSectionUnits(list, contract.sections.map((s) => s.id));
    const issues: CompositionIssue[] = [];
    const push = (i: CompositionIssue) => { if (issues.length < MAX_ISSUES) issues.push(i); };
    if (units.length < 2) {
      // Too few correlated sections to judge composition — never block.
      return { ...LEGACY_COMPOSITION, legacy: false, analyzedSectionCount: units.length };
    }

    const sigs = units.map((u) => ({ id: u.id, path: u.path, sig: compositionSignature(u.content) }));
    const distinctSignatures = uniq(sigs.map((s) => s.sig).filter((s) => s !== 'other'));

    // ── 1. TOP-LEVEL TEMPLATE COLLAPSE (the only hard blocker). Repeated card-grid signature across
    //    MANY DISTINCT top-level sections (never internal catalog repetition, which is one unit). ──
    const gridSigs = ['grid3-cards', 'grid2-cards', 'gridN-cards'];
    let collapse = false; let collapseSig = ''; let collapseIds: string[] = []; let collapseFiles: string[] = [];
    for (const g of gridSigs) {
      const same = sigs.filter((s) => s.sig === g);
      if (same.length >= COLLAPSE_MIN && same.length >= Math.ceil(units.length / 2)) {
        collapse = true; collapseSig = g; collapseIds = uniq(same.map((s) => s.id)); collapseFiles = uniq(same.map((s) => s.path)); break;
      }
    }
    // Consecutive-identical (by contract order) also proves collapse — even within one page file.
    if (!collapse) {
      let run = 1;
      for (let i = 1; i < sigs.length; i += 1) {
        if (sigs[i].sig !== 'other' && sigs[i].sig === sigs[i - 1].sig) {
          run += 1;
          if (run >= CONSECUTIVE_COLLAPSE && gridSigs.includes(sigs[i].sig)) {
            const slice = sigs.slice(i - run + 1, i + 1);
            collapse = true; collapseSig = sigs[i].sig; collapseIds = uniq(slice.map((s) => s.id)); collapseFiles = uniq(slice.map((s) => s.path)); break;
          }
        } else run = 1;
      }
    }
    if (collapse) {
      // Truthful evidence: distinct top-level SECTION IDs are the unit of collapse; the offending
      // sections may share one page file OR span several — never imply distinct paths are required.
      const where = collapseFiles.length === 1 ? ` (all within ${collapseFiles[0]})` : ` (across ${collapseFiles.length} files)`;
      push({ code: 'composition-template-collapse', severity: 'major', label: collapseSig, files: collapseFiles.slice(0, MAX_ISSUE_FILES),
        evidence: capEv(`the page collapsed into a repeated top-level "${collapseSig}" composition across ${collapseIds.length} distinct sections (${collapseIds.slice(0, 6).join(', ')})${where} — the binding composition contract assigned varied families`),
        repairInstruction: capEv('Give each top-level section its assigned composition family (varied alignment/container/text-media/density). A repeated card grid may live INSIDE one catalog section, never as the composition of many unrelated sections.') });
    }

    // ── 2. Visual-weight flatness / low diversity → manual-review warning. ──
    if (!collapse && units.length >= 4 && distinctSignatures.length <= 1) {
      push({ code: 'composition-low-diversity', severity: 'minor', label: 'uniform composition', files: [],
        evidence: capEv(`all ${units.length} correlated sections share one composition signature — little visual-weight hierarchy vs the researched decision journey`),
        repairInstruction: capEv('Vary section rhythm/alignment/density per the composition contract; maintain one or two dominant moments instead of equal-weight sections.') });
    }

    // ── 3. Hero weakness → warning. The hero is specifically the FIRST contract section, correlated
    //    to its own region. If that section did not correlate, skip hero analysis rather than
    //    mislabeling an unrelated later component as the hero. ──
    const heroSectionId = contract.sections[0]?.id;
    const heroUnit = heroSectionId ? units.find((u) => u.id === heroSectionId) : undefined;
    if (heroUnit) {
      const heroSig = compositionSignature(heroUnit.content);
      const hasH1 = /<h1\b/i.test(heroUnit.content) || /text-(?:4|5|6|7)xl/i.test(heroUnit.content);
      if (!hasH1 || gridSigs.includes(heroSig)) {
        push({ code: 'composition-hero-weak', severity: 'minor', label: 'weak hero hierarchy', files: [heroUnit.path],
          evidence: capEv(`the opening section lacks a clear dominant hero hierarchy (no prominent h1/display heading${gridSigs.includes(heroSig) ? ' and reads as a card grid' : ''})`),
          repairInstruction: capEv('Give the hero a single dominant headline + supporting line + primary CTA with generous breathing room; do not open with a uniform card grid.') });
      }
    }

    // ── 4. Responsive risks (dangerous fixed-height clip / absolute essential content) → warning. ──
    const src = units.map((u) => u.content).join('\n');
    const fixedHeightClip = /\bh-\[\d{3,}px\]/.test(src) && /overflow-hidden/.test(src);
    const absoluteHeavy = (src.match(/\babsolute\b/gi) || []).length >= 8 && !/relative/.test(src);
    const overflowStrip = /overflow-x-auto/.test(src) && /\bflex\b/.test(src) && !/aria-|role=|button|snap-/.test(src);
    if (fixedHeightClip || absoluteHeavy || overflowStrip) {
      push({ code: 'composition-responsive-risk', severity: 'minor', label: 'responsive risk', files: [],
        evidence: capEv(`potential responsive risk (${[fixedHeightClip ? 'fixed-height clipping' : '', absoluteHeavy ? 'heavy absolute positioning' : '', overflowStrip ? 'inaccessible horizontal strip' : ''].filter(Boolean).join(', ')}) — verify mobile does not hide/clip essential content`),
        repairInstruction: capEv('Avoid fixed heights that clip text and absolute-positioned essential content without a mobile fallback; give horizontal strips an accessible interaction model.') });
    }

    // ── 5. Required media role not rendered (defer hard image blocking to PR #559) → warning. ──
    for (const sc of contract.sections) {
      if (sc.mediaRole === 'anchor' && sc.approvedSlotIds.length) {
        const u = units.find((x) => x.id === sc.id);
        if (u && !/<img\b|<picture\b|background-image|data-korvix-image-slot/i.test(u.content)) {
          push({ code: 'composition-media-role-unrendered', severity: 'minor', label: sc.id, files: [u.path],
            evidence: capEv(`section "${sc.id}" was assigned a media anchor (approved slot) but renders no image/picture/background — the visual anchor is missing`),
            repairInstruction: capEv(`Render the approved image as the visual anchor of "${sc.id}" (see the image-coverage contract); do not leave the assigned slot unused.`) });
          break;
        }
      }
    }

    const blocking = issues.some((i) => i.code === 'composition-template-collapse' && i.severity !== 'minor');
    const warned = issues.some((i) => i.severity === 'minor');
    const status: CompositionAcceptanceResult['status'] = blocking ? 'fail' : warned ? 'warning' : 'pass';
    return { status, legacy: false, analyzedSectionCount: units.length, distinctFamilySignatureCount: distinctSignatures.length, templateCollapse: collapse, issues: issues.slice(0, MAX_ISSUES) };
  } catch {
    return { ...LEGACY_COMPOSITION, legacy: false };
  }
}

export function hasBlockingCompositionFindings(result: CompositionAcceptanceResult | undefined): boolean {
  return !!result && result.status === 'fail';
}

const COMPOSITION_CATEGORY: Record<CompositionIssueCode, FrontendBuilderReviewCategory> = {
  'composition-template-collapse': 'generic-template',
  'composition-hero-weak': 'visual-hierarchy',
  'composition-low-diversity': 'layout-rhythm',
  'composition-visual-weight-flat': 'visual-hierarchy',
  'composition-responsive-risk': 'responsive-intent',
  'composition-media-role-unrendered': 'component-composition',
};

export function compositionToReviewIssues(result: CompositionAcceptanceResult | undefined): FrontendBuilderReviewIssue[] {
  if (!result || !result.issues.length) return [];
  const out: FrontendBuilderReviewIssue[] = [];
  let i = 0;
  for (const issue of result.issues) {
    if (issue.severity === 'minor') continue;   // advisory/manual-review — not a repair blocker
    out.push({
      id: `composition-${issue.code}-${i += 1}`,
      severity: issue.severity,
      category: COMPOSITION_CATEGORY[issue.code],
      files: (issue.files || []).slice(0, MAX_ISSUE_FILES),
      evidence: capEv(issue.evidence),
      repairInstruction: capEv(issue.repairInstruction),
    });
    if (out.length >= MAX_ISSUES) break;
  }
  return out;
}

export function compositionIssueCodes(result: CompositionAcceptanceResult | undefined): string[] {
  if (!result) return [];
  return uniq(result.issues.map((i) => i.code)).slice(0, 12);
}

/* ── Owner diagnostics (bounded, no secrets / source / URLs). ── */
export interface CompositionDiagnostics {
  compositionVersion: string;
  compositionStatus: 'derived' | 'legacy';
  compositionThesis: string;
  plannedSectionCount: number;
  familyDistribution: Record<string, number>;
  dominantSectionCount: number;
  consecutiveRepeatResolutions: number;
  heroVisualAnchor: string;
  functionalSectionCount: number;
  mediaRoleCount: number;
  responsiveSectionCount: number;
  maxConsecutiveSimilarSections: number;
  pageRhythmBeatCount: number;
  pageRhythmPeakSectionId: string;
  compositionCharCount: number;
  upstreamEvidenceUsedToDeriveContract: string[];
  contractPersistedInSpecification: boolean;
  contractRenderedToFrontendBuilder: boolean;
  contractUsedByAcceptance: boolean;
  agentsActuallyConsumingContract: string[];
  compositionAcceptanceStatus?: 'pass' | 'warning' | 'fail';
  compositionIssueCodes?: string[];
}

export function buildCompositionDiagnostics(
  contract: CompositionContract | undefined,
  acceptance: CompositionAcceptanceResult | undefined,
  compositionCharCount: number,
): CompositionDiagnostics | undefined {
  if (!contract) return undefined;
  return {
    compositionVersion: contract.version,
    compositionStatus: contract.status,
    compositionThesis: clip(contract.compositionThesis, 80),
    plannedSectionCount: contract.sections.length,
    familyDistribution: contract.familyDistribution,
    dominantSectionCount: contract.dominantSectionCount,
    consecutiveRepeatResolutions: contract.consecutiveRepeatResolutions,
    heroVisualAnchor: contract.hero.visualAnchor,
    functionalSectionCount: contract.sections.filter((s) => s.interactionEmphasis !== 'none').length,
    mediaRoleCount: contract.sections.filter((s) => s.mediaRole !== 'none').length,
    responsiveSectionCount: contract.responsive.sections.length,
    maxConsecutiveSimilarSections: contract.maxConsecutiveSimilarSections,
    pageRhythmBeatCount: contract.pageRhythm?.beats.length ?? 0,
    pageRhythmPeakSectionId: contract.pageRhythm?.peakSectionId ?? '',
    compositionCharCount,
    upstreamEvidenceUsedToDeriveContract: contract.upstreamEvidenceUsedToDeriveContract.slice(0, 8),
    contractPersistedInSpecification: contract.contractPersistedInSpecification,
    contractRenderedToFrontendBuilder: contract.contractRenderedToFrontendBuilder,
    contractUsedByAcceptance: contract.contractUsedByAcceptance,
    agentsActuallyConsumingContract: contract.agentsActuallyConsumingContract.slice(0, 8),
    compositionAcceptanceStatus: acceptance && !acceptance.legacy ? acceptance.status : undefined,
    compositionIssueCodes: acceptance ? compositionIssueCodes(acceptance) : undefined,
  };
}
