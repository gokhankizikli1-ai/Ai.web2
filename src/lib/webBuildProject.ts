/**
 * Persist a Web Build into a Project so Korvix feels like a workspace, not a
 * one-shot generator. Each canonical build section (brief, design direction,
 * page sections, copy, code, next steps) is stored as a project memory entry;
 * revisions append new entries. Uses the existing localStorage-first
 * projectStore (which also mirrors to the backend best-effort).
 */
import type { Project, ProjectMemory } from '@/types/projects';
import { getProject, addProject, updateProject } from '@/stores/projectStore';
import type { WebBuildResult } from '@/lib/webBuildApi';
import { buildWebBuildPayload, type WebBuildPayload, type WebBuildStep } from '@/lib/webBuildPayload';
import { hasModelNativeEntryFiles, canonicalWebBuildFilesFingerprint } from '@/lib/webBuildPreviewStash';
import { isAppBuild, buildTypeLabel, resolveBuildType } from '@/lib/buildType';

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** The build is now saved to a project, so mark the 'save' activity row done. */
function markSaved(payload: WebBuildPayload): WebBuildPayload {
  return {
    ...payload,
    activity: payload.activity.map((r) => (r.id === 'save' ? { ...r, status: 'done' as const } : r)),
  };
}

/** Human-useful project name, e.g. "Website: SaaS Landing Page". Prefers the
 *  detected "Website type" from the Build Plan section, else the idea text. */
export function deriveWebProjectName(idea: string, result?: WebBuildResult): string {
  const plan = result?.sections.find((s) => /build\s*plan/i.test(s.title));
  let label = '';
  if (plan) {
    const m = plan.body.match(/(?:website\s*type|type)\s*[:\-–]\s*(.+)/i);
    if (m) label = m[1].split(/[\n.]/)[0].trim();
  }
  if (!label) label = idea.trim().replace(/\s+/g, ' ').slice(0, 48);
  return `Website: ${label}`;
}

/** Build the per-section memory entries for a Web Build reply. */
function sectionMemories(result: WebBuildResult, note?: string): ProjectMemory[] {
  const now = new Date().toISOString();
  const kind = (title: string): ProjectMemory['type'] =>
    /code/i.test(title) ? 'resource' : /plan|direction|steps/i.test(title) ? 'decision' : 'knowledge';
  const entries: ProjectMemory[] = result.sections.map((s) => ({
    id: `mem-${uid()}`,
    type: kind(s.title),
    title: note ? `${s.title} (${note})` : s.title,
    content: s.body,
    createdAt: now,
    tags: ['web-build', s.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')],
    confidence: 1,
  }));
  // Also keep the full raw build so nothing is lost.
  entries.push({
    id: `mem-${uid()}`,
    type: 'resource',
    title: note ? `Full build (${note})` : 'Full build',
    content: result.reply,
    createdAt: now,
    tags: ['web-build', 'full'],
    confidence: 1,
  });
  return entries;
}

/**
 * Save a fresh Web Build as a NEW project. Returns the created project.
 */
export function createWebBuildProject(idea: string, result: WebBuildResult): Project {
  const now = new Date().toISOString();
  const project: Project = {
    id: `proj-${uid()}`,
    name: deriveWebProjectName(idea, result),
    description: idea.trim().slice(0, 200),
    category: 'Website',
    status: 'active',
    progress: 40,
    agents: [],
    tasks: [],
    memory: [
      // Brief first, then the generated sections.
      {
        id: `mem-${uid()}`, type: 'knowledge', title: 'Brief',
        content: idea.trim(), createdAt: now, tags: ['web-build', 'brief'], confidence: 1,
      },
      ...sectionMemories(result),
    ],
    files: [],
    createdAt: now,
    updatedAt: 'Just now',
    color: 'slate',
    gradient: 'from-[#3B82F6] to-[#60A5FA]',
    icon: 'Layout',
    // Structured build package — what the project detail page renders.
    webBuild: markSaved(buildWebBuildPayload(idea, result)),
  };
  addProject(project);
  return project;
}

/**
 * Append a revision's sections to an existing project. Falls back to creating
 * a new project if the id is unknown. Returns the affected project.
 */
export function appendWebBuildRevision(
  projectId: string, idea: string, result: WebBuildResult,
): Project {
  const existing = getProject(projectId);
  if (!existing) return createWebBuildProject(idea, result);
  const memory = [...sectionMemories(result, `revision: ${idea.trim().slice(0, 40)}`), ...existing.memory];
  // Extend the structured payload with the revision (keeps history).
  const webBuild = markSaved(buildWebBuildPayload(idea, result, existing.webBuild));
  updateProject(projectId, {
    memory, webBuild, updatedAt: 'Just now',
    progress: Math.min(100, existing.progress + 10),
  });
  return { ...existing, memory, webBuild };
}

/**
 * Save a Web Build — create a new project on first save, append on later
 * saves/revisions when an id is provided. Returns the project.
 */
export function saveWebBuildToProject(
  idea: string, result: WebBuildResult, existingProjectId?: string,
): Project {
  return existingProjectId
    ? appendWebBuildRevision(existingProjectId, idea, result)
    : createWebBuildProject(idea, result);
}

/** Project name from an accumulated payload (type or original prompt). Reflects the
 *  build type so a saved app reads "App: …" and a website reads "Website: …". */
export function deriveWebProjectNameFromPayload(payload: WebBuildPayload): string {
  const appType = payload.buildType === 'app'
    ? payload.artifacts?.frontendBuildSpec?.appArchitecture?.appType : undefined;
  const label = appType || payload.brief?.type || payload.prompt.trim().replace(/\s+/g, ' ').slice(0, 48);
  return `${buildTypeLabel(resolveBuildType(payload.buildType))}: ${label}`;
}

/** Result of a VERIFIED Web Build project save. `ok` is true ONLY when the payload actually
 *  round-tripped into durable localStorage (write succeeded AND read-back verified). `project` is the
 *  in-memory project either way; on failure it is NOT persisted and must not be reported as saved. */
export interface SaveWebBuildResult {
  ok: boolean;
  project: Project;
  reason?: 'write-failed' | 'project-not-persisted' | 'webbuild-missing' | 'latest-step-missing' | 'model-native-files-missing' | 'latest-step-content-mismatch';
}

function latestStep(p: WebBuildPayload) {
  const steps = Array.isArray(p.steps) ? p.steps : [];
  return steps[steps.length - 1];
}

/**
 * UPSERT the incoming steps into the previous step list BY STEP ID (Defect 1). A same-id step (e.g. a
 * same-step image replacement, which keeps the step id but changes file content) REPLACES the previous
 * one IN PLACE; a new id is APPENDED; unrelated older steps are preserved; no id is ever duplicated and
 * chronological order is kept. The old union-by-id merge kept `prevSteps` and dropped any incoming step
 * whose id already existed — silently losing same-step content updates.
 *
 *   previous [A(old), B(old)] + incoming [B(new), C(new)] → [A(old), B(new), C(new)]
 */
export function upsertWebBuildSteps(previous: WebBuildStep[], incoming: WebBuildStep[]): WebBuildStep[] {
  const result = Array.isArray(previous) ? [...previous] : [];
  for (const step of (Array.isArray(incoming) ? incoming : [])) {
    if (!step || typeof step.id !== 'string') continue;
    const idx = result.findIndex((s) => s && s.id === step.id);
    if (idx >= 0) result[idx] = step; // same id → replace in place with the new version
    else result.push(step);           // new id → append
  }
  return result;
}

/** Read the project back from durable storage and verify the Web Build survived: same id, webBuild
 *  present, the expected latest step id present, and — when the saved latest step is model-native — its
 *  preview-critical entry files still present. Crucially it also proves the persisted latest step's file
 *  CONTENT equals what was saved (canonical file fingerprint), so a stale same-id step (Defect 1) fails
 *  verification instead of passing on id presence alone. Returns a reason on the first failed check. */
function verifyWebBuildPersisted(projectId: string, saved: WebBuildPayload): SaveWebBuildResult['reason'] | null {
  const back = getProject(projectId);
  if (!back) return 'project-not-persisted';
  if (!back.webBuild) return 'webbuild-missing';
  const backSteps = Array.isArray(back.webBuild.steps) ? back.webBuild.steps : [];
  const savedStep = latestStep(saved);
  if (!savedStep) return null;
  const backStep = backSteps.find((s) => s.id === savedStep.id);
  if (savedStep.id && !backStep) return 'latest-step-missing';
  if (hasModelNativeEntryFiles(savedStep.files) && (!backStep || !hasModelNativeEntryFiles(backStep.files))) {
    return 'model-native-files-missing';
  }
  // Content proof: the persisted latest step's files must fingerprint-match the saved latest step's
  // files. A same-id step whose content did not actually update (union-by-id drop, silent truncation)
  // fingerprints differently and is rejected — never reported as a successful save.
  if (backStep && canonicalWebBuildFilesFingerprint(savedStep.files) !== canonicalWebBuildFilesFingerprint(backStep.files)) {
    return 'latest-step-content-mismatch';
  }
  return null;
}

/**
 * Save the page's ACCUMULATED payload (full session step history + file diffs) as a project, then
 * VERIFY it durably persisted (Defect 3). Creates a new project, or merges the session's steps into an
 * existing project's saved build. Returns { ok, project, reason }: `ok` is true only when the write
 * succeeded AND the read-back verification passed. On failure the previous stored project is left
 * untouched (the failed setItem leaves localStorage unchanged) and `ok` is false — the caller must NOT
 * report success. Never throws.
 */
export function saveWebBuildPayloadToProject(
  payload: WebBuildPayload, existingProjectId?: string,
): SaveWebBuildResult {
  const now = new Date().toISOString();
  const saved = markSaved(payload);

  if (existingProjectId) {
    const existing = getProject(existingProjectId);
    if (existing) {
      const prevSteps = existing.webBuild?.steps || [];
      const merged: WebBuildPayload = {
        ...saved,
        // Keep the earliest createdAt + UPSERT steps by id (existing first): a same-id step is replaced
        // in place with the new version (so same-step content updates are not lost), a new id appended.
        createdAt: existing.webBuild?.createdAt || saved.createdAt,
        steps: upsertWebBuildSteps(prevSteps, saved.steps),
        updatedAt: now,
      };
      const project: Project = { ...existing, webBuild: merged };
      const wrote = updateProject(existingProjectId, {
        webBuild: merged, updatedAt: 'Just now',
        progress: Math.min(100, (existing.progress || 40) + 10),
      });
      if (!wrote) return { ok: false, project, reason: 'write-failed' };
      const reason = verifyWebBuildPersisted(existingProjectId, saved);
      return reason ? { ok: false, project, reason } : { ok: true, project };
    }
  }

  const isApp = isAppBuild(saved.buildType);
  const project: Project = {
    id: `proj-${uid()}`,
    name: deriveWebProjectNameFromPayload(saved),
    description: saved.prompt.trim().slice(0, 200),
    category: isApp ? 'App' : 'Website',
    status: 'active',
    progress: 40,
    agents: [], tasks: [],
    memory: [{
      id: `mem-${uid()}`, type: 'knowledge', title: 'Brief',
      content: saved.prompt.trim(), createdAt: now, tags: [isApp ? 'app-build' : 'web-build', 'brief'], confidence: 1,
    }],
    files: [],
    createdAt: now,
    updatedAt: 'Just now',
    color: 'slate',
    gradient: 'from-[#3B82F6] to-[#60A5FA]',
    icon: isApp ? 'Cpu' : 'Layout',
    webBuild: saved,
  };
  const wrote = addProject(project);
  if (!wrote) return { ok: false, project, reason: 'write-failed' };
  const reason = verifyWebBuildPersisted(project.id, saved);
  return reason ? { ok: false, project, reason } : { ok: true, project };
}
