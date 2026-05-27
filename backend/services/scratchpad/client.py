# coding: utf-8
"""Phase 9 — ScratchpadClient public surface.

Thin wrapper around store.* that handles the ENABLE_SCRATCHPAD feature
flag and normalises errors. Mirrors agent_tasks/client.py so callers
get a familiar shape (`from backend.services.scratchpad import client
as scratchpad_client; scratchpad_client.append(...)`).

When the flag is off, every public method short-circuits — reads
return empty, writes return None. The route layer also gates with a
503 envelope, but in-process callers (the future Coordinator,
delegate.py, agent runtime) can rely on the same no-op semantics so
they don't have to wrap every call in a flag check.
"""
from __future__ import annotations

import logging
import os
from typing import Optional

from backend.services.scratchpad import store
from backend.services.scratchpad.types import (
    ScratchpadEntry, normalize_kind, KIND_NOTE,
    normalize_status, STATUS_ACTIVE,
)


logger = logging.getLogger(__name__)


def is_enabled() -> bool:
    """Read ENABLE_SCRATCHPAD at call time so a Railway flag flip or
    test monkeypatch takes effect without reloading the module."""
    return os.getenv("ENABLE_SCRATCHPAD", "false").strip().lower() == "true"


class ScratchpadClient:

    def init(self) -> None:
        if is_enabled():
            store.init()

    def is_enabled(self) -> bool:
        return is_enabled()

    # ── Writes ─────────────────────────────────────────────────────────────

    def append(
        self,
        *,
        user_id:        str,
        project_id:     str,
        agent_id:       str,
        content:        str,
        kind:           str = KIND_NOTE,
        workflow_id:    Optional[str] = None,
        job_id:         Optional[str] = None,
        parent_id:      Optional[str] = None,
        correlation_id: Optional[str] = None,
        metadata:       Optional[dict] = None,
        panel_id:       Optional[str] = None,
        references:     Optional[list] = None,
        supersedes_id:  Optional[str] = None,
        status:         str = STATUS_ACTIVE,
    ) -> Optional[ScratchpadEntry]:
        """Append one entry. Returns the persisted record (with id and
        created_at populated) on success, or None when the scratchpad
        is disabled OR the required fields are missing.

        Honest about empty content — callers occasionally want to drop
        a marker with just `kind` (e.g. "decision" with detail in
        metadata), but a wholly empty append with no kind/metadata is
        a noise event we refuse rather than recording garbage."""
        if not is_enabled():
            return None
        if not (user_id and project_id and agent_id):
            return None
        c = (content or "").strip()
        k = normalize_kind(kind)
        # Refuse a wholly empty payload — neither content nor metadata
        # nor a meaningful kind. Keeps the journal signal-to-noise high.
        if not c and not (metadata and isinstance(metadata, dict) and metadata) and k == KIND_NOTE:
            return None
        try:
            entry = ScratchpadEntry(
                user_id=        user_id,
                project_id=     project_id,
                agent_id=       agent_id,
                kind=           k,
                content=        c,
                workflow_id=    workflow_id,
                job_id=         job_id,
                parent_id=      parent_id,
                correlation_id= correlation_id,
                metadata=       dict(metadata or {}),
                panel_id=       panel_id,
                references=     list(references or []),
                supersedes_id=  supersedes_id,
                status=         normalize_status(status),
            )
            return store.insert(entry)
        except Exception as e:
            logger.warning("scratchpad.append error: %s", e)
            return None

    def mark_status(
        self, entry_id: str, *, user_id: str, status: str,
    ) -> Optional[ScratchpadEntry]:
        """Coordinator-level endorsement / dismissal of an entry."""
        if not is_enabled():
            return None
        if not (entry_id and user_id):
            return None
        try:
            return store.mark_status(entry_id, user_id=user_id, status=status)
        except Exception as e:
            logger.warning("scratchpad.mark_status error: %s", e)
            return None

    # ── Reads ──────────────────────────────────────────────────────────────

    def list_project(
        self,
        *,
        user_id:        str,
        project_id:     str,
        limit:          int = 50,
        offset:         int = 0,
        kind:           Optional[str] = None,
        workflow_id:    Optional[str] = None,
        correlation_id: Optional[str] = None,
        panel_id:       Optional[str] = None,
        status:         Optional[str] = None,
        newest_first:   bool = True,
    ) -> list[ScratchpadEntry]:
        """List entries for the caller's project. Returns [] when the
        flag is off so downstream renderers don't need a defensive
        try/except."""
        if not is_enabled():
            return []
        if not (user_id and project_id):
            return []
        try:
            return store.list_project(
                user_id=        user_id,
                project_id=     project_id,
                limit=          limit,
                offset=         offset,
                kind=           kind,
                workflow_id=    workflow_id,
                correlation_id= correlation_id,
                panel_id=       panel_id,
                status=         status,
                newest_first=   newest_first,
            )
        except Exception as e:
            logger.warning("scratchpad.list_project error: %s", e)
            return []

    def get(self, entry_id: str, *, user_id: str) -> Optional[ScratchpadEntry]:
        if not is_enabled():
            return None
        if not (entry_id and user_id):
            return None
        try:
            return store.get(entry_id, user_id=user_id)
        except Exception as e:
            logger.warning("scratchpad.get error: %s", e)
            return None

    def count_project(self, *, user_id: str, project_id: str) -> int:
        if not is_enabled():
            return 0
        if not (user_id and project_id):
            return 0
        try:
            return store.count_project(user_id=user_id, project_id=project_id)
        except Exception as e:
            logger.warning("scratchpad.count_project error: %s", e)
            return 0


# Module-level singleton — same convention as agent_tasks.client.
client = ScratchpadClient()


# Top-level conveniences for callers that don't want to import the class.
def append(**kwargs) -> Optional[ScratchpadEntry]:
    return client.append(**kwargs)


def list_project(**kwargs) -> list[ScratchpadEntry]:
    return client.list_project(**kwargs)


__all__ = ["ScratchpadClient", "client", "is_enabled", "append", "list_project"]
