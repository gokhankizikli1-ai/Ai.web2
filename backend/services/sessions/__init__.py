# coding: utf-8
# Phase M2 — Sessions service package.
#
# Public API:
#   from backend.services.sessions import client, Workspace, Thread, Message
#
# Internal modules:
#   types.py    dataclasses + allowed-value taxonomies
#   store.py    SQLite adapter (new `sessions.db` file by default)
#   client.py   SessionsClient — the stable public surface
#
# Feature flag (read by backend/routes/sessions.py):
#   ENABLE_SESSIONS=true   → /sessions/* routes are live
#   default / unset / false → /sessions/* routes return 503
#                              with a clear message; nothing else changes
from backend.services.sessions.client import client, SessionsClient
from backend.services.sessions.types import (
    Workspace, Thread, Message,
    WORKSPACE_KINDS, THREAD_STATUSES, MESSAGE_ROLES,
    normalize_workspace_kind, normalize_thread_status, normalize_message_role,
)

__all__ = [
    "client", "SessionsClient",
    "Workspace", "Thread", "Message",
    "WORKSPACE_KINDS", "THREAD_STATUSES", "MESSAGE_ROLES",
    "normalize_workspace_kind", "normalize_thread_status", "normalize_message_role",
]
