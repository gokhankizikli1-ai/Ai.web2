/**
 * Web Build — generation-time stock image SOURCING (Phase 14K.4).
 *
 * Turns the deterministic image-slot plan of a NEW build into a manifest of REAL,
 * license-cleared stock photographs, so the first generated version is visually
 * complete (real <img>/background photos) instead of illustration placeholders.
 *
 * Flow (runs once, async, BEFORE the frontend-builder model call):
 *   1. deriveImageNeeds(spec)      → a small, capped, sanitized image-needs plan
 *   2. POST /v2/web-build/images/stock/source (existing backend + PR #465 provider
 *      abstraction) → normalized asset manifest (keys stay server-side)
 *   3. enrichSpecWithSourcedImages → real URLs + stable data-korvix ids onto the
 *      spec's image slots so the coding model receives approved assets
 *   4. attach the persisted attribution manifest to the build artifacts
 *
 * Everything here is FAIL-OPEN: any failure returns the build unchanged so website
 * generation always completes (typography-first where no photo could be sourced).
 * The browser never sees a provider key and never talks to a provider directly.
 */
import type { WebBuildPayload } from '@/lib/webBuildPayload';
import type {
  FrontendBuildSpecification, FrontendSpecImageSlot, SourcedImageAsset, ImageAssetManifest,
} from '@/lib/webBuildAgents';
import { photographicSlots, type VisualStrategy, type VisualSlotPurpose } from '@/lib/webBuildVisualStrategy';
import type { ImageRoleDirection } from '@/lib/webBuildVisualConcept';
import {
  findSpecSlotForTarget, synthesizeSlotForTarget, diagnoseStrategyForCoverage,
  planAiFallback, buildImageCoverageDiagnostics,
  type ImageCoverageRequirement, type ImageCoverageTarget, type ImageCoveragePurpose,
  type ImageCoverageReasonCode, type ImageCoverageDiagnostics, type AiFallbackContext,
} from '@/lib/webBuildImageCoverage';
// The ONE routing authority: stock / generated / none per slot (WEB only; undefined for an app
// build, which is what structurally keeps the generated route out of App Build).
import {
  deriveImageSourceStrategyForSpec, decisionForSlot, resolveImageRoleForSlot,
  buildImageSourceStrategyDiagnostics,
  type ImageSourceStrategyContract, type ImageSourceDecision,
} from '@/lib/webBuildImageSourceStrategy';
import {
  runGeneratedImagery, type GeneratedImageryDiagnostics,
} from '@/lib/webBuildGeneratedImagery';

const BUNDLED_BACKEND = 'https://worker-production-1345.up.railway.app';
export const MAX_SOURCED_IMAGES = 8;

function apiBase(): string {
  const envBase = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
  return envBase ? envBase.replace(/\/+$/, '') : BUNDLED_BACKEND;
}

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    const tok = localStorage.getItem('korvix_access_token');
    if (tok) h['Authorization'] = `Bearer ${tok}`;
    const owner = localStorage.getItem('korvix_owner_token');
    if (owner) h['X-Korvix-Owner-Token'] = owner;
  } catch { /* localStorage may be disabled */ }
  return h;
}

export type ImagePurpose =
  | 'hero' | 'gallery' | 'project' | 'about' | 'team' | 'product' | 'background' | 'other';
export type ImageOrientation = 'landscape' | 'portrait' | 'square';

export interface ImageNeed {
  slotId: string;
  purpose: ImagePurpose;
  query: string;
  orientation: ImageOrientation;
  required: boolean;
  altText: string;
  /* ── Phase (image intelligence) — bounded, sanitized art-direction + a small query plan, extracted from
   *    the ALREADY-derived visualConcept image roles. All optional & additive: forwarded inside each need
   *    to the SAME backend endpoint (which ignores unknown fields), so old clients/backends keep working
   *    and the smart-image layer gets richer, role-appropriate search signal. Never carries hex colours,
   *    marketing copy, private research or secrets. ── */
  role?: string;
  subject?: string;
  people?: 'required' | 'optional' | 'avoid';
  framing?: string;
  lighting?: string;
  tone?: string;
  authenticity?: 'authentic-photo-required' | 'illustrative-ok' | 'generatable';
  aspectRatio?: string;
  focalPoint?: string;
  negativeSpace?: boolean;
  loadingPriority?: 'eager' | 'lazy';
  noRepeat?: boolean;
  /** A tightly-bounded query plan (primary + up to 3 role-aware variations + a safe fallback). */
  queryVariants?: string[];
}

/* ── Query intelligence — sanitation + a bounded, role-aware query plan ──────────
 * We NEVER dump every field into one long string. We compose a concrete primary query
 * (subject → action/environment → role framing → orientation wording) plus a few bounded
 * variations, all sanitized (no hex, urls, marketing copy, secrets, fake identities). */
const HEX_TOKEN = /#[0-9a-fA-F]{3,8}\b/g;
const URL_TOKEN = /\bhttps?:\/\/\S+/gi;
const NOISE_TOKEN = /[<>{}[\]|]+/g;
const MARKETING = /\b(revolutioni[sz]e|cutting[- ]edge|world[- ]class|best[- ]in[- ]class|next[- ]gen(?:eration)?|unlock|empower|seamless(?:ly)?|leverage|synerg\w*|game[- ]chang\w*|disrupt\w*)\b/gi;
export function sanitizeImageQuery(s: string | undefined, max = 140): string {
  return (s || '')
    .replace(URL_TOKEN, ' ').replace(HEX_TOKEN, ' ').replace(NOISE_TOKEN, ' ').replace(MARKETING, ' ')
    .replace(/[^\p{L}\p{N}\s,'-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
const ORIENTATION_WORD: Record<ImageOrientation, string> = {
  landscape: 'wide horizontal composition', portrait: 'vertical composition', square: 'square composition',
};
/** Role/purpose-specific framing wording (Phase 3) — different search behaviour per image role. */
function roleFraming(purpose: ImagePurpose, people: ImageNeed['people'], negativeSpace: boolean): string {
  switch (purpose) {
    case 'hero': case 'background': return `strong single subject, clear focal point${negativeSpace ? ', generous negative space for overlaid text' : ''}`;
    case 'team': return people === 'avoid' ? 'workspace detail, no faces' : 'authentic candid people at work, natural expressions, no staged handshake';
    case 'about': return 'believable real environment, natural light, sense of place';
    case 'product': return 'product shown in meaningful context, clean composition';
    case 'gallery': case 'project': return 'well-composed detail, material and texture, consistent styling';
    default: return 'well-composed, authentic';
  }
}
function peopleWord(people: ImageNeed['people']): string {
  return people === 'required' ? 'featuring real people' : people === 'avoid' ? 'no people' : '';
}

interface SourceResponse {
  status: string;
  assets: SourcedImageAsset[];
  providers?: { pexels?: string; unsplash?: string };
  warnings?: string[];
  requested?: number;
  sourced?: number;
  elapsedMs?: number;
}

/* ── Which image slots deserve a REAL photo, and how to search for one ─────────
 * Only genuinely photographic kinds map here; abstract/illustrative/ambient slots
 * are intentionally absent so they stay CSS/SVG/typography (a tasteful non-image
 * layout), never a fake photo. */
const KIND_PLAN: Record<string, { purpose: ImagePurpose; orientation: ImageOrientation; priority: number }> = {
  'hero-image': { purpose: 'hero', orientation: 'landscape', priority: 0 },
  'hero-background': { purpose: 'background', orientation: 'landscape', priority: 1 },
  'project-photo': { purpose: 'project', orientation: 'landscape', priority: 2 },
  'portfolio-work-image': { purpose: 'project', orientation: 'landscape', priority: 2 },
  'gallery-photo': { purpose: 'gallery', orientation: 'landscape', priority: 2 },
  'before-after-pair': { purpose: 'project', orientation: 'landscape', priority: 3 },
  'food-photo': { purpose: 'gallery', orientation: 'square', priority: 2 },
  'product-listing-image': { purpose: 'product', orientation: 'square', priority: 2 },
  'catalog-cover': { purpose: 'product', orientation: 'portrait', priority: 3 },
  'restaurant-space': { purpose: 'about', orientation: 'landscape', priority: 3 },
  'team-or-studio-photo': { purpose: 'team', orientation: 'square', priority: 3 },
  'archive-scan': { purpose: 'other', orientation: 'portrait', priority: 4 },
};

/** Conservative per-purpose caps (total is still bounded by MAX_SOURCED_IMAGES). */
const PURPOSE_CAP: Record<ImagePurpose, number> = {
  hero: 1, background: 1, about: 1, team: 2, product: 6, gallery: 6, project: 6, other: 2,
};

function clean(s: string | undefined, max = 120): string {
  return (s || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** A short visual query from the slot's own art description, else a sector seed. */
function slotQuery(slot: FrontendSpecImageSlot, spec: FrontendBuildSpecification, purpose: ImagePurpose): string {
  const fromPrompt = clean(slot.prompt);
  if (fromPrompt.length >= 6) return fromPrompt;
  const id = spec.identity || {};
  const seed = clean(id.subsector || id.sector || id.siteType || '', 40);
  const purposeWord = purpose === 'hero' || purpose === 'background' ? '' : purpose;
  return clean(`${seed} ${purposeWord}`.trim()) || 'modern professional';
}

function slotAlt(slot: FrontendSpecImageSlot, spec: FrontendBuildSpecification, purpose: ImagePurpose): string {
  const label = clean(slot.placeholderLabel, 120);
  if (label) return label;
  const id = spec.identity || {};
  const subject = clean(id.subsector || id.sector || id.siteType || 'business', 40);
  return clean(`${purpose} photograph for a ${subject} website`, 200);
}

/** Find the already-derived visualConcept image-role art direction for a need. The resolver (and
 *  its purpose→role map) lives in the image-source-strategy module, so routing and sourcing read
 *  art direction through exactly ONE lookup instead of two copies that could drift. */
function artRoleForNeed(spec: FrontendBuildSpecification, slotId: string, purpose: ImagePurpose): ImageRoleDirection | undefined {
  return resolveImageRoleForSlot(spec.visualConcept, slotId, purpose);
}
/** Compose a bounded, sanitized query plan: a concrete primary query + up to 3 role-aware variations. */
function buildQueryPlan(seed: string, art: ImageRoleDirection | undefined, purpose: ImagePurpose, orientation: ImageOrientation): { query: string; variants: string[] } {
  const subject = sanitizeImageQuery(art?.subject, 80) || sanitizeImageQuery(seed, 80);
  if (!subject) return { query: sanitizeImageQuery(seed, 140), variants: [] };
  const people = art?.peoplePresent;
  const negSpace = purpose === 'hero' || purpose === 'background';
  const framing = roleFraming(purpose, people, negSpace);
  const orient = ORIENTATION_WORD[orientation];
  const ppl = peopleWord(people);
  const lighting = sanitizeImageQuery(art?.lighting, 40);
  const tone = sanitizeImageQuery(art?.tone, 40);
  const primary = sanitizeImageQuery([subject, ppl, framing, lighting, orient].filter(Boolean).join(', '), 160);
  const variants = [...new Set([
    primary,
    sanitizeImageQuery([subject, framing, orient].filter(Boolean).join(', '), 140),            // composition variation
    sanitizeImageQuery([subject, tone || 'authentic, natural', ppl].filter(Boolean).join(', '), 140), // authenticity/lifestyle
    subject,                                                                                    // safe fallback
  ].filter(Boolean))].slice(0, 4);
  return { query: primary || subject, variants };
}
/** Attach the bounded art-direction + query plan to a need. Idempotent-safe; pure.
 *  The descriptive primary query REPLACES the seed only when real art direction exists (a concrete,
 *  intentional subject) — so builds without visualConcept keep their proven terse keyword query and cannot
 *  regress their result rate. Variants are always computed for client diagnostics/refinement. */
function enrichNeedWithArt(need: ImageNeed, spec: FrontendBuildSpecification): ImageNeed {
  const art = artRoleForNeed(spec, need.slotId, need.purpose);
  const plan = buildQueryPlan(need.query, art, need.purpose, need.orientation);
  return {
    ...need,
    query: art ? (plan.query || need.query) : need.query,
    queryVariants: plan.variants.length ? plan.variants : undefined,
    role: art?.role,
    subject: sanitizeImageQuery(art?.subject, 80) || undefined,
    people: art?.peoplePresent,
    framing: sanitizeImageQuery(roleFraming(need.purpose, art?.peoplePresent, need.purpose === 'hero' || need.purpose === 'background'), 80) || undefined,
    lighting: sanitizeImageQuery(art?.lighting, 60) || undefined,
    tone: sanitizeImageQuery(art?.tone, 60) || undefined,
    authenticity: art?.authenticity,
    aspectRatio: art?.aspectRatio,
    focalPoint: sanitizeImageQuery(art?.focalPoint, 60) || undefined,
    negativeSpace: need.purpose === 'hero' || need.purpose === 'background',
    loadingPriority: art?.loadingPriority || (need.purpose === 'hero' ? 'eager' : 'lazy'),
    noRepeat: art?.noRepeat ?? true,
  };
}

/** Map a Visual-Strategy purpose onto the sourcing purpose (broader → known). */
function toImagePurpose(p: VisualSlotPurpose): ImagePurpose {
  switch (p) {
    case 'hero': case 'gallery': case 'project': case 'about':
    case 'team': case 'product': case 'background': return p;
    default: return 'other';
  }
}

/**
 * Build the capped, sanitized image-needs plan. Pure.
 *
 * When a VALID Visual Strategy is supplied (Phase 14K.7) it takes PRECEDENCE:
 * only its `mediaType: 'photograph'` slots (already sanitized + hard-capped) whose
 * slotId maps to a real spec image slot are sourced — so an explicit "no photos"
 * / typography-first plan yields ZERO photos (respected), never the deterministic
 * fallback. When no strategy is supplied (agent fell back), the original
 * deterministic kind-based derivation runs.
 */
export function deriveImageNeeds(spec: FrontendBuildSpecification, strategy?: VisualStrategy | null): ImageNeed[] {
  if (strategy) {
    const specSlotIds = new Set((spec?.assets?.imageSlots || []).map((s) => s.id).filter(Boolean));
    return photographicSlots(strategy)
      .filter((s) => specSlotIds.has(s.slotId))
      .slice(0, MAX_SOURCED_IMAGES)
      .map((s) => ({
        slotId: s.slotId,
        purpose: toImagePurpose(s.purpose),
        query: (s.query || '').slice(0, 120),
        orientation: s.orientation,
        required: s.required,
        altText: (s.altText || '').slice(0, 200),
      }))
      .filter((n) => !!n.query)
      .map((n) => enrichNeedWithArt(n, spec));   // art-direction-aware query plan (fail-open, additive)
  }

  const slots = spec?.assets?.imageSlots || [];
  const candidates = slots
    .map((slot) => ({ slot, plan: KIND_PLAN[slot.kind] }))
    .filter((c): c is { slot: FrontendSpecImageSlot; plan: { purpose: ImagePurpose; orientation: ImageOrientation; priority: number } } =>
      // css-placeholder slots are decorative — never a sourced photo.
      !!c.plan && !!c.slot.id && c.slot.source !== 'css-placeholder')
    .sort((a, b) => a.plan.priority - b.plan.priority);

  const perPurpose: Record<string, number> = {};
  const needs: ImageNeed[] = [];
  for (const { slot, plan } of candidates) {
    if (needs.length >= MAX_SOURCED_IMAGES) break;
    const used = perPurpose[plan.purpose] || 0;
    if (used >= PURPOSE_CAP[plan.purpose]) continue;
    const query = slotQuery(slot, spec, plan.purpose);
    if (!query) continue;
    perPurpose[plan.purpose] = used + 1;
    needs.push(enrichNeedWithArt({
      slotId: slot.id,
      purpose: plan.purpose,
      query,
      orientation: plan.orientation,
      required: plan.purpose === 'hero',
      altText: slotAlt(slot, spec, plan.purpose),
    }, spec));
  }
  return needs;
}

/**
 * OPTIONAL design brief forwarded to the backend Image Intelligence layer
 * (ENABLE_SMART_IMAGES). Every field is optional; when the flag is off it is ignored,
 * so this is safe to always send. Derived purely from the already-planned spec —
 * no new signal, no extra model calls. Fully sanitized (HTML-stripped, clipped).
 */
export interface DesignContext {
  industry?: string;
  targetAudience?: string;
  brandStyle?: string;
  emotionalTone?: string;
  colorPalette?: string[];
  imageStyle?: string;
  requiredSections?: string[];
  conversionGoal?: string;
}

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Pull up to `max` distinct hex swatches out of the design system's color tokens. */
function paletteFromTokens(tokens: Record<string, string> | undefined, max = 6): string[] {
  if (!tokens) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of Object.values(tokens)) {
    const hex = (value || '').trim().toLowerCase();
    if (HEX_COLOR.test(hex) && !seen.has(hex)) {
      seen.add(hex);
      out.push(hex);
      if (out.length >= max) break;
    }
  }
  return out;
}

/** Build the (optional) design context from the spec. Never throws; returns `undefined`
 *  when there is no meaningful signal so the request body stays lean. */
export function buildDesignContext(spec: FrontendBuildSpecification | undefined): DesignContext | undefined {
  try {
    if (!spec) return undefined;
    const id = spec.identity || ({} as FrontendBuildSpecification['identity']);
    const ds = spec.designSystem || ({} as FrontendBuildSpecification['designSystem']);
    const sections = (spec.architecture?.sections || [])
      .map((s) => clean(s.name, 60)).filter(Boolean).slice(0, 20);
    const ctx: DesignContext = {
      industry: clean(id.subsector || id.sector || id.siteType, 120) || undefined,
      targetAudience: clean(id.audienceSector, 120) || undefined,
      brandStyle: clean(ds.selectedVisualDirection || ds.designThesis, 120) || undefined,
      emotionalTone: clean(ds.firstImpression, 120) || undefined,
      colorPalette: paletteFromTokens(ds.colorTokens),
      imageStyle: clean(ds.visualSignature || ds.visualMetaphor, 120) || undefined,
      requiredSections: sections,
      conversionGoal: clean(id.primaryConversionIntent, 120) || undefined,
    };
    const hasSignal = Object.values(ctx).some((v) => (Array.isArray(v) ? v.length > 0 : !!v));
    return hasSignal ? ctx : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Build the EXACT batched `/stock/source` request body — ONE POST carrying every need. Pure + exported
 * so the wire projection is directly testable. Wires the known-good need shape plus the OPTIONAL,
 * bounded queryVariants AND the already-sanitized per-slot art direction (Phase 1). Every art field is
 * optional + short and is only included when present, so old backends simply ignore unknown keys (no
 * request can be rejected) and old clients that omit them behave exactly as before. Sends ONLY these
 * bounded per-slot fields — never the visualConcept object, the raw user prompt, hex colours or research.
 */
export function buildStockSourceRequestBody(
  needs: ImageNeed[], context?: DesignContext,
): { needs: Array<Record<string, unknown>>; maxImages: number; context?: DesignContext } {
  const wireNeeds = needs.map((n) => ({
    slotId: n.slotId, purpose: n.purpose, query: n.query, orientation: n.orientation,
    required: n.required, altText: n.altText,
    ...(n.queryVariants && n.queryVariants.length ? { queryVariants: n.queryVariants.slice(0, 3) } : {}),
    ...(n.role ? { role: n.role.slice(0, 80) } : {}),
    ...(n.subject ? { subject: n.subject.slice(0, 120) } : {}),
    ...(n.people ? { people: n.people } : {}),
    ...(n.framing ? { framing: n.framing.slice(0, 80) } : {}),
    ...(n.lighting ? { lighting: n.lighting.slice(0, 60) } : {}),
    ...(n.tone ? { tone: n.tone.slice(0, 60) } : {}),
    ...(n.authenticity ? { authenticity: n.authenticity } : {}),
    ...(n.aspectRatio ? { aspectRatio: n.aspectRatio.slice(0, 12) } : {}),
    ...(n.focalPoint ? { focalPoint: n.focalPoint.slice(0, 60) } : {}),
    ...(typeof n.negativeSpace === 'boolean' ? { negativeSpace: n.negativeSpace } : {}),
    ...(n.loadingPriority ? { loadingPriority: n.loadingPriority } : {}),
    ...(typeof n.noRepeat === 'boolean' ? { noRepeat: n.noRepeat } : {}),
  }));
  return { needs: wireNeeds, maxImages: MAX_SOURCED_IMAGES, ...(context ? { context } : {}) };
}

/** POST the needs plan to the backend sourcing endpoint. Never throws. One batched request. */
async function fetchSourcedImages(
  needs: ImageNeed[], context?: DesignContext, opts?: { signal?: AbortSignal },
): Promise<SourceResponse | null> {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  opts?.signal?.addEventListener('abort', onAbort);
  const timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    const resp = await fetch(`${apiBase()}/v2/web-build/images/stock/source`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(buildStockSourceRequestBody(needs, context)),
      signal: ctrl.signal,
    });
    if (!resp.ok) return null;
    return (await resp.json()) as SourceResponse;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    opts?.signal?.removeEventListener('abort', onAbort);
  }
}

/* ── Client-side asset refinement (Phase 5/6) — the backend selects the candidate; here we conservatively
 *    reject only STRONGLY-evidenced junk and prevent the SAME asset from filling two distinct roles. We do
 *    NOT re-rank candidates (the backend owns selection) and never drop on subjective grounds. Dropping a
 *    slot's asset leaves it unsourced → the existing coverage/fallback path handles it truthfully. ── */
export interface ImageSourcingIntelligenceDiagnostics {
  version: 'image-intelligence-v1';
  needs: number;
  needsWithArtDirection: number;
  queryVariantsTotal: number;
  smartImageContextSent: boolean;
  designContextConsumed: boolean;
  candidatesReceived: number;
  keptAssets: number;
  malformedRejected: number;
  placeholderOrLogoRejected: number;
  exactUrlDuplicatesPrevented: number;
  normalizedUrlDuplicatesPrevented: number;
  providerIdDuplicatesPrevented: number;
  roleReuseDuplicatesPrevented: number;
  orientationMismatchNoted: number;
  lowResolutionNoted: number;
  providerDistribution: Record<string, number>;
  dominantColorMetadataAvailable: boolean;   // honest limitation: the endpoint returns none
  perceptualDedupAvailable: boolean;         // honest limitation: no embeddings/pHash client-side
  newProviderCalls: number;                  // always 0 — no extra calls added
  elapsedMs: number;
}
const PLACEHOLDER_URL = /placeholder|placehold\.co|via\.placeholder|dummyimage|example\.com\/(?:image|img)|1x1|spacer/i;
const LOGO_URL = /\blogo\b|\bicon\b|favicon|sprite|\.svg(?:$|\?)/i;
function isHttpUrl(u: string | undefined): boolean { return !!u && /^https?:\/\/[^\s]+$/i.test(u); }
/** Normalize a URL for dedup: drop the query string + trailing slash, lowercase host+path. */
function normalizeUrl(u: string): string { try { const q = u.split('?')[0].replace(/\/+$/, ''); return q.toLowerCase(); } catch { return u; } }
function providerKey(a: SourcedImageAsset): string { return a.provider && a.providerImageId ? `${a.provider}:${a.providerImageId}` : ''; }
function assetOrientation(a: SourcedImageAsset): ImageOrientation | null {
  const w = a.width || 0; const h = a.height || 0;
  if (!w || !h) return null;
  if (w >= h * 1.15) return 'landscape';
  if (h >= w * 1.15) return 'portrait';
  return 'square';
}
const HERO_MIN_WIDTH = 1200;
const NONHERO_MIN_WIDTH = 640;

export interface RefinedAssets { assets: SourcedImageAsset[]; diagnostics: Omit<ImageSourcingIntelligenceDiagnostics, 'version' | 'needs' | 'needsWithArtDirection' | 'queryVariantsTotal' | 'smartImageContextSent' | 'designContextConsumed' | 'providerDistribution' | 'dominantColorMetadataAvailable' | 'perceptualDedupAvailable' | 'newProviderCalls' | 'elapsedMs'> & { providerDistribution: Record<string, number> }; }

/** Deterministically filter + dedupe the backend-selected assets. Bounded, pure, fail-open. Needs are
 *  processed in order (required/hero first via caller ordering) so the first claimant of a duplicate wins. */
export function refineSourcedAssets(needs: ImageNeed[], assets: SourcedImageAsset[]): RefinedAssets {
  const needBySlot = new Map(needs.map((n) => [n.slotId, n]));
  const seenExact = new Set<string>();
  const seenNorm = new Set<string>();
  const seenProvider = new Set<string>();
  const kept: SourcedImageAsset[] = [];
  const d = {
    candidatesReceived: assets.length, keptAssets: 0, malformedRejected: 0, placeholderOrLogoRejected: 0,
    exactUrlDuplicatesPrevented: 0, normalizedUrlDuplicatesPrevented: 0, providerIdDuplicatesPrevented: 0,
    roleReuseDuplicatesPrevented: 0, orientationMismatchNoted: 0, lowResolutionNoted: 0,
    providerDistribution: {} as Record<string, number>,
  };
  try {
    // Process in need-priority order (required + hero first) so the most important slot claims a shared
    // asset; a lower-value slot loses the duplicate and falls through to coverage/fallback.
    const rank = (a: SourcedImageAsset): number => {
      const n = needBySlot.get(a?.slotId || '');
      return (n?.required ? 0 : 2) + (n?.purpose === 'hero' ? 0 : 1);
    };
    const ordered = [...assets].map((a, i) => ({ a, i })).sort((x, y) => (rank(x.a) - rank(y.a)) || (x.i - y.i)).map((x) => x.a);
    for (const a of ordered) {
      if (!a || !a.slotId) continue;
      const url = a.url || '';
      if (!isHttpUrl(url)) { d.malformedRejected += 1; continue; }
      if (PLACEHOLDER_URL.test(url) || LOGO_URL.test(url)) { d.placeholderOrLogoRejected += 1; continue; }
      const norm = normalizeUrl(url);
      const pk = providerKey(a);
      // Cross-slot dedup: the SAME asset must not fill two distinct roles (Phase 6, role-aware).
      if (seenExact.has(url)) { d.exactUrlDuplicatesPrevented += 1; d.roleReuseDuplicatesPrevented += 1; continue; }
      if (seenNorm.has(norm)) { d.normalizedUrlDuplicatesPrevented += 1; d.roleReuseDuplicatesPrevented += 1; continue; }
      if (pk && seenProvider.has(pk)) { d.providerIdDuplicatesPrevented += 1; d.roleReuseDuplicatesPrevented += 1; continue; }
      // Quality NOTES (never a drop — the builder can object-fit-crop; coverage owns the hard block).
      const need = needBySlot.get(a.slotId);
      const ori = assetOrientation(a);
      if (need && ori && need.orientation !== ori) d.orientationMismatchNoted += 1;
      const w = a.width || 0;
      if (w && ((need?.purpose === 'hero' && w < HERO_MIN_WIDTH) || (need && need.purpose !== 'hero' && w < NONHERO_MIN_WIDTH))) d.lowResolutionNoted += 1;
      seenExact.add(url); seenNorm.add(norm); if (pk) seenProvider.add(pk);
      if (a.provider) d.providerDistribution[a.provider] = (d.providerDistribution[a.provider] || 0) + 1;
      kept.push(a);
    }
  } catch { return { assets, diagnostics: { ...d, keptAssets: assets.length } }; }
  d.keptAssets = kept.length;
  return { assets: kept, diagnostics: d };
}

/** Stable, predictable Visual-Select id for a section's Nth sourced image. */
function sectionKeyOf(target: string): string {
  const t = (target || '').trim();
  if (!t || t === 'global') return 'section';
  const base = t.startsWith('section:') ? t.slice('section:'.length) : t;
  return base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'section';
}

/**
 * Attach sourced URLs + stable metadata to the spec's image slots, and stamp a
 * deterministic `domId` (data-korvix-id) on each sourced slot/asset. Pure — returns
 * a NEW spec and the assets enriched with their domId.
 */
export function enrichSpecWithSourcedImages(
  spec: FrontendBuildSpecification, assets: SourcedImageAsset[],
): { spec: FrontendBuildSpecification; assets: SourcedImageAsset[] } {
  const bySlot = new Map(assets.filter((a) => a && a.slotId && a.url).map((a) => [a.slotId, a]));
  const slots = spec?.assets?.imageSlots || [];
  const sectionCount: Record<string, number> = {};
  const domIdBySlot = new Map<string, string>();

  const nextSlots: FrontendSpecImageSlot[] = slots.map((slot) => {
    const asset = bySlot.get(slot.id);
    if (!asset) return slot;
    const key = sectionKeyOf(slot.target);
    const n = (sectionCount[key] = (sectionCount[key] || 0) + 1);
    const domId = n === 1 ? `home.${key}.image` : `home.${key}.image-${n}`;
    domIdBySlot.set(slot.id, domId);
    const generated = asset.source === 'generated';
    return {
      ...slot,
      url: asset.url,
      alt: asset.altText || slot.alt,
      // A generated visual has no stock provider/photographer — leaving those fields unset keeps
      // the attribution surface honest (nothing to attribute), and `imageSource` + `honestyLabel`
      // tell the builder and every downstream reader what this image actually is.
      ...(generated
        ? { imageSource: 'generated' as const, honestyLabel: asset.honestyLabel }
        : {
          imageSource: 'stock' as const,
          imageProvider: asset.provider,
          photographer: asset.photographerName,
          providerPageUrl: asset.providerPageUrl,
        }),
      domId,
    };
  });

  const nextAssets = assets.map((a) => (domIdBySlot.has(a.slotId) ? { ...a, domId: domIdBySlot.get(a.slotId) } : a));
  const nextSpec: FrontendBuildSpecification = {
    ...spec,
    assets: { ...spec.assets, imageSlots: nextSlots },
  };
  return { spec: nextSpec, assets: nextAssets };
}

/* ── Semantic image-coverage integration (Phase image coverage) ──────────────
 * When the authoritative coverage requirement is `required`/`image-led`, a valid Visual Strategy
 * that leaves the mandatory floor uncovered (accidental `none`, zero photo slots, unknown slot
 * ids, invalid queries) no longer yields zero photos: we deterministically fill ONLY the missing
 * mandatory coverage from the spec's own image slots (synthesizing the minimum missing slot when
 * none is suitable), while preserving the strategy's other needs. `none`/`optional`/explicit-no-
 * photo keep the exact existing behavior. Pure. */
function coveragePurposeToImagePurpose(p: ImageCoveragePurpose): ImagePurpose {
  switch (p) {
    case 'hero': return 'hero';
    case 'gallery': return 'gallery';
    case 'product': case 'showcase': return 'product';
    case 'about': return 'about';
    default: return 'other';
  }
}

function needFromSlotAndTarget(slot: FrontendSpecImageSlot, target: ImageCoverageTarget, spec: FrontendBuildSpecification): ImageNeed {
  const purpose = coveragePurposeToImagePurpose(target.purpose);
  const query = clean(target.query || slot.prompt || slotQuery(slot, spec, 'other'), 120);
  return enrichNeedWithArt({
    slotId: slot.id,
    purpose,
    query,
    orientation: target.orientation,
    required: true,
    altText: clean(target.altText || slot.placeholderLabel || '', 200) || slotAlt(slot, spec, 'other'),
  }, spec);
}

export interface CoverageAwareNeeds {
  needs: ImageNeed[];
  synthesizedSlots: FrontendSpecImageSlot[];
  reasons: ImageCoverageReasonCode[];
  fallbackUsed: boolean;
  targets: ImageCoverageTarget[];   // required-target state with slotId assigned (matchStatus 'pending')
}

/**
 * Build the coverage-aware image-needs plan. Pure. For `none`/`optional`/explicit-no-photo this is
 * exactly `deriveImageNeeds` (existing behavior). For `required`/`image-led` it guarantees each
 * required coverage target maps to a real, query-valid need in the same spec (reusing a suitable
 * spec slot, else synthesizing the minimum missing one), preserving the strategy's other needs.
 */
export function buildCoverageAwareNeeds(
  spec: FrontendBuildSpecification,
  strategy: VisualStrategy | null,
  coverage: ImageCoverageRequirement | undefined,
): CoverageAwareNeeds {
  const base = deriveImageNeeds(spec, strategy);
  if (!coverage || coverage.mode === 'none' || coverage.mode === 'optional' || coverage.explicitNoPhoto) {
    return {
      needs: base, synthesizedSlots: [],
      reasons: coverage?.explicitNoPhoto ? ['explicit-no-photo'] : [],
      fallbackUsed: false, targets: coverage?.targets || [],
    };
  }

  // required / image-led — enforce the mandatory floor with correlated evidence.
  const reasons: ImageCoverageReasonCode[] = [...diagnoseStrategyForCoverage(strategy, spec, coverage)];
  const synthesizedSlots: FrontendSpecImageSlot[] = [];
  const needBySlot = new Map(base.map((n) => [n.slotId, n]));
  const extraNeeds: ImageNeed[] = [];
  const targets = coverage.targets.map((t) => ({ ...t }));
  const assigned = new Set<string>();
  let fallbackUsed = false;

  for (const t of targets.filter((x) => x.required)) {
    const slot = findSpecSlotForTarget(spec, t, assigned);
    if (slot) {
      assigned.add(slot.id);
      t.slotId = slot.id; t.matchStatus = 'pending';
      const existing = needBySlot.get(slot.id);
      if (existing) { t.query = existing.query; }
      else { const n = needFromSlotAndTarget(slot, t, spec); extraNeeds.push(n); needBySlot.set(slot.id, n); t.query = n.query; fallbackUsed = true; }
      continue;
    }
    const s = synthesizeSlotForTarget(t);
    synthesizedSlots.push(s); assigned.add(s.id);
    const n = needFromSlotAndTarget(s, t, spec);
    extraNeeds.push(n); needBySlot.set(s.id, n);
    t.slotId = s.id; t.query = n.query; t.matchStatus = 'pending';
    fallbackUsed = true;
    if (!reasons.includes('deterministic-required-slot-created')) reasons.push('deterministic-required-slot-created');
  }

  fallbackUsed = fallbackUsed || reasons.length > 0;

  // Required-target needs first (guaranteed within the cap), then the strategy's other needs.
  const requiredSlotIds = new Set(targets.filter((t) => t.required && t.slotId).map((t) => t.slotId as string));
  const ordered = [
    ...extraNeeds,
    ...base.filter((n) => requiredSlotIds.has(n.slotId)),
    ...base.filter((n) => !requiredSlotIds.has(n.slotId)),
  ];
  const seen = new Set<string>();
  const needs: ImageNeed[] = [];
  for (const n of ordered) {
    if (seen.has(n.slotId)) continue;
    seen.add(n.slotId);
    needs.push(n);
    if (needs.length >= MAX_SOURCED_IMAGES) break;
  }
  return { needs, synthesizedSlots, reasons, fallbackUsed, targets };
}

/** Merge synthesized coverage slots into the spec's image slots (deduped by id). Pure. */
function mergeSynthesizedSlots(spec: FrontendBuildSpecification, extra: FrontendSpecImageSlot[]): FrontendBuildSpecification {
  if (!extra.length) return spec;
  const existing = new Set((spec.assets?.imageSlots || []).map((s) => s.id));
  const add = extra.filter((s) => !existing.has(s.id));
  if (!add.length) return spec;
  return { ...spec, assets: { ...spec.assets, imageSlots: [...(spec.assets?.imageSlots || []), ...add] } };
}

/** Map a manifest status to the coverage reason vocabulary. */
function manifestStatusReasons(status: string, sourced: number, requested: number): ImageCoverageReasonCode[] {
  const out: ImageCoverageReasonCode[] = [];
  if (status === 'no-providers') out.push('no-providers');
  else if (status === 'error' || status === 'failed-open') out.push('provider-error');
  else if (status === 'no-results') out.push('no-results');
  else if (sourced > 0 && requested > sourced) out.push('stock-partial');
  return out;
}

/**
 * Finalize coverage after enrichment: mark each required target sourced/uncovered from the enriched
 * slots, plan the bounded AI fallback for the still-uncovered required targets (stock-first;
 * non-persistable providers keep the slot honestly uncovered), and assemble bounded diagnostics.
 * Pure — no network, never injects an AI asset. Returns the updated coverage + diagnostics.
 */
export function finalizeCoverage(input: {
  coverage: ImageCoverageRequirement;
  targets: ImageCoverageTarget[];
  enrichedSpec: FrontendBuildSpecification;
  strategy: VisualStrategy | null;
  manifest: ImageAssetManifest;
  fallbackUsed: boolean;
  reasons: ImageCoverageReasonCode[];
  aiCtx: AiFallbackContext;
}): { coverage: ImageCoverageRequirement; diagnostics: ImageCoverageDiagnostics; uncoveredRequired: number } {
  const slotsById = new Map((input.enrichedSpec.assets?.imageSlots || []).map((s) => [s.id, s]));
  const targets = input.targets.map((t) => ({ ...t }));
  for (const t of targets) {
    if (!t.slotId) continue;
    const slot = slotsById.get(t.slotId);
    if (slot && slot.url) {
      t.matchStatus = 'sourced'; t.domId = slot.domId;
      // The honest provenance of the image that covered this target.
      t.provider = slot.imageSource === 'generated' ? 'generated' : slot.imageProvider;
    } else if (t.required) {
      t.matchStatus = 'uncovered';
    }
  }
  const reasons: ImageCoverageReasonCode[] = [...input.reasons,
    ...manifestStatusReasons(input.manifest.status, input.manifest.sourced, input.manifest.requested)];

  const uncoveredTargets = targets.filter((t) => t.required && t.matchStatus !== 'sourced');
  const aiPlan = planAiFallback(uncoveredTargets, input.aiCtx);
  for (const d of aiPlan.decisions) {
    const t = targets.find((x) => x.id === d.targetId);
    if (!t) continue;
    if (d.outcome === 'ai-usable') { t.matchStatus = 'ai-usable'; }
    else { t.failureReason = d.reason; }
  }
  for (const r of aiPlan.reasons) if (!reasons.includes(r)) reasons.push(r);
  // Any target still not sourced/ai-usable is genuinely uncovered.
  for (const t of targets) {
    if (t.required && t.matchStatus !== 'sourced' && t.matchStatus !== 'ai-usable') {
      t.matchStatus = 'uncovered';
      if (!reasons.includes('required-image-uncovered')) reasons.push('required-image-uncovered');
    }
  }
  const uncoveredRequired = targets.filter((t) => t.required && t.matchStatus === 'uncovered').length;

  const nextCoverage: ImageCoverageRequirement = { ...input.coverage, targets, reasons: uniqReasons([...input.coverage.reasons, ...reasons]) };
  const diagnostics = buildImageCoverageDiagnostics({
    coverage: nextCoverage, strategy: input.strategy,
    stockRequested: input.manifest.requested, stockSourced: input.manifest.sourced,
    aiPlan, uncoveredRequired, fallbackUsed: input.fallbackUsed,
    manifestStatus: input.manifest.status, providers: input.manifest.providers, reasons,
  });
  return { coverage: nextCoverage, diagnostics, uncoveredRequired };
}

function uniqReasons(r: ImageCoverageReasonCode[]): ImageCoverageReasonCode[] { return [...new Set(r)].slice(0, 20); }

/* ── Image SOURCE ROUTING (web-build-image-intelligence-v1) ────────────────────
 * The needs plan above answers "which slots want an image, and what should it show". The routing
 * contract answers "where should that image COME FROM". This function is the only place the two
 * meet, and it is deliberately conservative:
 *
 *   • no contract (app build, legacy spec, fail-open) ⇒ every need stays STOCK — byte-for-byte
 *     the behaviour that existed before this contract;
 *   • no decision for a need ⇒ that need stays STOCK;
 *   • `none` ⇒ the need is suppressed and the slot stays typography/CSS/native, UNLESS the
 *     COVERAGE authority requires that image (this layer never lowers a floor it does not own).
 *     "Required" here means the coverage floor, not the deterministic planner's own
 *     `required: purpose === 'hero'` marker — that marker says "this is the lead slot", and
 *     treating it as a floor would have made a `none` verdict unreachable for every hero, which
 *     is precisely the case this contract exists to decide (a dev tool, a dashboard product);
 *   • `generated` ⇒ the need is handed to the generated route, which may hand it back.
 *
 * It never invents a need, so this contract can only re-route or REMOVE an image — it can never
 * increase the number of images in a build. Pure. */
export interface RoutedImageNeeds {
  stock: ImageNeed[];
  generated: Array<{ need: ImageNeed; decision: ImageSourceDecision }>;
  /** Needs the routing removed because the honest answer is no photo at all. */
  suppressed: ImageNeed[];
  /** Required needs a `none` verdict could NOT remove (the coverage floor wins). */
  floorProtected: number;
}

export function routeImageNeeds(
  needs: ImageNeed[], routing: ImageSourceStrategyContract | undefined,
): RoutedImageNeeds {
  const out: RoutedImageNeeds = { stock: [], generated: [], suppressed: [], floorProtected: 0 };
  const floorEnforced = routing?.coverageMode === 'required' || routing?.coverageMode === 'image-led';
  for (const n of needs) {
    const d = decisionForSlot(routing, n.slotId);
    if (!d || d.strategy === 'stock') { out.stock.push(n); continue; }
    if (d.strategy === 'generated') { out.generated.push({ need: n, decision: d }); continue; }
    // 'none' — only the coverage floor can override it.
    if (n.required && (d.required || floorEnforced)) { out.floorProtected += 1; out.stock.push(n); continue; }
    out.suppressed.push(n);
  }
  return out;
}

/**
 * Source real stock images for a NEW build's spec and return a NEW payload with
 * the enriched spec + a persisted attribution manifest. FAIL-OPEN: on any problem
 * the original payload is returned unchanged (with a manifest recording the state)
 * so generation always proceeds. NEVER mutates the input payload.
 */
export async function sourceStockImagesForPayload(
  payload: WebBuildPayload, opts?: { signal?: AbortSignal },
): Promise<{ payload: WebBuildPayload; manifest: ImageAssetManifest }> {
  const spec = payload?.artifacts?.frontendBuildSpec;
  const strategy = payload.artifacts?.visualStrategy || null;
  const emptyManifest = (status: ImageAssetManifest['status'], warnings: string[] = []): ImageAssetManifest => ({
    status, assets: [], providers: { pexels: 'unknown', unsplash: 'unknown' },
    warnings, requested: 0, sourced: 0, elapsedMs: 0,
  });
  if (!spec) return { payload, manifest: emptyManifest('empty', ['no spec']) };

  // ── Coverage authority. Only `required`/`image-led` (and not explicit-no-photo) ENFORCE a floor
  //    — everything else keeps the exact existing behavior (Visual Strategy precedence, deterministic
  //    fallback, typography-first when nothing sources). ──
  const cov = spec.imageCoverage;
  const enforce = !!cov && (cov.mode === 'required' || cov.mode === 'image-led') && !cov.explicitNoPhoto;

  const built = enforce
    ? buildCoverageAwareNeeds(spec, strategy, cov)
    : { needs: deriveImageNeeds(spec, strategy), synthesizedSlots: [] as FrontendSpecImageSlot[], reasons: [] as ImageCoverageReasonCode[], fallbackUsed: false, targets: (cov?.targets || []) };
  const specForSourcing = mergeSynthesizedSlots(spec, built.synthesizedSlots);
  let needs = built.needs;

  const hasSlots = !!(specForSourcing.assets && Array.isArray(specForSourcing.assets.imageSlots) && specForSourcing.assets.imageSlots.length);
  if (!enforce && !hasSlots) return { payload, manifest: emptyManifest('empty', ['no image slots']) };
  // A valid Visual Strategy (Phase 14K.7) takes precedence; absent → deterministic. When coverage
  // ENFORCES a floor, zero usable needs cannot occur (a required slot is synthesized) — so this
  // legacy short-circuit only applies to the non-enforcing (`none`/`optional`) modes.
  if (!enforce && needs.length === 0) return { payload, manifest: emptyManifest('empty', ['no photographic image needs']) };

  /* ── IMAGE SOURCE ROUTING (web-build-image-intelligence-v1) ────────────────────────────────
   * WEB ONLY. The contract was derived at planning time and persisted on the spec; an older
   * (reopened) spec re-derives it deterministically from the same authorities. An APP spec has
   * no contract at all — `routing` stays undefined and every need below stays STOCK, so App
   * Build is byte-for-byte unchanged and NO generated-image call can originate from it. ── */
  const routing: ImageSourceStrategyContract | undefined = specForSourcing.buildType === 'app'
    ? undefined
    : (specForSourcing.imageSourceStrategy || deriveImageSourceStrategyForSpec(specForSourcing));
  const routed = routeImageNeeds(needs, routing);

  /* ── The GENERATED route runs FIRST, so a failure falls back into the SAME single stock
   *    request rather than costing a second round trip. Hard-bounded by the routing contract's
   *    budget (≤ the product-wide ceiling) and skipped entirely — with ZERO provider calls —
   *    when nothing is routed to it. ── */
  let generatedAssets: SourcedImageAsset[] = [];
  let generatedDiagnostics: GeneratedImageryDiagnostics | undefined;
  let generatedPersistable = false;
  if (routed.generated.length > 0 && routing) {
    try {
      const gen = await runGeneratedImagery(
        routed.generated.map((g) => g.decision),
        { spec: specForSourcing, budget: routing.generatedBudget },
        opts,
      );
      generatedDiagnostics = gen.diagnostics;
      generatedAssets = gen.assets;
      generatedPersistable = gen.diagnostics.produced > 0;
      const readySlots = new Set(gen.assets.map((a) => a.slotId));
      for (const g of routed.generated) {
        if (readySlots.has(g.need.slotId)) continue;
        // Honest fallback, decision by decision: a real photograph only where authenticity and
        // semantics allow one; otherwise no image at all (never an irrelevant substitute).
        if (g.decision.fallback.includes('stock')) routed.stock.push(g.need);
      }
    } catch {
      // Fail-open: the generated route can never break a build. Every decision falls back.
      for (const g of routed.generated) {
        if (g.decision.fallback.includes('stock')) routed.stock.push(g.need);
      }
    }
  }

  needs = routed.stock;

  const designContext = buildDesignContext(specForSourcing);
  const res = needs.length > 0 ? await fetchSourcedImages(needs, designContext, opts) : null;

  // Sourcing-intelligence diagnostics — the need-level signal is known even when the endpoint fails.
  const needsWithArt = needs.filter((n) => !!n.subject || !!n.role || !!(n.queryVariants && n.queryVariants.length)).length;
  const queryVariantsTotal = needs.reduce((s, n) => s + (n.queryVariants?.length || 0), 0);
  const intelBase = {
    version: 'image-intelligence-v1' as const,
    needs: needs.length, needsWithArtDirection: needsWithArt, queryVariantsTotal,
    smartImageContextSent: !!designContext, designContextConsumed: !!designContext,
    dominantColorMetadataAvailable: false, perceptualDedupAvailable: false, newProviderCalls: 0,
  };

  let manifest: ImageAssetManifest;
  let enrichedSpec: FrontendBuildSpecification = specForSourcing;
  if (!res) {
    const emptyReason = routed.suppressed.length > 0 && needs.length === 0
      ? 'image source strategy: no photo needed here'
      : 'no photographic image needs';
    manifest = {
      ...emptyManifest(needs.length === 0 ? 'empty' : 'failed-open',
        needs.length === 0 ? [emptyReason] : ['sourcing endpoint unavailable']),
      imageIntelligence: {
        ...intelBase, candidatesReceived: 0, keptAssets: 0, malformedRejected: 0, placeholderOrLogoRejected: 0,
        exactUrlDuplicatesPrevented: 0, normalizedUrlDuplicatesPrevented: 0, providerIdDuplicatesPrevented: 0,
        roleReuseDuplicatesPrevented: 0, orientationMismatchNoted: 0, lowResolutionNoted: 0,
        providerDistribution: {}, elapsedMs: 0,
      },
    };
  } else {
    const rawAssets = Array.isArray(res.assets) ? res.assets.filter((a) => a && a.url) : [];
    // Client-side filter + cross-slot/role dedup (deterministic; zero new provider calls).
    const refined = refineSourcedAssets(needs, rawAssets);
    const sourcedAssets = refined.assets;
    const imageIntelligence: ImageSourcingIntelligenceDiagnostics = {
      ...intelBase, ...refined.diagnostics, elapsedMs: res.elapsedMs ?? 0,
    };
    manifest = {
      status: (res.status as ImageAssetManifest['status']) || (sourcedAssets.length ? 'ok' : 'no-results'),
      assets: sourcedAssets,
      providers: { pexels: res.providers?.pexels || 'unknown', unsplash: res.providers?.unsplash || 'unknown' },
      warnings: Array.isArray(res.warnings) ? res.warnings.slice(0, 8) : [],
      // `requested` / `sourced` keep their exact STOCK meaning (the coverage diagnostics and the
      // `stock-partial` reason are computed from them); the generated route reports its own counts.
      requested: res.requested ?? needs.length,
      sourced: sourcedAssets.length,
      elapsedMs: res.elapsedMs ?? 0,
      imageIntelligence,
    };
  }

  /* ── ONE enrichment pass over stock + generated assets, so every image — whatever its source —
   *    reaches the builder through the SAME slot contract (url + alt + stable data-korvix ids)
   *    and the same dedup/domId numbering. A generated asset carries `imageSource: 'generated'`
   *    and its honesty label instead of a provider/photographer. ── */
  const placedAssets = [...manifest.assets, ...generatedAssets];
  if (placedAssets.length > 0) {
    const { spec: es, assets: ea } = enrichSpecWithSourcedImages(specForSourcing, placedAssets);
    enrichedSpec = es;
    manifest = { ...manifest, assets: ea };
    // A build whose imagery came only from the generated arm still HAS imagery: reporting the
    // stock arm's `empty`/`no-results` as the manifest status would be untrue.
    if (generatedAssets.length > 0 && (manifest.status === 'empty' || manifest.status === 'no-results')) {
      manifest = { ...manifest, status: 'ok' };
    }
  }
  if (generatedDiagnostics) manifest = { ...manifest, generatedImagery: generatedDiagnostics };
  const routingDiagnostics = buildImageSourceStrategyDiagnostics(routing);
  if (routingDiagnostics) manifest = { ...manifest, sourceStrategy: routingDiagnostics };

  // ── Coverage finalize — mark required targets sourced/uncovered, plan the bounded, stock-first,
  //    non-persistable-safe AI fallback, and persist coverage state + bounded diagnostics. ──
  if (enforce && cov) {
    try {
      const fin = finalizeCoverage({
        coverage: cov, targets: built.targets, enrichedSpec, strategy, manifest,
        fallbackUsed: built.fallbackUsed, reasons: built.reasons,
        // The MEASURED capability of this build's generated route, not an assumption: `persistable`
        // is true only when the route actually produced a durably-stored asset in THIS build. When
        // it did not, the recorded reason stays the true root cause (persistence / availability).
        aiCtx: {
          provider: 'openai', enabled: true, authorized: true, persistable: generatedPersistable,
        } satisfies AiFallbackContext,
      });
      enrichedSpec = { ...enrichedSpec, imageCoverage: fin.coverage };
      manifest = { ...manifest, coverage: fin.diagnostics };
    } catch { /* fail-open: coverage finalize must never break a build */ }
  }

  const nextPayload: WebBuildPayload = {
    ...payload,
    artifacts: {
      ...(payload.artifacts || {}),
      frontendBuildSpec: enrichedSpec,
      imageAssetManifest: manifest,
    },
  };
  return { payload: nextPayload, manifest };
}
