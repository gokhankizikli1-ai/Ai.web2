import type { Project, ProjectAgent, ProjectTask } from '@/types/projects';
import { currentStorageScope, scopedKey } from '@/lib/storageScope';

const STORAGE_KEY = 'korvix_projects';
const AGENTS_KEY = 'korvix_project_agents';
const TASKS_KEY = 'korvix_project_tasks';
const MIGRATION_FLAG = 'korvix_projects_migrated_v1';

/* ─── Phase 14D — per-identity local isolation ───────────────────────────────
 * Projects, per-project agents and per-project tasks are now namespaced by the
 * current identity (`user_<id>` / `guest_<nonce>`), exactly like chat history.
 * Isolation is structural: logout never destroys this data (see authStore), and
 * account B reads its own keys instead of inheriting account A's. Existing GLOBAL
 * data is migrated into the current scope once and the global key removed so a
 * second account can't inherit it. */
function projectsKey(): string { return scopedKey(STORAGE_KEY); }
function agentsKey(projectId: string): string { return `${AGENTS_KEY}_${currentStorageScope()}_${projectId}`; }
function tasksKey(projectId: string): string { return `${TASKS_KEY}_${currentStorageScope()}_${projectId}`; }

const _migratedScopes = new Set<string>();
/** One-time-per-scope claim of legacy GLOBAL project data into the current scope. */
function ensureScopeMigrated(): void {
  const scope = currentStorageScope();
  if (_migratedScopes.has(scope)) return;
  _migratedScopes.add(scope);
  // Only an authenticated owner may claim legacy GLOBAL project data. A guest
  // scope leaves the global intact so the real owner can still claim it on
  // login, and so no guest can absorb (then, via the move, destroy) another
  // account's projects. Guests read their own empty scope until they log in.
  if (!scope.startsWith('user_')) return;
  try {
    if (localStorage.getItem(projectsKey()) !== null) return; // already scoped
    const globalProjects = localStorage.getItem(STORAGE_KEY);
    if (globalProjects === null) return;                      // nothing legacy
    localStorage.setItem(projectsKey(), globalProjects);
    let ids: string[] = [];
    try {
      ids = (JSON.parse(globalProjects) as Array<{ id?: string }>)
        .map((p) => p?.id).filter((x): x is string => typeof x === 'string' && !!x);
    } catch { ids = []; }
    for (const pid of ids) {
      const ga = localStorage.getItem(`${AGENTS_KEY}_${pid}`);
      if (ga !== null) { try { localStorage.setItem(agentsKey(pid), ga); localStorage.removeItem(`${AGENTS_KEY}_${pid}`); } catch { /* ignore */ } }
      const gt = localStorage.getItem(`${TASKS_KEY}_${pid}`);
      if (gt !== null) { try { localStorage.setItem(tasksKey(pid), gt); localStorage.removeItem(`${TASKS_KEY}_${pid}`); } catch { /* ignore */ } }
    }
    localStorage.removeItem(STORAGE_KEY);
  } catch { /* private mode / quota — skip; reads fall back to empty */ }
}

/* ═══════════════════════════════════════════════════════════════════
   BACKEND MIRROR (Phase 2 — opt-in via the backend ENABLE_PROJECTS flag)
   ═══════════════════════════════════════════════════════════════════
   Strategy: localStorage stays the synchronous read source so existing
   call sites (getProjects/getProjectAgents/etc.) keep working with no
   refactor. Reads are local-first; writes go to localStorage AND fire
   a best-effort POST/PATCH/DELETE to the backend. On first load we
   hydrate localStorage from the backend (so a fresh browser sees the
   user's existing projects), and we backfill any local-only projects
   into the backend once (so existing users don't lose anything).

   When the backend is offline / disabled / unreachable: every API call
   silently fails and the app keeps running against localStorage. The
   user never sees a hard error — that's the "localStorage fallback".
   ═══════════════════════════════════════════════════════════════════ */

function getApiBase(): string {
  // Same resolution rule as useChat.ts so a single VITE_API_URL drives
  // every backend call. Trailing slashes stripped; bundled fallback is
  // the live trading host (confirmed working).
  const env = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
  if (env) return env.replace(/\/+$/, '');
  return 'https://worker-production-1345.up.railway.app';
}

function getProjectUserId(): string {
  // Same key useChat uses — guarantees the same identity across chat
  // and projects so the backend sees one logical user.
  const key = 'korvix_user_id';
  try {
    let id = localStorage.getItem(key);
    if (!id) {
      id = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
        ? crypto.randomUUID()
        : `u-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      localStorage.setItem(key, id);
    }
    return id;
  } catch {
    return 'guest';
  }
}

async function apiSafe<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    // Network down, backend disabled (503), CORS — any of these mean
    // "use localStorage". Never surface to the caller.
    return null;
  }
}

/* ─── Load user-created projects from localStorage ─── */
function loadProjects(): Project[] {
  ensureScopeMigrated();
  try {
    const stored = localStorage.getItem(projectsKey());
    if (stored) return JSON.parse(stored);
  } catch { /* ignore */ }
  return [];
}

function saveProjects(projects: Project[]) {
  ensureScopeMigrated();
  try { localStorage.setItem(projectsKey(), JSON.stringify(projects)); } catch { /* ignore */ }
}

export function getProjects(): Project[] {
  return loadProjects();
}

export function addProject(project: Project) {
  const projects = loadProjects();
  projects.unshift(project);
  saveProjects(projects);
  // Mirror to backend (fire-and-forget). When backend has ENABLE_PROJECTS
  // off we get a 503 — apiSafe swallows it. The localStorage write above
  // is the authoritative one for UI purposes.
  apiSafe(async () => {
    await fetch(`${getApiBase()}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id:     getProjectUserId(),
        name:        project.name,
        description: project.description || '',
        project_id:  project.id,        // preserve client id
        metadata:    { client_origin: 'projectStore.ts' },
      }),
    });
  });
}

export function getProject(id: string): Project | undefined {
  return getProjects().find(p => p.id === id);
}

export function updateProject(id: string, updates: Partial<Project>) {
  const projects = loadProjects();
  const idx = projects.findIndex(p => p.id === id);
  if (idx < 0) return;
  projects[idx] = { ...projects[idx], ...updates };
  saveProjects(projects);
  apiSafe(async () => {
    await fetch(`${getApiBase()}/projects/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name:        updates.name,
        description: updates.description,
      }),
    });
  });
}

export function deleteProject(id: string) {
  const projects = loadProjects().filter(p => p.id !== id);
  saveProjects(projects);
  try { localStorage.removeItem(agentsKey(id)); } catch { /* ignore */ }
  try { localStorage.removeItem(tasksKey(id)); } catch { /* ignore */ }
  apiSafe(async () => {
    await fetch(`${getApiBase()}/projects/${id}`, { method: 'DELETE' });
  });
}

/* ─── Project memory (Phase 2 backend-native) ───
   No localStorage mirror — project_memory is server-authoritative. When
   the backend is unreachable, list returns []; add silently no-ops. */
export interface ProjectMemoryEntry {
  id: string;
  project_id: string;
  kind: 'note' | 'fact' | 'decision' | 'agent_note' | 'file_summary' | 'system';
  content: string;
  source: 'user' | 'agent' | 'tool' | 'system';
  created_at: string;
}

export async function listProjectMemory(projectId: string, opts?: { kind?: string; limit?: number }): Promise<ProjectMemoryEntry[]> {
  const q = new URLSearchParams();
  if (opts?.kind) q.set('kind', opts.kind);
  if (opts?.limit) q.set('limit', String(opts.limit));
  const res = await apiSafe(async () => {
    const r = await fetch(`${getApiBase()}/projects/${projectId}/memory?${q.toString()}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  });
  return (res?.memory as ProjectMemoryEntry[]) ?? [];
}

export async function addProjectMemory(
  projectId: string,
  content: string,
  opts?: { kind?: string; source?: string },
): Promise<ProjectMemoryEntry | null> {
  return await apiSafe(async () => {
    const r = await fetch(`${getApiBase()}/projects/${projectId}/memory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content,
        kind:   opts?.kind   ?? 'note',
        source: opts?.source ?? 'user',
      }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return (await r.json()) as ProjectMemoryEntry;
  });
}

/* ─── Project Agents ─── */
function loadAgents(projectId: string): ProjectAgent[] {
  ensureScopeMigrated();
  try {
    const stored = localStorage.getItem(agentsKey(projectId));
    if (stored) return JSON.parse(stored);
  } catch { /* ignore */ }
  return [];
}

function saveAgents(projectId: string, agents: ProjectAgent[]) {
  ensureScopeMigrated();
  try { localStorage.setItem(agentsKey(projectId), JSON.stringify(agents)); } catch { /* ignore */ }
}

export function getProjectAgents(projectId: string): ProjectAgent[] {
  return loadAgents(projectId);
}

/**
 * Phase 3.6 — best-effort client-side default for the agent's persona
 * prompt. The authoritative source of the role→prompt mapping lives
 * in the backend (backend/services/agent/specs/role_templates.py).
 * We send this client-side hint so the agent has a strong persona on
 * day one; the backend also has a fallback (spec_from_project_agent)
 * that fills in a role-based template if the stored system_prompt is
 * empty, so legacy localStorage-only agents created before 3.6 still
 * get the right behaviour.
 */
function systemPromptForRole(role: string): string {
  const key = (role || '').trim().toLowerCase();
  // Map common label variants to the canonical role id (matches the
  // alias table in role_templates.py). Returning an empty string lets
  // the backend's stronger template take over.
  const alias: Record<string, string> = {
    'frontend engineer': 'frontend',
    'backend engineer':  'backend',
    'research analyst':  'research',
    'startup strategist':'startup',
    'ecommerce expert':  'ecommerce',
    'trading analyst':   'trading',
    'ui/ux designer':    'design',
  };
  // Just send a tiny hint; backend has the full template.
  // Storing the full template client-side would bloat localStorage
  // and force frontend redeploys when the prompt changes.
  return `__role_hint__:${alias[key] || key || 'custom'}`;
}

export function addProjectAgent(projectId: string, agent: ProjectAgent) {
  const agents = loadAgents(projectId);
  agents.push(agent);
  saveAgents(projectId, agents);
  apiSafe(async () => {
    await fetch(`${getApiBase()}/projects/${projectId}/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_id:      agent.id,
        name:          agent.name,
        role:          agent.role,
        color:         agent.color,
        icon:          agent.icon,
        // Phase 3.6: send a role hint so the backend can resolve the
        // canonical role template even when the displayed label has
        // been customized. The backend's spec_from_project_agent
        // falls back to its own template when this is empty/unknown,
        // so older clients that don't send this still behave correctly.
        system_prompt: '',  // intentionally empty — backend fills from role
        metadata: {
          specialty: agent.specialty,
          gradient:  agent.gradient,
          role_hint: systemPromptForRole(agent.role),
        },
      }),
    });
  });
}

export function updateProjectAgent(projectId: string, agentId: string, updates: Partial<ProjectAgent>) {
  const agents = loadAgents(projectId);
  const idx = agents.findIndex(a => a.id === agentId);
  if (idx >= 0) {
    agents[idx] = { ...agents[idx], ...updates };
    saveAgents(projectId, agents);
    apiSafe(async () => {
      await fetch(`${getApiBase()}/projects/${projectId}/agents/${agentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: updates.name,
          role: updates.role,
        }),
      });
    });
  }
}

export function removeProjectAgent(projectId: string, agentId: string) {
  const agents = loadAgents(projectId).filter(a => a.id !== agentId);
  saveAgents(projectId, agents);
  apiSafe(async () => {
    await fetch(`${getApiBase()}/projects/${projectId}/agents/${agentId}`, {
      method: 'DELETE',
    });
  });
}

export function addAgentMessage(projectId: string, agentId: string, message: ProjectAgent['messages'][0]) {
  const agents = loadAgents(projectId);
  const idx = agents.findIndex(a => a.id === agentId);
  if (idx >= 0) {
    agents[idx].messages.push(message);
    saveAgents(projectId, agents);
  }
}

/**
 * Phase 3.6 — update an existing agent message's content in place
 * (used by the client-side typewriter to progressively reveal the
 * orchestrator's final reply without inserting a new message per
 * frame). Returns true when the message was found and updated.
 */
export function updateAgentMessage(
  projectId: string,
  agentId: string,
  messageId: string,
  updates: Partial<ProjectAgent['messages'][0]>,
): boolean {
  const agents = loadAgents(projectId);
  const agentIdx = agents.findIndex(a => a.id === agentId);
  if (agentIdx < 0) return false;
  const msgIdx = agents[agentIdx].messages.findIndex(m => m.id === messageId);
  if (msgIdx < 0) return false;
  agents[agentIdx].messages[msgIdx] = {
    ...agents[agentIdx].messages[msgIdx],
    ...updates,
  };
  saveAgents(projectId, agents);
  return true;
}

/* ─── Project Tasks ─── */
function loadTasks(projectId: string): ProjectTask[] {
  ensureScopeMigrated();
  try {
    const stored = localStorage.getItem(tasksKey(projectId));
    if (stored) return JSON.parse(stored);
  } catch { /* ignore */ }
  return [];
}

function saveTasks(projectId: string, tasks: ProjectTask[]) {
  ensureScopeMigrated();
  try { localStorage.setItem(tasksKey(projectId), JSON.stringify(tasks)); } catch { /* ignore */ }
}

export function getProjectTasks(projectId: string): ProjectTask[] {
  return loadTasks(projectId);
}

export function addProjectTask(projectId: string, task: ProjectTask) {
  const tasks = loadTasks(projectId);
  tasks.unshift(task);
  saveTasks(projectId, tasks);
}

export function updateProjectTask(projectId: string, taskId: string, updates: Partial<ProjectTask>) {
  const tasks = loadTasks(projectId);
  const idx = tasks.findIndex(t => t.id === taskId);
  if (idx >= 0) {
    tasks[idx] = { ...tasks[idx], ...updates };
    saveTasks(projectId, tasks);
  }
}

/* ─── Helpers ─── */
let _idCounter = 0;
export function uid(): string {
  _idCounter++;
  return `${Date.now()}-${_idCounter}-${Math.random().toString(36).slice(2, 6)}`;
}

export const AGENT_ROLES = [
  { id: 'frontend', label: 'Frontend Engineer', color: 'blue', gradient: 'from-blue-400 to-blue-400', icon: 'Layout', description: 'Builds responsive UI components and frontend architecture.' },
  { id: 'backend', label: 'Backend Engineer', color: 'cyan', gradient: 'from-blue-400 to-teal-400', icon: 'Server', description: 'Designs scalable APIs, databases, and microservices.' },
  { id: 'research', label: 'Research Analyst', color: 'purple', gradient: 'from-blue-400 to-blue-400', icon: 'Search', description: 'Conducts deep research, analysis, and reporting.' },
  { id: 'startup', label: 'Startup Strategist', color: 'orange', gradient: 'from-amber-400 to-orange-400', icon: 'Rocket', description: 'Validates ideas, analyzes markets, creates strategies.' },
  { id: 'ecommerce', label: 'Ecommerce Expert', color: 'emerald', gradient: 'from-emerald-400 to-green-400', icon: 'ShoppingBag', description: 'Optimizes stores, pricing, ads, and product research.' },
  { id: 'trading', label: 'Trading Analyst', color: 'green', gradient: 'from-green-400 to-emerald-400', icon: 'TrendingUp', description: 'Generates signals, analyzes markets, manages risk.' },
  { id: 'design', label: 'UI/UX Designer', color: 'pink', gradient: 'from-blue-400 to-rose-400', icon: 'Palette', description: 'Creates design systems, prototypes, and visual experiences.' },
  { id: 'custom', label: 'Custom', color: 'slate', gradient: 'from-slate-400 to-slate-500', icon: 'Sparkles', description: 'A custom agent with a role you define.' },
];

export function createAgent(roleId: string, name: string, customRole?: string): ProjectAgent {
  const role = AGENT_ROLES.find(r => r.id === roleId) || AGENT_ROLES[0];
  const now = new Date().toISOString();
  return {
    id: `agent-${uid()}`,
    name: name || role.label,
    role: roleId === 'custom' && customRole ? customRole : role.label,
    specialty: roleId === 'custom' && customRole ? customRole : role.label,
    color: role.color,
    gradient: role.gradient,
    icon: role.icon,
    status: 'active',
    memoryUsage: Math.floor(Math.random() * 40) + 30,
    contextSync: Math.floor(Math.random() * 20) + 75,
    description: role.description,
    lastActive: 'Just now',
    messages: [
      { id: `msg-${uid()}`, content: `Hi! I'm your ${role.label}. I'm ready to help with ${role.description.toLowerCase()} What would you like to work on?`, sender: 'agent', timestamp: now, type: 'text' },
    ],
  };
}

/* ═══════════════════════════════════════════════════════════════════
   ONE-TIME HYDRATION + BACKFILL
   ═══════════════════════════════════════════════════════════════════
   Runs once when the module loads (next browser session). Three phases:

   1. PULL — fetch the user's projects from the backend. If any come
      back, merge them into localStorage so the UI shows them on
      first paint of THIS browser even if the user created them
      from another device.

   2. PUSH (backfill) — for every project that exists in localStorage
      but NOT on the backend, POST it (preserving the original id so
      stored agent/task references keep working). Marks itself done
      via MIGRATION_FLAG so we never re-run.

   3. Per-project agents are hydrated lazily inside the workspace
      page (not here) to keep the cold-start payload small.

   All three phases are best-effort — any failure (offline, backend
   disabled, CORS) silently keeps the app on its localStorage cache. */
async function hydrateAndBackfill(): Promise<void> {
  const base = getApiBase();
  const userId = getProjectUserId();

  // 1. PULL — fetch backend projects
  const remote = await apiSafe(async () => {
    const r = await fetch(`${base}/projects?user_id=${encodeURIComponent(userId)}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  });

  if (remote && Array.isArray(remote.projects)) {
    // Phase 2.5 lifecycle log — makes the backend hydration visible in
    // production DevTools without affecting behavior. Filterable in the
    // console by [projectStore].
    // eslint-disable-next-line no-console
    console.info('[projectStore] project_loaded_from_backend', {
      remote_count: remote.projects.length,
      user_id: userId,
    });
    const local = loadProjects();
    const localById = new Map(local.map((p: Project) => [p.id, p]));
    // Merge: backend rows authoritative for name/description; local
    // wins for any client-only fields (icon, color preset, etc.).
    const merged: Project[] = remote.projects.map((rp: {
      id: string; name: string; description: string;
      created_at: string; updated_at: string;
    }) => {
      const existing = localById.get(rp.id);
      return {
        ...(existing || {}),
        id:          rp.id,
        name:        rp.name,
        description: rp.description,
        createdAt:   (existing as { createdAt?: string } | undefined)?.createdAt || rp.created_at,
        updatedAt:   rp.updated_at,
      } as Project;
    });
    // Keep any local-only projects (will be pushed in step 2).
    const remoteIds = new Set(merged.map((p: Project) => p.id));
    for (const lp of local) {
      if (!remoteIds.has(lp.id)) merged.push(lp);
    }
    saveProjects(merged);
  }

  // 2. PUSH — one-time backfill of local-only projects
  if (localStorage.getItem(MIGRATION_FLAG) === 'true') return;
  if (!remote) return;  // backend unreachable — can't safely mark migrated

  const remoteIds = new Set(
    (remote.projects || []).map((p: { id: string }) => p.id),
  );
  for (const lp of loadProjects()) {
    if (remoteIds.has(lp.id)) continue;
    await apiSafe(async () => {
      await fetch(`${base}/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id:     userId,
          name:        lp.name,
          description: lp.description || '',
          project_id:  lp.id,
          metadata:    { backfilled_from: 'localStorage_v1' },
        }),
      });
    });
    // Also backfill agents for that project.
    const agents = loadAgents(lp.id);
    for (const a of agents) {
      await apiSafe(async () => {
        await fetch(`${base}/projects/${lp.id}/agents`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agent_id: a.id,
            name:     a.name,
            role:     a.role,
            color:    a.color,
            icon:     a.icon,
            metadata: { specialty: a.specialty, gradient: a.gradient, backfilled: true },
          }),
        });
      });
    }
  }
  try { localStorage.setItem(MIGRATION_FLAG, 'true'); } catch { /* ignore */ }
}

// Browser-only side-effect. Wrapped in a typeof check so SSR/Vitest
// imports don't trip. Fire-and-forget — never blocks first paint.
if (typeof window !== 'undefined') {
  // Phase 14D — claim legacy GLOBAL project data into the boot identity's scope
  // SYNCHRONOUSLY at load (independent of the backend hydrate, which is skipped
  // when the backend is unreachable). This removes the global key before any
  // later account can be selected in the same session, so it can never leak.
  try { ensureScopeMigrated(); } catch { /* private mode — skip */ }
  setTimeout(() => { hydrateAndBackfill().catch(() => { /* offline */ }); }, 0);
}
