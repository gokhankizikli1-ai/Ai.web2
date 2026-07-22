# coding: utf-8
"""
Design Debug — the debug response model.

The sanitized, developer-facing shape returned by the debug endpoint. It exposes ONLY
non-sensitive, whitelisted design-decision fields — never a raw prompt, personal data,
API keys, or internal scoring. Pure and serializable.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List


@dataclass
class DecisionSummary:
    industry: str = ""
    selected_direction: str = ""
    reasons: List[str] = field(default_factory=list)
    avoided_patterns: List[str] = field(default_factory=list)
    contributing_layers: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "industry": self.industry,
            "selected_direction": self.selected_direction,
            "reasons": list(self.reasons),
            "avoided_patterns": list(self.avoided_patterns),
            "contributing_layers": list(self.contributing_layers),
        }


@dataclass
class DebugTraceResponse:
    build_id: str = ""
    decision_summary: DecisionSummary = field(default_factory=DecisionSummary)
    priority_order: str = ""
    confidence: float = 0.0
    user_override: bool = False
    timestamp: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "build_id": self.build_id,
            "decision_summary": self.decision_summary.to_dict(),
            "priority_order": self.priority_order,
            "confidence": round(float(self.confidence), 3),
            "user_override": bool(self.user_override),
            "timestamp": self.timestamp,
        }


__all__ = ["DecisionSummary", "DebugTraceResponse"]
