/**
 * Single source of truth for the backend API host across the frontend.
 *
 * - Reads `VITE_API_URL` at build time (Vercel env), so the host is
 *   configurable per environment without code changes.
 * - Defaults to the live Railway backend when the env var is unset,
 *   so dev / preview builds always have a working endpoint.
 * - Strips a trailing slash to make `${API_BASE_URL}/chat` etc. safe.
 *
 * Use this from every hook/store that hits the backend (chat,
 * trading, auth, health, debug). Never hardcode the host in a
 * call site — those keep regressing to dead hosts (worker-production-2a49,
 * worker-production-1345, …) when "fix" commits land.
 */
export const API_BASE_URL: string =
  ((import.meta.env?.VITE_API_URL as string | undefined) ?? '').replace(/\/$/, '') ||
  'https://worker-production-1345.up.railway.app';
