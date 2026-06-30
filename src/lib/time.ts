// time — Sprint 1.7 — tiny, dependency-free formatting helpers for run
// timestamps. Backend timestamps are ISO strings (run.started_at /
// finished_at / created_at). All helpers tolerate null/invalid input.

function parse(ts: string | null | undefined): number | null {
  if (!ts) return null;
  const t = Date.parse(ts);
  return Number.isNaN(t) ? null : t;
}

export function formatRelativeTime(ts: string | null | undefined): string {
  const t = parse(ts);
  if (t === null) return '';
  const diff = Date.now() - t;
  const s = Math.round(diff / 1000);
  if (s < 0) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.round(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.round(mo / 12)}y ago`;
}

export function formatAbsolute(ts: string | null | undefined): string {
  const t = parse(ts);
  if (t === null) return '—';
  try { return new Date(t).toLocaleString(); } catch { return '—'; }
}

// Duration between two ISO timestamps (or from start to now if no end).
export function formatDuration(
  start: string | null | undefined,
  end: string | null | undefined,
): string {
  const a = parse(start);
  if (a === null) return '—';
  const b = parse(end) ?? Date.now();
  let s = Math.max(0, Math.round((b - a) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60); s = s % 60;
  if (m < 60) return s ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm ? `${h}h ${mm}m` : `${h}h`;
}
