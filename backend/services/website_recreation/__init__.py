# coding: utf-8
"""
Phase 8 — Website Recreation foundation.

Takes an image asset (screenshot) + optional user prompt and returns
a structured rebuild plan. The Phase 8 foundation uses ONLY
deterministic heuristics on the vision analysis output — no
hallucinated component plans. Real LLM-driven component generation
lands in a follow-up when a vision-capable provider is configured.

Output shape matches PROJECT_ROADMAP.md spec:
  page_type / sections / layout_structure / color_palette /
  typography_notes / component_plan / responsive_notes /
  recommended_tech_stack / generated_prompt_for_frontend_agent

When the analysis returns warnings (e.g. vision pipeline disabled),
we propagate them into the result so the FE can show "we analyzed
metadata only" instead of pretending we understand the design.
"""
from backend.services.website_recreation.client import (
    RecreationClient, client, is_enabled,
)
from backend.services.website_recreation.types import RecreationResult

__all__ = ["RecreationClient", "client", "is_enabled", "RecreationResult"]
