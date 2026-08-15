/**
 * Slack connector — authenticated frontend client (minimal contract).
 *
 * Thin wrapper over the backend `/v2/slack/*` surface, mirroring the exact
 * auth/API style of `vercelConnectorApi.ts` / `gmailConnectorApi.ts`. This is
 * intentionally NOT the integrations UI — just the typed calls the Connectors
 * page wires up.
 *
 * The real backend contract (audited in backend/routes/v2_slack.py) is a TWO
 * STEP flow, because a workspace routinely holds hundreds of channels and only
 * a few relate to a given Korvix project:
 *   1. `connect/start` → redirect to Slack's install screen; the callback stores
 *      the workspace installation and lands the connection in
 *      `pending_selection`.
 *   2. `pending-channels` → the user picks one or more, `connect/select` binds
 *      them after the backend re-verifies each one live against Slack.
 * The frontend never invents or types a channel id — every id it sends came
 * from the server-provided list, and the backend revalidates it anyway.
 *
 * `is_member` IS PART OF THE CONTRACT, NOT A HINT
 * A Slack bot can only read the history of a channel it belongs to, so the
 * picker must show which channels are actually connectable. The backend refuses
 * to bind a non-member channel; the UI uses this flag to explain why before the
 * user tries.
 *
 * SECURITY: identity always comes from the backend session (Bearer token); the
 * client never sends a user id, and NO secret/token is ever handled here. The
 * OAuth exchange is backend-side — this client only receives the public
 * authorization URL and navigates the browser to it.
 *
 * READ-ONLY: there is deliberately no post/edit/delete/react/invite/file call in
 * this module, because the backend exposes none.
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

/** A Slack channel bound to this project (display metadata only). */
export interface SlackBoundChannel {
  channel_id: string;
  name: string;
  is_private: boolean;
}

/** Safe, token-free connection metadata as returned by the backend. */
export interface SlackConnectionView {
  project_id: string;
  provider: string;
  team_id: string | null;
  team_name: string | null;
  bot_user_id: string | null;
  scopes: string[];
  channels: SlackBoundChannel[];
  channel_count: number;
  status: 'pending_selection' | 'connected' | 'revoked' | string;
  connected: boolean;
  needs_channel_selection: boolean;
  created_at: string;
  updated_at: string;
  last_sync_at: string | null;
}

export interface SlackConnectionStatus {
  connection: SlackConnectionView | null;
  connected: boolean;
}

/**
 * A channel this installation can see. `is_member` is Slack's own truth about
 * whether Korvix can read it — a non-member channel is listed (so the user knows
 * it exists) but cannot be connected until Korvix is invited to it in Slack.
 */
export interface SlackPendingChannel {
  channel_id: string;
  name: string;
  is_private: boolean;
  is_member: boolean;
}

export interface SlackPendingChannels {
  channels: SlackPendingChannel[];
  count: number;
  /** Server-enforced cap on how many channels one project may bind. */
  max_selected: number;
}

export interface SlackSyncReport {
  project_id: string;
  team_id: string;
  channels: number;
  channels_read: number;
  messages: number;
  threads: number;
  recorded: number;
  deduplicated: number;
  rejected: number;
  window_start: string;
  /** A configured bound clipped the read (not a failure). */
  truncated: boolean;
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
    // other connector clients so partial/failed states report the same truthful
    // reason.
    let message = body?.error || `Request failed (HTTP ${resp.status}).`;
    const detail = (body as unknown as { detail?: { message?: string } } | null)?.detail;
    if (detail?.message) message = detail.message;
    return { ok: false, status: resp.status, message };
  }
  return { ok: true, data: (body.data as T) };
}

/**
 * Begin the Slack install flow for a project the user owns. Returns the Slack
 * authorization URL; the caller navigates the browser to it. The one-time,
 * ownership-bound state is created and stored server-side.
 */
export async function startSlackConnect(projectId: string) {
  return call<{ authorization_url: string; state: string; scopes: string[] }>(
    `/v2/slack/projects/${encodeURIComponent(projectId)}/connect/start`,
    { method: 'POST' },
  );
}

/**
 * Convenience: start the flow and redirect the browser to Slack's install
 * screen. Returns an error result (without navigating) when the start call
 * fails, so the caller can surface it.
 */
export async function beginSlackConnectRedirect(projectId: string) {
  const res = await startSlackConnect(projectId);
  if (res.ok) window.location.assign(res.data.authorization_url);
  return res;
}

/** Read the safe (token-free) connection status for a project. */
export async function getSlackConnection(projectId: string) {
  return call<SlackConnectionStatus>(
    `/v2/slack/projects/${encodeURIComponent(projectId)}/connection`,
    { method: 'GET' },
  );
}

/**
 * The Slack channels this installation can see, for the picker. Pass `refresh`
 * to force a live re-read from Slack (the "change channels" path); the backend
 * re-reads automatically when its stored list is empty or expired.
 */
export async function getSlackPendingChannels(projectId: string, refresh = false) {
  const qs = refresh ? '?refresh=true' : '';
  return call<SlackPendingChannels>(
    `/v2/slack/projects/${encodeURIComponent(projectId)}/pending-channels${qs}`,
    { method: 'GET' },
  );
}

/**
 * Finalize the connection by selecting one or more channels. Every id must come
 * from `getSlackPendingChannels`; the backend validates each against that
 * server-stored list, re-verifies it live against Slack, and refuses any channel
 * Korvix is not actually a member of.
 */
export async function selectSlackChannels(projectId: string, channelIds: string[]) {
  return call<{ connection: SlackConnectionView }>(
    `/v2/slack/projects/${encodeURIComponent(projectId)}/connect/select`,
    { method: 'POST', body: JSON.stringify({ channel_ids: channelIds }) },
  );
}

/** Run the bounded, read-only Slack sync for a connected project. */
export async function syncSlack(projectId: string) {
  return call<{ sync: SlackSyncReport }>(
    `/v2/slack/projects/${encodeURIComponent(projectId)}/sync`,
    { method: 'POST' },
  );
}

/**
 * Disconnect: deletes the LOCAL credential + channel bindings for this project.
 * It does not (and cannot) change anything in the user's Slack workspace —
 * `workspace_still_connected` reports whether another Korvix project still uses
 * the same workspace installation.
 */
export async function disconnectSlack(projectId: string) {
  return call<{ removed: boolean; connected: boolean; workspace_still_connected: boolean }>(
    `/v2/slack/projects/${encodeURIComponent(projectId)}/connection`,
    { method: 'DELETE' },
  );
}
