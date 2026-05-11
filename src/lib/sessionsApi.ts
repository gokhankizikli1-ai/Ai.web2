// Phase W1 — Sessions API client.
//
// Thin typed wrapper around the M2 backend routes (`/sessions/*`). Every
// function returns a typed Promise or null on transient failure — these
// helpers never throw on network errors so the chat UI can keep working
// when the server is misbehaving.
//
// Activation: the backend's `ENABLE_SESSIONS=true` flag controls everything.
// The frontend probes `/sessions/health` at mount and falls back to the
// local-only path when `enabled=false`.

const API_ORIGIN = 'https://worker-production-1345.up.railway.app';

// ── Types (kept inline; the chat domain types live in `@/types`) ─────────

export interface ServerWorkspace {
  id:           string;
  user_id:      string;
  name:         string;
  slug:         string;
  kind:         string;
  created_at:   string | null;
  updated_at:   string | null;
  archived_at:  string | null;
  metadata:     Record<string, unknown>;
}

export interface ServerThread {
  id:           string;
  workspace_id: string;
  title:        string;
  mode:         string | null;
  status:       string;
  summary:      string | null;
  created_at:   string | null;
  updated_at:   string | null;
  archived_at:  string | null;
  metadata:     Record<string, unknown>;
}

export interface ServerMessage {
  id:         string;
  thread_id:  string;
  role:       string;
  content:    string;
  created_at: string | null;
  tokens:     number | null;
  model:      string | null;
  metadata:   Record<string, unknown>;
}

export interface SessionsHealth {
  enabled: boolean;
  phase:   string;
  stats:   Record<string, unknown> | null;
}


// ── Internal fetch wrapper ───────────────────────────────────────────────

async function _fetch<T>(
  path: string,
  init?: RequestInit,
  { timeoutMs = 8_000 }: { timeoutMs?: number } = {},
): Promise<T | null> {
  const ctrl    = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(`${API_ORIGIN}${path}`, {
      ...init,
      signal:  ctrl.signal,
      headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    });
    if (!resp.ok) {
      if (resp.status === 503 || resp.status === 404) return null;   // disabled / not-found are expected
      // eslint-disable-next-line no-console
      console.warn(`[sessionsApi] ${init?.method ?? 'GET'} ${path} → HTTP ${resp.status}`);
      return null;
    }
    return (await resp.json()) as T;
  } catch (err) {
    // Defensive: `err` can be any value (string, null, frozen object, …).
    // Use safe access throughout so the catch handler itself can never throw.
    let isAbort = false;
    try {
      isAbort = !!err && typeof err === 'object' && (err as { name?: unknown }).name === 'AbortError';
    } catch { /* ignore */ }
    if (!isAbort) {
      // eslint-disable-next-line no-console
      try { console.warn(`[sessionsApi] ${init?.method ?? 'GET'} ${path} failed:`, err); } catch { /* ignore */ }
    }
    return null;
  } finally {
    clearTimeout(timeout);
  }
}


// ── Public API ───────────────────────────────────────────────────────────

export async function getHealth(): Promise<SessionsHealth | null> {
  return _fetch<SessionsHealth>('/sessions/health', { method: 'GET' }, { timeoutMs: 4_000 });
}

export async function ensureDefaultWorkspace(userId: string): Promise<ServerWorkspace | null> {
  // The route is a POST with the user_id passed as a query parameter.
  const qs = new URLSearchParams({ user_id: userId }).toString();
  return _fetch<ServerWorkspace>(`/sessions/workspaces/ensure_default?${qs}`, { method: 'POST' });
}

export async function listThreads(workspaceId: string, opts?: { includeArchived?: boolean; limit?: number }): Promise<ServerThread[]> {
  const params = new URLSearchParams();
  if (opts?.includeArchived) params.set('include_archived', 'true');
  if (typeof opts?.limit === 'number') params.set('limit', String(opts.limit));
  const qs   = params.toString();
  const path = `/sessions/workspaces/${encodeURIComponent(workspaceId)}/threads${qs ? '?' + qs : ''}`;
  const res  = await _fetch<{ threads: ServerThread[] }>(path);
  return res?.threads ?? [];
}

export async function createThread(workspaceId: string, body: { title?: string; mode?: string; metadata?: Record<string, unknown> }): Promise<ServerThread | null> {
  return _fetch<ServerThread>(`/sessions/workspaces/${encodeURIComponent(workspaceId)}/threads`, {
    method: 'POST',
    body:   JSON.stringify(body),
  });
}

export async function updateThread(threadId: string, body: { title?: string; mode?: string; status?: string; summary?: string }): Promise<ServerThread | null> {
  return _fetch<ServerThread>(`/sessions/threads/${encodeURIComponent(threadId)}`, {
    method: 'PATCH',
    body:   JSON.stringify(body),
  });
}

export async function archiveThread(threadId: string): Promise<boolean> {
  const res = await _fetch<{ archived: boolean }>(`/sessions/threads/${encodeURIComponent(threadId)}`, { method: 'DELETE' });
  return !!res?.archived;
}

export async function listMessages(threadId: string, opts?: { limit?: number; afterId?: string }): Promise<ServerMessage[]> {
  const params = new URLSearchParams();
  if (typeof opts?.limit === 'number') params.set('limit', String(opts.limit));
  if (opts?.afterId)                   params.set('after_id', opts.afterId);
  const qs   = params.toString();
  const path = `/sessions/threads/${encodeURIComponent(threadId)}/messages${qs ? '?' + qs : ''}`;
  const res  = await _fetch<{ messages: ServerMessage[] }>(path);
  return res?.messages ?? [];
}

export async function appendMessage(threadId: string, body: { role: string; content: string; model?: string; tokens?: number; metadata?: Record<string, unknown> }): Promise<ServerMessage | null> {
  return _fetch<ServerMessage>(`/sessions/threads/${encodeURIComponent(threadId)}/messages`, {
    method: 'POST',
    body:   JSON.stringify(body),
  });
}


// ── Helpers ──────────────────────────────────────────────────────────────

/** True when the backend reports sessions enabled. Probed once at app mount. */
export async function isEnabled(): Promise<boolean> {
  const h = await getHealth();
  return !!h?.enabled;
}
