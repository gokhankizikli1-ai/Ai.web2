# coding: utf-8
"""
Web Quality Guard — compact quality principles for Web Build generation.

Even with good design context, generation can still drift into generic, template-like
sites. This layer supplies a small, model-facing set of DESIGN-quality principles —
"what makes this website feel professionally designed?" — that can be attached to the
Web Build context so the model aims for hierarchy, restraint, trust and conversion
clarity instead of a wall of identical cards.

It creates guidance ONLY — no renderer, no frontend, no generation changes here; a later
PR attaches the block. It is independent (imports only stdlib + its own package) and
pluggable, so a future AI-based quality evaluator can replace the rule-based guide.

Feature flag (default OFF → generation behaviour is completely unchanged):

    ENABLE_WEB_QUALITY_GUARD=false

Consuming the seam (what a future PR calls):

    from backend.services import web_quality_guard as wqg
    block = wqg.build_quality_context({"industry": "saas", "prompt": "..."})  # "" when off

    # Or compute unconditionally (diagnostics), ignoring the flag:
    guidelines = wqg.build_quality_guidelines({"industry": "restaurant"})

Public API:
    is_enabled()                 — is the guard turned on?
    build_quality_context(ctx)   — flag-gated: the compact block, or "" when disabled
    build_quality_guidelines(ctx)— always compute typed QualityGuidelines (flag-independent)
    QualityGuidelines + guide registry
"""
from __future__ import annotations

import logging
import os
from typing import Any, Dict, Optional, Protocol, runtime_checkable

from backend.services.web_quality_guard.formatter import format_guidelines
from backend.services.web_quality_guard.models import QualityGuidelines
from backend.services.web_quality_guard import rules

logger = logging.getLogger(__name__)


def is_enabled() -> bool:
    """True only when ``ENABLE_WEB_QUALITY_GUARD`` is explicitly ``"true"``."""
    return (os.getenv("ENABLE_WEB_QUALITY_GUARD", "false") or "").strip().lower() == "true"


@runtime_checkable
class QualityGuide(Protocol):
    """The guide contract — any implementation (rule-based today, AI-evaluated later)
    that produces :class:`QualityGuidelines` from a request context satisfies it."""

    name: str

    def guidelines(self, context: Dict[str, Any]) -> QualityGuidelines:
        ...


class RuleBasedQualityGuide:
    """Deterministic guide: universal base principles + category refinements."""

    name = "rule_based"

    def guidelines(self, context: Dict[str, Any]) -> QualityGuidelines:
        return rules.resolve_guidelines(context if isinstance(context, dict) else {})


_GUIDES: Dict[str, QualityGuide] = {}
_DEFAULT = "rule_based"


def register_guide(guide: QualityGuide) -> None:
    _GUIDES[guide.name] = guide


def get_guide(name: Optional[str] = None) -> QualityGuide:
    if not _GUIDES:
        register_guide(RuleBasedQualityGuide())
    return _GUIDES.get(name or _DEFAULT, _GUIDES[_DEFAULT])


register_guide(RuleBasedQualityGuide())


def build_quality_guidelines(context: Optional[Dict[str, Any]] = None,
                             guide_name: Optional[str] = None) -> QualityGuidelines:
    """Compute typed :class:`QualityGuidelines` for a request context (flag-independent).
    Never raises — returns a usable object (universal base) even on odd input."""
    try:
        return get_guide(guide_name).guidelines(context or {})
    except Exception as exc:  # noqa: BLE001 — guidance must never break a caller
        logger.debug("[WQG] build_quality_guidelines soft-failed: %s", type(exc).__name__)
        return rules.resolve_guidelines({})


def build_quality_context(context: Optional[Dict[str, Any]] = None,
                          guide_name: Optional[str] = None) -> str:
    """The flag-gated seam. Returns the compact QUALITY GUIDELINES block to append to
    the generation context, or ``""`` when the flag is off / anything fails. The block is
    bounded (< ~300 tokens), never JSON, never the user prompt. Never raises."""
    if not is_enabled():
        return ""
    try:
        return format_guidelines(build_quality_guidelines(context, guide_name))
    except Exception as exc:  # noqa: BLE001
        logger.debug("[WQG] build_quality_context soft-failed: %s", type(exc).__name__)
        return ""


__all__ = [
    "is_enabled", "build_quality_context", "build_quality_guidelines",
    "QualityGuidelines", "QualityGuide", "RuleBasedQualityGuide",
    "get_guide", "register_guide",
]
