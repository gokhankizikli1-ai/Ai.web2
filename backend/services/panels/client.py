# coding: utf-8
"""Phase 9 — PanelsClient public surface."""
from __future__ import annotations

import logging
import os
from typing import Optional

from backend.services.panels import store
from backend.services.panels.types import PanelRecord, STATUS_ACTIVE


logger = logging.getLogger(__name__)


def is_enabled() -> bool:
    """ENABLE_REAL_COORDINATION — gates the panel concept, the
    AgentMessenger, and the route layer. Default off so this PR ships
    dark."""
    return os.getenv("ENABLE_REAL_COORDINATION", "false").strip().lower() == "true"


class PanelsClient:

    def init(self) -> None:
        if is_enabled():
            store.init()

    def is_enabled(self) -> bool:
        return is_enabled()

    # ── Writes ─────────────────────────────────────────────────────────────

    def create(
        self,
        *,
        user_id:            str,
        title:              str,
        project_id:         Optional[str] = None,
        parent_panel_id:    Optional[str] = None,
        chat_id:            Optional[str] = None,
        coordinator_intent: Optional[str] = None,
        metadata:           Optional[dict] = None,
    ) -> Optional[PanelRecord]:
        if not is_enabled():
            return None
        if not (user_id and title):
            return None
        try:
            rec = PanelRecord(
                user_id=            user_id,
                title=              title,
                status=             STATUS_ACTIVE,
                project_id=         project_id,
                parent_panel_id=    parent_panel_id,
                chat_id=            chat_id,
                coordinator_intent= coordinator_intent,
                metadata=           dict(metadata or {}),
            )
            return store.insert(rec)
        except Exception as e:
            logger.warning("panels.create error: %s", e)
            return None

    def mark_status(
        self, panel_id: str, *, user_id: str, status: str,
    ) -> Optional[PanelRecord]:
        if not is_enabled():
            return None
        if not (panel_id and user_id):
            return None
        try:
            return store.mark_status(panel_id, user_id=user_id, status=status)
        except Exception as e:
            logger.warning("panels.mark_status error: %s", e)
            return None

    # ── Reads ──────────────────────────────────────────────────────────────

    def get(self, panel_id: str, *, user_id: str) -> Optional[PanelRecord]:
        if not is_enabled():
            return None
        if not (panel_id and user_id):
            return None
        try:
            return store.get(panel_id, user_id=user_id)
        except Exception as e:
            logger.warning("panels.get error: %s", e)
            return None

    def list_user(
        self,
        *,
        user_id:    str,
        project_id: Optional[str] = None,
        status:     Optional[str] = None,
        limit:      int = 50,
        offset:     int = 0,
    ) -> list[PanelRecord]:
        if not is_enabled():
            return []
        if not user_id:
            return []
        try:
            return store.list_user(
                user_id=user_id, project_id=project_id, status=status,
                limit=limit, offset=offset,
            )
        except Exception as e:
            logger.warning("panels.list_user error: %s", e)
            return []


client = PanelsClient()


__all__ = ["PanelsClient", "client", "is_enabled"]
