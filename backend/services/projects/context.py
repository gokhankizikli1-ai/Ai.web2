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

# Hard cap to keep injected context bounded. Raised to ~6k chars (~1.5k tokens)
# so the Phase-2 block PLUS the Project Brain block (goals/decisions/products/
# connectors + bounded project-chat excerpts, itself capped at 4k) both fit
# without silently truncating chat evidence — still comfortably below any
# context window even paired with full chat history.
_MAX_CONTEXT_CHARS = 6000
_DEFAULT_MEMORY_LIMIT = 12


def _projects_enabled() -> bool:
    return os.getenv("ENABLE_PROJECTS", "false").strip().lower() == "true"


def _project_brain_block(project_id: str, user_id: Optional[str]) -> Optional[str]:
    """The Project Brain context block (goals/decisions/products/connectors +
    bounded project-CHAT excerpts), when ENABLE_PROJECT_BRAIN and a user id are
    present. This is the smallest existing seam that folds the brain aggregate
    into the LIVE chat system prompt — the same block `GET /v2/projects/{id}/context`
    exposes. Deterministic + bounded; NO model call. Ownership is enforced inside
    the brain (fail-closed), so cross-user/project content never leaks. Best-
    effort: any failure yields None and chat is unaffected."""
    if not user_id:
        return None
    try:
        from backend.services.project_brain import client as brain_client
        if not brain_client.is_enabled():
            return None
        block = brain_client.build_context(str(user_id), str(project_id))
        return block.text if block and block.text else None
    except Exception:
        return None


def build_project_context_block(
    project_id: str,
    *,
    memory_limit: int = _DEFAULT_MEMORY_LIMIT,
    user_id: Optional[str] = None,
) -> Optional[str]:
    """Return a system-prompt-ready string for `project_id`, or None.

    Composes, within bounds:
      • the Phase-2 project block (name/description + shared project memory), and
      • the Project Brain block (goals/decisions/products/connector signals +
        bounded project-CHAT excerpts) when ENABLE_PROJECT_BRAIN + `user_id`.

    Returns None when there is nothing useful to inject. Errors are swallowed and
    turned into None — chat must never break because of a missing/broken table.
    `user_id` is required for the brain part (owner-gated); omit it to get only
    the Phase-2 block.
    """
    if not project_id or not _projects_enabled():
        return None
    try:
        project = get_project(project_id)
    except Exception:
        return None
    if not project:
        return None

    try:
        memory = list_memory(project_id, limit=memory_limit, newest_first=True)
    except Exception:
        memory = []

    brain_block = _project_brain_block(project_id, user_id)

    if not project.description and not memory and not brain_block:
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

    if brain_block:
        lines.append("")
        lines.append(brain_block)

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

