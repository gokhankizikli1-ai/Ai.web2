/**
 * Gmail connector — authenticated frontend client (minimal contract).
 *
 * Thin wrapper over the backend `/v2/gmail/*` surface. This is intentionally
 * NOT the integrations UI — just the typed calls a settings page will later
 * wire up, mirroring the conventions in `accountApi.ts` / `billingApi.ts`.
 *
 * SECURITY: identity always comes from the backend session (Bearer token); the
 * client never sends a user id, and NO secret/token is ever handled here. The
 * OAuth flow is started backend-side — this client only receives the public
 * Google authorization URL and navigates the browser to it. The client secret
 * and refresh token never reach the browser.
 */

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
  } catch { /* localStorage may be disabled */ }
  return h;
}

/** Safe, token-free connection metadata as returned by the backend. */
export interface GmailConnectionView {
  project_id: string;
  provider: string;
  google_email: string;
  scopes: string[];
  status: 'connected' | 'revoked' | string;
  connected: boolean;
  created_at: string;
  updated_at: string;
  last_sync_at: string | null;
}

export interface GmailConnectionStatus {
  connection: GmailConnectionView | null;
  connected: boolean;
}

export interface GmailSyncReport {
  project_id: string;
  google_email: string;
  recorded: number;
  deduplicated: number;
  rejected: number;
  fetched: number;
  skipped: number;
  errors: Record<string, string>;
  ok: boolean;
}

type Envelope<T> = { success: boolean; data: T | null; error: string | null };

async function call<T>(
  path: string,
  init: RequestInit,
): Promise<{ ok: true; data: T } | { ok: false; status: number; message: string }> {
  let resp: Response;
  try {
    resp = await fetch(`${apiBase()}${path}`, { ...init, headers: authHeaders() });
  } catch {
    return { ok: false, status: 0, message: 'Could not reach the server.' };
  }
  let body: Envelope<T> | null = null;
  try { body = (await resp.json()) as Envelope<T>; } catch { /* keep null */ }
  if (!resp.ok || !body?.success) {
    // Prefer the backend's structured error message when present (the connector
    // routes return `detail.message` for HTTPExceptions) — matches the GitHub
    // client so partial/failed states report the same truthful reason.
    let message = body?.error || `Request failed (HTTP ${resp.status}).`;
    const detail = (body as unknown as { detail?: { message?: string } } | null)?.detail;
    if (detail?.message) message = detail.message;
    return { ok: false, status: resp.status, message };
  }
  return { ok: true, data: (body.data as T) };
}

/**
 * Begin the Gmail OAuth flow for a project the user owns. Returns the Google
 * authorization URL; the caller navigates the browser to it. The one-time,
 * ownership-bound state is created and stored server-side.
 */
export async function startGmailConnect(projectId: string) {
  return call<{ authorization_url: string; state: string; scopes: string[] }>(
    `/v2/gmail/projects/${encodeURIComponent(projectId)}/connect/start`,
    { method: 'POST' },
  );
}

/** Read the safe (token-free) connection status for a project. */
export async function getGmailConnection(projectId: string) {
  return call<GmailConnectionStatus>(
    `/v2/gmail/projects/${encodeURIComponent(projectId)}/connection`,
    { method: 'GET' },
  );
}

/** Run the bounded, read-only Gmail sync for a connected project. */
export async function syncGmail(projectId: string) {
  return call<{ sync: GmailSyncReport }>(
    `/v2/gmail/projects/${encodeURIComponent(projectId)}/sync`,
    { method: 'POST' },
  );
}

/** Disconnect (revoke + delete stored credentials) for a project. */
export async function disconnectGmail(projectId: string) {
  return call<{ removed: boolean; connected: boolean }>(
    `/v2/gmail/projects/${encodeURIComponent(projectId)}/connection`,
    { method: 'DELETE' },
  );
}

/**
 * Convenience: start the flow and redirect the browser to Google's consent
 * screen. Returns an error result (without navigating) when the start call
 * fails, so the caller can surface it.
 */
export async function beginGmailConnectRedirect(projectId: string) {
  const res = await startGmailConnect(projectId);
  if (res.ok) {
    window.location.assign(res.data.authorization_url);
  }
  return res;
}
