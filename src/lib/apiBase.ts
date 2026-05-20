/**
 * Single source of truth for the backend API host.
 * `VITE_API_URL` (Vercel env) overrides; defaults to the live Railway
 * backend. A trailing slash is stripped so `${API_BASE_URL}/chat` etc.
 * are always well-formed.
 */
export const API_BASE_URL: string =
  ((import.meta.env?.VITE_API_URL as string | undefined) ?? '').replace(/\/$/, '') ||
  'https://worker-production-1345.up.railway.app';
