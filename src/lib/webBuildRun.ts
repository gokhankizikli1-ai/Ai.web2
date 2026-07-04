/**
 * Web Build RUN / EVENT model — the single source of truth for the coding-agent
 * execution experience (feed, file drawer, preview, save-to-project).
 *
 * The feed is a CODING agent run (Claude/Kimi tool-call style): a short
 * assistant message, one small "Thinking" block, then the real work as file
 * tool-call blocks — Create file / Edit file / Read file — each with a running
 * → completed state and a +N −M diff, then a preview block. Planning/brief rows
 * are intentionally NOT prominent rows; the only planning surface is the single
 * Thinking block.
 *
 * The backend `/chat` (website_builder mode) is currently NON-STREAMING: it
 * returns the whole package at once. So we derive a REAL event stream from the
 * real returned files (path, content, line diff) and the frontend reveals the
 * tool-call blocks progressively, each going running → completed one by one.
 *
 * TODO(streaming): the honest next step is a staged backend —
 *   POST /v2/web-build/runs → { runId };  GET /v2/web-build/runs/:runId/events (SSE)
 * emitting file_created / file_modified as each file is actually written. When
 * that lands, `stepToEvents` is replaced by consuming the stream; the tool-call
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

/** The tool-call block kinds shown in the feed. */
export type ToolType = 'think' | 'read_file' | 'create_file' | 'edit_file' | 'preview';
export type RunArtifact = 'preview' | 'files' | 'save';

/** One real event in a coding-agent run. File events carry the real path +
 *  line diff; tool actions (think/read/preview) fold start→complete into a row. */
export interface WebBuildRunEvent {
  id: string;
  type: WebBuildRunEventType;
  /** Stable id so an action_start + action_complete fold into one row. */
  group?: string;
  status: WebBuildRunStatus;
  tool?: ToolType;
  /** i18n key for the block title (Create file / Read file / Thinking / …). */
  titleKey?: string;
  /** i18n key for an assistant_message body. */
  messageKey?: string;
  /** i18n key for a static summary line (think/preview blocks). */
  summaryKey?: string;
  /** Real, data-tied summary (file blocks). */
  summary?: string;
  params?: Record<string, string | number>;
  filePath?: string;
  language?: string;
  linesAdded?: number;
  linesRemoved?: number;
  artifact?: RunArtifact;
}

/** A folded, render-ready row. */
export type RunRow =
  | { kind: 'message'; id: string; messageKey: string; params?: Record<string, string | number> }
  | {
      kind: 'tool'; id: string; toolType: ToolType; titleKey: string; status: WebBuildRunStatus;
      filePath?: string; summary?: string; summaryKey?: string; added?: number; removed?: number;
      clickable: boolean;
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

/** Push a start+complete pair for a non-file tool action (think/read/preview). */
function pushTool(
  out: WebBuildRunEvent[], group: string, tool: ToolType, titleKey: string,
  extra?: Partial<WebBuildRunEvent>,
): void {
  out.push({ id: eid(), type: 'action_start', group, status: 'running', tool, titleKey, ...extra });
  out.push({ id: eid(), type: 'action_complete', group, status: 'completed', tool, titleKey, ...extra });
}

/**
 * Derive the REAL coding-run event stream for a finished build/revision step.
 * Fresh build: opening message → Thinking → one Create/Edit file block per real
 * file → Create preview → closing message → artifacts. Revision: opening → per
 * changed file Read file + Edit file (or Create file) → Update preview →
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
    tool: type === 'file_modified' ? 'edit_file' : 'create_file',
    titleKey: type === 'file_modified' ? 'wbToolEditFile' : 'wbToolCreateFile',
    filePath: f.path, language: f.language, summary: f.summary,
    linesAdded: f.added, linesRemoved: f.removed,
  });

  if (step.kind === 'revision') {
    const targets = Array.from(new Set(shown.map((f) => baseName(f.path)))).slice(0, 4).join(', ');
    out.push({
      id: eid(), type: 'assistant_message', status: 'completed',
      messageKey: targets ? 'wbFeedReviseOpening' : 'wbFeedReviseOpeningPlain',
      params: targets ? { targets } : undefined,
    });
    pushTool(out, 'think', 'think', 'wbToolThink', { summaryKey: 'wbThinkEdit' });
    for (const f of shown) {
      if (f.status === 'modified') {
        pushTool(out, `read-${f.path}`, 'read_file', 'wbToolReadFile', { filePath: f.path });
        out.push(fileEvent(f, 'file_modified'));
      } else {
        out.push(fileEvent(f, 'file_created'));
      }
    }
    pushTool(out, 'preview', 'preview', 'wbActPreviewUpdate', { summaryKey: 'wbPreviewNote' });
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
  pushTool(out, 'think', 'think', 'wbToolThink', { summaryKey: 'wbThinkPlan' });
  for (const f of shown) out.push(fileEvent(f, 'file_created'));
  pushTool(out, 'preview', 'preview', 'wbActPreviewRoute', { summaryKey: 'wbPreviewNote' });
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
 * The rows to show WHILE the backend call is in flight (before any files exist):
 * the opening message and a running "Thinking" block. The model really is
 * planning + generating in this window; file blocks stream in once it returns.
 */
export function liveRows(kind: 'build' | 'revision'): RunRow[] {
  return [
    { kind: 'message', id: 'live-open', messageKey: kind === 'revision' ? 'wbFeedReviseOpeningPlain' : 'wbFeedBuildOpeningPlain' },
    {
      kind: 'tool', id: 'live-think', toolType: 'think', titleKey: 'wbToolThink', status: 'running',
      summaryKey: kind === 'revision' ? 'wbThinkEdit' : 'wbThinkPlan', clickable: false,
    },
  ];
}

/** Fold an event stream into tool-call render rows (start/complete collapse). */
export function eventsToRows(events: WebBuildRunEvent[]): RunRow[] {
  const rows: RunRow[] = [];
  const groupRow = new Map<string, Extract<RunRow, { kind: 'tool' }>>();
  for (const e of events) {
    switch (e.type) {
      case 'assistant_message':
        if (e.messageKey) rows.push({ kind: 'message', id: e.id, messageKey: e.messageKey, params: e.params });
        break;
      case 'action_start': {
        const tool = (e.tool || 'think') as ToolType;
        const row: Extract<RunRow, { kind: 'tool' }> = {
          kind: 'tool', id: e.group || e.id, toolType: tool, titleKey: e.titleKey || '', status: 'running',
          filePath: e.filePath, summary: e.summary, summaryKey: e.summaryKey,
          clickable: tool === 'read_file' && !!e.filePath,
        };
        if (e.group) groupRow.set(e.group, row);
        rows.push(row);
        break;
      }
      case 'action_complete': {
        const row = e.group ? groupRow.get(e.group) : undefined;
        if (row) {
          row.status = 'completed';
          if (e.filePath) row.filePath = e.filePath;
          if (e.summary) row.summary = e.summary;
          if (e.summaryKey) row.summaryKey = e.summaryKey;
        }
        break;
      }
      case 'file_created':
      case 'file_modified':
        rows.push({
          kind: 'tool', id: e.group || e.id,
          toolType: e.type === 'file_modified' ? 'edit_file' : 'create_file',
          titleKey: e.titleKey || (e.type === 'file_modified' ? 'wbToolEditFile' : 'wbToolCreateFile'),
          status: 'completed', filePath: e.filePath, summary: e.summary,
          added: e.linesAdded || 0, removed: e.linesRemoved || 0, clickable: !!e.filePath,
        });
        break;
      // preview_ready / artifact_ready / error are not feed rows.
      default: break;
    }
  }
  return rows;
}
