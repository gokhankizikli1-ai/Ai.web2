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
import {
  findSpecSlotForTarget, synthesizeSlotForTarget, diagnoseStrategyForCoverage,
  planAiFallback, buildImageCoverageDiagnostics,
  type ImageCoverageRequirement, type ImageCoverageTarget, type ImageCoveragePurpose,
  type ImageCoverageReasonCode, type ImageCoverageDiagnostics, type AiFallbackContext,
} from '@/lib/webBuildImageCoverage';

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
      .filter((n) => !!n.query);
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
    needs.push({
      slotId: slot.id,
      purpose: plan.purpose,
      query,
      orientation: plan.orientation,
      required: plan.purpose === 'hero',
      altText: slotAlt(slot, spec, plan.purpose),
    });
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

/** POST the needs plan to the backend sourcing endpoint. Never throws. */
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
      body: JSON.stringify({ needs, maxImages: MAX_SOURCED_IMAGES, ...(context ? { context } : {}) }),
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
    return {
      ...slot,
      url: asset.url,
      alt: asset.altText || slot.alt,
      imageProvider: asset.provider,
      photographer: asset.photographerName,
      providerPageUrl: asset.providerPageUrl,
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
  const query = clean(target.query || slot.prompt || slotQuery(slot, spec, 'other'), 120);
  return {
    slotId: slot.id,
    purpose: coveragePurposeToImagePurpose(target.purpose),
    query,
    orientation: target.orientation,
    required: true,
    altText: clean(target.altText || slot.placeholderLabel || '', 200) || slotAlt(slot, spec, 'other'),
  };
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
    const s = synthesizeSlotForTarget(spec, t);
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

/** Owner token presence (browser) — used only to classify AI-fallback authorization honestly. */
function hasOwnerToken(): boolean {
  try { return !!localStorage.getItem('korvix_owner_token'); } catch { return false; }
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
      t.matchStatus = 'sourced'; t.domId = slot.domId; t.provider = slot.imageProvider;
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
  const needs = built.needs;

  const hasSlots = !!(specForSourcing.assets && Array.isArray(specForSourcing.assets.imageSlots) && specForSourcing.assets.imageSlots.length);
  if (!enforce && !hasSlots) return { payload, manifest: emptyManifest('empty', ['no image slots']) };
  // A valid Visual Strategy (Phase 14K.7) takes precedence; absent → deterministic. When coverage
  // ENFORCES a floor, zero usable needs cannot occur (a required slot is synthesized) — so this
  // legacy short-circuit only applies to the non-enforcing (`none`/`optional`) modes.
  if (!enforce && needs.length === 0) return { payload, manifest: emptyManifest('empty', ['no photographic image needs']) };

  const res = needs.length > 0 ? await fetchSourcedImages(needs, buildDesignContext(specForSourcing), opts) : null;

  let manifest: ImageAssetManifest;
  let enrichedSpec: FrontendBuildSpecification = specForSourcing;
  if (!res) {
    manifest = emptyManifest(needs.length === 0 ? 'empty' : 'failed-open',
      needs.length === 0 ? ['no photographic image needs'] : ['sourcing endpoint unavailable']);
  } else {
    const sourcedAssets = Array.isArray(res.assets) ? res.assets.filter((a) => a && a.url) : [];
    const baseManifest: ImageAssetManifest = {
      status: (res.status as ImageAssetManifest['status']) || (sourcedAssets.length ? 'ok' : 'no-results'),
      assets: sourcedAssets,
      providers: { pexels: res.providers?.pexels || 'unknown', unsplash: res.providers?.unsplash || 'unknown' },
      warnings: Array.isArray(res.warnings) ? res.warnings.slice(0, 8) : [],
      requested: res.requested ?? needs.length,
      sourced: res.sourced ?? sourcedAssets.length,
      elapsedMs: res.elapsedMs ?? 0,
    };
    if (sourcedAssets.length === 0) {
      manifest = baseManifest;
    } else {
      const { spec: es, assets: ea } = enrichSpecWithSourcedImages(specForSourcing, sourcedAssets);
      enrichedSpec = es;
      manifest = { ...baseManifest, assets: ea };
    }
  }

  // ── Coverage finalize — mark required targets sourced/uncovered, plan the bounded, stock-first,
  //    non-persistable-safe AI fallback, and persist coverage state + bounded diagnostics. ──
  if (enforce && cov) {
    try {
      const fin = finalizeCoverage({
        coverage: cov, targets: built.targets, enrichedSpec, strategy, manifest,
        fallbackUsed: built.fallbackUsed, reasons: built.reasons,
        // Capability probe (no network, no provider call). Every provider's automatic result is a
        // session-only data URL today → classified non-persistable; enabled/authorized are set to
        // the best case so the recorded reason is the true root cause (persistence, not gating).
        aiCtx: { provider: 'openai', enabled: true, authorized: true } satisfies AiFallbackContext,
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
