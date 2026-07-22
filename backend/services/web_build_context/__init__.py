# coding: utf-8
"""
Web Build context — attach design intelligence to generation.

This is the small ADAPTER that connects the isolated intelligence foundations to Web
Build generation. It renders the compact context blocks the website-generating model
receives ALONGSIDE its existing prompt, composed from independently flag-gated parts:

  1. DESIGN INTELLIGENCE — a Visual Strategy + Motion Strategy (how the brand should
     feel, what visual language to use, how motion should behave). Gated by
     ``ENABLE_VISUAL_CONTEXT_INJECTION``.
  2. QUALITY GUIDELINES — the Web Quality Guard's design-quality principles (what makes
     the site feel professionally designed). Gated by ``ENABLE_WEB_QUALITY_GUARD``.

The two flags are independent: either part appears only when its own flag is on, and the
seam that consumes this module (the orchestrator's prompt assembly) is UNCHANGED — it
still appends the single string this returns. With both flags off the return is ``""`` so
generation is byte-for-byte unchanged.

Design constraints honoured here:
  • the blocks are text, never raw JSON, and never expose internal fields or flags;
  • empty sections are omitted; each block is bounded (design < ~500, quality < ~300);
  • the original user prompt is never duplicated into them;
  • every path is fail-open — any failure yields ``""`` for that part, so a broken layer
    can never break a generation run.
"""
from __future__ import annotations

import logging
import os
from typing import Any, Dict, List, Optional

from backend.services import motion_intelligence, visual_intelligence
from backend.services.web_build_context.formatter import build_design_context

logger = logging.getLogger(__name__)

_MAX_REQUEST = 2000
# Optional structured signals the caller may already have (e.g. on a blueprint).
_CONTEXT_KEYS = (
    "industry", "sector", "subsector", "audience", "targetAudience", "target_audience",
    "brand_style", "brandStyle", "emotional_tone", "emotionalTone", "image_style", "imageStyle",
)
_INDUSTRY_KEYS = ("industry", "sector", "subsector", "siteType", "site_type")


def is_enabled() -> bool:
    """True only when ``ENABLE_VISUAL_CONTEXT_INJECTION`` is explicitly ``"true"``.

    Governs the DESIGN INTELLIGENCE part only; the QUALITY GUIDELINES part has its own
    flag (``ENABLE_WEB_QUALITY_GUARD``) inside the Web Quality Guard."""
    return (os.getenv("ENABLE_VISUAL_CONTEXT_INJECTION", "false") or "").strip().lower() == "true"


def _signal(user_request: str, context: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    signal: Dict[str, Any] = {"prompt": (user_request or "")[:_MAX_REQUEST]}
    if isinstance(context, dict):
        for key in _CONTEXT_KEYS:
            value = context.get(key)
            if isinstance(value, str) and value.strip():
                signal[key] = value.strip()[:200]
    return signal


def _design_block(user_request: str, context: Optional[Dict[str, Any]]) -> str:
    """The DESIGN INTELLIGENCE block (Visual + Motion). ``""`` when its flag is off,
    there is no signal, or anything fails."""
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


def _quality_block(user_request: str, context: Optional[Dict[str, Any]]) -> str:
    """The QUALITY GUIDELINES block. Gated by ``ENABLE_WEB_QUALITY_GUARD`` inside the
    guard (returns ``""`` when off). Lazily imported so this module carries no import-time
    dependency on the guard and cannot create a cycle. Never raises."""
    try:
        from backend.services import web_quality_guard
        quality_ctx: Dict[str, Any] = {"prompt": (user_request or "")[:_MAX_REQUEST]}
        if isinstance(context, dict):
            for key in _INDUSTRY_KEYS:
                value = context.get(key)
                if isinstance(value, str) and value.strip():
                    quality_ctx.setdefault("industry", value.strip()[:200])
                    break
        return web_quality_guard.build_quality_context(quality_ctx)
    except Exception as exc:  # noqa: BLE001 — guidance must never break a generation run
        logger.debug("[WB_CTX] quality guidelines build soft-failed: %s", type(exc).__name__)
        return ""


def build_web_build_design_context(
    user_request: str, context: Optional[Dict[str, Any]] = None,
) -> str:
    """Compose the Web Build context block(s) to append to the generation prompt:
    the DESIGN INTELLIGENCE block and/or the QUALITY GUIDELINES block, each included only
    when its own flag is on. Returns ``""`` when both are off / produce nothing / fail, so
    the (unchanged) caller appends nothing and behaviour is exactly as before. Never raises.

    ``context`` is an OPTIONAL dict of already-known signals (industry, audience, brand
    style…) such as a run's blueprint; absent, the blocks are derived from the request."""
    parts: List[str] = []
    design = _design_block(user_request, context)
    if design:
        parts.append(design)
    quality = _quality_block(user_request, context)
    if quality:
        parts.append(quality)
    return "\n\n".join(parts)


__all__ = ["is_enabled", "build_web_build_design_context", "build_design_context"]
