/**
 * Web Build RUN / EVENT model — the single source of truth for the agent-style
 * execution experience (feed, file drawer, preview, save-to-project).
 *
 * The backend `/chat` (website_builder mode) is currently NON-STREAMING: it
 * returns the whole build package in one response. So we cannot yet emit true
 * server-sent events per phase. Instead we derive a REAL event stream from the
 * real returned data (brief, section plan, generated files + line diffs) and
 * the frontend reveals those events progressively, while the pre-file phases
 * (Analyze / Plan) are shown as genuinely running DURING the backend call (the
 * model really is analysing + planning + generating in that window).
 *
 * TODO(streaming): the honest next step is a real staged backend — e.g.
 *   POST /v2/web-build/runs  → { runId }
 *   GET  /v2/web-build/runs/:runId/events  (SSE)
 * emitting action_start / file_created / preview_ready as each phase completes.
 * When that lands, `stepToEvents` is replaced by consuming the SSE stream; the
 * row model + components below stay unchanged.
 */
import type { WebBuildStep, WebBuildFile } from '@/lib/webBuildPayload';

export type WebBuildRunStatus = 'queued' | 'running' | 'completed' | 'failed';

export type WebBuildRunEventType =
  | 'assistant_message'
  | 'action_start'
  | 'action_complete'
  | 'file_created'
  | 'file_modified'
  | 'preview_ready'
  | 'artifact_ready'
  | 'error';

export type RunActionIcon = 'analyze' | 'plan' | 'preview' | 'read' | 'done';
export type RunArtifact = 'preview' | 'files' | 'save';

/** One real event in a Web Build run. Actions carry i18n keys (so the feed
 *  re-renders in any language); file events carry the real path + line diff. */
export interface WebBuildRunEvent {
  id: string;
  type: WebBuildRunEventType;
  /** Stable id so an action_start and its action_complete fold into one row. */
  group?: string;
  status: WebBuildRunStatus;
  /** i18n key for an action/artifact title. */
  titleKey?: string;
  /** i18n key for an assistant_message body. */
  messageKey?: string;
  params?: Record<string, string | number>;
  icon?: RunActionIcon;
  /** Real, data-tied one-line detail (already resolved text; may be user-lang). */
  detail?: string;
  /** i18n key for a static detail line (e.g. the preview-route note). */
  detailKey?: string;
  /** Real list detail (e.g. section names) for a collapsible block. */
  details?: string[];
  /** Marks a collapsible whose details are resolved from the brief in the UI. */
  detailsSource?: 'brief';
  filePath?: string;
  language?: string;
  linesAdded?: number;
  linesRemoved?: number;
  op?: 'create' | 'update';
  summary?: string;
  artifact?: RunArtifact;
}

/** A folded, render-ready row (start/complete collapsed into one). */
export type RunRow =
  | { kind: 'message'; id: string; messageKey: string; params?: Record<string, string | number> }
  | {
      kind: 'action'; id: string; titleKey: string; icon: RunActionIcon; status: WebBuildRunStatus;
      detail?: string; detailKey?: string; details?: string[]; detailsSource?: 'brief';
    }
  | {
      kind: 'file'; id: string; op: 'create' | 'update' | 'read'; path: string;
      summary?: string; added: number; removed: number; status: WebBuildRunStatus;
    };

let _seq = 0;
function eid(): string { return `ev-${(_seq += 1)}`; }

/** A fresh run id (used for the preview route /preview/web-build/:runId). */
export function newRunId(): string {
  return `run-${Date.now().toString(36)}-${(_seq += 1).toString(36)}`;
}

function baseName(path: string): string {
  return (path.split('/').pop() || path).replace(/\.\w+$/, '');
}

function briefBits(brief: { type?: string; audience?: string; goal?: string; style?: string }, type?: string): string {
  return [type || brief.type, brief.audience, brief.goal, brief.style].filter(Boolean).join(' · ');
}

/** Push a start+complete pair for a non-file action (so live can show running). */
function pushAction(
  out: WebBuildRunEvent[], group: string, titleKey: string, icon: RunActionIcon,
  extra?: Partial<WebBuildRunEvent>,
): void {
  out.push({ id: eid(), type: 'action_start', group, status: 'running', titleKey, icon });
  out.push({ id: eid(), type: 'action_complete', group, status: 'completed', titleKey, icon, ...extra });
}

/**
 * Derive the REAL event stream for a finished build/revision step. Fresh build:
 * opening message → Analyze request → Plan website structure → one file_created
 * per real file → Create preview → closing message → artifacts. Revision: opening
 * → per changed file Read + file_modified (or file_created) → Update preview →
 * closing → artifacts. Never invents a file not in `step.files`.
 */
export function stepToEvents(
  step: WebBuildStep,
  brief: { type?: string; audience?: string; goal?: string; style?: string },
): WebBuildRunEvent[] {
  const out: WebBuildRunEvent[] = [];
  const changed = step.files.filter((f) => f.status !== 'unchanged');
  const shown = changed.length ? changed : step.files;
  const fileEvent = (f: WebBuildFile, type: 'file_created' | 'file_modified'): WebBuildRunEvent => ({
    id: eid(), type, group: `file-${f.path}`, status: 'completed',
    filePath: f.path, language: f.language, op: type === 'file_modified' ? 'update' : 'create',
    summary: f.summary, linesAdded: f.added, linesRemoved: f.removed,
  });

  if (step.kind === 'revision') {
    const targets = Array.from(new Set(shown.map((f) => baseName(f.path)))).slice(0, 4).join(', ');
    out.push({
      id: eid(), type: 'assistant_message', status: 'completed',
      messageKey: targets ? 'wbFeedReviseOpening' : 'wbFeedReviseOpeningPlain',
      params: targets ? { targets } : undefined,
    });
    for (const f of shown) {
      if (f.status === 'modified') {
        pushAction(out, `read-${f.path}`, 'wbActionRead', 'read', { detail: f.path });
        out.push(fileEvent(f, 'file_modified'));
      } else {
        out.push(fileEvent(f, 'file_created'));
      }
    }
    pushAction(out, 'preview', 'wbActPreviewUpdate', 'preview');
    out.push({ id: eid(), type: 'preview_ready', group: 'preview', status: 'completed' });
    out.push({
      id: eid(), type: 'assistant_message', status: 'completed',
      messageKey: targets ? 'wbFeedReviseClosing' : 'wbFeedReviseClosingPlain',
      params: targets ? { targets } : undefined,
    });
    pushArtifacts(out);
    return out;
  }

  // Fresh build.
  out.push({
    id: eid(), type: 'assistant_message', status: 'completed',
    messageKey: brief.goal ? 'wbFeedBuildOpening' : 'wbFeedBuildOpeningPlain',
    params: brief.goal ? { goal: brief.goal } : undefined,
  });
  pushAction(out, 'analyze', 'wbActAnalyze', 'analyze', {
    detail: briefBits(brief, step.summary.type) || undefined, detailsSource: 'brief',
  });
  if (step.summary.sectionNames.length) {
    pushAction(out, 'plan', 'wbActPlanStructure', 'plan', { details: step.summary.sectionNames });
  }
  for (const f of shown) out.push(fileEvent(f, 'file_created'));
  pushAction(out, 'preview', 'wbActPreviewRoute', 'preview', { detailKey: 'wbActPreviewDetail' });
  out.push({ id: eid(), type: 'preview_ready', group: 'preview', status: 'completed' });
  out.push({
    id: eid(), type: 'assistant_message', status: 'completed',
    messageKey: 'wbFeedBuildClosing', params: { count: step.summary.fileCount || step.files.length },
  });
  pushArtifacts(out);
  return out;
}

function pushArtifacts(out: WebBuildRunEvent[]): void {
  out.push({ id: eid(), type: 'artifact_ready', status: 'completed', artifact: 'preview' });
  out.push({ id: eid(), type: 'artifact_ready', status: 'completed', artifact: 'files' });
  out.push({ id: eid(), type: 'artifact_ready', status: 'completed', artifact: 'save' });
}

/**
 * The running phases to show WHILE the backend call is in flight (before any
 * files exist). These are honest: the model is analysing + planning + generating
 * in this window. `phase` (0 → analyze, 1 → +plan) grows on a timer.
 */
export function liveRows(kind: 'build' | 'revision', phase: number): RunRow[] {
  if (kind === 'revision') {
    return [
      { kind: 'message', id: 'live-open', messageKey: 'wbFeedReviseOpeningPlain' },
      { kind: 'action', id: 'live-read', titleKey: 'wbActReadCurrent', icon: 'read', status: 'running' },
    ];
  }
  const rows: RunRow[] = [
    { kind: 'message', id: 'live-open', messageKey: 'wbFeedBuildOpeningPlain' },
    { kind: 'action', id: 'live-analyze', titleKey: 'wbActAnalyze', icon: 'analyze', status: 'running' },
  ];
  if (phase >= 1) rows.push({ kind: 'action', id: 'live-plan', titleKey: 'wbActPlanStructure', icon: 'plan', status: 'running' });
  return rows;
}

/** Fold an event stream into render rows (start/complete collapse into one). */
export function eventsToRows(events: WebBuildRunEvent[]): RunRow[] {
  const rows: RunRow[] = [];
  const groupRow = new Map<string, Extract<RunRow, { kind: 'action' }>>();
  for (const e of events) {
    switch (e.type) {
      case 'assistant_message':
        if (e.messageKey) rows.push({ kind: 'message', id: e.id, messageKey: e.messageKey, params: e.params });
        break;
      case 'action_start': {
        const row: Extract<RunRow, { kind: 'action' }> = {
          kind: 'action', id: e.group || e.id, titleKey: e.titleKey || '', icon: e.icon || 'done', status: 'running',
        };
        if (e.group) groupRow.set(e.group, row);
        rows.push(row);
        break;
      }
      case 'action_complete': {
        const row = e.group ? groupRow.get(e.group) : undefined;
        if (row) {
          row.status = 'completed';
          if (e.detail) row.detail = e.detail;
          if (e.detailKey) row.detailKey = e.detailKey;
          if (e.details) row.details = e.details;
          if (e.detailsSource) row.detailsSource = e.detailsSource;
        }
        break;
      }
      case 'file_created':
      case 'file_modified':
        rows.push({
          kind: 'file', id: e.group || e.id, op: e.op || 'create', path: e.filePath || '',
          summary: e.summary, added: e.linesAdded || 0, removed: e.linesRemoved || 0, status: 'completed',
        });
        break;
      // preview_ready / artifact_ready / error are not feed rows.
      default: break;
    }
  }
  return rows;
}
