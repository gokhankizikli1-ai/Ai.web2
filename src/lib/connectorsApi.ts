/**
 * connectorsApi — the ACCOUNT-LEVEL connector client.
 *
 * Thin wrapper over the backend `/v2/connectors/*` surface: "which tools is my
 * Korvix ACCOUNT connected to, and which of my projects use them". Provider-
 * specific work (OAuth exchange, listing repos/Vercel projects/Slack channels,
 * revalidating a chosen resource, running the bounded read) still lives in the
 * per-provider clients — this module never duplicates it.
 *
 * SECURITY: identity always comes from the backend session (Bearer token); the
 * client never sends a user id or an authorization id, and NO secret ever passes
 * through here. The OAuth flow is started backend-side — this client only
 * receives the public authorization URL and navigates the browser to it.
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

/** What a project binds for this provider — providers are NOT interchangeable. */
export type ResourceKind = 'account' | 'single' | 'multi';

export type ProviderId = 'gmail' | 'calendar' | 'github' | 'vercel' | 'slack';

export interface BoundResource {
  resource_id: string | null;
  resource_label: string | null;
  resource: Record<string, unknown>;
  status: string;
  last_sync_at: string | null;
}

export interface AuthorizationProjectUsage {
  project_id: string;
  project_name: string;
  status: string;
  resources: BoundResource[];
  resource_count: number;
  last_sync_at: string | null;
}

/** Account-level authorization state. Carries NO credential material. */
export interface ConnectorAuthorization {
  id: string;
  provider: string;
  account_label: string;
  scopes: string[];
  status: 'authorized' | 'revoked' | string;
  authorized: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  last_sync_at: string | null;
  project_count: number;
  projects: AuthorizationProjectUsage[];
}

export interface ConnectorSummary {
  provider: ProviderId | string;
  label: string;
  resource_kind: ResourceKind | string;
  resource_noun: string;
  requires_resource_selection: boolean;
  /** False when the deployment has this connector switched off. */
  enabled: boolean;
  authorization: ConnectorAuthorization | null;
}

export interface ConnectorProjectRow {
  project_id: string;
  project_name: string;
  bound: boolean;
  status: string | null;
  resources: BoundResource[];
}

type Envelope<T> = { success: boolean; data: T | null; error: string | null };

export type CallResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; message: string };

async function call<T>(path: string, init: RequestInit): Promise<CallResult<T>> {
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
    // routes return `detail.message` for HTTPExceptions) so a failed state
    // reports the same truthful reason the API gave.
    let message = body?.error || `Request failed (HTTP ${resp.status}).`;
    const detail = (body as unknown as { detail?: { message?: string } } | null)?.detail;
    if (detail?.message) message = detail.message;
    return { ok: false, status: resp.status, message };
  }
  return { ok: true, data: body.data as T };
}

/** Every connector, with THIS ACCOUNT's authorization state and project usage. */
export async function listConnectors() {
  return call<{ connectors: ConnectorSummary[] }>('/v2/connectors', { method: 'GET' });
}

/** One connector's account-level state. */
export async function getConnector(provider: string) {
  return call<ConnectorSummary>(
    `/v2/connectors/${encodeURIComponent(provider)}`, { method: 'GET' });
}

/**
 * Begin the provider's OAuth/install flow for the ACCOUNT — no project. The
 * one-time state is minted and stored server-side, bound to the authenticated
 * user; this client only navigates to the returned public URL.
 */
export async function startAccountConnect(provider: string) {
  return call<{
    authorization_url: string; state: string; scopes: string[];
    /** GitHub only: where to send a user who authorized but has not installed
     *  the App on any account (the `needs_install` outcome). Server-built. */
    install_url?: string;
  }>(`/v2/connectors/${encodeURIComponent(provider)}/connect/start`, { method: 'POST' });
}

/** Convenience: start the flow and redirect. Returns the error result without
 *  navigating when the start call fails, so the caller can surface it.
 *
 *  `useInstallUrl` targets the provider's INSTALL screen instead of its
 *  authorize screen — the only way out of GitHub's `needs_install` outcome,
 *  where re-running authorize would loop the user. Falls back to the authorize
 *  URL when the provider has no separate install step. */
export async function beginAccountConnectRedirect(provider: string, useInstallUrl = false) {
  const res = await startAccountConnect(provider);
  if (res.ok) {
    const target = (useInstallUrl && res.data.install_url) || res.data.authorization_url;
    window.location.assign(target);
  }
  return res;
}

/** Which of the caller's projects use this connector (the "Use in projects" list). */
export async function listConnectorProjects(provider: string) {
  return call<{ authorized: boolean; projects: ConnectorProjectRow[] }>(
    `/v2/connectors/${encodeURIComponent(provider)}/projects`, { method: 'GET' });
}

/**
 * Let a project use the account's authorization. NO OAuth is involved — that is
 * the point of the account-level model.
 *
 * For a resource provider the binding starts as `pending_selection`;
 * `requires_resource_selection` in the response tells the UI to send the user to
 * that provider's own picker, which re-verifies every id live.
 */
export async function bindConnectorToProject(provider: string, projectId: string) {
  return call<{ connection: Record<string, unknown>; requires_resource_selection: boolean }>(
    `/v2/connectors/${encodeURIComponent(provider)}/projects/${encodeURIComponent(projectId)}`,
    { method: 'PUT', body: JSON.stringify({}) },
  );
}

/**
 * REMOVE FROM PROJECT — drops ONE project's binding. The provider authorization
 * survives and every other project keeps working;
 * `authorization_still_connected` reports that truthfully.
 */
export async function unbindConnectorFromProject(provider: string, projectId: string) {
  return call<{
    removed: boolean; bound: boolean;
    authorization_still_connected: boolean; remaining_projects: number;
  }>(
    `/v2/connectors/${encodeURIComponent(provider)}/projects/${encodeURIComponent(projectId)}`,
    { method: 'DELETE' },
  );
}

/**
 * DISCONNECT PROVIDER ACCOUNT — removes the authorization and EVERY project
 * binding on it. `projects_affected` is what the confirmation dialog must show.
 */
export async function disconnectConnectorAccount(provider: string) {
  return call<{
    removed: boolean; authorized: boolean;
    revoked_remotely: boolean; projects_affected: number;
  }>(`/v2/connectors/${encodeURIComponent(provider)}`, { method: 'DELETE' });
}

export interface AccountSyncResult {
  project_id: string;
  ok: boolean;
  reason?: string;
  sync?: Record<string, unknown>;
}

/** Run the provider's bounded read once per bound project (binding-level sync). */
export async function syncConnectorAccount(provider: string) {
  return call<{ results: AccountSyncResult[]; projects: number }>(
    `/v2/connectors/${encodeURIComponent(provider)}/sync`, { method: 'POST' });
}
