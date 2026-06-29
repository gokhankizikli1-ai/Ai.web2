// useProjectOrchestrator — Phase A.2 client for the Project Orchestrator.
//
// Thin typed wrapper over /v2/orchestrator/*: start a multi-agent
// project run, read its composite snapshot (run + workflow + deliverables
// + task graph), cancel it, and list available templates.
//
// SCOPE: this is the FE layer PR #3 (Project Hub UX) consumes. Per the
// AI_OS_ROADMAP, PR #2 ships the API + this client; the ProjectWorkspace
// page wiring + live components land in PR #3. The run subscription here
// is poll-based (re-reads the snapshot on an interval) — the same
// approach useScratchpad uses — because the SSE endpoint is JWT-gated
// and EventSource can't attach an Authorization header. PR #3 can swap
// in a fetch-stream reader if it needs sub-second updates.
import { useCallback, useEffect, useRef, useState } from 'react';

const BUNDLED_BACKEND = 'https://api.korvixai.com';

function resolveBase(): string {
  const envBase = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
  return envBase ? envBase.replace(/\/+$/, '') : BUNDLED_BACKEND;
}

const BASE = resolveBase();

function getToken(): string | null {
  try { return localStorage.getItem('korvix_access_token'); }
  catch { return null; }
}

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const tok = getToken();
  if (tok) h.Authorization = `Bearer ${tok}`;
  return h;
}

// ── Types ────────────────────────────────────────────────────────────

export type DeliverableStatus =
  | 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';

export interface DeliverableView {
  id:         string;
  run_id:     string;
  project_id: string | null;
  agent_id:   string;
  node_id:    string;
  kind:       string;
  title:      string;
  status:     DeliverableStatus;
  content:    Record<string, unknown>;
  version:    number;
  error:      string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskView {
  id:             string;
  run_id:         string;
  title:          string;
  assigned_agent: string;
  status:         string;
  dependencies:   string[];
  result_summary: string;
}

export interface WorkflowBlock {
  id:       string;
  status:   string;
  progress: number;
  steps:    Array<{ id: string; label: string; status: string; dependencies: string[] }>;
}

export interface RunSnapshot {
  run_id:        string;
  status:        string;
  template_id:   string | null;
  panel_id:      string | null;
  workflow:      WorkflowBlock | null;
  deliverables:  DeliverableView[];
  task_graph:    { run_id: string; tasks: TaskView[]; counts: Record<string, number>; total_count: number };
  runner_started?: boolean;
  runner_error?:   string;
  run?: { status: string; [k: string]: unknown };
}

export interface TemplateView {
  id:          string;
  name:        string;
  description: string;
  workflow_type: string;
  nodes: Array<{ key: string; agent_id: string; title: string; deliverable_kind: string; depends_on: string[] }>;
}

const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'finished', 'errored']);

export function isRunTerminal(status: string | undefined | null): boolean {
  return !!status && TERMINAL.has(status);
}

// ── Imperative client ─────────────────────────────────────────────────

async function unwrap<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.success === false) {
    const code = body?.metadata?.code || `http_${res.status}`;
    const msg = body?.error || `request failed (${res.status})`;
    throw Object.assign(new Error(msg), { code, status: res.status });
  }
  return (body?.data ?? body) as T;
}

export const projectOrchestratorClient = {
  async startRun(input: {
    userRequest: string;
    projectId?: string;
    templateId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<RunSnapshot> {
    const res = await fetch(`${BASE}/v2/orchestrator/run`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        user_request: input.userRequest,
        project_id: input.projectId,
        template_id: input.templateId,
        metadata: input.metadata,
      }),
    });
    return unwrap<RunSnapshot>(res);
  },

  async getRun(runId: string, signal?: AbortSignal): Promise<RunSnapshot> {
    const res = await fetch(`${BASE}/v2/orchestrator/runs/${encodeURIComponent(runId)}`, {
      headers: authHeaders(), signal,
    });
    return unwrap<RunSnapshot>(res);
  },

  async cancelRun(runId: string): Promise<RunSnapshot> {
    const res = await fetch(`${BASE}/v2/orchestrator/runs/${encodeURIComponent(runId)}/cancel`, {
      method: 'POST', headers: authHeaders(),
    });
    return unwrap<RunSnapshot>(res);
  },

  async listTemplates(): Promise<TemplateView[]> {
    const res = await fetch(`${BASE}/v2/orchestrator/templates`, { headers: authHeaders() });
    const data = await unwrap<{ templates: TemplateView[] }>(res);
    return data.templates ?? [];
  },
};

// ── Poll-based run subscription hook ───────────────────────────────────

export interface UseProjectRunResult {
  snapshot:  RunSnapshot | null;
  loading:   boolean;
  error:     string | null;
  isTerminal: boolean;
  refresh:   () => void;
}

const POLL_MS = 1500;

export function useProjectRun(
  runId: string | null | undefined,
  opts: { pollMs?: number } = {},
): UseProjectRunResult {
  const { pollMs = POLL_MS } = opts;
  const [snapshot, setSnapshot] = useState<RunSnapshot | null>(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchOnce = useCallback(async () => {
    if (!runId) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    try {
      const snap = await projectOrchestratorClient.getRun(runId, ctrl.signal);
      setSnapshot(snap);
      setError(null);
    } catch (e: unknown) {
      if ((e as { name?: string })?.name !== 'AbortError') {
        setError((e as Error)?.message || 'failed to load run');
      }
    } finally {
      setLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    if (!runId) return;
    let active = true;
    fetchOnce();
    const tick = () => {
      if (!active) return;
      // Stop polling once the run is terminal.
      if (isRunTerminal(snapshot?.status)) return;
      fetchOnce();
    };
    const id = setInterval(tick, pollMs);
    return () => { active = false; clearInterval(id); abortRef.current?.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, pollMs, snapshot?.status, fetchOnce]);

  return {
    snapshot,
    loading,
    error,
    isTerminal: isRunTerminal(snapshot?.status),
    refresh: fetchOnce,
  };
}
