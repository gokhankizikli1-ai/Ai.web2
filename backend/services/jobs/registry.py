# coding: utf-8
"""
Phase 7 — Job kind registry.

Maps job `kind` strings to async handler functions. Handlers receive a
`JobContext` (the live JobRecord + a progress callback + a cancellation
check) and return a dict that becomes `result`.

Design rules:
  * Handlers are async. Sync work belongs in `asyncio.to_thread(...)`
    inside the handler.
  * Handlers MUST raise on error (with a clear message). The runner
    catches and converts to a structured `error` field.
  * Handlers SHOULD call `ctx.report_progress(n, label)` periodically
    so SSE consumers see live updates and so cancellation has a
    natural check-point.
  * Handlers SHOULD check `ctx.is_cancelled()` between phases.
  * Registration uses the `@register_job("kind_name")` decorator so
    handlers self-register on import.

Kinds are case-insensitive but stored verbatim — pick a stable
snake_case name. Once a kind is shipped, do NOT rename it (old job
rows in the DB still reference the old name).
"""
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import Awaitable, Callable, Optional

from backend.services.jobs.errors import JobKindUnknown
from backend.services.jobs.types import JobRecord


logger = logging.getLogger(__name__)


# ── Job context ──────────────────────────────────────────────────────────────

@dataclass
class JobContext:
    """Runtime context passed to a handler.

    `record` is the JobRecord as it stood when execution started. The
    `report_progress` callback writes to the store + emits an SSE
    event; `is_cancelled` peeks the latest DB state to allow handlers
    to bail out of long loops.
    """
    record: JobRecord
    report_progress: Callable[[int, Optional[str]], Awaitable[None]]
    is_cancelled:    Callable[[], Awaitable[bool]]


JobHandler = Callable[[JobContext], Awaitable[dict]]


# ── Registry ─────────────────────────────────────────────────────────────────

_REGISTRY: dict[str, JobHandler] = {}


def register_job(kind: str) -> Callable[[JobHandler], JobHandler]:
    """Decorator: register a handler under one kind name. Multiple
    registrations of the same kind raise — surface duplicate names
    immediately rather than letting one silently win."""
    if not kind or not isinstance(kind, str):
        raise ValueError("register_job: kind must be a non-empty string")
    norm = kind.strip().lower()

    def decorator(fn: JobHandler) -> JobHandler:
        if not asyncio.iscoroutinefunction(fn):
            raise TypeError(
                f"register_job({norm!r}): handler must be `async def`. "
                f"Wrap sync work in asyncio.to_thread inside the handler."
            )
        if norm in _REGISTRY:
            raise RuntimeError(
                f"register_job({norm!r}): kind already registered to "
                f"{_REGISTRY[norm].__module__}.{_REGISTRY[norm].__qualname__}"
            )
        _REGISTRY[norm] = fn
        logger.info("jobs.registry registered | kind=%s | handler=%s",
                    norm, fn.__qualname__)
        return fn
    return decorator


def get_handler(kind: str) -> JobHandler:
    """Resolve a kind to its handler. Raises JobKindUnknown if not
    registered."""
    norm = (kind or "").strip().lower()
    handler = _REGISTRY.get(norm)
    if handler is None:
        raise JobKindUnknown(
            f"Job kind {norm!r} is not registered.",
            details={"kind": norm, "available": list(_REGISTRY.keys())},
        )
    return handler


def is_registered(kind: str) -> bool:
    return (kind or "").strip().lower() in _REGISTRY


def known_kinds() -> list[str]:
    return sorted(_REGISTRY.keys())


def _reset_for_tests() -> None:
    """Test-only: clear the registry so each test starts fresh."""
    _REGISTRY.clear()


__all__ = [
    "JobContext", "JobHandler",
    "register_job", "get_handler", "is_registered", "known_kinds",
    "_reset_for_tests",
]
