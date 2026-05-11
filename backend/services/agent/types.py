# coding: utf-8
# Phase A1 — Agent runtime typed payloads.
#
# Pure dataclasses, zero runtime dependencies. These are the contract every
# layer of the agent runtime speaks. Adding new fields is the ONLY place the
# trace schema should evolve so the frontend trace renderer (W3) and the
# observability surface (/tools/health) can rely on stable keys.
from dataclasses import dataclass, field, asdict
from typing import Any, Optional


# ── Step kinds ───────────────────────────────────────────────────────────────

STEP_KINDS = (
    "llm_pass",      # one model completion (OpenAI chat.completions.create)
    "tool_call",     # one BaseTool invocation
    "memory_op",     # remember / recall via MemoryClient (reserved; not used in A1)
    "workflow_step", # invoke a saved workflow (reserved; A4)
    "fallback",      # legacy single-shot path was used (agent disabled / errored)
)


# ── Agent step trace entry ──────────────────────────────────────────────────

@dataclass
class AgentStep:
    """One step in the agent's reasoning trace. Surfaced in metadata.agent_trace."""
    kind:        str                                  # one of STEP_KINDS
    started_at:  Optional[float] = None               # epoch seconds
    duration_ms: Optional[int] = None
    name:        Optional[str] = None                 # tool name for tool_call
    args:        Optional[dict] = None                # tool args / llm options
    output:      Optional[dict] = None                # truncated tool result / llm reply summary
    error:       Optional[str]  = None
    ok:          bool = True

    def to_dict(self) -> dict:
        return asdict(self)


# ── Agent request / response ────────────────────────────────────────────────

@dataclass
class AgentRequest:
    """One end-to-end agent invocation."""
    user_message: str
    mode:         str                                 # canonical mode id (e.g. "research")
    user_id:      str
    model:        str = "gpt-4o-mini"
    temperature:  float = 0.4
    max_tokens:   int = 1500
    history:      list = field(default_factory=list)  # [(role, content), …]
    system_prompt: str = ""
    workspace_id: Optional[str] = None                # accepted; honoured by M3+
    metadata_in:  dict = field(default_factory=dict)


@dataclass
class AgentResponse:
    """Returned to ai_service. The reply is the user-visible text."""
    reply:       str
    mode:        str
    model:       str
    provider:    str = "openai"
    trace:       list[AgentStep] = field(default_factory=list)
    steps_used:  int = 0
    elapsed_ms:  int = 0
    partial:     bool = False                         # true when budget exhausted mid-loop
    fallback:    bool = False                         # true when legacy path produced this reply
    tool_calls:  int = 0
    metadata:    dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        d = asdict(self)
        d["trace"] = [s.to_dict() if isinstance(s, AgentStep) else s for s in self.trace]
        return d


__all__ = [
    "STEP_KINDS",
    "AgentStep",
    "AgentRequest",
    "AgentResponse",
]
