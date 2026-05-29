// JobsDrawer — Phase 7 slice 5 owner-only jobs inspector.
//
// Renders the full job table for the operator: filter by status,
// per-row status + progress, click-through to job detail. Gated by
// useOwnerMode().isOwner so non-owners see a 404-ish empty state.
//
// Reuses the existing useJobs() polling hook for the LIST. Per-job
// live updates flow through useJob() inside the row when expanded
// (rare interaction; keeps the drawer cheap by default).
//
// NOTE: this is a self-contained component — host it inside the
// existing AdminPanel via a new tab OR mount as a route. Slice 5
// ships the component only; the routing tweak is a one-line
// AdminPanel patch in the same PR.

import { useMemo, useState, type JSX } from 'react';
import { useOwnerMode } from '../hooks/useOwnerMode';
import { useJobs, type JobSummary } from '../hooks/useJobs';

type StatusFilter =
  | 'all'
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'failed_dlq';

const STATUS_TABS: StatusFilter[] = [
  'all', 'queued', 'running', 'succeeded',
  'failed', 'cancelled', 'failed_dlq',
];

export interface JobsDrawerProps {
  className?: string;
  /** Optional: cap the rendered list. Defaults to 100. */
  limit?: number;
}

export function JobsDrawer({
  className, limit = 100,
}: JobsDrawerProps): JSX.Element {
  const owner = useOwnerMode();
  // Owner panel reads /v2/jobs/all so chat-created jobs assigned to a
  // different user_id (e.g. anonymous guest session) are visible.
  const { jobs, isAvailable } = useJobs(owner.isOwner, { allJobs: true });
  const [filter, setFilter] = useState<StatusFilter>('all');

  const filteredJobs = useMemo(() => {
    if (filter === 'all') return jobs.slice(0, limit);
    return jobs.filter((j) => j.status === filter).slice(0, limit);
  }, [jobs, filter, limit]);

  const counts = useMemo(() => countByStatus(jobs), [jobs]);

  if (!owner.isOwner) {
    return (
      <div className={`jobs-drawer-empty ${className || ''}`} style={emptyStyle}>
        Jobs inspector is owner-only.
      </div>
    );
  }

  if (!isAvailable) {
    return (
      <div className={`jobs-drawer-empty ${className || ''}`} style={emptyStyle}>
        Job queue is not enabled on this deployment.
      </div>
    );
  }

  return (
    <div className={`jobs-drawer ${className || ''}`} style={containerStyle}>
      <header style={headerStyle}>
        <h3 style={titleStyle}>Jobs</h3>
        <div style={tabsStyle} role="tablist" aria-label="Filter by job status">
          {STATUS_TABS.map((t) => {
            const count = t === 'all' ? jobs.length : (counts[t] || 0);
            const active = filter === t;
            return (
              <button
                key={t}
                role="tab"
                aria-selected={active}
                onClick={() => setFilter(t)}
                style={tabStyle(active)}
                data-status={t}
              >
                <span style={tabLabelStyle}>{prettyStatus(t)}</span>
                <span style={tabCountStyle}>{count}</span>
              </button>
            );
          })}
        </div>
      </header>

      {filteredJobs.length === 0 ? (
        <div style={emptyStyle}>No jobs match this filter.</div>
      ) : (
        <ul style={listStyle} role="list">
          {filteredJobs.map((j) => (
            <li key={j.id} style={rowStyle} data-job-id={j.id} data-status={j.status}>
              <span style={statusBadgeStyle(j.status)}>{prettyStatus(j.status)}</span>
              <span style={kindStyle}>{j.kind}</span>
              <span style={progressCellStyle}>
                {j.status === 'running' || j.status === 'queued' || j.status === 'retrying'
                  ? `${Math.max(0, Math.min(100, j.progress || 0))}%`
                  : ''}
              </span>
              <span style={timeStyle} title={j.updated_at || j.created_at || ''}>
                {timeAgo(j.updated_at || j.created_at)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── helpers ─────────────────────────────────────────────────────────────

function countByStatus(jobs: JobSummary[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const j of jobs) {
    out[j.status] = (out[j.status] || 0) + 1;
  }
  return out;
}

function prettyStatus(s: string): string {
  switch (s) {
    case 'all':        return 'All';
    case 'queued':     return 'Queued';
    case 'running':    return 'Running';
    case 'succeeded':  return 'Done';
    case 'failed':     return 'Failed';
    case 'cancelled':  return 'Cancelled';
    case 'failed_dlq': return 'DLQ';
    case 'retrying':   return 'Retrying';
    default:           return s;
  }
}

function timeAgo(iso?: string): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ── styles (kept inline so the component is self-contained) ─────────────

const containerStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column',
  background: 'rgba(15,23,42,0.94)',
  color: 'rgba(255,255,255,0.92)',
  borderRadius: '12px',
  padding: '1rem',
  fontFamily: 'inherit',
  fontSize: '0.85rem',
};

const headerStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column',
  gap: '0.75rem',
  paddingBottom: '0.75rem',
  borderBottom: '1px solid rgba(255,255,255,0.06)',
};

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '1.05rem',
  fontWeight: 600,
  letterSpacing: '-0.01em',
};

const tabsStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '0.4rem',
};

function tabStyle(active: boolean): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.35rem',
    padding: '0.3rem 0.7rem',
    border: 'none',
    borderRadius: '999px',
    cursor: 'pointer',
    background: active
      ? 'linear-gradient(90deg,#3b82f6,#8b5cf6)'
      : 'rgba(255,255,255,0.06)',
    color: 'rgba(255,255,255,0.92)',
    transition: 'background 200ms ease',
  };
}

const tabLabelStyle: React.CSSProperties = {
  fontSize: '0.75rem', fontWeight: 500, letterSpacing: '0.01em',
};

const tabCountStyle: React.CSSProperties = {
  fontSize: '0.7rem',
  padding: '0.05rem 0.4rem',
  borderRadius: '999px',
  background: 'rgba(0,0,0,0.25)',
  color: 'rgba(255,255,255,0.85)',
  minWidth: '1.4rem',
  textAlign: 'center',
};

const listStyle: React.CSSProperties = {
  listStyle: 'none',
  padding: 0,
  margin: '0.5rem 0 0 0',
  overflowY: 'auto',
  maxHeight: '60vh',
};

const rowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(70px,auto) 1fr 60px 90px',
  alignItems: 'center',
  gap: '0.6rem',
  padding: '0.45rem 0.5rem',
  borderRadius: '6px',
  borderBottom: '1px solid rgba(255,255,255,0.04)',
};

function statusBadgeStyle(s: string): React.CSSProperties {
  const palette: Record<string, string> = {
    queued:     '#a5b4fc',
    running:    '#93c5fd',
    retrying:   '#fdba74',
    succeeded:  '#86efac',
    failed:     '#fca5a5',
    failed_dlq: '#fca5a5',
    cancelled:  '#cbd5e1',
  };
  return {
    color: palette[s] || '#cbd5e1',
    fontSize: '0.75rem',
    fontWeight: 600,
    letterSpacing: '0.02em',
    textTransform: 'uppercase',
  };
}

const kindStyle: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
  fontSize: '0.78rem',
  color: 'rgba(255,255,255,0.85)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const progressCellStyle: React.CSSProperties = {
  fontSize: '0.78rem',
  color: 'rgba(255,255,255,0.65)',
  textAlign: 'right',
  fontVariantNumeric: 'tabular-nums',
};

const timeStyle: React.CSSProperties = {
  fontSize: '0.74rem',
  color: 'rgba(255,255,255,0.55)',
  textAlign: 'right',
};

const emptyStyle: React.CSSProperties = {
  padding: '1.5rem 1rem',
  textAlign: 'center',
  color: 'rgba(255,255,255,0.65)',
  fontSize: '0.85rem',
};

export default JobsDrawer;
