# coding: utf-8
"""
Design Observability — human-readable trace summary.

Renders a :class:`DesignDecisionTrace` into a compact ``DESIGN DECISION SUMMARY`` a
developer can read to understand why a website's style was chosen. Debug/log text only —
never a generation prompt, never raw user content. Pure and total.
"""
from __future__ import annotations

from typing import Any, List

_HEADER = "DESIGN DECISION SUMMARY"


def _get(source: Any, key: str) -> Any:
    if isinstance(source, dict):
        return source.get(key)
    return getattr(source, key, None)


def _bullets(values: Any, limit: int = 5) -> List[str]:
    if not isinstance(values, (list, tuple)):
        return []
    out: List[str] = []
    for item in values:
        text = " ".join(str(item).split()).strip()
        if text:
            out.append(text)
        if len(out) >= limit:
            break
    return out


def format_trace(trace: Any) -> str:
    """Render the compact summary, or ``""`` when there is nothing to say. Never raises."""
    if trace is None:
        return ""
    try:
        industry = " ".join(str(_get(trace, "industry") or "").split()).strip() or "General"
        direction = " ".join(str(_get(trace, "selected_direction") or "").split()).strip()
        reasons = _bullets(_get(trace, "main_reasons"))
        avoided = _bullets(_get(trace, "avoided"))
        override = bool(_get(trace, "user_override"))
        priority = " ".join(str(_get(trace, "priority") or "").split()).strip()

        lines: List[str] = [_HEADER, "", "Industry:", industry]
        if direction:
            lines += ["", "Selected Direction:", direction]
        if reasons:
            lines += ["", "Main Reasons:"] + [f"- {r}" for r in reasons]
        if avoided:
            lines += ["", "Avoided:"] + [f"- {a}" for a in avoided]
        if priority:
            lines += ["", "Decision Priority:", priority]
        lines += ["", f"User Override: {'yes' if override else 'no'}"]
        return "\n".join(lines)
    except Exception:  # noqa: BLE001
        return ""


__all__ = ["format_trace"]
