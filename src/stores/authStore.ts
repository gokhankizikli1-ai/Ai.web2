import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { API_BASE_URL } from '@/lib/apiBase';

/* ═══════════════════════════════════════════
   AUTH TYPES
   ═══════════════════════════════════════════ */
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  plan: 'free' | 'pro' | 'enterprise';
  // Additive: provider source so the UI can tell Google/Apple/email/guest apart.
  provider?: 'email' | 'google' | 'apple' | 'guest';
  // Additive: hidden owner/admin gate driven by backend OWNER_EMAIL.
  isOwner?: boolean;
}

interface AuthState {
  user: AuthUser | null;
  token: string | null;          // JWT access token (Authorization: Bearer …)
  isAuthenticated: boolean;
  isOwner: boolean;              // mirror of user.isOwner for easy gating
  isLoading: boolean;
  error: string | null;

  login: (email: string, password: string) => Promise<boolean>;
  signup: (email: string, password: string, name: string) => Promise<boolean>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  continueAsGuest: () => void;
  loginWithGoogle: () => Promise<boolean>;
  loginWithApple: () => Promise<boolean>;
  clearError: () => void;
}

/* ═══════════════════════════════════════════
   API HELPERS
   The backend (Phase 3b) returns
     { access_token, token_type:'bearer', expires_in, user }
   on signup/login/{google,apple}. We store the JWT in localStorage
   and send it as `Authorization: Bearer …` on subsequent calls.
   No `credentials: 'include'` — bearer-token model, not cookies.
   ═══════════════════════════════════════════ */

interface AuthResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  user: Record<string, unknown>;
}

function _toUser(raw: Record<string, unknown>, provider: AuthUser['provider']): AuthUser {
  const email = String(raw.email ?? '');
  const name = String(raw.display_name ?? raw.name ?? (email.split('@')[0] || ''));
  return {
    id: String(raw.id ?? ''),
    email,
    name,
    avatar: (raw.avatar as string) || undefined,
    plan: ((raw.plan as AuthUser['plan']) || 'free'),
    provider: (raw.kind as AuthUser['provider']) || provider,
    isOwner: raw.is_owner === true,
  };
}

async function _readJsonSafe(res: Response): Promise<Record<string, unknown> | null> {
  const text = await res.text();
  if (!text) return null;
  try { return JSON.parse(text) as Record<string, unknown>; }
  catch (e) { console.warn('[authStore] JSON parse failed:', e); return null; }
}

async function _bearerFetch(path: string, init?: RequestInit, token?: string | null): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return fetch(`${API_BASE_URL}${path}`, { ...init, headers });
}

async function apiLogin(email: string, password: string): Promise<AuthResponse | null> {
  const res = await _bearerFetch('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) return null;
  return (await _readJsonSafe(res)) as AuthResponse | null;
}

async function apiSignup(email: string, password: string, name: string): Promise<AuthResponse | null> {
  const res = await _bearerFetch('/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ email, password, display_name: name }),
  });
  if (!res.ok) return null;
  return (await _readJsonSafe(res)) as AuthResponse | null;
}

async function apiLogout(token: string | null): Promise<void> {
  try { await _bearerFetch('/auth/logout', { method: 'POST' }, token); }
  catch { /* idempotent */ }
}

async function apiMe(token: string): Promise<Record<string, unknown> | null> {
  const res = await _bearerFetch('/auth/me', { method: 'GET' }, token);
  if (!res.ok) return null;
  const body = await _readJsonSafe(res);
  return (body?.user as Record<string, unknown>) ?? null;
}

async function apiOAuthExchange(provider: 'google' | 'apple', idToken: string): Promise<AuthResponse | null> {
  const res = await _bearerFetch(`/auth/${provider}`, {
    method: 'POST',
    body: JSON.stringify({ id_token: idToken }),
  });
  if (!res.ok) return null;
  return (await _readJsonSafe(res)) as AuthResponse | null;
}

/* ═══════════════════════════════════════════
   OAuth: dynamic SDK loaders (no new pip dep on backend).
   Activate when VITE_GOOGLE_CLIENT_ID / VITE_APPLE_CLIENT_ID are set
   in Vercel env. Otherwise the action rejects cleanly with a clear
   "Configure …" message — no fake UI, no broken popup.
   ═══════════════════════════════════════════ */

const scriptLoadPromises = new Map<string, Promise<void>>();

function _loadScript(src: string): Promise<void> {
  const pending = scriptLoadPromises.get(src);
  if (pending) return pending;

  document.querySelector(`script[src="${src}"]`)?.remove();

  const promise = new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.async = true; s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => {
      s.remove();
      scriptLoadPromises.delete(src);
      reject(new Error(`Failed to load ${src}`));
    };
    document.head.appendChild(s);
  });
  scriptLoadPromises.set(src, promise);
  return promise;
}

async function googleIdToken(clientId: string): Promise<string> {
  await _loadScript('https://accounts.google.com/gsi/client');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = (window as any).google?.accounts?.id;
  if (!g) throw new Error('Google Identity Services failed to load');
  return new Promise<string>((resolve, reject) => {
    g.initialize({
      client_id: clientId,
      callback: (resp: { credential?: string; error?: string }) => {
        if (resp.credential) resolve(resp.credential);
        else reject(new Error(resp.error || 'Google sign-in cancelled'));
      },
    });
    g.prompt((notification: { isNotDisplayed: () => boolean; isSkippedMoment: () => boolean }) => {
      if (notification.isNotDisplayed?.() || notification.isSkippedMoment?.()) {
        reject(new Error('Google sign-in was dismissed.'));
      }
    });
  });
}

async function appleIdToken(clientId: string): Promise<string> {
  await _loadScript('https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const A = (window as any).AppleID?.auth;
  if (!A) throw new Error('Sign in with Apple SDK failed to load');
  A.init({
    clientId,
    scope: 'name email',
    redirectURI: window.location.origin,
    usePopup: true,
  });
  const result = await A.signIn();
  const tok = result?.authorization?.id_token;
  if (!tok) throw new Error('Apple sign-in returned no id_token');
  return tok as string;
}

/* ═══════════════════════════════════════════
   STORE
   ═══════════════════════════════════════════ */
export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      isOwner: false,
      isLoading: false,
      error: null,

      login: async (email, password) => {
        set({ isLoading: true, error: null });
        try {
          const r = await apiLogin(email, password);
          if (!r?.access_token || !r.user) {
            set({ isLoading: false, error: 'Invalid email or password' });
            return false;
          }
          const user = _toUser(r.user, 'email');
          set({ user, token: r.access_token, isAuthenticated: true, isOwner: !!user.isOwner, isLoading: false, error: null });
          return true;
        } catch (e) {
          console.error('[authStore] login failed:', e);
          set({ isLoading: false, error: 'Cannot reach the server. Try again.' });
          return false;
        }
      },

      signup: async (email, password, name) => {
        set({ isLoading: true, error: null });
        try {
          const r = await apiSignup(email, password, name);
          if (!r?.access_token || !r.user) {
            set({ isLoading: false, error: 'Could not create account. Try a different email.' });
            return false;
          }
          const user = _toUser(r.user, 'email');
          set({ user, token: r.access_token, isAuthenticated: true, isOwner: !!user.isOwner, isLoading: false, error: null });
          return true;
        } catch (e) {
          console.error('[authStore] signup failed:', e);
          set({ isLoading: false, error: 'Cannot reach the server. Try again.' });
          return false;
        }
      },

      logout: async () => {
        const token = get().token;
        set({ isLoading: true });
        await apiLogout(token);
        set({ user: null, token: null, isAuthenticated: false, isOwner: false, isLoading: false, error: null });
      },

      checkAuth: async () => {
        const token = get().token;
        if (!token) { set({ isLoading: false }); return; }
        set({ isLoading: true });
        const raw = await apiMe(token);
        if (raw) {
          const user = _toUser(raw, get().user?.provider ?? 'email');
          set({ user, isAuthenticated: true, isOwner: !!user.isOwner, isLoading: false });
        } else {
          // Token rejected — keep the persisted user (graceful), but flag unauthenticated.
          set({ token: null, isAuthenticated: false, isOwner: false, isLoading: false });
        }
      },

      continueAsGuest: () => {
        // Stable per-browser guest id so chat history can be associated
        // locally without a backend round-trip. Guest chats stay local
        // (per product spec) and do not sync.
        //
        // isAuthenticated is INTENTIONALLY false — guests have no
        // backend session, so any ProtectedRoute marked `guestAllowed:
        // false` (e.g. /settings) must correctly redirect them to
        // login. Routes that allow guests check `user?.provider ===
        // 'guest'` rather than this flag.
        let id = localStorage.getItem('korvix_guest_id') || '';
        if (!id) {
          id = (crypto.randomUUID?.() || `guest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
          localStorage.setItem('korvix_guest_id', id);
        }
        const user: AuthUser = {
          id, email: '', name: 'Guest', plan: 'free', provider: 'guest', isOwner: false,
        };
        set({ user, token: null, isAuthenticated: false, isOwner: false, isLoading: false, error: null });
      },

      loginWithGoogle: async () => {
        const clientId = (import.meta.env?.VITE_GOOGLE_CLIENT_ID as string | undefined) || '';
        if (!clientId) {
          set({ error: 'Google sign-in is not configured (set VITE_GOOGLE_CLIENT_ID).' });
          return false;
        }
        set({ isLoading: true, error: null });
        try {
          const idToken = await googleIdToken(clientId);
          const r = await apiOAuthExchange('google', idToken);
          if (!r?.access_token || !r.user) {
            set({ isLoading: false, error: 'Google sign-in failed on the backend.' });
            return false;
          }
          const user = _toUser(r.user, 'google');
          set({ user, token: r.access_token, isAuthenticated: true, isOwner: !!user.isOwner, isLoading: false, error: null });
          return true;
        } catch (e) {
          console.error('[authStore] Google sign-in failed:', e);
          set({ isLoading: false, error: e instanceof Error ? e.message : 'Google sign-in failed.' });
          return false;
        }
      },

      loginWithApple: async () => {
        const clientId = (import.meta.env?.VITE_APPLE_CLIENT_ID as string | undefined) || '';
        if (!clientId) {
          set({ error: 'Apple sign-in is not configured (set VITE_APPLE_CLIENT_ID).' });
          return false;
        }
        set({ isLoading: true, error: null });
        try {
          const idToken = await appleIdToken(clientId);
          const r = await apiOAuthExchange('apple', idToken);
          if (!r?.access_token || !r.user) {
            set({ isLoading: false, error: 'Apple sign-in failed on the backend.' });
            return false;
          }
          const user = _toUser(r.user, 'apple');
          set({ user, token: r.access_token, isAuthenticated: true, isOwner: !!user.isOwner, isLoading: false, error: null });
          return true;
        } catch (e) {
          console.error('[authStore] Apple sign-in failed:', e);
          set({ isLoading: false, error: e instanceof Error ? e.message : 'Apple sign-in failed.' });
          return false;
        }
      },

      clearError: () => set({ error: null }),
    }),
    {
      name: 'korvix-auth',
      partialize: (state) => ({
        user: state.user,
        token: state.token,
        isAuthenticated: state.isAuthenticated,
        isOwner: state.isOwner,
      }),
    }
  )
);

/**
 * Public selector used by useChat (and any future consumer) to bind a
 * conversation to the current user. Falls back to the persisted guest
 * id when no session is active — preserves the prior anonymous flow.
 */
export function getActiveUserId(): string {
  const s = useAuthStore.getState();
  if (s.user?.id) return s.user.id;
  let id = localStorage.getItem('korvix_guest_id') || localStorage.getItem('korvix_user_id') || '';
  if (!id) {
    id = (crypto.randomUUID?.() || `guest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    localStorage.setItem('korvix_guest_id', id);
  }
  return id;
}
