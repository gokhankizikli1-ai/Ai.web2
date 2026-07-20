# coding: utf-8
"""
Billing processor — handler registry (PR 2).

The seam future PRs extend: a mapping from Lemon Squeezy `event_name` to a
handler callable. PR 2 ships the framework and safe acknowledgement handlers
for the known event types; the actual entitlement / credit / subscription
logic is deliberately NOT here (it lands in a later PR that registers real
handlers against these same names).

Handler contract:

    def handle(event: WebhookEvent, payload: dict) -> None:
        ...  # raise to signal failure (the event is marked failed + retried)

  * Handlers MUST be idempotent. The engine guarantees at-most-one CONCURRENT
    processing per event (atomic claim) and at-least-once overall (retry on
    failure), so a handler can legitimately run more than once for the same
    delivery — e.g. a success that crashes before the terminal DB write.
  * A handler that returns normally ⇒ the event is marked `processed`.
  * A handler that raises ⇒ the event is marked `failed` (with the error
    message) and becomes reprocessable until the attempt cap is hit.
  * An event whose `event_name` has NO registered handler is acknowledged
    (marked `processed`) — it was durably stored in PR 1 and there is simply
    nothing to do yet. A later PR that adds a handler can replay it via the
    owner retry endpoint.

Registration is process-local and happens at import time (see handlers.py).
"""
from __future__ import annotations

import logging
import threading
from typing import Callable, Dict, List, Optional

from backend.services.billing.types import WebhookEvent


logger = logging.getLogger(__name__)

# handler(event, payload) -> None
Handler = Callable[[WebhookEvent, dict], None]

_LOCK = threading.Lock()
_HANDLERS: Dict[str, Handler] = {}


def register(event_name: str, fn: Handler, *, replace: bool = False) -> None:
    """Register `fn` as the handler for `event_name`.

    Raises ValueError on a duplicate registration unless `replace=True`, so an
    accidental double-register (two PRs claiming the same event) is loud
    rather than silently shadowing.
    """
    name = (event_name or "").strip()
    if not name:
        raise ValueError("register: event_name is required")
    if not callable(fn):
        raise ValueError("register: fn must be callable")
    with _LOCK:
        if name in _HANDLERS and not replace:
            raise ValueError(f"register: handler already registered for {name!r}")
        _HANDLERS[name] = fn
    logger.debug("billing.processor registered handler for %s", name)


def handler(event_name: str, *, replace: bool = False) -> Callable[[Handler], Handler]:
    """Decorator form of register().

        @handler("subscription_created")
        def on_subscription_created(event, payload): ...
    """
    def _wrap(fn: Handler) -> Handler:
        register(event_name, fn, replace=replace)
        return fn
    return _wrap


def get_handler(event_name: str) -> Optional[Handler]:
    with _LOCK:
        return _HANDLERS.get((event_name or "").strip())


def registered_event_names() -> List[str]:
    with _LOCK:
        return sorted(_HANDLERS.keys())


def _reset_for_tests() -> None:
    with _LOCK:
        _HANDLERS.clear()


__all__ = [
    "Handler", "register", "handler", "get_handler",
    "registered_event_names", "_reset_for_tests",
]
