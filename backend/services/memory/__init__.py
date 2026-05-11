# coding: utf-8
# Phase M1 — Memory service package.
#
# Public API: import from this package, not from internal modules.
#
#   from backend.services.memory import client, MemoryItem, StyleDef
#
# Internal modules:
#   types.py        — dataclasses + memory kind taxonomy
#   store.py        — SQLite adapter (wraps legacy memory.py in M1)
#   short_term.py   — in-process conversation window (per-thread)
#   client.py       — MemoryClient: the stable public surface
#
# Feature flag (lives in backend/services/memory_service.py, not here):
#   ENABLE_NEW_MEMORY=true  → memory_service delegates to this package
#   default / off           → legacy memory.py code path runs (identical
#                              behavior; one-line rollback)
from backend.services.memory.client import client, MemoryClient, DEFAULT_WORKSPACE_ID
from backend.services.memory.types import (
    MemoryItem,
    StyleDef,
    WindowMessage,
    MEMORY_KINDS,
    normalize_kind,
)

__all__ = [
    "client",
    "MemoryClient",
    "DEFAULT_WORKSPACE_ID",
    "MemoryItem",
    "StyleDef",
    "WindowMessage",
    "MEMORY_KINDS",
    "normalize_kind",
]
