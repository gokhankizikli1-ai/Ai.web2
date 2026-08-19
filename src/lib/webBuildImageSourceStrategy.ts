/**
 * Web Build — IMAGE SOURCE STRATEGY (web-build-image-intelligence-v1).
 *
 * The ONE authority that answers, per image slot of a WEB build:
 *
 *     stock      — a real photograph of a real thing; authenticity is the point
 *     generated  — a bespoke, brand-defining / conceptual visual stock cannot supply
 *     none       — no photo at all; the interface, type or a native component IS the visual
 *
 * WHY IT EXISTS
 * Every visual requirement used to be the same problem: "find a stock photo". A restaurant's
 * dining room and a SaaS hero abstraction were sourced by the same search, and a developer tool
 * that should show a terminal got a photograph of an office. The verdicts that would have decided
 * this correctly already existed — they were just never composed into ONE routing decision:
 *
 *   decision                                    existing owner (unchanged, consumed here)
 *   ─────────────────────────────────────────   ────────────────────────────────────────────
 *   is imagery needed at all, in what medium    experienceIntelligence.media (MediaDirection)
 *   the REQUIRED photography floor              imageCoverage (ImageCoverageRequirement)
 *   per-image art direction + authenticity      visualConcept.imageRoles (ImageRoleDirection)
 *   how much of the site's job imagery carries  designIntelligence.image.role (ImageryRole)
 *   which slots may EVER be generated           webBuildImageGeneration kind safety sets
 *   which sections carry media                  composition → media.surfaces
 *
 * This module RE-DECIDES none of them. It reads them as evidence and emits one bounded, typed,
 * JSON-safe routing contract with per-decision basis + evidence, so a wrong route is debuggable
 * and no second classifier exists to drift.
 *
 * HARD PROPERTIES
 *   • WEB ONLY. `buildType: 'app'` yields `undefined` — an app build has no contract, therefore
 *     no generated-image route can be reached from one (structural, not a runtime check).
 *   • ZERO model / network / provider calls. Pure, deterministic, no Date/Math.random.
 *   • It never RAISES the image count of a build: every decision is attached to a slot the
 *     pipeline already planned. It can only re-route a slot or remove it.
 *   • Generated imagery is hard-bounded by the EXISTING per-build AI ceiling
 *     (`MAX_AI_FALLBACK_ATTEMPTS`), not by a new quota of its own.
 *   • Fail-open: any problem returns `undefined` and the pipeline behaves exactly as before.
 */
import type { BuildType } from '@/lib/buildType';
import type { FrontendBuildSpecification, FrontendSpecImageSlot } from '@/lib/webBuildAgents';
import type {
  ImageCoverageRequirement, ImageCoverageTarget,
} from '@/lib/webBuildImageCoverage';
import { MAX_AI_FALLBACK_ATTEMPTS, findSpecSlotForTarget } from '@/lib/webBuildImageCoverage';
import type {
  VisualConceptContract, ImageRoleDirection, ImageRole, VisualMedium, PhotographyPosture,
} from '@/lib/webBuildVisualConcept';
import type { ExperienceIntelligenceContract, MediaDirection, MediaKind } from '@/lib/experienceIntelligence';
import type { ImageryRole } from '@/lib/webBuildDesignIntelligence';
import { ALWAYS_MANUAL_IMAGE_KINDS, ILLUSTRATIVE_IMAGE_KINDS } from '@/lib/webBuildImageGeneration';

/* ── Bounds (named, mandatory) ──────────────────────────────────────────────── */
/** Hard ceiling on AI-generated images per build. Deliberately the EXISTING per-build AI
 *  fallback ceiling — there is exactly one image-generation budget in the product. */
export const MAX_GENERATED_IMAGES_PER_BUILD = MAX_AI_FALLBACK_ATTEMPTS;
/** Default budget: ONE strong bespoke visual. A second is spent only on a REQUIRED slot that
 *  no honest stock photograph can satisfy. */
export const DEFAULT_GENERATED_BUDGET = 1;
const MAX_DECISIONS = 16;
const MAX_EVIDENCE_PER_DECISION = 3;
const MAX_REASONS = 12;
const MAX_TEXT = 140;

/* ── Public vocabulary ──────────────────────────────────────────────────────── */
export type ImageSourceStrategy = 'stock' | 'generated' | 'none';

/** WHICH authority produced the route. Makes a wrong decision attributable. */
export type ImageSourceBasis =
  | 'explicit-request'
  | 'media-verdict'
  | 'coverage-floor'
  | 'art-direction'
  | 'archetype-imagery-role'
  | 'surface-media-role'
  | 'generation-safety'
  | 'budget';

/** WHY this route. Stable, bounded codes reused by diagnostics and acceptance. */
export type ImageSourceReasonCode =
  | 'explicit-no-photo'
  | 'media-unnecessary'
  | 'surface-carries-no-media'
  | 'interface-native-visual'
  | 'authenticity-required'
  | 'proof-heavy-subject'
  | 'real-world-subject'
  | 'coverage-required-stock'
  | 'brand-defining-concept'
  | 'conceptual-abstract-visual'
  | 'illustrative-medium'
  | 'generated-budget-exhausted'
  | 'generation-unsafe-slot'
  | 'imagery-incidental';

export interface ImageSourceDecision {
  /** The SAME slot identity the sourcing pipeline uses (spec image-slot id, or a coverage
   *  target id when the slot is synthesized during sourcing). */
  slotId: string;
  sectionId?: string;
  /** The visual-concept role, when art direction exists for this slot. */
  role?: ImageRole;
  /** The slot kind the image pipeline planned (hero-image, gallery-photo, …). */
  kind?: string;
  hero: boolean;
  required: boolean;
  strategy: ImageSourceStrategy;
  reason: ImageSourceReasonCode;
  basis: ImageSourceBasis[];
  evidence: string[];
  /** Ordered routes to try when `strategy` cannot produce a usable asset. Never contains a
   *  route the authenticity/semantics of this slot forbid — an honest empty tail is correct. */
  fallback: ImageSourceStrategy[];
  /** Carried through so the generated route needs no second art-direction lookup. */
  authenticity?: ImageRoleDirection['authenticity'];
  medium?: VisualMedium;
  aspectRatio?: string;
}

export interface ImageSourceStrategyContract {
  version: 'image-source-strategy-v1';
  /** Always 'web' — the contract is never derived for an app build. */
  buildType: 'web';
  mediaNecessity: MediaDirection['necessity'] | 'unknown';
  leadVisual: MediaDirection['leadVisual'] | 'unknown';
  primaryMediaKind: MediaKind | 'unknown';
  imageryRole: ImageryRole | 'unknown';
  coverageMode: ImageCoverageRequirement['mode'] | 'unknown';
  photographyPosture: PhotographyPosture | 'unknown';
  decisions: ImageSourceDecision[];
  stockCount: number;
  generatedCount: number;
  noneCount: number;
  /** How many generated images THIS build may produce (≤ MAX_GENERATED_IMAGES_PER_BUILD). */
  generatedBudget: number;
  generatedCeiling: number;
  reasons: ImageSourceReasonCode[];
}

/* ── Evidence vocabularies, read from the owning contracts ──────────────────── */

/** Media whose honest answer is a real interface / real data / real type — never a picture. */
const UI_NATIVE_MEDIA: ReadonlySet<VisualMedium> = new Set<VisualMedium>([
  'product-ui', 'data-visualization', 'technical-diagram', 'typographic',
]);
/** Media a generative model can author WITHOUT claiming anything factual. */
const GENERATIVE_MEDIA: ReadonlySet<VisualMedium> = new Set<VisualMedium>([
  'abstract-generative', 'illustration', 'editorial-collage', 'texture-material',
  '3d-scene', 'mixed-media', 'motion-led',
]);
/** Media that depict the REAL world — a synthetic version would reduce trust. */
const REAL_WORLD_MEDIA: ReadonlySet<VisualMedium> = new Set<VisualMedium>([
  'photography', 'environmental-lifestyle',
]);
/** Media kinds whose subject is something that must actually exist. */
const REAL_WORLD_KINDS: ReadonlySet<MediaKind> = new Set<MediaKind>([
  'place-photography', 'people-photography', 'product-photography', 'editorial-photography',
]);
/**
 * Media kinds whose honest rendering is the interface itself.
 *
 * `iconography` is deliberately ABSENT. The media authority falls back to it when no
 * classification produced a medium at all (an unresolved archetype, a two-word prompt), so
 * reading it as "this product's evidence is icons" would silently strip the imagery of every
 * request the classifier could not resolve. An unresolved request keeps the previous behaviour
 * and is decided by the rules below on its own art direction.
 */
const UI_NATIVE_KINDS: ReadonlySet<MediaKind> = new Set<MediaKind>([
  'interface-preview', 'diagram',
]);
/** Roles a bespoke generated visual can legitimately carry (never a proof role). */
const GENERATABLE_ROLES: ReadonlySet<ImageRole> = new Set<ImageRole>([
  'hero-signature', 'background-atmosphere', 'decorative-texture',
  'process-illustration', 'feature-explanation', 'security-technical',
]);
/** Roles whose whole job is to prove something real. */
const PROOF_ROLES: ReadonlySet<ImageRole> = new Set<ImageRole>([
  'social-proof-portrait', 'trust-lifestyle', 'product-context', 'editorial-break',
]);
/** Roles whose honest answer is a real, coded component (chart/diagram), not an image. */
const UI_NATIVE_ROLES: ReadonlySet<ImageRole> = new Set<ImageRole>(['data-diagram']);

const HERO_KINDS = new Set(['hero-image', 'hero-background']);

/* ── Pure helpers ───────────────────────────────────────────────────────────── */
const clip = (s: unknown, n = MAX_TEXT): string => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, n) : '');
function normId(s: string | undefined): string { return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ''); }
function pushReason(list: ImageSourceReasonCode[], code: ImageSourceReasonCode): void {
  if (!list.includes(code) && list.length < MAX_REASONS) list.push(code);
}

/** The canonical purpose→role mapping. Exported so the sourcing pipeline resolves art direction
 *  through the SAME map instead of keeping a second copy of it. */
export const IMAGE_PURPOSE_TO_ROLE: Record<string, ImageRole> = {
  hero: 'hero-signature',
  background: 'background-atmosphere',
  team: 'social-proof-portrait',
  about: 'trust-lifestyle',
  product: 'product-context',
  gallery: 'editorial-break',
  project: 'editorial-break',
  showcase: 'editorial-break',
  lifestyle: 'trust-lifestyle',
  editorial: 'editorial-break',
  section: 'feature-explanation',
  other: 'feature-explanation',
};

/**
 * Resolve the ALREADY-derived art direction for a slot: exact slot id first, then the role that
 * maps to the slot's purpose, then the hero role for a hero slot. The single resolver — the
 * sourcing pipeline calls this one rather than repeating the lookup.
 */
export function resolveImageRoleForSlot(
  visualConcept: VisualConceptContract | undefined,
  slotId: string | undefined,
  purpose: string | undefined,
): ImageRoleDirection | undefined {
  const roles = visualConcept?.imageRoles;
  if (!Array.isArray(roles) || !roles.length) return undefined;
  const nid = normId(slotId);
  if (nid) {
    const exact = roles.find((r) => normId(r.slotId) === nid);
    if (exact) return exact;
  }
  const wanted = IMAGE_PURPOSE_TO_ROLE[(purpose || '').toLowerCase()];
  if (wanted) {
    const byRole = roles.find((r) => r.role === wanted);
    if (byRole) return byRole;
  }
  if ((purpose || '').toLowerCase() === 'hero') return roles.find((r) => r.role === 'hero-signature');
  return undefined;
}

/* ── Candidate assembly ─────────────────────────────────────────────────────── */
interface Candidate {
  slotId: string;
  sectionId?: string;
  kind: string;
  purpose: string;
  hero: boolean;
  required: boolean;
  coverage?: ImageCoverageTarget;
  art?: ImageRoleDirection;
}

/** Slot target → the section id the composition/media authority keys its surfaces on. */
function sectionIdOfTarget(target: string | undefined): string | undefined {
  const t = clip(target, 80);
  if (!t || t === 'global') return undefined;
  return t.startsWith('section:') ? t.slice('section:'.length) : t;
}

function collectCandidates(
  slots: FrontendSpecImageSlot[],
  coverage: ImageCoverageRequirement | undefined,
  visualConcept: VisualConceptContract | undefined,
): Candidate[] {
  const out: Candidate[] = [];
  const requiredTargets = (coverage?.targets || []).filter((t) => t && t.required);

  /* Which slot satisfies which REQUIRED coverage target is NOT decided here — that pairing
   * authority already exists and the sourcing pipeline uses it. We call the SAME function, in
   * the SAME target-first order, so the `required` flag on a decision can never disagree with
   * the slot the coverage pipeline will actually assign. (An earlier revision re-implemented the
   * pairing slot-first with a hero/non-hero heuristic; two orderings of the same assignment are
   * exactly the kind of duplicate authority that drifts.) */
  const specLike = { assets: { imageSlots: slots } } as unknown as FrontendBuildSpecification;
  const usedSlots = new Set<string>();
  const targetBySlotId = new Map<string, ImageCoverageTarget>();
  const unpairedTargets: ImageCoverageTarget[] = [];
  for (const t of requiredTargets) {
    const paired = findSpecSlotForTarget(specLike, t, usedSlots);
    if (paired?.id) { usedSlots.add(paired.id); targetBySlotId.set(paired.id, t); }
    else unpairedTargets.push(t);
  }

  const seen = new Set<string>();
  for (const s of slots.slice(0, MAX_DECISIONS)) {
    if (!s || !s.id || seen.has(s.id)) continue;
    seen.add(s.id);
    const kind = clip(s.kind, 60);
    const purpose = clip(s.purpose, 40) || (HERO_KINDS.has(kind) ? 'hero' : '');
    const hero = HERO_KINDS.has(kind) || /hero/i.test(`${kind} ${purpose} ${s.target || ''}`);
    const target = targetBySlotId.get(s.id);
    out.push({
      slotId: s.id,
      sectionId: sectionIdOfTarget(s.target),
      kind,
      purpose: purpose || target?.purpose || 'other',
      hero: hero || !!target?.hero,
      required: !!target?.required,
      coverage: target,
      art: resolveImageRoleForSlot(visualConcept, s.id, purpose || target?.purpose),
    });
  }

  // A REQUIRED coverage target the pairing authority could not place on an existing slot is
  // still a real image — the pipeline synthesizes a slot for it, so it must carry a route.
  for (const t of unpairedTargets) {
    if (out.length >= MAX_DECISIONS) break;
    out.push({
      slotId: t.id,
      sectionId: t.sectionId,
      kind: t.hero ? 'hero-image' : (t.manualRequired ? 'gallery-photo' : 'hero-background'),
      purpose: t.purpose,
      hero: !!t.hero,
      required: true,
      coverage: t,
      art: resolveImageRoleForSlot(visualConcept, t.slotId || t.id, t.purpose),
    });
  }
  return out.slice(0, MAX_DECISIONS);
}

/* ── The routing decision (deterministic, evidence-first) ───────────────────── */
interface RouteContext {
  media?: MediaDirection;
  coverage?: ImageCoverageRequirement;
  imageryRole?: ImageryRole;
  posture?: PhotographyPosture;
  /** The experience lead — 'interface-led' / 'data-led' / 'utility-led' mean the working surface
   *  IS the argument, so a picture of it is decoration. Read, never re-decided. */
  lead?: string;
  surfacePolicy: Map<string, string>;
  /**
   * True only when a page-composition contract actually ASSERTED a per-section media role.
   *
   * Without one the media authority falls back to "assert only the lead visual, never a guess",
   * which renders every other section as `policy: 'none'`. That means "not asserted", not
   * "forbidden" — reading it as a verdict silently deleted real imagery. Measured on the
   * fixtures: it removed the hero of a local-service, an editorial and an event site, and the
   * interior shot of a restaurant, all of which genuinely want photography.
   */
  surfaceVerdictsAsserted: boolean;
}

/** Proof-heavy by CONSTRUCTION: this slot depicts something that must actually exist. Checked
 *  before any medium/UI reasoning so a product or gallery image can never be re-routed away
 *  from a real photograph. */
function isProofHeavy(c: Candidate): boolean {
  if (c.coverage?.manualRequired || c.coverage?.aiAllowed === false || c.coverage?.authenticityRisk === 'high') return true;
  if (c.kind && ALWAYS_MANUAL_IMAGE_KINDS.has(c.kind)) return true;
  if (c.art && PROOF_ROLES.has(c.art.role)) return true;
  return false;
}

/** May this slot be authored by a generative model at all (the EXISTING kind/role safety sets)? */
function isGeneratable(c: Candidate): boolean {
  if (isProofHeavy(c)) return false;
  if (c.art?.authenticity === 'authentic-photo-required') return false;
  if (c.kind && !ILLUSTRATIVE_IMAGE_KINDS.has(c.kind)) return false;
  if (c.art && !GENERATABLE_ROLES.has(c.art.role)) return false;
  return true;
}

/** Leads where the real working surface is the argument and a photograph is decoration. */
const INTERFACE_LEADS = new Set(['interface-led', 'data-led', 'utility-led']);

function decide(c: Candidate, ctx: RouteContext): ImageSourceDecision {
  const basis: ImageSourceBasis[] = [];
  const evidence: string[] = [];
  const add = (b: ImageSourceBasis, e: string): void => {
    if (!basis.includes(b)) basis.push(b);
    if (evidence.length < MAX_EVIDENCE_PER_DECISION && e) evidence.push(clip(e, 120));
  };
  const base = {
    slotId: c.slotId,
    ...(c.sectionId ? { sectionId: c.sectionId } : {}),
    ...(c.art ? { role: c.art.role } : {}),
    ...(c.kind ? { kind: c.kind } : {}),
    hero: c.hero,
    required: c.required,
    ...(c.art?.authenticity ? { authenticity: c.art.authenticity } : {}),
    ...(c.art?.medium ? { medium: c.art.medium } : {}),
    ...(c.art?.aspectRatio ? { aspectRatio: c.art.aspectRatio } : {}),
  };
  const none = (reason: ImageSourceReasonCode): ImageSourceDecision =>
    ({ ...base, strategy: 'none', reason, basis, evidence, fallback: [] });
  const stock = (reason: ImageSourceReasonCode): ImageSourceDecision =>
    ({ ...base, strategy: 'stock', reason, basis, evidence, fallback: ['none'] });
  const generated = (reason: ImageSourceReasonCode): ImageSourceDecision => {
    // A generated visual falls back to stock ONLY when a real photograph would still be an
    // honest answer for this slot; otherwise the honest fallback is no image at all.
    const stockOk = ctx.coverage?.stockAllowed !== false
      && c.coverage?.stockAllowed !== false
      && c.art?.fallbackAllowed !== false
      && !!clip(c.art?.subject, 60);
    return { ...base, strategy: 'generated', reason, basis, evidence, fallback: stockOk ? ['stock', 'none'] : ['none'] };
  };

  /* ── 1. An explicit exclusion, and the floors that outrank it. The coverage authority
   *      already resolved that conflict; we consume its verdict rather than re-judging it. ── */
  if (ctx.coverage?.explicitNoPhoto || ctx.coverage?.mode === 'none') {
    add('explicit-request', 'the request excluded photography');
    return none('explicit-no-photo');
  }

  const media = ctx.media;
  const proofHeavy = isProofHeavy(c);
  const generatable = isGeneratable(c);

  /* ── 2. The media verdict: is imagery useful here at all? A REQUIRED coverage target outranks
   *      it — this layer never lowers a floor it does not own. ── */
  if (!c.required && media) {
    if (media.necessity === 'unnecessary') {
      add('media-verdict', 'the media verdict says this product does not need photography');
      return none('media-unnecessary');
    }
    if (c.hero && media.leadVisual === 'forbidden') {
      add('media-verdict', 'the media verdict forbids a lead visual on this surface');
      return none('media-unnecessary');
    }
    // Only an ASSERTED per-section verdict (one that distinguishes sections) removes an image.
    if (ctx.surfaceVerdictsAsserted && c.sectionId && ctx.surfacePolicy.get(c.sectionId) === 'none') {
      add('surface-media-role', 'the composition authority gives this section no media role');
      return none('surface-carries-no-media');
    }
  }

  /* ── 3. UI-NATIVE superiority — the honest visual is a real interface, real data or type.
   *      Read from the medium the art-direction authority chose for THIS slot and from the media
   *      kind the classification owner chose for this product; never from a keyword scan. Never
   *      applied to a proof-heavy slot, whose subject must be photographed either way. ── */
  const uiNativeArt = !!c.art && (UI_NATIVE_MEDIA.has(c.art.medium) || UI_NATIVE_ROLES.has(c.art.role));
  const uiNativeVerdict = !!media && UI_NATIVE_KINDS.has(media.primaryKind);
  /* Two precedence guards, both learned from the regression fixtures:
   *  • the classification owner saying this product's medium is real-world photography
   *    (a restaurant, a portfolio, a shop) outranks a per-slot medium — otherwise ONE misread
   *    visual category could turn an image-led site's hero into a non-photo;
   *  • a slot whose OWN art direction names a generative medium is more specific than the
   *    product-level medium, so it keeps its bespoke route instead of being erased. */
  const interfaceLed = !!ctx.lead && INTERFACE_LEADS.has(ctx.lead);
  // …but not when the experience LEAD says the working interface is the argument: there the
  // product-level photographic medium is itself the weaker signal (a dashboard product whose
  // archetype was read as a publication), and the interface must win.
  const realWorldVerdict = !!media && REAL_WORLD_KINDS.has(media.primaryKind) && !interfaceLed;
  const bespokeArt = !!c.art && GENERATIVE_MEDIA.has(c.art.medium);
  if (!proofHeavy && !realWorldVerdict && !bespokeArt && (uiNativeArt || uiNativeVerdict)) {
    add(uiNativeArt ? 'art-direction' : 'media-verdict',
      uiNativeArt
        ? `art direction asks for ${c.art?.medium}, not a photograph`
        : `the product's evidence is ${media?.primaryKind}, built in code`);
    // The interface IS the argument (a dev tool, a dashboard-like product, a raw utility), or the
    // archetype rates imagery incidental: no image belongs here at all.
    const imageryDownrated = ctx.imageryRole === 'incidental' || ctx.imageryRole === 'unnecessary';
    if (!c.required && (interfaceLed || imageryDownrated)) {
      add('archetype-imagery-role', interfaceLed
        ? 'the working interface is the argument here'
        : `the archetype rates imagery ${ctx.imageryRole}`);
      return none('interface-native-visual');
    }
    /* Imagery still helps this product, but a photograph of it would be a photograph of nothing:
     * a bespoke brand visual is the honest answer, never generic office/people stock.
     *
     * This is the only branch that SPENDS money on a slot the product could simply do without,
     * so it demands POSITIVE evidence that imagery earns its place here — either the media
     * authority actually ran and rated imagery required/beneficial, or the archetype rates it
     * central/supporting, or the coverage floor requires it. With no verdict at all (a
     * failed-open spec) the honest answer is no image, not a paid guess. */
    const imageryEarnsItsPlace = c.required
      || media?.necessity === 'required' || media?.necessity === 'beneficial'
      || ctx.imageryRole === 'central' || ctx.imageryRole === 'supporting';
    if (generatable && imageryEarnsItsPlace) {
      add('art-direction', 'a bespoke brand visual, not a photograph of a real scene');
      return generated('brand-defining-concept');
    }
    if (!c.required) return none('interface-native-visual');
  }

  /* ── 4. AUTHENTICITY — a real photograph of a real thing. A synthetic version of these
   *      subjects would reduce trust, so this outranks every bespoke option below. ── */
  if (c.art?.authenticity === 'authentic-photo-required') {
    add('art-direction', 'art direction requires an authentic photograph');
    return stock('authenticity-required');
  }
  if (proofHeavy) {
    add(c.coverage ? 'coverage-floor' : 'generation-safety', 'this slot depicts something that must actually exist');
    return stock('proof-heavy-subject');
  }
  if (c.art && REAL_WORLD_MEDIA.has(c.art.medium)) {
    add('art-direction', `art direction asks for ${c.art.medium} of the real subject`);
    return stock('real-world-subject');
  }
  if (!c.art && media && REAL_WORLD_KINDS.has(media.primaryKind)) {
    add('media-verdict', `the medium for this product is ${media.primaryKind}`);
    return stock('real-world-subject');
  }

  /* ── 5. BESPOKE / CONCEPTUAL — stock would be generic here, and nothing factual is claimed.
   *      A product whose medium the classification owner resolved to real-world photography (a
   *      restaurant, a shop, a venue) only reaches a bespoke route through its OWN art direction
   *      naming a non-photographic medium — never through a category-level posture, which would
   *      otherwise let a synthetic "photo" stand in for a real place. ── */
  // The same "imagery must earn its place" bar as rule 3: a bespoke visual is a PAID slot, so a
  // spec with no media verdict and no archetype imagery role never buys one.
  const earnsItsPlace = c.required
    || media?.necessity === 'required' || media?.necessity === 'beneficial'
    || ctx.imageryRole === 'central' || ctx.imageryRole === 'supporting';
  if (generatable && earnsItsPlace) {
    if (c.art && GENERATIVE_MEDIA.has(c.art.medium)) {
      add('art-direction', `the visual is ${c.art.medium} — a bespoke, non-factual composition`);
      return generated(c.art.medium === 'illustration' ? 'illustrative-medium' : 'conceptual-abstract-visual');
    }
    const realWorldProduct = !!media && REAL_WORLD_KINDS.has(media.primaryKind);
    if (c.hero && !realWorldProduct && (ctx.posture === 'graphic-first' || ctx.posture === 'none')) {
      add('art-direction', 'the visual concept is graphic-first: a stock photograph would read as generic');
      return generated('brand-defining-concept');
    }
  }

  /* ── 6. Defaults — stock-first, exactly as before this contract existed. ── */
  if (c.required) {
    add('coverage-floor', 'a required coverage image with no bespoke justification');
    return stock('coverage-required-stock');
  }
  if (ctx.imageryRole === 'incidental' || ctx.imageryRole === 'unnecessary') {
    add('archetype-imagery-role', `the archetype rates imagery ${ctx.imageryRole}`);
    return none('imagery-incidental');
  }
  add('coverage-floor', 'no exclusion and no bespoke justification — a real photograph');
  return stock('coverage-required-stock');
}

/* ── Budget (cost discipline) ───────────────────────────────────────────────── */
/**
 * How many generated images THIS build may pay for. ONE strong bespoke visual by default; a
 * second only for a REQUIRED slot that no honest stock photograph can satisfy. Never above the
 * single product-wide ceiling.
 */
export function resolveGeneratedBudget(decisions: ImageSourceDecision[]): number {
  const gen = decisions.filter((d) => d.strategy === 'generated');
  if (!gen.length) return 0;
  const requiredWithoutStock = gen.filter((d) => d.required && !d.fallback.includes('stock')).length;
  return Math.min(MAX_GENERATED_IMAGES_PER_BUILD, Math.max(DEFAULT_GENERATED_BUDGET, requiredWithoutStock));
}

/** Rank generated candidates by real value: required first, then the lead visual, then order. */
function generatedRank(d: ImageSourceDecision, i: number): number {
  return (d.required ? 0 : 4) + (d.hero ? 0 : 2) + (d.role === 'hero-signature' ? 0 : 1) + i / 1000;
}

/** Demote every generated decision beyond the budget onto its own fallback route. Pure. */
export function applyGeneratedBudget(decisions: ImageSourceDecision[], budget: number): ImageSourceDecision[] {
  const keep = new Set<string>();
  decisions
    .map((d, i) => ({ d, i }))
    .filter((x) => x.d.strategy === 'generated')
    .sort((a, b) => generatedRank(a.d, a.i) - generatedRank(b.d, b.i))
    .slice(0, Math.max(0, budget))
    .forEach((x) => keep.add(`${x.i}`));
  return decisions.map((d, i) => {
    if (d.strategy !== 'generated' || keep.has(`${i}`)) return d;
    const next = d.fallback[0] || 'none';
    return {
      ...d,
      strategy: next,
      reason: 'generated-budget-exhausted' as ImageSourceReasonCode,
      basis: [...d.basis, 'budget' as ImageSourceBasis],
      fallback: next === 'stock' ? ['none'] : [],
    };
  });
}

/* ── Derivation entry point ─────────────────────────────────────────────────── */
export interface ImageSourceStrategyInput {
  buildType?: BuildType;
  imageSlots?: FrontendSpecImageSlot[];
  imageCoverage?: ImageCoverageRequirement;
  visualConcept?: VisualConceptContract;
  experienceIntelligence?: ExperienceIntelligenceContract;
  /** designIntelligence.image.role — how much of the site's job imagery carries. */
  imageryRole?: ImageryRole;
  /** True when the page-composition contract actually assigned per-section media roles (see
   *  `surfaceVerdictsAsserted`). Supplied by the caller; absent ⇒ per-section 'none' is treated
   *  as "not asserted" rather than as a verdict. */
  compositionSectionsWithMediaRole?: boolean;
}

/**
 * Derive the routing contract. WEB ONLY — `undefined` for an app build (and for any build with
 * no image slots and no required coverage, so nothing changes there). Pure + fail-open.
 */
export function deriveImageSourceStrategy(
  input: ImageSourceStrategyInput | undefined,
): ImageSourceStrategyContract | undefined {
  try {
    if (!input) return undefined;
    // STRUCTURAL app isolation: the contract is never derived for an app build, so the generated
    // route has no input to run from and no app request can carry web image vocabulary.
    if (input.buildType === 'app') return undefined;

    const media = input.experienceIntelligence?.buildType === 'app'
      ? undefined                                  // never read an app contract's media verdict
      : input.experienceIntelligence?.media;
    const coverage = input.imageCoverage;
    const slots = (input.imageSlots || []).filter((s) => s && s.id && s.source !== 'css-placeholder');
    const candidates = collectCandidates(slots, coverage, input.visualConcept);
    if (!candidates.length) return undefined;

    const surfacePolicy = new Map<string, string>();
    for (const surface of (media?.surfaces || [])) {
      if (surface && surface.id) surfacePolicy.set(surface.id, surface.policy);
    }
    const ctx: RouteContext = {
      media,
      coverage,
      imageryRole: input.imageryRole,
      posture: input.visualConcept?.realImageStrategy?.posture,
      lead: input.experienceIntelligence?.experience?.lead,
      surfacePolicy,
      surfaceVerdictsAsserted: !!input.compositionSectionsWithMediaRole,
    };

    const raw = candidates.map((c) => decide(c, ctx));
    const generatedBudget = resolveGeneratedBudget(raw);
    const decisions = applyGeneratedBudget(raw, generatedBudget);

    const reasons: ImageSourceReasonCode[] = [];
    for (const d of decisions) pushReason(reasons, d.reason);

    return {
      version: 'image-source-strategy-v1',
      buildType: 'web',
      mediaNecessity: media?.necessity || 'unknown',
      leadVisual: media?.leadVisual || 'unknown',
      primaryMediaKind: media?.primaryKind || 'unknown',
      imageryRole: input.imageryRole || 'unknown',
      coverageMode: coverage?.mode || 'unknown',
      photographyPosture: input.visualConcept?.realImageStrategy?.posture || 'unknown',
      decisions,
      stockCount: decisions.filter((d) => d.strategy === 'stock').length,
      generatedCount: decisions.filter((d) => d.strategy === 'generated').length,
      noneCount: decisions.filter((d) => d.strategy === 'none').length,
      generatedBudget,
      generatedCeiling: MAX_GENERATED_IMAGES_PER_BUILD,
      reasons,
    };
  } catch {
    return undefined;   // fail-open: the pipeline behaves exactly as it did before
  }
}

/** Derive from an assembled specification. WEB ONLY; fail-open. */
export function deriveImageSourceStrategyForSpec(
  spec: FrontendBuildSpecification | undefined,
): ImageSourceStrategyContract | undefined {
  if (!spec) return undefined;
  return deriveImageSourceStrategy({
    buildType: spec.buildType,
    imageSlots: spec.assets?.imageSlots,
    imageCoverage: spec.imageCoverage,
    visualConcept: spec.visualConcept,
    experienceIntelligence: spec.experienceIntelligence,
    imageryRole: spec.designIntelligence?.image?.role,
    compositionSectionsWithMediaRole: (spec.composition?.sections || []).some((x) => !!(x as { mediaRole?: string })?.mediaRole),
  });
}

/** The route for one slot id. `undefined` ⇒ no contract / not a planned image slot. */
export function decisionForSlot(
  contract: ImageSourceStrategyContract | undefined, slotId: string | undefined,
): ImageSourceDecision | undefined {
  if (!contract || !slotId) return undefined;
  const nid = normId(slotId);
  return contract.decisions.find((d) => normId(d.slotId) === nid);
}

/** Bounded, secret-free diagnostics (counts + codes only). */
export interface ImageSourceStrategyDiagnostics {
  version: 'image-source-strategy-v1';
  coverageMode: string;
  mediaNecessity: string;
  leadVisual: string;
  imageryRole: string;
  photographyPosture: string;
  decisionCount: number;
  stockCount: number;
  generatedCount: number;
  noneCount: number;
  generatedBudget: number;
  generatedCeiling: number;
  reasonCodes: ImageSourceReasonCode[];
}

export function buildImageSourceStrategyDiagnostics(
  contract: ImageSourceStrategyContract | undefined,
): ImageSourceStrategyDiagnostics | undefined {
  if (!contract) return undefined;
  return {
    version: 'image-source-strategy-v1',
    coverageMode: contract.coverageMode,
    mediaNecessity: contract.mediaNecessity,
    leadVisual: contract.leadVisual,
    imageryRole: contract.imageryRole,
    photographyPosture: contract.photographyPosture,
    decisionCount: contract.decisions.length,
    stockCount: contract.stockCount,
    generatedCount: contract.generatedCount,
    noneCount: contract.noneCount,
    generatedBudget: contract.generatedBudget,
    generatedCeiling: contract.generatedCeiling,
    reasonCodes: contract.reasons.slice(0, MAX_REASONS),
  };
}
