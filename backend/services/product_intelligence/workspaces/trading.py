# coding: utf-8
"""Trading Intelligence workspace profile (planning only — read-only first)."""
from backend.services.product_intelligence.registry import WorkspaceProfile, register_workspace
from backend.services.product_intelligence.types import (
    WorkspaceKind, ProductCategory, GenerationMode, InteractionStyle,
)

PROFILE = WorkspaceProfile(
    kind=WorkspaceKind.TRADING,
    title="Trading Intelligence",
    keywords={
        "trading": 1.3, "trade": 0.8, "stock": 1.0, "stocks": 1.0,
        "crypto": 1.1, "bitcoin": 0.9, "forex": 1.0, "market": 0.6,
        "portfolio": 0.9, "watchlist": 1.0, "signals": 1.0, "ticker": 1.0,
        "candlestick": 1.0, "backtest": 1.1, "indicator": 0.9, "rsi": 0.9,
        "moving average": 0.9, "price action": 1.0, "investment": 0.7,
    },
    patterns=[
        (r"\b(trading|investment)\s+(signal|dashboard|strategy|system)", 1.3),
        (r"\b(buy|sell)\s+signal", 1.0),
    ],
    default_category=ProductCategory.TRADING_SYSTEM,
    default_renderer="dashboard",
    default_generation_mode=GenerationMode.ANALYSIS,
    default_interaction=InteractionStyle.REALTIME,
    typical_industry="finance",
    typical_audience="traders / investors",
    typical_goal="surface market signals and manage risk",
    base_agents=["market_scanner", "trading_analyst", "risk_officer", "reporter"],
    feature_hints=[
        "Watchlist", "Live quotes", "Signal cards", "Charting",
        "Risk metrics", "Briefing/report",
    ],
    screen_hints=["Watchlist", "Asset detail", "Signals", "Portfolio", "Report"],
    information_architecture=[
        "Watchlist → asset detail (chart + signals) → portfolio → daily briefing",
    ],
    interaction_model="Live, data-driven dashboards with periodic refresh.",
    data_entities=["Asset", "Quote", "Signal", "Position", "Watchlist"],
    ux_direction="Dense but scannable; never fabricate prices — show data quality.",
    visual_direction="Dark, terminal-grade, color-coded deltas.",
    risks=[
        "Presenting non-live or fabricated data as live (must be honest)",
        "Execution/financial-advice scope creep (read-only first)",
    ],
    success_metrics=["Signal precision", "Data freshness", "Risk-adjusted clarity"],
    deliverables=["Trading dashboard blueprint", "Signal & risk model", "Briefing format"],
    future_expansion=["Live market providers", "Backtesting", "Owner-gated execution"],
)

register_workspace(PROFILE)
