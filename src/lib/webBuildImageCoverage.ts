/**
 * Web Build — SEMANTIC IMAGE-COVERAGE contract + coverage orchestration helpers.
 *
 * ONE authoritative, additive, JSON-safe requirement that says — for a NEW build — how much
 * semantically relevant photography the site MUST have, derived from evidence that already
 * exists (binding media requirements from Phase 12G, resolved sector/vertical, the image
 * pipeline slots, image-led visual direction, explicit "no photography" instructions). It does
 * NOT plan taste or pick slots — Visual Intelligence / Visual Strategy still own that. This layer
 * only decides the floor of required coverage and, when a valid strategy leaves that floor
 * uncovered (accidental `none`, zero photo slots, unknown slot ids, invalid queries), provides a
 * conservative deterministic fallback that fills ONLY the missing mandatory coverage while
 * preserving the strategy's mood/style/authenticity guidance.
 *
 * Everything here is PURE and bounded. Stock is always the first choice. AI generation is a
 * bounded, cost-controlled, last-resort fallback whose persistence safety is classified here: a
 * provider that can only return a session-only base64 data URL (openai / stability today) is
 * NEVER injected into generated source — the required slot stays honestly uncovered with the
 * reason `ai-fallback-not-persistable`, for the existing manual-review path to handle.
 *
 * No new env vars, no provider/model calls, no dependencies. Additive & optional on old builds.
 */
import type {
  FrontendBuildSpecification, FrontendSpecImageSlot, FrontendBindingRequirements,
} from '@/lib/webBuildAgents';
import { photographicSlots, type VisualStrategy } from '@/lib/webBuildVisualStrategy';

/* ── Bounds (named, mandatory) ─────────────────────────────────────────────── */
export const MAX_COVERAGE_TARGETS = 6;      // total coverage targets modelled
export const MAX_REQUIRED_COVERAGE = 4;     // required semantic images we will insist on
export const MAX_AI_FALLBACK_ATTEMPTS = 2;  // automatic AI attempts per build (hero-first)
const MAX_ALIASES = 8;
const MAX_QUERY = 120;
const MAX_ALT = 200;

/* ── Public contract types (persisted, all additive/optional for old builds) ── */
export type ImageCoverageMode = 'none' | 'optional' | 'required' | 'image-led';

export type ImageCoveragePurpose =
  | 'hero' | 'editorial' | 'gallery' | 'showcase' | 'lifestyle' | 'about' | 'product' | 'section';

export type ImageCoverageOrientation = 'landscape' | 'portrait' | 'square';

export type ImageCoverageMatchStatus = 'pending' | 'sourced' | 'ai-usable' | 'uncovered';

/** Stable, bounded reason codes (used consistently across derivation, sourcing and acceptance). */
export type ImageCoverageReasonCode =
  | 'no-image-slots'
  | 'explicit-no-photo'
  | 'strategy-none-overridden-by-binding-media'
  | 'strategy-zero-photo-slots'
  | 'strategy-slot-id-mismatch'
  | 'strategy-invalid-query'
  | 'deterministic-required-slot-created'
  | 'no-providers'
  | 'provider-error'
  | 'no-results'
  | 'stock-timeout'
  | 'stock-partial'
  | 'ai-fallback-not-authorized'
  | 'ai-fallback-unsafe-slot'
  | 'ai-fallback-not-persistable'
  | 'required-image-not-rendered'
  | 'required-image-semantically-mismatched'
  | 'required-image-uncovered';

export interface ImageCoverageTarget {
  id: string;
  purpose: ImageCoveragePurpose;
  label: string;
  /** Semantic aliases used to prove a rendered image actually matches this purpose. */
  aliases: string[];
  required: boolean;
  hero: boolean;
  sectionId?: string;
  orientation: ImageCoverageOrientation;
  query: string;
  altText: string;
  stockAllowed: boolean;
  /** True only for illustrative/ambient purposes that are safe to AI-generate (never proof). */
  aiAllowed: boolean;
  /** True for proof-heavy real-world imagery that must be a real photo / manual upload. */
  manualRequired: boolean;
  authenticityRisk: 'low' | 'medium' | 'high';
  /* ── Sourcing-time state (filled after stock sourcing / AI fallback; additive) ── */
  slotId?: string;
  domId?: string;
  provider?: string;
  matchStatus?: ImageCoverageMatchStatus;
  failureReason?: ImageCoverageReasonCode;
}

export interface ImageCoverageRequirement {
  version: 'image-coverage-v1';
  mode: ImageCoverageMode;
  minRequired: number;
  heroRequired: boolean;
  stockAllowed: boolean;
  stockPreferred: boolean;
  aiAllowed: boolean;
  manualRequired: boolean;
  explicitNoPhoto: boolean;
  targets: ImageCoverageTarget[];
  reasons: ImageCoverageReasonCode[];
}

/* ── Sector authority ──────────────────────────────────────────────────────── */
// Sectors where photography is fundamental to credibility → coverage is required/image-led.
const IMAGE_LED_SECTORS = new Set<string>([
  'travel-tourism', 'restaurant-hospitality', 'real-estate', 'portfolio-agency',
  'furniture-interiors', 'jewelry', 'automotive-dealership', 'landscaping',
]);
// Software/product concepts that legitimately prefer CSS/SVG/product-UI mockups → not forced.
const SOFTWARE_SECTORS = new Set<string>(['ai-saas']);

const NOPHOTO_RE = /\b(?:no|without|zero)\s+(?:photo|photos|photography|image|images|imagery|picture|pictures)\b|\b(?:typography|text|type|copy)[\s-]*only\b|\bpurely\s+typographic\b|\bno\s+stock\s+(?:photo|image)/i;
const IMAGE_LED_DIRECTION_RE = /\b(?:image[- ]led|photo[- ]led|photography[- ]led|editorial\s+photography|full[- ]bleed\s+(?:photo|image)|immersive\s+(?:photo|imagery)|photo[- ]forward|visually\s+rich\s+photography|destination\s+photography|hero\s+photography)\b/i;

/* ── Small pure helpers ────────────────────────────────────────────────────── */
function clip(s: string | undefined, n: number): string { return (s || '').replace(/\s+/g, ' ').trim().slice(0, n); }
function toks(s: string | undefined): string[] {
  return (s || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3);
}
function uniq<T>(a: T[]): T[] { return [...new Set(a)]; }
function pushReason(list: ImageCoverageReasonCode[], code: ImageCoverageReasonCode): void {
  if (!list.includes(code)) list.push(code);
}

/** Per-purpose safety profile: is it illustrative-safe to AI-generate, or proof-heavy (manual)? */
function purposeProfile(purpose: ImageCoveragePurpose): { aiAllowed: boolean; manualRequired: boolean; risk: 'low' | 'medium' | 'high'; orientation: ImageCoverageOrientation } {
  switch (purpose) {
    case 'hero': return { aiAllowed: true, manualRequired: false, risk: 'low', orientation: 'landscape' };
    case 'editorial': return { aiAllowed: true, manualRequired: false, risk: 'low', orientation: 'landscape' };
    case 'lifestyle': return { aiAllowed: true, manualRequired: false, risk: 'medium', orientation: 'landscape' };
    case 'section': return { aiAllowed: true, manualRequired: false, risk: 'low', orientation: 'landscape' };
    case 'about': return { aiAllowed: false, manualRequired: false, risk: 'medium', orientation: 'landscape' };
    // Proof-heavy real-world imagery — a real photo (stock/upload), never AI-fabricated.
    case 'gallery': return { aiAllowed: false, manualRequired: true, risk: 'high', orientation: 'landscape' };
    case 'showcase': return { aiAllowed: false, manualRequired: true, risk: 'high', orientation: 'landscape' };
    case 'product': return { aiAllowed: false, manualRequired: true, risk: 'high', orientation: 'square' };
    default: return { aiAllowed: true, manualRequired: false, risk: 'low', orientation: 'landscape' };
  }
}

/** A concise, honest search query seed for a purpose from the site's own identity. */
function seedQuery(spec: FrontendBuildSpecification, purpose: ImageCoveragePurpose, hint?: string): string {
  const id = spec.identity || ({} as FrontendBuildSpecification['identity']);
  const subject = clip(id.subsector || id.sector || id.primaryConcept || id.siteType, 48);
  const h = clip(hint, 48);
  const purposeWord = purpose === 'hero' || purpose === 'section' ? '' : purpose;
  return clip([subject, h, purposeWord].filter(Boolean).join(' '), MAX_QUERY) || 'modern professional';
}

function targetAliases(spec: FrontendBuildSpecification, purpose: ImageCoveragePurpose, extra: string[]): string[] {
  const id = spec.identity || ({} as FrontendBuildSpecification['identity']);
  const base = [purpose, ...toks(id.subsector), ...toks(id.sector), ...toks(id.primaryConcept), ...extra.flatMap(toks)];
  return uniq(base.filter((t) => t.length >= 3)).slice(0, MAX_ALIASES);
}

/** Binding media requirements (Phase 12G) that ask for explicit imagery. */
function bindingMediaTargets(binding: FrontendBindingRequirements | undefined): Array<{ label: string; aliases: string[] }> {
  if (!binding || !Array.isArray(binding.requirements)) return [];
  return binding.requirements
    .filter((r) => r.kind === 'media' && r.required)
    .map((r) => ({ label: clip(r.label, 80), aliases: uniq([...toks(r.label), ...(r.aliases || []).flatMap(toks)]).slice(0, MAX_ALIASES) }))
    .filter((t) => !!t.label)
    .slice(0, MAX_COVERAGE_TARGETS);
}

/**
 * Derive the authoritative image-coverage requirement for a FRESH build. Pure; never throws for
 * a caller that wraps it, but is written defensively regardless. Absent/old spec ⇒ a permissive
 * `optional` contract that changes nothing.
 */
export function deriveImageCoverageRequirement(spec: FrontendBuildSpecification | undefined): ImageCoverageRequirement {
  const reasons: ImageCoverageReasonCode[] = [];
  const base: ImageCoverageRequirement = {
    version: 'image-coverage-v1', mode: 'optional', minRequired: 0, heroRequired: false,
    stockAllowed: true, stockPreferred: true, aiAllowed: false, manualRequired: false,
    explicitNoPhoto: false, targets: [], reasons,
  };
  if (!spec || !spec.identity) return base;

  const id = spec.identity;
  const ds = spec.designSystem || ({} as FrontendBuildSpecification['designSystem']);
  const promptText = `${spec.prompt || ''}`;
  const sector = (id.sector || '') as string;

  // ── PRECEDENCE 1 — explicit "no photography" wins outright. ──
  const explicitNoPhoto = NOPHOTO_RE.test(promptText);
  if (explicitNoPhoto) {
    pushReason(reasons, 'explicit-no-photo');
    return { ...base, mode: 'none', explicitNoPhoto: true, reasons };
  }

  // ── PRECEDENCE 2 — explicit binding media requirements (Phase 12G). ──
  const mediaTargets = bindingMediaTargets(spec.bindingRequirements);

  // ── PRECEDENCE 3/4 — sector & image-led design direction (generic, not travel-hardcoded). ──
  const directionText = `${ds.selectedVisualDirection || ''} ${ds.visualSignature || ''} ${ds.heroComposition || ''} ${ds.designThesis || ''} ${spec.assets?.strategy || ''} ${spec.assets?.visualLanguage || ''}`;
  const imageLedDirection = IMAGE_LED_DIRECTION_RE.test(directionText) || IMAGE_LED_DIRECTION_RE.test(promptText);
  const imageLedSector = IMAGE_LED_SECTORS.has(sector);
  const softwareSector = SOFTWARE_SECTORS.has(sector);

  // Resolve mode from the strongest applicable authority.
  let mode: ImageCoverageMode = 'optional';
  if (mediaTargets.length > 0) mode = 'required';
  if (imageLedSector || imageLedDirection) mode = 'image-led';
  // Software/product concepts prefer UI mockups; do NOT force stock unless media was explicit.
  if (softwareSector && mediaTargets.length === 0 && !imageLedDirection) mode = 'optional';

  if (mode === 'optional' || mode === 'none') {
    return { ...base, mode, reasons };
  }

  // ── Build bounded targets (hero first, then explicit media, then a bounded section target). ──
  const targets: ImageCoverageTarget[] = [];
  const heroRequired = true; // required/image-led builds must carry a real hero image
  const seen = new Set<string>();
  const addTarget = (purpose: ImageCoveragePurpose, label: string, aliases: string[], required: boolean, hero: boolean, sectionId?: string, hint?: string) => {
    if (targets.length >= MAX_COVERAGE_TARGETS) return;
    const key = `${purpose}:${sectionId || ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    const prof = purposeProfile(purpose);
    targets.push({
      id: `korvix-coverage-${purpose}${sectionId ? `-${clip(sectionId, 24).replace(/[^a-z0-9]+/gi, '-')}` : ''}`.toLowerCase(),
      purpose, label: clip(label, 80) || purpose,
      aliases: uniq([...aliases, ...targetAliases(spec, purpose, [hint || ''])]).slice(0, MAX_ALIASES),
      required, hero, sectionId,
      orientation: hero ? 'landscape' : prof.orientation,
      query: seedQuery(spec, purpose, hint || label),
      altText: clip(`${label || purpose} photography for a ${clip(id.subsector || id.sector || id.siteType, 40) || 'brand'} website`, MAX_ALT),
      stockAllowed: true, aiAllowed: prof.aiAllowed, manualRequired: prof.manualRequired, authenticityRisk: prof.risk,
      matchStatus: 'pending',
    });
  };

  // Hero (always, for required/image-led).
  addTarget('hero', 'Hero photography', targetAliases(spec, 'hero', []), true, true, 'hero');

  // Explicit binding-media targets become required editorial/section imagery.
  for (const mt of mediaTargets) {
    addTarget('editorial', mt.label, mt.aliases, true, false, undefined, mt.label);
  }

  // One bounded section/editorial target for image-led sites (destination/showcase storytelling),
  // derived from a real required section name where available.
  if (mode === 'image-led' && targets.length < MAX_REQUIRED_COVERAGE) {
    const section = (spec.architecture?.sections || []).map((s) => clip(s.name, 40)).find(Boolean);
    addTarget('section', section || 'Featured editorial', section ? toks(section) : [], targets.length < 2, false, section || 'featured', section);
  }

  const requiredTargets = targets.filter((t) => t.required);
  const minRequired = Math.min(MAX_REQUIRED_COVERAGE, Math.max(heroRequired ? 1 : 0, requiredTargets.length));
  const aiAllowed = targets.some((t) => t.aiAllowed);
  const manualRequired = targets.some((t) => t.manualRequired && t.required);

  return {
    version: 'image-coverage-v1', mode, minRequired, heroRequired,
    stockAllowed: true, stockPreferred: true, aiAllowed, manualRequired,
    explicitNoPhoto: false, targets: targets.slice(0, MAX_COVERAGE_TARGETS), reasons,
  };
}

/* ── Deterministic slot synthesis + spec-slot matching (fresh generation only) ── */

const HERO_KINDS = new Set(['hero-image', 'hero-background']);
const PHOTO_KINDS = new Set([
  'hero-image', 'hero-background', 'project-photo', 'portfolio-work-image', 'gallery-photo',
  'before-after-pair', 'food-photo', 'product-listing-image', 'catalog-cover', 'restaurant-space',
  'team-or-studio-photo', 'archive-scan',
]);

/** Find an existing, unused, photographic spec slot suitable for a coverage target. */
export function findSpecSlotForTarget(
  spec: FrontendBuildSpecification, target: ImageCoverageTarget, used: Set<string>,
): FrontendSpecImageSlot | undefined {
  const slots = spec?.assets?.imageSlots || [];
  const wantHero = target.hero;
  // Pass 1: exact hero/kind alignment.
  for (const s of slots) {
    if (!s.id || used.has(s.id) || s.source === 'css-placeholder') continue;
    if (wantHero && HERO_KINDS.has(s.kind)) return s;
    if (!wantHero && PHOTO_KINDS.has(s.kind) && !HERO_KINDS.has(s.kind)) return s;
  }
  // Pass 2: any unused photographic slot.
  for (const s of slots) {
    if (!s.id || used.has(s.id) || s.source === 'css-placeholder') continue;
    if (PHOTO_KINDS.has(s.kind)) return s;
  }
  return undefined;
}

/** Deterministically synthesize the MINIMUM missing spec image slot for a required target. */
export function synthesizeSlotForTarget(spec: FrontendBuildSpecification, target: ImageCoverageTarget): FrontendSpecImageSlot {
  const kind = target.hero ? 'hero-image' : (target.aiAllowed ? 'hero-background' : 'gallery-photo');
  return {
    id: target.id,
    target: `section:${clip(target.sectionId || target.purpose, 40)}`,
    kind,
    source: target.manualRequired ? 'manual-upload' : 'provider-ready',
    purpose: target.purpose,
    prompt: target.query,
    placeholderLabel: target.altText,
    manualUploadRecommended: target.manualRequired,
    providerReady: !target.manualRequired,
  };
}

/* ── Strategy diagnosis (why a valid strategy left the required floor uncovered) ── */
export function diagnoseStrategyForCoverage(
  strategy: VisualStrategy | null | undefined,
  spec: FrontendBuildSpecification,
  coverage: ImageCoverageRequirement,
): ImageCoverageReasonCode[] {
  const out: ImageCoverageReasonCode[] = [];
  if (!strategy) return out;
  const photo = photographicSlots(strategy);
  if (strategy.photographyMode === 'none') {
    // An explicit binding-media requirement outranks an accidental strategy `none`.
    pushReason(out, coverage.targets.some((t) => t.purpose === 'editorial')
      ? 'strategy-none-overridden-by-binding-media' : 'strategy-zero-photo-slots');
    return out;
  }
  if (photo.length === 0) { pushReason(out, 'strategy-zero-photo-slots'); return out; }
  const specSlotIds = new Set((spec?.assets?.imageSlots || []).map((s) => s.id).filter(Boolean));
  const mapped = photo.filter((s) => specSlotIds.has(s.slotId));
  if (mapped.length === 0) { pushReason(out, 'strategy-slot-id-mismatch'); return out; }
  if (mapped.every((s) => !s.query || s.query.trim().length < 3)) pushReason(out, 'strategy-invalid-query');
  return out;
}

/* ── AI fallback persistence classifier + bounded planner ──────────────────── */

/**
 * Whether an AI image from `provider` can be DURABLY persisted/rendered as a normal remote asset.
 * openai/stability return a session-only base64 data URL → NOT persistable (must never be injected
 * into generated source). `custom` cannot be guaranteed to return a hosted HTTPS URL without a
 * live call, so it is treated conservatively as non-persistable in the automatic path.
 */
export function aiProviderPersistable(provider: string | undefined): boolean {
  const p = (provider || '').trim().toLowerCase();
  // No known provider yields a durable hosted URL in the automatic, no-call path today.
  void p;
  return false;
}

export interface AiFallbackContext {
  provider: string;
  enabled: boolean;
  authorized: boolean;
}
export type AiFallbackOutcome =
  | 'ai-usable' | 'not-persistable' | 'unsafe-slot' | 'not-authorized' | 'over-ceiling';
export interface AiFallbackDecision {
  targetId: string;
  hero: boolean;
  outcome: AiFallbackOutcome;
  reason: ImageCoverageReasonCode;
}
export interface AiFallbackPlan {
  decisions: AiFallbackDecision[];
  attempts: number;      // eligible attempts that consumed a ceiling slot
  usable: number;        // attempts that produced a persistable, renderable asset
  reasons: ImageCoverageReasonCode[];
}

/**
 * Decide AI fallback for the required targets stock left uncovered. Stock-first: only uncovered
 * required targets are considered. Bounded to MAX_AI_FALLBACK_ATTEMPTS, hero prioritized first,
 * proof-heavy/manual slots refused (unsafe), disabled/unauthorized refused, and every eligible
 * attempt classified by persistence. NEVER performs a provider call and NEVER returns a data URL.
 */
export function planAiFallback(uncoveredRequired: ImageCoverageTarget[], ctx: AiFallbackContext): AiFallbackPlan {
  const reasons: ImageCoverageReasonCode[] = [];
  const decisions: AiFallbackDecision[] = [];
  // Hero first, then remaining required targets in order.
  const ordered = [...uncoveredRequired].sort((a, b) => (a.hero === b.hero ? 0 : a.hero ? -1 : 1));
  let attempts = 0;
  let usable = 0;
  for (const t of ordered) {
    // Proof-heavy or manual-upload slots are never AI-fabricated.
    if (!t.aiAllowed || t.manualRequired) {
      decisions.push({ targetId: t.id, hero: t.hero, outcome: 'unsafe-slot', reason: 'ai-fallback-unsafe-slot' });
      pushReason(reasons, 'ai-fallback-unsafe-slot');
      continue;
    }
    if (attempts >= MAX_AI_FALLBACK_ATTEMPTS) {
      decisions.push({ targetId: t.id, hero: t.hero, outcome: 'over-ceiling', reason: 'required-image-uncovered' });
      continue;
    }
    attempts += 1; // this target consumes one bounded attempt slot
    if (!ctx.enabled || !ctx.authorized) {
      decisions.push({ targetId: t.id, hero: t.hero, outcome: 'not-authorized', reason: 'ai-fallback-not-authorized' });
      pushReason(reasons, 'ai-fallback-not-authorized');
      continue;
    }
    if (!aiProviderPersistable(ctx.provider)) {
      decisions.push({ targetId: t.id, hero: t.hero, outcome: 'not-persistable', reason: 'ai-fallback-not-persistable' });
      pushReason(reasons, 'ai-fallback-not-persistable');
      continue;
    }
    // A persistable provider (hypothetical hosted-URL contract) — usable; the actual generation
    // call is performed by the caller in that configuration. Not reachable for openai/stability.
    decisions.push({ targetId: t.id, hero: t.hero, outcome: 'ai-usable', reason: 'required-image-uncovered' });
    usable += 1;
  }
  return { decisions, attempts, usable, reasons };
}

/* ── Diagnostics assembly (bounded, no secrets/URLs/prompts) ───────────────── */
export interface ImageCoverageDiagnostics {
  coverageMode: ImageCoverageMode;
  requiredSemanticImageCount: number;
  stockRequestedCount: number;
  stockSourcedCount: number;
  automaticAiFallbackAttemptCount: number;
  automaticAiFallbackUsableCount: number;
  uncoveredRequiredImageCount: number;
  deterministicCoverageFallbackUsed: boolean;
  visualStrategyPhotographyMode: string;
  visualStrategyPhotoSlotCount: number;
  pexelsStatus: string;
  unsplashStatus: string;
  imageAssetManifestStatus: string;
  reasonCodes: ImageCoverageReasonCode[];
}

export function buildImageCoverageDiagnostics(input: {
  coverage: ImageCoverageRequirement;
  strategy?: VisualStrategy | null;
  stockRequested: number;
  stockSourced: number;
  aiPlan?: AiFallbackPlan;
  uncoveredRequired: number;
  fallbackUsed: boolean;
  manifestStatus: string;
  providers: { pexels?: string; unsplash?: string };
  reasons: ImageCoverageReasonCode[];
}): ImageCoverageDiagnostics {
  const strat = input.strategy || null;
  return {
    coverageMode: input.coverage.mode,
    requiredSemanticImageCount: input.coverage.targets.filter((t) => t.required).length,
    stockRequestedCount: input.stockRequested,
    stockSourcedCount: input.stockSourced,
    automaticAiFallbackAttemptCount: input.aiPlan?.attempts || 0,
    automaticAiFallbackUsableCount: input.aiPlan?.usable || 0,
    uncoveredRequiredImageCount: input.uncoveredRequired,
    deterministicCoverageFallbackUsed: input.fallbackUsed,
    visualStrategyPhotographyMode: strat?.photographyMode || 'none',
    visualStrategyPhotoSlotCount: photographicSlots(strat).length,
    pexelsStatus: input.providers.pexels || 'unknown',
    unsplashStatus: input.providers.unsplash || 'unknown',
    imageAssetManifestStatus: input.manifestStatus || 'unknown',
    reasonCodes: uniq(input.reasons).slice(0, 16),
  };
}
