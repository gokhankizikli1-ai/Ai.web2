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
import os
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from backend.core.deps import current_user
from backend.core.responses import ok as envelope_ok
from backend.services.agent import (
    AgentRequest,
    is_enabled as agent_enabled,
    run_agent,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v2/agent", tags=["agent"])


def _require_auth() -> bool:
    """Phase 7a — second gate on top of ENABLE_AGENT. When true the
    route rejects any caller whose request.state.user is a guest
    (including the synthetic fallback when AuthMiddleware isn't
    installed). Read dynamically so a Railway env-var flip takes
    effect on the next request."""
    return os.getenv("ENABLE_AGENT_REQUIRE_AUTH", "false").strip().lower() == "true"


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
async def execute(body: AgentExecuteRequest, request: Request) -> dict:
    """Run one end-to-end agent invocation.

    Gating, in order:
      1. ENABLE_AGENT=true                 → otherwise 400 AGENT_DISABLED
      2. ENABLE_AGENT_REQUIRE_AUTH=true    → caller must be authenticated
                                              (Authorization: Bearer ...),
                                              else 401 AGENT_AUTH_REQUIRED
      3. Last message must be role=user    → otherwise 400 BAD_REQUEST

    When authenticated, the JWT-derived user.id overrides any user_id
    sent in the request body so a caller can never run the agent under
    another user's identity. When auth isn't required, body.user_id is
    used (or "anonymous"). The chosen identity is echoed back in
    metadata.auth so operators can confirm gating.
    """
    if not agent_enabled():
        raise HTTPException(
            status_code=400,
            detail={
                "code":    "AGENT_DISABLED",
                "message": "Agent runtime is disabled. Set ENABLE_AGENT=true on the server to enable.",
            },
        )

    # Snapshot the auth-required flag ONCE per request so the gate
    # decision, the log line, and the metadata.auth block all agree
    # even if Railway env vars are flipped mid-request.
    require_auth = _require_auth()

    # Always returns a User — the synthetic guest fallback fires when
    # AuthMiddleware isn't installed (ENABLE_AUTH_V2=false).
    user = current_user(request)

    # Optional auth gate. With this on, guests (including the
    # synthetic fallback) are rejected → "fail closed". This catches
    # the operator mistake of flipping ENABLE_AGENT_REQUIRE_AUTH=true
    # while leaving ENABLE_AUTH_V2 off.
    if require_auth and user.is_guest:
        raise HTTPException(
            status_code=401,
            detail={
                "code":    "AGENT_AUTH_REQUIRED",
                "message": (
                    "/v2/agent/execute requires authentication when "
                    "ENABLE_AGENT_REQUIRE_AUTH=true. Set ENABLE_AUTH_V2=true on "
                    "the server and include 'Authorization: Bearer <token>'."
                ),
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

    # JWT-derived id wins when authenticated, so a caller can't run
    # the agent under someone else's id. When unauthenticated and
    # auth isn't required, preserve the legacy body-driven path.
    resolved_user_id = user.id if not user.is_guest else (body.user_id or "anonymous")

    req = AgentRequest(
        user_message=last.content,
        mode=body.mode,
        user_id=resolved_user_id,
        model=body.model or "gpt-4o-mini",
        temperature=body.temperature,
        max_tokens=body.max_tokens or 1500,
        history=history,
    )

    logger.info(
        "agent_execute | mode=%s | model=%s | history_len=%d | user_kind=%s | require_auth=%s",
        req.mode, req.model, len(req.history), user.kind, require_auth,
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
        # Phase 7a — surface the gating outcome so operators can confirm
        # auth status from the response envelope alone. Uses the
        # snapshot taken at the start of the request so the reported
        # value always matches the gate decision.
        auth = {
            "required":  require_auth,
            "user_id":   resolved_user_id,
            "user_kind": user.kind,
        },
    )


# ── /v2/agent/test — production-safe canary route (Phase 7c) ─────────────

# Hard-pinned canary parameters. The test route exists so operators can
# verify tool wiring from production WITHOUT exposing the full agent
# surface area: it always uses mode="market" (calculator, current_time,
# stock_market, market_data, news, macro_data), caps the budget at 4
# steps total (≈ 2 LLM rounds with tool calls between), and never
# requires auth even when ENABLE_AGENT_REQUIRE_AUTH is on for /execute.
_TEST_MODE         = "market"
_TEST_MAX_STEPS    = 4
_TEST_MAX_TOKENS   = 1200
_TEST_TEMPERATURE  = 0.3
_TEST_MAX_HISTORY  = 4           # accept short histories only


class AgentTestRequest(BaseModel):
    """Minimal request body for /v2/agent/test. mode / model / budgets
    are NOT settable from outside — that's the whole point of a canary."""
    messages: List[AgentMessage] = Field(..., min_length=1, max_length=_TEST_MAX_HISTORY)


@router.post("/test")
async def agent_test(body: AgentTestRequest, request: Request) -> dict:
    """Safe canary endpoint for verifying the agent's tool wiring.

    Differences from /v2/agent/execute:
      - Hard-pinned mode="market" (the four canary tools live here).
      - Hard-capped at 4 steps regardless of AGENT_MAX_STEPS.
      - Hard-capped at 4-message history.
      - No auth requirement (ENABLE_AGENT_REQUIRE_AUTH is ignored).
      - test_mode=true in metadata so operators see the canary path
        clearly in logs and response envelopes.

    Gating, in order:
      1. ENABLE_AGENT=true → otherwise 400 AGENT_DISABLED
      2. Last message must be role=user → otherwise 400 BAD_REQUEST

    All standing constraints apply: no real-world action, no trading,
    no payments, read-only tools only.
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

    # Identity is best-effort here — the test route doesn't gate on auth.
    user = current_user(request)

    req = AgentRequest(
        user_message=last.content,
        mode=_TEST_MODE,
        user_id=user.id,
        temperature=_TEST_TEMPERATURE,
        max_tokens=_TEST_MAX_TOKENS,
        history=history,
        max_steps=_TEST_MAX_STEPS,
    )

    logger.info(
        "agent_test.invoke | user_kind=%s | history_len=%d | mode=%s | max_steps=%d",
        user.kind, len(history), _TEST_MODE, _TEST_MAX_STEPS,
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
        # Phase 7c — canary marker. Lets operators distinguish /test
        # calls from /execute calls in logs and trace dumps.
        test_mode = {
            "enabled":   True,
            "mode":      _TEST_MODE,
            "max_steps": _TEST_MAX_STEPS,
            "user_kind": user.kind,
        },
    )


__all__ = ["router"]
