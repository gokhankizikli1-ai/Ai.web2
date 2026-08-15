/**
 * Google Calendar connector — authenticated frontend client.
 *
 * Thin wrapper over the backend `/v2/calendar/*` surface, mirroring
 * `gmailConnectorApi.ts` / `vercelConnectorApi.ts` exactly — same envelope
 * handling, same error shape, same redirect helper. No separate settings
 * system, no second API client pattern.
 *
 * SECURITY: identity always comes from the backend session (Bearer token); the
 * client never sends a user id, and NO secret/token is ever handled here. The
 * OAuth flow is started backend-side — this client only receives the public
 * Google authorization URL and navigates the browser to it. The client secret
 * and refresh token never reach the browser.
 *
 * READ-ONLY: there is deliberately no call here that could create, edit, move,
 * or delete a calendar event — the backend has no such route and the granted
 * scope (calendar.events.readonly) could not perform one.
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
export interface CalendarConnectionView {
  project_id: string;
  provider: string;
  /** The connected primary calendar's label (the account address). */
  google_email: string;
  calendar_id: string;
  time_zone: string;
  scopes: string[];
  status: 'connected' | 'revoked' | string;
  connected: boolean;
  created_at: string;
  updated_at: string;
  last_sync_at: string | null;
}

export interface CalendarConnectionStatus {
  connection: CalendarConnectionView | null;
  connected: boolean;
}

export interface CalendarSyncReport {
  project_id: string;
  calendar_id: string;
  google_email: string;
  recorded: number;
  deduplicated: number;
  rejected: number;
  events: number;
  /** The bounded RFC3339 read window the backend actually used. */
  window_start: string;
  window_end: string;
  errors: Record<string, string>;
  ok: boolean;
}

export interface CalendarDisconnectResult {
  removed: boolean;
  connected: boolean;
  /**
   * Whether the grant was ALSO revoked at Google. False when Korvix skipped the
   * remote revoke because another Google connector (e.g. Gmail) still uses the
   * same shared grant — the local credentials are removed either way.
   */
  revoked_remotely: boolean;
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
    // routes return `detail.message` for HTTPExceptions) — matches the
    // Gmail/GitHub/Vercel clients so partial/failed states report the same
    // truthful reason.
    let message = body?.error || `Request failed (HTTP ${resp.status}).`;
    const detail = (body as unknown as { detail?: { message?: string } } | null)?.detail;
    if (detail?.message) message = detail.message;
    return { ok: false, status: resp.status, message };
  }
  return { ok: true, data: (body.data as T) };
}

/**
 * Begin the Google Calendar OAuth flow for a project the user owns. Returns the
 * Google authorization URL; the caller navigates the browser to it. The
 * one-time, ownership-bound state is created and stored server-side.
 */
export async function startCalendarConnect(projectId: string) {
  return call<{ authorization_url: string; state: string; scopes: string[] }>(
    `/v2/calendar/projects/${encodeURIComponent(projectId)}/connect/start`,
    { method: 'POST' },
  );
}

/** Read the safe (token-free) connection status for a project. */
export async function getCalendarConnection(projectId: string) {
  return call<CalendarConnectionStatus>(
    `/v2/calendar/projects/${encodeURIComponent(projectId)}/connection`,
    { method: 'GET' },
  );
}

/** Run the bounded, read-only Calendar sync for a connected project. */
export async function syncCalendar(projectId: string) {
  return call<{ sync: CalendarSyncReport }>(
    `/v2/calendar/projects/${encodeURIComponent(projectId)}/sync`,
    { method: 'POST' },
  );
}

/** Disconnect (delete stored credentials, revoke at Google when safe). */
export async function disconnectCalendar(projectId: string) {
  return call<CalendarDisconnectResult>(
    `/v2/calendar/projects/${encodeURIComponent(projectId)}/connection`,
    { method: 'DELETE' },
  );
}

/**
 * Convenience: start the flow and redirect the browser to Google's consent
 * screen. Returns an error result (without navigating) when the start call
 * fails, so the caller can surface it.
 */
export async function beginCalendarConnectRedirect(projectId: string) {
  const res = await startCalendarConnect(projectId);
  if (res.ok) {
    window.location.assign(res.data.authorization_url);
  }
  return res;
}
