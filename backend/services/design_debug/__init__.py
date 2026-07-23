# coding: utf-8
"""
Design Debug — developer-only inspection of AI design decisions.

Exposes the read-only Design Decision Trace recorded by the observability layer so a
developer can answer "why did Korvix choose this website style?" for a given build. It
consumes ONLY the existing observability output — no intelligence logic is duplicated and
the generation path is never touched.

Security: default OFF, behind ``ENABLE_DESIGN_DEBUG``; the HTTP route is additionally
owner-only and returns 404 when disabled. The response is sanitized (no raw prompt, no
personal data, no API keys, no internal scoring). Fail-open everywhere.

Public API:
    is_enabled()               — is the debug surface turned on?
    get_design_trace(build_id) — sanitized debug response dict, or None (flag-gated)
    recent_build_ids(limit)    — recent build ids for a debug index (flag-gated)
"""
from __future__ import annotations

import os
from typing import Any, Dict, List, Optional

from backend.services.design_debug import service as _service
from backend.services.design_debug.models import DebugTraceResponse, DecisionSummary


def is_enabled() -> bool:
    """True only when ``ENABLE_DESIGN_DEBUG`` is explicitly ``"true"``."""
    return (os.getenv("ENABLE_DESIGN_DEBUG", "false") or "").strip().lower() == "true"


def get_design_trace(build_id: str) -> Optional[Dict[str, Any]]:
    """Sanitized debug response for ``build_id`` when the debug surface is enabled, else
    ``None``. Never raises."""
    if not is_enabled():
        return None
    return _service.get_design_trace(build_id)


def recent_build_ids(limit: int = 20) -> List[str]:
    """Recent recorded build ids when enabled, else an empty list. Never raises."""
    if not is_enabled():
        return []
    return _service.recent_build_ids(limit)


__all__ = [
    "is_enabled", "get_design_trace", "recent_build_ids",
    "DebugTraceResponse", "DecisionSummary",
]
