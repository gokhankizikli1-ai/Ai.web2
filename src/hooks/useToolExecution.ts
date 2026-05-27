// useToolExecution — Phase 10 hook for invoking a tool from the FE.
//
// POSTs to /v2/tools/execute and returns:
//   - executing  true while the request is in flight
//   - result     the tool's normalised envelope { status, data, ... }
//   - executionId  the row id in /v2/tools/executions
//   - error      a normalised string on hard failure (e.g. 404, network)
//
// Doesn't poll the execution history afterward — callers that need to
// watch a background-mode execution use /v2/tools/executions/{id}
// directly (next PR). For sync-mode tools (the only kind in this PR)
// the result lands inline, so polling would be wasteful.
import { useCallback, useRef, useState } from 'react';

const BUNDLED_BACKEND = 'https://api.korvixai.com';

function resolveBase(): string {
  const envBase = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
  return envBase ? envBase.replace(/\/+$/, '') : BUNDLED_BACKEND;
}

const URL_ENDPOINT = `${resolveBase()}/v2/tools/execute`;

function getToken(): string | null {
  try { return localStorage.getItem('korvix_access_token'); }
  catch { return null; }
}

export interface ToolResultEnvelope {
  tool:      string;
  status:    string;            // "available" | "unavailable" | "error"
  data:      unknown;
  message:   string | null;
  provider:  string | null;
  source:    string | null;
  timestamp: string;
  is_live:   boolean;
}

export interface UseToolExecutionResult {
  executing:    boolean;
  result:       ToolResultEnvelope | null;
  executionId:  string | null;
  error:        string | null;
  execute: (
    toolId:    string,
    options?: {
      query?:          string;
      payload?:        Record<string, unknown>;
      panelId?:        string;
      agentId?:        string;
      projectId?:      string;
      workflowId?:     string;
      correlationId?:  string;
    },
  ) => Promise<ToolResultEnvelope | null>;
  reset: () => void;
}


export function useToolExecution(): UseToolExecutionResult {
  const [executing, setExecuting]     = useState(false);
  const [result, setResult]           = useState<ToolResultEnvelope | null>(null);
  const [executionId, setExecutionId] = useState<string | null>(null);
  const [error, setError]             = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    if (abortRef.current) {
      try { abortRef.current.abort(); } catch { /* ignore */ }
      abortRef.current = null;
    }
    setExecuting(false);
    setResult(null);
    setExecutionId(null);
    setError(null);
  }, []);

  const execute = useCallback(async (
    toolId: string,
    options: {
      query?:         string;
      payload?:       Record<string, unknown>;
      panelId?:       string;
      agentId?:       string;
      projectId?:     string;
      workflowId?:    string;
      correlationId?: string;
    } = {},
  ): Promise<ToolResultEnvelope | null> => {
    setError(null);
    setResult(null);
    setExecutionId(null);
    setExecuting(true);

    // Cancel any prior in-flight execution from this hook instance.
    if (abortRef.current) {
      try { abortRef.current.abort(); } catch { /* ignore */ }
    }
    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const tok = getToken();
      if (tok) headers['Authorization'] = `Bearer ${tok}`;

      const res = await fetch(URL_ENDPOINT, {
        method: 'POST',
        headers,
        signal: ac.signal,
        body: JSON.stringify({
          tool_id:        toolId,
          query:          options.query ?? '',
          payload:        options.payload ?? null,
          panel_id:       options.panelId,
          agent_id:       options.agentId,
          project_id:     options.projectId,
          workflow_id:    options.workflowId,
          correlation_id: options.correlationId,
        }),
      });

      if (!res.ok) {
        // Try to surface the route's structured error code.
        let msg = `HTTP ${res.status}`;
        try {
          const body = await res.json();
          const code = body?.detail?.code;
          const m    = body?.detail?.message;
          if (code) msg = m ? `[${code}] ${m}` : `[${code}]`;
        } catch { /* keep generic */ }
        setError(msg);
        return null;
      }

      const body = await res.json();
      const data = body?.data ?? {};
      const env  = data.result as ToolResultEnvelope | undefined;
      const exId = data.execution_id as string | undefined;
      if (env) setResult(env);
      if (exId) setExecutionId(exId);
      return env ?? null;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return null;
      }
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      return null;
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
      setExecuting(false);
    }
  }, []);

  return { executing, result, executionId, error, execute, reset };
}

export default useToolExecution;
