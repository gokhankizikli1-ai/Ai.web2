/**
 * Web Build — targeted, permanent image replacement (Phase 14K.6).
 *
 * Replaces ONE generated image (a Korvix-sourced example photo, or a previously
 * applied image) with a new image — a user upload or a stock photo — directly in
 * the AUTHORITATIVE generated project files + the image asset manifest, then hands
 * a new payload back so the owner can persist it through the existing save path.
 *
 * Design rules:
 *   • PURE + non-mutating: returns a NEW payload only on success; on any failure
 *     the original payload is returned untouched (transaction-like — the caller
 *     commits only on ok, so a half-applied state is impossible).
 *   • NARROW + deterministic: the exact old URL is replaced ONLY inside the single
 *     file that owns it (matched via stable `data-korvix-id` where possible). No
 *     global string replacement; unrelated images are never touched. No model call.
 *   • Honest: if the exact target can't be identified, it FAILS (ok:false) rather
 *     than pretend — the caller shows a truthful error and leaves the project as-is.
 *   • Attribution cleanup: when a user image replaces a stock photo, the slot's
 *     provider/photographer attribution is removed from the ACTIVE manifest entry.
 */
import type { WebBuildPayload, WebBuildFile } from '@/lib/webBuildPayload';
import type { SourcedImageAsset, ImageAssetManifest } from '@/lib/webBuildAgents';

export interface StockAttribution {
  provider: 'pexels' | 'unsplash';
  providerImageId?: string;
  photographerName?: string;
  photographerUrl?: string | null;
  providerPageUrl?: string;
  downloadLocation?: string | null;
  attributionText?: string;
  thumbnailUrl?: string;
}

/** The single normalized replacement command (user-upload OR stock share it). */
export interface ImageReplacementInput {
  /** The selected element's stable id (data-korvix-id) — used for manifest match. */
  nodeId: string;
  slotId?: string;
  source: 'user-upload' | 'stock';
  /** The new image URL (stable HTTPS: user asset or provider CDN). */
  url: string;
  /** The image URL currently in the project (from the selection) — the search key. */
  oldUrl?: string;
  altText?: string;
  attribution?: StockAttribution;     // stock only
  uploadedAssetId?: string;           // user-upload only
  mimeType?: string;                  // user-upload only
  width?: number;
  height?: number;
}

export type ReplaceErrorCode = 'no_files' | 'target_not_found' | 'invalid_url';

export interface ReplaceResult {
  ok: boolean;
  payload?: WebBuildPayload;
  changedFile?: string;
  error?: ReplaceErrorCode;
}

function isHttps(u: string | undefined): u is string {
  return !!u && /^https:\/\//i.test(u);
}

/** Candidate old-URL keys to locate in the files: the live selection URL + the
 *  manifest's authoritative URL for the matched slot (both exact strings). */
function oldUrlCandidates(input: ImageReplacementInput, asset?: SourcedImageAsset): string[] {
  const out: string[] = [];
  if (input.oldUrl) out.push(input.oldUrl);
  if (asset?.url && asset.url !== input.oldUrl) out.push(asset.url);
  return out.filter((u) => typeof u === 'string' && u.length > 8);
}

/** Find the ONE file that owns the image, and the exact URL string to replace. */
function locateTarget(
  files: WebBuildFile[], candidates: string[], nodeId: string,
): { index: number; oldUrl: string } | null {
  for (const oldUrl of candidates) {
    const containing = files
      .map((f, i) => ({ f, i }))
      .filter(({ f }) => typeof f.content === 'string' && f.content.includes(oldUrl));
    if (containing.length === 0) continue;
    // Disambiguate by the stable node id when more than one file uses the URL.
    if (containing.length > 1 && nodeId) {
      const withId = containing.find(({ f }) => f.content.includes(nodeId));
      if (withId) return { index: withId.i, oldUrl };
      continue; // ambiguous without the id — try the next candidate
    }
    return { index: containing[0].i, oldUrl };
  }
  return null;
}

/** Update (or append) the manifest entry for the replaced slot. */
function updateManifest(
  manifest: ImageAssetManifest | undefined, input: ImageReplacementInput,
  matched: SourcedImageAsset | undefined, nowIso: string,
): ImageAssetManifest {
  const base: ImageAssetManifest = manifest && Array.isArray(manifest.assets)
    ? manifest
    : { status: 'ok', assets: [], providers: { pexels: 'unknown', unsplash: 'unknown' }, warnings: [], requested: 0, sourced: 0, elapsedMs: 0 };

  const slotId = matched?.slotId || input.slotId || input.nodeId;
  const domId = matched?.domId || input.nodeId;

  const built: SourcedImageAsset = input.source === 'user-upload'
    ? {
        // A user image owns the slot — NO provider/photographer attribution.
        slotId, domId, source: 'user-upload', url: input.url,
        altText: input.altText || matched?.altText || '',
        assetId: input.uploadedAssetId, mimeType: input.mimeType,
        width: input.width ?? matched?.width, height: input.height ?? matched?.height,
        uploadedAt: nowIso,
      }
    : {
        slotId, domId, source: 'stock', url: input.url,
        provider: input.attribution?.provider,
        providerImageId: input.attribution?.providerImageId,
        photographerName: input.attribution?.photographerName,
        photographerUrl: input.attribution?.photographerUrl ?? null,
        providerPageUrl: input.attribution?.providerPageUrl,
        downloadLocation: input.attribution?.downloadLocation ?? null,
        attributionText: input.attribution?.attributionText,
        thumbnailUrl: input.attribution?.thumbnailUrl,
        altText: input.altText || matched?.altText || '',
        width: input.width ?? matched?.width, height: input.height ?? matched?.height,
      };

  const idx = base.assets.findIndex((a) => (matched && a === matched) || a.slotId === slotId || (a.domId && a.domId === domId));
  const nextAssets = idx >= 0
    ? base.assets.map((a, i) => (i === idx ? built : a))
    : [...base.assets, built];
  return { ...base, assets: nextAssets };
}

/** Replace the file's content in a list, marking it modified. */
function withReplacedFile(files: WebBuildFile[], index: number, content: string): WebBuildFile[] {
  return files.map((f, i) => (i === index ? { ...f, content, status: 'modified' as const } : f));
}

/**
 * Apply the replacement. Returns a NEW payload on success (files + manifest +
 * latest-step files updated), or ok:false with the original payload untouched.
 */
export function applyImageReplacement(payload: WebBuildPayload, input: ImageReplacementInput): ReplaceResult {
  if (!isHttps(input.url)) return { ok: false, error: 'invalid_url' };
  const files = Array.isArray(payload?.files) ? payload.files : [];
  if (files.length === 0) return { ok: false, error: 'no_files' };

  const manifest = payload.artifacts?.imageAssetManifest;
  const matched = (manifest?.assets || []).find(
    (a) => (a.domId && a.domId === input.nodeId) || (input.slotId && a.slotId === input.slotId),
  );

  const target = locateTarget(files, oldUrlCandidates(input, matched), input.nodeId);
  if (!target) return { ok: false, error: 'target_not_found' };

  // Exact-string, single-file replacement (never a global/regex sweep).
  const newContent = files[target.index].content.split(target.oldUrl).join(input.url);
  if (newContent === files[target.index].content) return { ok: false, error: 'target_not_found' };
  const nextFiles = withReplacedFile(files, target.index, newContent);

  const nowIso = new Date().toISOString();
  const nextManifest = updateManifest(manifest, input, matched, nowIso);

  // Keep the latest step's files in sync (All Files view + candidate derivation).
  const steps = Array.isArray(payload.steps) ? payload.steps : [];
  const nextSteps = steps.length
    ? steps.map((s, i) => {
        if (i !== steps.length - 1) return s;
        const sf = Array.isArray(s.files) ? s.files : [];
        const j = sf.findIndex((f) => f.path === files[target.index].path);
        return j >= 0 ? { ...s, files: withReplacedFile(sf, j, newContent) } : s;
      })
    : steps;

  const next: WebBuildPayload = {
    ...payload,
    files: nextFiles,
    steps: nextSteps,
    artifacts: { ...(payload.artifacts || {}), imageAssetManifest: nextManifest },
  };
  return { ok: true, payload: next, changedFile: files[target.index].path };
}
