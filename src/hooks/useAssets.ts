// useAssets — Phase 9 frontend upload manager.
//
// Owns the full upload lifecycle for chat-attached assets:
//   - drag/drop & paste-image ingestion (raw `File` objects)
//   - multipart POST /v2/assets/upload with XHR-progress events
//   - optimistic local state (queued → uploading → ready | failed)
//   - cancellation, retry, dismissal
//   - exposes a `pendingAssets` array the composer renders as chips
//   - exposes an `attachedAssetIds` array the chat hook sends to /v2/chat/stream
//
// Why XHR instead of fetch? `fetch` doesn't surface upload progress
// in any major browser without manually chunking. XHR's
// `upload.onprogress` is the path of least dependency and works on
// iPad Safari (the deployment target).
//
// Auth: includes the JWT (when present in localStorage) so the
// /v2/assets/upload route resolves the asset to the same user_id
// namespace as the chat request.
import { useCallback, useMemo, useRef, useState } from 'react';

const BUNDLED_BACKEND = 'https://api.korvixai.com';

function resolveAssetsUrl(): string {
  const envBase = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
  const base = envBase ? envBase.replace(/\/+$/, '') : BUNDLED_BACKEND;
  return `${base}/v2/assets`;
}

const ASSETS_URL: string = resolveAssetsUrl();

// 10 MB — must match backend ASSETS_MAX_BYTES default. We early-reject
// on the FE so the user gets feedback without burning bandwidth.
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;

// MIME allowlist for the chat-composer upload path. Mirrors the
// backend validator's accepted set — narrow to types the AI can
// actually reason about.
const ACCEPTED_MIME_PREFIXES = ['image/', 'video/'] as const;
const ACCEPTED_MIME_EXACT = new Set([
  'application/pdf',
  'text/plain',
  'text/markdown',
  'application/json',
  'text/csv',
]);

export type PendingAssetStatus = 'queued' | 'uploading' | 'ready' | 'failed' | 'cancelled';

export interface PendingAsset {
  // Local id — distinct from the server-issued asset_id so the UI can
  // refer to the chip even before the upload completes.
  localId:    string;
  filename:   string;
  mimeType:   string;
  sizeBytes:  number;
  status:     PendingAssetStatus;
  progress:   number;           // 0..100
  // Set once the server confirms persistence.
  assetId?:   string;
  publicUrl?: string;
  // Populated on failure.
  errorMessage?: string;
  // Local preview URL (image only). Revoked when the chip is dismissed.
  previewUrl?: string;
}

export interface UseAssetsOptions {
  projectId?: string;
  /** Override the per-upload byte cap. Defaults to 10 MB. */
  maxBytes?: number;
}

export interface UseAssetsResult {
  pendingAssets:    PendingAsset[];
  attachedAssetIds: string[];                // asset_ids ready to send with chat
  isUploading:      boolean;
  upload:           (files: FileList | File[]) => void;
  cancel:           (localId: string) => void;
  retry:            (localId: string) => void;
  dismiss:          (localId: string) => void;
  clearAll:         () => void;
  isAccepted:       (file: File) => boolean;
}

function getToken(): string | null {
  try { return localStorage.getItem('korvix_access_token'); }
  catch { return null; }
}

function getUserId(): string {
  // Mirrors the chat hook's korvix_user_id pattern so the asset upload
  // is associated with the same identity namespace as the chat request.
  try {
    const key = 'korvix_user_id';
    const id = localStorage.getItem(key);
    if (id) return id;
  } catch { /* ignore */ }
  return '';
}

function isAcceptedMime(mime: string): boolean {
  const m = (mime || '').toLowerCase();
  if (!m) return true;   // accept; backend validator is authoritative
  if (ACCEPTED_MIME_EXACT.has(m)) return true;
  return ACCEPTED_MIME_PREFIXES.some((p) => m.startsWith(p));
}

function nextLocalId(): string {
  // Cheap unique enough for ephemeral state.
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

/**
 * Upload manager. Construct once per composer instance.
 */
export function useAssets(opts: UseAssetsOptions = {}): UseAssetsResult {
  const projectId = opts.projectId;
  const maxBytes  = opts.maxBytes ?? DEFAULT_MAX_BYTES;

  const [pending, setPending] = useState<PendingAsset[]>([]);
  // Track in-flight XHRs per localId so cancel() and unmount can abort them
  // without leaking. WeakMap-style via a ref'd Map.
  const xhrsRef = useRef<Map<string, XMLHttpRequest>>(new Map());

  const isUploading = useMemo(
    () => pending.some((a) => a.status === 'uploading' || a.status === 'queued'),
    [pending],
  );

  const attachedAssetIds = useMemo(
    () => pending.filter((a) => a.status === 'ready' && !!a.assetId)
                 .map((a) => a.assetId!) as string[],
    [pending],
  );

  // Update one pending row by localId. Stable closure for callbacks.
  const updateRow = useCallback(
    (localId: string, patch: Partial<PendingAsset>) => {
      setPending((prev) => prev.map((a) => (a.localId === localId ? { ...a, ...patch } : a)));
    },
    [],
  );

  const startUpload = useCallback((row: PendingAsset, file: File) => {
    const url = `${ASSETS_URL}/upload`;
    const fd  = new FormData();
    fd.append('file', file, file.name || 'asset');
    if (projectId) fd.append('project_id', projectId);
    const userId = getUserId();
    if (userId) fd.append('user_id', userId);    // legacy parity

    const xhr = new XMLHttpRequest();
    xhrsRef.current.set(row.localId, xhr);

    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      const pct = Math.max(0, Math.min(100, Math.round((e.loaded / e.total) * 100)));
      updateRow(row.localId, { status: 'uploading', progress: pct });
    };

    xhr.onload = () => {
      xhrsRef.current.delete(row.localId);
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const body = JSON.parse(xhr.responseText);
          const asset = body?.data?.asset ?? {};
          updateRow(row.localId, {
            status:    'ready',
            progress:  100,
            assetId:   asset.id || undefined,
            publicUrl: asset.public_url || undefined,
          });
        } catch {
          updateRow(row.localId, {
            status:       'failed',
            errorMessage: 'Invalid server response',
          });
        }
        return;
      }
      // Try to surface the server's error code.
      let msg = `Upload failed (HTTP ${xhr.status})`;
      try {
        const body = JSON.parse(xhr.responseText);
        const code = body?.detail?.code || body?.error?.code;
        const txt  = body?.detail?.message || body?.error?.message;
        if (code === 'ASSET_SYSTEM_DISABLED') {
          msg = 'Asset uploads are disabled in this environment';
        } else if (txt) {
          msg = `${code ? `[${code}] ` : ''}${txt}`;
        }
      } catch { /* keep generic */ }
      updateRow(row.localId, { status: 'failed', errorMessage: msg });
    };

    xhr.onerror = () => {
      xhrsRef.current.delete(row.localId);
      updateRow(row.localId, {
        status:       'failed',
        errorMessage: 'Network error during upload',
      });
    };

    xhr.onabort = () => {
      xhrsRef.current.delete(row.localId);
      // We only flip to "cancelled" when the user explicitly cancelled;
      // a retry triggers abort+reupload and we don't want a flicker.
      // The cancel() helper sets status BEFORE calling abort, so the
      // current row is already "cancelled" — no state change here.
    };

    xhr.open('POST', url);
    const tok = getToken();
    if (tok) xhr.setRequestHeader('Authorization', `Bearer ${tok}`);
    xhr.send(fd);
  }, [projectId, updateRow]);

  const upload = useCallback((files: FileList | File[]) => {
    const list = Array.from(files);
    if (!list.length) return;
    const newRows: { row: PendingAsset; file: File }[] = [];
    for (const file of list) {
      // FE-side validation pre-flight. The backend re-validates;
      // this just gives the user faster feedback for the common
      // rejection cases.
      if (file.size > maxBytes) {
        const row: PendingAsset = {
          localId:      nextLocalId(),
          filename:     file.name,
          mimeType:     file.type || 'application/octet-stream',
          sizeBytes:    file.size,
          status:       'failed',
          progress:     0,
          errorMessage: `File exceeds ${Math.round(maxBytes / 1024 / 1024)} MB cap`,
        };
        newRows.push({ row, file });
        continue;
      }
      if (!isAcceptedMime(file.type)) {
        const row: PendingAsset = {
          localId:      nextLocalId(),
          filename:     file.name,
          mimeType:     file.type || 'application/octet-stream',
          sizeBytes:    file.size,
          status:       'failed',
          progress:     0,
          errorMessage: `Unsupported file type (${file.type || 'unknown'})`,
        };
        newRows.push({ row, file });
        continue;
      }
      // Generate a preview URL for images so the chip renders a thumbnail.
      let previewUrl: string | undefined;
      if (file.type.startsWith('image/')) {
        try { previewUrl = URL.createObjectURL(file); } catch { /* ignore */ }
      }
      const row: PendingAsset = {
        localId:    nextLocalId(),
        filename:   file.name || 'asset',
        mimeType:   file.type || 'application/octet-stream',
        sizeBytes:  file.size,
        status:     'queued',
        progress:   0,
        previewUrl,
      };
      newRows.push({ row, file });
    }
    if (!newRows.length) return;
    setPending((prev) => [...prev, ...newRows.map(({ row }) => row)]);
    // Kick uploads after state commits.
    for (const { row, file } of newRows) {
      if (row.status === 'queued') startUpload(row, file);
    }
  }, [maxBytes, startUpload]);

  const cancel = useCallback((localId: string) => {
    const xhr = xhrsRef.current.get(localId);
    setPending((prev) => prev.map((a) =>
      a.localId === localId ? { ...a, status: 'cancelled' } : a,
    ));
    if (xhr) {
      try { xhr.abort(); } catch { /* ignore */ }
      xhrsRef.current.delete(localId);
    }
  }, []);

  const retry = useCallback((localId: string) => {
    // We don't keep the original File object around (would leak memory);
    // retry is only available immediately after a failure within the
    // same composer state. The user clicks "remove" + re-attaches if
    // the chip has been dismissed. We mark it failed-with-retry-hint
    // so the chip surfaces the "Re-attach the file to retry" message.
    setPending((prev) => prev.map((a) =>
      a.localId === localId ? {
        ...a, status: 'failed', errorMessage: 'Re-attach the file to retry.',
      } : a,
    ));
  }, []);

  const dismiss = useCallback((localId: string) => {
    setPending((prev) => {
      const row = prev.find((a) => a.localId === localId);
      // Revoke any preview blob URL to avoid memory leaks.
      if (row?.previewUrl) {
        try { URL.revokeObjectURL(row.previewUrl); } catch { /* ignore */ }
      }
      // Abort if still in flight.
      const xhr = xhrsRef.current.get(localId);
      if (xhr) {
        try { xhr.abort(); } catch { /* ignore */ }
        xhrsRef.current.delete(localId);
      }
      return prev.filter((a) => a.localId !== localId);
    });
  }, []);

  const clearAll = useCallback(() => {
    setPending((prev) => {
      for (const row of prev) {
        if (row.previewUrl) {
          try { URL.revokeObjectURL(row.previewUrl); } catch { /* ignore */ }
        }
      }
      return [];
    });
    for (const xhr of xhrsRef.current.values()) {
      try { xhr.abort(); } catch { /* ignore */ }
    }
    xhrsRef.current.clear();
  }, []);

  return {
    pendingAssets:    pending,
    attachedAssetIds,
    isUploading,
    upload,
    cancel,
    retry,
    dismiss,
    clearAll,
    isAccepted: (file: File) =>
      file.size <= maxBytes && isAcceptedMime(file.type || ''),
  };
}

export default useAssets;
