/**
 * The structured Web Build package persisted onto a Project and rendered by
 * the Claude/Kimi-style build conversation. Everything is derived
 * deterministically from a WebBuildResult so what we show always matches the
 * real build data — we never claim files/sections that aren't in the reply.
 */
import type { BuildSection } from '@/lib/gameBuilderApi';
import { extractBrief, type WebBuildResult, type WebBuildBrief, type WebBuildSource, type WebBuildResearch } from '@/lib/webBuildApi';
import { resolveBuildFiles, parseSectionCopy, synthesizeFromCopies, type SynthFile, type SectionCopy as SynthCopy } from '@/lib/webBuildFiles';
import { inferWebsiteBrief, fallbackSectionItems, checkQuality } from '@/lib/webBuildBrief';
import { deriveLayoutPlan, type WebBuildLayoutPlan } from '@/lib/webBuildLayoutPlan';
import {
  runUpstreamAgents, runLayoutArchitect, runComponentEngineer, WEB_BUILD_AGENTS_ENABLED,
  type WebBuildAgent, type WebBuildArtifacts, type WebBuildEnforcement,
} from '@/lib/webBuildAgents';
import { detectMessageLanguage } from '@/lib/locale';

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
  /** Honest research status for THIS turn (fresh builds only; revisions skip
   *  the research pre-pass on the backend). Drives the feed's research line +
   *  the owner/admin debug panel. Optional → old saved steps still load. */
  research?: WebBuildResearch;
  /** The strategy-derived layout plan for this turn (hero composition, section
   *  variants, visual module, rhythm). Recomputed deterministically from
   *  brief + sections, so it's a record — not the source of truth. Optional →
   *  old saved steps still load. */
  layoutPlan?: WebBuildLayoutPlan;
  /** Phase-1 upstream agents for this turn (Research + UI/Art Director) and
   *  their artifacts. Optional → old saved steps still load. */
  agents?: WebBuildAgent[];
  artifacts?: WebBuildArtifacts;
}

export interface WebBuildPayload {
  source: 'web_build';
  prompt: string;
  /** Strategy brief. Core fields + optional richer strategy from the model's
   *  Build Plan / Design Direction (see WebBuildBrief). All optional → old
   *  saved builds still load. */
  brief: WebBuildBrief;
  sectionItems: WebBuildSectionItem[];
  /** Raw parsed markdown sections (Build Plan, Design Direction, …). */
  sections: BuildSection[];
  /** Latest file set (with diff vs the previous build). */
  files: WebBuildFile[];
  /** Full markdown reply of the latest build — source of truth. */
  reply: string;
  /** Real research sources from the backend web_research pre-pass. Present only
   *  when tools actually ran; optional so old saved builds still load. */
  sources?: WebBuildSource[];
  /** Honest research status for the latest fresh build (mirrors the build
   *  step's research). Optional so old saved builds still load. */
  research?: WebBuildResearch;
  /** The strategy-derived layout plan for the latest build (record; recomputed
   *  deterministically from brief + sections). Optional → old builds still load. */
  layoutPlan?: WebBuildLayoutPlan;
  /** Phase-1 upstream agents (Research + UI/Art Director) for the latest build,
   *  and their artifacts. Optional → old saved builds still load. */
  agents?: WebBuildAgent[];
  artifacts?: WebBuildArtifacts;
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

/** The authoritative file set for a result, diffed against the previous build.
 *  An optional `brief` override lets the Art-Director-enriched brief drive the
 *  synthesized files' palette/visual system (so files match the preview). */
export function resolveFiles(result: WebBuildResult, prev?: WebBuildFile[], brief?: WebBuildBrief): WebBuildFile[] {
  return diffFiles(prev, resolveBuildFiles(result, brief));
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
export function deriveBuildActivity(result: WebBuildResult, files?: WebBuildFile[], sources?: WebBuildSource[], plan?: WebBuildLayoutPlan): WebBuildActivityRow[] {
  const brief = extractBrief(result.sections);
  const items = parseSectionItems(result);
  const fileList = files || resolveFiles(result);
  const briefBits = [brief.type, brief.audience, brief.goal].filter(Boolean).join(' · ');
  // Surface the model's ACTUAL strategy in the activity detail (not template
  // text): what the site is + the insight that shaped it, then the CHOSEN layout
  // architecture (hero composition + visual module) behind the section plan, so
  // the timeline reflects the same plan that drives preview + files (Part 7).
  const layoutPlan = plan || deriveLayoutPlan(brief, items.map((s) => ({ id: s.id, name: s.name })));
  const readDetail = [brief.coreIdea || briefBits, brief.strategyInsight].filter(Boolean).join(' — ') || undefined;
  const planDetail = [
    layoutPlan.pageArchitecture,
    layoutPlan.visualSystem.motif,
    brief.layoutLogic || brief.visualMetaphor,
    items.length ? items.map((s) => s.name).join(', ') : '',
  ].filter(Boolean).join(' · ') || undefined;

  const rows: WebBuildActivityRow[] = [
    { id: 'read', labelKey: 'wbActRead', status: 'done', detail: readDetail },
  ];
  // HONEST research row — only when the backend actually returned real sources.
  // Otherwise no research is claimed (the 'plan' row reads as strategy analysis).
  if (sources && sources.length) {
    rows.push({
      id: 'research', labelKey: 'wbActResearch', status: 'done',
      detail: sources.slice(0, 4).map((s) => s.title).join(' · '),
    });
  }
  rows.push({ id: 'plan', labelKey: 'wbActPlan', status: 'done', detail: planDetail });

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

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** WebBuildSectionItem → SectionCopy (for synthesizing files from a brief). */
function itemsToCopies(items: WebBuildSectionItem[]): SynthCopy[] {
  return items.map((s) => ({
    id: s.id, name: s.name, purpose: s.purpose,
    headline: s.headline, sub: s.sub, cta: s.cta,
    bullets: s.bullets || [], body: '',
  }));
}

/**
 * Build (or extend) the persisted payload from a result — with BRIEF
 * INTELLIGENCE. Low-detail prompts ("mobilyacı için site yap") often come back
 * with a thin/generic reply; we infer the industry (`inferWebsiteBrief`), fill
 * any missing brief fields, and — on a FRESH build that fails the quality gate —
 * synthesize an industry-appropriate section set + premium files so the user
 * still gets a real, specific site. Revisions never overwrite a good build.
 */
export function buildWebBuildPayload(
  prompt: string, result: WebBuildResult, prev?: WebBuildPayload, lang?: string,
): WebBuildPayload {
  const now = new Date().toISOString();
  const effLang = lang || detectMessageLanguage(prompt);
  const inferred = inferWebsiteBrief(prompt, effLang);

  const backendBrief = extractBrief(result.sections);
  // Prefer the model's own strategy fields; fall back to inference only for the
  // core four. The richer strategy fields (coreIdea, strategyInsight, visual
  // metaphor, motion direction, …) flow straight through so downstream activity
  // detail, preview and file synthesis are driven by the ACTUAL strategy.
  const brief: WebBuildBrief = {
    ...backendBrief,
    type: backendBrief.type || inferred.businessType,
    audience: backendBrief.audience || inferred.targetAudience,
    goal: backendBrief.goal || inferred.conversionGoal,
    style: backendBrief.style || backendBrief.visualMood || inferred.visualStyle,
    primaryCTA: backendBrief.primaryCTA || inferred.primaryCTA,
    secondaryCTA: backendBrief.secondaryCTA || inferred.secondaryCTA,
  };
  // Revisions keep the first build's strategy fields unless the model restated
  // them (only defined values override), so a small revision never loses the
  // original insight.
  const definedBrief = Object.fromEntries(
    Object.entries(brief).filter(([, v]) => v != null && v !== ''),
  ) as WebBuildBrief;
  const mergedBrief: WebBuildBrief = prev ? { ...prev.brief, ...definedBrief } : brief;

  // Honest research status (needed by the Research Agent). Fresh builds carry the
  // pass result; revisions skip the pre-pass, so keep the original build's status.
  const research: WebBuildResearch | undefined = result.research || prev?.research || undefined;

  // The previous build's files, captured ONCE as a plainly-typed local before any
  // `!prev` narrowing (avoids `prev?.files` narrowing to `never` inside `!prev`).
  const prevFiles: WebBuildFile[] | undefined = prev?.files;

  let sectionItems = parseSectionItems(result);

  // UPSTREAM AGENTS (Research → UI/Art Director → Strategy). Gated by
  // WEB_BUILD_AGENTS_ENABLED (ON by default; kill-switch via env). They are
  // purely additive: each agent is guarded INTERNALLY (a failing agent is marked
  // skipped and the rest continue) and the whole call is guarded again here, so
  // an agent can NEVER block the build or mark a package incomplete. When they
  // succeed, the enriched brief drives the design system / preview / files.
  let agents: WebBuildAgent[] | undefined;
  let artifacts: WebBuildArtifacts | undefined;
  let artBrief: WebBuildBrief = mergedBrief;
  if (WEB_BUILD_AGENTS_ENABLED) {
    try {
      const up = runUpstreamAgents(
        prompt, mergedBrief, research, inferred,
        sectionItems.map((s) => ({ id: s.id, name: s.name })), effLang,
      );
      agents = up.agents;
      artifacts = up.artifacts;
      artBrief = up.enrichedBrief;
    } catch {
      agents = undefined;
      artifacts = undefined;
      artBrief = mergedBrief;
    }
  }

  let files = resolveFiles(result, prevFiles, artBrief);

  // Quality gate — repair a weak FRESH build with the inferred industry brief.
  // The layout plan is derived from the FINAL section set so preview, files and
  // timeline all share one strategy-driven composition.
  if (!prev && !checkQuality(sectionItems, files.length, effLang).ok) {
    sectionItems = fallbackSectionItems(inferred, effLang);
    const plan = deriveLayoutPlan(artBrief, sectionItems.map((s) => ({ id: s.id, name: s.name })));
    files = diffFiles(prevFiles, synthesizeFromCopies(itemsToCopies(sectionItems), artBrief, plan));
  }

  // FILES MUST ALWAYS EXIST (Part 4). If — for any reason — the build produced no
  // files (e.g. the model returned only agent/design prose with no Page Sections),
  // synthesize a real project from the inferred brief so Preview / All Files /
  // Open Preview always work. Never return an empty file list.
  if (files.length === 0) {
    if (sectionItems.length === 0) sectionItems = fallbackSectionItems(inferred, effLang);
    const plan = deriveLayoutPlan(artBrief, sectionItems.map((s) => ({ id: s.id, name: s.name })));
    files = diffFiles(prevFiles, synthesizeFromCopies(itemsToCopies(sectionItems), artBrief, plan));
  }

  const layoutPlan = deriveLayoutPlan(artBrief, sectionItems.map((s) => ({ id: s.id, name: s.name })));

  // LAYOUT ARCHITECT AGENT — runs after the final plan + sections. It records a
  // Page Blueprint that mirrors the composition the renderer actually uses. Fully
  // guarded: on failure it adds a skipped row and the build continues unchanged.
  if (WEB_BUILD_AGENTS_ENABLED && agents) {
    try {
      const la = runLayoutArchitect(
        sectionItems.map((s) => ({ id: s.id, name: s.name })),
        layoutPlan, artifacts?.research, artifacts?.artDirection, artifacts?.strategy, effLang,
      );
      agents = [...agents, la.agent];
      // Thread the blueprint back into the shared pipeline context so the final
      // build package carries the fully-connected artifact chain.
      const ctx = artifacts?.context
        ? { ...artifacts.context, layoutBlueprint: la.blueprint || null }
        : artifacts?.context;
      artifacts = { ...(artifacts || {}), blueprint: la.blueprint, context: ctx };

      // COMPONENT ENGINEER — consumes the plan + blueprint + upstream artifacts and
      // records the concrete component/file plan the synthesizer emits. Guarded.
      const ce = runComponentEngineer(
        layoutPlan, la.blueprint, artifacts?.research, artifacts?.artDirection, artifacts?.strategy, effLang,
      );
      agents = [...agents, ce.agent];
      artifacts = { ...(artifacts || {}), componentEngineer: ce.artifact };

      // ENFORCEMENT — prove the agents drove the build (Part 6). The layout plan is
      // derived from the enriched (agent-steered) brief, so the archetype following
      // the agent decision is verifiable; the generated files come from that same
      // plan, so the component plan is honored 1:1.
      const enforcement: WebBuildEnforcement = {
        didUseResearchAgent: !!artifacts?.research && !artifacts.context?.fallbacks?.includes('research'),
        didUseArtDirection: !!artifacts?.artDirection,
        didUseStrategy: !!artifacts?.strategy,
        didUseLayoutBlueprint: !!artifacts?.blueprint,
        didUseComponentPlan: !!artifacts?.componentEngineer,
        didPlanFollowAgents: !!artBrief.agentArchetype && layoutPlan.archetype === artBrief.agentArchetype,
        // UI / Art Director handoff trace — verifiable from real artifact metadata
        // (each downstream artifact records the art-direction inputs it consumed).
        didUseResearchInputs: !!artifacts?.artDirection?.usedResearchInputs?.length,
        didCreateArtDirection: !!artifacts?.artDirection && artifacts.artDirection.status !== 'failed',
        didPassArtDirectionToStrategy: !!artifacts?.strategy?.usedArtDirectionInputs?.length,
        didPassArtDirectionToLayout: !!artifacts?.blueprint?.usedArtDirectionInputs?.length,
        didPassArtDirectionToComponents: !!artifacts?.componentEngineer?.usedArtDirectionInputs?.length,
        didIncludeArtDirectionInFinalPayload: !!artifacts?.artDirection,
        fallbackReason: (artifacts?.context?.fallbacks?.length
          ? `agents degraded: ${artifacts.context.fallbacks.join(', ')}`
          : undefined),
      };
      artifacts = { ...(artifacts || {}), enforcement };
    } catch {
      /* non-blocking — keep the upstream agents as-is */
    }
  }

  const changed = files.filter((f) => f.status !== 'unchanged');
  const summary: WebBuildSummary = {
    type: mergedBrief.type,
    sectionNames: sectionItems.map((s) => s.name),
    fileCount: files.length,
    added: changed.reduce((n, f) => n + f.added, 0),
    removed: changed.reduce((n, f) => n + f.removed, 0),
  };
  // Real research sources (backend web_research). Keep the first build's
  // sources on later revisions unless a new pass returned some.
  const sources: WebBuildSource[] | undefined =
    (result.sources && result.sources.length ? result.sources : prev?.sources) || undefined;
  const activity = deriveBuildActivity(result, files, sources, layoutPlan);
  const step: WebBuildStep = {
    id: `step-${uid()}`,
    at: now,
    kind: prev ? 'revision' : 'build',
    prompt,
    summary,
    files,
    activity,
    reply: result.reply,
    // Only a fresh build actually ran research; a revision step has none.
    research: prev ? undefined : result.research,
    agents,
    artifacts,
    layoutPlan,
  };
  return {
    source: 'web_build',
    prompt: prev?.prompt || prompt,
    // The Art-Director-enriched brief IS the persisted brief so the preview and
    // any recompute use the same art-direction palette + strategy fields.
    brief: artBrief,
    sectionItems,
    sections: result.sections,
    files,
    reply: result.reply,
    sources,
    research,
    layoutPlan,
    agents,
    artifacts,
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
