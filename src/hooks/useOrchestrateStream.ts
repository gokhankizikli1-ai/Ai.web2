/* ═══════════════════════════════════════════════════════════════════
   Phase 5.2 — per-specialist token streaming consumer.
   ═══════════════════════════════════════════════════════════════════
   POST /v2/orchestrate/stream returns text/event-stream. Browser
   EventSource doesn't support POST + custom bodies, so we read the
   response with fetch + getReader() and parse SSE frames ourselves.

   The hook exposes a single async function `runOrchestration(body, handlers)`
   that the caller drives. Handlers fire per SSE event type defined in
   the Phase 5.2 brief:

     - supervisor_planning       { run_id, agent_id, ts }
     - task_queued               { task_id, agent_id, title, depth, ... }
     - task_started              { task_id, agent_id, provider, ... }
     - token_delta               { task_id, agent_id, delta, seq, provider }
     - task_progress             { task_id, chars, chunks }
     - task_completed            { task_id, agent_id, reply_chars, elapsed_ms }
     - task_failed               { task_id, agent_id, error }
     - orchestration_completed   { run_id, reply, agents_used, task_graph, metadata }
     - orchestration_failed      { run_id, error }

   Cancellation: returns an AbortController. Calling .abort() closes
   the response stream, which the backend route translates into a
   cancellation of the underlying orchestration task — provider streams
   stop, the agent.token bus emissions stop, the bus subscription is
   released. */

export interface OrchestrateStreamHandlers {
  onSupervisorPlanning?: (data: Record<string, unknown>) => void;
  onTaskQueued?:         (data: Record<string, unknown>) => void;
  onTaskStarted?:        (data: Record<string, unknown>) => void;
  onTokenDelta?:         (data: Record<string, unknown>) => void;
  onTaskProgress?:       (data: Record<string, unknown>) => void;
  onTaskCompleted?:      (data: Record<string, unknown>) => void;
  onTaskFailed?:         (data: Record<string, unknown>) => void;
  onOrchestrationCompleted?: (data: Record<string, unknown>) => void;
  onOrchestrationFailed?:    (data: Record<string, unknown>) => void;
  onHeartbeat?:          () => void;
  onError?:              (err: unknown) => void;
}

export interface OrchestrateStreamBody {
  user_id:         string;
  message:         string;
  project_id?:     string;
  agent_id?:       string;
  mode?:           string;
  metadata?:       Record<string, unknown>;
  recent_messages?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
}

function getApiBase(): string {
  const env = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
  if (env) return env.replace(/\/+$/, '');
  return 'https://worker-production-1345.up.railway.app';
}

/**
 * Open a streaming POST to /v2/orchestrate/stream and route SSE
 * frames to the supplied handlers. Returns an AbortController so
 * the caller can cancel mid-stream. The returned promise resolves
 * when the stream closes (either naturally after
 * orchestration_completed or on abort).
 *
 * Resolves with `{ ok: boolean; status: number; final?: object }`
 * where `final` is the parsed orchestration_completed payload (if
 * the stream produced one). Caller can use this to decide whether
 * to fall back to /v2/orchestrate.
 */
export async function runOrchestrationStream(
  body: OrchestrateStreamBody,
  handlers: OrchestrateStreamHandlers,
  signal?: AbortSignal,
): Promise<{ ok: boolean; status: number; final?: Record<string, unknown> }> {
  const apiBase = getApiBase();
  let res: Response;
  try {
    res = await fetch(`${apiBase}/v2/orchestrate/stream`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
      body:    JSON.stringify(body),
      signal,
    });
  } catch (err) {
    handlers.onError?.(err);
    return { ok: false, status: 0 };
  }

  if (!res.ok || !res.body) {
    handlers.onError?.(new Error(`stream HTTP ${res.status}`));
    return { ok: false, status: res.status };
  }

  const reader  = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let final: Record<string, unknown> | undefined;

  try {
    /* eslint-disable no-constant-condition */
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sep = buffer.indexOf('\n\n');
      while (sep !== -1) {
        const rawFrame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        sep = buffer.indexOf('\n\n');

        // Handle SSE comment frames (heartbeats)
        if (rawFrame.startsWith(':')) {
          handlers.onHeartbeat?.();
          continue;
        }

        // Parse `event:` + `data:` lines (multi-line data joined with \n)
        let eventName: string | null = null;
        const dataLines: string[] = [];
        for (const line of rawFrame.split('\n')) {
          if (line.startsWith('event:'))      eventName = line.slice(6).trim();
          else if (line.startsWith('data:'))  dataLines.push(line.slice(5).trim());
          else if (line.startsWith(':'))      handlers.onHeartbeat?.();
        }
        if (!eventName || dataLines.length === 0) continue;
        let data: Record<string, unknown> = {};
        try {
          data = JSON.parse(dataLines.join('\n'));
        } catch {
          continue;
        }

        switch (eventName) {
          case 'supervisor_planning':
            handlers.onSupervisorPlanning?.(data); break;
          case 'task_queued':
            handlers.onTaskQueued?.(data); break;
          case 'task_started':
            handlers.onTaskStarted?.(data); break;
          case 'token_delta':
            handlers.onTokenDelta?.(data); break;
          case 'task_progress':
            handlers.onTaskProgress?.(data); break;
          case 'task_completed':
            handlers.onTaskCompleted?.(data); break;
          case 'task_failed':
            handlers.onTaskFailed?.(data); break;
          case 'orchestration_completed':
            final = data;
            handlers.onOrchestrationCompleted?.(data); break;
          case 'orchestration_failed':
            handlers.onOrchestrationFailed?.(data); break;
          default:
            // Unknown event name — ignore. The backend may add new
            // event types in future phases; older clients should
            // gracefully drop them.
            break;
        }
      }
    }
  } catch (err) {
    // AbortError when the caller cancels — not an error condition.
    if (signal?.aborted) {
      return { ok: true, status: res.status, final };
    }
    handlers.onError?.(err);
    return { ok: false, status: res.status, final };
  } finally {
    try { reader.releaseLock(); } catch { /* noop */ }
  }

  return { ok: true, status: res.status, final };
}
