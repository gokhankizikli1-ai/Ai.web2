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
import {
  WEB_BUILD_AGENTS_ENABLED,
  type WebBuildAgent, type AgentId, type ResearchAgentArtifact, type ArtDirectionArtifact,
  type StrategyAgentArtifact, type PageBlueprint,
} from '@/lib/webBuildAgents';

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
export type ToolType = 'think' | 'read_file' | 'create_file' | 'edit_file' | 'preview' | 'research';
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
  /** Expandable detail lines (real data — file purpose, source titles/URLs). */
  details?: string[];
  /** i18n key for an honest, localized note shown when the row is expanded
   *  (e.g. clarifying a generated project file is not a Korvix repo edit). */
  noteKey?: string;
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
      /** Expandable operation detail (real data) + an honest localized note. */
      details?: string[]; noteKey?: string;
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
    titleKey: type === 'file_modified' ? 'wbActionUpdate' : 'wbActionCreate',
    filePath: f.path, language: f.language, summary: f.summary,
    linesAdded: f.added, linesRemoved: f.removed,
    // Expandable operation detail — the real file path + its purpose, plus an
    // honest note that this is a generated project file (not a Korvix repo edit).
    details: [f.path, f.summary].filter((x): x is string => !!x),
    noteKey: 'wbOpFileNote',
  });

  if (step.kind === 'revision') {
    const targets = Array.from(new Set(shown.map((f) => baseName(f.path)))).slice(0, 4).join(', ');
    out.push({
      id: eid(), type: 'assistant_message', status: 'completed',
      messageKey: targets ? 'wbFeedReviseOpening' : 'wbFeedReviseOpeningPlain',
      params: targets ? { targets } : undefined,
    });
    pushTool(out, 'think', 'think', 'wbToolThink');
    for (const f of shown) {
      if (f.status === 'modified') {
        pushTool(out, `read-${f.path}`, 'read_file', 'wbActionRead', { filePath: f.path });
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
  pushTool(out, 'think', 'think', 'wbToolThink');
  // HONEST research/analysis line — driven by the backend's real research
  // status. When real providers ran and returned URLs we show a research line
  // + the source count; otherwise we show a plain "strategy inference" line and
  // never claim research or name a provider. Silent on old steps with no meta.
  pushAgents(out, step);
  // A natural transition line before writing files (names the real sections
  // when we have them, otherwise a plain "now turning it into components").
  out.push(step.summary.sectionNames.length
    ? {
        id: eid(), type: 'assistant_message', status: 'completed',
        messageKey: 'wbFeedBuildStructureMsg', params: { sections: step.summary.sectionNames.slice(0, 6).join(', ') },
      }
    : { id: eid(), type: 'assistant_message', status: 'completed', messageKey: 'wbFeedBuildTransition' });
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

/** Defensive: always treat an artifact list field as a string array (malformed
 *  or partial artifacts must never crash the feed render). */
const asArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** Real, data-tied expandable detail for the Research Agent row. Shows source
 *  URLs ONLY when live research actually ran. */
function researchAgentDetails(r: ResearchAgentArtifact): string[] {
  const angles = asArr(r.researchAngles);
  const insights = asArr(r.sourceBackedInsights);
  const category = asArr(r.categoryLanguage);
  const conversion = asArr(r.conversionPatterns);
  const trust = asArr(r.trustSignals);
  const risks = asArr(r.risksToAvoid);
  const sources = Array.isArray(r.sources) ? r.sources : [];
  const d: string[] = [];
  d.push(r.didResearch ? `${r.sourceCount ?? 0} sources · ${angles.length} angles` : 'Strategy inference (no live sources)');
  if (angles.length) d.push(`Angles: ${angles.join(' · ')}`);
  if (insights.length) d.push(`Insights: ${insights.join(' · ')}`);
  if (category.length) d.push(`Category language: ${category.slice(0, 5).join(', ')}`);
  if (conversion.length) d.push(`Conversion: ${conversion.join(' · ')}`);
  if (trust.length) d.push(`Trust signals: ${trust.join(' · ')}`);
  if (risks.length) d.push(`Risks to avoid: ${risks.slice(0, 2).join(' · ')}`);
  if (r.didResearch && sources.length) d.push(...sources.slice(0, 6).map((s) => `${s.title} — ${s.url}`));
  return d;
}

/** Real, data-tied expandable detail for the UI / Art Director Agent row. */
function artDirectorDetails(a: ArtDirectionArtifact): string[] {
  const c = a.colorSystem || ({} as ArtDirectionArtifact['colorSystem']);
  const avoid = asArr(a.avoid);
  return [
    a.visualMood ? `Visual mood: ${a.visualMood}` : '',
    a.typographyDirection ? `Typography: ${a.typographyDirection}` : '',
    c.accent ? `Color system: bg ${c.background} · accent ${c.accent} · accent2 ${c.accent2}` : '',
    a.visualMetaphor ? `Visual metaphor: ${a.visualMetaphor}` : '',
    a.motionDirection ? `Motion: ${a.motionDirection}` : '',
    a.density ? `Density: ${a.density}` : '',
    avoid.length ? `Avoid: ${avoid.slice(0, 3).join(' · ')}` : '',
  ].filter(Boolean);
}

/** Real, data-tied expandable detail for the Strategy Agent row. */
function strategyAgentDetails(s: StrategyAgentArtifact): string[] {
  const proof = asArr(s.aboveTheFoldMustProve);
  const cta = s.ctaHierarchy;
  return [
    s.positioning ? `Positioning: ${s.positioning}` : '',
    s.mainPromise ? `Main promise: ${s.mainPromise}` : '',
    s.conversionStrategy ? `Conversion strategy: ${s.conversionStrategy}` : '',
    s.trustStrategy ? `Trust strategy: ${s.trustStrategy}` : '',
    cta && cta.primary ? `CTA hierarchy: ${cta.primary}${cta.secondary ? ` / ${cta.secondary}` : ''}` : '',
    proof.length ? `Above the fold must prove: ${proof.join(' · ')}` : '',
  ].filter(Boolean);
}

/** Real, data-tied expandable detail for the Layout Architect (Page Blueprint) row. */
function layoutArchitectDetails(b: PageBlueprint): string[] {
  const hero = b.hero || ({} as PageBlueprint['hero']);
  const sections = Array.isArray(b.sections) ? b.sections : [];
  return [
    b.architecture ? `Architecture: ${b.architecture}` : '',
    hero.variant ? `Hero variant: ${hero.variant} · module ${hero.visualModule}` : '',
    b.navigationStyle ? `Navigation: ${b.navigationStyle}` : '',
    sections.length ? `Section variants: ${sections.map((x) => x.variant).slice(0, 6).join(' · ')}` : '',
    hero.ctaPlacement || b.trustPlacement ? `CTA / trust: ${hero.ctaPlacement} / ${b.trustPlacement}` : '',
    b.sectionRhythm ? `Rhythm: ${b.sectionRhythm}` : '',
    b.motionPattern ? `Motion: ${b.motionPattern}` : '',
  ].filter(Boolean);
}

const AGENT_TITLE_KEY: Record<AgentId, string> = {
  research: 'wbAgentResearch',
  ui_art_director: 'wbAgentArt',
  strategy: 'wbAgentStrategy',
  layout_architect: 'wbAgentLayout',
};
const AGENT_NOTE_KEY: Record<AgentId, string> = {
  research: 'wbOpResearchNote',
  ui_art_director: 'wbOpArtNote',
  strategy: 'wbOpStrategyAgentNote',
  layout_architect: 'wbOpLayoutNote',
};

/** Build the expandable detail lines for any agent row from its artifact. */
function agentDetails(agent: WebBuildAgent): string[] {
  if (agent.status !== 'done') return [];
  try {
    switch (agent.id) {
      case 'research': return researchAgentDetails(agent.artifact as ResearchAgentArtifact);
      case 'ui_art_director': return artDirectorDetails(agent.artifact as ArtDirectionArtifact);
      case 'strategy': return strategyAgentDetails(agent.artifact as StrategyAgentArtifact);
      case 'layout_architect': return layoutArchitectDetails(agent.artifact as PageBlueprint);
      default: return [];
    }
  } catch {
    return [];
  }
}

/**
 * Emit the two Phase-1 upstream agent rows (Research Agent → UI / Art Director
 * Agent) as clean, expandable feed lines with real artifact detail. Falls back to
 * the honest single research line for old steps that have no agent artifacts.
 */
function pushAgents(out: WebBuildRunEvent[], step: WebBuildStep): void {
  // When agents are disabled (kill-switch) or an old build has none, render the
  // stable single research line instead of agent rows.
  const agents = Array.isArray(step.agents) ? step.agents : [];
  if (!WEB_BUILD_AGENTS_ENABLED || !agents.length) { pushResearch(out, step); return; }

  for (const agent of agents) {
    if (!agent || !agent.id) continue;
    const titleKey = AGENT_TITLE_KEY[agent.id] || 'wbAgentResearch';
    // Research note is honest about whether live sources actually informed it.
    const noteKey = agent.id === 'research'
      ? ((agent.artifact as ResearchAgentArtifact)?.didResearch ? 'wbOpResearchNote' : 'wbOpStrategyNote')
      : (AGENT_NOTE_KEY[agent.id] || undefined);
    const details = agentDetails(agent);
    pushTool(out, `agent-${agent.id}`, 'research', titleKey, {
      summary: agent.summary || undefined,
      details: details.length ? details : undefined,
      noteKey,
    });

    // Honest source-count message ONLY when live research actually ran.
    if (agent.id === 'research' && agent.status === 'done') {
      const r = agent.artifact as ResearchAgentArtifact;
      if (r?.didResearch && (r.sourceCount ?? 0) > 0) {
        const count = r.sourceCount ?? 0;
        const angleCount = asArr(r.researchAngles).length;
        out.push({
          id: eid(), type: 'assistant_message', status: 'completed',
          messageKey: angleCount > 1 ? 'wbFeedResearchDeep' : 'wbFeedResearchDone',
          params: angleCount > 1 ? { count, angles: angleCount } : { count },
        });
      }
    }
  }
}

/** Emit the honest research/analysis line for a fresh build. Reads the real
 *  backend research status on the step — shows a "web sources" line ONLY when
 *  providers actually ran and returned URLs; otherwise a neutral "strategy
 *  inference" line. Never names a provider in the feed and never fabricates. */
function pushResearch(out: WebBuildRunEvent[], step: WebBuildStep): void {
  const r = step.research;
  if (!r) return; // old steps / no meta — stay silent rather than guess.
  const count = r.sourceCount ?? (r.sources ? r.sources.length : 0);
  if (r.didResearch && count > 0) {
    const titles = (r.sources || []).slice(0, 3).map((s) => s.title).filter(Boolean).join(' · ');
    const angleCount = r.angles?.length || 0;
    // Expandable detail: how deep the research went + the real sources read.
    const meta: string[] = [];
    if (angleCount) meta.push(`${angleCount} angles · ${count} sources`);
    if (r.angles?.length) meta.push(r.angles.join(' · '));
    const sourceLines = (r.sources || []).slice(0, 6).map((s) => `${s.title} — ${s.url}`);
    const details = [...meta, ...sourceLines];
    pushTool(out, 'research', 'research', 'wbActResearch', {
      summary: titles || undefined, details: details.length ? details : undefined, noteKey: 'wbOpResearchNote',
    });
    out.push({
      id: eid(), type: 'assistant_message', status: 'completed',
      messageKey: angleCount > 1 ? 'wbFeedResearchDeep' : 'wbFeedResearchDone',
      params: angleCount > 1 ? { count, angles: angleCount } : { count },
    });
  } else {
    pushTool(out, 'research', 'research', 'wbToolStrategy', { noteKey: 'wbOpStrategyNote' });
  }
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
          details: e.details, noteKey: e.noteKey,
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
          if (e.details) row.details = e.details;
          if (e.noteKey) row.noteKey = e.noteKey;
        }
        break;
      }
      case 'file_created':
      case 'file_modified':
        rows.push({
          kind: 'tool', id: e.group || e.id,
          toolType: e.type === 'file_modified' ? 'edit_file' : 'create_file',
          titleKey: e.titleKey || (e.type === 'file_modified' ? 'wbActionUpdate' : 'wbActionCreate'),
          status: 'completed', filePath: e.filePath, summary: e.summary,
          details: e.details, noteKey: e.noteKey,
          added: e.linesAdded || 0, removed: e.linesRemoved || 0, clickable: !!e.filePath,
        });
        break;
      // preview_ready / artifact_ready / error are not feed rows.
      default: break;
    }
  }
  return rows;
}
