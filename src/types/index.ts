export type AIMode = 'fast' | 'deep-think' | 'research' | 'creative' | 'coding' | 'study';

export type ChatFolder = 'study' | 'coding' | 'startup' | 'finance' | 'personal' | 'none';

// Phase 5.2 — structured trading signal carried in chat response metadata.
// Optional; only populated when the AI runs trading_analyst mode.
export interface TradingSignal {
  symbol?: string;
  timeframe?: string;
  directional_bias?: 'LONG' | 'SHORT' | 'WAIT' | 'REVERSAL_WATCH' | 'NO_TRADE' | string;
  side?: 'long' | 'short' | 'none' | string;
  action?: 'enter' | 'wait' | 'exit' | 'reduce' | 'watch' | string;
  trigger?: string;
  entry?: number | null;
  stop?: number | null;
  take_profit_1?: number | null;
  take_profit_2?: number | null;
  take_profit_3?: number | null;
  risk_reward?: number | null;
  setup_grade?: number | null;
  probability_pct?: number | null;
  confidence?: 'low' | 'medium' | 'high' | string;
  fakeout_risk?: number | null;
  liquidity_risk?: number | null;
  volatility_regime?: string;
  invalidation?: string;
  thesis?: string;
  mtf_alignment?: string;
  regime?: string;
  macro_regime?: string;
  trapped_traders?: 'longs' | 'shorts' | null | string;
  do_now?: string[];
  do_not_do?: string[];
}

export interface ToolSummary {
  market_data?: {
    symbol?: string;
    timeframe?: string;
    last_price?: number | null;
    rsi_14?: number | null;
    trend?: string;
    regime?: string;
    bb_squeeze?: boolean | null;
    mtf_alignment?: string | null;
    directional_bias?: string | null;
    setup_grade?: number | null;
    side_bias?: string | null;
    fakeout_risk?: number | null;
    liquidity_risk?: number | null;
    funding_regime?: string | null;
    trapped_traders?: string | null;
    positioning_signal?: string | null;
    provider?: string | null;
    data_quality?: 'full' | 'degraded' | 'fallback' | string | null;
    data_quality_missing?: string[] | null;
  };
  macro_data?: {
    regime?: string;
    btc_dominance_pct?: number | null;
    dxy?: number | null;
    dxy_change_1d_pct?: number | null;
    total_market_cap_change_24h_pct?: number | null;
  };
}

export interface MessageMetadata {
  trading_signal?: TradingSignal;
  tool_summary?: ToolSummary;
  prior_thesis_used?: boolean;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  metadata?: MessageMetadata;
  serverMessageId?: string;          // remote message id once persisted (W1)
}

/**
 * Phase W1 — server-side session sync.
 *
 * Sessions and messages keep their existing local fields; new optional
 * `serverThreadId` / `serverMessageId` fields record the remote ids once
 * the W1 sync layer has confirmed them. Absent values mean "local only
 * so far" (e.g. demo chats, unsynced new chats, or sessions while flag is off).
 */
export interface ChatSession {
  id: string;                        // stable local id
  title: string;
  messages: Message[];
  updatedAt: Date;
  isDemo?: boolean;
  folder?: ChatFolder;
  serverThreadId?: string;           // remote thread id (W1)
  serverWorkspaceId?: string;        // remote workspace id (W1)
  syncStatus?: 'unsynced' | 'syncing' | 'synced' | 'error';
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
