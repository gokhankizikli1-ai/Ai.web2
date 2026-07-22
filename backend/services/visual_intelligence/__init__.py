# coding: utf-8
"""
Visual Intelligence — decide HOW a generated website should FEEL.

The Web Builder understands WHAT to build; this layer adds the missing understanding a
human designer brings: business type, audience, desired emotional response, brand
personality, and the resulting visual / motion / image direction. It produces a typed
:class:`~backend.services.visual_intelligence.models.VisualStrategy` and nothing else —
this foundation creates intelligence/context only. It never touches the generation
pipeline, the existing Image Intelligence layer, providers, billing or the UI; later
PRs consume the strategy.

Feature flag (default OFF → today's behaviour is completely unchanged):

    ENABLE_VISUAL_INTELLIGENCE=false

Consuming the seam (what future PRs call):

    from backend.services import visual_intelligence as vi
    strategy = vi.build_visual_strategy(design_intent_or_context)  # None when the flag is off

    # Or compute unconditionally (e.g. for diagnostics), ignoring the flag:
    strategy = vi.analyze(design_intent_or_context)

Public API:
    is_enabled()                 — is the layer turned on?
    analyze(source)              — always compute a VisualStrategy (flag-independent)
    build_visual_strategy(src)   — flag-gated: a VisualStrategy, or None when disabled
    VisualStrategy / MotionStrategy / ImageStrategy / VisualContext + analyzer registry
"""
from __future__ import annotations

import os
from typing import Any, Optional

from backend.services.visual_intelligence.analyzer import (
    VisualAnalyzer, VisualContext, DeterministicVisualAnalyzer,
    analyze, get_analyzer, register_analyzer,
)
from backend.services.visual_intelligence.models import (
    ImageStrategy, MotionIntensity, MotionStrategy, RealismLevel, VisualStrategy,
)


def is_enabled() -> bool:
    """True only when ``ENABLE_VISUAL_INTELLIGENCE`` is explicitly ``"true"``."""
    return (os.getenv("ENABLE_VISUAL_INTELLIGENCE", "false") or "").strip().lower() == "true"


def build_visual_strategy(source: Any, analyzer_name: Optional[str] = None) -> Optional[VisualStrategy]:
    """The flag-gated seam. Returns a :class:`VisualStrategy` when the layer is enabled,
    else ``None`` so callers keep their current behaviour with a plain
    ``if strategy is not None`` check. Never raises."""
    if not is_enabled():
        return None
    return analyze(source, analyzer_name)


__all__ = [
    "is_enabled", "build_visual_strategy", "analyze",
    "VisualStrategy", "MotionStrategy", "ImageStrategy",
    "RealismLevel", "MotionIntensity",
    "VisualContext", "VisualAnalyzer", "DeterministicVisualAnalyzer",
    "get_analyzer", "register_analyzer",
]
