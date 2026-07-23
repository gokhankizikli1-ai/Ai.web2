# coding: utf-8
"""
Web Build Path Audit — typed models.

A STATIC, explicit architecture capability map: which intelligence decisions actually
reach each stage of the real Web Build production path. It is documentation-as-data,
derived from the call graph — it holds ONLY references (file paths, symbol names) and
short notes, never raw prompts, source code, secrets, or user data.

Pure, serializable value objects.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List


class CapabilityStatus(str, Enum):
    """Whether a capability reaches a given stage."""

    APPLIED = "applied"                # wired to this stage
    INDIRECT = "indirect"             # reaches it only via a derived artifact
    MISSING = "missing"               # not wired to this stage
    UNKNOWN = "unknown"
    DISABLED = "disabled"             # wired but off by its flag's default
    NOT_APPLICABLE = "not_applicable"


class GapSeverity(str, Enum):
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


_VALID_STATUSES = frozenset(s.value for s in CapabilityStatus)
_VALID_SEVERITIES = frozenset(s.value for s in GapSeverity)


@dataclass
class Capability:
    """One intelligence/feature and whether it reaches a stage, with call-graph evidence."""

    name: str
    status: CapabilityStatus = CapabilityStatus.UNKNOWN
    source_file: str = ""
    source_symbol: str = ""
    note: str = ""

    def to_dict(self) -> Dict[str, Any]:
        d: Dict[str, Any] = {"name": self.name, "status": self.status.value}
        if self.source_file:
            d["source_file"] = self.source_file
        if self.source_symbol:
            d["source_symbol"] = self.source_symbol
        if self.note:
            d["note"] = self.note
        return d


@dataclass
class Stage:
    """A stage of the production path (planning, generation, sourcing, …)."""

    name: str
    mode: str = ""                    # AI mode / job kind / endpoint
    entry: str = ""                   # where the stage is invoked from
    capabilities: List[Capability] = field(default_factory=list)
    facts: Dict[str, Any] = field(default_factory=dict)  # small scalar facts (limits, booleans)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "mode": self.mode,
            "entry": self.entry,
            "capabilities": [c.to_dict() for c in self.capabilities],
            "facts": dict(self.facts),
        }


@dataclass
class Gap:
    """An evidence-backed architecture gap."""

    code: str
    severity: GapSeverity
    description: str
    evidence: str = ""                # file:symbol reference proving it

    def to_dict(self) -> Dict[str, Any]:
        return {
            "code": self.code,
            "severity": self.severity.value,
            "description": self.description,
            "evidence": self.evidence,
        }


@dataclass
class WebBuildPathAudit:
    """The full static audit."""

    version: str
    entry_path: str
    generated_from: str               # "static-call-graph"
    stages: List[Stage] = field(default_factory=list)
    flags: List[Dict[str, Any]] = field(default_factory=list)
    gaps: List[Gap] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "version": self.version,
            "entry_path": self.entry_path,
            "generated_from": self.generated_from,
            "stages": [s.to_dict() for s in self.stages],
            "flags": [dict(f) for f in self.flags],
            "gaps": [g.to_dict() for g in self.gaps],
        }


__all__ = [
    "CapabilityStatus", "GapSeverity", "Capability", "Stage", "Gap", "WebBuildPathAudit",
    "_VALID_STATUSES", "_VALID_SEVERITIES",
]
