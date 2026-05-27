export type AIMode = 'fast' | 'deep-think' | 'research' | 'creative' | 'coding' | 'study';

export type ChatFolder = 'study' | 'coding' | 'startup' | 'finance' | 'personal' | 'none';

export type WorkspaceTab = 'chat' | 'research' | 'trading' | 'business' | 'agents' | 'coding' | 'startup' | 'study' | 'creative';

export type PlanTier = 'free' | 'pro' | 'ultra' | 'enterprise';

export interface AttachedAsset {
  asset_id:   string;
  filename:   string;
  mime_type:  string;
  size_bytes: number;
  // Optional thumbnail / public URL the message bubble can render.
  // For local-storage backend this is `/v2/assets/blob/<key>`.
  public_url?: string;
  asset_type?: string;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  /** Phase 9 — assets attached to a USER turn. The chat hook
   *  populates this from the composer's pending list when sending;
   *  MessageBubble renders read-only AssetChips below the bubble. */
  attachments?: AttachedAsset[];
}

/** Phase 10 fix — surfaced to the UI while a backend tool (browser /
 *  github / future) is running before the LLM token stream opens.
 *  The chat hook drives this off SSE tool.started / tool.completed
 *  events. Null when no tool is active. */
export interface ToolActivity {
  toolId:        string;        // "github_repo" | "browser_fetch" | future
  /** Short human-readable label rendered next to the spinner.
   *  Example: "Analyzing repository openai/openai-python". */
  label:         string;
  /** "running" while the tool is in flight; "completed" briefly
   *  before the next assistant message starts; "failed" if the tool
   *  didn't yield real data (e.g. rate limit). */
  status:        'running' | 'completed' | 'failed';
  /** Optional inputs the chip can render — e.g. ["openai/openai-python"]
   *  for github_repo. */
  inputs?:       string[];
  startedAtMs:   number;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  updatedAt: Date;
  isDemo?: boolean;
  folder?: ChatFolder;
  isFavorite?: boolean;
  isArchived?: boolean;
}

export interface PromptItem {
  id: string;
  title: string;
  content: string;
  category: string;
}

export interface AIModeOption {
  id: AIMode;
  label: string;
  description: string;
  icon: string;
}

// Trading types
export type SignalDirection = 'long' | 'short' | 'wait' | 'neutral';
export type DataProvider = 'Finnhub' | 'CoinGecko' | 'Binance' | 'Yahoo' | 'AlphaVantage' | 'Unknown';

export interface TradingSignal {
  id: string;
  symbol: string;
  name: string;
  direction: SignalDirection;
  confidence: number;
  setupGrade: 'A' | 'B' | 'C' | 'D';
  volatility: 'low' | 'medium' | 'high';
  entryPrice?: string;
  targetPrice?: string;
  stopLoss?: string;
  timestamp: Date;
  reasoning: string;
  provider?: DataProvider;
  sparkline?: number[];
}

export interface TradingSignalsResponse {
  is_live: boolean;
  provider: DataProvider;
  timestamp: string;
  signals: TradingSignal[];
}

// AI Activity types
export interface AIActivity {
  id: string;
  status: 'active' | 'completed' | 'queued';
  message: string;
  detail?: string;
  progress?: number; // 0-100
  timestamp: Date;
}

// Business types
export interface StartupIdea {
  id: string;
  title: string;
  category: string;
  score: number;
  trend: 'rising' | 'stable' | 'emerging';
  description: string;
  marketSize: string;
}

export interface CompetitorInsight {
  id: string;
  company: string;
  metric: string;
  value: string;
  change: string;
  positive: boolean;
}

// Agent OS types
export type AgentStatus = 'running' | 'idle' | 'paused' | 'error';

export interface AgentTask {
  id: string;
  label: string;
  status: 'pending' | 'active' | 'completed' | 'failed';
  agentId: string;
  progress?: number;
  duration?: string;
  timestamp: Date;
}

export interface Agent {
  id: string;
  name: string;
  status: AgentStatus;
  description: string;
  icon: string;
  color: string;
  tasksCompleted: number;
  tasksActive: number;
  uptime: string;
  lastAction: string;
  memoryUsed: string;
  capabilities: string[];
}

// Slash command types
export interface SlashCommand {
  id: string;
  command: string;
  label: string;
  description: string;
  category: string;
  icon: string;
  premium?: boolean;
}

// Billing types
export interface UsageMetrics {
  messagesUsed: number;
  messagesLimit: number;
  tokensUsed: number;
  tokensLimit: number;
  agentsUsed: number;
  agentsLimit: number;
  researchUsed: number;
  researchLimit: number;
}

// ═══════════════════════════════════════════
// Multi-Agent Project Types (Future Architecture)
// ═══════════════════════════════════════════

export type AgentRole = 'frontend' | 'backend' | 'designer' | 'marketing' | 'researcher' | 'trader' | 'general';

export interface ProjectAgent {
  id: string;
  role: AgentRole;
  name: string;
  status: AgentStatus;
  avatar?: string;
  description: string;
  color: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  status: 'active' | 'archived' | 'draft';
  agents: ProjectAgent[];
  chatIds: string[]; // References to chat sessions under this project
  createdAt: Date;
  updatedAt: Date;
  ownerId: string;
  collaborators?: string[];
  tags?: string[];
}

export interface ProjectWorkspace {
  projects: Project[];
  activeProjectId: string | null;
}
