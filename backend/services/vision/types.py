# coding: utf-8
"""Phase 8 — Vision analysis typed payloads."""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Any, Optional


@dataclass
class AnalysisResult:
    """Structured analysis output. Every field is optional except
    `asset_id` + `detected_type` — the foundation returns what it
    actually knows (no hallucinated content) so downstream prompts
    aren't poisoned by stub data."""
    asset_id:         str
    detected_type:    str                              # mirrors AssetRecord.asset_type
    summary:          Optional[str] = None             # one-paragraph human-readable
    extracted_text:   Optional[str] = None             # PDF / document text
    design_notes:     Optional[str] = None             # image-specific
    colors:           Optional[list[str]] = None       # ["#1a1a2e", ...]
    typography:       Optional[list[str]] = None       # ["sans-serif", "Inter-like", ...]
    layout_structure: Optional[list[str]] = None       # ["hero", "feature-grid-3", ...]
    warnings:         Optional[list[str]] = None       # e.g. ["video frame extraction not supported"]
    metadata:         dict = field(default_factory=dict)
    created_at:       str = ""

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        # Drop None / empty optional lists so the payload stays tight.
        return {k: v for k, v in d.items() if v not in (None, [], {})}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


__all__ = ["AnalysisResult", "_now"]
