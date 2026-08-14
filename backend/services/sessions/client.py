# coding: utf-8
# Phase M2 — SessionsClient: stable public surface for server-side session state.
# Phase 3  — dual backend: this client is the dispatch seam between the SQLite
#            store (dev/single-node fallback) and the Postgres store (shared,
#            cross-replica production truth for chat history).
#
# Mirrors the design of backend.services.memory.MemoryClient — the new code's
# entire surface goes through one client so the backend can migrate without
# touching call sites. Every caller (routes, sessions.auth, project_brain) goes
# through this client, so the dispatch here is the ONLY place backend selection
# lives — mirroring the jobs/billing dual-backend dispatchers.
#
# Backend selection (dynamic, per-call — a Railway env flip takes effect on the
# next request, matching the jobs store):
#   * Postgres (`store_pg`) when ENABLE_POSTGRES_BACKEND + DATABASE_URL are set
#     (`engine.is_enabled()`) — chat history is canonical + shared across replicas.
#   * SQLite (`store`) otherwise — the dev/single-node default.
import logging
from typing import Optional

from backend.services.db import engine
from backend.services.sessions import store
from backend.services.sessions.types import (
    Workspace, Thread, Message,
    normalize_workspace_kind, normalize_thread_status, normalize_message_role,
)

logger = logging.getLogger(__name__)


def current_backend() -> str:
    return "postgres" if engine.is_enabled() else "sqlite"


def _store():
    """The active backend module. Chosen dynamically so a Postgres enable/disable
    takes effect without a restart (same contract as jobs.store)."""
    if engine.is_enabled():
        from backend.services.sessions import store_pg
        return store_pg
    return store


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
        return _store().create_workspace(
            str(user_id), name=name, kind=kind, slug=slug, metadata=metadata,
        )

    def get_workspace(self, workspace_id: str) -> Optional[Workspace]:
        return _store().get_workspace(workspace_id)

    def list_workspaces(
        self, user_id: str, *, include_archived: bool = False,
    ) -> list[Workspace]:
        return _store().list_workspaces(str(user_id), include_archived=include_archived)

    def update_workspace(
        self, workspace_id: str, *, name: Optional[str] = None, kind: Optional[str] = None,
    ) -> Optional[Workspace]:
        return _store().update_workspace(workspace_id, name=name, kind=kind)

    def archive_workspace(self, workspace_id: str) -> bool:
        return _store().archive_workspace(workspace_id)

    def ensure_default_workspace(self, user_id: str) -> Workspace:
        return _store().ensure_default_workspace(str(user_id))

    # ── Threads ───────────────────────────────────────────────────────────

    def create_thread(
        self, *, workspace_id: str, title: str = "New thread",
        mode: Optional[str] = None, metadata: Optional[dict] = None,
    ) -> Thread:
        return _store().create_thread(
            workspace_id=workspace_id, title=title, mode=mode, metadata=metadata,
        )

    def get_thread(self, thread_id: str) -> Optional[Thread]:
        return _store().get_thread(thread_id)

    def list_threads(
        self, workspace_id: str, *, include_archived: bool = False, limit: int = 50,
    ) -> list[Thread]:
        return _store().list_threads(
            workspace_id, include_archived=include_archived, limit=limit,
        )

    def update_thread(
        self, thread_id: str, *, title: Optional[str] = None,
        mode: Optional[str] = None, status: Optional[str] = None,
        summary: Optional[str] = None,
    ) -> Optional[Thread]:
        return _store().update_thread(
            thread_id, title=title, mode=mode, status=status, summary=summary,
        )

    def archive_thread(self, thread_id: str) -> bool:
        return _store().archive_thread(thread_id)

    # ── Messages ──────────────────────────────────────────────────────────

    def append_message(
        self, *, thread_id: str, role: str, content: str,
        model: Optional[str] = None, tokens: Optional[int] = None,
        metadata: Optional[dict] = None, client_message_id: Optional[str] = None,
    ) -> Message:
        return _store().append_message(
            thread_id=thread_id, role=role, content=content,
            model=model, tokens=tokens, metadata=metadata,
            client_message_id=client_message_id,
        )

    def list_messages(
        self, thread_id: str, *, limit: int = 100, after_id: Optional[str] = None,
    ) -> list[Message]:
        return _store().list_messages(thread_id, limit=limit, after_id=after_id)

    def get_message(self, message_id: str) -> Optional[Message]:
        return _store().get_message(message_id)

    def delete_message(self, message_id: str) -> bool:
        return _store().delete_message(message_id)

    # ── Observability ─────────────────────────────────────────────────────

    def stats(self) -> dict:
        st = _store()
        return {
            "backend": current_backend(),
            "store":  st.store_stats(),
            "counts": st.table_counts(),
            "db_path": getattr(st, "DB_PATH", "postgres"),
        }

    # ── Bootstrap ─────────────────────────────────────────────────────────

    def init(self) -> None:
        # Initialize the ACTIVE backend. When Postgres is selected but transiently
        # unreachable this raises — callers (import-time bootstrap) catch it, and
        # the SQLite import-time init still guarantees the dev schema exists.
        _store().init()


client: SessionsClient = SessionsClient()

# Best-effort bootstrap on import; non-fatal if it fails.
try:
    client.init()
except Exception as _e:
    logger.warning("sessions.client: init failed: %s", _e)


__all__ = ["SessionsClient", "client"]
