import { useState, useEffect, useCallback } from 'react';
import type { AuditEvent, AuditEventType } from '@/types';

/**
 * Audit log + global kill-switch — Phase 4 #4E. localStorage only.
 *
 * An append-only trail of every consequential Autopilot event, plus a global
 * kill-switch that disables all step execution. This is the Assisted-ceiling
 * scaffold: decisions are recorded honestly; nothing is executed because no
 * execution gate is open.
 */
const LOG_KEY = 'korvix.agent.audit.v1';
const KILL_KEY = 'korvix.agent.killswitch.v1';
const MAX = 200;

function rid(): string {
  return crypto.randomUUID
    ? `ev-${crypto.randomUUID()}`
    : `ev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function loadLog(): AuditEvent[] {
  try {
    const raw = localStorage.getItem(LOG_KEY);
    if (raw) {
      const a = JSON.parse(raw);
      if (Array.isArray(a)) return a as AuditEvent[];
    }
  } catch { /* ignore */ }
  return [];
}

function loadKill(): boolean {
  try { return localStorage.getItem(KILL_KEY) === '1'; } catch { return false; }
}

function entry(type: AuditEventType, detail: string, runId?: string): AuditEvent {
  return { id: rid(), at: new Date().toISOString(), type, detail, runId };
}

export function useAuditLog() {
  const [events, setEvents] = useState<AuditEvent[]>(loadLog);
  const [killed, setKilled] = useState<boolean>(loadKill);

  useEffect(() => {
    try { localStorage.setItem(LOG_KEY, JSON.stringify(events.slice(0, MAX))); } catch { /* ignore */ }
  }, [events]);

  useEffect(() => {
    try { localStorage.setItem(KILL_KEY, killed ? '1' : '0'); } catch { /* ignore */ }
  }, [killed]);

  const log = useCallback((type: AuditEventType, detail: string, runId?: string) => {
    setEvents((prev) => [entry(type, detail, runId), ...prev].slice(0, MAX));
  }, []);

  const setKillSwitch = useCallback((on: boolean) => {
    setKilled(on);
    setEvents((prev) => [
      entry(
        on ? 'killswitch.on' : 'killswitch.off',
        on
          ? 'Global kill-switch engaged — all step execution disabled.'
          : 'Global kill-switch released.',
      ),
      ...prev,
    ].slice(0, MAX));
  }, []);

  const clearLog = useCallback(() => setEvents([]), []);

  return { events, killed, log, setKillSwitch, clearLog };
}
