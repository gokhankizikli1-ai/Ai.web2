# coding: utf-8
"""
Design Observability — read-only trace of AI design decisions for Web Build.

Multiple intelligence layers now influence generation, but there is no visibility into
WHY a design direction was chosen. This layer records a compact, read-only
:class:`DesignDecisionTrace` — which layers contributed, the selected direction, the
strongest reasons, what was avoided, and whether the user overrode the defaults — so the
decision can be understood and debugged.

It is metadata ONLY: it never changes generation output, prompts, or the frontend, stores
no raw user prompt or sensitive content, and is fail-open. It is gated by its own flag and
default OFF, so existing builds behave exactly the same.

Feature flag (default OFF):

    ENABLE_DESIGN_OBSERVABILITY=false

Public API:
    is_enabled()                       — is observability turned on?
    build_decision_trace(request, ctx) — the trace, or None when disabled (flag-gated)
    format_trace(trace)                — compact human-readable summary
    observe(request, ctx)              — build + log the summary (flag-gated, log-only)
"""
from __future__ import annotations

import logging
import os
from typing import Any, Dict, Optional

from backend.services.design_observability import store
from backend.services.design_observability.formatter import format_trace
from backend.services.design_observability.models import DesignDecisionTrace
from backend.services.design_observability.tracker import build_trace

logger = logging.getLogger(__name__)


def is_enabled() -> bool:
    """True only when ``ENABLE_DESIGN_OBSERVABILITY`` is explicitly ``"true"``."""
    return (os.getenv("ENABLE_DESIGN_OBSERVABILITY", "false") or "").strip().lower() == "true"


def build_decision_trace(
    user_request: str, context: Optional[Dict[str, Any]] = None,
) -> Optional[DesignDecisionTrace]:
    """Return the read-only :class:`DesignDecisionTrace` when observability is enabled,
    else ``None``. Never raises."""
    if not is_enabled():
        return None
    try:
        return build_trace(user_request, context)
    except Exception as exc:  # noqa: BLE001 — observability must never break anything
        logger.debug("[DES_OBS] trace build soft-failed: %s", type(exc).__name__)
        return None


def observe(user_request: str, context: Optional[Dict[str, Any]] = None,
            build_id: Optional[str] = None) -> None:
    """Build the trace, LOG its compact summary, and (when ``build_id`` is given) RECORD it
    in the in-memory store so a debug tool can look it up later — read-only, log/store-only,
    fail-open, and a strict no-op when the flag is off. It NEVER returns anything into or
    otherwise affects the generation path; it exists purely to make decisions observable."""
    if not is_enabled():
        return
    try:
        trace = build_trace(user_request, context)
        summary = format_trace(trace)
        if summary:
            logger.info("[DES_OBS]\n%s", summary)
        if build_id:
            store.record_trace(build_id, trace)
    except Exception as exc:  # noqa: BLE001
        logger.debug("[DES_OBS] observe soft-failed: %s", type(exc).__name__)


# Re-export the store surface a debug tool consumes (read-only lookup of recorded traces).
get_record = store.get_record
recent_ids = store.recent_ids


__all__ = [
    "is_enabled", "build_decision_trace", "observe", "format_trace", "DesignDecisionTrace",
    "get_record", "recent_ids",
]
