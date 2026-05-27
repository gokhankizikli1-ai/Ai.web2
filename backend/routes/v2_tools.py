# coding: utf-8
"""/v2/tools — Phase 10 public tools API.

Three concerns, one route module:

  GET  /v2/tools                          list enabled tools (metadata only)
  POST /v2/tools/execute                  invoke a tool by id, log via ToolExecutionsClient
  GET  /v2/tools/executions               list the caller's execution history
  GET  /v2/tools/executions/{id}          fetch one execution row
  GET  /v2/tools/usage                    aggregate latency + cost summary

Gating:
  - ENABLE_TOOLS              master kill-switch (already used by registry)
  - per-tool ENABLE_<TOOL>    each tool's own gate, honoured by registry.is_enabled
  - ENABLE_TOOLS_RUNTIME      gates the execution log (writes); the
                              execute route still works when off, just
                              without persistence.

Execute is intentionally NOT a giant universal RPC — each tool is
self-describing via input_schema; the route validates that `query`
(string) or `payload` (dict) is provided and forwards them to the
tool's `run(query, context)` call. Future tools can opt into typed
bodies by reading from `payload`.
"""
from __future__ import annotations

import json
import logging
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from pydantic import BaseModel, Field

from backend.core.deps import current_user
from backend.core.responses import ok as envelope_ok
from backend.services.auth.identity import User
from backend.services.tool_executions import client as exec_client
from backend.services.tool_executions.types import MODE_SYNC


logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v2", tags=["tools-v2"])


# ── Helpers ───────────────────────────────────────────────────────────────

def _registry_module():
    # Lazy import keeps the route file independent of tool import order.
    from backend.services.tools import tool_registry  # noqa: WPS433
    return tool_registry


# ── List + describe ──────────────────────────────────────────────────────

@router.get("/tools")
def list_tools(
    user: User = Depends(current_user),
) -> Dict[str, Any]:
    """Return every enabled tool's public metadata. No body; the FE
    uses this to render the tools catalogue. When ENABLE_TOOLS is off
    we still return 200 with an empty list so the FE renders an empty
    state rather than hitting a 503 every load."""
    reg = _registry_module()
    descriptors = reg.describe_enabled_tools()
    return envelope_ok(
        data={"tools": descriptors},
        endpoint="/v2/tools",
        user_id=user.id,
        count=len(descriptors),
    )


@router.get("/tools/{tool_id}")
def get_tool(
    tool_id: str = Path(..., max_length=128),
    user: User = Depends(current_user),
) -> Dict[str, Any]:
    reg = _registry_module()
    if not reg.is_enabled(tool_id):
        raise HTTPException(
            status_code=404,
            detail={"code": "TOOL_DISABLED_OR_UNKNOWN", "tool_id": tool_id},
        )
    tool = reg.get_tool(tool_id)
    if tool is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "TOOL_NOT_REGISTERED", "tool_id": tool_id},
        )
    return envelope_ok(
        data={"tool": tool.describe()},
        endpoint=f"/v2/tools/{tool_id}",
        user_id=user.id,
    )


# ── Execute ──────────────────────────────────────────────────────────────

class ExecuteToolBody(BaseModel):
    """A tool invocation. Either `query` (free-form string) OR `payload`
    (typed dict) must be provided. Many tools accept both — the bridge
    forwards both to `run(query, context=payload)`."""
    tool_id:        str = Field(..., min_length=1, max_length=128)
    query:          str = Field(default="", max_length=8000)
    payload:        Optional[Dict[str, Any]] = None
    panel_id:       Optional[str] = Field(None, max_length=128)
    agent_id:       Optional[str] = Field(None, max_length=128)
    project_id:     Optional[str] = Field(None, max_length=64)
    workflow_id:    Optional[str] = Field(None, max_length=128)
    correlation_id: Optional[str] = Field(None, max_length=128)


@router.post("/tools/execute")
async def execute_tool(
    body: ExecuteToolBody,
    user: User = Depends(current_user),
) -> Dict[str, Any]:
    """Execute a tool and return its normalised envelope. Logs through
    the ToolExecutionsClient when ENABLE_TOOLS_RUNTIME is on; without
    the flag the tool still runs but no row is recorded."""
    reg = _registry_module()
    if not reg.is_enabled(body.tool_id):
        raise HTTPException(
            status_code=404,
            detail={"code": "TOOL_DISABLED_OR_UNKNOWN", "tool_id": body.tool_id},
        )
    tool = reg.get_tool(body.tool_id)
    if tool is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "TOOL_NOT_REGISTERED", "tool_id": body.tool_id},
        )

    # Build a compact input summary the FE renders in the execution
    # row without us serialising the whole payload again.
    summary = (body.query or "").strip()
    if not summary and body.payload:
        for k in ("url", "repo", "query", "symbol"):
            v = body.payload.get(k)
            if isinstance(v, str) and v:
                summary = f"{k}: {v[:120]}"
                break
    summary = summary[:200]

    input_payload = {
        "query":   body.query,
        "payload": body.payload or {},
    }

    with exec_client.record_run(
        user_id=        user.id,
        tool_id=        body.tool_id,
        input_summary=  summary,
        input_payload=  input_payload,
        caller=         "user",
        execution_mode= getattr(tool, "execution_mode", MODE_SYNC),
        panel_id=       body.panel_id,
        agent_id=       body.agent_id,
        project_id=     body.project_id,
        workflow_id=    body.workflow_id,
        correlation_id= body.correlation_id,
    ) as run:
        try:
            envelope = await tool.safe_run(body.query, body.payload or {})
        except Exception as exc:
            # safe_run() should already catch — defence in depth.
            run.failure("TOOL_RAISED", str(exc) or "Tool raised unexpectedly")
            raise HTTPException(
                status_code=500,
                detail={"code": "TOOL_RAISED",
                        "message": str(exc)[:300]},
            )
        # Translate the envelope status to terminal log semantics so
        # the FE can render success/unavailable/error consistently.
        status = (envelope or {}).get("status") or "error"
        provider = (envelope or {}).get("provider")
        if status == "available":
            run.success(output=envelope, provider=provider,
                        cost_estimate=float(getattr(tool, "cost_estimate", 0.0)))
        elif status == "unavailable":
            run.failure("TOOL_UNAVAILABLE",
                        (envelope or {}).get("message") or "Tool unavailable",
                        provider=provider)
        else:
            run.failure("TOOL_ERROR",
                        (envelope or {}).get("message") or "Tool error",
                        provider=provider)

    return envelope_ok(
        data={
            "tool":         body.tool_id,
            "execution_id": run.execution_id,
            "result":       envelope,
        },
        endpoint="/v2/tools/execute",
        user_id=user.id,
    )


# ── Execution history ────────────────────────────────────────────────────

@router.get("/tools/executions")
def list_executions(
    tool_id:  Optional[str] = Query(None, max_length=128),
    status:   Optional[str] = Query(None, max_length=32),
    panel_id: Optional[str] = Query(None, max_length=128),
    agent_id: Optional[str] = Query(None, max_length=128),
    limit:    int = Query(50, ge=1, le=200),
    offset:   int = Query(0, ge=0),
    user: User = Depends(current_user),
) -> Dict[str, Any]:
    """Reads from the ToolExecutionsClient log. Returns empty list
    (not 503) when the flag is off so the FE can hide the panel
    gracefully."""
    rows = exec_client.list_user(
        user_id=user.id,
        tool_id=tool_id, status=status,
        panel_id=panel_id, agent_id=agent_id,
        limit=limit, offset=offset,
    )
    return envelope_ok(
        data={
            "executions": [r.to_dict() for r in rows],
            "enabled":    exec_client.is_enabled(),
        },
        endpoint="/v2/tools/executions",
        user_id=user.id,
        count=len(rows), limit=limit, offset=offset,
    )


@router.get("/tools/executions/{execution_id}")
def get_execution(
    execution_id: str = Path(..., max_length=128),
    user: User = Depends(current_user),
) -> Dict[str, Any]:
    row = exec_client.get(execution_id, user_id=user.id)
    if row is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "EXECUTION_NOT_FOUND", "id": execution_id},
        )
    return envelope_ok(
        data={"execution": row.to_dict()},
        endpoint=f"/v2/tools/executions/{execution_id}",
        user_id=user.id,
    )


@router.get("/tools/usage")
def usage_summary(
    since_iso: Optional[str] = Query(None, max_length=64),
    user: User = Depends(current_user),
) -> Dict[str, Any]:
    """Aggregate counts + latency + cost. Feeds the future credit
    dashboard. Returns `enabled: false` when the log is off."""
    summary = exec_client.usage_summary(
        user_id=user.id, since_iso=since_iso,
    )
    return envelope_ok(
        data=summary,
        endpoint="/v2/tools/usage",
        user_id=user.id,
    )


__all__ = ["router"]
