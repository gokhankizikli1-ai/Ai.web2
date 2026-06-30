# coding: utf-8
"""
Workspace registry — the plugin seam.

Each workspace contributes ONE `WorkspaceProfile` describing how to detect
it (classification signals) and what its blueprint defaults are. The
classifier, intent parser, blueprint builder and agent planner all read the
registry — so adding a NEW workspace is purely additive: drop a module under
`workspaces/`, register a profile, done. No switch statements, no edits to
existing code (Open/Closed Principle).
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Dict, List, Tuple

from backend.services.product_intelligence.types import (
    WorkspaceKind, ProductCategory, GenerationMode, InteractionStyle,
)


@dataclass
class WorkspaceProfile:
    """Everything the engine needs to recognise a workspace and seed a
    blueprint for it. Pure data + precompiled signals — no behaviour that
    couples to a renderer."""
    kind: WorkspaceKind
    title: str
    # ── Classification signals ────────────────────────────────────────────
    # keyword → weight. Matching is word-boundary, case-insensitive.
    keywords: Dict[str, float] = field(default_factory=dict)
    # (regex, weight) for richer phrases.
    patterns: List[Tuple[str, float]] = field(default_factory=list)
    # ── Defaults the intent parser / blueprint builder seed from ──────────
    default_category: ProductCategory = ProductCategory.OTHER
    default_renderer: str = "none"
    default_generation_mode: GenerationMode = GenerationMode.DOCUMENT
    default_interaction: InteractionStyle = InteractionStyle.STATIC
    typical_industry: str = "general"
    typical_audience: str = "general users"
    typical_goal: str = ""
    # Agent ids (planning only). Order = suggested execution order.
    base_agents: List[str] = field(default_factory=list)
    # ── Blueprint contributions (deterministic templates) ─────────────────
    feature_hints: List[str] = field(default_factory=list)
    screen_hints: List[str] = field(default_factory=list)
    information_architecture: List[str] = field(default_factory=list)
    interaction_model: str = ""
    data_entities: List[str] = field(default_factory=list)
    ux_direction: str = ""
    visual_direction: str = ""
    risks: List[str] = field(default_factory=list)
    success_metrics: List[str] = field(default_factory=list)
    deliverables: List[str] = field(default_factory=list)
    future_expansion: List[str] = field(default_factory=list)

    # Precompiled patterns (filled lazily).
    _compiled: List[Tuple["re.Pattern[str]", float]] = field(default_factory=list, repr=False)

    def compiled_patterns(self) -> List[Tuple["re.Pattern[str]", float]]:
        if not self._compiled and self.patterns:
            self._compiled = [(re.compile(p, re.IGNORECASE), w) for p, w in self.patterns]
        return self._compiled


# ── Registry ──────────────────────────────────────────────────────────────

_REGISTRY: Dict[WorkspaceKind, WorkspaceProfile] = {}


def register_workspace(profile: WorkspaceProfile) -> None:
    """Idempotent registration. Last registration for a kind wins (lets a
    deployment override a built-in profile without editing it)."""
    _REGISTRY[profile.kind] = profile


def get_workspace(kind: WorkspaceKind) -> WorkspaceProfile | None:
    return _REGISTRY.get(kind)


def all_workspaces() -> List[WorkspaceProfile]:
    return list(_REGISTRY.values())


def registered_kinds() -> List[WorkspaceKind]:
    return list(_REGISTRY.keys())


def _reset_for_tests() -> None:  # pragma: no cover — test hook
    _REGISTRY.clear()


__all__ = [
    "WorkspaceProfile", "register_workspace", "get_workspace",
    "all_workspaces", "registered_kinds",
]
