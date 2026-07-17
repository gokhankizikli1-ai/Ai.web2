/**
 * useOwnerMode — Owner / Admin Mode detection. SHARED-STATE singleton.
 *
 * Previously each `useOwnerMode()` call instantiated its own state +
 * its own `/v2/admin/status` fetch. With 4 consumer components on
 * /chat (OwnerModeChip, OwnerSessionIndicator, BuildInfoOverlay,
 * GuestBadge) every page load fired FOUR parallel admin-status
 * requests. Every `korvix:owner-refresh` event multiplied them again.
 *
 * This file replaces that with a module-level cache:
 *
 *   - One in-flight request at a time (dedupe via `inFlight` promise).
 *   - 30-second positive-result TTL so a quick re-render doesn't refire.
 *   - Subscribers (each useOwnerMode() consumer) read the cached
 *     state and receive notify() on any change.
 *   - AbortController + 6s timeout so a stalled backend cannot hang
 *     the UI.
 *   - `seedOwnerFromLogin(user)` lets authStore stamp is_owner from
 *     the login response so the chip flips instantly without waiting
 *     for the round-trip.
 *
 * No public API change for consumers — they still `useOwnerMode()`
 * and read `isOwner`, `capabilities`, `loading`, `error`, `debug`,
 * `refresh`. The orchestrationCapabilities accessor and the
 * `ORCHESTRATION_CAPABILITY_IDS` constant are preserved.
 *
 * Failure modes:
 *   - 404 (admin mode disabled on backend) → isOwner=false, error=null
 *   - timeout                              → isOwner=false, error set
 *   - any other failure                    → isOwner=false, error set
 *
 * Hook NEVER throws to consumers.
 */
import { useEffect, useState } from 'react';

const DEFAULT_API_HOST = 'https://korvixai-backend-production.up.railway.app';
const API_BASE = `${
  (import.meta.env?.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ||
  DEFAULT_API_HOST
}`;

const ADMIN_STATUS_URL = `${API_BASE}/v2/admin/status`;

/** The resolved backend base URL (VITE_API_URL when configured, else the
 *  bundled default). Exported so owner-only API clients (e.g. costApi) reuse
 *  the SAME configured base — never a second hardcoded Railway domain. */
export const OWNER_API_BASE = API_BASE;

/* ─── Public types ────────────────────────────────────────────────────── */

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

export const ORCHESTRATION_CAPABILITY_IDS = [
  'frontend_modification',
  'ui_layout_styles',
  'frontend_refactor',
  'page_component_crud',
  'project_structure_changes',
  'internal_orchestration_tools',
  'autonomous_architectural_edits',
  'reduced_confirmation_friction',
] as const;
export type OrchestrationCapability = typeof ORCHESTRATION_CAPABILITY_IDS[number];

export interface OwnerModeState {
  isOwner: boolean;
  capabilities: string[];
  orchestrationCapabilities: OrchestrationCapability[];
  loading: boolean;
  error: string | null;
  debug?: OwnerDebug;
  refresh: () => void;
}

const DEFAULT_STATE: OwnerCapabilities = {
  is_owner: false,
  admin_mode: false,
  capabilities: [],
};

/* ─── localStorage readers ─────────────────────────────────────────────── */

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
function readLocalEmail(): string {
  try {
    const raw = localStorage.getItem('korvix-auth');
    if (!raw) return '';
    const parsed = JSON.parse(raw) as { state?: { user?: { email?: string } } };
    return parsed?.state?.user?.email?.trim().toLowerCase() || '';
  } catch { return ''; }
}
function readDebugFlag(): boolean {
  try { return localStorage.getItem('korvix_debug') === '1'; }
  catch { return false; }
}

/* ─── Module-level singleton state ─────────────────────────────────────── */

interface InternalState {
  data: OwnerCapabilities;
  loading: boolean;
  error: string | null;
  lastFetchAt: number;  // ms epoch
}

let _state: InternalState = {
  data: DEFAULT_STATE,
  loading: false,
  error: null,
  lastFetchAt: 0,
};
let _inFlight: Promise<void> | null = null;

// 30s positive-cache so a render-burst (chip + indicator + overlay +
// guest-badge mounting in the same tick) shares ONE fetch result.
// Forced calls (after login / token paste) bypass the TTL.
const TTL_MS = 30_000;
const FETCH_TIMEOUT_MS = 6_000;

type Listener = () => void;
const _listeners = new Set<Listener>();

function _notify(): void {
  _listeners.forEach((fn) => {
    try { fn(); } catch { /* ignore subscriber errors */ }
  });
}

function _setState(patch: Partial<InternalState>): void {
  _state = { ..._state, ...patch };
  _notify();
}

async function _doFetch(force: boolean): Promise<void> {
  if (_inFlight) return _inFlight;
  if (!force && Date.now() - _state.lastFetchAt < TTL_MS && _state.lastFetchAt > 0) {
    return;
  }
  const debugMode = readDebugFlag();
  _setState({ loading: true, error: null });

  _inFlight = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const bearer = readAccessToken();
      if (bearer) headers['Authorization'] = `Bearer ${bearer}`;
      const ownerToken = readOwnerToken();
      if (ownerToken) headers['X-Korvix-Owner-Token'] = ownerToken;
      const localEmail = readLocalEmail();
      if (localEmail) headers['X-Korvix-Owner-Email'] = localEmail;
      const guest = readGuestId();
      if (guest) headers['X-Korvix-Guest-Id'] = guest;

      const r = await fetch(ADMIN_STATUS_URL, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });

      if (r.status === 404) {
        if (debugMode) console.debug('[useOwnerMode] 404 — admin mode off on backend');
        _setState({ data: DEFAULT_STATE, loading: false, error: null, lastFetchAt: Date.now() });
        return;
      }
      if (!r.ok) {
        _setState({ data: DEFAULT_STATE, loading: false, error: `status ${r.status}`, lastFetchAt: Date.now() });
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
        if (debugMode) console.debug('[useOwnerMode] decision', next);
        _setState({ data: next, loading: false, error: null, lastFetchAt: Date.now() });
      } else {
        _setState({ data: DEFAULT_STATE, loading: false, error: null, lastFetchAt: Date.now() });
      }
    } catch (e: unknown) {
      // AbortError lands here for the timeout case — treat as soft
      // error, leave the previous decision in place so a single slow
      // request doesn't flip the chip Off after a confirmed Owner.
      const message = e instanceof Error ? e.message : 'fetch failed';
      if (debugMode) console.debug('[useOwnerMode] fetch error', message);
      _setState({ loading: false, error: message, lastFetchAt: Date.now() });
    } finally {
      clearTimeout(timer);
      _inFlight = null;
    }
  })();
  return _inFlight;
}

/* ─── Public seed helper — called by authStore after login ─────────────
 *
 * The login response carries `user.is_owner` already (backend's
 * _annotate_owner). Seed the cached state so the chip flips
 * IMMEDIATELY, even before the /v2/admin/status round-trip. The
 * cache reset to `lastFetchAt=0` forces a real backend confirmation
 * on the next consumer effect, but in the meantime the UI shows the
 * authoritative login-response answer instead of "loading…".
 *
 * Pass `null` on logout to reset to DEFAULT_STATE. */
export function seedOwnerFromLogin(user: { is_owner?: boolean } | null): void {
  // ALWAYS reset to DEFAULT_STATE first. Previously this preserved
  // `_state.data.capabilities` when the new user's is_owner=false —
  // that meant a brief window where the chip showed "non-owner"
  // (correctly) but the AdminPanel could still render capability
  // chips from the previous owner. Belt + suspenders: full wipe.
  _setState({
    data: { ...DEFAULT_STATE, is_owner: !!user?.is_owner },
    loading: false,
    error: null,
    // Reset lastFetchAt to 0 so the next mount fetches a fresh
    // definitive answer from /v2/admin/status — the seed is a
    // best-effort hint, not the source of truth.
    lastFetchAt: 0,
  });
  // Force a refetch immediately so backend's identity check
  // confirms / rejects within ~100ms. Without this an offline
  // backend could leave a stale seed in place forever.
  setTimeout(() => { _doFetch(true); }, 0);
}

/* ─── Hook ──────────────────────────────────────────────────────────────
 *
 * Subscribes to the module-level state and triggers ONE fetch per
 * mount (deduped by _inFlight + TTL). Multiple consumers in the
 * same render all share the same fetch and the same state slice. */
export function useOwnerMode(): OwnerModeState {
  // Bumping `tick` is the only thing the listener needs to do —
  // the actual state is read from the module-level `_state` directly.
  const [, setTick] = useState(0);

  useEffect(() => {
    const listener = () => setTick((t) => (t + 1) | 0);
    _listeners.add(listener);
    // Kick a fetch if cache is cold. Dedupes if one is already in flight.
    _doFetch(false);
    return () => { _listeners.delete(listener); };
  }, []);

  useEffect(() => {
    // Force-refresh trigger from OwnerUnlockModal + authStore.
    // Bypasses the TTL because the user just did something that
    // could have changed their owner status.
    const handler = () => { _doFetch(true); };
    window.addEventListener('korvix:owner-refresh', handler);
    window.addEventListener('storage', handler);
    return () => {
      window.removeEventListener('korvix:owner-refresh', handler);
      window.removeEventListener('storage', handler);
    };
  }, []);

  const orchestrationCapabilities = _state.data.capabilities.filter(
    (c): c is OrchestrationCapability =>
      (ORCHESTRATION_CAPABILITY_IDS as readonly string[]).includes(c),
  );

  return {
    isOwner: _state.data.is_owner,
    capabilities: _state.data.capabilities,
    orchestrationCapabilities,
    loading: _state.loading,
    error: _state.error,
    debug: _state.data.debug,
    refresh: () => { _doFetch(true); },
  };
}

/** Helper for capability checks — same semantics as before. */
export function hasCapability(state: OwnerModeState, capability: string): boolean {
  return state.isOwner && state.capabilities.includes(capability);
}
