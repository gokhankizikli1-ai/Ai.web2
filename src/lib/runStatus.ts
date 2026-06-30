// runStatus — Sprint 1.7 — one canonical presentation for every backend run /
// result status. Shared by the Run History list, the Result Details header and
// every status badge so the colours/icons/wording never drift.
//
// It normalises BOTH families of status the backend emits:
//   * orchestrator run/workflow status (running | finished | errored | queued |
//     completed | failed | cancelled | pending)
//   * Sprint 1.5 ResultStatus (not_found | no_run | pending | running | partial
//     | completed | completed_no_artifact | artifact_not_found | failed |
//     cancelled)
// Unknown/future strings fall back to a neutral descriptor (never throws).
import {
  CheckCircle2, XCircle, Loader2, Clock, Ban, Inbox, SearchX,
  CircleDashed, AlertTriangle, CircleHelp, type LucideIcon,
} from 'lucide-react';

export type StatusTone = 'busy' | 'ok' | 'error' | 'warn' | 'muted';

export interface StatusDescriptor {
  key:         string;       // normalised status key
  label:       string;       // short label (badge)
  description: string;       // one-line human description
  Icon:        LucideIcon;
  tone:        StatusTone;
  text:        string;       // tailwind text-colour class
  dot:         string;       // rgb() for a status dot / accent
  spin:        boolean;      // animate the icon (in-progress)
  terminal:    boolean;      // is this a settled state
  canRetry:    boolean;      // offer a retry affordance
}

const BUSY = 'rgb(34,211,238)';   // cyan
const OK   = 'rgb(52,211,153)';   // emerald
const ERR  = 'rgb(248,113,113)';  // red
const WARN = 'rgb(251,191,36)';   // amber
const MUTE = 'rgb(148,163,184)';  // slate

const D: Record<string, StatusDescriptor> = {
  running: {
    key: 'running', label: 'Running', description: 'The run is in progress.',
    Icon: Loader2, tone: 'busy', text: 'text-cyan-400', dot: BUSY,
    spin: true, terminal: false, canRetry: false,
  },
  pending: {
    key: 'pending', label: 'Pending', description: 'Queued — waiting to start.',
    Icon: Clock, tone: 'busy', text: 'text-cyan-400/80', dot: BUSY,
    spin: false, terminal: false, canRetry: false,
  },
  partial: {
    key: 'partial', label: 'Partial', description: 'Some deliverables are ready; still working.',
    Icon: Loader2, tone: 'busy', text: 'text-cyan-400', dot: BUSY,
    spin: true, terminal: false, canRetry: false,
  },
  completed: {
    key: 'completed', label: 'Completed', description: 'Finished successfully.',
    Icon: CheckCircle2, tone: 'ok', text: 'text-emerald-400', dot: OK,
    spin: false, terminal: true, canRetry: false,
  },
  completed_no_artifact: {
    key: 'completed_no_artifact', label: 'No artifact',
    description: 'Finished, but produced no previewable artifact.',
    Icon: Inbox, tone: 'muted', text: 'text-slate-400', dot: MUTE,
    spin: false, terminal: true, canRetry: false,
  },
  artifact_not_found: {
    key: 'artifact_not_found', label: 'No match',
    description: 'No deliverable matched the requested filter.',
    Icon: SearchX, tone: 'muted', text: 'text-slate-400', dot: MUTE,
    spin: false, terminal: true, canRetry: false,
  },
  failed: {
    key: 'failed', label: 'Failed', description: 'The run failed.',
    Icon: XCircle, tone: 'error', text: 'text-red-400', dot: ERR,
    spin: false, terminal: true, canRetry: true,
  },
  cancelled: {
    key: 'cancelled', label: 'Cancelled', description: 'The run was cancelled.',
    Icon: Ban, tone: 'warn', text: 'text-amber-400', dot: WARN,
    spin: false, terminal: true, canRetry: true,
  },
  no_run: {
    key: 'no_run', label: 'No run', description: 'No run yet for this project.',
    Icon: CircleDashed, tone: 'muted', text: 'text-slate-400', dot: MUTE,
    spin: false, terminal: true, canRetry: false,
  },
  not_found: {
    key: 'not_found', label: 'Not found', description: 'Run not found or not accessible.',
    Icon: AlertTriangle, tone: 'muted', text: 'text-slate-400', dot: MUTE,
    spin: false, terminal: true, canRetry: false,
  },
  unknown: {
    key: 'unknown', label: 'Unknown', description: 'Unrecognised status.',
    Icon: CircleHelp, tone: 'muted', text: 'text-slate-400', dot: MUTE,
    spin: false, terminal: true, canRetry: false,
  },
};

// Normalise raw orchestrator/workflow statuses onto the canonical keys.
const ALIAS: Record<string, string> = {
  finished:    'completed',
  errored:     'failed',
  queued:      'pending',
  in_progress: 'running',
  canceled:    'cancelled',
};

export function describeStatus(status: string | null | undefined): StatusDescriptor {
  const raw = String(status || '').toLowerCase();
  const key = ALIAS[raw] || raw;
  return D[key] || D.unknown;
}
