export interface ProjectAgent {
  id: string;
  name: string;
  role: string;
  specialty: string;
  color: string;
  gradient: string;
  icon: string;
  status: 'active' | 'idle' | 'syncing' | 'offline';
  memoryUsage: number;
  contextSync: number;
  messages: AgentMessage[];
  lastActive: string;
  description: string;
}

export interface AgentMessage {
  id: string;
  content: string;
  sender: 'agent' | 'user' | 'system';
  timestamp: string;
  agentId?: string;
  type?: 'text' | 'code' | 'file' | 'decision';
  isTyping?: boolean;
}

export interface ProjectTask {
  id: string;
  title: string;
  status: 'pending' | 'in_progress' | 'completed' | 'blocked';
  assignedTo?: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  createdAt: string;
  updatedAt: string;
}

export interface ProjectMemory {
  id: string;
  type: 'knowledge' | 'decision' | 'resource' | 'conversation';
  title: string;
  content: string;
  agentId?: string;
  createdAt: string;
  tags: string[];
  confidence: number;
}

export interface ProjectFile {
  id: string;
  name: string;
  type: string;
  size: string;
  uploadedBy: string;
  uploadedAt: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  category: string;
  status: 'active' | 'archived' | 'draft';
  progress: number;
  agents: ProjectAgent[];
  tasks: ProjectTask[];
  memory: ProjectMemory[];
  files: ProjectFile[];
  createdAt: string;
  updatedAt: string;
  color: string;
  gradient: string;
  icon: string;
  /** Optional structured Web Build package. Additive — old projects simply
   *  don't have it. When present, the project detail page renders the saved
   *  build (overview / sections / copy / code / preview / activity) instead of
   *  the generic orchestrator/agent empty state. Type is kept loose here to
   *  avoid a type cycle; see WebBuildPayload in src/lib/webBuildPayload.ts. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  webBuild?: import('@/lib/webBuildPayload').WebBuildPayload;
}

export interface ProjectContext {
  sharedKnowledge: string[];
  syncedConversations: number;
  uploadedResources: number;
  recentDecisions: string[];
  contextHealth: number;
  lastSync: string;
  activeAgents: number;
  totalMessages: number;
}
