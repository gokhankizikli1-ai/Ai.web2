# coding: utf-8
"""
Generation Adaptation — turn design intelligence into actionable generation rules.

The intelligence layers already decide how a site should feel, move and read, but the
code-generation model has too much freedom and may ignore those decisions. This small
ADAPTER consumes the existing intelligence OUTPUTS (design personality, Visual Strategy,
Motion Strategy, Quality Guidelines) and reshapes them into ONE compact, actionable
``DESIGN GENERATION RULES`` block — so the model first understands *what kind of website
to create* before *how to write the code*, and the result feels intentionally designed
for the business rather than a generic AI template.

It creates NO new intelligence and duplicates NO analysis — it only translates. It is
gated by its own flag and is fail-open: any failure (or missing intelligence) yields
``""`` so generation continues normally.

Feature flag (default OFF → existing behaviour is byte-for-byte unchanged):

    ENABLE_GENERATION_ADAPTATION=false

Public API:
    is_enabled()                          — is the layer turned on?
    build_generation_rules(request, ctx)  — the compact rules block, or "" (flag-gated)
"""
from __future__ import annotations

import logging
import os
from typing import Any, Dict, Optional

from backend.services.generation_adaptation.translator import translate

logger = logging.getLogger(__name__)

_MAX_REQUEST = 2000
_SIGNAL_KEYS = (
    "industry", "sector", "subsector", "audience", "targetAudience", "target_audience",
    "brand_style", "brandStyle", "emotional_tone", "emotionalTone", "image_style", "imageStyle",
)
_INDUSTRY_KEYS = ("industry", "sector", "subsector", "siteType", "site_type")


def is_enabled() -> bool:
    """True only when ``ENABLE_GENERATION_ADAPTATION`` is explicitly ``"true"``."""
    return (os.getenv("ENABLE_GENERATION_ADAPTATION", "false") or "").strip().lower() == "true"


def _signal(user_request: str, context: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    signal: Dict[str, Any] = {"prompt": (user_request or "")[:_MAX_REQUEST]}
    if isinstance(context, dict):
        for key in _SIGNAL_KEYS:
            value = context.get(key)
            if isinstance(value, str) and value.strip():
                signal[key] = value.strip()[:200]
    return signal


def _industry(context: Optional[Dict[str, Any]]) -> str:
    if isinstance(context, dict):
        for key in _INDUSTRY_KEYS:
            value = context.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()[:200]
    return ""


def build_generation_rules(user_request: str, context: Optional[Dict[str, Any]] = None) -> str:
    """Consume the existing intelligence outputs and translate them into the compact
    ``DESIGN GENERATION RULES`` block. Returns ``""`` when the flag is off, when there is
    no usable signal, or on any failure — so generation continues normally. Never raises.

    The intelligence is read via each layer's flag-INDEPENDENT ``analyze``/guidelines
    functions (this layer's own flag governs whether the rules are produced at all)."""
    if not is_enabled():
        return ""
    if not (user_request or "").strip() and not context:
        return ""
    try:
        # Lazy imports — only when enabled — so this adapter carries no import-time
        # dependency on the intelligence packages and cannot create a cycle.
        from backend.services import (
            design_personality, motion_intelligence, visual_intelligence, web_quality_guard,
        )

        signal = _signal(user_request, context)
        source: Dict[str, Any] = dict(context) if isinstance(context, dict) else {}
        source["prompt"] = (user_request or "")[:_MAX_REQUEST]

        personality = design_personality.analyze(source)
        visual = visual_intelligence.analyze(signal)
        motion = motion_intelligence.analyze(visual)
        quality = web_quality_guard.build_quality_guidelines(
            {"prompt": signal["prompt"], "industry": _industry(context)}
        )
        return translate(personality, visual, motion, quality)
    except Exception as exc:  # noqa: BLE001 — this layer must never break a generation run
        logger.debug("[GEN_ADAPT] generation rules build soft-failed: %s", type(exc).__name__)
        return ""


__all__ = ["is_enabled", "build_generation_rules"]
