export type AIMode = 'fast' | 'deep-think' | 'research' | 'creative' | 'coding' | 'study';

export type ChatFolder = 'study' | 'coding' | 'startup' | 'finance' | 'personal' | 'none';

export type WorkspaceTab = 'chat' | 'research' | 'trading' | 'business' | 'agents' | 'coding' | 'startup' | 'study' | 'creative';

export type PlanTier = 'free' | 'pro' | 'ultra' | 'enterprise';

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
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
export type DataProvider =
  | 'Binance' | 'Yahoo' | 'AlphaVantage' | 'CoinGecko'
  | 'Finnhub' | 'TwelveData' | 'Unknown';
export type AssetType = 'stock' | 'crypto' | 'forex' | 'unknown';

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
  // Phase 8n — raw quote fields (also power the Watchlist tab).
  price?: number;
  changePercent?: number;
  assetType?: AssetType;
  isLive?: boolean;
  // Phase 8o — structured fields for the Signal Detail Drawer. All
  // optional; only present when the backend actually returned them
  // (never fabricated).
  takeProfit2?: string;
  riskReward?: number;
  invalidation?: string;
  volatilityRegime?: string;
  timeframe?: string;
  dataQuality?: string;
  rawDirection?: string;
  // Phase 9 — Trading Intelligence Engine (analysis only, never fabricated;
  // absent when the backend had no OHLC/indicator data).
  breakdown?: SignalBreakdown;
  scenarios?: SignalScenarios;
}

// ── Trading Intelligence Engine data model (Phase 9) ───────────────────────

export interface SignalFactor {
  factor: string;
  detail: string;
  weight: number;
}

export interface SignalBreakdown {
  available: boolean;
  unavailableReason?: string | null;
  bullishFactors: SignalFactor[];
  bearishFactors: SignalFactor[];
  neutralFactors: SignalFactor[];
  strongestReason?: string | null;
  weakestPoint?: string | null;
  invalidation?: string | null;
  confirmationNeeded?: string | null;
}

export interface SignalScenarios {
  available: boolean;
  unavailableReason?: string | null;
  bullish: string;
  bearish: string;
  sideways: string;
  keyLevels: Record<string, number>;
  doNotTradeIf: string;
}

// Trade Journal foundation — frontend/backend-ready structure ONLY.
// No persistence/execution yet; future phase wires this to storage.
export type TradeResult = 'win' | 'loss' | 'breakeven' | 'open';

export interface TradeJournalEntry {
  id: string;
  symbol: string;
  assetType?: AssetType;
  direction?: SignalDirection;
  entry?: number;
  stop?: number;
  target?: number;
  thesis: string;
  openedAt: string;
  closedAt?: string | null;
  result?: TradeResult;
  pnl?: number | null;
  mistakeNotes?: string | null;
  aiReview?: string | null;
  signalId?: string | null;
}

export interface TradingSignalsResponse {
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
