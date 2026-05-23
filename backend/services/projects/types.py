# coding: utf-8
# Phase 2 — Project types (dataclasses).
#
# Same style as backend/services/sessions/types.py:
# • plain dataclasses (no Pydantic at the store layer — Pydantic is for
#   the route boundary only)
# • TEXT primary keys + ISO-8601 UTC timestamps (Postgres-portable)
# • metadata_json is the escape hatch for additive fields without
#   schema changes

from dataclasses import dataclass, field
from typing import Optional


VALID_PROJECT_STATUSES = ("active", "archived")
VALID_MEMORY_KINDS = (
    "note",         # free-form user note
    "fact",         # something the user told us is true about the project
    "decision",     # a decision the team made
    "agent_note",   # something an agent wrote for itself / its peers
    "file_summary", # summary of an uploaded file (Phase 2.5)
    "system",       # automatically injected (e.g. "Project created on …")
)
VALID_MEMORY_SOURCES = ("user", "agent", "tool", "system")


def normalize_status(status: Optional[str], *, default: str = "active") -> str:
    s = (status or "").strip().lower()
    return s if s in VALID_PROJECT_STATUSES else default


def normalize_memory_kind(kind: Optional[str], *, default: str = "note") -> str:
    k = (kind or "").strip().lower()
    return k if k in VALID_MEMORY_KINDS else default


def normalize_memory_source(source: Optional[str], *, default: str = "user") -> str:
    s = (source or "").strip().lower()
    return s if s in VALID_MEMORY_SOURCES else default


@dataclass
class Project:
    id:             str
    owner_user_id:  str
    name:           str
    description:    str
    status:         str
    created_at:     str
    updated_at:     str
    archived_at:    Optional[str]
    metadata:       dict = field(default_factory=dict)


@dataclass
class ProjectAgent:
    id:             str
    project_id:     str
    name:           str
    role:           str
    system_prompt:  str
    model_hint:     str
    color:          str
    icon:           str
    created_at:     str
    updated_at:     str
    metadata:       dict = field(default_factory=dict)


@dataclass
class ProjectMemoryEntry:
    id:           str
    project_id:   str
    kind:         str
    content:      str
    source:       str
    created_at:   str
    metadata:     dict = field(default_factory=dict)


@dataclass
class ProjectThreadLink:
    project_id:   str
    thread_id:    str
    added_at:     str


@dataclass
class ProjectFile:
    id:           str
    project_id:   str
    path:         str
    sha256:       str
    size_bytes:   int
    mime:         str
    storage_url:  str
    created_at:   str
    metadata:     dict = field(default_factory=dict)
