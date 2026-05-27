# coding: utf-8
"""Phase 8 — Website recreation typed payload."""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Any, Optional


@dataclass
class RecreationResult:
    asset_id:                       str
    page_type:                      str = "landing"     # landing / dashboard / docs / etc
    sections:                       list[str]      = field(default_factory=list)
    layout_structure:               list[str]      = field(default_factory=list)
    color_palette:                  list[str]      = field(default_factory=list)
    typography_notes:               list[str]      = field(default_factory=list)
    component_plan:                 list[dict]     = field(default_factory=list)
    responsive_notes:               list[str]      = field(default_factory=list)
    recommended_tech_stack:         list[str]      = field(default_factory=list)
    generated_prompt_for_frontend_agent: str       = ""
    warnings:                       list[str]      = field(default_factory=list)
    metadata:                       dict           = field(default_factory=dict)
    created_at:                     str            = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


__all__ = ["RecreationResult"]
