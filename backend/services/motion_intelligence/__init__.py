# coding: utf-8
"""
Motion Intelligence — decide HOW a website should MOVE.

Visual Intelligence decides what the brand should feel like; this layer decides how
that feeling moves — energy, animation character, and the concrete hero / section /
interaction / transition behaviours. Not every site should move the same way, and some
should barely move at all. It CONSUMES a Visual Strategy and produces a typed
:class:`~backend.services.motion_intelligence.models.MotionStrategy` — nothing else. It
never creates React/CSS/animation-library code; later PRs consume the strategy.

Feature flag (default OFF → today's behaviour is completely unchanged):

    ENABLE_MOTION_INTELLIGENCE=false

Consuming the seam (what future PRs call):

    from backend.services import motion_intelligence as mi
    motion = mi.build_motion_strategy(visual_strategy)   # None when the flag is off

    # Or compute unconditionally (e.g. for diagnostics), ignoring the flag:
    motion = mi.analyze(visual_strategy)

Public API:
    is_enabled()                  — is the layer turned on?
    analyze(visual)               — always compute a MotionStrategy (flag-independent)
    build_motion_strategy(visual) — flag-gated: a MotionStrategy, or None when disabled
    MotionStrategy + enums + MotionContext + analyzer registry
"""
from __future__ import annotations

import os
from typing import Any, Optional

from backend.services.motion_intelligence.analyzer import (
    MotionAnalyzer, MotionContext, DeterministicMotionAnalyzer,
    analyze, get_analyzer, register_analyzer,
)
from backend.services.motion_intelligence.models import (
    AnimationStyle, HeroBehavior, InteractionStyle, MotionIntensity,
    MotionStrategy, SectionBehavior, TransitionStyle,
)


def is_enabled() -> bool:
    """True only when ``ENABLE_MOTION_INTELLIGENCE`` is explicitly ``"true"``."""
    return (os.getenv("ENABLE_MOTION_INTELLIGENCE", "false") or "").strip().lower() == "true"


def build_motion_strategy(visual_strategy: Any, analyzer_name: Optional[str] = None) -> Optional[MotionStrategy]:
    """The flag-gated seam. Returns a :class:`MotionStrategy` when the layer is enabled,
    else ``None`` so callers keep their current behaviour with a plain
    ``if motion is not None`` check. Never raises."""
    if not is_enabled():
        return None
    return analyze(visual_strategy, analyzer_name)


__all__ = [
    "is_enabled", "build_motion_strategy", "analyze",
    "MotionStrategy", "MotionIntensity", "AnimationStyle",
    "HeroBehavior", "SectionBehavior", "InteractionStyle", "TransitionStyle",
    "MotionContext", "MotionAnalyzer", "DeterministicMotionAnalyzer",
    "get_analyzer", "register_analyzer",
]
