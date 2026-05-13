# coding: utf-8
"""
Phase 8d — Trading data safety.

Guard rails that callers can use to ensure no fabricated / simulated
prices leak to users.

Public API
  is_demo_mode()           → bool. True when ENABLE_TRADING_DEMO_MODE=true
                              AND ENVIRONMENT != "production".
  filter_live_signals(...)  → drops every signal whose is_live is not True
                              (UNLESS demo mode is on, in which case
                              non-live signals are kept but the caller is
                              expected to label them).
  is_live_signal(signal)    → bool predicate, single signal.
  safe_empty_response()     → canonical "Market data unavailable right now"
                              shape that routes can return.

Why a dedicated module
  The signals_service already implements is_live correctly per row, but
  callers (HTTP routes, frontend bridges, the future v2 signals API)
  need a single source of truth for the "is this safe to display as
  real money advice?" question. Concentrating it here also gives Bugbot
  / future reviewers one place to audit.
"""
from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List


# ── Flags ────────────────────────────────────────────────────────────────

def _flag(name: str) -> bool:
    return os.getenv(name, "false").strip().lower() == "true"


def is_demo_mode() -> bool:
    """Demo mode is opt-in AND only ever active outside production.

    Even if ENABLE_TRADING_DEMO_MODE=true is set on Railway-production by
    mistake, the production-environment guard keeps simulated data off
    real users' screens. Operators must run dev/staging to see demo data.
    """
    if not _flag("ENABLE_TRADING_DEMO_MODE"):
        return False
    env = os.getenv("ENVIRONMENT", "production").strip().lower()
    return env != "production"


# ── Signal-level predicates ─────────────────────────────────────────────

def is_live_signal(signal: Any) -> bool:
    """A signal is 'live' only when its `is_live` field is the literal
    boolean True. None, "true", 1, missing, anything else → not live.
    Strict on purpose: we want to fail closed on any ambiguity."""
    if not isinstance(signal, dict):
        return False
    return signal.get("is_live") is True


def filter_live_signals(signals: Iterable[dict]) -> List[dict]:
    """Drop every signal whose is_live is not the literal True.

    In demo mode (dev/staging only — see is_demo_mode), non-live signals
    are kept but the caller is expected to label them clearly. In
    production this function ALWAYS strips non-live entries — no flag
    on Railway production can override that."""
    if signals is None:
        return []
    survivors = [s for s in signals if isinstance(s, dict)]
    if is_demo_mode():
        return survivors
    return [s for s in survivors if is_live_signal(s)]


# ── Canonical empty-state response ──────────────────────────────────────

def safe_empty_response(symbols: Iterable[str] | None = None) -> Dict[str, Any]:
    """Canonical shape every trading route can return when no live data
    is available. The frontend can branch on `is_live=false` AND treat
    `signals=[]` as the "Market data unavailable" UX.

    Critically: this function NEVER fabricates a symbol / price / entry.
    The signals array is always empty."""
    sym_list = sorted({s for s in (symbols or []) if isinstance(s, str) and s.strip()})
    return {
        "signals":        [],
        "live_count":     0,
        "is_live":        False,
        "demo_mode":      is_demo_mode(),
        "requested":      sym_list,
        "timestamp":      datetime.now(timezone.utc).isoformat(),
        "message":        "Market data unavailable right now.",
        "data_quality":   "unavailable",
    }


__all__ = [
    "is_demo_mode",
    "is_live_signal",
    "filter_live_signals",
    "safe_empty_response",
]
