# coding: utf-8
"""Phase 8 — AgentTasksClient public surface."""
from __future__ import annotations

import logging
import os
from typing import Optional

from backend.services.agent_tasks import store
from backend.services.agent_tasks.types import (
    AgentTaskRecord, STATUS_CANCELLED, STATUS_COMPLETED, STATUS_FAILED,
)


logger = logging.getLogger(__name__)


def is_enabled() -> bool:
    return os.getenv("ENABLE_AGENT_ORCHESTRATION", "false").strip().lower() == "true"


class AgentTasksClient:

    def init(self) -> None:
        store.init()

    def is_enabled(self) -> bool:
        return is_enabled()

    # ── Create ─────────────────────────────────────────────────────────────

    def create(
        self, *, user_id: str, assigned_agent_id: str,
        task_description: str,
        project_id: Optional[str] = None,
        parent_job_id: Optional[str] = None,
        delegation_status: Optional[str] = None,
        payload: Optional[dict] = None,
        summary: Optional[str] = None,
        metadata: Optional[dict] = None,
    ) -> Optional[AgentTaskRecord]:
        if not is_enabled():
            return None
        if not (user_id and assigned_agent_id and task_description):
            return None
        rec = AgentTaskRecord(
            user_id=           str(user_id),
            assigned_agent_id= assigned_agent_id,
            task_description=  task_description,
            project_id=        project_id,
            parent_job_id=     parent_job_id,
            delegation_status= delegation_status or "delegated",
            payload=           payload or {},
            summary=           summary,
            metadata=          metadata or {},
        )
        return store.insert(rec)

    # ── Read ───────────────────────────────────────────────────────────────

    def get(self, task_id: str, *, user_id: Optional[str] = None) -> Optional[AgentTaskRecord]:
        rec = store.get(task_id)
        if rec is None:
            return None
        if user_id is not None and rec.user_id != str(user_id):
            return None
        return rec

    def list_user(
        self, user_id: str, *,
        project_id: Optional[str] = None,
        assigned_agent_id: Optional[str] = None,
        status: Optional[str] = None,
        limit: int = 50, offset: int = 0,
    ) -> list[AgentTaskRecord]:
        if not is_enabled():
            return []
        return store.list_user(
            user_id, project_id=project_id,
            assigned_agent_id=assigned_agent_id,
            status=status, limit=limit, offset=offset,
        )

    # ── Mutate ─────────────────────────────────────────────────────────────

    def mark_status(
        self, task_id: str, status: str,
        *, result: Optional[dict] = None,
        summary: Optional[str] = None,
    ) -> Optional[AgentTaskRecord]:
        kwargs: dict = {"status": status}
        if result is not None:
            kwargs["result"] = result
        if summary is not None:
            kwargs["summary"] = summary
        return store.update(task_id, **kwargs)

    def cancel(self, task_id: str, *, user_id: str) -> Optional[AgentTaskRecord]:
        if not is_enabled():
            return None
        rec = self.get(task_id, user_id=user_id)
        if rec is None:
            return None
        if rec.status in {STATUS_CANCELLED, STATUS_COMPLETED, STATUS_FAILED}:
            return rec
        return store.update(task_id, status=STATUS_CANCELLED)

    def stats(self) -> dict:
        return {"enabled": is_enabled(), "tables": store.table_counts()}


client: AgentTasksClient = AgentTasksClient()

try:
    client.init()
except Exception as _e:
    logger.warning("agent_tasks.client: init failed: %s", _e)


__all__ = ["AgentTasksClient", "client", "is_enabled"]
