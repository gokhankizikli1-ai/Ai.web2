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

/** POST the needs plan to the backend sourcing endpoint. Never throws. */
async function fetchSourcedImages(needs: ImageNeed[], opts?: { signal?: AbortSignal }): Promise<SourceResponse | null> {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  opts?.signal?.addEventListener('abort', onAbort);
  const timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    const resp = await fetch(`${apiBase()}/v2/web-build/images/stock/source`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ needs, maxImages: MAX_SOURCED_IMAGES }),
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
  const emptyManifest = (status: ImageAssetManifest['status'], warnings: string[] = []): ImageAssetManifest => ({
    status, assets: [], providers: { pexels: 'unknown', unsplash: 'unknown' },
    warnings, requested: 0, sourced: 0, elapsedMs: 0,
  });

  if (!spec || !spec.assets || !Array.isArray(spec.assets.imageSlots) || spec.assets.imageSlots.length === 0) {
    return { payload, manifest: emptyManifest('empty', ['no image slots']) };
  }

  // A valid Visual Strategy (Phase 14K.7) takes precedence; absent → deterministic.
  const needs = deriveImageNeeds(spec, payload.artifacts?.visualStrategy || null);
  if (needs.length === 0) return { payload, manifest: emptyManifest('empty', ['no photographic image needs']) };

  const res = await fetchSourcedImages(needs, opts);
  if (!res) return { payload, manifest: emptyManifest('failed-open', ['sourcing endpoint unavailable']) };

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
    // No photo could be sourced — proceed typography-first; record honestly.
    return {
      payload: { ...payload, artifacts: { ...(payload.artifacts || {}), imageAssetManifest: baseManifest } },
      manifest: baseManifest,
    };
  }

  const { spec: enrichedSpec, assets: enrichedAssets } = enrichSpecWithSourcedImages(spec, sourcedAssets);
  const manifest: ImageAssetManifest = { ...baseManifest, assets: enrichedAssets };
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
