import { create } from 'zustand';
import { persist } from 'zustand/middleware';

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

/* ─── User-scoped storage wipe — P0 cross-account leak fix ────────────────
 *
 * SECURITY: in production 2026-06-28 we observed account B viewing
 * account A's chat history on the same browser. Root cause: localStorage
 * keys that hold user-owned DATA (not just auth tokens) survived logout,
 * and the next login on the same browser inherited the previous account's
 * state. The leaking keys were never registered in the logout wipe list.
 *
 * Two contributing FE causes, both fixed here:
 *   1. The chat history (`korvix_sessions`, `korvix_active_session_id`,
 *      `korvix_tab_sessions`) and project state
 *      (`korvix_projects`, `korvix_project_agents_*`, `korvix_project_tasks_*`,
 *      `korvix_standalone_agents`, `korvix_saved_prompts`) are written by
 *      hooks/stores without any per-user scoping. They persisted across
 *      logout, so the next logged-in user's UI rendered the previous
 *      user's data.
 *   2. The `korvix_user_id` localStorage key is the browser's stable
 *      GUEST nonce — also used as `req.user_id` for backend calls that
 *      don't enforce JWT-bound identity. If it survived logout, post-
 *      logout traffic and any next-user fallback paths shared the same
 *      backend identity as the prior user's guest tail. Rotating to a
 *      fresh nonce on logout closes that channel.
 *
 * USER_SCOPED_KEYS — explicit allowlist of localStorage keys to clear
 * on logout / user-switch login. Anything user-owned (data, identity,
 * cached UI state derived from identity) goes here.
 *
 * USER_SCOPED_PREFIXES — for keys with per-project / per-resource
 * suffixes (e.g. `korvix_project_agents_<project_id>`). We enumerate
 * localStorage and remove every key starting with one of these.
 *
 * PRESERVED on logout: UI preferences that aren't user-data (timezone,
 * experimental flags, theme, guest-badge dismissal, debug flag,
 * trading-timeframe). They're explicit-by-omission. */

const USER_SCOPED_KEYS = [
  // ── Auth identity ──────────────────────────────────────────────────────
  'korvix-auth',                  // zustand persisted user blob
  TOKEN_KEY,                      // 'korvix_access_token' — JWT
  'korvix_owner_token',           // shared-secret owner unlock
  'korvix_oauth_response',        // in-flight redirect callback
  // ── User-scoped UI state derived from identity ─────────────────────────
  'korvix_owner_welcome_shown',
  'korvix_owner_greeting_shown',
  // ── Chat history (the leak the operator hit) ───────────────────────────
  'korvix_sessions',
  'korvix_active_session_id',
  'korvix_tab_sessions',
  // ── Project / agent / task state ───────────────────────────────────────
  'korvix_projects',
  'korvix_standalone_agents',
  'korvix_projects_migrated_v1',  // migration flag — re-run for the new user
  // ── Saved prompts (per-user content) ───────────────────────────────────
  'korvix_saved_prompts',
];

const USER_SCOPED_PREFIXES = [
  'korvix_project_agents_',       // per-project agent cache
  'korvix_project_tasks_',        // per-project task cache
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

/** Wipe every localStorage key that carries user-owned data or identity.
 *  Also rotates the guest nonce. Idempotent + storage-failure tolerant.
 *
 *  Call this on EVERY auth boundary:
 *    - logout()
 *    - login/signup/loginWithGoogle when the new user differs from the
 *      previously persisted one (handles the "log in as B without
 *      explicit logout from A" case).
 *
 *  Why not just `localStorage.clear()`: would also nuke user preferences
 *  (theme, timezone, experimental flags) that aren't user-owned data
 *  and degrade UX for the legitimate next user. Allowlist is safer. */
function wipeUserScopedStorage(): void {
  for (const k of USER_SCOPED_KEYS) {
    try { localStorage.removeItem(k); } catch { /* ignore */ }
    try { sessionStorage.removeItem(k); } catch { /* ignore */ }
  }
  // Enumerate prefix-suffixed keys. localStorage.length + key(i) is the
  // only way to iterate; we collect first to avoid mutating mid-enumeration.
  try {
    const matched: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (USER_SCOPED_PREFIXES.some(p => k.startsWith(p))) matched.push(k);
    }
    for (const k of matched) {
      try { localStorage.removeItem(k); } catch { /* ignore */ }
    }
  } catch { /* private mode / quota — best-effort */ }
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
      error: null,

      login: async (email: string, password: string) => {
        set({ isLoading: true, error: null });
        // SECURITY: defensive wipe BEFORE we accept any token. If a
        // previous account's data lingers in localStorage (e.g. user
        // logged into A, closed tab without logout, opened later and
        // logged into B), apiLogin's success would otherwise reveal A's
        // chats/projects to B. wipeUserScopedStorage is idempotent —
        // safe to run on every login attempt, succeed-or-fail.
        wipeUserScopedStorage();
        const { user, error } = await apiLogin(email, password);
        if (user) {
          set({ user, isAuthenticated: true, isLoading: false, error: null });
          notifyAuthChanged(user);
          return true;
        }
        set({ isLoading: false, error: error || 'Invalid email or password' });
        return false;
      },

      signup: async (email: string, password: string, name: string) => {
        set({ isLoading: true, error: null });
        // SECURITY: same rationale as login — wipe before we mint a
        // new identity so the fresh account starts on a clean slate.
        wipeUserScopedStorage();
        const { user, error } = await apiSignup(email, password, name);
        if (user) {
          set({ user, isAuthenticated: true, isLoading: false, error: null });
          notifyAuthChanged(user);
          return true;
        }
        set({ isLoading: false, error: error || 'Could not create account. Try a different email.' });
        return false;
      },

      loginWithGoogle: async (idToken: string) => {
        set({ isLoading: true, error: null });
        // SECURITY: same rationale as login.
        wipeUserScopedStorage();
        const { user, error } = await apiGoogle(idToken);
        if (user) {
          set({ user, isAuthenticated: true, isLoading: false, error: null });
          notifyAuthChanged(user);
          return true;
        }
        set({ isLoading: false, error: error || 'Google sign-in failed.' });
        return false;
      },

      logout: async () => {
        set({ isLoading: true });
        await apiLogout();
        set({ user: null, isAuthenticated: false, isLoading: false, error: null });
        // SECURITY: wipe ALL user-scoped data (chat history, projects,
        // agents, tasks, saved prompts, owner state) and rotate the
        // guest nonce so the next account on this browser starts on a
        // clean backend identity. See USER_SCOPED_KEYS comment for the
        // full inventory + rationale.
        wipeUserScopedStorage();
        notifyAuthChanged(null);
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
              notifyAuthChanged(parsed.state.user);
              // Background validation — only when a bearer is present.
              if (readToken()) {
                apiMe().then((fresh) => {
                  if (fresh) {
                    set({ user: fresh, isAuthenticated: true });
                    notifyAuthChanged(fresh);
                  } else if (!readToken()) {
                    set({ user: null, isAuthenticated: false });
                    try { localStorage.removeItem('korvix-auth'); } catch { /* ignore */ }
                    notifyAuthChanged(null);
                  }
                });
              }
              return;
            }
          } catch { /* ignore */ }
        }
        // No persisted user AND no bearer ⇒ guest. apiMe() short-circuits
        // to null without a network call (see `if (!readToken()) return null`).
        if (!readToken()) {
          set({ isLoading: false, isHydrating: false });
          return;
        }
        set({ isLoading: true });
        const user = await apiMe();
        if (user) {
          set({ user, isAuthenticated: true, isLoading: false, isHydrating: false });
          notifyAuthChanged(user);
        } else {
          set({ isLoading: false, isHydrating: false });
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

function notifyAuthChanged(user?: AuthUser | null): void {
  _clearStaleOwnerArtifactsOnAccountChange(user?.email || null);
  try {
    // Lazy import keeps this module a pure store at import time —
    // helps Vite tree-shake when an entry doesn't need the owner UI.
    import('@/hooks/useOwnerMode').then((mod) => {
      mod.seedOwnerFromLogin(user ?? null);
    }).catch(() => { /* ignore */ });
  } catch { /* ignore */ }
  try { window.dispatchEvent(new CustomEvent('korvix:owner-refresh')); }
  catch { /* ignore */ }
}

/* ─── Exposed token reader for non-store callers ─────────────────────────
 *
 * The orchestrator / chat hooks need to add the bearer to fetch() calls
 * they make outside of authStore. They read this getter instead of
 * touching localStorage directly so the storage key stays encapsulated. */
export function getAccessToken(): string | null {
  return readToken();
}
