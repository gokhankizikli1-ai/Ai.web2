# coding: utf-8
"""
Design Personality Intelligence — the analyzer abstraction.

Turns a request (a free prompt and/or known fields) into a
:class:`DesignPersonalityProfile`. Like the sibling intelligence layers it is an
ABSTRACTION: :class:`PersonalityAnalyzer` is the contract and
:class:`DeterministicPersonalityAnalyzer` is today's implementation; a future
AI-reasoning analyzer registers under the same contract with no caller change.

Deterministic, bounded and total — it never raises and always returns a usable profile
(the neutral, approachable-professional default when the request says nothing).

Independent: imports only stdlib + its own package. No frontend, billing, renderer, or
other intelligence layers, so there is no coupling and no cycle.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Protocol, runtime_checkable

from backend.services.design_personality.models import DesignPersonalityProfile
from backend.services.design_personality import signals

_MAX_TEXT = 2000

# Fields (any subset) a caller may already know; industry/audience are weighted highest.
_INDUSTRY_KEYS = ("industry", "sector", "subsector", "siteType", "site_type",
                  "audience", "targetAudience", "target_audience")
_TEXT_KEYS = ("prompt", "request", "description", "brand_style", "brandStyle",
              "emotional_tone", "emotionalTone", "tone")


@dataclass
class PersonalityContext:
    """Normalized request signal for the analyzer."""

    prompt: str = ""
    industry: str = ""

    def full_text(self) -> str:
        return " ".join(p for p in (self.industry, self.prompt) if p).strip().lower()[:_MAX_TEXT]

    @classmethod
    def from_source(cls, source: Any) -> "PersonalityContext":
        if source is None:
            return cls()
        if isinstance(source, str):
            return cls(prompt=source.strip()[:_MAX_TEXT])
        if isinstance(source, dict):
            industry = ""
            for key in _INDUSTRY_KEYS:
                value = source.get(key)
                if isinstance(value, str) and value.strip():
                    industry = value.strip()[:200]
                    break
            parts: List[str] = []
            for key in _TEXT_KEYS:
                value = source.get(key)
                if isinstance(value, str) and value.strip():
                    parts.append(value.strip())
            return cls(prompt=" ".join(parts)[:_MAX_TEXT], industry=industry)
        # Duck-typed object — read the common attributes if present.
        prompt = str(getattr(source, "prompt", "") or getattr(source, "request", "") or "")
        industry = str(getattr(source, "industry", "") or "")
        return cls(prompt=prompt.strip()[:_MAX_TEXT], industry=industry.strip()[:200])


@runtime_checkable
class PersonalityAnalyzer(Protocol):
    """The analyzer contract — request context → design personality profile."""

    name: str

    def analyze(self, context: PersonalityContext) -> DesignPersonalityProfile:
        ...


class DeterministicPersonalityAnalyzer:
    """Weighted-signal analyzer: resolve the best-supported personality, then read its
    directions from the library. Never mutates the shared definitions."""

    name = "deterministic"

    def analyze(self, context: PersonalityContext) -> DesignPersonalityProfile:
        defn, confidence, hits = signals.resolve(context.full_text(), context.industry)
        return DesignPersonalityProfile(
            design_personality=defn.key,
            visual_direction=defn.visual_direction,
            motion_direction=defn.motion_direction,
            avoid_list=list(defn.avoid_list),
            confidence=confidence,
            matched_signals=hits,
            source=self.name,
        )


# ── Registry (the extension seam for a future AI analyzer) ─────────────────────

_ANALYZERS: Dict[str, PersonalityAnalyzer] = {}
_DEFAULT = "deterministic"


def register_analyzer(analyzer: PersonalityAnalyzer) -> None:
    _ANALYZERS[analyzer.name] = analyzer


def get_analyzer(name: Optional[str] = None) -> PersonalityAnalyzer:
    if not _ANALYZERS:
        register_analyzer(DeterministicPersonalityAnalyzer())
    return _ANALYZERS.get(name or _DEFAULT, _ANALYZERS[_DEFAULT])


register_analyzer(DeterministicPersonalityAnalyzer())


def analyze(source: Any, analyzer_name: Optional[str] = None) -> DesignPersonalityProfile:
    """Infer a :class:`DesignPersonalityProfile` from a prompt string / context dict /
    duck-typed object. Never raises — any failure yields the neutral default profile."""
    try:
        return get_analyzer(analyzer_name).analyze(PersonalityContext.from_source(source))
    except Exception:  # noqa: BLE001 — inference must never break a caller
        return DeterministicPersonalityAnalyzer().analyze(PersonalityContext())


__all__ = [
    "PersonalityContext", "PersonalityAnalyzer", "DeterministicPersonalityAnalyzer",
    "analyze", "get_analyzer", "register_analyzer",
]
