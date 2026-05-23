import { useEffect, useState, useRef, useCallback } from 'react';

/* ═══════════════════════════════════════════════════════════════════
   Phase 3.5 — Realtime project activity via SSE.
   ═══════════════════════════════════════════════════════════════════
   Subscribes a browser EventSource to /v2/events/stream scoped to a
   project. The hook is purely additive: components that don't import
   it are unaffected. Components that DO import it can render live
   agent activity while preserving demo fallback behaviour — when
   `events` is empty (offline / disabled / no events yet), the caller
   keeps showing whatever it showed before.

   Reconnect policy:
     • Exponential backoff (1s → 2s → 4s → ... → 30s cap)
     • Resets to 1s on each successful 'ready' frame
     • Caller can call .clear() to drop the local buffer (e.g. when
       switching projects)

   Status states:
     'connecting'  initial / between retries
     'connected'   SSE 'ready' frame seen — events should be flowing
     'offline'     connection failed (disabled / network down / 503)
     'disabled'    no projectId — hook is a no-op
   ═══════════════════════════════════════════════════════════════════ */

export interface ProjectActivityEvent {
  kind:       string;
  scope:      string;
  run_id?:    string | null;
  agent_id?:  string | null;
  payload:    Record<string, unknown>;
  emitted_at: string;
}

export type ProjectActivityStatus = 'connecting' | 'connected' | 'offline' | 'disabled';

const MAX_EVENTS_BUFFER = 200;

const KNOWN_KINDS = [
  'run.started', 'run.finished', 'run.errored',
  'agent.started', 'agent.finished',
  'tool.called', 'tool.completed', 'tool.errored',
  'delegate.started', 'delegate.returned', 'delegate.errored',
  // Phase 4.1 — spawn_specialist tool emits the same delegate.* events
  // (it goes through the same _execute_delegation pipeline as delegate),
  // so no new event kinds need wiring here. The labels just need to
  // recognise the ephemeral agent_ids — handled in
  // orchestrationStatusFor in ProjectWorkspace.tsx.
  // Future-proofing: any new bus emission must add its kind here too.
] as const;

function getApiBase(): string {
  // Same resolution rule as useChat.ts / projectStore.ts so all
  // backend calls share one VITE_API_URL knob.
  const env = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
  if (env) return env.replace(/\/+$/, '');
  return 'https://worker-production-1345.up.railway.app';
}

/**
 * Subscribe to the SSE event stream for a project.
 *
 * Returns:
 *   events:  rolling buffer of received events (most-recent last).
 *            Capped at MAX_EVENTS_BUFFER so long runs can't grow
 *            unbounded.
 *   status:  current connection state — feed it into a sync
 *            indicator UI (Phase 2.5 has a green/amber/grey dot
 *            pattern we mirror here).
 *   clear:   drop the local buffer. Call when switching projects
 *            or when the user dismisses the activity panel.
 *
 * When projectId is null/empty the hook is inert — no EventSource is
 * created, no network call is made, status is 'disabled'.
 */
export function useProjectActivity(projectId: string | null | undefined): {
  events: ProjectActivityEvent[];
  status: ProjectActivityStatus;
  clear: () => void;
} {
  const [events, setEvents] = useState<ProjectActivityEvent[]>([]);
  const [status, setStatus] = useState<ProjectActivityStatus>(
    projectId ? 'connecting' : 'disabled',
  );

  const esRef = useRef<EventSource | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelay = useRef<number>(1000);   // ms; doubles each failure

  const clear = useCallback(() => setEvents([]), []);

  useEffect(() => {
    if (!projectId) {
      setStatus('disabled');
      return;
    }
    setStatus('connecting');

    let cancelled = false;

    const close = () => {
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
    };

    const connect = () => {
      if (cancelled) return;
      const url = `${getApiBase()}/v2/events/stream?scope=project:${encodeURIComponent(projectId)}`;
      const es = new EventSource(url);
      esRef.current = es;

      const onMessage = (e: MessageEvent) => {
        if (cancelled) return;
        let parsed: unknown = null;
        try { parsed = JSON.parse(e.data); } catch { return; }
        if (!parsed || typeof parsed !== 'object') return;
        const ev = parsed as Partial<ProjectActivityEvent> & { kind?: string };
        if (!ev.kind) return;
        setEvents((prev) => {
          const next = [...prev, {
            kind:       ev.kind!,
            scope:      ev.scope ?? '',
            run_id:     ev.run_id ?? null,
            agent_id:   ev.agent_id ?? null,
            payload:    (ev.payload ?? {}) as Record<string, unknown>,
            emitted_at: ev.emitted_at ?? new Date().toISOString(),
          }];
          return next.length > MAX_EVENTS_BUFFER
            ? next.slice(-MAX_EVENTS_BUFFER)
            : next;
        });
      };

      es.addEventListener('ready', () => {
        if (cancelled) return;
        setStatus('connected');
        reconnectDelay.current = 1000;   // reset backoff on success
      });

      // EventSource only dispatches named events to addEventListener listeners
      // (the default 'message' handler doesn't catch named SSE events). Register
      // every known kind so we receive each one.
      KNOWN_KINDS.forEach((k) => es.addEventListener(k, onMessage));

      es.onerror = () => {
        if (cancelled) return;
        es.close();
        esRef.current = null;
        setStatus('offline');
        const delay = Math.min(reconnectDelay.current, 30_000);
        reconnectDelay.current = Math.min(reconnectDelay.current * 2, 30_000);
        reconnectTimer.current = setTimeout(() => {
          if (!cancelled) connect();
        }, delay);
      };
    };

    connect();

    return () => {
      cancelled = true;
      close();
    };
  }, [projectId]);

  return { events, status, clear };
}

/* ═══════════════════════════════════════════════════════════════════
   Event → activity translation helpers.
   ═══════════════════════════════════════════════════════════════════
   These keep the AIActivityFeed component's existing AIActivity shape
   intact (so its visual styling is unchanged) while letting it consume
   live events. Components that already render AIActivityFeed with a
   demo array can opt in by also passing an `events` prop; when the
   events array is non-empty the feed switches to a derived view.
   ═══════════════════════════════════════════════════════════════════ */

export interface DerivedActivity {
  id: string;
  status: 'active' | 'completed' | 'queued';
  message: string;
  detail?: string;
  progress?: number;
  timestamp: Date;
}

const KIND_LABELS: Record<string, (e: ProjectActivityEvent) => string> = {
  'run.started':       (e) => `Orchestration started${e.run_id ? ` (${e.run_id.slice(0, 6)}…)` : ''}`,
  'run.finished':      ()  => 'Orchestration completed',
  'run.errored':       (e) => `Orchestration errored: ${(e.payload?.error as string) ?? 'unknown'}`,
  'agent.started':     (e) => `${e.agent_id ?? 'Agent'} started`,
  'agent.finished':    (e) => `${e.agent_id ?? 'Agent'} finished`,
  'tool.called':       (e) => `Calling ${e.payload?.tool ?? 'tool'}`,
  'tool.completed':    (e) => `${e.payload?.tool ?? 'Tool'} completed`,
  'tool.errored':      (e) => `${e.payload?.tool ?? 'Tool'} errored`,
  'delegate.started':  (e) => `Delegating to ${e.payload?.agent_id ?? 'specialist'}`,
  'delegate.returned': (e) => `${e.payload?.agent_id ?? 'Specialist'} returned`,
  'delegate.errored':  (e) => `Delegation errored: ${(e.payload?.error as string) ?? (e.payload?.code as string) ?? ''}`,
};

function _statusFor(kind: string): DerivedActivity['status'] {
  if (kind.endsWith('.started') || kind === 'tool.called') return 'active';
  if (kind.endsWith('.errored')) return 'completed';   // surface error in detail
  if (kind.endsWith('.finished') || kind.endsWith('.completed') || kind.endsWith('.returned')) return 'completed';
  return 'queued';
}

/**
 * Map a list of ProjectActivityEvents to the AIActivity shape used by
 * the existing UI. Most-recent first so the feed renders newest at
 * the top — matches the existing AIActivityFeed scroll order.
 */
export function eventsToActivities(events: ProjectActivityEvent[]): DerivedActivity[] {
  return events
    .slice()
    .reverse()
    .map((e, idx) => {
      const labeller = KIND_LABELS[e.kind];
      const message = labeller ? labeller(e) : e.kind;
      const detail = typeof e.payload?.error === 'string'
        ? (e.payload.error as string)
        : undefined;
      return {
        id:        `${e.kind}-${idx}-${e.emitted_at}`,
        status:    _statusFor(e.kind),
        message,
        detail,
        timestamp: new Date(e.emitted_at),
      };
    });
}
