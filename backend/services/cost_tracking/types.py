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
]
