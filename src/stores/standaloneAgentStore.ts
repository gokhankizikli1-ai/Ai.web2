import type { ProjectAgent, AgentMessage } from '@/types/projects';

const STANDALONE_AGENTS_KEY = 'korvix_standalone_agents';

export interface StandaloneAgent extends ProjectAgent {
  projectId?: string;
  projectName?: string;
  tone: 'Professional' | 'Friendly' | 'Concise' | 'Detailed';
  memoryMode: 'project' | 'independent';
  usageMode: 'standalone' | 'project';
  createdAt: string;
}

/* ─── Load standalone agents from localStorage ─── */
export function loadStandaloneAgents(): StandaloneAgent[] {
  try {
    const stored = localStorage.getItem(STANDALONE_AGENTS_KEY);
    if (stored) return JSON.parse(stored);
  } catch { /* ignore */ }
  return [];
}

function saveStandaloneAgents(agents: StandaloneAgent[]) {
  localStorage.setItem(STANDALONE_AGENTS_KEY, JSON.stringify(agents));
}

export function getStandaloneAgents(): StandaloneAgent[] {
  return loadStandaloneAgents();
}

export function getStandaloneAgent(id: string): StandaloneAgent | undefined {
  return loadStandaloneAgents().find(a => a.id === id);
}

export function addStandaloneAgent(agent: StandaloneAgent) {
  const agents = loadStandaloneAgents();
  agents.unshift(agent);
  saveStandaloneAgents(agents);
}

export function updateStandaloneAgent(id: string, updates: Partial<StandaloneAgent>) {
  const agents = loadStandaloneAgents();
  const idx = agents.findIndex(a => a.id === id);
  if (idx >= 0) {
    agents[idx] = { ...agents[idx], ...updates };
    saveStandaloneAgents(agents);
  }
}

export function removeStandaloneAgent(id: string) {
  const agents = loadStandaloneAgents().filter(a => a.id !== id);
  saveStandaloneAgents(agents);
}

export function addStandaloneAgentMessage(agentId: string, message: AgentMessage) {
  const agents = loadStandaloneAgents();
  const idx = agents.findIndex(a => a.id === agentId);
  if (idx >= 0) {
    agents[idx].messages.push(message);
    agents[idx].lastActive = 'Just now';
    saveStandaloneAgents(agents);
  }
}

/* ─── Search agents ─── */
export function searchStandaloneAgents(query: string): StandaloneAgent[] {
  const agents = loadStandaloneAgents();
  if (!query) return agents;
  const q = query.toLowerCase();
  return agents.filter(a =>
    a.name.toLowerCase().includes(q) ||
    a.role.toLowerCase().includes(q) ||
    a.specialty.toLowerCase().includes(q)
  );
}

/* ─── Helpers ─── */
let _idCounter = 0;
export function uid(): string {
  _idCounter++;
  return `${Date.now()}-${_idCounter}-${Math.random().toString(36).slice(2, 6)}`;
}

/* ─── Agent creation from conversation data ─── */
export function buildAgentFromConversation(data: {
  name: string;
  role: string;
  specialty: string;
  description: string;
  tone: StandaloneAgent['tone'];
  memoryMode: StandaloneAgent['memoryMode'];
  usageMode: StandaloneAgent['usageMode'];
  projectId?: string;
  projectName?: string;
  color?: string;
  gradient?: string;
  icon?: string;
}): StandaloneAgent {
  const now = new Date().toISOString();
  const gradients = [
    'from-blue-400 to-blue-400',
    'from-blue-400 to-blue-400',
    'from-emerald-400 to-teal-400',
    'from-amber-400 to-orange-400',
    'from-blue-400 to-rose-400',
    'from-blue-400 to-blue-400',
  ];
  const colors = ['cyan', 'violet', 'emerald', 'amber', 'pink', 'indigo'];
  const idx = Math.abs(data.specialty.split('').reduce((a, c) => a + c.charCodeAt(0), 0)) % gradients.length;

  return {
    id: `agent-${uid()}`,
    name: data.name,
    role: data.role,
    specialty: data.specialty,
    color: data.color || colors[idx],
    gradient: data.gradient || gradients[idx],
    icon: data.icon || 'Sparkles',
    status: 'active',
    memoryUsage: 30,
    contextSync: 85,
    messages: [
      {
        id: `msg-${uid()}`,
        content: `Hi! I'm **${data.name}**, your ${data.role}. I'm ready to help with ${data.specialty.toLowerCase()}.\n\nMy tone is set to **${data.tone}** and I'm using **${data.memoryMode === 'project' ? 'project context' : 'independent memory'}**.\n\nWhat would you like to work on?`,
        sender: 'agent',
        timestamp: now,
        type: 'text',
      },
    ],
    lastActive: 'Just now',
    description: data.description,
    tone: data.tone,
    memoryMode: data.memoryMode,
    usageMode: data.usageMode,
    projectId: data.projectId,
    projectName: data.projectName,
    createdAt: now,
  };
}
