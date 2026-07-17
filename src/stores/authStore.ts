import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { migrateGlobalToScope, IDENTITY_CHANGED_EVENT, currentStorageScope } from '@/lib/storageScope';

/* ═══════════════════════════════════════════
   AUTH TYPES
   ═══════════════════════════════════════════ */
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  plan: 'free' | 'pro' | 'enterprise';
  /** True when backend's _annotate_owner() flagged this user via OWNER_EMAIL.
   *  Used by useOwnerMode + AdminBadge to flip into owner UI immediately
   *  after Google login (no second round-trip required). */
  is_owner?: boolean;
  /** Backend identity kind: email | google | apple | github | guest */
  kind?: string;
}

interface AuthState {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  /**
   * True until the first auth resolution completes (either a successful
   * `/auth/me` round-trip OR a definitive "no bearer token" fallback).
   * Consumers gate their "guest vs signed-in" UI on this so the user
   * doesn't briefly see "Sign In" / "Guest User" while the persisted
   * session is being verified.
   *
   * Starts true on every fresh app load. Flips to false exactly once
   * per app session at the end of checkAuth(). Subsequent login /
   * logout transitions don't touch it — they're explicit user actions,
   * not background hydration.
   */
  isHydrating: boolean;
  /**
   * True once the INITIAL session resolution has completed INCLUDING the
   * background `/auth/me` validation of a persisted token. Distinct from
   * `isHydrating` (which flips off optimistically as soon as a cached user is
   * read, BEFORE validation) so a consumer that must not act on an unvalidated
   * cached session — e.g. the root-route redirect to /chat — can wait for the
   * real verdict. An EXPIRED cached session therefore never triggers an
   * optimistic redirect: `sessionChecked` only flips true after `/auth/me`
   * settles, by which point `isAuthenticated` reflects the true state.
   *
   * Starts false on every fresh load; flips true exactly once per app session.
   * Login / logout are explicit actions and do not reset it. Not persisted.
   */
  sessionChecked: boolean;
  error: string | null;

  login: (email: string, password: string) => Promise<boolean>;
  signup: (email: string, password: string, name: string) => Promise<boolean>;
  loginWithGoogle: (idToken: string) => Promise<boolean>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  clearError: () => void;
}

/* ═══════════════════════════════════════════
   API + TOKEN PLUMBING
   ═══════════════════════════════════════════ */

// Production failure 2026-06-27: when `VITE_API_URL` was missing in
// Vercel, the prior code resolved auth endpoints to RELATIVE paths
// (e.g. `/auth/google`). The browser sent those POSTs to the Vercel
// domain, which `vercel.json` rewrites to `index.html`. POST against
// a static HTML file returns **HTTP 405 Method Not Allowed** — which
// is exactly what surfaced as "Google login returns HTTP 405", "Email
// login fails", "Email signup fails", and AuthPage's
// "backend rejected the id_token" misattribution.
//
// Every other hook in src/hooks/* already bundles a default backend
// host for this exact reason (useOwnerMode.ts:36, useAgentPresence.ts:20,
// useClassify.ts:11). authStore was the lone holdout. This mirrors
// useOwnerMode.ts's pattern verbatim — same host, same fallback shape.
//
// `VITE_API_URL` (when set in Vercel) STILL wins — this is purely a
// fallback for the unset / empty case. Setting the env var to a
// different backend (e.g. a custom api.korvixai.com domain) overrides
// the default without any code change.
const DEFAULT_API_HOST = 'https://korvixai-backend-production.up.railway.app';
const RAW_API_BASE = (import.meta.env.VITE_API_URL || '').trim();
const API_BASE = (RAW_API_BASE || DEFAULT_API_HOST).replace(/\/+$/, '');

if (!RAW_API_BASE) {
  // eslint-disable-next-line no-console
  console.warn(
    `[authStore] VITE_API_URL is not set — falling back to ${DEFAULT_API_HOST}. ` +
    'Set VITE_API_URL in Vercel to override.',
  );
}

function apiUrl(path: string): string {
  const clean = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE}${clean}`;
}

/* ─── Token persistence ──────────────────────────────────────────────────
 *
 * The JWT returned by /auth/login, /auth/signup, /auth/google MUST be
 * stored in localStorage under `korvix_access_token` because:
 *   1. Every subsequent backend call needs `Authorization: Bearer <jwt>`.
 *   2. useOwnerMode reads this key to send the bearer on /v2/admin/*.
 *   3. The persisted zustand `korvix-auth` blob carries only the user
 *      shape — we deliberately keep the JWT in a separate key so
 *      clearing one doesn't clear the other.
 *
 * Previous code IGNORED the access_token in the response — every login
 * stored a user dict but no credential, so /auth/me always returned 401
 * and owner-email detection was impossible. This is the bug that made
 * Google login functionally useless even before the placeholder. */

const TOKEN_KEY = 'korvix_access_token';

function saveToken(token: string): void {
  try { localStorage.setItem(TOKEN_KEY, token); }
  catch { /* private browsing — accept the degradation */ }
}
function readToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); }
  catch { return null; }
}
function clearToken(): void {
  try { localStorage.removeItem(TOKEN_KEY); }
  catch { /* ignore */ }
}

/* ─── Auth-boundary cleanup — Phase 14D (P0 data-loss + isolation fix) ─────
 *
 * SECURITY + DATA SAFETY: earlier builds called a broad `wipeUserScopedStorage()`
 * that removed user-OWNED DATA (chat history, projects, project agents/tasks,
 * standalone agents, saved prompts) BEFORE every login/signup/OAuth attempt AND
 * on logout. Two P0 problems:
 *   1. A failed login, network blip or deploy could ERASE a user's data before
 *      any new identity was even confirmed.
 *   2. Logout DESTROYED data instead of merely hiding it, so the same user did
 *      not get their data back on re-login.
 *
 * Both are fixed by making isolation STRUCTURAL rather than destructive: chat,
 * projects, standalone agents and saved prompts are now namespaced per identity
 * (see `src/lib/storageScope.ts`) — `user_<auth_id>` / `guest_<nonce>`. The next
 * account simply reads different keys, and same-user re-login reads the same
 * keys, so NO user data is ever wiped at an auth boundary.
 *
 * This cleanup therefore clears ONLY the AUTH identity + owner artifacts and
 * rotates the guest nonce (so post-logout backend traffic doesn't reuse the
 * previous account's guest tail). It runs on LOGOUT ONLY — never before a login
 * attempt, so a failed/temporarily-unavailable login never disturbs stored data.
 *
 * Never `localStorage.clear()` — it would nuke unrelated preferences (theme,
 * timezone, experimental flags). PRESERVED (explicit-by-omission): all
 * user-owned data + UI preferences. */
const AUTH_ARTIFACT_KEYS = [
  'korvix-auth',                  // zustand persisted user blob
  TOKEN_KEY,                      // 'korvix_access_token' — JWT
  'korvix_owner_token',           // shared-secret owner unlock
  'korvix_oauth_response',        // in-flight redirect callback
  'korvix_owner_welcome_shown',   // owner UI state derived from identity
  'korvix_owner_greeting_shown',
];

/** Rotate the browser's guest identifier so post-logout traffic uses a
 *  fresh backend identity, not the previous account's guest tail.
 *
 *  Returns the new id (also written to localStorage). Best-effort — if
 *  storage is unavailable (private mode), returns a random ephemeral id
 *  without persisting; useChat / projectStore tolerate that. */
function rotateGuestNonce(): string {
  const fresh = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
    ? crypto.randomUUID()
    : `u-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try { localStorage.setItem('korvix_user_id', fresh); }
  catch { /* private mode — ephemeral is acceptable */ }
  return fresh;
}

/** Clear ONLY auth identity + owner artifacts and rotate the guest nonce.
 *  User-owned DATA is per-identity namespaced (storageScope.ts) and is
 *  intentionally PRESERVED — restored on same-user re-login, invisible to other
 *  accounts. Idempotent + storage-failure tolerant. Called on LOGOUT only. */
function clearAuthArtifacts(): void {
  for (const k of AUTH_ARTIFACT_KEYS) {
    try { localStorage.removeItem(k); } catch { /* ignore */ }
    try { sessionStorage.removeItem(k); } catch { /* ignore */ }
  }
  rotateGuestNonce();
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...extra,
  };
  const token = readToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

/* ─── Shape mapping ──────────────────────────────────────────────────────
 *
 * Backend returns:
 *   { id, email, kind, display_name, created_at, last_login_at, is_owner }
 * Frontend AuthUser shape is:
 *   { id, email, name, avatar?, plan, is_owner?, kind? }
 *
 * The two diverged historically. Keep ONE mapping function so every
 * code path (login / signup / google / me) produces the same shape. */
function mapBackendUser(raw: unknown): AuthUser | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === 'string' ? r.id : '';
  if (!id) return null;
  const email = (typeof r.email === 'string' ? r.email : '').trim().toLowerCase();
  const display = typeof r.display_name === 'string' ? r.display_name : '';
  const name = display || (email ? email.split('@')[0] : 'You');
  return {
    id,
    email,
    name,
    plan: 'free',
    is_owner: r.is_owner === true,
    kind: typeof r.kind === 'string' ? r.kind : undefined,
  };
}

/* ─── API calls ──────────────────────────────────────────────────────────
 *
 * Each handler returns a `{ user, error? }` shape so callers can show
 * a precise error string instead of a generic "invalid email or
 * password" toast. */

interface ApiResult {
  user: AuthUser | null;
  error?: string;
}

async function apiLogin(email: string, password: string): Promise<ApiResult> {
  try {
    const res = await fetch(apiUrl('/auth/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const detail = (body?.detail || body) as Record<string, unknown>;
      const msg = (typeof detail?.message === 'string' && detail.message) || 'Invalid email or password.';
      return { user: null, error: msg };
    }
    const body = await res.json();
    if (typeof body.access_token === 'string') saveToken(body.access_token);
    return { user: mapBackendUser(body.user) };
  } catch (e) {
    return { user: null, error: e instanceof Error ? e.message : 'Network error.' };
  }
}

async function apiSignup(email: string, password: string, name: string): Promise<ApiResult> {
  try {
    const res = await fetch(apiUrl('/auth/signup'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, display_name: name }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const detail = (body?.detail || body) as Record<string, unknown>;
      const msg = (typeof detail?.message === 'string' && detail.message) || 'Could not create account.';
      return { user: null, error: msg };
    }
    const body = await res.json();
    if (typeof body.access_token === 'string') saveToken(body.access_token);
    return { user: mapBackendUser(body.user) };
  } catch (e) {
    return { user: null, error: e instanceof Error ? e.message : 'Network error.' };
  }
}

async function apiGoogle(idToken: string): Promise<ApiResult> {
  // 15s timeout — /auth/google does a synchronous urllib call to
  // Google's tokeninfo endpoint server-side. That's typically 200ms
  // but can spike if Railway's egress is slow. 15s is long enough
  // for the worst case, short enough that a wedged backend doesn't
  // strand the user on "Opening Google…" forever.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(apiUrl('/auth/google'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id_token: idToken }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const detail = (body?.detail || body) as Record<string, unknown>;
      const code = typeof detail?.code === 'string' ? detail.code : '';
      const msg = (typeof detail?.message === 'string' && detail.message)
        || `Google sign-in was rejected (HTTP ${res.status}${code ? `, ${code}` : ''}).`;
      return { user: null, error: msg };
    }
    const body = await res.json();
    if (typeof body.access_token === 'string') saveToken(body.access_token);
    return { user: mapBackendUser(body.user) };
  } catch (e) {
    // AbortError lands here on timeout — surface a precise message
    // instead of the browser's generic "The operation was aborted".
    if (e instanceof DOMException && e.name === 'AbortError') {
      return { user: null, error: 'Backend did not respond within 15 seconds. Check Railway logs for /auth/google.' };
    }
    return { user: null, error: e instanceof Error ? e.message : 'Network error.' };
  } finally {
    clearTimeout(timer);
  }
}

async function apiLogout(): Promise<void> {
  // Stateless backend logout — call so the server can record the event,
  // then drop the token locally regardless of result.
  try {
    await fetch(apiUrl('/auth/logout'), { method: 'POST', headers: authHeaders() });
  } catch { /* ignore */ }
  clearToken();
}

async function apiMe(): Promise<AuthUser | null> {
  // No bearer token in storage ⇒ skip the round-trip. Stays consistent
  // with the previous "guest by default" behaviour without burning a
  // request that's guaranteed to 401.
  if (!readToken()) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6_000);
  try {
    const res = await fetch(apiUrl('/auth/me'), {
      headers: authHeaders(),
      signal: controller.signal,
    });
    if (res.status === 401) {
      // Token expired or invalidated — clear it so we don't keep
      // sending a dead credential.
      clearToken();
      return null;
    }
    if (!res.ok) return null;
    const body = await res.json();
    return mapBackendUser(body.user);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/* ═══════════════════════════════════════════
   STORE
   ═══════════════════════════════════════════ */

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      isHydrating: true,
      sessionChecked: false,
      error: null,

      login: async (email: string, password: string) => {
        set({ isLoading: true, error: null });
        // Phase 14D: NO pre-verification wipe. A failed/temporarily-unavailable
        // login must never disturb stored data. Cross-account isolation is
        // structural (per-identity keys, storageScope.ts): on success the store
        // switches scope to the new user, who reads their OWN keys and never
        // sees the previous account's data.
        const { user, error } = await apiLogin(email, password);
        if (user) {
          set({ user, isAuthenticated: true, isLoading: false, sessionChecked: true, error: null });
          notifyAuthChanged(user, 'login');
          return true;
        }
        set({ isLoading: false, error: error || 'Invalid email or password' });
        return false;
      },

      signup: async (email: string, password: string, name: string) => {
        set({ isLoading: true, error: null });
        // Phase 14D: no pre-verification wipe (see login). The new identity's
        // per-scope keys start empty; nothing needs to be destroyed first.
        const { user, error } = await apiSignup(email, password, name);
        if (user) {
          set({ user, isAuthenticated: true, isLoading: false, sessionChecked: true, error: null });
          notifyAuthChanged(user, 'login');
          return true;
        }
        set({ isLoading: false, error: error || 'Could not create account. Try a different email.' });
        return false;
      },

      loginWithGoogle: async (idToken: string) => {
        set({ isLoading: true, error: null });
        // Phase 14D: no pre-verification wipe (see login).
        const { user, error } = await apiGoogle(idToken);
        if (user) {
          set({ user, isAuthenticated: true, isLoading: false, sessionChecked: true, error: null });
          notifyAuthChanged(user, 'login');
          return true;
        }
        set({ isLoading: false, error: error || 'Google sign-in failed.' });
        return false;
      },

      logout: async () => {
        set({ isLoading: true });
        await apiLogout();
        set({ user: null, isAuthenticated: false, isLoading: false, sessionChecked: true, error: null });
        // Phase 14D: clear ONLY auth identity + owner artifacts and rotate the
        // guest nonce. User-owned data (chat, projects, agents, tasks, saved
        // prompts) is per-identity namespaced and PRESERVED — this same user
        // gets it back on re-login, and other accounts never see it.
        clearAuthArtifacts();
        notifyAuthChanged(null, 'logout');
      },

      checkAuth: async () => {
        // FAST PATH: render-blocking work is just the localStorage read.
        // The backend /auth/me validation runs in the background and only
        // fires if a bearer token actually exists. Without a token, this
        // function is a no-op — guest mode renders instantly.
        //
        // isHydrating contract: flipped to false EXACTLY ONCE, at the
        // earliest definitive resolution. Consumers gate "Sign In" /
        // "Guest User" UI on !isHydrating to avoid flashing the wrong
        // state on first paint when a valid session exists in storage.
        const persisted = (() => {
          try { return localStorage.getItem('korvix-auth'); }
          catch { return null; }
        })();
        if (persisted) {
          try {
            const parsed = JSON.parse(persisted);
            if (parsed?.state?.user) {
              // Cached user → flip isHydrating off IMMEDIATELY so the
              // signed-in UI surfaces without waiting for /auth/me.
              set({
                user: parsed.state.user,
                isAuthenticated: true,
                isLoading: false,
                isHydrating: false,
              });
              notifyAuthChanged(parsed.state.user, 'boot');
              // Background validation — only when a bearer is present.
              if (readToken()) {
                apiMe().then((fresh) => {
                  if (fresh) {
                    set({ user: fresh, isAuthenticated: true });
                    notifyAuthChanged(fresh, 'refresh');
                  } else if (!readToken()) {
                    // Definitive 401 only (apiMe cleared the token). Temporary
                    // failures — timeout, network, 5xx, abort — keep the token
                    // AND the cached user, so this branch does NOT run and the
                    // user stays signed in.
                    set({ user: null, isAuthenticated: false });
                    try { localStorage.removeItem('korvix-auth'); } catch { /* ignore */ }
                    notifyAuthChanged(null, 'logout');
                  }
                  // Session verdict is now definitive (validated, expired, or a
                  // temporary failure that keeps the cached session) — consumers
                  // gated on validation (root redirect) may now act.
                  set({ sessionChecked: true });
                });
              } else {
                // Cached user but no bearer to validate → treat the cached
                // session as resolved (there is nothing to verify against).
                set({ sessionChecked: true });
              }
              return;
            }
          } catch { /* ignore */ }
        }
        // No persisted user AND no bearer ⇒ guest. apiMe() short-circuits
        // to null without a network call (see `if (!readToken()) return null`).
        if (!readToken()) {
          set({ isLoading: false, isHydrating: false, sessionChecked: true });
          return;
        }
        set({ isLoading: true });
        const user = await apiMe();
        if (user) {
          set({ user, isAuthenticated: true, isLoading: false, isHydrating: false, sessionChecked: true });
          notifyAuthChanged(user, 'login');
        } else {
          set({ isLoading: false, isHydrating: false, sessionChecked: true });
        }
      },

      clearError: () => set({ error: null }),
    }),
    {
      name: 'korvix-auth',
      partialize: (state) => ({ user: state.user, isAuthenticated: state.isAuthenticated }),
    },
  ),
);

/* ─── Cross-component refresh signal ──────────────────────────────────────
 *
 * Login / logout / signup all call notifyAuthChanged() to keep the
 * owner UI in lockstep with the auth state. Two effects:
 *
 *  1. seedOwnerFromLogin() — pushes the login response's is_owner
 *     flag straight into the useOwnerMode module cache so every
 *     subscriber re-renders with the correct chip state in ~1ms,
 *     without waiting for the /v2/admin/status round-trip.
 *  2. korvix:owner-refresh window event — fired AFTER the seed so
 *     useOwnerMode also kicks a real backend confirmation (resets
 *     the cache TTL). With the singleton, this is now ONE fetch
 *     shared by all subscribers; previously it was 4-N parallel
 *     fetches.
 */
// Track the last email we notified about. If the next login arrives
// with a DIFFERENT email, scrub owner-related local state — that
// covers the "previous owner left OWNER_TOKEN in localStorage; new
// account is now signing in on the same browser" case.
let _lastNotifiedEmail: string | null = null;

function _clearStaleOwnerArtifactsOnAccountChange(newEmail: string | null): void {
  const prev = _lastNotifiedEmail;
  _lastNotifiedEmail = newEmail;
  if (prev !== null && prev !== newEmail) {
    // Email changed (incl. owner → other-account or other-account →
    // null on logout). The new identity does NOT inherit the previous
    // identity's owner-token unlock.
    for (const k of [
      'korvix_owner_token',
      'korvix_owner_welcome_shown',
      'korvix_owner_greeting_shown',
    ]) {
      try { localStorage.removeItem(k); }
      catch { /* ignore */ }
      try { sessionStorage.removeItem(k); }
      catch { /* ignore */ }
    }
    // eslint-disable-next-line no-console
    console.log(
      '%c[korvixai-auth] Account change detected — owner artifacts cleared',
      'color:#fb923c;font-weight:bold;',
      { prev: prev || '(none)', next: newEmail || '(logged out)' },
    );
  }
}

/* ─── Identity-change event contract (Phase 14D.3) ───────────────────────────
 *
 * `korvix:identity-changed` must fire ONLY when the effective storage scope
 * actually changes (login / logout / account switch) — never merely because
 * /auth/me returned the SAME user, a profile/owner refresh ran, or an auth
 * action re-notified with an unchanged identity. Firing it on a same-scope
 * notify used to make the App remount boundary recompute needlessly. We compare
 * the scope string (seeded once at module load from the persisted identity) and
 * dispatch only on a real transition, carrying { previousScope, nextScope,
 * reason } for listeners. Owner refresh (`korvix:owner-refresh`) stays a
 * SEPARATE signal — it is not proof that identity changed. */
type IdentityChangeReason = 'login' | 'logout' | 'refresh' | 'boot';
let _lastNotifiedScope: string = (() => {
  try { return currentStorageScope(); } catch { return 'guest_anon'; }
})();

function notifyIdentityChanged(reason: IdentityChangeReason): void {
  try {
    // Read AFTER localStorage settled (the caller has already run set()/persist
    // and any auth-artifact removal), so this reflects the NEW identity.
    const nextScope = currentStorageScope();
    if (nextScope === _lastNotifiedScope) return; // scope unchanged — not an identity change
    const previousScope = _lastNotifiedScope;
    _lastNotifiedScope = nextScope;
    window.dispatchEvent(new CustomEvent(IDENTITY_CHANGED_EVENT, {
      detail: { previousScope, nextScope, reason },
    }));
  } catch { /* ignore — a failed dispatch must never break auth */ }
}

function notifyAuthChanged(user?: AuthUser | null, reason: IdentityChangeReason = 'refresh'): void {
  _clearStaleOwnerArtifactsOnAccountChange(user?.email || null);
  try {
    // Lazy import keeps this module a pure store at import time —
    // helps Vite tree-shake when an entry doesn't need the owner UI.
    import('@/hooks/useOwnerMode').then((mod) => {
      mod.seedOwnerFromLogin(user ?? null);
    }).catch(() => { /* ignore */ });
  } catch { /* ignore */ }
  // Owner refresh is independent of identity change — keep it unconditional.
  try { window.dispatchEvent(new CustomEvent('korvix:owner-refresh')); }
  catch { /* ignore */ }
  // Identity-change signal — dispatched only when the effective scope changed.
  notifyIdentityChanged(reason);
}

/* ─── Exposed token reader for non-store callers ─────────────────────────
 *
 * The orchestrator / chat hooks need to add the bearer to fetch() calls
 * they make outside of authStore. They read this getter instead of
 * touching localStorage directly so the storage key stays encapsulated. */
export function getAccessToken(): string | null {
  return readToken();
}

/* ─── Phase 14D — boot-time legacy-global claim ──────────────────────────
 * authStore is imported by App at the ROOT, so this runs once at app boot for
 * EVERY route, before any in-app login/logout can switch accounts. It claims
 * the single-key legacy GLOBAL user-data (standalone agents, saved prompts)
 * into the boot identity's scope and removes the global, so a later account in
 * the same session can never inherit it. (projectStore does its own multi-key
 * claim at its module load; chat was namespaced separately in a prior fix.)
 * Best-effort: migrateGlobalToScope is fully storage-failure tolerant. */
if (typeof window !== 'undefined') {
  try {
    migrateGlobalToScope('korvix_standalone_agents');
    migrateGlobalToScope('korvix_saved_prompts');
  } catch { /* private mode — skip */ }
}
