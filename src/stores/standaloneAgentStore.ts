import type { ProjectAgent, AgentMessage } from '@/types/projects';
import {
  scopedKey, claimLegacyGlobal, quarantineLegacyGlobal, dropLegacyGlobal,
} from '@/lib/storageScope';

// Phase 14D — namespaced per identity; logout no longer wipes this (isolation is
// structural). Phase 14D.2 — legacy GLOBAL agents are claimed by at most one
// authenticated owner and MERGED BY ID into that owner's scope.
const STANDALONE_AGENTS_KEY = 'korvix_standalone_agents';
function standaloneAgentsKey(): string { return scopedKey(STANDALONE_AGENTS_KEY); }

/** A valid agent entry is an object with a non-empty string id. */
function isAgentEntry(v: unknown): v is StandaloneAgent {
  return !!v && typeof v === 'object'
    && typeof (v as { id?: unknown }).id === 'string'
    && (v as { id: string }).id.length > 0;
}

/**
 * Claim + merge legacy GLOBAL standalone agents into the current owner's scope
 * (Phase 14D.2). Merge BY ID: the scoped entry wins on collision (its message
 * history is never merged across a colliding id), and unique legacy agents are
 * appended. Malformed legacy JSON is quarantined; individual non-object / id-less
 * entries are skipped while the valid remainder is preserved. Malformed scoped
 * data is never overwritten. Only the marker owner runs; idempotent (the global
 * key is removed only after a successful scoped write).
 */
function migrateStandaloneAgents(): void {
  const claim = claimLegacyGlobal(STANDALONE_AGENTS_KEY);
  if (!claim) return;

  let legacy: unknown;
  try { legacy = JSON.parse(claim.raw); } catch { legacy = undefined; }
  if (!Array.isArray(legacy)) {
    if (quarantineLegacyGlobal(STANDALONE_AGENTS_KEY, claim.raw)) dropLegacyGlobal(STANDALONE_AGENTS_KEY);
    return;
  }
  const legacyAgents = legacy.filter(isAgentEntry);

  let scoped: StandaloneAgent[] = [];
  const scopedRaw = localStorage.getItem(claim.scopedKey);
  if (scopedRaw !== null) {
    let parsed: unknown;
    try { parsed = JSON.parse(scopedRaw); } catch { return; } // malformed scoped — never overwrite
    if (!Array.isArray(parsed)) return;                       // unknown scoped shape — never overwrite
    scoped = parsed.filter(isAgentEntry);
  }

  const byId = new Set(scoped.map((a) => a.id));
  const merged = [...scoped];
  for (const a of legacyAgents) if (!byId.has(a.id)) { byId.add(a.id); merged.push(a); }

  try { localStorage.setItem(claim.scopedKey, JSON.stringify(merged)); }
  catch { return; }                                           // quota — leave global for retry
  dropLegacyGlobal(STANDALONE_AGENTS_KEY);
}

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
    migrateStandaloneAgents();
    const stored = localStorage.getItem(standaloneAgentsKey());
    if (stored) {
      const parsed: unknown = JSON.parse(stored);
      if (Array.isArray(parsed)) return parsed.filter(isAgentEntry);
    }
  } catch { /* ignore */ }
  return [];
}

function saveStandaloneAgents(agents: StandaloneAgent[]) {
  try { localStorage.setItem(standaloneAgentsKey(), JSON.stringify(agents)); } catch { /* ignore */ }
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

// Browser-only, fire-and-forget: claim + merge legacy GLOBAL standalone agents
// into the boot identity's scope at module load (mirrors projectStore), so the
// rightful owner's migration completes at boot instead of waiting for the
// /agents surface. Guests / non-owners no-op; idempotent. Never blocks paint.
if (typeof window !== 'undefined') {
  try { migrateStandaloneAgents(); } catch { /* private mode — skip */ }
}
