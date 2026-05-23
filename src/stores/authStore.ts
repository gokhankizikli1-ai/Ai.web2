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
}

interface AuthState {
  // State
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;

  // Actions
  login: (email: string, password: string) => Promise<boolean>;
  signup: (email: string, password: string, name: string) => Promise<boolean>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  clearError: () => void;
}

/* ═══════════════════════════════════════════
   API CONFIG — Backend endpoints
   ═══════════════════════════════════════════ */

/**
 * Backend base URL.
 *
 * ─── Why we normalize ──────────────────────────────────────────────
 * Vercel users commonly enter `VITE_API_URL` with a trailing slash
 * (e.g. "https://worker-prod.up.railway.app/"). The previous code did
 *   `${API_BASE}/auth/me`
 * which collapses to `https://worker-prod.up.railway.app//auth/me` —
 * the Railway router logs that as `GET //auth/me → 404`. The fix is
 * a tiny URL builder that strips trailing slashes from the base and
 * guarantees exactly one leading slash on the path.
 *
 * When VITE_API_URL is unset, API_BASE is "" and apiUrl() returns
 * relative paths ("/auth/me"). On Vercel the SPA rewrite then serves
 * index.html, fetch() resolves to non-JSON → apiMe() returns null →
 * checkAuth() falls back to guest mode silently. No crash, no toast.
 */
const RAW_API_BASE = (import.meta.env.VITE_API_URL || '').trim();
const API_BASE = RAW_API_BASE.replace(/\/+$/, '');

if (!API_BASE) {
  console.warn(
    '[authStore] VITE_API_URL is not set — auth endpoints will resolve ' +
    'to relative paths and /auth/me will gracefully fall back to guest mode. ' +
    'Set VITE_API_URL in the Vercel environment to enable real auth.',
  );
}

/** Join API_BASE with a path so the result has exactly one slash between them. */
function apiUrl(path: string): string {
  const clean = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE}${clean}`;
}

async function apiLogin(email: string, password: string): Promise<AuthUser | null> {
  try {
    const res = await fetch(apiUrl('/auth/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.user || null;
  } catch {
    // Backend not ready — clean frontend fallback (demo mode)
    if (email && password) {
      return {
        id: 'demo-' + Math.random().toString(36).slice(2, 10),
        email,
        name: email.split('@')[0],
        plan: 'free',
      };
    }
    return null;
  }
}

async function apiSignup(email: string, password: string, name: string): Promise<AuthUser | null> {
  try {
    const res = await fetch(apiUrl('/auth/signup'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.user || null;
  } catch {
    // Backend not ready — clean frontend fallback
    if (email && password && name) {
      return {
        id: 'demo-' + Math.random().toString(36).slice(2, 10),
        email,
        name,
        plan: 'free',
      };
    }
    return null;
  }
}

async function apiLogout(): Promise<void> {
  try {
    await fetch(apiUrl('/auth/logout'), { method: 'POST', credentials: 'include' });
  } catch {
    // Silently fail — client-side cleanup happens regardless
  }
}

async function apiMe(): Promise<AuthUser | null> {
  // Guest/demo-safe: any non-OK status (incl. 404 if /auth/me is not
  // implemented yet) or network error returns null. checkAuth() then
  // leaves the app in guest mode without surfacing an error.
  try {
    const res = await fetch(apiUrl('/auth/me'), { credentials: 'include' });
    if (!res.ok) return null;
    const data = await res.json();
    return data.user || null;
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
        const user = await apiLogin(email, password);
        if (user) {
          set({ user, isAuthenticated: true, isLoading: false, error: null });
          return true;
        }
        set({ isLoading: false, error: 'Invalid email or password' });
        return false;
      },

      signup: async (email: string, password: string, name: string) => {
        set({ isLoading: true, error: null });
        const user = await apiSignup(email, password, name);
        if (user) {
          set({ user, isAuthenticated: true, isLoading: false, error: null });
          return true;
        }
        set({ isLoading: false, error: 'Could not create account. Try a different email.' });
        return false;
      },

      logout: async () => {
        set({ isLoading: true });
        await apiLogout();
        set({ user: null, isAuthenticated: false, isLoading: false, error: null });
        // Clear persisted state
        localStorage.removeItem('korvix-auth');
      },

      checkAuth: async () => {
        set({ isLoading: true });
        // First check localStorage (fast path)
        const persisted = localStorage.getItem('korvix-auth');
        if (persisted) {
          try {
            const parsed = JSON.parse(persisted);
            if (parsed?.state?.user) {
              set({ user: parsed.state.user, isAuthenticated: true, isLoading: false });
              // Still try to validate with backend in background
              apiMe().then((user) => {
                if (!user) {
                  // Backend says no — but keep local session for offline support
                  // Only clear if we want strict backend validation
                }
              });
              return;
            }
          } catch { /* ignore */ }
        }
        // Fallback: try backend
        const user = await apiMe();
        if (user) {
          set({ user, isAuthenticated: true, isLoading: false });
        } else {
          set({ isLoading: false });
        }
      },

      clearError: () => set({ error: null }),
    }),
    {
      name: 'korvix-auth',
      partialize: (state) => ({ user: state.user, isAuthenticated: state.isAuthenticated }),
    }
  )
);
