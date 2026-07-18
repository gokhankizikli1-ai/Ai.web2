# coding: utf-8
"""
Dataclasses shared across the cost-tracking subsystem.

These are plain @dataclass wire types (no Pydantic) matching the rest of
the backend's service layer. They travel between the tracker, the store,
and the admin route.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


# operation_type vocabulary — the coarse "what was this call for" bucket.
# Kept as plain strings (not an enum) so a new call site can adopt a new
# label without a schema migration.
OP_PLANNING        = "web_build_planning"
OP_PLANNING_REPAIR = "web_build_planning_repair"
OP_COORDINATOR     = "web_build_coordinator_plan"
OP_FRONTEND_GEN    = "web_build_frontend_generation"
OP_STALE_RECOVERY  = "web_build_stale_recovery"
OP_CODEGEN         = "web_build_codegen"
OP_CODEGEN_REPAIR  = "web_build_codegen_repair"
OP_VISUAL          = "web_build_visual_plan"
OP_RESEARCH        = "web_build_research"
OP_IMAGE_GEN       = "image_generation"
OP_WEB_SEARCH      = "web_search"
OP_EMBEDDING       = "embedding"
OP_CHAT            = "chat_completion"
OP_OTHER           = "other"


# ── Canonical Web Build STAGE taxonomy (cost attribution audit) ──────────────
# A *stage* is the precise pipeline step a paid call belongs to; an *agent* is
# who ran it. Server call sites set stage+agent DIRECTLY (never inferred from a
# model name when the site already knows). Historical rows that predate these
# columns are inferred from `operation_type` at READ time (see stage_for /
# agent_for) and flagged `generic_stage_label` when the label is too coarse to
# attribute — the audit never invents agent identity.
STAGE_REQUEST_ANALYSIS        = "request_analysis"
STAGE_WEBSITE_STRATEGY        = "website_strategy"
STAGE_WEB_BUILD_PLANNING      = "web_build_planning"
STAGE_PLANNING_REPAIR         = "planning_repair"
STAGE_VISUAL_INTELLIGENCE     = "visual_intelligence"
STAGE_WEB_RESEARCH            = "web_research"
STAGE_STOCK_IMAGE_SEARCH      = "stock_image_search"
STAGE_IMAGE_GENERATION        = "image_generation"
STAGE_FRONTEND_GENERATION     = "frontend_generation"
STAGE_FRONTEND_VALIDATION     = "frontend_validation"
STAGE_FRONTEND_REPAIR         = "frontend_repair"
STAGE_FRONTEND_QUALITY_REPAIR = "frontend_quality_repair"
STAGE_REVISION                = "revision"
STAGE_FINALIZATION            = "finalization"
STAGE_STALE_RECOVERY          = "stale_recovery"
STAGE_UNKNOWN                 = "unknown"

AGENT_COORDINATOR         = "coordinator"
AGENT_WEBSITE_BUILDER     = "website_builder"
AGENT_VISUAL_INTELLIGENCE = "visual_intelligence"
AGENT_RESEARCH            = "research"
AGENT_FRONTEND_BUILDER    = "frontend_builder"
AGENT_IMAGE               = "image_generation"
AGENT_SYSTEM              = "system"
AGENT_UNKNOWN             = "unknown"

# operation_type → canonical stage, used ONLY to infer a stage for a historical
# row that has no stored `stage` (a row written before this PR). A live call site
# passes `stage` explicitly and this map is not consulted for it.
_OP_TO_STAGE = {
    OP_PLANNING:        STAGE_WEB_BUILD_PLANNING,
    OP_PLANNING_REPAIR: STAGE_PLANNING_REPAIR,
    OP_COORDINATOR:     STAGE_REQUEST_ANALYSIS,
    OP_FRONTEND_GEN:    STAGE_FRONTEND_GENERATION,
    OP_CODEGEN:         STAGE_FRONTEND_GENERATION,
    OP_CODEGEN_REPAIR:  STAGE_FRONTEND_REPAIR,
    OP_VISUAL:          STAGE_VISUAL_INTELLIGENCE,
    OP_RESEARCH:        STAGE_WEB_RESEARCH,
    OP_WEB_SEARCH:      STAGE_WEB_RESEARCH,
    OP_IMAGE_GEN:       STAGE_IMAGE_GENERATION,
    OP_STALE_RECOVERY:  STAGE_STALE_RECOVERY,
}
_OP_TO_AGENT = {
    OP_PLANNING:        AGENT_WEBSITE_BUILDER,
    OP_PLANNING_REPAIR: AGENT_WEBSITE_BUILDER,
    OP_COORDINATOR:     AGENT_COORDINATOR,
    OP_FRONTEND_GEN:    AGENT_FRONTEND_BUILDER,
    OP_CODEGEN:         AGENT_FRONTEND_BUILDER,
    OP_CODEGEN_REPAIR:  AGENT_FRONTEND_BUILDER,
    OP_VISUAL:          AGENT_VISUAL_INTELLIGENCE,
    OP_RESEARCH:        AGENT_RESEARCH,
    OP_WEB_SEARCH:      AGENT_RESEARCH,
    OP_IMAGE_GEN:       AGENT_IMAGE,
    OP_STALE_RECOVERY:  AGENT_SYSTEM,
}
# operation_type labels that are too coarse to attribute a real agent/stage.
_GENERIC_OPS = {OP_OTHER, OP_CHAT, OP_EMBEDDING, "", "tool"}


def stage_for(operation_type: Optional[str], stored_stage: Optional[str] = None) -> str:
    """Resolve a canonical stage: a stored server-set stage wins; otherwise infer
    from operation_type; otherwise STAGE_UNKNOWN (never guessed)."""
    s = (stored_stage or "").strip()
    if s:
        return s
    return _OP_TO_STAGE.get((operation_type or "").strip(), STAGE_UNKNOWN)


def agent_for(operation_type: Optional[str], stored_agent: Optional[str] = None) -> str:
    """Resolve a canonical agent: a stored server-set agent wins; otherwise infer
    from operation_type; otherwise AGENT_UNKNOWN (never invented)."""
    a = (stored_agent or "").strip()
    if a:
        return a
    return _OP_TO_AGENT.get((operation_type or "").strip(), AGENT_UNKNOWN)


def is_generic_label(operation_type: Optional[str], stored_stage: Optional[str] = None) -> bool:
    """True when a row carries no server-set stage AND its operation_type is too
    generic to attribute a real agent — surfaced as `generic_stage_label`."""
    if (stored_stage or "").strip():
        return False
    op = (operation_type or "").strip()
    return op in _GENERIC_OPS or op not in _OP_TO_STAGE


@dataclass
class TokenUsage:
    """Normalized, provider-agnostic usage block (task #3).

    Every field is server-sourced; the tracker NEVER accepts these from a
    frontend payload. `usage_missing` is set by the caller when the
    provider returned no usage object at all (task #9).
    """
    input_tokens:          int = 0
    output_tokens:         int = 0
    cached_input_tokens:   int = 0   # cache-read / cached_input_tokens
    cache_creation_tokens: int = 0   # cache-write (Anthropic prompt caching)
    reasoning_tokens:      int = 0   # informational (already inside output)
    total_tokens:          int = 0
    usage_missing:         bool = False

    def normalized_total(self) -> int:
        if self.total_tokens:
            return int(self.total_tokens)
        return int(self.input_tokens or 0) + int(self.output_tokens or 0)


@dataclass
class AICallRecord:
    """One paid call within a build (task #2 + #3). Persisted verbatim."""
    call_id:              str
    build_id:             str
    user_id:              str
    provider:             str
    model:                str
    operation_type:       str
    request_started_at:   str            # ISO-8601 UTC
    request_completed_at: Optional[str]  # ISO-8601 UTC (None while in-flight)
    success:              bool
    retry_number:         int = 0
    # Token usage
    input_tokens:          int = 0
    output_tokens:         int = 0
    cached_input_tokens:   int = 0
    cache_creation_tokens: int = 0
    reasoning_tokens:      int = 0
    total_tokens:          int = 0
    usage_missing:         bool = False
    # Cost breakdown (USD)
    input_cost_usd:            float = 0.0
    output_cost_usd:           float = 0.0
    cache_cost_usd:            float = 0.0
    additional_tool_cost_usd:  float = 0.0
    total_call_cost_usd:       float = 0.0
    # Diagnostics (bounded, sanitized — never a prompt, output or secret)
    error_code:    Optional[str] = None
    error_kind:    Optional[str] = None
    error_message: Optional[str] = None
    request_id:    Optional[str] = None
    tool_key:    Optional[str] = None   # set for non-token tool calls
    tool_units:  float = 0.0
    duration_ms: int = 0
    # Canonical attribution (cost audit) — all server-set, never client-authored.
    stage:             Optional[str] = None   # canonical STAGE_* (call site sets it)
    agent:             Optional[str] = None    # canonical AGENT_* (call site sets it)
    sequence_index:    Optional[int] = None    # monotonic per build (store-assigned)
    parent_call_id:    Optional[str] = None    # links a repair/retry to its origin
    retry_reason:      Optional[str] = None    # bounded, sanitized ("contract"|"quality"|…)
    input_fingerprint: Optional[str] = None    # one-way sha256 prefix of the normalized input
    output_fingerprint: Optional[str] = None   # one-way sha256 prefix of a bounded output signature
    context_bytes:     int = 0                  # size of the input context (bytes), never the content

    def as_dict(self) -> Dict[str, Any]:
        return dict(self.__dict__)


@dataclass
class BuildAggregate:
    """Roll-up over every call in a build (task #6)."""
    build_id:              str
    user_id:               str
    status:                str = "in_progress"   # in_progress|completed|failed
    started_at:            Optional[str] = None
    completed_at:          Optional[str] = None
    build_duration_seconds: float = 0.0
    total_input_tokens:    int = 0
    total_output_tokens:   int = 0
    total_cached_tokens:   int = 0
    total_reasoning_tokens: int = 0
    total_ai_calls:        int = 0
    failed_calls:          int = 0
    retry_calls:           int = 0
    usage_missing_calls:   int = 0
    total_token_cost_usd:  float = 0.0
    total_tool_cost_usd:   float = 0.0
    total_build_cost_usd:  float = 0.0
    retry_cost_usd:        float = 0.0

    def as_dict(self) -> Dict[str, Any]:
        return dict(self.__dict__)


__all__ = [
    "TokenUsage", "AICallRecord", "BuildAggregate",
    "OP_PLANNING", "OP_PLANNING_REPAIR", "OP_COORDINATOR", "OP_FRONTEND_GEN",
    "OP_STALE_RECOVERY", "OP_CODEGEN", "OP_CODEGEN_REPAIR",
    "OP_VISUAL", "OP_RESEARCH", "OP_IMAGE_GEN", "OP_WEB_SEARCH",
    "OP_EMBEDDING", "OP_CHAT", "OP_OTHER",
    # Canonical stage/agent taxonomy
    "STAGE_REQUEST_ANALYSIS", "STAGE_WEBSITE_STRATEGY", "STAGE_WEB_BUILD_PLANNING",
    "STAGE_PLANNING_REPAIR", "STAGE_VISUAL_INTELLIGENCE", "STAGE_WEB_RESEARCH",
    "STAGE_STOCK_IMAGE_SEARCH", "STAGE_IMAGE_GENERATION", "STAGE_FRONTEND_GENERATION",
    "STAGE_FRONTEND_VALIDATION", "STAGE_FRONTEND_REPAIR", "STAGE_FRONTEND_QUALITY_REPAIR",
    "STAGE_REVISION", "STAGE_FINALIZATION", "STAGE_STALE_RECOVERY", "STAGE_UNKNOWN",
    "AGENT_COORDINATOR", "AGENT_WEBSITE_BUILDER", "AGENT_VISUAL_INTELLIGENCE",
    "AGENT_RESEARCH", "AGENT_FRONTEND_BUILDER", "AGENT_IMAGE", "AGENT_SYSTEM", "AGENT_UNKNOWN",
    "stage_for", "agent_for", "is_generic_label",
]
