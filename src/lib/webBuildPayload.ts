/**
 * The structured Web Build package persisted onto a Project and rendered by
 * the Claude/Kimi-style build conversation. Everything is derived
 * deterministically from a WebBuildResult so what we show always matches the
 * real build data — we never claim files/sections that aren't in the reply.
 */
import type { BuildSection } from '@/lib/gameBuilderApi';
import { extractBrief, extractFiles, type WebBuildResult } from '@/lib/webBuildApi';

export type ActivityStatus = 'waiting' | 'running' | 'done' | 'failed';

export interface WebBuildActivityRow {
  id: string;
  /** i18n key for the task label. */
  labelKey: string;
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
}

/** A generated file with a diff status relative to the previous build. */
export interface WebBuildFile {
  path: string;
  content: string;
  language?: string;
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

const norm = (s: string) => s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();

function sectionBody(sections: BuildSection[], match: RegExp): string {
  return sections.find((s) => match.test(s.title))?.body || '';
}

function humanize(id: string): string {
  return id.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function pascal(id: string): string {
  return id.replace(/(^|[-_ ]+)(\w)/g, (_, __, c) => c.toUpperCase());
}

/**
 * Parse the "Page Sections" list (`- <id>: purpose`) and enrich each with a
 * copy preview from "Generated Copy" (`### <id>` blocks) + a component name.
 */
export function parseSectionItems(result: WebBuildResult): WebBuildSectionItem[] {
  const pageBody = sectionBody(result.sections, /page\s*sections/i);
  const copyBody = sectionBody(result.sections, /generated\s*copy/i);
  const files = extractFiles(result.sections);

  const copyById: Record<string, string> = {};
  const parts = copyBody.split(/^###\s+/m).slice(1);
  for (const part of parts) {
    const nl = part.indexOf('\n');
    const head = (nl >= 0 ? part.slice(0, nl) : part).trim();
    const rest = (nl >= 0 ? part.slice(nl + 1) : '').trim();
    copyById[norm(head)] = rest;
  }

  const items: WebBuildSectionItem[] = [];
  const lineRe = /^\s*[-*]\s+`?([a-z0-9][a-z0-9-_ ]*?)`?\s*[:\-–]\s*(.+)$/gim;
  let m: RegExpExecArray | null;
  while ((m = lineRe.exec(pageBody)) !== null) {
    const rawId = m[1].trim();
    const id = rawId.toLowerCase().replace(/\s+/g, '-');
    const purpose = m[2].trim();
    const copy = copyById[norm(rawId)] || '';
    const copyPreview = copy ? copy.replace(/\s+/g, ' ').slice(0, 200) : undefined;
    const compFile = files.find((f) => norm(f).includes(norm(id)));
    items.push({ id, name: humanize(rawId), purpose, copyPreview, component: compFile || `${pascal(id)}.tsx` });
  }
  return items;
}

/**
 * Parse the "Frontend Code" section into files: each `### <path>` heading
 * followed by a fenced code block becomes { path, content, language }.
 */
export function extractFileEntries(sections: BuildSection[]): { path: string; content: string; language?: string }[] {
  const codeBody = sectionBody(sections, /frontend\s*code|code\s*files/i);
  if (!codeBody) return [];
  const out: { path: string; content: string; language?: string }[] = [];
  const parts = codeBody.split(/^###\s+/m).slice(1);
  for (const part of parts) {
    const nl = part.indexOf('\n');
    const path = (nl >= 0 ? part.slice(0, nl) : part).trim().replace(/`/g, '');
    const rest = nl >= 0 ? part.slice(nl + 1) : '';
    const fence = rest.match(/```(\w+)?\n([\s\S]*?)```/);
    const content = fence ? fence[2].replace(/\s+$/, '') : '';
    const language = fence?.[1];
    if (path) out.push({ path, content, language });
  }
  return out;
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
export function diffFiles(prev: WebBuildFile[] | undefined, next: { path: string; content: string; language?: string }[]): WebBuildFile[] {
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
 * Final "Build Activity" log for a result — rows tied to real returned data.
 * All 'done' except the save row (flipped once saved).
 */
export function deriveBuildActivity(result: WebBuildResult, files?: WebBuildFile[]): WebBuildActivityRow[] {
  const brief = extractBrief(result.sections);
  const items = parseSectionItems(result);
  const fileList = files || diffFiles(undefined, extractFileEntries(result.sections));
  const design = sectionBody(result.sections, /design\s*direction/i);
  const copyBlocks = (sectionBody(result.sections, /generated\s*copy/i).match(/^###\s+/gm) || []).length;
  const row = (id: string, labelKey: string, detail?: string): WebBuildActivityRow => ({ id, labelKey, status: 'done', detail });
  return [
    row('brief', 'wbStageBrief'),
    row('type', 'wbStageType', brief.type),
    row('plan', 'wbStagePlan', items.length ? items.map((s) => s.name).join(', ') : undefined),
    row('design', 'wbStageDesign', brief.style || (design ? design.replace(/\s+/g, ' ').slice(0, 80) : undefined)),
    row('copy', 'wbStageCopy', copyBlocks ? String(copyBlocks) : undefined),
    row('code', 'wbStageCode', fileList.length ? String(fileList.length) : undefined),
    row('preview', 'wbStagePreview'),
    { id: 'save', labelKey: 'wbActSave', status: 'waiting' },
  ];
}

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Build (or extend) the persisted payload from a result. */
export function buildWebBuildPayload(prompt: string, result: WebBuildResult, prev?: WebBuildPayload): WebBuildPayload {
  const now = new Date().toISOString();
  const files = diffFiles(prev?.files, extractFileEntries(result.sections));
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
