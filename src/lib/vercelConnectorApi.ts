/**
 * Vercel connector — authenticated frontend client (minimal contract).
 *
 * Thin wrapper over the backend `/v2/vercel/*` surface, mirroring the exact
 * auth/API style of `gmailConnectorApi.ts` / `githubConnectorApi.ts`. This is
 * intentionally NOT the integrations UI — just the typed calls the Connectors
 * page wires up.
 *
 * The real backend contract (audited in backend/routes/v2_vercel.py) is a TWO
 * STEP flow, because a Vercel account routinely holds many projects:
 *   1. `connect/start` → redirect to Vercel's integration authorization screen;
 *      the callback stores the authorization and lands the connection in
 *      `pending_selection`.
 *   2. `pending-projects` → the user picks ONE, `connect/select` binds it after
 *      the backend re-verifies it live against Vercel.
 * The frontend never invents or types a Vercel project id — every id it sends
 * came from the server-provided list, and the backend revalidates it anyway.
 *
 * SECURITY: identity always comes from the backend session (Bearer token); the
 * client never sends a user id, and NO secret/token is ever handled here. The
 * OAuth exchange is backend-side — this client only receives the public
 * authorization URL and navigates the browser to it.
 *
 * READ-ONLY: there is deliberately no deploy/redeploy/rollback/env/domain call
 * in this module, because the backend exposes none.
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
export interface VercelConnectionView {
  project_id: string;
  provider: string;
  account_label: string;
  team_id: string | null;
  vercel_project_id: string | null;
  vercel_project_name: string | null;
  framework: string | null;
  production_url: string | null;
  status: 'pending_selection' | 'connected' | 'revoked' | string;
  connected: boolean;
  needs_project_selection: boolean;
  created_at: string;
  updated_at: string;
  last_sync_at: string | null;
}

export interface VercelConnectionStatus {
  connection: VercelConnectionView | null;
  connected: boolean;
}

/** A Vercel project this authorization can see (display metadata only). */
export interface VercelPendingProject {
  vercel_project_id: string;
  name: string;
  framework: string;
}

export interface VercelSyncReport {
  project_id: string;
  vercel_project_id: string;
  recorded: number;
  deduplicated: number;
  rejected: number;
  deployments: number;
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
    // Prefer the backend's structured error code/message when present (the
    // connector routes return `detail.message` for HTTPExceptions) — matches the
    // Gmail/GitHub clients so partial/failed states report the same truthful
    // reason.
    let message = body?.error || `Request failed (HTTP ${resp.status}).`;
    const detail = (body as unknown as { detail?: { message?: string } } | null)?.detail;
    if (detail?.message) message = detail.message;
    return { ok: false, status: resp.status, message };
  }
  return { ok: true, data: (body.data as T) };
}

/**
 * Begin the Vercel integration flow for a project the user owns. Returns the
 * Vercel authorization URL; the caller navigates the browser to it. The
 * one-time, ownership-bound state is created and stored server-side.
 */
export async function startVercelConnect(projectId: string) {
  return call<{ authorization_url: string; state: string }>(
    `/v2/vercel/projects/${encodeURIComponent(projectId)}/connect/start`,
    { method: 'POST' },
  );
}

/**
 * Convenience: start the flow and redirect the browser to Vercel's integration
 * authorization screen. Returns an error result (without navigating) when the
 * start call fails, so the caller can surface it.
 */
export async function beginVercelConnectRedirect(projectId: string) {
  const res = await startVercelConnect(projectId);
  if (res.ok) window.location.assign(res.data.authorization_url);
  return res;
}

/** Read the safe (token-free) connection status for a project. */
export async function getVercelConnection(projectId: string) {
  return call<VercelConnectionStatus>(
    `/v2/vercel/projects/${encodeURIComponent(projectId)}/connection`,
    { method: 'GET' },
  );
}

/**
 * The Vercel projects this authorization can bind, for the picker. Pass
 * `refresh` to force a live re-read from Vercel (the "change project" path);
 * the backend re-reads automatically when its stored list is empty or expired.
 */
export async function getVercelPendingProjects(projectId: string, refresh = false) {
  const qs = refresh ? '?refresh=true' : '';
  return call<{ projects: VercelPendingProject[]; count: number }>(
    `/v2/vercel/projects/${encodeURIComponent(projectId)}/pending-projects${qs}`,
    { method: 'GET' },
  );
}

/**
 * Finalize the connection by selecting one Vercel project. The id must come
 * from `getVercelPendingProjects`; the backend validates it against that
 * server-stored list AND re-verifies it live against Vercel before binding.
 */
export async function selectVercelProject(projectId: string, vercelProjectId: string) {
  return call<{ connection: VercelConnectionView }>(
    `/v2/vercel/projects/${encodeURIComponent(projectId)}/connect/select`,
    { method: 'POST', body: JSON.stringify({ vercel_project_id: vercelProjectId }) },
  );
}

/** Run the bounded, read-only Vercel sync for a connected project. */
export async function syncVercel(projectId: string) {
  return call<{ sync: VercelSyncReport }>(
    `/v2/vercel/projects/${encodeURIComponent(projectId)}/sync`,
    { method: 'POST' },
  );
}

/**
 * Disconnect: deletes the LOCAL credential + binding for this project. It does
 * not (and cannot) change anything in the user's Vercel account.
 */
export async function disconnectVercel(projectId: string) {
  return call<{ removed: boolean; connected: boolean }>(
    `/v2/vercel/projects/${encodeURIComponent(projectId)}/connection`,
    { method: 'DELETE' },
  );
}
