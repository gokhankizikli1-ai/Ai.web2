# coding: utf-8
"""Phase 10 — ToolExecutionsClient.

Two surfaces:
  1. Direct CRUD-ish for callers (route layer, tests).
  2. `record_run()` context manager — the instrumentation hook
     that wraps a tool callable, times it, normalises errors, and
     persists a row regardless of success/failure. The agent runtime
     + the public /v2/tools/execute route call through this so every
     tool invocation lands in the log without each tool needing to
     know about it.
"""
from __future__ import annotations

import contextlib
import json
import logging
import os
import time
import traceback
from typing import Any, Iterator, Optional

from backend.services.tool_executions import store
from backend.services.tool_executions.types import (
    ToolExecution,
    STATUS_QUEUED, STATUS_RUNNING, STATUS_COMPLETED,
    STATUS_FAILED, STATUS_TIMEOUT, STATUS_RATE_LIMITED,
    MODE_SYNC,
)


logger = logging.getLogger(__name__)


def is_enabled() -> bool:
    """ENABLE_TOOLS_RUNTIME — gates the persistent log. Tools still
    work when off; we just don't record. Default off so this PR ships
    dark."""
    return os.getenv("ENABLE_TOOLS_RUNTIME", "false").strip().lower() == "true"


class ToolExecutionsClient:

    def init(self) -> None:
        if is_enabled():
            store.init()

    def is_enabled(self) -> bool:
        return is_enabled()

    # ── Direct CRUD ────────────────────────────────────────────────────────

    def create(
        self,
        *,
        user_id:        str,
        tool_id:        str,
        input_summary:  str = "",
        input_json:     Optional[str] = None,
        caller:         str = "user",
        execution_mode: str = MODE_SYNC,
        panel_id:       Optional[str] = None,
        workflow_id:    Optional[str] = None,
        agent_id:       Optional[str] = None,
        project_id:     Optional[str] = None,
        correlation_id: Optional[str] = None,
        metadata:       Optional[dict] = None,
    ) -> Optional[ToolExecution]:
        if not is_enabled():
            return None
        if not (user_id and tool_id):
            return None
        try:
            execution = ToolExecution(
                user_id=        user_id,
                tool_id=        tool_id,
                status=         STATUS_QUEUED,
                caller=         caller,
                execution_mode= execution_mode,
                input_summary=  (input_summary or "")[:400],
                input_json=     input_json or "{}",
                panel_id=       panel_id,
                workflow_id=    workflow_id,
                agent_id=       agent_id,
                project_id=     project_id,
                correlation_id= correlation_id,
                metadata=       dict(metadata or {}),
            )
            return store.insert(execution)
        except Exception as e:
            logger.warning("tool_executions.create error: %s", e)
            return None

    def get(self, execution_id: str, *, user_id: str) -> Optional[ToolExecution]:
        if not is_enabled():
            return None
        try:
            return store.get(execution_id, user_id=user_id)
        except Exception as e:
            logger.warning("tool_executions.get error: %s", e)
            return None

    def list_user(self, **kwargs) -> list[ToolExecution]:
        if not is_enabled():
            return []
        try:
            return store.list_user(**kwargs)
        except Exception as e:
            logger.warning("tool_executions.list_user error: %s", e)
            return []

    def usage_summary(self, *, user_id: str, since_iso: Optional[str] = None) -> dict:
        if not is_enabled():
            return {"enabled": False}
        try:
            out = store.usage_summary(user_id=user_id, since_iso=since_iso)
            out["enabled"] = True
            return out
        except Exception as e:
            logger.warning("tool_executions.usage_summary error: %s", e)
            return {"enabled": False, "error": str(e)}

    def mark_running(self, execution_id: str, *, user_id: str) -> Optional[ToolExecution]:
        if not is_enabled():
            return None
        try:
            return store.mark_running(execution_id, user_id=user_id)
        except Exception as e:
            logger.warning("tool_executions.mark_running error: %s", e)
            return None

    def mark_terminal(self, execution_id: str, **kwargs) -> Optional[ToolExecution]:
        if not is_enabled():
            return None
        try:
            return store.mark_terminal(execution_id, **kwargs)
        except Exception as e:
            logger.warning("tool_executions.mark_terminal error: %s", e)
            return None

    # ── Instrumentation context manager ────────────────────────────────────

    @contextlib.contextmanager
    def record_run(
        self,
        *,
        user_id:        str,
        tool_id:        str,
        input_summary:  str = "",
        input_payload:  Optional[dict] = None,
        caller:         str = "user",
        execution_mode: str = MODE_SYNC,
        panel_id:       Optional[str] = None,
        agent_id:       Optional[str] = None,
        project_id:     Optional[str] = None,
        workflow_id:    Optional[str] = None,
        correlation_id: Optional[str] = None,
    ) -> Iterator["ToolRunHandle"]:
        """Context manager that records a complete tool run.

        Usage:

            with client.record_run(
                user_id=u, tool_id="web_search",
                input_summary=q, input_payload={"query": q},
            ) as h:
                result = await provider.search(q)
                h.success(output={"results": result}, provider="tavily")
                # OR h.failure("RATE_LIMITED", "Tavily 429", rate_limited=True)

        Exits the with-block by:
          - flushing the recorded row to disk
          - publishing one bus event (`tool.executed`) so the FE can
            react without polling

        If the user code raises, the context manager records a failure
        row with the exception message + traceback summary and
        re-raises.
        """
        t_start = time.monotonic()
        input_json = json.dumps(input_payload or {})
        record = self.create(
            user_id=        user_id,
            tool_id=        tool_id,
            input_summary=  input_summary,
            input_json=     input_json,
            caller=         caller,
            execution_mode= execution_mode,
            panel_id=       panel_id,
            agent_id=       agent_id,
            project_id=     project_id,
            workflow_id=    workflow_id,
            correlation_id= correlation_id,
        )
        if record is None:
            # Recording disabled or DB error — yield a no-op handle so
            # the caller's flow is unchanged. The tool still runs.
            yield ToolRunHandle(client=self, user_id=user_id, record=None,
                                t_start=t_start, tool_id=tool_id)
            return

        # Mark running on entry — the FE can already render "running"
        # before the underlying API call returns.
        self.mark_running(record.id, user_id=user_id)
        handle = ToolRunHandle(client=self, user_id=user_id, record=record,
                               t_start=t_start, tool_id=tool_id)
        try:
            yield handle
        except Exception as exc:
            # Uncaught exception — record + re-raise so callers can
            # surface a meaningful error to the user.
            self._finalise_exception(handle, exc)
            raise
        else:
            # Caller didn't call success() or failure() — autocomplete
            # as success with no payload. Common when the tool returns
            # but the caller forgot to call .success(). Better an
            # empty completed row than a "running" ghost.
            if not handle._finalised:
                handle.success()

    def _finalise_exception(
        self, handle: "ToolRunHandle", exc: BaseException,
    ) -> None:
        if handle.record is None or handle._finalised:
            return
        latency_ms = int((time.monotonic() - handle._t_start) * 1000)
        tb = traceback.format_exc().splitlines()
        snippet = " | ".join(tb[-4:])[:600]
        self.mark_terminal(
            handle.record.id, user_id=handle.user_id,
            status=STATUS_FAILED,
            error_code=type(exc).__name__,
            error_message=str(exc)[:300] or snippet,
            latency_ms=latency_ms,
        )
        handle._finalised = True
        self._publish_executed_event(handle, status=STATUS_FAILED)

    def _publish_executed_event(self, handle: "ToolRunHandle", *, status: str) -> None:
        try:
            from backend.services.events import bus as _bus
            from backend.services.events.types import ActivityEvent
            scope = (
                f"panel:{handle.record.panel_id}"
                if handle.record and handle.record.panel_id
                else f"user:{handle.user_id}"
            )
            _bus.publish(ActivityEvent(
                kind="tool.executed",
                scope=scope,
                agent_id=handle.record.agent_id if handle.record else None,
                payload={
                    "execution_id": handle.record.id if handle.record else None,
                    "tool_id":      handle._tool_id,
                    "status":       status,
                    "latency_ms":   handle.record.latency_ms if handle.record else None,
                    "panel_id":     handle.record.panel_id if handle.record else None,
                },
            ))
        except Exception as e:
            logger.debug("tool_executions.publish bus failed: %s", e)


class ToolRunHandle:
    """Returned by `record_run()`. Caller decides success / failure
    semantics by calling success() or failure() before the with-block
    exits."""
    def __init__(self, *, client: ToolExecutionsClient, user_id: str,
                 record: Optional[ToolExecution], t_start: float,
                 tool_id: str):
        self._client = client
        self.user_id = user_id
        self.record  = record
        self._t_start = t_start
        self._tool_id = tool_id
        self._finalised = False

    @property
    def execution_id(self) -> Optional[str]:
        return self.record.id if self.record else None

    def success(
        self, *,
        output:        Optional[dict] = None,
        provider:      Optional[str] = None,
        cost_estimate: Optional[float] = None,
    ) -> None:
        if self.record is None or self._finalised:
            return
        latency_ms = int((time.monotonic() - self._t_start) * 1000)
        output_json = json.dumps(output) if output is not None else None
        self._client.mark_terminal(
            self.record.id, user_id=self.user_id,
            status=STATUS_COMPLETED,
            output_json=output_json,
            provider=provider,
            latency_ms=latency_ms,
            cost_estimate=cost_estimate,
        )
        self._finalised = True
        self._client._publish_executed_event(self, status=STATUS_COMPLETED)

    def failure(
        self, error_code: str, error_message: str = "", *,
        provider:     Optional[str] = None,
        rate_limited: bool = False,
        timed_out:    bool = False,
    ) -> None:
        if self.record is None or self._finalised:
            return
        latency_ms = int((time.monotonic() - self._t_start) * 1000)
        if rate_limited:
            status = STATUS_RATE_LIMITED
        elif timed_out:
            status = STATUS_TIMEOUT
        else:
            status = STATUS_FAILED
        self._client.mark_terminal(
            self.record.id, user_id=self.user_id,
            status=status,
            error_code=error_code,
            error_message=(error_message or "")[:300],
            provider=provider,
            latency_ms=latency_ms,
        )
        self._finalised = True
        self._client._publish_executed_event(self, status=status)


client = ToolExecutionsClient()


__all__ = ["ToolExecutionsClient", "ToolRunHandle", "client", "is_enabled"]
