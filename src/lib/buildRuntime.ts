// Phase 1 (headless) — injectable build runtime.
//
// The production Web/App build spine (webBuildApi.ts, webBuildFrontendQuality.ts)
// historically read browser globals directly: the auth token from
// localStorage, the API base from import.meta.env, the fetch transport from the
// browser, and a verification redirect via window.location. That coupling made
// the spine impossible to run under Node (headless).
//
// This module turns those EXECUTION-REQUIRED browser dependencies into injected
// dependencies WITHOUT changing interactive behavior: every accessor has a
// default that reproduces the exact previous browser behavior, and an optional
// override installed via `setBuildRuntime(...)`. In the browser nothing changes
// (no override → defaults). In a headless worker, `runHeadlessBuild` installs an
// override carrying { authToken, apiBase, fetch } — so the SAME spine functions
// (same prompts, contracts, validators) execute with zero window/localStorage
// access. This is dependency injection, not a second builder.

const BUNDLED_BACKEND = 'https://worker-production-1345.up.railway.app';

export interface BuildRuntimeOverride {
  getAuthToken?: () => string | null;
  getUserId?: () => string;
  getApiBase?: () => string;
  getFetch?: () => typeof fetch;
  onVerificationRequired?: () => void;
}

let _override: BuildRuntimeOverride | null = null;

// ── Defaults (exact previous browser behavior) ─────────────────────────────

function defaultApiBase(): string {
  // import.meta.env is a Vite construct; guard it so this module also imports
  // cleanly under Node (headless), where the override supplies the base.
  let envBase: string | undefined;
  try {
    envBase = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_API_URL;
  } catch {
    envBase = undefined;
  }
  const trimmed = envBase?.trim();
  return trimmed ? trimmed.replace(/\/+$/, '') : BUNDLED_BACKEND;
}

function defaultAuthToken(): string | null {
  try {
    return localStorage.getItem('korvix_access_token');
  } catch {
    return null;
  }
}

function defaultUserId(): string {
  const key = 'korvix_user_id';
  try {
    let id = localStorage.getItem(key);
    if (!id) {
      id = crypto.randomUUID ? crypto.randomUUID() : `${Math.random().toString(36).slice(2)}${Date.now()}`;
      localStorage.setItem(key, id);
    }
    return id;
  } catch {
    return 'guest_anon';
  }
}

function defaultFetch(): typeof fetch {
  return globalThis.fetch.bind(globalThis);
}

function defaultOnVerificationRequired(): void {
  try {
    window.dispatchEvent(new CustomEvent('korvix:verification-required'));
    if (!String(window.location.hash || '').includes('/verify-email')) {
      window.location.hash = '#/verify-email';
    }
  } catch {
    /* noop — no window (headless) */
  }
}

// ── Public accessors (used by the spine) ───────────────────────────────────

export const buildRuntime = {
  getAuthToken: (): string | null =>
    _override?.getAuthToken ? _override.getAuthToken() : defaultAuthToken(),
  getUserId: (): string =>
    _override?.getUserId ? _override.getUserId() : defaultUserId(),
  getApiBase: (): string =>
    _override?.getApiBase ? _override.getApiBase() : defaultApiBase(),
  getFetch: (): typeof fetch =>
    _override?.getFetch ? _override.getFetch() : defaultFetch(),
  onVerificationRequired: (): void =>
    (_override?.onVerificationRequired ?? defaultOnVerificationRequired)(),
};

// ── Override lifecycle (headless) ──────────────────────────────────────────

export function setBuildRuntime(override: BuildRuntimeOverride): void {
  _override = override;
}

export function resetBuildRuntime(): void {
  _override = null;
}

export function isHeadless(): boolean {
  return _override !== null;
}
