/**
 * The structured Web Build package persisted onto a Project (and rendered by
 * the project workspace). Everything here is derived deterministically from a
 * WebBuildResult so what a project shows always matches the real build data —
 * we never claim files/sections that aren't in the reply.
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

export interface WebBuildRevision {
  at: string;
  note: string;
  reply: string;
}

export interface WebBuildPayload {
  source: 'web_build';
  prompt: string;
  brief: { type?: string; audience?: string; goal?: string; style?: string };
  sectionItems: WebBuildSectionItem[];
  /** Raw parsed markdown sections (Build Plan, Design Direction, …). */
  sections: BuildSection[];
  files: string[];
  /** Full markdown reply — the source of truth for re-rendering. */
  reply: string;
  activity: WebBuildActivityRow[];
  revisions: WebBuildRevision[];
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

  // id → copy block from Generated Copy
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
    const copyPreview = copy ? copy.replace(/\s+/g, ' ').slice(0, 180) : undefined;
    const compFile = files.find((f) => norm(f).includes(norm(id)));
    items.push({
      id,
      name: humanize(rawId),
      purpose,
      copyPreview,
      component: compFile || `${pascal(id)}.tsx`,
    });
  }
  return items;
}

/**
 * Build the FINAL "Build Activity" log for a result — every row tied to real
 * returned data (detected type, section list, file count, …). Used both for
 * the Activity tab and the persisted payload. All rows are 'done' except the
 * save row, which the caller sets once the build is saved.
 */
export function deriveBuildActivity(result: WebBuildResult): WebBuildActivityRow[] {
  const brief = extractBrief(result.sections);
  const items = parseSectionItems(result);
  const files = extractFiles(result.sections);
  const design = sectionBody(result.sections, /design\s*direction/i);
  const copyBody = sectionBody(result.sections, /generated\s*copy/i);
  const copyBlocks = (copyBody.match(/^###\s+/gm) || []).length;

  const row = (id: string, labelKey: string, detail?: string): WebBuildActivityRow =>
    ({ id, labelKey, status: 'done', detail });

  return [
    row('brief', 'wbStageBrief', undefined),
    row('type', 'wbStageType', brief.type ? brief.type : undefined),
    row('plan', 'wbStagePlan', items.length ? items.map((s) => s.name).join(', ') : undefined),
    row('design', 'wbStageDesign', brief.style || (design ? design.replace(/\s+/g, ' ').slice(0, 80) : undefined)),
    row('copy', 'wbStageCopy', copyBlocks ? `${copyBlocks}` : undefined),
    row('code', 'wbStageCode', files.length ? `${files.length}` : undefined),
    row('preview', 'wbStagePreview', undefined),
    // Save row starts 'waiting' — flipped to 'done' after Save to Project.
    { id: 'save', labelKey: 'wbActSave', status: 'waiting' },
  ];
}

/** Normalized shape both the live result view and the saved project view feed
 *  into the shared WebBuildOutput component. */
export interface WebBuildView {
  prompt: string;
  brief: { type?: string; audience?: string; goal?: string; style?: string };
  sections: BuildSection[];
  sectionItems: WebBuildSectionItem[];
  files: string[];
  activity: WebBuildActivityRow[];
  reply: string;
  revisions: WebBuildRevision[];
}

export function viewFromPayload(p: WebBuildPayload): WebBuildView {
  return {
    prompt: p.prompt, brief: p.brief, sections: p.sections, sectionItems: p.sectionItems,
    files: p.files, activity: p.activity, reply: p.reply, revisions: p.revisions,
  };
}

/** Build a view directly from a live result (before it's saved). `activity`
 *  overrides the derived log when the caller has richer live state. */
export function viewFromResult(
  prompt: string, result: WebBuildResult, activity?: WebBuildActivityRow[],
): WebBuildView {
  return {
    prompt,
    brief: extractBrief(result.sections),
    sections: result.sections,
    sectionItems: parseSectionItems(result),
    files: extractFiles(result.sections),
    activity: activity ?? deriveBuildActivity(result),
    reply: result.reply,
    revisions: [],
  };
}

/** Build (or extend) the persisted payload from a result. */
export function buildWebBuildPayload(
  prompt: string, result: WebBuildResult, prev?: WebBuildPayload,
): WebBuildPayload {
  const now = new Date().toISOString();
  const revisions: WebBuildRevision[] = prev
    ? [{ at: now, note: prompt.slice(0, 80), reply: result.reply }, ...prev.revisions]
    : [];
  return {
    source: 'web_build',
    prompt: prev?.prompt || prompt,
    brief: extractBrief(result.sections),
    sectionItems: parseSectionItems(result),
    sections: result.sections,
    files: extractFiles(result.sections),
    reply: result.reply,
    activity: deriveBuildActivity(result),
    revisions,
    createdAt: prev?.createdAt || now,
    updatedAt: now,
  };
}
