/**
 * The structured Web Build package persisted onto a Project and rendered by
 * the Claude/Kimi-style build conversation. Everything is derived
 * deterministically from a WebBuildResult so what we show always matches the
 * real build data — we never claim files/sections that aren't in the reply.
 */
import type { BuildSection } from '@/lib/gameBuilderApi';
import { extractBrief, type WebBuildResult } from '@/lib/webBuildApi';
import { resolveBuildFiles, parseSectionCopy, type SynthFile } from '@/lib/webBuildFiles';

export type ActivityStatus = 'waiting' | 'running' | 'done' | 'failed';

export interface WebBuildActivityRow {
  id: string;
  /** i18n key for the task label. */
  labelKey: string;
  /** Params for {placeholder} interpolation in the label (e.g. { file }). */
  params?: Record<string, string | number>;
  status: ActivityStatus;
  /** Real, data-tied detail (already resolved to text — may be user-language). */
  detail?: string;
}

export interface WebBuildSectionItem {
  id: string;
  name: string;
  purpose?: string;
  copyPreview?: string;
  component?: string;
  /** Rich copy for the preview (from Generated Copy). */
  headline?: string;
  sub?: string;
  cta?: string;
  bullets?: string[];
}

/** A generated file with a diff status relative to the previous build. */
export interface WebBuildFile {
  path: string;
  content: string;
  language?: string;
  summary?: string;
  status: 'created' | 'modified' | 'unchanged';
  added: number;
  removed: number;
}

/** Structured, real-data summary used to compose the assistant message. */
export interface WebBuildSummary {
  type?: string;
  sectionNames: string[];
  fileCount: number;
  added: number;
  removed: number;
}

/** One build (or revision) turn in the conversation. */
export interface WebBuildStep {
  id: string;
  at: string;
  kind: 'build' | 'revision';
  prompt: string;
  summary: WebBuildSummary;
  files: WebBuildFile[];
  activity: WebBuildActivityRow[];
  reply: string;
}

export interface WebBuildPayload {
  source: 'web_build';
  prompt: string;
  brief: { type?: string; audience?: string; goal?: string; style?: string };
  sectionItems: WebBuildSectionItem[];
  /** Raw parsed markdown sections (Build Plan, Design Direction, …). */
  sections: BuildSection[];
  /** Latest file set (with diff vs the previous build). */
  files: WebBuildFile[];
  /** Full markdown reply of the latest build — source of truth. */
  reply: string;
  activity: WebBuildActivityRow[];
  /** Conversation history — one entry per build/revision. */
  steps: WebBuildStep[];
  createdAt: string;
  updatedAt: string;
}

function pascal(id: string): string {
  return id.replace(/(^|[-_ ]+)(\w)/g, (_, __, c) => c.toUpperCase());
}

/**
 * Parse the page sections with rich copy (headline / sub / cta / bullets) so
 * the preview reflects real generated content. Delegates the copy parsing to
 * webBuildFiles.parseSectionCopy (single source of truth for section copy).
 */
export function parseSectionItems(result: WebBuildResult): WebBuildSectionItem[] {
  return parseSectionCopy(result).map((c) => ({
    id: c.id,
    name: c.name,
    purpose: c.purpose,
    copyPreview: (c.headline || c.sub || c.body || '').replace(/\s+/g, ' ').slice(0, 200) || undefined,
    component: `${pascal(c.id)}.tsx`,
    headline: c.headline,
    sub: c.sub,
    cta: c.cta,
    bullets: c.bullets,
  }));
}

/** Line-multiset diff between two file contents → added/removed counts. */
function lineDiff(before: string, after: string): { added: number; removed: number } {
  const count = (s: string) => {
    const map = new Map<string, number>();
    for (const l of s.split('\n')) map.set(l, (map.get(l) || 0) + 1);
    return map;
  };
  const b = count(before), a = count(after);
  let added = 0, removed = 0;
  for (const [l, n] of a) added += Math.max(0, n - (b.get(l) || 0));
  for (const [l, n] of b) removed += Math.max(0, n - (a.get(l) || 0));
  return { added, removed };
}

/** Diff a fresh file set against the previous build's files. */
export function diffFiles(prev: WebBuildFile[] | undefined, next: SynthFile[]): WebBuildFile[] {
  const prevMap = new Map((prev || []).map((f) => [f.path, f.content]));
  return next.map((f) => {
    const lines = f.content ? f.content.split('\n').length : 0;
    const before = prevMap.get(f.path);
    if (before === undefined) return { ...f, status: 'created' as const, added: lines, removed: 0 };
    if (before === f.content) return { ...f, status: 'unchanged' as const, added: 0, removed: 0 };
    const { added, removed } = lineDiff(before, f.content);
    return { ...f, status: 'modified' as const, added, removed };
  });
}

/** The authoritative file set for a result, diffed against the previous build. */
export function resolveFiles(result: WebBuildResult, prev?: WebBuildFile[]): WebBuildFile[] {
  return diffFiles(prev, resolveBuildFiles(result));
}

/** Structured summary tied to real data for the assistant message. */
export function summarize(result: WebBuildResult, files: WebBuildFile[]): WebBuildSummary {
  const brief = extractBrief(result.sections);
  const items = parseSectionItems(result);
  const changed = files.filter((f) => f.status !== 'unchanged');
  return {
    type: brief.type,
    sectionNames: items.map((s) => s.name),
    fileCount: files.length,
    added: changed.reduce((n, f) => n + f.added, 0),
    removed: changed.reduce((n, f) => n + f.removed, 0),
  };
}

/**
 * File/component-based "Build Activity" — implementation-focused rows tied to
 * the ACTUAL generated files. One row per created/modified file ("Creating
 * components/Hero.tsx — <summary>"), bracketed by read/plan/preview/package.
 * All 'done' except the save row (flipped once saved). Never claims a file
 * that isn't in `files`.
 */
export function deriveBuildActivity(result: WebBuildResult, files?: WebBuildFile[]): WebBuildActivityRow[] {
  const brief = extractBrief(result.sections);
  const items = parseSectionItems(result);
  const fileList = files || resolveFiles(result);
  const briefBits = [brief.type, brief.audience, brief.goal].filter(Boolean).join(' · ');

  const rows: WebBuildActivityRow[] = [
    { id: 'read', labelKey: 'wbActRead', status: 'done', detail: briefBits || undefined },
    { id: 'plan', labelKey: 'wbActPlan', status: 'done', detail: items.length ? items.map((s) => s.name).join(', ') : undefined },
  ];

  // One row per file actually produced (changed files first; unchanged noted).
  const changed = fileList.filter((f) => f.status !== 'unchanged');
  const shown = changed.length ? changed : fileList;
  for (const f of shown) {
    rows.push({
      id: `file-${f.path}`,
      labelKey: f.status === 'modified' ? 'wbActModifyingFile' : 'wbActCreatingFile',
      params: { file: f.path },
      status: 'done',
      detail: f.summary || (f.added ? `+${f.added} −${f.removed}` : undefined),
    });
  }

  rows.push({ id: 'preview', labelKey: 'wbStagePreview', status: 'done' });
  rows.push({ id: 'package', labelKey: 'wbActPackage', params: { count: fileList.length }, status: 'done' });
  rows.push({ id: 'save', labelKey: 'wbActSave', status: 'waiting' });
  return rows;
}

/**
 * One item in the execution FEED — a Kimi/Claude-style agent action stream.
 * There are three shapes (no checklist / no ticks / no bullets):
 *  - `text`    — a short natural assistant progress line (i18n key + params).
 *  - `analyze` — a collapsible "Analyze request" block (details resolved in the
 *                component from the brief + section names).
 *  - `file`    — a compact tool action row (Create / Update / Read <path>) with
 *                a one-line summary and +N −M; clickable → opens the file drawer.
 * We only ever emit `file` items for files that are actually in `step.files`.
 */
export type FeedItem =
  | { kind: 'text'; id: string; key: string; params?: Record<string, string | number> }
  | { kind: 'analyze'; id: string }
  | {
      kind: 'file'; id: string; op: 'create' | 'update' | 'read';
      path: string; summary?: string; added: number; removed: number;
    };

/** Component base name of a file path (e.g. components/Hero.tsx → Hero). */
function baseName(path: string): string {
  return (path.split('/').pop() || path).replace(/\.\w+$/, '');
}

/**
 * Turn a build/revision step into an execution feed tied to the REAL generated
 * files. Fresh build: short opening line → Analyze request (collapsible) →
 * short structure line → one file action per created file → done line.
 * Revision: opening line naming the touched section(s) → per changed file a
 * read-then-update (or create) action → done line. Never invents a file.
 */
export function deriveExecutionFeed(
  step: WebBuildStep,
  brief: { type?: string; audience?: string; goal?: string; style?: string },
): FeedItem[] {
  const feed: FeedItem[] = [];
  const changed = step.files.filter((f) => f.status !== 'unchanged');
  const shown = changed.length ? changed : step.files;

  if (step.kind === 'revision') {
    const targets = Array.from(new Set(shown.map((f) => baseName(f.path)))).slice(0, 4).join(', ');
    feed.push(
      targets
        ? { kind: 'text', id: 'open', key: 'wbFeedReviseOpening', params: { targets } }
        : { kind: 'text', id: 'open', key: 'wbFeedReviseOpeningPlain' },
    );
    for (const f of shown) {
      if (f.status === 'modified') {
        feed.push({ kind: 'file', id: `read-${f.path}`, op: 'read', path: f.path, added: 0, removed: 0 });
        feed.push({ kind: 'file', id: `upd-${f.path}`, op: 'update', path: f.path, summary: f.summary, added: f.added, removed: f.removed });
      } else {
        feed.push({ kind: 'file', id: `new-${f.path}`, op: 'create', path: f.path, summary: f.summary, added: f.added, removed: f.removed });
      }
    }
    feed.push({ kind: 'text', id: 'done', key: 'wbFeedReviseDone' });
    return feed;
  }

  // Fresh build.
  feed.push(
    brief.goal
      ? { kind: 'text', id: 'open', key: 'wbFeedBuildOpening', params: { goal: brief.goal } }
      : { kind: 'text', id: 'open', key: 'wbFeedBuildOpeningPlain' },
  );
  feed.push({ kind: 'analyze', id: 'analyze' });
  if (step.summary.sectionNames.length) {
    feed.push({ kind: 'text', id: 'structure', key: 'wbFeedBuildStructure', params: { sections: step.summary.sectionNames.slice(0, 6).join(', ') } });
  }
  for (const f of shown) {
    feed.push({ kind: 'file', id: `file-${f.path}`, op: f.status === 'modified' ? 'update' : 'create', path: f.path, summary: f.summary, added: f.added, removed: f.removed });
  }
  feed.push({ kind: 'text', id: 'done', key: 'wbFeedBuildDone', params: { count: step.summary.fileCount || step.files.length } });
  return feed;
}

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Build (or extend) the persisted payload from a result. */
export function buildWebBuildPayload(prompt: string, result: WebBuildResult, prev?: WebBuildPayload): WebBuildPayload {
  const now = new Date().toISOString();
  const files = resolveFiles(result, prev?.files);
  const activity = deriveBuildActivity(result, files);
  const step: WebBuildStep = {
    id: `step-${uid()}`,
    at: now,
    kind: prev ? 'revision' : 'build',
    prompt,
    summary: summarize(result, files),
    files,
    activity,
    reply: result.reply,
  };
  return {
    source: 'web_build',
    prompt: prev?.prompt || prompt,
    brief: extractBrief(result.sections),
    sectionItems: parseSectionItems(result),
    sections: result.sections,
    files,
    reply: result.reply,
    activity,
    steps: prev ? [...prev.steps, step] : [step],
    createdAt: prev?.createdAt || now,
    updatedAt: now,
  };
}

/**
 * Steps for rendering — with a fallback for OLD payloads saved before the
 * conversation model existed (they have no `steps`). Synthesizes one build
 * step from whatever the old payload has, so existing projects still render.
 */
export function payloadSteps(p: WebBuildPayload): WebBuildStep[] {
  if (p.steps && p.steps.length) return p.steps;
  const legacyFiles: WebBuildFile[] = Array.isArray(p.files)
    ? (p.files as unknown[]).map((f) =>
        typeof f === 'string'
          ? { path: f, content: '', status: 'created' as const, added: 0, removed: 0 }
          : (f as WebBuildFile),
      )
    : [];
  return [{
    id: `step-legacy`,
    at: p.createdAt || new Date().toISOString(),
    kind: 'build',
    prompt: p.prompt,
    summary: {
      type: p.brief?.type,
      sectionNames: (p.sectionItems || []).map((s) => s.name),
      fileCount: legacyFiles.length,
      added: legacyFiles.reduce((n, f) => n + (f.added || 0), 0),
      removed: 0,
    },
    files: legacyFiles,
    activity: p.activity || [],
    reply: p.reply || '',
  }];
}
