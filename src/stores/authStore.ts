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

const RAW_API_BASE = (import.meta.env.VITE_API_URL || '').trim();
const API_BASE = RAW_API_BASE.replace(/\/+$/, '');

if (!API_BASE) {
  // Non-fatal — apiUrl() returns relative paths and apiMe() degrades
  // gracefully to "no user, stay guest".
  // eslint-disable-next-line no-console
  console.warn(
    '[authStore] VITE_API_URL is not set — auth endpoints will resolve ' +
    'to relative paths. Set VITE_API_URL in Vercel to enable real auth.',
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
  try {
    const res = await fetch(apiUrl('/auth/google'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id_token: idToken }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const detail = (body?.detail || body) as Record<string, unknown>;
      const msg = (typeof detail?.message === 'string' && detail.message) || 'Google sign-in was rejected.';
      return { user: null, error: msg };
    }
    const body = await res.json();
    if (typeof body.access_token === 'string') saveToken(body.access_token);
    return { user: mapBackendUser(body.user) };
  } catch (e) {
    return { user: null, error: e instanceof Error ? e.message : 'Network error.' };
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
  try {
    const res = await fetch(apiUrl('/auth/me'), { headers: authHeaders() });
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
      error: null,

      login: async (email: string, password: string) => {
        set({ isLoading: true, error: null });
        const { user, error } = await apiLogin(email, password);
        if (user) {
          set({ user, isAuthenticated: true, isLoading: false, error: null });
          notifyAuthChanged();
          return true;
        }
        set({ isLoading: false, error: error || 'Invalid email or password' });
        return false;
      },

      signup: async (email: string, password: string, name: string) => {
        set({ isLoading: true, error: null });
        const { user, error } = await apiSignup(email, password, name);
        if (user) {
          set({ user, isAuthenticated: true, isLoading: false, error: null });
          notifyAuthChanged();
          return true;
        }
        set({ isLoading: false, error: error || 'Could not create account. Try a different email.' });
        return false;
      },

      loginWithGoogle: async (idToken: string) => {
        set({ isLoading: true, error: null });
        const { user, error } = await apiGoogle(idToken);
        if (user) {
          set({ user, isAuthenticated: true, isLoading: false, error: null });
          notifyAuthChanged();
          return true;
        }
        set({ isLoading: false, error: error || 'Google sign-in failed.' });
        return false;
      },

      logout: async () => {
        set({ isLoading: true });
        await apiLogout();
        set({ user: null, isAuthenticated: false, isLoading: false, error: null });
        try { localStorage.removeItem('korvix-auth'); } catch { /* ignore */ }
        notifyAuthChanged();
      },

      checkAuth: async () => {
        set({ isLoading: true });
        // Fast path: persisted user state surfaces immediately, but
        // keep loading until the bearer token has been validated.
        const persisted = (() => {
          try { return localStorage.getItem('korvix-auth'); }
          catch { return null; }
        })();
        if (persisted) {
          try {
            const parsed = JSON.parse(persisted);
            if (parsed?.state?.user) {
              set({ user: parsed.state.user, isAuthenticated: true });
              const fresh = await apiMe();
              if (fresh) {
                set({ user: fresh, isAuthenticated: true, isLoading: false });
                notifyAuthChanged();
              } else if (!readToken()) {
                // Token was cleared by apiMe() (401) — sign out before
                // guarded routes render with the persisted user.
                set({ user: null, isAuthenticated: false, isLoading: false });
                try { localStorage.removeItem('korvix-auth'); } catch { /* ignore */ }
                notifyAuthChanged();
              } else {
                set({ isLoading: false });
              }
              return;
            }
          } catch { /* ignore */ }
        }
        const user = await apiMe();
        if (user) {
          set({ user, isAuthenticated: true, isLoading: false });
          notifyAuthChanged();
        } else {
          set({ isLoading: false });
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
 * useOwnerMode listens for `korvix:owner-refresh` to re-fetch the admin
 * status (so owner UI flips immediately after a Google login where the
 * new account matches OWNER_EMAIL). Auth changes dispatch the same
 * event so every subscriber re-evaluates without a page reload. */
function notifyAuthChanged(): void {
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
