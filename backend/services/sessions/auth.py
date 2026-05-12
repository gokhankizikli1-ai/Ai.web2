# coding: utf-8
"""
Ownership assertions for auth-bound sessions (Phase 5).

These helpers gate every /v2/sessions/* route. Their job is twofold:

  1. Refuse access when the caller's authenticated user does not own
     the resource being addressed.
  2. NEVER leak existence. A cross-user access returns the same
     NotFoundError (404) as a truly-missing resource — never a 403
     "Forbidden" that would confirm "this id exists but isn't yours".

Three helpers:

  workspace_or_404(workspace_id, user_id) -> Workspace
  thread_or_404(thread_id, user_id)       -> Thread
  thread_workspace_or_404(thread_id, user_id) -> (Thread, Workspace)

All three call into the existing sessions storage; the only new
behaviour is the ownership check on top.
"""
from __future__ import annotations

import logging
from typing import Tuple

from backend.services.auth.identity import User
from backend.services.sessions import client as sessions_client
from backend.services.sessions.types import Thread, Workspace
from backend.core.errors import NotFoundError


logger = logging.getLogger(__name__)


def workspace_or_404(workspace_id: str, user: User) -> Workspace:
    """Return the workspace if it exists AND belongs to `user`.

    Raises NotFoundError otherwise. The error message intentionally
    does NOT vary by reason so a probe can't distinguish "doesn't
    exist" from "exists but belongs to someone else".
    """
    ws = sessions_client.get_workspace(workspace_id)
    if ws is None or ws.user_id != user.id:
        if ws is not None and ws.user_id != user.id:
            # Log the ownership mismatch for security review, never
            # surface it to the caller.
            logger.info(
                "v2.sessions.workspace_or_404 | owner_mismatch | "
                "workspace=%s | owner=%s | requester=%s",
                workspace_id, ws.user_id, user.id,
            )
        raise NotFoundError(f"workspace '{workspace_id}' not found")
    return ws


def thread_or_404(thread_id: str, user: User) -> Thread:
    """Return the thread if it exists AND its workspace belongs to
    `user`. Same ownership-hiding rule as workspace_or_404."""
    th = sessions_client.get_thread(thread_id)
    if th is None:
        raise NotFoundError(f"thread '{thread_id}' not found")
    # Threads are owned transitively through their workspace.
    ws = sessions_client.get_workspace(th.workspace_id)
    if ws is None or ws.user_id != user.id:
        logger.info(
            "v2.sessions.thread_or_404 | owner_mismatch | "
            "thread=%s | workspace=%s | requester=%s",
            thread_id, th.workspace_id, user.id,
        )
        raise NotFoundError(f"thread '{thread_id}' not found")
    return th


def thread_workspace_or_404(thread_id: str, user: User) -> Tuple[Thread, Workspace]:
    """Combined lookup — returns (thread, workspace) when both exist
    AND the workspace belongs to `user`. Used by routes that need
    both objects without a second DB round-trip."""
    th = thread_or_404(thread_id, user)
    ws = workspace_or_404(th.workspace_id, user)
    return th, ws


__all__ = [
    "workspace_or_404",
    "thread_or_404",
    "thread_workspace_or_404",
]
