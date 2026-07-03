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
import { buildWebBuildPayload, type WebBuildPayload } from '@/lib/webBuildPayload';

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
