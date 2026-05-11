# coding: utf-8
# Phase 5.1 — Thesis Memory (lightweight, in-process).
#
# Stores the most recent trading_signal for each (user_id, symbol) pair so
# subsequent analyses can compare the new read against yesterday's call.
#
# Intentionally in-memory only:
#   - Zero schema changes / migrations.
#   - Zero DB I/O on the hot path.
#   - Persistence is per-process — fine for a single-replica Railway worker;
#     when we scale out or want long-term journaling, swap this for a SQLite
#     or Postgres backed implementation behind the same public API.
#
# Public API:
#   save_thesis(user_id, symbol, signal)            -> None
#   get_thesis(user_id, symbol)                     -> dict | None
#   get_recent_theses(user_id, limit=3)             -> list[dict]
#   build_previous_thesis_block(user_id, symbol)    -> str  (for prompt injection)
import time
import logging
from collections import OrderedDict
from typing import Any

logger = logging.getLogger(__name__)

# Cap total entries to keep memory bounded under load.
_MAX_ENTRIES   = 2000
_STORE: "OrderedDict[tuple[str, str], dict]" = OrderedDict()


def _key(user_id: str, symbol: str) -> tuple[str, str]:
    return (str(user_id), (symbol or "").upper())


def save_thesis(user_id: str, symbol: str, signal: dict[str, Any]) -> None:
    """Store the latest trading_signal for this (user, symbol)."""
    if not signal or not isinstance(signal, dict):
        return
    if not symbol:
        return
    k = _key(user_id, symbol)
    payload = {
        "saved_at":           int(time.time()),
        "signal":             dict(signal),       # shallow copy
    }
    if k in _STORE:
        _STORE.move_to_end(k)
    _STORE[k] = payload
    while len(_STORE) > _MAX_ENTRIES:
        _STORE.popitem(last=False)


def get_thesis(user_id: str, symbol: str) -> dict | None:
    """Return the most recent stored thesis or None."""
    k = _key(user_id, symbol)
    entry = _STORE.get(k)
    if entry is None:
        return None
    _STORE.move_to_end(k)
    return entry


def get_recent_theses(user_id: str, limit: int = 3) -> list[dict]:
    """Return up to `limit` most-recent theses for any symbol this user analyzed."""
    out: list[dict] = []
    for (u, s), entry in reversed(_STORE.items()):
        if u != str(user_id):
            continue
        out.append({"symbol": s, **entry})
        if len(out) >= limit:
            break
    return out


def build_previous_thesis_block(user_id: str, symbol: str | None) -> str:
    """
    Build a prompt-injection block summarizing the last thesis for this user+symbol.
    Returns "" if no prior thesis exists.
    """
    if not symbol:
        return ""
    entry = get_thesis(user_id, symbol)
    if not entry:
        return ""
    sig = entry.get("signal") or {}
    age_minutes = max(0, int((time.time() - entry.get("saved_at", time.time())) / 60))
    age_label = (
        f"{age_minutes}m ago"        if age_minutes < 60   else
        f"{age_minutes // 60}h ago"  if age_minutes < 1440 else
        f"{age_minutes // 1440}d ago"
    )

    lines = [
        f"[PREVIOUS THESIS — {symbol.upper()} | {age_label}]",
    ]
    for k in (
        "directional_bias", "side", "action", "trigger",
        "entry", "stop",
        "take_profit_1", "take_profit_2", "take_profit_3",
        "risk_reward", "setup_grade", "probability_pct", "confidence",
        "fakeout_risk", "liquidity_risk", "invalidation", "thesis",
        "mtf_alignment", "regime", "macro_regime", "trapped_traders",
    ):
        v = sig.get(k)
        if v is None or v == "":
            continue
        if isinstance(v, list):
            v = "; ".join(str(x) for x in v[:3])
        lines.append(f"  {k}: {v}")
    lines.append(
        "  Compare current data to this prior call. If invalidation hit → say so explicitly. "
        "If trigger hit → say so. If conditions changed → update the call honestly."
    )
    return "\n".join(lines)


def clear_user(user_id: str) -> int:
    """Wipe all theses for a user. Returns count removed."""
    keys = [k for k in _STORE if k[0] == str(user_id)]
    for k in keys:
        del _STORE[k]
    return len(keys)
