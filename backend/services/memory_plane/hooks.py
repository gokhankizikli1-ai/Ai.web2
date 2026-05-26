# coding: utf-8
"""
Phase 6 — Chat / agent integration hooks.

These hooks are the *only* surface the rest of the codebase imports
when they want to integrate with the memory plane (extracting from a
chat turn, fetching context for prompt injection, etc.).

Every hook:
  * Is a no-op when ENABLE_MEMORY_PLANE is off (the client gate
    already handles this — the hook just adds a thin try/except
    so a memory failure NEVER breaks chat).
  * Returns a small, JSON-serialisable structure so it can be
    surfaced in /v2/admin/diagnostics without extra plumbing.
  * Logs at INFO when something interesting happened (memories
    extracted / context injected) and WARNING on failure.

The chat orchestrator integration is intentionally NOT wired in this
PR. We provide the hooks; turning them on is a one-line edit at the
chat callsite. The PR boundary stays "memory plane lands; nothing in
chat changes" which is what Phase 6 spec asked for.
"""
from __future__ import annotations

import logging
from typing import Optional

from backend.services.memory_plane.client import client as _client
from backend.services.memory_plane.types import MemoryRecord


logger = logging.getLogger(__name__)


def on_user_message(
    *,
    user_id: str,
    message: str,
    project_id: Optional[str] = None,
    agent_id: Optional[str] = None,
) -> list[MemoryRecord]:
    """Call this AFTER a user message is fully received and saved to
    the chat log. Runs the heuristic extractor + persists candidates.

    Never raises. Returns the list of newly-persisted records (may be
    empty). Safe to invoke regardless of the feature flag — when off
    it short-circuits to `[]` inside the client.

    Typical integration (single line in chat orchestrator):

        from backend.services.memory_plane.hooks import on_user_message
        on_user_message(user_id=user.id, message=user_msg,
                        project_id=workspace.id)
    """
    try:
        return _client.extract_and_store(
            user_id=    str(user_id),
            message=    message,
            role=       "user",
            project_id= project_id,
            agent_id=   agent_id,
        )
    except Exception as e:
        logger.warning("memory_plane.hooks.on_user_message error: %s", e)
        return []


def on_assistant_message(
    *,
    user_id: str,
    message: str,
    project_id: Optional[str] = None,
    agent_id: Optional[str] = None,
) -> list[MemoryRecord]:
    """Call this AFTER an assistant reply is produced. Extracts
    facts the assistant claimed (e.g. "I shipped X") so future
    turns can reference them.

    Assistant-side extraction uses lower default importance — we're
    recording what the assistant said, not necessarily what the user
    confirmed."""
    try:
        return _client.extract_and_store(
            user_id=    str(user_id),
            message=    message,
            role=       "assistant",
            project_id= project_id,
            agent_id=   agent_id,
        )
    except Exception as e:
        logger.warning("memory_plane.hooks.on_assistant_message error: %s", e)
        return []


def build_context_block(
    *,
    user_id: str,
    project_id: Optional[str] = None,
    agent_id: Optional[str] = None,
    query: Optional[str] = None,
    limit: int = 5,
) -> Optional[str]:
    """Return a compact "Known memories" block ready to prepend to a
    system prompt. None when there is nothing to inject.

    Each line is intentionally short (<200 chars) and prefixed with a
    bullet so the model treats it as background context, not a
    directive. Importance + recency drive the ranking.

    Designed for direct concatenation:

        block = build_context_block(user_id=..., project_id=...)
        if block:
            system_prompt = block + "\n\n" + system_prompt
    """
    try:
        recs = _client.top_for_context(
            user_id,
            project_id=project_id,
            agent_id=  agent_id,
            query=     query,
            limit=     int(max(1, min(20, limit))),
        )
    except Exception as e:
        logger.warning("memory_plane.hooks.build_context_block error: %s", e)
        return None
    if not recs:
        return None
    lines = ["[Known about the user — use naturally, never as a list]"]
    for r in recs:
        # Trim aggressively so we never balloon the system prompt.
        content = (r.content or "").strip()
        if not content:
            continue
        lines.append(f"- {content[:180]}")
    if len(lines) == 1:
        return None
    return "\n".join(lines)


__all__ = [
    "on_user_message",
    "on_assistant_message",
    "build_context_block",
]
