# coding: utf-8
"""
Universal Product Intelligence Engine — the public pipeline.

    text → classify → ProductIntent → ProductBlueprint → ProductPlan

This is the single entry point every future module calls before building
anything. It is renderer-independent and side-effect-free (pure planning).
"""
from __future__ import annotations

from typing import Optional

# Importing the workspaces package registers the built-in profiles.
from backend.services.product_intelligence import workspaces as _workspaces  # noqa: F401
from backend.services.product_intelligence import classifier as _classifier
from backend.services.product_intelligence.intent import parse_intent
from backend.services.product_intelligence.blueprint import build_blueprint
from backend.services.product_intelligence.types import (
    ProductIntent, ProductBlueprint, ProductPlan, WorkspaceClassification,
)


def classify(text: str) -> WorkspaceClassification:
    """Stage 1 — confidence-based, multi-intent workspace classification."""
    return _classifier.classify(text)


def understand(text: str) -> ProductIntent:
    """Stage 1–2 — natural language → structured ProductIntent."""
    return parse_intent(text)


def blueprint(intent: ProductIntent) -> ProductBlueprint:
    """Stage 3 — ProductIntent → ProductBlueprint (renderer-independent)."""
    return build_blueprint(intent)


def plan_product(text: str) -> ProductPlan:
    """Full pipeline — natural language → ProductPlan (intent + blueprint).

    This is THE function downstream modules (website builder, game dev,
    startup, research, trading, agents) call to understand what to build.
    They consume `plan.blueprint`; they never re-interpret the raw text.
    """
    intent = understand(text)
    bp = build_blueprint(intent)
    return ProductPlan(intent=intent, blueprint=bp)


__all__ = ["classify", "understand", "blueprint", "plan_product"]
