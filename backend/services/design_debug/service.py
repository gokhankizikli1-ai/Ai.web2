# coding: utf-8
"""
Design Debug — the read-only lookup service.

Consumes ONLY the existing observability output: it looks up a recorded
:class:`DesignDecisionTrace` by build id (from the observability store) and projects it
through the sanitizing formatter. It duplicates no intelligence logic, touches no
generation path, and is fail-open (returns ``None`` on anything unexpected).
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from backend.services.design_debug.formatter import build_debug_response

logger = logging.getLogger(__name__)


def get_design_trace(build_id: str) -> Optional[Dict[str, Any]]:
    """Return the sanitized debug response for ``build_id``, or ``None`` if no trace was
    recorded (or on any failure). Reads the observability store only. Never raises."""
    try:
        from backend.services import design_observability
        record = design_observability.get_record(build_id)
        if record is None:
            return None
        return build_debug_response(record).to_dict()
    except Exception as exc:  # noqa: BLE001 — a debug read must never raise
        logger.debug("[DES_DBG] get_design_trace soft-failed: %s", type(exc).__name__)
        return None


def recent_build_ids(limit: int = 20) -> List[str]:
    """Most-recently-recorded build ids (for a debug index). Never raises."""
    try:
        from backend.services import design_observability
        return design_observability.recent_ids(limit)
    except Exception as exc:  # noqa: BLE001
        logger.debug("[DES_DBG] recent_build_ids soft-failed: %s", type(exc).__name__)
        return []


__all__ = ["get_design_trace", "recent_build_ids"]
