# coding: utf-8
"""
/v2/agent/execute — Phase 6d HTTP entry point for the agent runtime.

Calls `backend.services.agent.run_agent()` and surfaces the result in
the v2 envelope, including the structured tool-call trace. The agent
itself was already wired into the legacy /chat path for `mode=research`
via `ai_service.process_chat`; this route exposes it directly so the
frontend (or a script) can drive the agent loop without going through
the chat orchestration layer.

Wire protocol (request body):

  {
    "messages":     [{"role":"user","content":"What is sqrt(144)?"}],
    "mode":         "general",         // optional, default "general"
    "model":        "gpt-4o-mini",     // optional
    "temperature":  0.4,                // optional
    "max_tokens":   1500,               // optional
    "user_id":      "anonymous"         // optional
  }

Response envelope (data block + trace in metadata):

  {
    "success":   true,
    "data": {
      "reply":      "12",
      "mode":       "general",
      "model":      "gpt-4o-mini",
      "provider":   "openai",
      "partial":    false,
      "fallback":   false,
      "tool_calls": 1,
      "steps_used": 2
    },
    "metadata": {
      "agent_trace":    [ … list of AgentStep dicts … ],
      "agent_metadata": { … },
      "elapsed_ms":     843,
      …
    },
    …
  }

Disabled by default. Set ENABLE_AGENT=true to activate. When disabled
the route returns 400 with code AGENT_DISABLED — production traffic is
not affected.
"""
from __future__ import annotations

import logging
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.core.responses import ok as envelope_ok
from backend.services.agent import (
    AgentRequest,
    is_enabled as agent_enabled,
    run_agent,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v2/agent", tags=["agent"])


# ── Request schema ────────────────────────────────────────────────────────

class AgentMessage(BaseModel):
    role:    str = Field(..., pattern="^(system|user|assistant)$")
    content: str = Field(..., min_length=1, max_length=16_000)


class AgentExecuteRequest(BaseModel):
    messages:    List[AgentMessage] = Field(..., min_length=1, max_length=64)
    mode:        str   = Field(default="general", max_length=32)
    model:       Optional[str] = Field(default=None, max_length=128)
    temperature: float = Field(default=0.4, ge=0.0, le=2.0)
    max_tokens:  Optional[int] = Field(default=1500, ge=1, le=8000)
    user_id:     Optional[str] = Field(default=None, max_length=128)


# ── Route ─────────────────────────────────────────────────────────────────

@router.post("/execute")
async def execute(body: AgentExecuteRequest) -> dict:
    """Run one end-to-end agent invocation.

    Gated by `ENABLE_AGENT=true`. When disabled, returns 400 instead of
    silently falling back — callers always know whether the agent ran.
    """
    if not agent_enabled():
        raise HTTPException(
            status_code=400,
            detail={
                "code":    "AGENT_DISABLED",
                "message": "Agent runtime is disabled. Set ENABLE_AGENT=true on the server to enable.",
            },
        )

    last = body.messages[-1]
    if last.role != "user":
        raise HTTPException(
            status_code=400,
            detail={
                "code":    "BAD_REQUEST",
                "message": "The last message must be from role='user'.",
            },
        )

    history = [(m.role, m.content) for m in body.messages[:-1]]

    req = AgentRequest(
        user_message=last.content,
        mode=body.mode,
        user_id=body.user_id or "anonymous",
        model=body.model or "gpt-4o-mini",
        temperature=body.temperature,
        max_tokens=body.max_tokens or 1500,
        history=history,
    )

    logger.info(
        "agent_execute | mode=%s | model=%s | history_len=%d",
        req.mode, req.model, len(req.history),
    )

    response = await run_agent(req)

    return envelope_ok(
        data={
            "reply":      response.reply,
            "mode":       response.mode,
            "model":      response.model,
            "provider":   response.provider,
            "partial":    response.partial,
            "fallback":   response.fallback,
            "tool_calls": response.tool_calls,
            "steps_used": response.steps_used,
        },
        agent_trace    = [step.to_dict() if hasattr(step, "to_dict") else step for step in response.trace],
        agent_metadata = response.metadata,
        elapsed_ms     = response.elapsed_ms,
    )


__all__ = ["router"]
