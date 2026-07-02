// JobProgress — Phase 7 slice 5.
//
// Compact chip that renders live progress for one job via useJob.
// Designed to replace the static "Thinking…" spinner in the chat
// composer when a long tool call enqueues a vision.analyze or
// research.deep job.
//
// Visual:
//   queued   →  small dot + "Queued" + skeleton bar
//   running  →  spinner + label + progress bar
//   done     →  check + label
//   failed   →  warning icon + truncated error message
//
// Owner-mode is NOT required — every authenticated user sees their
// own jobs. The chip is read-only; cancel/retry actions live in the
// JobsDrawer (admin) for now.

import type { JSX } from 'react';
import { useJob, type JobStatus } from '../hooks/useJob';

interface JobProgressProps {
  /** Job id to subscribe to. Empty/null renders nothing. */
  jobId: string | null;
  /** Optional CSS class for layout. */
  className?: string;
  /** When the job reaches terminal status, parent can choose to
   *  hide the chip via this callback. */
  onTerminal?: (status: JobStatus) => void;
}

export function JobProgress({
  jobId, className, onTerminal,
}: JobProgressProps): JSX.Element | null {
  const job = useJob(jobId);

  // Fire onTerminal once when status flips to a terminal state.
  // Note: useJob auto-closes the stream so this only fires once
  // per terminal transition.
  if (job.status && onTerminal &&
      (job.status === 'succeeded' || job.status === 'failed' ||
       job.status === 'cancelled' || job.status === 'failed_dlq')) {
    // Deferring with queueMicrotask to avoid setState-during-render
    // in parent components.
    queueMicrotask(() => onTerminal(job.status as JobStatus));
  }

  if (!jobId) return null;
  if (!job.active && !job.status) return null;

  const status = job.status || 'queued';
  const pct = job.progress ?? 0;

  return (
    <div
      className={`job-progress ${className || ''}`}
      data-status={status}
      data-job-id={job.id}
      role="status"
      aria-live="polite"
      aria-label={`Job ${status}, ${pct}% complete`}
      style={chipStyle(status)}
    >
      <span aria-hidden style={iconStyle(status)}>{iconFor(status)}</span>
      <span style={labelStyle}>
        {job.label || labelFor(status, job)}
      </span>
      {isActive(status) && (
        <span
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          style={trackStyle}
        >
          <span style={fillStyle(pct)} />
        </span>
      )}
    </div>
  );
}

// ── visual helpers ──────────────────────────────────────────────────────

function isActive(s: JobStatus): boolean {
  return s === 'queued' || s === 'running' || s === 'retrying';
}

function iconFor(s: JobStatus): string {
  switch (s) {
    case 'queued':     return '◷';
    case 'running':    return '◴';
    case 'retrying':   return '↻';
    case 'succeeded':  return '✓';
    case 'cancelled':  return '∅';
    case 'failed':
    case 'failed_dlq': return '!';
    default:           return '◷';
  }
}

function labelFor(s: JobStatus, job: ReturnType<typeof useJob>): string {
  switch (s) {
    case 'queued':     return 'Queued';
    case 'running':    return 'Running';
    case 'retrying':   return 'Retrying';
    case 'succeeded':  return 'Completed';
    case 'cancelled':  return 'Cancelled';
    case 'failed':
    case 'failed_dlq': {
      const msg = (job.error?.message as string | undefined) || 'Failed';
      return msg.slice(0, 60);
    }
    default:           return s;
  }
}

// Inline styles keep this self-contained and avoid Tailwind
// purge edge cases. Token values match the existing chat palette.
const labelStyle: React.CSSProperties = {
  fontSize: '0.78rem',
  fontWeight: 500,
  letterSpacing: '0.01em',
  whiteSpace: 'nowrap',
};

const trackStyle: React.CSSProperties = {
  display: 'inline-block',
  marginLeft: '0.5rem',
  height: '4px',
  width: '60px',
  borderRadius: '999px',
  background: 'rgba(255,255,255,0.08)',
  overflow: 'hidden',
};

function fillStyle(pct: number): React.CSSProperties {
  return {
    display: 'block',
    height: '100%',
    width: `${pct}%`,
    background: 'linear-gradient(90deg,#A78BFA,#a78bfa)',
    transition: 'width 250ms ease',
  };
}

function chipStyle(s: JobStatus): React.CSSProperties {
  const palette: Record<string, string> = {
    queued:     'rgba(139, 92, 246,0.18)',
    running:    'rgba(96,165,250,0.20)',
    retrying:   'rgba(139, 92, 246,0.22)',
    succeeded:  'rgba(74,222,128,0.22)',
    cancelled:  'rgba(182, 187, 198,0.20)',
    failed:     'rgba(248,113,113,0.22)',
    failed_dlq: 'rgba(248,113,113,0.26)',
  };
  return {
    display:        'inline-flex',
    alignItems:     'center',
    gap:            '0.5rem',
    padding:        '0.25rem 0.6rem',
    borderRadius:   '999px',
    fontFamily:     'inherit',
    background:     palette[s] || palette.queued,
    color:          'rgba(255,255,255,0.92)',
    border:         '1px solid rgba(255,255,255,0.06)',
  };
}

function iconStyle(s: JobStatus): React.CSSProperties {
  const color: Record<string, string> = {
    queued:     '#a5b4fc',
    running:    '#93c5fd',
    retrying:   '#fdba74',
    succeeded:  '#86efac',
    cancelled:  '#cbd5e1',
    failed:     '#fca5a5',
    failed_dlq: '#fca5a5',
  };
  return {
    color: color[s] || color.queued,
    fontWeight: 600,
    fontSize: '0.95rem',
    lineHeight: 1,
  };
}

export default JobProgress;
