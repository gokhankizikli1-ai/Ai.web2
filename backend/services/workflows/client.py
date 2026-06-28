# coding: utf-8
"""Phase 8 — WorkflowsClient public surface."""
from __future__ import annotations

import logging
import os
from typing import Optional

from backend.services.workflows import store
from backend.services.workflows.types import (
    WorkflowRecord, WORKFLOW_TYPES,
    STATUS_CANCELLED, normalize_workflow_type,
    TERMINAL_WORKFLOW_STATUSES,
)


logger = logging.getLogger(__name__)


# Default per-type step templates. Surfaced via `default_steps(type)`
# so callers can preview the plan before creating the workflow.
_DEFAULT_STEPS: dict[str, list[str]] = {
    "research": [
        "scope & keyword expansion",
        "fetch & dedupe sources",
        "extract & summarise",
        "synthesise report",
    ],
    "ecommerce": [
        "catalog snapshot",
        "competitor scan",
        "pricing/listing recommendations",
        "rollout plan",
    ],
    "website_recreation": [
        "analyze screenshot",
        "infer layout structure",
        "draft component plan",
        "produce recreate prompt",
    ],
    "startup_validation": [
        "problem framing",
        "market sizing",
        "competitor landscape",
        "MVP recommendation",
    ],
    "trading_research": [
        "macro context",
        "asset history",
        "signal scan",
        "risk-adjusted recommendation",
    ],
}


def default_steps(workflow_type: str) -> list[str]:
    return list(_DEFAULT_STEPS.get(
        normalize_workflow_type(workflow_type), _DEFAULT_STEPS["research"]
    ))


def is_enabled() -> bool:
    return os.getenv("ENABLE_WORKFLOWS", "false").strip().lower() == "true"


class WorkflowsClient:

    def init(self) -> None:
        store.init()

    def is_enabled(self) -> bool:
        return is_enabled()

    # ── Create ─────────────────────────────────────────────────────────────

    def create(
        self, *, user_id: str, type: str,
        project_id: Optional[str] = None,
        steps: Optional[list[str]] = None,
        payload: Optional[dict] = None,
        metadata: Optional[dict] = None,
    ) -> Optional[WorkflowRecord]:
        if not is_enabled():
            return None
        t = normalize_workflow_type(type)
        rec = WorkflowRecord(
            user_id=str(user_id), type=t,
            project_id=project_id,
            steps=steps if steps else default_steps(t),
            payload=payload or {},
            metadata=metadata or {},
        )
        return store.insert(rec)

    # ── Read ───────────────────────────────────────────────────────────────

    def get(self, workflow_id: str, *, user_id: Optional[str] = None) -> Optional[WorkflowRecord]:
        rec = store.get(workflow_id)
        if rec is None:
            return None
        if user_id is not None and rec.user_id != str(user_id):
            return None
        return rec

    def list_user(
        self, user_id: str, *,
        project_id: Optional[str] = None,
        type: Optional[str] = None,
        status: Optional[str] = None,
        limit: int = 50, offset: int = 0,
    ) -> list[WorkflowRecord]:
        if not is_enabled():
            return []
        return store.list_user(
            user_id, project_id=project_id, type_=type,
            status=status, limit=limit, offset=offset,
        )

    # ── Mutate ─────────────────────────────────────────────────────────────

    def advance_step(
        self, workflow_id: str, *, current_step: int, progress: int,
        result: Optional[dict] = None, metadata: Optional[dict] = None,
    ) -> Optional[WorkflowRecord]:
        kwargs: dict = {"current_step": current_step, "progress": progress}
        if result is not None:
            kwargs["result"] = result
        if metadata is not None:
            kwargs["metadata"] = metadata
        return store.update(workflow_id, **kwargs)

    def mark_status(
        self, workflow_id: str, status: str,
        *, result: Optional[dict] = None,
    ) -> Optional[WorkflowRecord]:
        return store.update(workflow_id, status=status, result=result)

    def cancel(self, workflow_id: str, *, user_id: str) -> Optional[WorkflowRecord]:
        if not is_enabled():
            return None
        rec = self.get(workflow_id, user_id=user_id)
        if rec is None:
            return None
        if rec.status in TERMINAL_WORKFLOW_STATUSES:
            return rec
        return store.update(workflow_id, status=STATUS_CANCELLED)

    # ── Phase A.1: DAG runner entry point ──────────────────────────────────

    async def start_run(self, workflow_id: str, *, user_id: str) -> dict:
        """Phase-A.1 thin wrapper around `workflows.runner.run_workflow`.

        Gated by the separate `ENABLE_WORKFLOW_RUNNER` flag (NOT
        `ENABLE_WORKFLOWS` — the runner is a sub-capability that can
        ship to production while keeping itself off until it's
        verified). Lazy-imports `runner` so a parse error in that
        module never blocks the rest of the client surface from
        loading.
        """
        from backend.services.workflows import runner as wf_runner
        if not wf_runner.is_enabled():
            raise wf_runner.WorkflowRunnerDisabled(
                "Workflow runner is disabled. "
                "Set ENABLE_WORKFLOW_RUNNER=true."
            )
        return await wf_runner.run_workflow(workflow_id, user_id=user_id)

    # ── Observability ──────────────────────────────────────────────────────

    def stats(self) -> dict:
        return {
            "enabled": is_enabled(),
            "tables":  store.table_counts(),
            "types":   list(WORKFLOW_TYPES),
        }


client: WorkflowsClient = WorkflowsClient()

try:
    client.init()
except Exception as _e:
    logger.warning("workflows.client: init failed: %s", _e)


__all__ = ["WorkflowsClient", "client", "is_enabled", "default_steps"]
