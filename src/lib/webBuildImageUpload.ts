/**
 * Web Build — device image upload client (Phase 14K.6).
 *
 * Uploads a user's OWN image (from phone/tablet/computer) to the authenticated
 * backend, which validates it strictly and stores it via the existing asset
 * system, returning a STABLE delivery URL. The browser never sends the image to
 * a provider/AI and never persists a `blob:` URL — the stable HTTPS URL is what
 * gets previewed and (on confirm) written into the generated project.
 *
 * Client-side pre-validation (MIME + size + decoded dimensions) gives instant,
 * localized feedback and avoids a wasted round-trip; the backend re-validates
 * from the file signature (never trusting the browser).
 */
const BUNDLED_BACKEND = 'https://worker-production-1345.up.railway.app';

/** Accepted device image types (kept in lockstep with the backend validator). */
export const UPLOAD_ACCEPT = 'image/jpeg,image/png,image/webp';
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_BYTES = 10 * 1024 * 1024;
const MIN_SIDE = 200;
const MAX_SIDE = 12000;
const MAX_PIXELS = 100_000_000;

function apiBase(): string {
  const envBase = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
  return envBase ? envBase.replace(/\/+$/, '') : BUNDLED_BACKEND;
}

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = {};
  try {
    const tok = localStorage.getItem('korvix_access_token');
    if (tok) h['Authorization'] = `Bearer ${tok}`;
    const owner = localStorage.getItem('korvix_owner_token');
    if (owner) h['X-Korvix-Owner-Token'] = owner;
  } catch { /* localStorage may be disabled */ }
  return h;
}

/** Resolve a backend `public_url` to an absolute HTTPS URL (relative → API base). */
export function resolveAssetUrl(url: string): string {
  if (!url) return '';
  return /^https?:\/\//i.test(url) ? url : `${apiBase()}${url.startsWith('/') ? '' : '/'}${url}`;
}

export interface UploadedImage {
  assetId: string;
  /** Absolute, stable HTTPS delivery URL — safe to persist into the project. */
  url: string;
  mimeType: string;
  width: number;
  height: number;
  source: 'user-upload';
}

/** A localized-error CODE (the UI maps it to t()); never a raw backend string. */
export type UploadErrorCode =
  | 'unsupported_format' | 'too_large' | 'too_small' | 'bad_dimensions'
  | 'corrupt' | 'storage_unavailable' | 'upload_failed' | 'network';

export class ImageUploadError extends Error {
  code: UploadErrorCode;
  constructor(code: UploadErrorCode) { super(code); this.code = code; }
}

/** Decode a local object URL just far enough to read dimensions (never persisted). */
function readDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const obj = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { const d = { width: img.naturalWidth, height: img.naturalHeight }; URL.revokeObjectURL(obj); resolve(d); };
    img.onerror = () => { URL.revokeObjectURL(obj); reject(new ImageUploadError('corrupt')); };
    img.src = obj;
  });
}

/** Fast client-side gate. Throws ImageUploadError; the backend re-checks by signature. */
export async function preValidateImage(file: File): Promise<{ width: number; height: number }> {
  if (!file || !ALLOWED_MIME.has((file.type || '').toLowerCase())) throw new ImageUploadError('unsupported_format');
  if (file.size <= 0 || file.size > MAX_BYTES) throw new ImageUploadError('too_large');
  const { width, height } = await readDimensions(file);
  if (width > MAX_SIDE || height > MAX_SIDE || width * height > MAX_PIXELS) throw new ImageUploadError('bad_dimensions');
  if (width < MIN_SIDE || height < MIN_SIDE) throw new ImageUploadError('too_small');
  return { width, height };
}

export interface UploadParams {
  file: File;
  projectId?: string;
  slotId?: string;
  nodeId?: string;
  signal?: AbortSignal;
}

/**
 * Validate, then upload one image. Returns a stable HTTPS URL + dimensions. Maps
 * every failure to an `UploadErrorCode` — the caller shows a localized message
 * and restores the original image. Aborting via `signal` rejects with 'network'.
 */
export async function uploadDeviceImage(params: UploadParams): Promise<UploadedImage> {
  await preValidateImage(params.file);

  const form = new FormData();
  form.append('file', params.file, `web-build-image`);
  if (params.projectId) form.append('project_id', params.projectId);
  if (params.slotId) form.append('slot_id', params.slotId);
  if (params.nodeId) form.append('node_id', params.nodeId);

  let resp: Response;
  try {
    resp = await fetch(`${apiBase()}/v2/web-build/images/upload`, {
      method: 'POST', headers: authHeaders(), body: form, signal: params.signal,
    });
  } catch {
    throw new ImageUploadError('network');
  }
  if (resp.status === 503) throw new ImageUploadError('storage_unavailable');
  if (!resp.ok) {
    let code: UploadErrorCode = 'upload_failed';
    try {
      const body = await resp.json();
      const c = body?.detail?.code;
      if (c === 'too_large' || c === 'too_small' || c === 'unsupported_format'
        || c === 'bad_dimensions' || c === 'corrupt') code = c;
      else if (c === 'storage_unavailable') code = 'storage_unavailable';
    } catch { /* keep generic */ }
    throw new ImageUploadError(code);
  }

  const data = await resp.json();
  const url = resolveAssetUrl(String(data?.url || ''));
  if (!data?.assetId || !url) throw new ImageUploadError('upload_failed');
  return {
    assetId: String(data.assetId),
    url,
    mimeType: String(data.mimeType || 'image/webp'),
    width: Number(data.width) || 0,
    height: Number(data.height) || 0,
    source: 'user-upload',
  };
}
