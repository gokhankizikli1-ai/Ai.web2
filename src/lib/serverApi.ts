/**
 * serverApi — the single best-effort JSON client for the Korvix backend.
 *
 * Resolves the same API base + bearer identity every user-owned store uses, and
 * returns the v2 envelope's `data` (or null on any failure). Shared by the chat
 * sync + project-linkage clients so there is exactly one place that knows how to
 * reach the backend and attach auth.
 */
import { getAccessToken } from '@/stores/authStore';

const BUNDLED_BACKEND = 'https://worker-production-1345.up.railway.app';

export function apiBase(): string {
  const env = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
  return env ? env.replace(/\/+$/, '') : BUNDLED_BACKEND;
}

export function authHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    const t = getAccessToken();
    if (t) h['Authorization'] = `Bearer ${t}`;
  } catch {
    /* token unreadable — request resolves as guest */
  }
  return h;
}

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
}

/** Best-effort call returning the envelope's `data` or null. Never throws. */
export async function apiCall<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T | null> {
  const res = await apiCallDetailed<T>(method, path, body);
  return res.data;
}

/** Like `apiCall` but also surfaces ok/status so callers can distinguish a
 *  404 (e.g. not-owned / not-found) from a transient failure. Never throws. */
export async function apiCallDetailed<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`${apiBase()}${path}`, {
      method,
      headers: authHeaders(),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json || json.success === false) {
      return { ok: false, status: res.status, data: null };
    }
    return { ok: true, status: res.status, data: (json.data ?? null) as T | null };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}
