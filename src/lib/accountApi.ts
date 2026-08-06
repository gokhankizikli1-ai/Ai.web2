/**
 * Account settings — authenticated frontend client.
 *
 * Thin wrapper over the existing `PATCH /auth/me`. Identity always comes from the
 * backend session (Bearer token) — the client never sends a user id. Only the
 * display name is updated; email/role/plan are never touched.
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

export type UpdateDisplayNameResult =
  | { ok: true; displayName: string }
  | { ok: false; code: 'invalid' | 'unauthorized' | 'error'; message: string };

/**
 * Update the authenticated user's display name. The backend normalizes + bounds
 * the value and derives the user from the session token. Returns a typed result
 * the Settings UI switches on; never throws.
 */
export async function updateDisplayName(
  displayName: string,
  opts?: { signal?: AbortSignal },
): Promise<UpdateDisplayNameResult> {
  let resp: Response;
  try {
    resp = await fetch(`${apiBase()}/auth/me`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({ display_name: displayName }),
      signal: opts?.signal,
    });
  } catch {
    return { ok: false, code: 'error', message: 'Could not reach the server.' };
  }

  let body: unknown = null;
  try { body = await resp.json(); } catch { /* keep null */ }

  if (resp.status === 401) {
    return { ok: false, code: 'unauthorized', message: 'Please sign in again.' };
  }
  if (resp.status === 422) {
    const detail = (body as { detail?: { message?: string } } | null)?.detail;
    return { ok: false, code: 'invalid', message: detail?.message || 'That name is not valid.' };
  }
  if (!resp.ok) {
    return { ok: false, code: 'error', message: `Update failed (HTTP ${resp.status}).` };
  }

  const user = (body as { user?: { display_name?: string } } | null)?.user;
  return { ok: true, displayName: typeof user?.display_name === 'string' ? user.display_name : displayName };
}
