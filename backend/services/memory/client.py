# coding: utf-8
# Phase M1 — MemoryClient: the single, stable public surface every caller
# uses for memory access.
#
# Today (M1):  delegates to backend.services.memory.store, which wraps the
#              legacy memory.py SQLite tables (user_memory, user_style).
# Tomorrow (M2): same calls, same signatures — but the store backs onto the
#              new threads / workspaces schema, and `workspace_id` becomes
#              meaningful instead of being accepted-and-ignored.
# Later (M3+): semantic recall / summarization slot in as separate Methods on
#              this same client. No caller has to change.
#
# Design rules:
#   * Every method that touches per-user data accepts `workspace_id` from M1
#     onward, even though it's ignored today. This is the multi-workspace
#     contract.
#   * Every method is non-raising. Failures log + bump counters and return
#     a sensible empty value.
#   * The client is stateless and cheap to instantiate; a module-level
#     `client` singleton is exposed for convenience, but anyone may construct
#     a fresh one in tests.
#   * Identical behavior to the legacy direct memory.py calls. This guarantees
#     a one-line rollback (flip ENABLE_NEW_MEMORY=false) recovers the prior
#     code path exactly.
from typing import Optional
import logging

from backend.services.memory import store, short_term
from backend.services.memory.types import (
    MemoryItem,
    StyleDef,
    WindowMessage,
    _DEFAULT_STYLE,
)

logger = logging.getLogger(__name__)

# Sentinel for the implicit "personal workspace" until M2 makes workspaces
# first-class. Callers may pass an explicit id; M1 ignores it.
DEFAULT_WORKSPACE_ID = "personal"


class MemoryClient:
    """Stable, future-proof public memory API.

    Multi-workspace ready: every method accepts `workspace_id`. M1 ignores it;
    M2 wires it into the persistent layer without touching call signatures.
    """

    # ── Episodic ─────────────────────────────────────────────────────────────

    def remember(
        self,
        user_id: str,
        content: str,
        *,
        kind: str = "fact",
        workspace_id: Optional[str] = None,
        source: Optional[str] = None,
    ) -> bool:
        return store.remember(
            user_id, content,
            kind=kind,
            workspace_id=workspace_id or DEFAULT_WORKSPACE_ID,
            source=source,
        )

    def recall(
        self,
        user_id: str,
        *,
        kind: Optional[str] = None,
        workspace_id: Optional[str] = None,
        limit: int = 15,
    ) -> list[MemoryItem]:
        return store.recall(
            user_id,
            kind=kind,
            workspace_id=workspace_id or DEFAULT_WORKSPACE_ID,
            limit=limit,
        )

    def forget(
        self,
        user_id: str,
        keyword: str,
        *,
        workspace_id: Optional[str] = None,
    ) -> int:
        return store.forget(
            user_id, keyword,
            workspace_id=workspace_id or DEFAULT_WORKSPACE_ID,
        )

    def summarize(
        self,
        user_id: str,
        *,
        workspace_id: Optional[str] = None,
    ) -> str:
        return store.summarize(
            user_id,
            workspace_id=workspace_id or DEFAULT_WORKSPACE_ID,
        )

    def list_for_user(
        self,
        user_id: str,
        *,
        workspace_id: Optional[str] = None,
        limit: int = 20,
    ) -> dict:
        """Shape expected by /memory route — preserves legacy keys."""
        items = self.recall(user_id, workspace_id=workspace_id, limit=limit)
        return {
            "user_id": user_id,
            "memory": [
                {
                    "category":   item.kind,
                    "content":    item.content,
                    "created_at": item.created_at,
                }
                for item in items
            ],
        }

    # ── Auto-learn ───────────────────────────────────────────────────────────

    def maybe_auto_learn(
        self,
        user_id: str,
        message: str,
        *,
        workspace_id: Optional[str] = None,
    ) -> None:
        store.auto_learn(
            user_id, message,
            workspace_id=workspace_id or DEFAULT_WORKSPACE_ID,
        )

    # ── Style ────────────────────────────────────────────────────────────────

    def detect_style(self, message: str) -> Optional[StyleDef]:
        """Stateless style classifier. No user_id needed."""
        return store.detect_style_def(message)

    def apply_style(self, user_id: str, message: str) -> Optional[StyleDef]:
        return store.apply_style(user_id, message)

    def get_style(self, user_id: str) -> StyleDef:
        return store.get_style(user_id)

    def style_prompt(self, user_id: str) -> str:
        return self.get_style(user_id).as_prompt()

    # ── Short-term conversation window (Phase A1 will use this) ──────────────

    def window_append(
        self,
        thread_id: str,
        role: str,
        content: str,
        *,
        metadata: Optional[dict] = None,
    ) -> None:
        short_term.append(
            thread_id,
            WindowMessage(role=role, content=content, metadata=metadata or {}),
        )

    def window_recent(self, thread_id: str, *, max_messages: int = 10) -> list[WindowMessage]:
        return short_term.recent(thread_id, max_messages=max_messages)

    def window_clear(self, thread_id: str) -> int:
        return short_term.clear(thread_id)

    # ── Observability ────────────────────────────────────────────────────────

    def stats(self) -> dict:
        return {
            "store":      store.store_stats(),
            "short_term": short_term.stats(),
            "default_workspace": DEFAULT_WORKSPACE_ID,
        }

    # ── Bootstrap ────────────────────────────────────────────────────────────

    def init(self) -> None:
        store.init()


# Module-level singleton — the canonical access path.
client: MemoryClient = MemoryClient()

# Best-effort bootstrap on import; non-fatal if it fails.
try:
    client.init()
except Exception as _e:
    logger.warning("memory.client: init failed: %s", _e)


__all__ = ["MemoryClient", "client", "DEFAULT_WORKSPACE_ID"]
