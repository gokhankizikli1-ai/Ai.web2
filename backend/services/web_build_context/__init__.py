# coding: utf-8
"""
Web Build context — attach Design Intelligence to generation.

This is the small ADAPTER that connects the isolated intelligence foundations to Web
Build generation. When enabled, it derives a Visual Strategy and a Motion Strategy from
the request and renders a compact ``DESIGN INTELLIGENCE`` block that the website-
generating model receives ALONGSIDE its existing prompt — so the generated site
understands how the brand should feel, what visual language to use, and how motion
should behave.

Feature flag (default OFF → generation is byte-for-byte unchanged):

    ENABLE_VISUAL_CONTEXT_INJECTION=false

Design constraints honoured here:
  • the block is text, never raw JSON, and never exposes internal fields or flags;
  • empty sections are omitted; the block is bounded (< ~500 extra tokens);
  • the original user prompt is never duplicated into it;
  • every path is fail-open — any failure (or the flag off) yields ``""`` so the caller
    appends nothing and behaviour is exactly as before.

The single master switch is this module's flag; it computes the strategies directly
(via each layer's flag-independent ``analyze``) so the integration works without also
flipping the foundation flags.
"""
from __future__ import annotations

import logging
import os
from typing import Any, Dict, Optional

from backend.services import motion_intelligence, visual_intelligence
from backend.services.web_build_context.formatter import build_design_context

logger = logging.getLogger(__name__)

_MAX_REQUEST = 2000
# Optional structured signals the caller may already have (e.g. on a blueprint).
_CONTEXT_KEYS = (
    "industry", "sector", "subsector", "audience", "targetAudience", "target_audience",
    "brand_style", "brandStyle", "emotional_tone", "emotionalTone", "image_style", "imageStyle",
)


def is_enabled() -> bool:
    """True only when ``ENABLE_VISUAL_CONTEXT_INJECTION`` is explicitly ``"true"``."""
    return (os.getenv("ENABLE_VISUAL_CONTEXT_INJECTION", "false") or "").strip().lower() == "true"


def _signal(user_request: str, context: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    signal: Dict[str, Any] = {"prompt": (user_request or "")[:_MAX_REQUEST]}
    if isinstance(context, dict):
        for key in _CONTEXT_KEYS:
            value = context.get(key)
            if isinstance(value, str) and value.strip():
                signal[key] = value.strip()[:200]
    return signal


def build_web_build_design_context(
    user_request: str, context: Optional[Dict[str, Any]] = None,
) -> str:
    """The flag-gated seam. Returns the compact DESIGN INTELLIGENCE block to append to
    the generation prompt, or ``""`` when the flag is off / there is no usable signal /
    anything fails. Never raises.

    ``context`` is an OPTIONAL dict of already-known signals (industry, audience, brand
    style…) such as a run's blueprint; absent, the block is derived from the request."""
    if not is_enabled():
        return ""
    # No signal at all → inject nothing (avoid a generic block on an empty request).
    if not (user_request or "").strip() and not context:
        return ""
    try:
        visual = visual_intelligence.analyze(_signal(user_request, context))
        motion = motion_intelligence.analyze(visual)
        return build_design_context(visual, motion)
    except Exception as exc:  # noqa: BLE001 — injection must never break a generation run
        logger.debug("[WB_CTX] design context build soft-failed: %s", type(exc).__name__)
        return ""


__all__ = ["is_enabled", "build_web_build_design_context", "build_design_context"]
