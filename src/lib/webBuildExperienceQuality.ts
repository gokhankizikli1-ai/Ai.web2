/**
 * Web Build — INTEGRATED EXPERIENCE QUALITY (Phases 1–6): cross-system experience coherence,
 * responsive layout & content-fit, interaction depth & state feedback, accessibility & keyboard
 * usability, performance & media delivery — unified into ONE authoritative, additive, deterministic,
 * JSON-safe integration contract with clearly-owned sub-policies and ONE analysis surface.
 *
 * The merged systems each guarantee one dimension independently: #558 functionality/controls/state,
 * #559 semantic imagery, #560 research/claims/drift, #561 composition/section families, #562
 * typography/surfaces/visual system, #563 conversion narrative/voice/specificity/proof. A site can
 * satisfy every one of them and still be a POOR EXPERIENCE — incoherent across systems, desktop-only,
 * shallow in interaction feedback, inaccessible, or heavy at runtime. This contract connects those
 * authoritative decisions into implementable PER-SECTION presentation obligations and verifies them
 * with conservative, section-scoped, fail-open acceptance. It never recreates or duplicates the
 * findings owned by #558–#563; it consumes their decisions and blocks only proven cross-cutting
 * defects those systems do not own. Deterministic (no Math.random/time/ids); network-free; additive.
 */
import type {
  FrontendGeneratedFile, FrontendBuilderReviewIssue, FrontendBuilderReviewSeverity, FrontendBuilderReviewCategory,
  FrontendSpecIdentity, FrontendSpecSection, FrontendBindingRequirements, BindingRequirement, FrontendSpecImageSlot,
} from '@/lib/webBuildAgents';
import type { CompositionContract } from '@/lib/webBuildComposition';
import type { ContentNarrativeContract } from '@/lib/webBuildContentNarrative';
import type { VisualSystemContract } from '@/lib/webBuildVisualSystem';
import type { ImageCoverageRequirement } from '@/lib/webBuildImageCoverage';
import { collectSectionUnits, normId } from '@/lib/webBuildSectionSource';
import { isNavigationText } from '@/lib/webBuildInteraction';

/* ── Bounds (named, mandatory) ─────────────────────────────────────────────── */
const MAX_TEXT = 140;
const MAX_LIST = 8;
const MAX_SECTIONS = 24;
const MAX_OBLIGATIONS = 8;
const MAX_EVIDENCE = 180;
const MAX_ISSUES = 32;
const MAX_ISSUE_FILES = 4;
const MAX_SCAN = 120_000;
const RENDER_CHAR_CEILING = 3200;   // documented hard ceiling for the rendered builder block
const COLLAPSE_MIN = 4;             // ≥ this many sections sharing a proven defect → systemic blocker
const MIN_WORDS = 6;

/* ── Public contract types (persisted, all additive/optional for old builds) ── */
export type ContentLayoutFit = 'fit' | 'tight' | 'ambiguous';
export type ExperienceFocal = 'headline' | 'media' | 'items' | 'controls' | 'proof' | 'cta' | 'content';
export type MediaPriority = 'hero' | 'below-fold' | 'decorative' | 'none';
export type InteractionKind = 'none' | 'navigation' | 'tool' | 'form' | 'disclosure' | 'gallery';

/** Per-section, cross-system presentation obligations. Sub-policy fields are populated by the
 *  phase that owns them; all are bounded and JSON-safe. */
export interface ExperienceSectionObligation {
  id: string;
  narrativeRole: string;
  family: string;
  density: string;
  mediaRole: string;
  ctaRole: string;
  /* Phase 1 — coherence */
  focal: ExperienceFocal;
  hierarchyRelation: string;
  mediaCopyRelation: string;
  contentLayoutFit: ContentLayoutFit;
  desktopFlow: string;
  mobileFlow: string;
  adjacency: string;
  transitionRole: string;
  allowedFallback: string;
  coherenceObligations: string[];
  /* Phase 2 — responsive */
  responsive?: {
    stackOrder: string;
    criticalAdjacency: string;
    overflowPolicy: string;
    mediaAspectRole: string;
    overlayReadability: string;
    ctaPreserved: boolean;
    controlPreserved: boolean;
    obligations: string[];
  };
  /* Phase 3 — interaction (required* fields materially consumed from #558 binding requirements). */
  interaction?: {
    kind: InteractionKind;
    required: boolean;                 // #558: an authoritative interactive/dynamic-outcome requirement maps here
    /** Phase 3 (module-derived) — the MODULE itself semantically requires frontend interaction (mobile/
     *  hamburger nav, accordion/FAQ, tabs, gallery/carousel, filter/sort, modal/lightbox, frontend-only
     *  form), independent of any explicit binding requirement. When true, acceptance enforces the
     *  dead-control lifecycle (control→handler→state→visible consumption→feedback) for a control that IS
     *  present — but never forces controls onto a genuinely static section. */
    semanticInteraction: boolean;
    requiredControls: string[];        // #558: BindingControl labels the section must render
    requiredOutcome: string;           // #558: the visible outcome that must change (empty if none)
    frontendOnly: boolean;             // #558: frontend-only vs backend-required
    requiredStates: string[];
    outputRelationship: string;
    obligations: string[];
  };
  /* Phase 4 — accessibility */
  accessibility?: {
    landmark: string;
    obligations: string[];
  };
  /* Phase 5 — performance (mediaRequired/heroRequired materially consumed from #559 image coverage). */
  performance?: {
    mediaPriority: MediaPriority;
    mediaRequired: boolean;            // #559: an image-coverage target correlates to this section
    heroRequired: boolean;             // #559: this section is the required hero/LCP media
    motionPolicy: string;
    obligations: string[];
  };
  ambiguityNote: string;
}

export interface ExperienceQualityContract {
  version: 'experience-quality-v1';
  status: 'derived' | 'legacy';
  /** which sub-policies were derived (phase presence). */
  subPolicies: string[];
  /** truthful trace of which upstream decisions MATERIALLY changed a derived obligation. */
  materiallyConsumed: string[];
  rhythmObligation: string;
  globalResponsive: string[];
  globalAccessibility: string[];
  globalPerformance: string[];
  sections: ExperienceSectionObligation[];
  reasons: string[];
  derivationBasis: string[];
  contractPersistedInSpecification: boolean;
  contractRenderedToFrontendBuilder: boolean;
  contractUsedByAcceptance: boolean;
  agentsActuallyConsumingContract: string[];
}

/* ── Small pure helpers ────────────────────────────────────────────────────── */
function clip(s: unknown, n = MAX_TEXT): string { return (typeof s === 'string' ? s : '').replace(/\s+/g, ' ').trim().slice(0, n); }
function uniq<T>(a: T[]): T[] { return [...new Set(a)]; }
function lc(s: unknown): string { return (typeof s === 'string' ? s : '').toLowerCase(); }

const MINIMAL_FAMILIES = new Set(['immersive-hero', 'full-bleed-transition', 'compact-utility', 'conversion-finale']);

/* ────────────────────────────────────────────────────────────────────────────
 * DERIVATION — connect the authoritative contracts into per-section obligations.
 * ──────────────────────────────────────────────────────────────────────────── */
export interface ExperienceQualityInput {
  identity: FrontendSpecIdentity;
  sections?: FrontendSpecSection[];
  composition?: CompositionContract;
  contentNarrative?: ContentNarrativeContract;
  visualSystem?: VisualSystemContract;
  imageCoverage?: ImageCoverageRequirement;
  imageSlots?: FrontendSpecImageSlot[];
  binding?: FrontendBindingRequirements;
}

interface BindingInteraction { required: boolean; controls: string[]; outcome: string; frontendOnly: boolean; }

function sectionText(s: FrontendSpecSection): string {
  return `${(s.interactionHints || []).join(' ')} ${s.purpose || ''} ${s.name || ''} ${s.id}`.toLowerCase();
}

/** #558 material consumption: correlate an authoritative interactive/dynamic-outcome binding requirement
 *  to this section by label/alias, returning its required controls + the outcome that must change. */
function correlateBinding(s: FrontendSpecSection, binding: FrontendBindingRequirements | undefined): BindingInteraction {
  const empty: BindingInteraction = { required: false, controls: [], outcome: '', frontendOnly: true };
  const reqs = binding?.requirements;
  if (!Array.isArray(reqs)) return empty;
  const hay = sectionText(s);
  const match = (r: BindingRequirement): boolean => {
    const label = (r.label || '').toLowerCase();
    const first = label.split(/\s+/)[0] || '';
    return (!!first && hay.includes(first)) || (r.aliases || []).some((a) => a && hay.includes(a.toLowerCase()));
  };
  const req = reqs.find((r) => r.required && (r.kind === 'interactive-experience' || r.kind === 'dynamic-outcome') && match(r));
  if (!req) return empty;
  return {
    required: true,
    controls: uniq((req.controls || []).map((c) => clip(c.label, 40)).filter(Boolean)).slice(0, MAX_LIST),
    outcome: clip(req.dynamicOutcome || '', 80),
    frontendOnly: req.frontendOnly !== false,
  };
}

function deriveInteraction(s: FrontendSpecSection, family: string, req: BindingInteraction): ExperienceSectionObligation['interaction'] {
  const hay = sectionText(s);
  let kind: InteractionKind = 'none';
  // A MODULE can semantically REQUIRE frontend interaction on its own (independent of an explicit binding
  // requirement): a mobile/hamburger nav, an accordion/FAQ, category/menu tabs, a gallery/carousel, a
  // filter/sort surface, a modal/lightbox, or a frontend-only form. Those explicit patterns set
  // `semantic`; a weak fallback (bare interactionHints) does NOT — so we never force a static section
  // to be interactive on a guess.
  let semantic = false;
  // A binding-required interactive experience is authoritatively a tool/form; otherwise infer conservatively.
  if (req.required) kind = /\bform\b|contact|newsletter|subscribe|sign ?up|booking|enquir|register/.test(hay) ? 'form' : 'tool';
  else if (family === 'focused-tool' || /finder|calculat|configurat|quiz|estimat|planner|builder|\btool\b|selector/.test(hay)) { kind = 'tool'; semantic = true; }
  else if (/\bform\b|contact|newsletter|subscribe|sign ?up|booking|enquir|\bquote\b|register/.test(hay)) { kind = 'form'; semantic = true; }
  else if (/\btab\b|\btabs\b|accordion|\bfaq\b|toggle|expand|disclosure|collaps|modal|dialog/.test(hay)) { kind = 'disclosure'; semantic = true; }
  else if (/filter|sort|carousel|slider|gallery|lightbox|\bslide\b/.test(hay)) { kind = 'gallery'; semantic = true; }
  // Navigation is decided by the CANONICAL classifier — a content menu (coffee/food/service menu,
  // menu categories) must NOT be read as site navigation just because it contains the word "menu".
  else if (isNavigationText(hay)) { kind = 'navigation'; semantic = true; }
  else if ((s.interactionHints || []).length > 0) kind = 'tool';   // weak fallback — NOT treated as semantic
  if (kind === 'none' && !req.required) return undefined;
  if (kind === 'none') kind = 'tool';
  const states: Record<InteractionKind, string[]> = {
    none: [],
    tool: ['default/empty state', 'selection state', 'a derived result that changes with input', 'a reset/change path'],
    form: ['default state', 'visible submit feedback (frontend-only)', 'a clear success or error message', 'disabled/invalid handling'],
    disclosure: ['expanded/collapsed state', 'a visible active/selected state', 'keyboard toggle'],
    gallery: ['selected/active item state', 'clear prev/next affordance', 'an empty/no-results state'],
    navigation: ['expanded/collapsed state', 'an operable close control', 'keyboard operation', 'responsive visibility'],
  };
  const output = req.outcome ? clip(`the required outcome (${req.outcome}) updates from the controls`, 90)
    : kind === 'tool' ? 'the output sits with its controls and updates from them'
    : kind === 'form' ? 'submission feedback appears at the form (no fabricated network/booking/payment)'
    : 'the state change is visible in place';
  return {
    kind,
    required: req.required,
    semanticInteraction: semantic,
    requiredControls: req.controls,
    requiredOutcome: req.outcome,
    frontendOnly: req.frontendOnly,
    requiredStates: states[kind].slice(0, MAX_OBLIGATIONS),
    outputRelationship: output,
    obligations: uniq([
      ...(req.controls.length ? [`render the required controls (${req.controls.slice(0, 4).join(', ')}) as real, keyboard-operable inputs`] : ['controls are discoverable and keyboard-operable']),
      'every state change produces visible feedback',
      output,
      ...(kind === 'tool' || kind === 'gallery' ? ['handle the empty/no-selection state gracefully'] : []),
    ]).slice(0, MAX_OBLIGATIONS),
  };
}

/** #559 material consumption: does an image-coverage target require media in this section, and is it the
 *  hero/LCP media? Correlate by sectionId (preferred) or the hero flag. */
function correlateMedia(s: FrontendSpecSection, isFirst: boolean, coverage: ImageCoverageRequirement | undefined): { mediaRequired: boolean; heroRequired: boolean } {
  const targets = coverage?.targets;
  if (!Array.isArray(targets)) return { mediaRequired: false, heroRequired: false };
  const sid = normId(s.id);
  const own = targets.filter((t) => t.required && (t.sectionId ? normId(t.sectionId) === sid : false));
  const heroTarget = targets.find((t) => t.required && t.hero);
  const heroRequired = !!(coverage?.heroRequired && isFirst) || own.some((t) => t.hero) || (!!heroTarget && isFirst && own.length === 0 && !targets.some((t) => t.sectionId));
  return { mediaRequired: own.length > 0 || heroRequired, heroRequired };
}

function focalFor(role: string, family: string, mediaRole: string, ctaRole: string): ExperienceFocal {
  if (/provide-proof|reassure/.test(role)) return 'proof';
  if (/convert/.test(role) || ctaRole === 'primary') return 'cta';
  if (/enable-decision/.test(role) || family === 'catalog-index' || family === 'gallery-strip') return 'items';
  if (/demonstrate|explain-process/.test(role) || family === 'focused-tool') return 'controls';
  if (mediaRole === 'anchor' || family === 'immersive-hero') return 'media';
  if (/orient/.test(role)) return 'headline';
  return 'content';
}

export function deriveExperienceQualityContract(input: ExperienceQualityInput): ExperienceQualityContract | undefined {
  const comp = input.composition;
  const content = input.contentNarrative;
  const raw = (input.sections || []).filter((s) => s && s.id).slice(0, MAX_SECTIONS);
  if (!comp && !content && raw.length === 0) return undefined;
  const ordered = [...raw].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const compById = new Map((comp?.sections || []).map((s) => [s.id, s]));
  const contentById = new Map((content?.sections || []).map((s) => [s.id, s]));
  const slotSet = new Set((input.imageSlots || []).filter((s) => s && s.id).map((s) => s.id));

  const sections: ExperienceSectionObligation[] = ordered.map((s, i) => {
    const cs = compById.get(s.id);
    const cn = contentById.get(s.id);
    const family = cs?.family || 'standard-stack';
    const density = cs?.density || lc(s.density) || 'balanced';
    const mediaRole = cs?.mediaRole || ((s.assetSlotIds || []).some((x) => slotSet.has(x)) ? 'support' : 'none');
    const narrativeRole = cn?.narrativeRole || cs?.narrativeRole || 'establish-value';
    const ctaRole = cn?.ctaRole || 'none';
    const focal = focalFor(narrativeRole, family, mediaRole, ctaRole);
    // #558 (binding) + #559 (image coverage) materially consumed per section.
    const req = correlateBinding(s, input.binding);
    const media = correlateMedia(s, i === 0, input.imageCoverage);
    // Content-layout fit: rich/dense planned copy forced into a minimal composition is "tight".
    const wantsRichCopy = /rich|dense/.test(density) || /provide-proof|explain-process|compare|establish-value/.test(narrativeRole);
    const contentLayoutFit: ContentLayoutFit = wantsRichCopy && MINIMAL_FAMILIES.has(family) ? 'tight' : 'fit';
    const isDominant = cs?.hierarchyLevel === 1 || i === 0;
    return {
      id: s.id, narrativeRole, family, density, mediaRole, ctaRole,
      focal,
      hierarchyRelation: isDominant ? 'dominant moment' : 'supporting',
      mediaCopyRelation: clip(cs?.textMedia || (mediaRole === 'none' ? 'text-only' : 'balanced'), 40),
      contentLayoutFit,
      desktopFlow: clip(`${focal} leads → supporting content → ${ctaRole !== 'none' ? 'CTA' : 'transition'}`, 80),
      mobileFlow: clip(`${focal === 'media' ? 'headline → media → CTA' : `${focal} → supporting → ${ctaRole !== 'none' ? 'CTA' : 'next'}`} (preserve reading order)`, 90),
      adjacency: i === 0 ? 'opens the page' : `follows “${clip(ordered[i - 1].name || ordered[i - 1].id, 30)}”; vary weight from it`,
      transitionRole: isDominant ? 'anchor beat' : 'build/contrast beat',
      allowedFallback: mediaRole === 'anchor' ? 'typographic focal if media missing' : 'tighten copy, keep the focal',
      coherenceObligations: uniq([
        `make ${focal} the clear focal element of this section`,
        ...(contentLayoutFit === 'tight' ? ['give this dense/proof content real room — do not cram it into a minimal centered block'] : []),
        ...(focal === 'proof' ? ['proof must read stronger than any decorative element here'] : []),
        ...(ctaRole === 'primary' ? ['the primary CTA must carry the strongest interactive emphasis in this section'] : []),
        ...(mediaRole === 'anchor' ? ['imagery serves this section’s message, not generic decoration'] : []),
      ]).slice(0, MAX_OBLIGATIONS),
      // Phase 2 — responsive obligations, derived from the same authoritative signals.
      responsive: {
        stackOrder: clip(focal === 'media' ? 'headline → media → CTA' : `${focal} → supporting → ${ctaRole !== 'none' ? 'CTA' : 'next'}`, 70),
        criticalAdjacency: ctaRole !== 'none' ? 'keep the CTA with its context' : focal === 'controls' ? 'keep controls with their output' : 'keep the heading with its supporting copy',
        overflowPolicy: 'wrap long headings; never clip required copy; card strips scroll accessibly',
        mediaAspectRole: mediaRole === 'none' ? 'n/a' : 'reserve aspect ratio; crop keeps the subject',
        overlayReadability: (mediaRole === 'background' || mediaRole === 'anchor') ? 'text over media keeps a scrim/protected panel at every breakpoint' : 'n/a',
        ctaPreserved: ctaRole !== 'none',
        controlPreserved: req.required || (s.interactionHints || []).length > 0,
        obligations: uniq([
          'multi-column layouts collapse to one readable column on mobile',
          ...(ctaRole === 'primary' ? ['keep the primary CTA visible and reachable (full-width) on mobile'] : []),
          ...(mediaRole !== 'none' ? ['reserve media aspect ratio to prevent layout shift'] : []),
          ...(contentLayoutFit === 'tight' ? ['let dense content wrap; do not clip it in a fixed-height box'] : []),
        ]).slice(0, MAX_OBLIGATIONS),
      },
      // Phase 3 — interaction lifecycle, with #558 binding requirements materially consumed (required
      // controls + the outcome that must change); never fabricate backend where frontend-only is asked.
      interaction: deriveInteraction(s, family, req),
      // Phase 4 — accessibility obligations (context-aware; native semantics preferred over ARIA).
      accessibility: {
        landmark: i === 0 ? 'page header / hero region' : /footer|contact/.test(lc(s.purpose || s.name)) ? 'contentinfo/footer' : 'labelled section with a heading',
        obligations: uniq([
          'give this section a real heading in correct order',
          ...(req.required || (s.interactionHints || []).length > 0 ? ['controls are real <button>/<a>/inputs, keyboard-operable, with a visible focus ring'] : []),
          ...(mediaRole !== 'none' ? ['images carry meaningful alt or are marked decorative (alt="")'] : []),
          ...(ctaRole !== 'none' ? ['the CTA is a real link/button with a clear accessible name'] : []),
        ]).slice(0, MAX_OBLIGATIONS),
      },
      // Phase 5 — performance / media delivery, with #559 image-coverage materially consumed
      // (mediaRequired/heroRequired correlate the eager/lazy obligations to the real hero/required media).
      performance: {
        mediaPriority: (media.heroRequired || (i === 0 && (media.mediaRequired || mediaRole !== 'none'))) ? 'hero'
          : (family === 'full-bleed-transition' && mediaRole !== 'none') ? 'decorative'
          : (media.mediaRequired || mediaRole !== 'none') ? 'below-fold' : 'none',
        mediaRequired: media.mediaRequired,
        heroRequired: media.heroRequired,
        motionPolicy: 'motion is subtle and respects prefers-reduced-motion; no unbounded continuous animation on content',
        obligations: uniq([
          ...(media.heroRequired || (i === 0 && mediaRole !== 'none') ? ['prioritize the hero/LCP image (eager, fetchpriority high); reserve its aspect ratio'] : []),
          ...(i > 0 && (media.mediaRequired || mediaRole !== 'none') ? ['lazy-load this below-fold image and reserve width/height/aspect to avoid layout shift'] : []),
          'avoid duplicating the same heavy media; avoid large inline base64 payloads',
          'motion respects prefers-reduced-motion; no unbounded continuous animation',
        ]).slice(0, MAX_OBLIGATIONS),
      },
      ambiguityNote: '',
    };
  });

  const dominant = sections.filter((s) => s.hierarchyRelation === 'dominant moment').length;
  const requiredInteractions = sections.filter((s) => s.interaction?.required).length;
  const requiredMedia = sections.filter((s) => s.performance?.mediaRequired).length;
  // #557 identity material consumption: the PRIMARY page-journey/conversion anchor (owned by neither #561
  // per-section families nor #563 copy) shapes the whole-page rhythm thesis that #564 owns. Folded in only
  // when identity actually carries it, so it materially changes the rendered rhythm — not a mere label.
  const idExperience = clip(input.identity?.primaryWebsiteExperience || input.identity?.websiteExperienceModel || '', 60);
  const idIntent = clip(input.identity?.primaryConversionIntent || '', 50);
  const rhythmBase = comp?.globalRhythm || content?.positioningThesis || 'one coherent experience: vary section weight and density, keep 1–2 dominant moments, and make every section point its content, media, hierarchy and CTA the same way';
  const identityAnchor = (idExperience || idIntent)
    ? ` — anchor the whole experience to the primary journey${idExperience ? ` (${idExperience})` : ''}${idIntent ? `, building toward ${idIntent}` : ''}`
    : '';
  const rhythmObligation = clip(`${rhythmBase}${identityAnchor}`, MAX_TEXT);
  // Truthful "materially consumed" trace — an upstream decision is listed ONLY if it changed a derived
  // obligation or an acceptance-relevant field, not merely because its object was present.
  const materiallyConsumed = uniq([
    comp ? 'composition→family/hierarchy/media-role/rhythm' : '',
    content ? 'contentNarrative→narrativeRole/ctaRole/focal' : '',
    identityAnchor ? 'identity→page journey/conversion anchor (rhythm)' : '',
    requiredInteractions ? `binding→${requiredInteractions} required interaction(s): controls+outcome` : '',
    requiredMedia ? `imageCoverage→${requiredMedia} required-media/hero correlation` : '',
    input.visualSystem?.responsiveObligations?.length ? 'visualSystem→responsive+contrast obligations' : '',
  ].filter(Boolean)).slice(0, MAX_LIST);
  return {
    version: 'experience-quality-v1', status: 'derived',
    subPolicies: ['coherence', 'responsive', 'interaction', 'accessibility', 'performance'],
    materiallyConsumed,
    rhythmObligation,
    globalResponsive: uniq([
      'every multi-column layout collapses to one readable column on mobile (base grid-cols-1)',
      'preserve semantic reading/tab order at all breakpoints',
      'no required copy clipped; long headings wrap instead of overflowing',
      'the primary CTA and any required control/output stay visible and reachable on mobile',
      // #562 material consumption — the visual system's own responsive obligations ride here.
      ...(input.visualSystem?.responsiveObligations || []).slice(0, 3).map((o) => clip(o, 90)),
    ]).slice(0, MAX_LIST),
    globalAccessibility: uniq([
      'use semantic landmarks (header/nav/main/footer) and headings in order',
      'interactive elements are real <button>/<a>, keyboard-operable, with a visible focus ring',
      'every form control has an accessible name (label / aria-label)',
      'images carry meaningful alt or are marked decorative; do not label decorative images as content',
      'prefer native semantics over redundant/invalid ARIA',
      // #562 material consumption — the visual system's contrast obligations ride here.
      ...(input.visualSystem?.contrastObligations || []).slice(0, 2).map((o) => clip(o, 90)),
    ]).slice(0, MAX_LIST),
    globalPerformance: [
      'prioritize the hero/LCP image; never lazy-load it',
      'lazy-load below-fold images and reserve width/height/aspect to avoid layout shift',
      'do not duplicate the same heavy media across sections; avoid large inline base64 payloads',
      'motion respects prefers-reduced-motion; avoid unbounded continuous animation on content',
      'keep decorative effects (blur/filters) cheap; deliver responsive image sizes',
    ],
    sections,
    reasons: [`connected ${sections.length} sections; ${requiredInteractions} binding-required interaction(s), ${requiredMedia} required-media section(s), ${dominant} dominant moment(s)`].slice(0, MAX_LIST),
    derivationBasis: uniq([
      comp ? 'composition' : '', content ? 'contentNarrative' : '', input.visualSystem ? 'visualSystem' : '',
      input.imageCoverage ? 'imageCoverage' : '', input.binding ? 'bindingRequirements' : '', input.identity ? 'identity' : '', raw.length ? 'architectureSections' : '',
    ].filter(Boolean)).slice(0, MAX_LIST),
    contractPersistedInSpecification: true,
    contractRenderedToFrontendBuilder: true,
    contractUsedByAcceptance: true,
    agentsActuallyConsumingContract: [],
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * RENDER — one compact BINDING INTEGRATED EXPERIENCE block. Hard-bounded.
 * ──────────────────────────────────────────────────────────────────────────── */
export function renderExperienceQualityBlock(contract: ExperienceQualityContract | undefined): string[] {
  if (!contract || contract.status !== 'derived' || !contract.sections.length) return [];
  const secLines = contract.sections.slice(0, MAX_SECTIONS).map((s) => {
    const parts = [`- ${s.id} · focal:${s.focal} · ${s.hierarchyRelation} · desktop:${clip(s.desktopFlow, 60)} · mobile:${clip(s.mobileFlow, 60)}`];
    if (s.responsive) parts.push(`  responsive: ${s.responsive.obligations.slice(0, 3).join('; ')}`);
    if (s.interaction && s.interaction.kind !== 'none') {
      const req = s.interaction.required
        ? ` [REQUIRED${s.interaction.requiredControls.length ? ` controls:${s.interaction.requiredControls.slice(0, 3).join('/')}` : ''}${s.interaction.requiredOutcome ? ` → ${clip(s.interaction.requiredOutcome, 50)}` : ''}${s.interaction.frontendOnly ? '' : ' (backend)'}]`
        : '';
      parts.push(`  interaction(${s.interaction.kind})${req}: ${s.interaction.obligations.slice(0, 3).join('; ')}`);
    }
    if (s.accessibility) parts.push(`  a11y: ${s.accessibility.obligations.slice(0, 3).join('; ')}`);
    if (s.performance) parts.push(`  media/perf: ${s.performance.obligations.slice(0, 3).join('; ')}`);
    return parts.join('\n');
  });
  const out = [
    'BINDING INTEGRATED EXPERIENCE (coherence + responsive + interaction + a11y + performance):',
    ...(contract.materiallyConsumed.length ? [`Composed from upstream contracts (materially consumed): ${contract.materiallyConsumed.join('; ')}.`] : []),
    `Whole-page rhythm: ${clip(contract.rhythmObligation, MAX_TEXT)}`,
    'Implement each section so its content, media, hierarchy and CTA point the SAME way (the focal',
    'element leads). Keep one coherent experience across the whole page, not isolated sections.',
    ...(contract.globalResponsive.length ? [`Responsive: ${contract.globalResponsive.slice(0, 5).join('; ')}.`] : []),
    ...(contract.globalAccessibility.length ? [`Accessibility: ${contract.globalAccessibility.slice(0, 5).join('; ')}.`] : []),
    ...(contract.globalPerformance.length ? [`Performance/media: ${contract.globalPerformance.slice(0, 5).join('; ')}.`] : []),
    'Per-section experience obligations (by section id):',
    ...secLines,
    '',
  ];
  let total = 0; const bounded: string[] = [];
  for (const line of out) { total += line.length + 1; if (total > RENDER_CHAR_CEILING) break; bounded.push(line); }
  return bounded;
}

/* ────────────────────────────────────────────────────────────────────────────
 * SHARED SECTION-FACTS EXTRACTOR — robust, brace/quote-aware (no fragile <...>).
 * Computed ONCE per section and consumed by every sub-policy analyzer.
 * ──────────────────────────────────────────────────────────────────────────── */
function stripComments(src: string): string {
  try {
    const s = src || ''; const n = s.length; let out = '';
    let state: 'normal' | 'sq' | 'dq' | 'tpl' | 'line' | 'block' = 'normal'; let i = 0;
    while (i < n) {
      const c = s[i]; const c2 = i + 1 < n ? s[i + 1] : '';
      if (state === 'normal') {
        if (c === '/' && c2 === '*') { state = 'block'; i += 2; continue; }
        if (c === '/' && c2 === '/' && s[i - 1] !== ':') { state = 'line'; i += 2; continue; }
        if (c === "'") { state = 'sq'; out += c; i += 1; continue; }
        if (c === '"') { state = 'dq'; out += c; i += 1; continue; }
        if (c === '`') { state = 'tpl'; out += c; i += 1; continue; }
        out += c; i += 1; continue;
      }
      if (state === 'line') { if (c === '\n') { state = 'normal'; out += c; } i += 1; continue; }
      if (state === 'block') { if (c === '*' && c2 === '/') { state = 'normal'; i += 2; } else { if (c === '\n') out += c; i += 1; } continue; }
      out += c;
      if (c === '\\' && i + 1 < n) { out += s[i + 1]; i += 2; continue; }
      if ((state === 'sq' && c === "'") || (state === 'dq' && c === '"') || (state === 'tpl' && c === '`')) state = 'normal';
      i += 1;
    }
    return out;
  } catch { return src || ''; }
}

/** Render-relevant evidence reconstructed from the BRACE-AWARE element scan (opening tags + their raw
 *  attribute text, which carries className/style/value). Shared by every sub-policy so a `>` inside a JSX
 *  expression can never truncate a tag and drop later attributes. Excludes off-DOM strings/comments. */
function renderEvidence(elements: ElementRef[]): string {
  try {
    const out: string[] = [];
    for (const el of elements) { if (!el.tag) continue; out.push(`<${el.tag} ${el.attr}>`); }
    return out.join('\n');
  } catch { return ''; }
}

/** Literal visible JSX text (skips tags/attributes/braced expressions/comments/svg). */
function extractVisibleText(region: string): { text: string; hasDynamic: boolean } {
  const cleaned = stripComments(region || '').replace(/<(svg|script|style)\b[\s\S]*?<\/\1>/gi, ' ');
  const n = cleaned.length; let out = ''; let hasDynamic = false; let i = 0;
  while (i < n) {
    const c = cleaned[i];
    if (c === '<') {
      i += 1; let depth = 0; let q: string | null = null;
      while (i < n) {
        const d = cleaned[i];
        if (q) { if (d === '\\') { i += 2; continue; } if (d === q) q = null; i += 1; continue; }
        if (d === "'" || d === '"' || d === '`') { q = d; i += 1; continue; }
        if (d === '{') { depth += 1; i += 1; continue; }
        if (d === '}') { if (depth > 0) depth -= 1; i += 1; continue; }
        if (d === '>' && depth === 0) { i += 1; break; }
        i += 1;
      }
      out += ' '; continue;
    }
    if (c === '{') {
      hasDynamic = true; i += 1; let depth = 1; let q: string | null = null;
      while (i < n && depth > 0) {
        const d = cleaned[i];
        if (q) { if (d === '\\') { i += 2; continue; } if (d === q) q = null; i += 1; continue; }
        if (d === "'" || d === '"' || d === '`') { q = d; i += 1; continue; }
        if (d === '{') depth += 1; else if (d === '}') depth -= 1;
        i += 1;
      }
      out += ' '; continue;
    }
    out += c; i += 1;
  }
  return { text: out.replace(/\s+/g, ' ').trim(), hasDynamic };
}

/** One rendered element (opening/self-closing tag) with bounded metadata for element-level correlation. */
export interface ElementRef {
  tag: string;            // lowercase tag name ('' for fragments/unknown)
  attr: string;           // raw attribute text of the opening tag
  classes: string;        // static className/class value (empty when dynamic-only)
  classesDynamic: boolean; // className was a {expression} we cannot statically read
  withinLabel: boolean;   // this element is nested inside a <label>…</label>
}

/** Scan from '<' to the matching '>' respecting quotes, template literals, escapes and JSX `{…}` brace
 *  depth — so `>` inside arrow functions/comparisons/strings/nested objects never terminates a tag. */
function skipTag(s: string, from: number): number {
  const n = s.length; let i = from + 1; let q: string | null = null; let depth = 0;
  while (i < n) {
    const d = s[i];
    if (q) { if (d === '\\') { i += 2; continue; } if (d === q) q = null; i += 1; continue; }
    if (d === "'" || d === '"' || d === '`') { q = d; i += 1; continue; }
    if (d === '{') { depth += 1; i += 1; continue; }
    if (d === '}') { if (depth > 0) depth -= 1; i += 1; continue; }
    if (d === '>' && depth === 0) return i + 1;
    i += 1;
  }
  return n;
}
function classOf(attr: string): { classes: string; dynamic: boolean } {
  const stat = /\b(?:class|className)\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(attr);
  if (stat) return { classes: stat[1] ?? stat[2] ?? '', dynamic: false };
  const dyn = /\b(?:class|className)\s*=\s*\{/.test(attr);
  return { classes: '', dynamic: dyn };
}
/** Bounded single-pass element scanner. Fails open (returns what it parsed) on any anomaly.
 *  Exported so peer contract analyzers (e.g. webBuildVisualConcept) reuse ONE JSX scanner
 *  authority instead of re-implementing a second regex scanner. */
export function scanElements(clean: string): ElementRef[] {
  const els: ElementRef[] = [];
  try {
    const n = clean.length; let i = 0; let labelDepth = 0; let guard = 0;
    while (i < n && guard < 6000) {
      if (clean[i] !== '<') { i += 1; continue; }
      const next = clean[i + 1] || '';
      if (next === '/') {                                   // closing tag
        const cm = /^<\/\s*([A-Za-z][\w.-]*)/.exec(clean.slice(i, i + 48));
        if (cm && cm[1] && cm[1].toLowerCase() === 'label' && labelDepth > 0) labelDepth -= 1;
        i = skipTag(clean, i); guard += 1; continue;
      }
      if (!/[A-Za-z]/.test(next)) { i += 1; continue; }     // not an element (comparison etc.)
      const end = skipTag(clean, i);
      const tagText = clean.slice(i, end);
      const nameM = /^<\s*([A-Za-z][\w.-]*)/.exec(tagText);
      const tag = nameM && nameM[1] ? nameM[1].toLowerCase() : '';
      const selfClosing = /\/>\s*$/.test(tagText);
      const attr = tagText.replace(/^<\s*[A-Za-z][\w.-]*/, '').replace(/\/?>\s*$/, '');
      const cl = classOf(attr);
      els.push({ tag, attr, classes: cl.classes, classesDynamic: cl.dynamic, withinLabel: labelDepth > 0 });
      if (tag === 'label' && !selfClosing) labelDepth += 1;
      guard += 1; i = end;
    }
  } catch { /* fail open — return whatever was parsed */ }
  return els;
}

export interface SectionFacts {
  id: string;
  path: string;
  clean: string;
  render: string;
  text: string;
  words: number;
  hasDynamic: boolean;
  hasChildComponent: boolean;
  elements: ElementRef[];
}
/** Build bounded per-section facts (cleaned source, scanned elements, render evidence, visible text).
 *  Exported so peer contract analyzers reuse this one section-facts builder rather than duplicate it. */
export function factsFor(id: string, path: string, content: string): SectionFacts {
  const clean = stripComments((content || '').slice(0, MAX_SCAN));
  const elements = scanElements(clean);
  const render = renderEvidence(elements);
  const vt = extractVisibleText(content || '');
  return {
    id, path, clean, render, text: vt.text, words: vt.text ? vt.text.split(/\s+/).filter((w) => /[a-z0-9]/i.test(w)).length : 0,
    hasDynamic: vt.hasDynamic, hasChildComponent: /<[A-Z][A-Za-z0-9]*[\s/>]/.test(clean),
    elements,
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * ACCEPTANCE — one unified, conservative, section-scoped surface. Sub-policies
 * push issues; only strongly-proven majors block; ambiguity → warning/fail-open.
 * ──────────────────────────────────────────────────────────────────────────── */
export type ExperienceIssueCode =
  // Phase 1 — coherence
  | 'experience-flat-rhythm' | 'experience-content-layout-tight'
  // Phase 2 — responsive
  | 'experience-desktop-only' | 'experience-harmful-clip'
  | 'experience-cta-hidden-mobile' | 'experience-responsive-warn'
  // Phase 3 — interaction
  | 'experience-interaction-no-feedback' | 'experience-interaction-warn' | 'experience-nav-dead-target'
  // Phase 4 — accessibility
  | 'experience-clickable-div' | 'experience-input-unlabeled' | 'experience-menu-no-control' | 'experience-a11y-warn'
  // Phase 5 — performance
  | 'experience-all-eager' | 'experience-hero-lazy'
  | 'experience-unbounded-motion' | 'experience-huge-inline' | 'experience-perf-warn';

export interface ExperienceIssue {
  code: ExperienceIssueCode;
  severity: FrontendBuilderReviewSeverity;
  subPolicy: 'coherence' | 'responsive' | 'interaction' | 'accessibility' | 'performance';
  label: string;
  files: string[];
  evidence: string;
  repairInstruction: string;
}
export interface ExperienceAcceptanceResult {
  status: 'pass' | 'warning' | 'fail';
  legacy: boolean;
  analyzedSectionCount: number;
  ambiguousSectionCount: number;
  coherenceFindingCount: number;
  responsiveFindingCount: number;
  interactionFindingCount: number;
  accessibilityFindingCount: number;
  performanceFindingCount: number;
  issues: ExperienceIssue[];
}
const LEGACY_EXPERIENCE: ExperienceAcceptanceResult = {
  status: 'pass', legacy: true, analyzedSectionCount: 0, ambiguousSectionCount: 0,
  coherenceFindingCount: 0, responsiveFindingCount: 0, interactionFindingCount: 0,
  accessibilityFindingCount: 0, performanceFindingCount: 0, issues: [],
};

function capEv(s: string): string { const t = (s || '').replace(/\s+/g, ' ').trim(); return t.length > MAX_EVIDENCE ? t.slice(0, MAX_EVIDENCE) : t; }

export function analyzeExperienceQuality(
  files: FrontendGeneratedFile[] | undefined,
  contract: ExperienceQualityContract | undefined,
): ExperienceAcceptanceResult {
  try {
    if (!contract || contract.status !== 'derived') return LEGACY_EXPERIENCE;
    const list = Array.isArray(files) ? files : [];
    if (!list.length) return { ...LEGACY_EXPERIENCE, legacy: false };
    const issues: ExperienceIssue[] = [];
    const push = (x: ExperienceIssue) => { if (issues.length < MAX_ISSUES) issues.push(x); };
    const units = collectSectionUnits(list, contract.sections.map((s) => s.id));
    const facts = units.slice(0, MAX_SECTIONS).map((u) => factsFor(u.id, u.path, u.content));
    const factById = new Map(facts.map((f) => [f.id, f]));
    const byId = new Map(contract.sections.map((s) => [s.id, s]));
    let ambiguous = 0;
    for (const f of facts) if (f.hasDynamic || f.hasChildComponent) ambiguous += 1;

    // ── Phase 1 — coherence (conservative, warning-first; ambiguity fails open). ──
    const tight = contract.sections.filter((sc) => {
      const f = factById.get(sc.id);
      return sc.contentLayoutFit === 'tight' && f && !f.hasDynamic && !f.hasChildComponent
        && f.words >= MIN_WORDS && /text-center/.test(f.render) && !/grid-cols|md:flex|lg:flex/.test(f.render);
    });
    if (tight.length >= COLLAPSE_MIN) {
      push({ code: 'experience-content-layout-tight', severity: 'minor', subPolicy: 'coherence', label: 'dense content in minimal layout', files: uniq(tight.map((s) => factById.get(s.id)?.path || '').filter(Boolean)).slice(0, MAX_ISSUE_FILES),
        evidence: capEv(`${tight.length} sections carry dense/proof content in a minimal centered single-column layout — verify the experience gives that content real room`),
        repairInstruction: capEv('Give dense/proof sections a layout with room (columns/structure) matching their content; do not cram them into a minimal centered block.') });
    }
    coherenceRhythmCheck(contract, facts, push);
    // ── Phase 2 — responsive layout & content-fit. ──
    responsiveCheck(facts, byId, factById, push);
    // ── Phase 3 — interaction depth & state-feedback integrity. ──
    const allAnchorIds = collectAllAnchorIds(list, contract.sections.map((s) => s.id));
    interactionCheck(byId, factById, allAnchorIds, push);
    // ── Phase 4 — accessibility & keyboard usability. ──
    accessibilityCheck(byId, factById, push);
    // ── Phase 5 — performance, media delivery & runtime resilience. ──
    performanceCheck(facts, byId, factById, push);

    const coherenceFindingCount = issues.filter((i) => i.subPolicy === 'coherence').length;
    const responsiveFindingCount = issues.filter((i) => i.subPolicy === 'responsive').length;
    const interactionFindingCount = issues.filter((i) => i.subPolicy === 'interaction').length;
    const accessibilityFindingCount = issues.filter((i) => i.subPolicy === 'accessibility').length;
    const performanceFindingCount = issues.filter((i) => i.subPolicy === 'performance').length;
    const blocking = issues.some((i) => i.severity !== 'minor');
    const warned = issues.some((i) => i.severity === 'minor');
    const status: ExperienceAcceptanceResult['status'] = blocking ? 'fail' : warned ? 'warning' : 'pass';
    return {
      status, legacy: false, analyzedSectionCount: facts.length, ambiguousSectionCount: ambiguous,
      coherenceFindingCount, responsiveFindingCount, interactionFindingCount, accessibilityFindingCount, performanceFindingCount,
      issues: issues.slice(0, MAX_ISSUES),
    };
  } catch {
    return { ...LEGACY_EXPERIENCE, legacy: false };
  }
}

/** Flat-rhythm warning: many substantive sections rendered as the same centered single-column block. */
function coherenceRhythmCheck(contract: ExperienceQualityContract, facts: SectionFacts[], push: (x: ExperienceIssue) => void): void {
  const centered = facts.filter((f) => !f.hasDynamic && f.words >= MIN_WORDS && /text-center/.test(f.render) && /mx-auto/.test(f.render) && !/grid-cols|flex-row|md:flex/.test(f.render));
  if (centered.length >= COLLAPSE_MIN && centered.length >= Math.ceil(facts.length * 0.6)) {
    push({ code: 'experience-flat-rhythm', severity: 'minor', subPolicy: 'coherence', label: 'flat page rhythm', files: uniq(centered.map((f) => f.path)).slice(0, MAX_ISSUE_FILES),
      evidence: capEv(`${centered.length} of ${facts.length} sections render as the same centered single-column block — the overall experience reads flat despite individually valid sections`),
      repairInstruction: capEv('Vary section structure/weight so the page has rhythm and 1–2 dominant moments, not one repeated centered column.') });
  }
  void contract;
}

/** Parse one container's className tokens into the BASE (unprefixed = mobile) grid columns and whether
 *  it wraps. Breakpoint-prefixed classes (md:grid-cols-N) do NOT change the base, so `grid-cols-3
 *  lg:grid-cols-4` is base-3 (three columns on mobile) — correctly unsafe. */
function baseGridCols(classes: string): { base: number | null; wraps: boolean } {
  const tokens = classes.split(/\s+/);
  let base: number | null = null; let wraps = false;
  for (const t of tokens) {
    if (t === 'flex-wrap') wraps = true;
    if (/:/.test(t)) continue;                 // a breakpoint override — not the mobile base
    const m = /^grid-cols-(\d+)$/.exec(t);
    if (m && m[1]) base = parseInt(m[1], 10);
  }
  return { base, wraps };
}
/** Phase 2 — responsive: correlate to the RENDERED grid container. A container whose BASE (mobile)
 *  grid is multi-column and does not wrap is mobile-unsafe. Systemic → block; isolated → warning;
 *  dynamic className / child components → ambiguous warning (never a pass, never a block). */
function responsiveCheck(
  facts: SectionFacts[],
  byId: Map<string, ExperienceSectionObligation>,
  factById: Map<string, SectionFacts>,
  push: (x: ExperienceIssue) => void,
): void {
  const unsafe: SectionFacts[] = [];
  const ambiguous: SectionFacts[] = [];
  for (const f of facts) {
    if (f.hasChildComponent) continue;                       // grid may live in a child → fail open
    let sectionUnsafe = false; let sectionAmbiguous = false;
    for (const el of f.elements) {
      const hasGridClass = /grid-cols/.test(el.classes);
      const dynamicGrid = el.classesDynamic && /grid|flex/i.test(el.attr);
      if (!hasGridClass && !dynamicGrid) continue;
      if (dynamicGrid && !hasGridClass) { sectionAmbiguous = true; continue; }
      const g = baseGridCols(el.classes);
      if (g.base !== null && g.base >= 2 && !g.wraps) sectionUnsafe = true;
    }
    if (sectionUnsafe) unsafe.push(f); else if (sectionAmbiguous) ambiguous.push(f);
  }
  if (unsafe.length >= COLLAPSE_MIN && unsafe.length >= Math.ceil(facts.length * 0.6)) {
    push({ code: 'experience-desktop-only', severity: 'major', subPolicy: 'responsive', label: 'desktop-only grids', files: uniq(unsafe.map((f) => f.path)).slice(0, MAX_ISSUE_FILES),
      evidence: capEv(`${unsafe.length} of ${facts.length} sections render a grid whose BASE (mobile) layout is multi-column (grid-cols-N, N≥2) with no wrap and no grid-cols-1 base — the layout stays multi-column on phones`),
      repairInstruction: capEv('Set the base grid to one column and widen at breakpoints (grid-cols-1 md:grid-cols-N) so each section is readable on mobile.') });
  } else if (unsafe.length >= 1) {
    push({ code: 'experience-responsive-warn', severity: 'minor', subPolicy: 'responsive', label: 'possible desktop-only grid', files: uniq(unsafe.map((f) => f.path)).slice(0, MAX_ISSUE_FILES),
      evidence: capEv(`${unsafe.length} section(s) render a base multi-column grid (grid-cols-N without a single-column base) — verify they stack on mobile`),
      repairInstruction: capEv('Use grid-cols-1 as the base and widen at breakpoints (md:grid-cols-N).') });
  } else if (ambiguous.length) {
    push({ code: 'experience-responsive-warn', severity: 'minor', subPolicy: 'responsive', label: 'grid columns dynamic', files: uniq(ambiguous.map((f) => f.path)).slice(0, MAX_ISSUE_FILES),
      evidence: capEv(`${ambiguous.length} section(s) compute grid columns dynamically — responsive collapse could not be statically confirmed; manual review`),
      repairInstruction: capEv('Ensure the dynamically-composed grid uses a single-column base on mobile.') });
  }
  // Harmful clipping of substantial copy in a small fixed-height overflow box (warning).
  const clipped = facts.filter((f) => !f.hasChildComponent && f.words >= 20 && /\boverflow-hidden\b/.test(f.render)
    && /\b(?:max-)?h-\[\d{2,3}px\]/.test(f.render) && !/line-clamp/.test(f.render));
  if (clipped.length) {
    push({ code: 'experience-harmful-clip', severity: 'minor', subPolicy: 'responsive', label: 'possible copy clipping', files: uniq(clipped.map((f) => f.path)).slice(0, MAX_ISSUE_FILES),
      evidence: capEv(`${clipped.length} section(s) place substantial copy in a small fixed-height overflow-hidden box with no line-clamp — verify text is not clipped on narrow screens`),
      repairInstruction: capEv('Avoid fixed heights that clip copy; let text wrap or use an intentional line-clamp with a full view.') });
  }
  // Primary-CTA section hidden at the base breakpoint with no responsive reveal (warning).
  for (const [id, ob] of byId) {
    if (ob.ctaRole !== 'primary') continue;
    const f = factById.get(id);
    if (f && !f.hasChildComponent && /\bhidden\b/.test(f.render) && !/(?:sm|md|lg|xl):(?:block|flex|inline|inline-block|grid)/.test(f.render)) {
      push({ code: 'experience-cta-hidden-mobile', severity: 'minor', subPolicy: 'responsive', label: 'primary CTA may be hidden', files: [f.path],
        evidence: capEv(`the primary-CTA section "${id}" uses a base "hidden" utility with no responsive reveal — verify the CTA is visible on mobile`),
        repairInstruction: capEv('Do not hide the primary CTA at the base breakpoint; keep it visible on mobile.') });
      break;
    }
  }
}

/** A JSX element that is a real interactive control (native control tag, or a div/span promoted with
 *  role="button"/tabIndex). Excludes hidden/submit-type distinctions — callers refine as needed. */
const CONTROL_TAGS = new Set(['button', 'input', 'select', 'textarea', 'a']);
function isControlEl(el: ElementRef): boolean {
  if (CONTROL_TAGS.has(el.tag)) return true;
  return (el.tag === 'div' || el.tag === 'span') && (/\brole=["']button["']/.test(el.attr) || /\btabIndex\b/.test(el.attr));
}
const HANDLER_ATTR_RE = /\bon(?:Click|Change|Submit|Input|KeyDown|KeyPress|KeyUp|Toggle)\s*=\s*\{/g;
/** Extract each on*={…} handler expression from one element's raw attribute text, capturing balanced
 *  braces so an arrow body / nested object / `>` inside the expression never truncates it. Bounded. */
function handlerExprs(attr: string): string[] {
  const out: string[] = [];
  HANDLER_ATTR_RE.lastIndex = 0;
  let m: RegExpExecArray | null; let guard = 0;
  while ((m = HANDLER_ATTR_RE.exec(attr)) && guard < 12) {
    guard += 1;
    const start = m.index + m[0].length - 1;                  // the opening '{'
    let depth = 0; let q: string | null = null; let i = start;
    for (; i < attr.length; i += 1) {
      const d = attr[i];
      if (q) { if (d === '\\') { i += 1; continue; } if (d === q) q = null; continue; }
      if (d === "'" || d === '"' || d === '`') { q = d; continue; }
      if (d === '{') depth += 1;
      else if (d === '}') { depth -= 1; if (depth === 0) { i += 1; break; } }
    }
    out.push(attr.slice(start, i));
  }
  return out;
}
/** Capture a named function/arrow body from `clean` starting at `from` (either a `{…}` block or a single
 *  arrow expression up to the statement end). Bounded to 1400 chars so a runaway never scans the file. */
function captureBody(clean: string, from: number): string {
  const cap = Math.min(clean.length, from + 1400);
  let i = from;
  while (i < cap && /\s/.test(clean[i] || '')) i += 1;
  if (clean[i] === '{') {
    let depth = 0; let q: string | null = null;
    for (; i < cap; i += 1) {
      const d = clean[i];
      if (q) { if (d === '\\') { i += 1; continue; } if (d === q) q = null; continue; }
      if (d === "'" || d === '"' || d === '`') { q = d; continue; }
      if (d === '{') depth += 1;
      else if (d === '}') { depth -= 1; if (depth === 0) { i += 1; break; } }
    }
    return clean.slice(from, i);
  }
  const rest = clean.slice(from, cap);
  const end = rest.search(/[;\n]/);
  return end >= 0 ? rest.slice(0, end) : rest;
}
/** Resolve a named handler identifier to its definition body (one level). */
function namedHandlerBody(clean: string, name: string): string {
  const arrow = new RegExp(`\\b(?:const|let|var)\\s+${name}\\s*=\\s*(?:async\\s*)?\\([^)]{0,200}\\)\\s*=>`).exec(clean)
    || new RegExp(`\\b(?:const|let|var)\\s+${name}\\s*=\\s*(?:async\\s*)?[A-Za-z_$][\\w$]*\\s*=>`).exec(clean);
  if (arrow) return captureBody(clean, arrow.index + arrow[0].length);
  const fn = new RegExp(`\\bfunction\\s+${name}\\s*\\([^)]{0,200}\\)`).exec(clean);
  if (fn) return captureBody(clean, fn.index + fn[0].length);
  return '';
}
const JS_KEYWORDS = new Set(['if', 'else', 'for', 'while', 'return', 'const', 'let', 'var', 'function', 'true', 'false', 'null', 'undefined', 'new', 'await', 'async', 'typeof', 'void', 'this', 'e', 'event', 'prev', 'React']);
/** Correlate this section's rendered controls to the state they actually write. Returns the state vars
 *  written by a handler that is attached to a REAL control (unrelated setters/handlers are excluded), and
 *  whether any real control with a handler exists. Bounded; fails open (empty) on anomaly. */
function correlateControls(f: SectionFacts): { controlWithHandler: boolean; controlCount: number; writtenVars: string[] } {
  const clean = f.clean;
  const setterToVar = new Map<string, string>();
  const sre = /const\s*\[\s*(\w+)\s*,\s*(set\w+)\s*\]\s*=\s*(?:React\.)?useState/g;
  let sm: RegExpExecArray | null; let sg = 0;
  while ((sm = sre.exec(clean)) && sg < 60) { sg += 1; if (sm[1] && sm[2]) setterToVar.set(sm[2], sm[1]); }
  // Gather handler code reachable FROM a real control (not any handler anywhere).
  let controlWithHandler = false; let controlCount = 0; let handlerCode = '';
  for (const el of f.elements) {
    if (!isControlEl(el)) continue;
    controlCount += 1;
    const exprs = handlerExprs(el.attr);
    if (exprs.length) { controlWithHandler = true; handlerCode += '\n' + exprs.join('\n'); }
  }
  // Resolve named handlers referenced by the controls (one level deep), bounded.
  const referenced = uniq((handlerCode.match(/\b[A-Za-z_$][\w$]*\b/g) || []).filter((n) => !JS_KEYWORDS.has(n) && !/^set[A-Z]/.test(n))).slice(0, 12);
  let resolved = '';
  for (const name of referenced) resolved += '\n' + namedHandlerBody(clean, name);
  const reachable = handlerCode + resolved;
  // Setters called within control-reachable handler code → the state var they write.
  const writtenVars = uniq([...setterToVar.entries()].filter(([setter]) => new RegExp(`\\b${setter}\\s*\\(`).test(reachable)).map(([, v]) => v));
  return { controlWithHandler, controlCount, writtenVars };
}
/** Is the WRITTEN state var `v` consumed anywhere beyond its single `useState` destructuring token — i.e.
 *  read back into a controlled value/attr, a conditional/mapped render, or a derived value that is itself
 *  rendered? We count `\bv\b` occurrences in the cleaned source: the destructuring `const [v, setV]`
 *  contributes exactly one (the setter `setV` is a distinct token and never matches `\bv\b`). A count of 1
 *  means the state is declared and written but never read anywhere — the definitive dead-control signal.
 *  Any further reference (even nested inside a `{list.map(r => …)}` callback that a brace-balanced regex
 *  could not span) counts as consumed, so we fail OPEN toward "wired" and only the unambiguous dead case
 *  can contribute to a block. Bounded scan. */
function readBackIntoRender(v: string, f: SectionFacts): boolean {
  const re = new RegExp(`\\b${v}\\b`, 'g');
  let count = 0; let guard = 0;
  while (re.exec(f.clean) && guard < 2000) { guard += 1; count += 1; if (count > 1) return true; }
  return false;
}
/** Collect every statically-declared element id / section anchor across ALL files — the resolvable
 *  targets an in-page nav anchor (`href="#id"`) may legitimately point at. Bounded; fail-open (broad). */
function collectAllAnchorIds(list: FrontendGeneratedFile[], sectionIds: string[]): Set<string> {
  const ids = new Set<string>();
  for (const sid of sectionIds) { const v = normId(sid); if (v) ids.add(v); }
  const re = /\b(?:id|data-korvix-section)\s*=\s*(?:"([^"]{1,80})"|'([^']{1,80})')/g;
  for (const f of list) {
    const src = (f.content || '').slice(0, MAX_SCAN);
    re.lastIndex = 0; let m: RegExpExecArray | null; let g = 0;
    while ((m = re.exec(src)) && g < 4000) { g += 1; const v = normId(m[1] ?? m[2] ?? ''); if (v) ids.add(v); }
  }
  return ids;
}

/** Phase 3 (nav integrity) — an in-page navigation anchor whose STATIC `href="#…"` target does not exist
 *  anywhere in the site (and which carries no click handler to drive navigation in JS) goes nowhere. That
 *  is a dead control by definition. Dynamic hrefs, JS-handled anchors, external/route hrefs and the
 *  conventional `#top`/`#main` targets are all skipped (fail open). */
function checkNavTargets(id: string, f: SectionFacts, allIds: Set<string>, push: (x: ExperienceIssue) => void): void {
  const dead: string[] = [];
  for (const el of f.elements) {
    if (el.tag !== 'a') continue;
    const attr = el.attr;
    const hrefStat = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(attr);
    if (!hrefStat) continue;                                    // dynamic href={…} → fail open
    const href = (hrefStat[1] ?? hrefStat[2] ?? '').trim();
    if (!href.startsWith('#')) continue;                        // external / route / mailto → not an in-page anchor
    const hasHandler = /\bon(?:Click|KeyDown|KeyUp|KeyPress)\s*=/.test(attr);
    const target = normId(href.slice(1));
    if (!target) { if (!hasHandler) dead.push('#'); continue; } // href="#" with no handler → goes nowhere
    if (target === 'top' || target === 'main') continue;        // conventional page-top / main-landmark
    if (!allIds.has(target) && !hasHandler) dead.push(href);    // points at an id that exists nowhere
    if (dead.length >= 6) break;
  }
  if (dead.length) {
    push({ code: 'experience-nav-dead-target', severity: 'major', subPolicy: 'interaction', label: 'nav link goes nowhere', files: [f.path],
      evidence: capEv(`navigation section "${id}" has ${dead.length} in-page link(s) whose target does not exist and has no click handler (${uniq(dead).slice(0, 4).join(', ')}) — the link goes nowhere`),
      repairInstruction: capEv('Point each in-page nav link at a real existing section id (href="#realSectionId"), or wire an onClick that performs the navigation; remove dead href="#" placeholders.') });
  }
}

/** Phase 3 — interaction: correlate a rendered control → its handler → the state it writes → a rendered
 *  dynamic outcome. Enforced for BOTH a BINDING-REQUIRED interaction (#558) AND a MODULE that semantically
 *  requires interaction on its own (mobile nav, accordion/FAQ, tabs, gallery/carousel, filter/sort,
 *  modal/lightbox, frontend-only form). A frontend-only interactive control whose handler writes no state
 *  read back (and exposes no aria/live feedback) is a DEAD control → block. We only judge a control that is
 *  ACTUALLY PRESENT: a genuinely static section with no live control is never forced interactive.
 *  Backend-required, weakly-inferred, or child-hosted regions warn / fail open — never block. */
function interactionCheck(
  byId: Map<string, ExperienceSectionObligation>,
  factById: Map<string, SectionFacts>,
  allIds: Set<string>,
  push: (x: ExperienceIssue) => void,
): void {
  for (const [id, ob] of byId) {
    const it = ob.interaction;
    const kind = it?.kind;
    if (!it || !kind || kind === 'none') continue;
    const f = factById.get(id);
    if (!f) continue;

    // Nav-target integrity is judged from the anchor markup itself (independent of child components).
    if (kind === 'navigation' && (it.required || it.semanticInteraction)) checkNavTargets(id, f, allIds, push);

    if (f.hasChildComponent) continue;                          // control/state may live in a child → fail open
    const { controlWithHandler, controlCount, writtenVars } = correlateControls(f);
    const outcomeWired = writtenVars.some((v) => readBackIntoRender(v, f));
    const hasAriaLive = /aria-live=/.test(f.render) || /role=["'](?:status|alert)["']/.test(f.render);
    const hasConditionalFeedback = /aria-(?:expanded|selected|current|pressed)=/.test(f.render) || /data-state=/.test(f.render);
    const feedbackWired = outcomeWired || hasAriaLive || hasConditionalFeedback;

    // ── Binding-required interactions: the authoritative path. ──
    if (it.required) {
      if (!controlCount && !f.hasDynamic) {
        push({ code: 'experience-interaction-warn', severity: 'minor', subPolicy: 'interaction', label: 'required control not found', files: [f.path],
          evidence: capEv(`section "${id}" is a binding-required ${kind}${it.requiredControls.length ? ` (controls: ${it.requiredControls.slice(0, 3).join(', ')})` : ''} but no rendered control was found in its own markup — verify the control is present and not only in a child`),
          repairInstruction: capEv(`Render the required control(s)${it.requiredControls.length ? ` (${it.requiredControls.slice(0, 3).join(', ')})` : ''} as real keyboard-operable inputs in this section.`) });
        continue;
      }
      if (!controlWithHandler) continue;                        // control exists but no local handler to judge → fail open
      if (feedbackWired) continue;                              // control → state → rendered outcome is wired
      if ((kind === 'tool' || kind === 'form') && it.frontendOnly) {
        push({ code: 'experience-interaction-no-feedback', severity: 'major', subPolicy: 'interaction', label: `${kind} control changes nothing`, files: [f.path],
          evidence: capEv(`the binding-required ${kind} section "${id}" wires a control handler but no state it writes is read back into the UI (no controlled value/output, no aria-live)${it.requiredOutcome ? ` — the required outcome "${it.requiredOutcome}" never updates` : ' — the control produces no visible outcome'}`),
          repairInstruction: capEv(`Wire the control's state into a rendered outcome${it.requiredOutcome ? ` (${it.requiredOutcome})` : ''} so the interaction is perceivable; do not fabricate backend success.`) });
      } else {
        // Backend-required (frontendOnly === false) or a disclosure/gallery/nav: local feedback is not
        // provable here (server round-trip / child) → warn, never block.
        push({ code: 'experience-interaction-warn', severity: 'minor', subPolicy: 'interaction', label: `${kind} outcome not visible locally`, files: [f.path],
          evidence: capEv(`the required ${kind} section "${id}" wires a control but no local state is read back${it.frontendOnly ? '' : ' (outcome may be server-driven)'} — verify the ${it.requiredOutcome || 'result/feedback'} is perceivable`),
          repairInstruction: capEv('Ensure the interaction produces perceivable feedback (result, selection, or a success/error message) at the control.') });
      }
      continue;
    }

    // ── Module-SEMANTIC interactions (derived from the module itself, not a binding requirement). Enforce
    //    the dead-control lifecycle for a control that IS present; never force a static section to add one. ──
    if (it.semanticInteraction) {
      if (!controlWithHandler) continue;                        // no live control present → respect a static implementation
      if (feedbackWired) continue;                              // control → state / aria / data-state → visible outcome
      // A real control with a handler that writes nothing read back and exposes no aria/live/data-state
      // feedback is a DEAD, decorative control. For the inherently frontend-only interactive modules
      // (disclosure/gallery/nav) — and for a frontend-only tool/form — that is a strongly-proven block.
      const frontendDriven = kind === 'disclosure' || kind === 'gallery' || kind === 'navigation'
        || ((kind === 'tool' || kind === 'form') && it.frontendOnly);
      if (frontendDriven) {
        push({ code: 'experience-interaction-no-feedback', severity: 'major', subPolicy: 'interaction', label: `dead ${kind} control`, files: [f.path],
          evidence: capEv(`the ${kind} module "${id}" renders an interactive control with a handler, but nothing it does is perceivable — no state read back into the UI, no aria-expanded/selected/pressed, no data-state, no aria-live — the control is decorative/dead`),
          repairInstruction: capEv(`Make the ${kind} actually work: drive a visible state change from the control (toggle/expand, active item, filtered results, or open/close) and reflect it with a controlled render or an aria/data-state attribute. Keep it keyboard-operable.`) });
      } else {
        push({ code: 'experience-interaction-warn', severity: 'minor', subPolicy: 'interaction', label: `${kind} feedback unclear`, files: [f.path],
          evidence: capEv(`the ${kind} module "${id}" wires a control but its outcome is not locally perceivable — verify it produces visible feedback`),
          repairInstruction: capEv('Ensure the interaction produces perceivable feedback (result, selection, or a success/error message) at the control.') });
      }
      continue;
    }

    // ── Weakly-inferred (non-semantic, non-required) interactions: warn only, never block. ──
    if (!controlWithHandler) continue;
    if (!feedbackWired && (kind === 'tool' || kind === 'form')) {
      push({ code: 'experience-interaction-warn', severity: 'minor', subPolicy: 'interaction', label: `${kind} feedback unclear`, files: [f.path],
        evidence: capEv(`the ${kind} section "${id}" wires a control but no state it writes is read back into the UI — verify interactions produce visible feedback`),
        repairInstruction: capEv('Wire the control state into a visible outcome (selection/result/message) so the interaction reads clearly.') });
    }
  }
}

const A11Y_HANDLER_RE = /\bon(?:Click|MouseDown|MouseUp)\s*=/;
const A11Y_KEY_RE = /\bon(?:KeyDown|KeyPress|KeyUp)\s*=/;
function attrIdOf(attr: string): { id: string; dynamic: boolean } {
  const stat = /\bid\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(attr);
  if (stat) return { id: stat[1] ?? stat[2] ?? '', dynamic: false };
  return { id: '', dynamic: /\bid\s*=\s*\{/.test(attr) };
}
/** Phase 4 — accessibility: evaluate EACH suspicious element independently. A single label or a real
 *  button elsewhere never excuses a separate unlabeled field or a separate click-only div. #559 owns image
 *  existence, #562 owns contrast. Fails open on child-hosted structure. */
function accessibilityCheck(
  byId: Map<string, ExperienceSectionObligation>,
  factById: Map<string, SectionFacts>,
  push: (x: ExperienceIssue) => void,
): void {
  for (const [id, ob] of byId) {
    const f = factById.get(id);
    if (!f || f.hasChildComponent) continue;                   // a child could supply the label/control → fail open
    const interactive = !!ob.interaction && ob.interaction.kind !== 'none';

    // 1. Each non-semantic clickable element judged on ITS OWN affordances — a real <button> elsewhere in
    //    the section does not make a separate click-only <div> keyboard-operable.
    let clickDivs = 0;
    for (const el of f.elements) {
      if (el.tag !== 'div' && el.tag !== 'span') continue;
      if (!A11Y_HANDLER_RE.test(el.attr)) continue;
      const keyboardOperable = /\brole=["']button["']/.test(el.attr) || /\btabIndex\b/.test(el.attr)
        || A11Y_KEY_RE.test(el.attr) || /\brole=["'](?:link|menuitem|tab|switch|checkbox)["']/.test(el.attr);
      if (!keyboardOperable) clickDivs += 1;
    }
    if (clickDivs > 0 && interactive) {
      push({ code: 'experience-clickable-div', severity: 'major', subPolicy: 'accessibility', label: 'clickable div control', files: [f.path],
        evidence: capEv(`section "${id}" has ${clickDivs} clickable <div>/<span> element(s) with no role/tabIndex/key handler of their own — each is not keyboard-operable (a real button elsewhere does not fix these)`),
        repairInstruction: capEv('Make every clickable element a real <button>/<a>, or give that same element role="button", tabIndex and an onKeyDown handler.') });
    }

    // 2. Each form field judged on ITS OWN accessible name: wrapping <label>, own aria-label/labelledby/
    //    title, or an id that a <label htmlFor> points at. Placeholder alone → warn (not a name).
    const labelForIds = new Set<string>(); let dynamicLabelFor = false;
    for (const el of f.elements) {
      if (el.tag !== 'label') continue;
      const hf = /\bhtmlFor\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(el.attr);
      if (hf) { const v = hf[1] ?? hf[2] ?? ''; if (v) labelForIds.add(v); }
      else if (/\bhtmlFor\s*=\s*\{/.test(el.attr)) dynamicLabelFor = true;   // linkage target computed → unverifiable
    }
    let unlabeled = 0; let placeholderOnly = 0; let unverifiable = 0;
    for (const el of f.elements) {
      if (el.tag !== 'input' && el.tag !== 'textarea' && el.tag !== 'select') continue;
      if (/\btype\s*=\s*["'](?:hidden|submit|button|image|reset)["']/.test(el.attr)) continue;
      const named = el.withinLabel
        || /\baria-label(?:ledby)?\s*=/.test(el.attr)
        || /\btitle\s*=/.test(el.attr);
      const idInfo = attrIdOf(el.attr);
      const idNamed = !!idInfo.id && labelForIds.has(idInfo.id);
      if (named || idNamed) continue;
      const hasPlaceholder = /\bplaceholder\s*=/.test(el.attr);
      // Only DYNAMIC linkage is unverifiable: a field with no static id cannot be a <label htmlFor> target,
      // so other labels never excuse it. Ambiguity comes from id={…} or a label htmlFor={…} we cannot read.
      const ambiguousName = idInfo.dynamic || dynamicLabelFor;
      if (hasPlaceholder) placeholderOnly += 1;
      else if (ambiguousName) unverifiable += 1;
      else unlabeled += 1;
    }
    if (unlabeled > 0) {
      push({ code: 'experience-input-unlabeled', severity: 'major', subPolicy: 'accessibility', label: 'unlabeled form field(s)', files: [f.path],
        evidence: capEv(`section "${id}" renders ${unlabeled} form control(s) with no accessible name (no wrapping <label>, no aria-label/labelledby/title, no matching <label htmlFor>, no placeholder) — they cannot be identified by assistive tech`),
        repairInstruction: capEv('Give EVERY form control an accessible name: wrap it in a <label>, or pair <label htmlFor="x"> with the control id="x", or add aria-label.') });
    } else if (placeholderOnly > 0) {
      push({ code: 'experience-a11y-warn', severity: 'minor', subPolicy: 'accessibility', label: 'placeholder-only field(s)', files: [f.path],
        evidence: capEv(`section "${id}" names ${placeholderOnly} field(s) with a placeholder only — a placeholder is not an accessible name`),
        repairInstruction: capEv('Add a real <label> (or aria-label) in addition to the placeholder for each field.') });
    } else if (unverifiable > 0) {
      push({ code: 'experience-a11y-warn', severity: 'minor', subPolicy: 'accessibility', label: 'field label linkage dynamic', files: [f.path],
        evidence: capEv(`section "${id}" has ${unverifiable} field(s) whose id/label linkage is computed dynamically — the accessible name could not be statically confirmed`),
        repairInstruction: capEv('Ensure each dynamically-linked field resolves to a real <label>/aria-label at runtime.') });
    }

    // 3. Mobile menu / disclosure that toggles but exposes no disclosure state / operable control (warning).
    if (ob.interaction && (ob.interaction.kind === 'navigation' || ob.interaction.kind === 'disclosure')) {
      const r = f.render;
      const toggles = /\bon(?:Click|Toggle)\s*=/.test(r) || /useState/.test(f.clean);
      const exposes = /aria-(?:expanded|controls|hidden)=/.test(r) || /<button\b/.test(r);
      if (toggles && !exposes) {
        push({ code: 'experience-menu-no-control', severity: 'minor', subPolicy: 'accessibility', label: 'disclosure state not exposed', files: [f.path],
          evidence: capEv(`the ${ob.interaction.kind} in "${id}" toggles but exposes no aria-expanded/controls or button control — verify it is operable and announced`),
          repairInstruction: capEv('Use a <button> with aria-expanded/aria-controls for the disclosure/menu toggle and an operable close.') });
      }
    }
  }
}

/** Is an <img> element decorative / non-primary (marked hidden or empty-alt), so its loading strategy must
 *  NOT gate the hero LCP decision? */
function isDecorativeImg(attr: string): boolean {
  return /\baria-hidden=["']true["']/.test(attr) || /\brole=["']presentation["']/.test(attr) || /\balt=["']["']/.test(attr);
}
function isLazyImg(attr: string): boolean { return /\bloading\s*=\s*["']lazy["']/i.test(attr); }
/** Phase 5 — performance / media delivery. Correlates the hero-eager obligation to the ACTUAL primary
 *  hero image (#559 heroRequired + #561 focal, via the derived hero priority) — a lazy secondary or
 *  decorative image in a hero never blocks. Reuses #559 media decisions (no new sourcing). Blocks only
 *  strong systemic waste on rendered element evidence; unprovable runtime cost warns / fails open. */
function performanceCheck(
  facts: SectionFacts[],
  byId: Map<string, ExperienceSectionObligation>,
  factById: Map<string, SectionFacts>,
  push: (x: ExperienceIssue) => void,
): void {
  const imgEls = (f: SectionFacts): ElementRef[] => f.elements.filter((el) => el.tag === 'img');
  const allImgs = facts.flatMap((f) => imgEls(f));
  const lazyImgs = allImgs.filter((el) => isLazyImg(el.attr));
  const sectionsWithImg = facts.filter((f) => imgEls(f).length > 0);
  // 1. All images eager (no lazy anywhere) on an image-heavy page (blocker) — real <img> elements only.
  if (allImgs.length >= 6 && sectionsWithImg.length >= COLLAPSE_MIN && lazyImgs.length === 0) {
    push({ code: 'experience-all-eager', severity: 'major', subPolicy: 'performance', label: 'no lazy-loading', files: uniq(sectionsWithImg.map((f) => f.path)).slice(0, MAX_ISSUE_FILES),
      evidence: capEv(`${allImgs.length} <img> elements across ${sectionsWithImg.length} sections load eagerly with zero lazy-loading — below-fold media is downloaded up front, hurting load performance`),
      repairInstruction: capEv('Lazy-load below-fold images (loading="lazy") and keep only the hero/LCP image eager.') });
  }
  // 2. The PRIMARY hero/LCP image lazy-loaded (blocker). Only the first non-decorative image in a section
  //    whose derived media role is the hero counts — a decorative/secondary lazy image does not block.
  for (const [id, ob] of byId) {
    const isHero = ob.performance?.mediaPriority === 'hero' || ob.performance?.heroRequired === true;
    if (!isHero) continue;
    const f = factById.get(id);
    if (!f || f.hasChildComponent) continue;                   // hero media may live in a child → fail open
    const imgs = imgEls(f);
    const primary = imgs.find((el) => !isDecorativeImg(el.attr));
    if (primary && isLazyImg(primary.attr)) {
      push({ code: 'experience-hero-lazy', severity: 'major', subPolicy: 'performance', label: 'hero image lazy-loaded', files: [f.path],
        evidence: capEv(`the hero section "${id}" lazy-loads its PRIMARY image — the LCP image should load eagerly (with priority), not be deferred (secondary/decorative images in this section may stay lazy)`),
        repairInstruction: capEv('Load the hero/LCP image eagerly (remove loading="lazy"; add fetchpriority="high"); keep secondary/decorative images lazy.') });
      break;
    }
  }
  // 3. Unbounded continuous animation across several elements with NO reduced-motion anywhere (blocker).
  const reducedMotion = facts.some((f) => /motion-reduce:|prefers-reduced-motion/i.test(f.clean));
  const infinite = facts.reduce((acc, f) => acc + ((f.render.match(/\banimate-(?:spin|bounce|ping)\b/g) || []).length) + ((f.clean.match(/animation:[^;]*\binfinite\b/gi) || []).length), 0);
  if (infinite >= COLLAPSE_MIN && !reducedMotion) {
    push({ code: 'experience-unbounded-motion', severity: 'major', subPolicy: 'performance', label: 'unbounded motion, no reduced-motion', files: [],
      evidence: capEv(`${infinite} continuous/infinite animations run with no prefers-reduced-motion handling anywhere — this wastes runtime and ignores motion sensitivity`),
      repairInstruction: capEv('Gate continuous animations behind prefers-reduced-motion (motion-reduce:) and avoid unbounded animation on content.') });
  }
  // 4. Giant or repeated inline base64 payloads (blocker).
  const base64 = facts.flatMap((f) => f.clean.match(/data:(?:image|font)\/[^;]{1,20};base64,[A-Za-z0-9+/=]{2000,}/gi) || []);
  const huge = base64.filter((b) => b.length >= 40000);
  const repeated = base64.filter((b) => b.length >= 8000);
  const repeatedDup = new Set(repeated).size < repeated.length && repeated.length >= 3;
  if (huge.length >= 1 || repeatedDup) {
    push({ code: 'experience-huge-inline', severity: 'major', subPolicy: 'performance', label: 'huge/duplicated inline media', files: [],
      evidence: capEv(`${huge.length ? `a ${Math.round((huge[0]?.length || 0) / 1000)}KB inline base64 payload is embedded` : `${repeated.length} large inline base64 payloads (some duplicated) are embedded`} — inline media bloats the bundle and blocks parsing`),
      repairInstruction: capEv('Serve media as real image files (reuse the sourced assets) instead of embedding large/duplicated base64 inline.') });
  }
  // 5. Duplicate heavy media reused across many sections (warning — often intentional, e.g. logos).
  const srcCount = new Map<string, number>();
  for (const el of allImgs) { const m = /src=["']([^"']+)["']/i.exec(el.attr); if (m && m[1] && !/logo|icon|favicon/i.test(m[1])) srcCount.set(m[1], (srcCount.get(m[1]) || 0) + 1); }
  const dup = [...srcCount.entries()].filter(([, c]) => c >= 3);
  if (dup.length) {
    push({ code: 'experience-perf-warn', severity: 'minor', subPolicy: 'performance', label: 'repeated large media', files: [],
      evidence: capEv(`${dup.length} image source(s) are reused in 3+ places — verify this is intentional (a shared asset), not duplicated heavy media`),
      repairInstruction: capEv('Reuse a single optimized asset reference; avoid loading the same heavy image many times unnecessarily.') });
  }
}

export function hasBlockingExperienceFindings(result: ExperienceAcceptanceResult | undefined): boolean {
  return !!result && result.status === 'fail';
}

const EXPERIENCE_CATEGORY: Record<ExperienceIssueCode, FrontendBuilderReviewCategory> = {
  'experience-flat-rhythm': 'layout-rhythm',
  'experience-content-layout-tight': 'layout-rhythm',
  'experience-desktop-only': 'responsive-intent',
  'experience-harmful-clip': 'responsive-intent',
  'experience-cta-hidden-mobile': 'responsive-intent',
  'experience-responsive-warn': 'responsive-intent',
  'experience-interaction-no-feedback': 'motion-and-interaction',
  'experience-interaction-warn': 'motion-and-interaction',
  'experience-nav-dead-target': 'motion-and-interaction',
  'experience-clickable-div': 'accessibility-intent',
  'experience-input-unlabeled': 'accessibility-intent',
  'experience-menu-no-control': 'accessibility-intent',
  'experience-a11y-warn': 'accessibility-intent',
  'experience-all-eager': 'maintainability',
  'experience-hero-lazy': 'maintainability',
  'experience-unbounded-motion': 'motion-and-interaction',
  'experience-huge-inline': 'maintainability',
  'experience-perf-warn': 'maintainability',
};

export function experienceToReviewIssues(result: ExperienceAcceptanceResult | undefined): FrontendBuilderReviewIssue[] {
  if (!result || !result.issues.length) return [];
  const out: FrontendBuilderReviewIssue[] = [];
  let i = 0;
  for (const issue of result.issues) {
    if (issue.severity === 'minor') continue;   // advisory/manual-review — never a repair blocker
    out.push({
      id: `experience-${issue.code}-${i += 1}`,
      severity: issue.severity,
      category: EXPERIENCE_CATEGORY[issue.code],
      files: (issue.files || []).slice(0, MAX_ISSUE_FILES),
      evidence: capEv(issue.evidence),
      repairInstruction: capEv(issue.repairInstruction),
    });
    if (out.length >= MAX_ISSUES) break;
  }
  return out;
}

export function experienceIssueCodes(result: ExperienceAcceptanceResult | undefined): string[] {
  if (!result) return [];
  return uniq(result.issues.map((i) => i.code)).slice(0, 12);
}

/* ── Owner diagnostics (bounded, no secrets / source / URLs / raw copy). ── */
export interface ExperienceQualityDiagnostics {
  experienceVersion: string;
  experienceStatus: 'derived' | 'legacy';
  subPolicies: string[];
  /** truthful trace of which upstream contracts materially changed a derived obligation. */
  materiallyConsumed: string[];
  requiredInteractionCount: number;
  requiredMediaCount: number;
  sectionObligationCount: number;
  experienceCharCount: number;
  derivationBasis: string[];
  contractPersistedInSpecification: boolean;
  contractRenderedToFrontendBuilder: boolean;
  contractUsedByAcceptance: boolean;
  agentsActuallyConsumingContract: string[];
  analyzedSectionCount?: number;
  ambiguousSectionCount?: number;
  coherenceFindingCount?: number;
  responsiveFindingCount?: number;
  interactionFindingCount?: number;
  accessibilityFindingCount?: number;
  performanceFindingCount?: number;
  experienceAcceptanceStatus?: 'pass' | 'warning' | 'fail';
  experienceIssueCodes?: string[];
}

export function buildExperienceDiagnostics(
  contract: ExperienceQualityContract | undefined,
  acceptance: ExperienceAcceptanceResult | undefined,
  experienceCharCount: number,
): ExperienceQualityDiagnostics | undefined {
  if (!contract) return undefined;
  const live = acceptance && !acceptance.legacy ? acceptance : undefined;
  return {
    experienceVersion: contract.version,
    experienceStatus: contract.status,
    subPolicies: contract.subPolicies.slice(0, MAX_LIST),
    materiallyConsumed: contract.materiallyConsumed.slice(0, MAX_LIST),
    requiredInteractionCount: contract.sections.filter((s) => s.interaction?.required).length,
    requiredMediaCount: contract.sections.filter((s) => s.performance?.mediaRequired).length,
    sectionObligationCount: contract.sections.length,
    experienceCharCount,
    derivationBasis: contract.derivationBasis.slice(0, MAX_LIST),
    contractPersistedInSpecification: contract.contractPersistedInSpecification,
    contractRenderedToFrontendBuilder: contract.contractRenderedToFrontendBuilder,
    contractUsedByAcceptance: contract.contractUsedByAcceptance,
    agentsActuallyConsumingContract: contract.agentsActuallyConsumingContract.slice(0, MAX_LIST),
    ...(live ? {
      analyzedSectionCount: live.analyzedSectionCount,
      ambiguousSectionCount: live.ambiguousSectionCount,
      coherenceFindingCount: live.coherenceFindingCount,
      responsiveFindingCount: live.responsiveFindingCount,
      interactionFindingCount: live.interactionFindingCount,
      accessibilityFindingCount: live.accessibilityFindingCount,
      performanceFindingCount: live.performanceFindingCount,
      experienceAcceptanceStatus: live.status,
      experienceIssueCodes: experienceIssueCodes(live),
    } : {}),
  };
}
