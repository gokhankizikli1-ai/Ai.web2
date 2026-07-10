/**
 * Web Build — Real Image Generation V1 (Phase 10D) frontend client.
 *
 * Turns an Image Pipeline (Phase 10C) slot into a REAL generated illustrative
 * image by calling the backend ONLY. It never talks to an image provider from
 * the browser, and it never puts an API key in the frontend.
 *
 *   Backend contract (implemented in backend/routes/v2_web_build_images.py):
 *     GET  /v2/web-build/images/health
 *          → { enabled, provider, configured, ownerOnly, missingReason, video:false }
 *     POST /v2/web-build/images/generate
 *          body: { slotId, target, kind, source, manualUploadRecommended,
 *                  honestyLabel, prompt:{positive,negative,style,aspectRatio,safetyNotes} }
 *          → GeneratedImageAsset (always HTTP 200; disabled/failed are honest states)
 *
 * If the backend route is missing/disabled, every call resolves to a
 * `disabled` asset with a clear reason — generation never crashes the Preview
 * and never blocks normal website generation.
 */
import { useSyncExternalStore } from 'react';
import type { ImageAssetSlot } from '@/lib/webBuildAgents';

const BUNDLED_BACKEND = 'https://worker-production-1345.up.railway.app';

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

/* ── Types (mirror backend/services/web_build_images) ───────────────────────── */

export type ImageGenerationProvider =
  | 'openai'
  | 'replicate'
  | 'stability'
  | 'custom'
  | 'disabled';

export type GeneratedImageStatus =
  | 'idle'
  | 'queued'
  | 'generating'
  | 'ready'
  | 'failed'
  | 'disabled';

export interface ImageGenerationRequest {
  slotId: string;
  target: string;
  kind: string;
  source?: string;
  manualUploadRecommended?: boolean;
  /** Phase 10D-1: sent so the backend can DEFENSIVELY re-classify and refuse a
   *  proof-heavy request even if the frontend claimed it was allowed. */
  title?: string;
  purpose?: string;
  visualTruthCategory?: string;
  visualTruthEligibility?: string;
  prompt: {
    positive: string;
    negative: string;
    style: string;
    aspectRatio: string;
    safetyNotes: string[];
  };
  honestyLabel: string;
  provider?: ImageGenerationProvider;
}

export interface GeneratedImageAsset {
  slotId: string;
  status: GeneratedImageStatus;
  url?: string;
  dataUrl?: string;
  provider?: ImageGenerationProvider;
  createdAt?: string;
  error?: string;
  honestyLabel: string;
  promptSummary: string;
  /** Non-sensitive explanation for disabled/failed states (never a key). */
  reason?: string;
}

export interface ImageGenHealth {
  enabled: boolean;
  provider: ImageGenerationProvider;
  configured: boolean;
  ownerOnly: boolean;
  missingReason?: string | null;
  video: boolean;
}

/* ── Safety gate (mirrors backend generation_allowed byte-for-byte in intent) ─
 * Proof-heavy slots are NEVER generated — they require a real manual upload.
 * Only illustrative / abstract / ambient slots are generatable. */
const ALWAYS_MANUAL_KINDS = new Set([
  'project-photo', 'gallery-photo', 'before-after-pair', 'restaurant-space',
  'product-listing-image', 'archive-scan', 'portfolio-work-image', 'team-or-studio-photo',
]);
const ILLUSTRATIVE_KINDS = new Set([
  'abstract-brand-image', 'illustrative-product-scene', 'hero-background',
  'catalog-cover', 'food-photo', 'hero-image',
]);

export interface GenerationGate { allowed: boolean; reason: string }

/**
 * Decide whether a slot may be generated. Pure + deterministic.
 * Phase 10D-1: prefer the generic Visual Truth classification when present;
 * fall back to the original kind/source regex for OLD builds (no visualTruth).
 */
export function shouldAllowGeneration(slot: ImageAssetSlot): GenerationGate {
  if (!slot) return { allowed: false, reason: 'no slot' };

  // Primary path — the site-agnostic Visual Truth classifier.
  const vt = slot.visualTruth;
  if (vt) {
    switch (vt.eligibility) {
      case 'ai-generation-allowed':
        // Only actually generate when the source is a provider/prompt slot.
        if (slot.source === 'provider-ready' || slot.source === 'prompt-ready') {
          return { allowed: true, reason: vt.reason || 'illustrative image — safe to generate' };
        }
        return { allowed: false, reason: 'handled as a CSS/SVG placeholder (no generation)' };
      case 'manual-upload-required':
        return { allowed: false, reason: vt.reason || 'manual upload required for real proof' };
      case 'css-svg-only':
        return { allowed: false, reason: vt.reason || 'CSS/SVG is the correct representation (no generation)' };
      case 'blocked':
      default:
        return { allowed: false, reason: vt.reason || 'blocked — would imply fake proof' };
    }
  }

  // Fallback path — original safety logic for builds without a classification.
  if (slot.manualUploadRecommended || slot.source === 'manual-upload') {
    return { allowed: false, reason: 'manual upload required for real proof' };
  }
  if (ALWAYS_MANUAL_KINDS.has(slot.kind)) {
    return { allowed: false, reason: 'manual upload required for real proof' };
  }
  if ((slot.source === 'provider-ready' || slot.source === 'prompt-ready') && ILLUSTRATIVE_KINDS.has(slot.kind)) {
    return { allowed: true, reason: 'illustrative image — safe to generate' };
  }
  return { allowed: false, reason: 'handled as a CSS/SVG placeholder (no generation)' };
}

/** Build the backend request body from an Image Pipeline slot. */
export function imageGenRequestFromSlot(slot: ImageAssetSlot): ImageGenerationRequest {
  return {
    slotId: slot.id,
    target: slot.target,
    kind: slot.kind,
    source: slot.source,
    manualUploadRecommended: slot.manualUploadRecommended,
    title: slot.title,
    purpose: slot.purpose,
    visualTruthCategory: slot.visualTruth?.category,
    visualTruthEligibility: slot.visualTruth?.eligibility,
    honestyLabel: slot.honestyLabel,
    prompt: {
      positive: slot.prompt?.positive || '',
      negative: slot.prompt?.negative || '',
      style: slot.prompt?.style || '',
      aspectRatio: slot.prompt?.aspectRatio || '16:9',
      safetyNotes: slot.prompt?.safetyNotes || [],
    },
  };
}

function disabledAsset(slot: ImageAssetSlot, reason: string, status: GeneratedImageStatus = 'disabled'): GeneratedImageAsset {
  return {
    slotId: slot.id,
    status,
    provider: 'disabled',
    honestyLabel: slot.honestyLabel || 'AI-generated illustrative image',
    promptSummary: (slot.prompt?.positive || '').slice(0, 140),
    reason,
  };
}

/** Fetch provider health. Returns null if the backend is unreachable/absent. */
export async function fetchImageGenHealth(): Promise<ImageGenHealth | null> {
  try {
    const resp = await fetch(`${apiBase()}/v2/web-build/images/health`, { headers: authHeaders() });
    if (!resp.ok) return null;
    return (await resp.json()) as ImageGenHealth;
  } catch {
    return null;
  }
}

/**
 * Generate one slot. NEVER throws — a missing/disabled backend, a refused
 * (proof-heavy) slot, or a provider error all resolve to an honest
 * disabled/failed asset. Callers can render the returned status directly.
 */
export async function generateImageForSlot(slot: ImageAssetSlot): Promise<GeneratedImageAsset> {
  const gate = shouldAllowGeneration(slot);
  if (!gate.allowed) return disabledAsset(slot, gate.reason);

  let resp: Response;
  try {
    resp = await fetch(`${apiBase()}/v2/web-build/images/generate`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(imageGenRequestFromSlot(slot)),
    });
  } catch {
    return disabledAsset(slot, 'backend unreachable — image generation unavailable', 'failed');
  }
  if (resp.status === 404) return disabledAsset(slot, 'image generation endpoint not deployed');
  if (resp.status === 503) return disabledAsset(slot, 'image generation is disabled on this deployment');
  if (!resp.ok) return disabledAsset(slot, 'image generation failed on the server', 'failed');

  try {
    const asset = (await resp.json()) as GeneratedImageAsset;
    // Always keep an honest label even if the server omitted one. Spread first,
    // then default the two fields so keys are never specified twice.
    return {
      ...asset,
      honestyLabel: asset.honestyLabel || slot.honestyLabel,
      promptSummary: asset.promptSummary || '',
    };
  } catch {
    return disabledAsset(slot, 'invalid response from server', 'failed');
  }
}

/**
 * Generate every generatable slot in a build. Refused slots are returned as
 * disabled (not silently dropped) so the UI can show honest per-slot state.
 * Runs sequentially to stay gentle on provider rate limits.
 */
export async function generateImagesForBuild(slots: ImageAssetSlot[]): Promise<GeneratedImageAsset[]> {
  const out: GeneratedImageAsset[] = [];
  for (const slot of slots || []) {
    // eslint-disable-next-line no-await-in-loop
    out.push(await generateImageForSlot(slot));
  }
  return out;
}

/* ── Session-local generated-image store ──────────────────────────────────────
 * V1 keeps generated images in memory only (no permanent storage) — they may
 * disappear on refresh, which is acceptable for V1. A tiny external store lets
 * both the Preview (writer) and the owner diagnostics (reader) observe the same
 * live state via useSyncExternalStore without prop-drilling. */
type Listener = () => void;
const _assets = new Map<string, GeneratedImageAsset>();
const _listeners = new Set<Listener>();
let _snapshot: ReadonlyMap<string, GeneratedImageAsset> = new Map();

function _emit() {
  _snapshot = new Map(_assets);
  _listeners.forEach((l) => l());
}

export function setGeneratedAsset(asset: GeneratedImageAsset): void {
  if (!asset || !asset.slotId) return;
  _assets.set(asset.slotId, asset);
  _emit();
}

export function getGeneratedAsset(slotId: string): GeneratedImageAsset | undefined {
  return _assets.get(slotId);
}

export function subscribeGeneratedAssets(listener: Listener): () => void {
  _listeners.add(listener);
  return () => { _listeners.delete(listener); };
}

export function getGeneratedAssetsSnapshot(): ReadonlyMap<string, GeneratedImageAsset> {
  return _snapshot;
}

/** React hook: live count of successfully generated (ready) images this session. */
export function useGeneratedImageCount(): number {
  const map = useSyncExternalStore(subscribeGeneratedAssets, getGeneratedAssetsSnapshot);
  let n = 0;
  map.forEach((a) => { if (a.status === 'ready') n += 1; });
  return n;
}

/** React hook: the live asset for a single slot (or undefined). */
export function useGeneratedAsset(slotId: string): GeneratedImageAsset | undefined {
  const map = useSyncExternalStore(subscribeGeneratedAssets, getGeneratedAssetsSnapshot);
  return map.get(slotId);
}
