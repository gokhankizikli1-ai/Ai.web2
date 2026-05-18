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
  intel?: SignalIntel;
  analytics?: SignalAnalytics;
  mtf?: MtfEngine;
  volume?: SignalVolume;
  confidenceEngine?: SignalConfidence;
  alerts?: SignalAlerts;
}

export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface SignalAlert {
  type: string;
  severity: AlertSeverity;
  message: string;
}

// Smart alerts (Phase 2). Only real triggered conditions — empty list
// is a valid honest state; never fabricated.
export interface SignalAlerts {
  available: boolean;
  unavailableReason?: string | null;
  alerts: SignalAlert[];
}

export interface ConfidenceFactor {
  name: string;
  impact: number;
  state: string;
  note: string;
}

// Advanced confidence engine (Phase 2). Additive — never overwrites the
// legacy confidence / intel fields. Honest unavailable when no data.
export interface SignalConfidence {
  available: boolean;
  unavailableReason?: string | null;
  confidence: number;
  conviction: string;
  grade: 'A' | 'B' | 'C' | 'D';
  factors: ConfidenceFactor[];
  explanation: string;
}

// Volume & liquidity intelligence (Phase 2). Pure derivation from
// already-computed fields; honest unavailable when no volume feed.
export interface SignalVolume {
  available: boolean;
  unavailableReason?: string | null;
  volumeTrend?: string | null;
  participation: string;
  participationNote: string;
  anomalies: string[];
  breakoutQuality?: string | null;
  breakoutNote: string;
  liquiditySweepRisk: string;
  liquidityNote: string;
  volumeConfidence: number;
  summary?: string | null;
}

export type MtfBias = 'bullish' | 'bearish' | 'neutral' | 'unavailable';

export interface MtfTfRow {
  tf: string;
  bias: MtfBias;
  rsi: number | null;
}

// Multi-timeframe alignment engine (Phase 2). Timeframes the feed did
// not return are 'unavailable' — never a guessed bias.
export interface MtfEngine {
  available: boolean;
  unavailableReason?: string | null;
  timeframes: MtfTfRow[];
  alignment?: string | null;
  agreementPct?: number | null;
  score: number;
  conflict: boolean;
  summary?: string | null;
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

export interface SignalIntelFactor {
  factor: string;
  side: 'bull' | 'bear' | 'neutral';
  weight: number;
}

// Multi-factor decision engine output (additive — never overwrites the
// legacy direction/confidence; absent when OHLC/indicators unavailable).
export interface SignalIntel {
  available: boolean;
  unavailableReason?: string | null;
  direction: SignalDirection;
  confidence: number;
  grade: 'A' | 'B' | 'C' | 'D';
  score: number;
  bullWeight: number;
  bearWeight: number;
  factors: SignalIntelFactor[];
  invalidation?: string | null;
  rationale: string;
}

export interface MacdReading {
  macd: number | null;
  signal: number | null;
  hist: number | null;
  state: string;
}

export interface MomentumReading {
  rocPct: number | null;
  state: string;
}

export interface TrendStrengthReading {
  adx: number | null;
  label: string;
}

export interface MtfAlignment {
  alignment: string;
  up: number;
  down: number;
  side: number;
  divergences: string[];
}

export interface TimeframeRow {
  tf: string;
  trend: string;
  rsi: number | null;
}

// Raw computed analytics (pass-through; absent when no OHLC data).
export interface SignalAnalytics {
  available: boolean;
  unavailableReason?: string | null;
  regime?: string | null;
  trend?: string | null;
  rsi14?: number | null;
  ema20?: number | null;
  ema50?: number | null;
  bos?: string | null;
  volumeTrend?: string | null;
  atr14?: number | null;
  volatilityPct?: number | null;
  macd?: MacdReading | null;
  momentum?: MomentumReading | null;
  trendStrength?: TrendStrengthReading | null;
  mtf?: MtfAlignment | null;
  timeframes?: TimeframeRow[] | null;
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
  // Phase 2 #5 — additive optional context.
  timeframe?: string;
  setupType?: string;
  confidenceAtEntry?: number | null;
  tags?: string[];
}

export interface JournalSetupStat {
  setup: string;
  trades: number;
  wins: number;
  winrate: number;
  avgRR: number;
}

// Trade-journal analytics — computed ONLY from the user's own real
// entries. Never fabricated; honest "insufficient data" when sparse.
export interface JournalAnalytics {
  total: number;
  open: number;
  closed: number;
  wins: number;
  losses: number;
  breakeven: number;
  winrate: number;          // % of closed
  avgRR: number;            // planned RR across entries with levels
  expectancy: number;       // avg pnl per closed trade (when pnl present)
  bestSetup: string | null;
  worstSetup: string | null;
  bySetup: JournalSetupStat[];
  rrBuckets: { label: string; count: number }[];
  overtradingDays: number;  // days with > 5 opened trades
  insights: string[];
  reliable: boolean;        // false when too few closed trades
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

// Agent Run Engine (Autopilot) — Phase 4 #4A/4B.
// Dry-run only: analyze/draft route to the normal chat, compute is the
// user's own input; research/act are honest "requires approval" placeholders
// because no external-data or execution gate is open (Assisted ceiling).
export type AgentStepKind = 'analyze' | 'draft' | 'compute' | 'research' | 'act';
export type AgentStepStatus = 'pending' | 'running' | 'done' | 'blocked' | 'skipped';
export type AgentRunStatus = 'planned' | 'running' | 'completed';

export interface AgentStep {
  id: string;
  kind: AgentStepKind;
  title: string;
  detail: string;
  /** Structured prompt routed to the normal chat (analyze/draft only). */
  prompt?: string;
  status: AgentStepStatus;
  /** User-captured result / note for this step. */
  output?: string;
  /** Why a side-effect/research step cannot execute yet (honest). */
  blockedReason?: string;
  /** Critic confidence 0–100. */
  confidence?: number;
  /** Critic flag: this step's quality depends on live data we don't have. */
  needsRealData?: boolean;
  /** Assisted-ceiling decision for gated (research/act) steps. */
  approval?: ApprovalDecision;
}

export interface AgentRun {
  id: string;
  goal: string;
  createdAt: string;
  updatedAt: string;
  status: AgentRunStatus;
  steps: AgentStep[];
}

// Agent tool registry — Phase 4 #4C. Declarative, typed contracts. AI/compute
// tools are runnable (structure a prompt / use the user's own input);
// research & act tools are registered but GATED — their gate is not open, so
// they are never executed (no fabricated data, no real side effects).
export type AgentToolGate = 'none' | 'external-data' | 'execution';

export interface AgentTool {
  id: string;
  kind: AgentStepKind;
  label: string;
  description: string;
  /** Human-readable input contract. */
  inputs: string;
  /** Gate that must be open to run this tool; 'none' = dry-runnable. */
  gate: AgentToolGate;
}

// Verifier — Phase 4 #4C. Pure, honest critique of a step + its output.
// Never fabricates a pass; flags when output depends on data we don't have.
export interface VerifierCheck {
  label: string;
  passed: boolean;
}

export interface VerifierVerdict {
  confidence: number;        // 0–100 honest estimate, never a guarantee
  needsRealData: boolean;
  checks: VerifierCheck[];
  summary: string;
}

// Approval & audit — Phase 4 #4E. Assisted ceiling: every gated action needs
// an explicit decision. Decisions are LOGGED but never executed here because
// no execution/external-data gate is open.
export type ApprovalDecision = 'pending' | 'approved' | 'denied';

export type AuditEventType =
  | 'run.planned'
  | 'step.run'
  | 'step.completed'
  | 'step.skipped'
  | 'approval.requested'
  | 'approval.approved'
  | 'approval.denied'
  | 'killswitch.on'
  | 'killswitch.off';

export interface AuditEvent {
  id: string;
  at: string;
  type: AuditEventType;
  detail: string;
  runId?: string;
}
