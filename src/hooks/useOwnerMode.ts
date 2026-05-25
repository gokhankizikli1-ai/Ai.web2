/**
 * useOwnerMode — Owner / Admin Mode detection.
 *
 * Calls GET /v2/admin/status once on mount and caches the result. The
 * endpoint always returns 200; `is_owner=false` is the normal answer
 * for every non-owner user. The frontend uses this signal to decide
 * whether to render the Admin badge and Admin Panel.
 *
 * Two unlock paths sent to the backend:
 *
 *   A. Bearer token from /v2/auth/* (localStorage 'korvix_access_token')
 *      Used when the browser ran the JWT auth flow. Backend resolves
 *      User → checks OWNER_EMAIL / OWNER_ID against the User identity.
 *
 *   B. Shared-secret owner token (localStorage 'korvix_owner_token')
 *      Used when the FE only has the zustand local-auth session.
 *      Sent as X-Korvix-Owner-Token; backend constant-time compares
 *      to OWNER_TOKEN. Activate by running this once in the browser
 *      console after the owner has the secret from Railway env:
 *
 *        localStorage.setItem('korvix_owner_token', '<the-secret>')
 *
 * The hook also passes the locally-known user email as a HINT header
 * (X-Korvix-Owner-Email) so the backend's debug payload can show the
 * mismatch explicitly. The hint is NOT trusted as authentication —
 * the backend only consults OWNER_TOKEN and the bearer-derived User
 * for actual ownership decisions.
 *
 * Failure modes:
 *   - 404 (admin mode disabled on backend) → isOwner=false, error=null
 *   - any other failure                    → isOwner=false, error set
 *
 * NEVER throws to consumers. The badge component reads isOwner and
 * silently renders nothing when it's false. The debug payload is
 * surfaced to the AdminPanel only — never to non-owners.
 */
import { useEffect, useState, useCallback } from 'react';

const DEFAULT_API_HOST = 'https://korvixai-backend-production.up.railway.app';
const API_BASE = `${
  (import.meta.env?.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ||
  DEFAULT_API_HOST
}`;

const ADMIN_STATUS_URL = `${API_BASE}/v2/admin/status`;

/** Backend's detection_debug() projection. Surface only to confirmed owners. */
export interface OwnerDebug {
  enable_admin_mode: boolean;
  owner_email_set: boolean;
  owner_email_count: number;
  owner_id_set: boolean;
  owner_id_count: number;
  owner_token_set: boolean;
  owner_token_present_in_request: boolean;
  owner_token_matches: boolean;
  user_present: boolean;
  user_kind: string | null;
  user_is_guest: boolean | null;
  user_email_observed: string;
  user_email_match: boolean;
  user_id_match: boolean;
  first_failure: string | null;
}

export interface OwnerCapabilities {
  is_owner: boolean;
  admin_mode: boolean;
  capabilities: string[];
  debug?: OwnerDebug;
}

export interface OwnerModeState {
  isOwner: boolean;
  capabilities: string[];
  loading: boolean;
  /** null when admin mode is disabled (404) or status was never fetched. */
  error: string | null;
  /** Populated for confirmed owners; undefined for non-owners. */
  debug?: OwnerDebug;
  refresh: () => void;
}

const DEFAULT_STATE: OwnerCapabilities = {
  is_owner: false,
  admin_mode: false,
  capabilities: [],
};

/* ─── localStorage readers (defensive) ──────────────────────────────────── */

function readAccessToken(): string | null {
  try { return localStorage.getItem('korvix_access_token'); }
  catch { return null; }
}

function readOwnerToken(): string | null {
  try { return localStorage.getItem('korvix_owner_token'); }
  catch { return null; }
}

function readGuestId(): string {
  try { return localStorage.getItem('korvix_user_id') || ''; }
  catch { return ''; }
}

/** Best-effort read of the locally-authenticated email from zustand persist. */
function readLocalEmail(): string {
  try {
    const raw = localStorage.getItem('korvix-auth');
    if (!raw) return '';
    const parsed = JSON.parse(raw) as { state?: { user?: { email?: string } } };
    return parsed?.state?.user?.email?.trim().toLowerCase() || '';
  } catch {
    return '';
  }
}

function readDebugFlag(): boolean {
  try { return localStorage.getItem('korvix_debug') === '1'; }
  catch { return false; }
}

/* ─── Hook ──────────────────────────────────────────────────────────────── */

export function useOwnerMode(): OwnerModeState {
  const [data, setData] = useState<OwnerCapabilities>(DEFAULT_STATE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    const debugMode = readDebugFlag();
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      const bearer = readAccessToken();
      if (bearer) headers['Authorization'] = `Bearer ${bearer}`;

      const ownerToken = readOwnerToken();
      if (ownerToken) headers['X-Korvix-Owner-Token'] = ownerToken;

      const localEmail = readLocalEmail();
      if (localEmail) headers['X-Korvix-Owner-Email'] = localEmail;

      const guest = readGuestId();
      if (guest) headers['X-Korvix-Guest-Id'] = guest;

      const r = await fetch(ADMIN_STATUS_URL, { method: 'GET', headers });
      if (r.status === 404) {
        if (debugMode) {
          // eslint-disable-next-line no-console
          console.debug('[useOwnerMode] /v2/admin/status returned 404 — admin mode disabled on backend');
        }
        setData(DEFAULT_STATE);
        return;
      }
      if (!r.ok) {
        if (debugMode) {
          // eslint-disable-next-line no-console
          console.debug('[useOwnerMode] /v2/admin/status non-ok', r.status);
        }
        setData(DEFAULT_STATE);
        setError(`status ${r.status}`);
        return;
      }
      const body = await r.json();
      if (body?.data && typeof body.data === 'object') {
        const next: OwnerCapabilities = {
          is_owner:    !!body.data.is_owner,
          admin_mode:  !!body.data.admin_mode,
          capabilities: Array.isArray(body.data.capabilities) ? body.data.capabilities : [],
          debug:       (body.data.debug && typeof body.data.debug === 'object')
                       ? body.data.debug as OwnerDebug
                       : undefined,
        };
        if (debugMode) {
          // eslint-disable-next-line no-console
          console.debug('[useOwnerMode] decision', next);
        }
        setData(next);
      } else {
        setData(DEFAULT_STATE);
      }
    } catch (e: unknown) {
      if (debugMode) {
        // eslint-disable-next-line no-console
        console.debug('[useOwnerMode] fetch threw', e);
      }
      setData(DEFAULT_STATE);
      setError(e instanceof Error ? e.message : 'fetch failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  return {
    isOwner: data.is_owner,
    capabilities: data.capabilities,
    loading,
    error,
    debug: data.debug,
    refresh: fetchStatus,
  };
}

/**
 * Helper for components that need to check a single capability id.
 * Returns false until the status fetch resolves — i.e. the safe default
 * is "non-owner / no capability" while the page is still loading.
 */
export function hasCapability(state: OwnerModeState, capability: string): boolean {
  return state.isOwner && state.capabilities.includes(capability);
}
