# coding: utf-8
# Phase M2 — SessionsClient: stable public surface for server-side session state.
#
# Mirrors the design of backend.services.memory.MemoryClient — the new code's
# entire surface goes through one client so M3 (Postgres) and beyond can
# migrate the backend without touching call sites.
#
# Today (M2): wraps backend.services.sessions.store, which writes to a
#             dedicated SQLite file (sessions.db by default).
# Tomorrow:   `store` may become a Postgres adapter; signatures unchanged.
import logging
from typing import Optional

from backend.services.sessions import store
from backend.services.sessions.types import (
    Workspace, Thread, Message,
    normalize_workspace_kind, normalize_thread_status, normalize_message_role,
)

logger = logging.getLogger(__name__)


class SessionsClient:
    """Public, stable API for workspaces / threads / messages."""

    # ── Workspaces ────────────────────────────────────────────────────────

    def create_workspace(
        self,
        user_id: str,
        *,
        name: str,
        kind: str = "personal",
        slug: Optional[str] = None,
        metadata: Optional[dict] = None,
    ) -> Workspace:
        return store.create_workspace(
            str(user_id), name=name, kind=kind, slug=slug, metadata=metadata,
        )

    def get_workspace(self, workspace_id: str) -> Optional[Workspace]:
        return store.get_workspace(workspace_id)

    def list_workspaces(
        self, user_id: str, *, include_archived: bool = False,
    ) -> list[Workspace]:
        return store.list_workspaces(str(user_id), include_archived=include_archived)

    def update_workspace(
        self, workspace_id: str, *, name: Optional[str] = None, kind: Optional[str] = None,
    ) -> Optional[Workspace]:
        return store.update_workspace(workspace_id, name=name, kind=kind)

    def archive_workspace(self, workspace_id: str) -> bool:
        return store.archive_workspace(workspace_id)

    def ensure_default_workspace(self, user_id: str) -> Workspace:
        return store.ensure_default_workspace(str(user_id))

    # ── Threads ───────────────────────────────────────────────────────────

    def create_thread(
        self, *, workspace_id: str, title: str = "New thread",
        mode: Optional[str] = None, metadata: Optional[dict] = None,
    ) -> Thread:
        return store.create_thread(
            workspace_id=workspace_id, title=title, mode=mode, metadata=metadata,
        )

    def get_thread(self, thread_id: str) -> Optional[Thread]:
        return store.get_thread(thread_id)

    def list_threads(
        self, workspace_id: str, *, include_archived: bool = False, limit: int = 50,
    ) -> list[Thread]:
        return store.list_threads(
            workspace_id, include_archived=include_archived, limit=limit,
        )

    def update_thread(
        self, thread_id: str, *, title: Optional[str] = None,
        mode: Optional[str] = None, status: Optional[str] = None,
        summary: Optional[str] = None,
    ) -> Optional[Thread]:
        return store.update_thread(
            thread_id, title=title, mode=mode, status=status, summary=summary,
        )

    def archive_thread(self, thread_id: str) -> bool:
        return store.archive_thread(thread_id)

    # ── Messages ──────────────────────────────────────────────────────────

    def append_message(
        self, *, thread_id: str, role: str, content: str,
        model: Optional[str] = None, tokens: Optional[int] = None,
        metadata: Optional[dict] = None,
    ) -> Message:
        return store.append_message(
            thread_id=thread_id, role=role, content=content,
            model=model, tokens=tokens, metadata=metadata,
        )

    def list_messages(
        self, thread_id: str, *, limit: int = 100, after_id: Optional[str] = None,
    ) -> list[Message]:
        return store.list_messages(thread_id, limit=limit, after_id=after_id)

    def get_message(self, message_id: str) -> Optional[Message]:
        return store.get_message(message_id)

    def delete_message(self, message_id: str) -> bool:
        return store.delete_message(message_id)

    # ── Observability ─────────────────────────────────────────────────────

    def stats(self) -> dict:
        return {
            "store":  store.store_stats(),
            "counts": store.table_counts(),
            "db_path": store.DB_PATH,
        }

    # ── Bootstrap ─────────────────────────────────────────────────────────

    def init(self) -> None:
        store.init()


client: SessionsClient = SessionsClient()

# Best-effort bootstrap on import; non-fatal if it fails.
try:
    client.init()
except Exception as _e:
    logger.warning("sessions.client: init failed: %s", _e)


__all__ = ["SessionsClient", "client"]
