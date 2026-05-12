/**
 * Sessions API client — Phase 2 workspace persistence.
 *
 * Thin typed wrapper over /sessions/* on the canonical Railway backend.
 * Every method is best-effort: on 503 (ENABLE_SESSIONS=false), network
 * failure, abort, or unexpected response, it returns null / [] rather
 * than throwing. Callers (useChat, future workspace hooks) can sync
 * write-through without blocking the UI — if the call silently fails,
 * the local chat state keeps working.
 *
 * Capability discovery: GET /v2/health returns `metadata.sessions_enabled`.
 * When false, the rest of the methods short-circuit immediately.
 */

const API_ORIGIN = 'https://worker-production-1345.up.railway.app';
const REQUEST_TIMEOUT_MS = 8_000;

// ── Types — mirror the backend Workspace/Thread/Message dataclasses ──

export interface Workspace {
  id:           string;
  user_id:      string;
  name:         string;
  slug:         string;
  kind:         string;
  is_archived:  boolean;
  created_at:   string;
  updated_at:   string;
  metadata:     Record<string, unknown>;
}

export interface Thread {
  id:           string;
  workspace_id: string;
  title:        string;
  mode:         string;
  status:       string;
  created_at:   string;
  updated_at:   string;
  metadata:     Record<string, unknown>;
}

export interface ThreadMessage {
  id:         string;
  thread_id:  string;
  role:       'user' | 'assistant' | 'system';
  content:    string;
  model:      string | null;
  tokens:     number | null;
  created_at: string;
  metadata:   Record<string, unknown>;
}

// ── Capability cache ───────────────────────────────────────────────────
// Read once per page load. /v2/health is unauthenticated + fast.

let _capabilityCache: { enabled: boolean; checkedAt: number } | null = null;
const CAPABILITY_TTL_MS = 60_000;

async function probeSessionsEnabled(): Promise<boolean> {
  const now = Date.now();
  if (_capabilityCache && now - _capabilityCache.checkedAt < CAPABILITY_TTL_MS) {
    return _capabilityCache.enabled;
  }
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    const res = await fetch(`${API_ORIGIN}/v2/health`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) {
      _capabilityCache = { enabled: false, checkedAt: now };
      return false;
    }
    const body = await res.json();
    // /v2/health envelope: { success, data, error, metadata, timestamp }
    const enabled = !!body?.metadata?.sessions_enabled;
    _capabilityCache = { enabled, checkedAt: now };
    return enabled;
  } catch {
    // Network failure / parse failure — treat as disabled. The cache
    // keeps us from hammering a down endpoint on every send.
    _capabilityCache = { enabled: false, checkedAt: now };
    return false;
  }
}

// Exposed so callers can force a fresh probe (e.g. after a manual retry).
export function invalidateSessionsCapabilityCache(): void {
  _capabilityCache = null;
}

export async function isSessionsEnabled(): Promise<boolean> {
  return probeSessionsEnabled();
}

// ── Low-level fetch helper ─────────────────────────────────────────────

async function call<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_ORIGIN}${path}`, {
      method,
      signal:  ctrl.signal,
      headers: { 'Content-Type': 'application/json' },
      body:    body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// ── Public API ────────────────────────────────────────────────────────

async function ensureDefaultWorkspace(userId: string): Promise<Workspace | null> {
  if (!(await probeSessionsEnabled())) return null;
  // `user_id` is a query param per backend/routes/sessions.py:145
  return call<Workspace>('POST', `/sessions/workspaces/ensure_default?user_id=${encodeURIComponent(userId)}`);
}

async function createThread(
  workspaceId: string,
  title: string,
  mode: string = 'chat',
): Promise<Thread | null> {
  if (!(await probeSessionsEnabled())) return null;
  return call<Thread>(
    'POST',
    `/sessions/workspaces/${encodeURIComponent(workspaceId)}/threads`,
    { title, mode, metadata: {} },
  );
}

async function listMessages(threadId: string): Promise<ThreadMessage[]> {
  if (!(await probeSessionsEnabled())) return [];
  const result = await call<{ messages: ThreadMessage[] }>(
    'GET',
    `/sessions/threads/${encodeURIComponent(threadId)}/messages`,
  );
  return result?.messages ?? [];
}

async function appendMessage(
  threadId: string,
  role: ThreadMessage['role'],
  content: string,
  metadata: Record<string, unknown> = {},
): Promise<ThreadMessage | null> {
  if (!(await probeSessionsEnabled())) return null;
  return call<ThreadMessage>(
    'POST',
    `/sessions/threads/${encodeURIComponent(threadId)}/messages`,
    { role, content, metadata },
  );
}

export const sessionsClient = {
  ensureDefaultWorkspace,
  createThread,
  listMessages,
  appendMessage,
  isEnabled: isSessionsEnabled,
};

export type SessionsClient = typeof sessionsClient;
