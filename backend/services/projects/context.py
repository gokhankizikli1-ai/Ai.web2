# coding: utf-8
# Phase 2 — Project context builder.
#
# When /chat receives a project_id, we inject a compact "Project
# Context" block into the system prompt so the LLM has shared
# project memory across all chats/agents within that project.
#
# Cheap, sufficient version (no embeddings yet — Phase 6):
#   • Pull project metadata (name, description).
#   • Pull the N most-recent memory entries (default 12).
#   • Render as a markdown-like block.
#
# Truncated to ~MAX_CONTEXT_CHARS so we never blow the context window
# even with a large memory store.
#
# Threading the project context from chat.py down to ask_ai() uses a
# ContextVar so we don't have to add an extra parameter to every
# branch of ai_service.process_chat() (which has ~15 system-prompt
# build paths). ask_ai() reads the ContextVar at call time and
# prepends the block to the system prompt.

import os
from contextvars import ContextVar
from typing import Optional

from backend.services.projects.store import get_project, list_memory

# Hard cap to keep injected context bounded. ~3.5k chars ≈ ~900 tokens,
# comfortably below any context window even paired with full chat history.
_MAX_CONTEXT_CHARS = 3500
_DEFAULT_MEMORY_LIMIT = 12


def _projects_enabled() -> bool:
    return os.getenv("ENABLE_PROJECTS", "false").strip().lower() == "true"


def build_project_context_block(
    project_id: str,
    *,
    owner_user_id: Optional[str] = None,
    memory_limit: int = _DEFAULT_MEMORY_LIMIT,
) -> Optional[str]:
    """Return a system-prompt-ready string for `project_id`, or None.

    Returns None when:
      • ENABLE_PROJECTS is off (silent no-op so chat doesn't break)
      • project_id is empty / unknown
      • the project has no description AND no memory entries
        (no useful context to inject)
    Errors are swallowed and turned into None — chat must never break
    because of a missing/broken projects table.
    """
    if not project_id or not _projects_enabled():
        return None
    try:
        project = get_project(project_id)
    except Exception:
        return None
    if not project:
        return None
    if owner_user_id is not None and project.owner_user_id != str(owner_user_id):
        return None

    try:
        memory = list_memory(project_id, limit=memory_limit, newest_first=True)
    except Exception:
        memory = []

    if not project.description and not memory:
        return None

    lines = [f"[Project Context — {project.name}]"]
    if project.description:
        lines.append(project.description.strip())

    if memory:
        lines.append("")
        lines.append("Shared project memory (most recent first):")
        for entry in memory:
            tag = entry.kind if entry.kind != "note" else ""
            prefix = f"- ({tag}) " if tag else "- "
            lines.append(prefix + entry.content.strip())

    block = "\n".join(lines).strip()
    if len(block) > _MAX_CONTEXT_CHARS:
        block = block[: _MAX_CONTEXT_CHARS - 20].rstrip() + "\n…[truncated]"
    return block


# ── ContextVar transport ──────────────────────────────────────────────────
#
# The Project Context block flows from chat.py (which knows project_id)
# down to ask_ai() (which assembles the final system prompt to send to
# the LLM) through this ContextVar. Per-request scoped, never leaks
# between concurrent requests.

_CURRENT_PROJECT_CONTEXT: ContextVar[str] = ContextVar(
    "korvix_project_context", default="",
)


def set_current_project_context(block: Optional[str]):
    """Push a context block for the current request; returns a reset token.

    Always returns a token (even when `block` is falsy) so callers can
    unconditionally `reset` in a finally block without a None check.
    """
    return _CURRENT_PROJECT_CONTEXT.set(block or "")


def reset_current_project_context(token) -> None:
    """Pop the per-request context block. Idempotent and exception-safe."""
    try:
        _CURRENT_PROJECT_CONTEXT.reset(token)
    except Exception:
        pass


def get_current_project_context() -> str:
    """Return the current per-request project context (empty string if none)."""
    try:
        return _CURRENT_PROJECT_CONTEXT.get()
    except Exception:
        return ""

