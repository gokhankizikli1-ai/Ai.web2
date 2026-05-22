import type { Project, ProjectAgent, ProjectTask } from '@/types/projects';

const STORAGE_KEY = 'korvix_projects';
const AGENTS_KEY = 'korvix_project_agents';
const TASKS_KEY = 'korvix_project_tasks';

/* ─── Load user-created projects from localStorage ─── */
function loadProjects(): Project[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch { /* ignore */ }
  return [];
}

function saveProjects(projects: Project[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
}

export function getProjects(): Project[] {
  return loadProjects();
}

export function addProject(project: Project) {
  const projects = loadProjects();
  projects.unshift(project);
  saveProjects(projects);
}

export function getProject(id: string): Project | undefined {
  return getProjects().find(p => p.id === id);
}

/* ─── Project Agents ─── */
function loadAgents(projectId: string): ProjectAgent[] {
  try {
    const stored = localStorage.getItem(`${AGENTS_KEY}_${projectId}`);
    if (stored) return JSON.parse(stored);
  } catch { /* ignore */ }
  return [];
}

function saveAgents(projectId: string, agents: ProjectAgent[]) {
  localStorage.setItem(`${AGENTS_KEY}_${projectId}`, JSON.stringify(agents));
}

export function getProjectAgents(projectId: string): ProjectAgent[] {
  return loadAgents(projectId);
}

export function addProjectAgent(projectId: string, agent: ProjectAgent) {
  const agents = loadAgents(projectId);
  agents.push(agent);
  saveAgents(projectId, agents);
}

export function updateProjectAgent(projectId: string, agentId: string, updates: Partial<ProjectAgent>) {
  const agents = loadAgents(projectId);
  const idx = agents.findIndex(a => a.id === agentId);
  if (idx >= 0) {
    agents[idx] = { ...agents[idx], ...updates };
    saveAgents(projectId, agents);
  }
}

export function removeProjectAgent(projectId: string, agentId: string) {
  const agents = loadAgents(projectId).filter(a => a.id !== agentId);
  saveAgents(projectId, agents);
}

export function addAgentMessage(projectId: string, agentId: string, message: ProjectAgent['messages'][0]) {
  const agents = loadAgents(projectId);
  const idx = agents.findIndex(a => a.id === agentId);
  if (idx >= 0) {
    agents[idx].messages.push(message);
    saveAgents(projectId, agents);
  }
}

/* ─── Project Tasks ─── */
function loadTasks(projectId: string): ProjectTask[] {
  try {
    const stored = localStorage.getItem(`${TASKS_KEY}_${projectId}`);
    if (stored) return JSON.parse(stored);
  } catch { /* ignore */ }
  return [];
}

function saveTasks(projectId: string, tasks: ProjectTask[]) {
  localStorage.setItem(`${TASKS_KEY}_${projectId}`, JSON.stringify(tasks));
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
  { id: 'frontend', label: 'Frontend Engineer', color: 'blue', gradient: 'from-blue-400 to-indigo-400', icon: 'Layout', description: 'Builds responsive UI components and frontend architecture.' },
  { id: 'backend', label: 'Backend Engineer', color: 'cyan', gradient: 'from-cyan-400 to-teal-400', icon: 'Server', description: 'Designs scalable APIs, databases, and microservices.' },
  { id: 'research', label: 'Research Analyst', color: 'purple', gradient: 'from-violet-400 to-purple-400', icon: 'Search', description: 'Conducts deep research, analysis, and reporting.' },
  { id: 'startup', label: 'Startup Strategist', color: 'orange', gradient: 'from-amber-400 to-orange-400', icon: 'Rocket', description: 'Validates ideas, analyzes markets, creates strategies.' },
  { id: 'ecommerce', label: 'Ecommerce Expert', color: 'emerald', gradient: 'from-emerald-400 to-green-400', icon: 'ShoppingBag', description: 'Optimizes stores, pricing, ads, and product research.' },
  { id: 'trading', label: 'Trading Analyst', color: 'green', gradient: 'from-green-400 to-emerald-400', icon: 'TrendingUp', description: 'Generates signals, analyzes markets, manages risk.' },
  { id: 'design', label: 'UI/UX Designer', color: 'pink', gradient: 'from-pink-400 to-rose-400', icon: 'Palette', description: 'Creates design systems, prototypes, and visual experiences.' },
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
