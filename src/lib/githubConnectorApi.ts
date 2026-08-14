/**
 * GitHub connector — authenticated frontend client (minimal contract).
 *
 * Thin wrapper over the backend `/v2/github/*` surface, mirroring the exact
 * auth/API style of `gmailConnectorApi.ts`. This is intentionally NOT the
 * integrations UI — just the typed calls the Connectors page wires up.
 *
 * IMPORTANT — the real backend contract (audited in backend/routes/v2_github.py):
 * the GitHub connector is a **GitHub App installation** model, NOT a browser
 * OAuth redirect. Connecting links a project to `repo_full_name` (+ an App
 * `installation_id`); the backend falls back to GITHUB_DEFAULT_INSTALLATION_ID
 * when the id is omitted (dev). There is deliberately no "connect/start"
 * redirect endpoint here because the backend does not expose one.
 *
 * SECURITY: identity always comes from the backend session (Bearer token); the
 * client never sends a user id, and no secret/token is ever handled here.
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
export interface GithubConnectionView {
  project_id: string;
  installation_id: string;
  repo_full_name: string;
  repo_id: string;
  created_at: string;
  updated_at: string;
}

export interface GithubConnectionStatus {
  connection: GithubConnectionView | null;
  connected: boolean;
}

/** A repository the verified pending installation can access (token-free). */
export interface GithubRepo {
  id: string;
  full_name: string;
  name: string;
  owner: string;
  private: boolean;
  archived: boolean;
}

export interface GithubSyncReport {
  project_id: string;
  repo: string;
  recorded: number;
  deduplicated: number;
  rejected: number;
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
    // GitHub routes return `detail.message` for HTTPExceptions).
    let message = body?.error || `Request failed (HTTP ${resp.status}).`;
    const detail = (body as unknown as { detail?: { message?: string } } | null)?.detail;
    if (detail?.message) message = detail.message;
    return { ok: false, status: resp.status, message };
  }
  return { ok: true, data: (body.data as T) };
}

/**
 * Begin the real GitHub App installation flow for a project the user owns.
 * Returns the App install URL; the caller navigates the browser to it. The
 * installation id and repo are chosen on GitHub / picked from the verified
 * server-side list afterwards — never typed by the user.
 */
export async function startGithubConnect(projectId: string) {
  return call<{ install_url: string; state: string }>(
    `/v2/github/projects/${encodeURIComponent(projectId)}/connect/start`,
    { method: 'POST' },
  );
}

/**
 * Convenience: start the install flow and redirect the browser to GitHub's App
 * install screen. Returns an error result (without navigating) when the start
 * call fails, so the caller can surface it.
 */
export async function beginGithubConnectRedirect(projectId: string) {
  const res = await startGithubConnect(projectId);
  if (res.ok) window.location.assign(res.data.install_url);
  return res;
}

/**
 * Repositories the verified pending installation can access, for the connect
 * picker. 404 means there is no pending installation for this project (the user
 * hasn't installed the App yet, or it expired).
 */
export async function getGithubPendingRepositories(projectId: string) {
  return call<{ repositories: GithubRepo[]; count: number }>(
    `/v2/github/projects/${encodeURIComponent(projectId)}/pending-installation/repositories`,
    { method: 'GET' },
  );
}

/**
 * Finalize the connection by selecting a repo from the pending installation.
 * The backend re-validates the repo against the installation server-side and
 * binds it via the authoritative connection store. No installation id is sent.
 */
export async function selectGithubRepository(projectId: string, repoFullName: string) {
  return call<{ connection: GithubConnectionView }>(
    `/v2/github/projects/${encodeURIComponent(projectId)}/connect/select`,
    { method: 'POST', body: JSON.stringify({ repo_full_name: repoFullName }) },
  );
}

/**
 * Low-level link of a project to a GitHub repo + App installation. Retained for
 * backward compatibility / scripting; the normal UI uses the install flow above
 * so the user never types an installation id or repo name.
 */
export async function connectGithub(
  projectId: string,
  opts: { repoFullName: string; installationId?: string; repoId?: string },
) {
  const body: Record<string, string> = { repo_full_name: opts.repoFullName };
  if (opts.installationId) body.installation_id = opts.installationId;
  if (opts.repoId) body.repo_id = opts.repoId;
  return call<{ connection: GithubConnectionView }>(
    `/v2/github/projects/${encodeURIComponent(projectId)}/connect`,
    { method: 'POST', body: JSON.stringify(body) },
  );
}

/** Read the safe (token-free) connection status for a project. */
export async function getGithubConnection(projectId: string) {
  return call<GithubConnectionStatus>(
    `/v2/github/projects/${encodeURIComponent(projectId)}/connection`,
    { method: 'GET' },
  );
}

/** Run the bounded, read-only GitHub backfill for a connected project. */
export async function syncGithub(projectId: string) {
  return call<{ sync: GithubSyncReport }>(
    `/v2/github/projects/${encodeURIComponent(projectId)}/sync`,
    { method: 'POST' },
  );
}

/** Disconnect (remove the repo↔project link) for a project. */
export async function disconnectGithub(projectId: string) {
  return call<{ removed: boolean }>(
    `/v2/github/projects/${encodeURIComponent(projectId)}/connection`,
    { method: 'DELETE' },
  );
}
