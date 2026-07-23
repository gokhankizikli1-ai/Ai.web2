# coding: utf-8
"""
Design Debug — trace → sanitized debug response.

Projects a recorded :class:`DesignDecisionTrace` (+ its record metadata) into the
whitelisted :class:`DebugTraceResponse`. This is the security boundary: ONLY the safe,
non-identifying fields cross it — no raw prompt, no personal data, no internal scoring
detail (matched signals), no API keys. Pure and total.
"""
from __future__ import annotations

from typing import Any, List

from backend.services.design_debug.models import DebugTraceResponse, DecisionSummary

_MAX_LIST = 8


def _get(source: Any, key: str) -> Any:
    if isinstance(source, dict):
        return source.get(key)
    return getattr(source, key, None)


def _str(value: Any, limit: int = 200) -> str:
    return " ".join(str(value or "").split()).strip()[:limit]


def _list(value: Any) -> List[str]:
    if not isinstance(value, (list, tuple)):
        return []
    out: List[str] = []
    for item in value:
        text = _str(item, 120)
        if text:
            out.append(text)
        if len(out) >= _MAX_LIST:
            break
    return out


def build_debug_response(record: Any) -> DebugTraceResponse:
    """Build the sanitized response from a store ``TraceRecord``. Never raises."""
    trace = _get(record, "trace")
    build_id = _str(_get(record, "build_id"), 200)
    timestamp = _str(_get(record, "recorded_at"), 40)

    try:
        confidence = float(_get(trace, "confidence") or 0.0)
    except (TypeError, ValueError):
        confidence = 0.0

    summary = DecisionSummary(
        industry=_str(_get(trace, "industry"), 120),
        selected_direction=_str(_get(trace, "selected_direction"), 160),
        reasons=_list(_get(trace, "main_reasons")),
        avoided_patterns=_list(_get(trace, "avoided")),
        contributing_layers=_list(_get(trace, "contributing_layers")),
    )
    return DebugTraceResponse(
        build_id=build_id,
        decision_summary=summary,
        priority_order=_str(_get(trace, "priority"), 160),
        confidence=confidence,
        user_override=bool(_get(trace, "user_override")),
        timestamp=timestamp,
    )


__all__ = ["build_debug_response"]
