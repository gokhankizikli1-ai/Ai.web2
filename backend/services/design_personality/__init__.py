# coding: utf-8
"""
Design Personality Intelligence — infer the right design personality for a request.

Instead of applying the same generic "futuristic AI" styling to everything, this layer
infers the correct DESIGN PERSONALITY from weighted contextual signals and derives its
visual direction, motion direction and avoid list. "AI" is a WEAK signal, so a real
domain overrides it: an AI banking app → trustworthy/premium, an AI toy for kids →
playful, a luxury hotel → cinematic/elegant, and a plain AI dashboard → futuristic.

It produces intelligence/context ONLY — no renderer, no frontend, no generation changes.
It is independent (imports only stdlib + its own package) and pluggable, so a future
AI-based analyzer can replace the deterministic rules.

Feature flag (default OFF → nothing changes):

    ENABLE_DESIGN_PERSONALITY=false

Consuming the seam (what a future PR calls):

    from backend.services import design_personality as dp
    profile = dp.build_design_personality({"industry": "finance", "prompt": "AI advisor"})  # None when off

    # Or compute unconditionally (diagnostics), ignoring the flag:
    profile = dp.analyze("luxury hotel in Rome")

Public API:
    is_enabled()                      — is the layer turned on?
    analyze(source)                   — always infer a profile (flag-independent)
    build_design_personality(source)  — flag-gated: a profile, or None when disabled
    DesignPersonality / DesignPersonalityProfile + analyzer registry
"""
from __future__ import annotations

import os
from typing import Any, Optional

from backend.services.design_personality.analyzer import (
    PersonalityAnalyzer, PersonalityContext, DeterministicPersonalityAnalyzer,
    analyze, get_analyzer, register_analyzer,
)
from backend.services.design_personality.models import (
    DesignPersonality, DesignPersonalityProfile,
)


def is_enabled() -> bool:
    """True only when ``ENABLE_DESIGN_PERSONALITY`` is explicitly ``"true"``."""
    return (os.getenv("ENABLE_DESIGN_PERSONALITY", "false") or "").strip().lower() == "true"


def build_design_personality(source: Any, analyzer_name: Optional[str] = None) -> Optional[DesignPersonalityProfile]:
    """The flag-gated seam. Returns a :class:`DesignPersonalityProfile` when the layer is
    enabled, else ``None`` so callers keep their current behaviour with a plain
    ``if profile is not None`` check. Never raises."""
    if not is_enabled():
        return None
    return analyze(source, analyzer_name)


__all__ = [
    "is_enabled", "build_design_personality", "analyze",
    "DesignPersonality", "DesignPersonalityProfile",
    "PersonalityContext", "PersonalityAnalyzer", "DeterministicPersonalityAnalyzer",
    "get_analyzer", "register_analyzer",
]
