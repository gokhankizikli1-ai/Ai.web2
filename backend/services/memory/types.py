# coding: utf-8
# Phase M1 — Memory service typed payloads.
#
# Pure dataclasses, zero runtime dependencies. These types are the contract
# every layer (client / store / short_term / future agent) speaks. Adding new
# fields here is the only place the schema should evolve.
from dataclasses import dataclass, field, asdict
from datetime import datetime
from typing import Any, Optional


# ── Memory kinds ─────────────────────────────────────────────────────────────
#
# Phase M1: only "fact" / "style" / "preference" / "auto" categories actually
# flow through the legacy store. The wider taxonomy is declared NOW so M2/M3
# can land typed sub-stores (theses, summaries, artifacts) without a schema
# rewrite of the public types.
MEMORY_KINDS = (
    "fact",              # generic user-asserted fact
    "preference",        # explicit user preference (e.g. "I prefer formal tone")
    "style",             # stored style key (short/detailed/bullet/formal/...)
    "summary",           # rolling thread summary (Phase M4)
    "thesis",            # trading / decision thesis (Phase 5.1 store moves here)
    "artifact_ref",      # pointer to a file / brief / document (Phase W4)
    "behavior_pattern",  # detected user behavior (Phase 6+ journal)
    "auto",              # auto-extracted by `auto_learn`
    "general",           # legacy default
)


# ── Style ────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class StyleDef:
    """Stored style preference. Mirrors the legacy memory.py shape."""
    key:         str = "default"
    label:       str = "Standard"
    instruction: str = "Reply naturally, clearly and helpfully."

    def as_prompt(self) -> str:
        return f"Reply style: {self.label}. Instruction: {self.instruction}"

    def to_dict(self) -> dict:
        return asdict(self)


_DEFAULT_STYLE = StyleDef()


# ── Memory item ──────────────────────────────────────────────────────────────

@dataclass
class MemoryItem:
    """
    A single durable memory entry. `workspace_id` is accepted from day 1 to
    keep M1 callers binary-compatible with the M2 schema migration — until
    M2 lands the value is ignored and persisted memory is per-user-only.
    """
    user_id:      str
    content:      str
    kind:         str = "fact"
    workspace_id: Optional[str] = None     # multi-workspace future-proof (M2+)
    source:       Optional[str] = None     # e.g. "auto", "user", "thread:<id>"
    created_at:   Optional[str] = None     # ISO-8601 UTC
    metadata:     dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        d = asdict(self)
        # match the legacy /memory endpoint shape: category/content/created_at
        d["category"] = self.kind
        return d


# ── Short-term window message ────────────────────────────────────────────────

@dataclass
class WindowMessage:
    """One message inside a short-term conversation window."""
    role:       str                                                      # "user" | "assistant" | "system" | "tool"
    content:    str
    created_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())
    metadata:   dict = field(default_factory=dict)


# ── Helpers ──────────────────────────────────────────────────────────────────

def normalize_kind(kind: Optional[str]) -> str:
    """Coerce unknown kinds to 'general' so we never crash on input."""
    if not kind:
        return "general"
    k = kind.lower().strip()
    if k in MEMORY_KINDS:
        return k
    return "general"


__all__ = [
    "MEMORY_KINDS",
    "StyleDef",
    "MemoryItem",
    "WindowMessage",
    "normalize_kind",
    "_DEFAULT_STYLE",
]
