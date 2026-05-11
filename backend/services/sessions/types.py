# coding: utf-8
# Phase M2 — Sessions service typed payloads.
#
# Sister of backend/services/memory/types.py. Holds the data model for
# server-side conversation state: Workspace → Thread → Message.
#
# These types are the contract every M2+ caller speaks. M3 will migrate
# memory_items into the same DB so cross-table joins (per-workspace memory
# recall) become trivial without changing these shapes.
from dataclasses import dataclass, field, asdict
from typing import Any, Optional


# ── Allowed values ──────────────────────────────────────────────────────────

WORKSPACE_KINDS = (
    "personal",   # default user space
    "trading",    # trading desk workspace
    "ecommerce",  # store / dropshipping workspace
    "startup",    # startup planning workspace
    "research",   # research notes workspace
    "writing",    # long-form drafts
    "coding",     # code-mode workspace
    "custom",     # user-named space
)

THREAD_STATUSES = ("active", "archived", "deleted")

MESSAGE_ROLES = ("user", "assistant", "system", "tool")


def normalize_workspace_kind(kind: Optional[str]) -> str:
    if not kind:
        return "personal"
    k = kind.lower().strip()
    return k if k in WORKSPACE_KINDS else "custom"


def normalize_thread_status(status: Optional[str]) -> str:
    if not status:
        return "active"
    s = status.lower().strip()
    return s if s in THREAD_STATUSES else "active"


def normalize_message_role(role: Optional[str]) -> str:
    if not role:
        return "user"
    r = role.lower().strip()
    return r if r in MESSAGE_ROLES else "user"


# ── Data classes ────────────────────────────────────────────────────────────

@dataclass
class Workspace:
    id:            str
    user_id:       str
    name:          str
    slug:          str
    kind:          str = "personal"
    created_at:    Optional[str] = None
    updated_at:    Optional[str] = None
    archived_at:   Optional[str] = None
    metadata:      dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class Thread:
    id:            str
    workspace_id:  str
    title:         str = "New thread"
    mode:          Optional[str] = None
    status:        str = "active"
    summary:       Optional[str] = None
    created_at:    Optional[str] = None
    updated_at:    Optional[str] = None
    archived_at:   Optional[str] = None
    metadata:      dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class Message:
    id:            str
    thread_id:     str
    role:          str
    content:       str
    created_at:    Optional[str] = None
    tokens:        Optional[int] = None
    model:         Optional[str] = None
    metadata:      dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return asdict(self)


__all__ = [
    "Workspace", "Thread", "Message",
    "WORKSPACE_KINDS", "THREAD_STATUSES", "MESSAGE_ROLES",
    "normalize_workspace_kind", "normalize_thread_status", "normalize_message_role",
]
