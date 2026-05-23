# coding: utf-8
# Phase 3.2 — Event bus public API.
#
# Gated by ENABLE_REALTIME_EVENTS=false (default off). When the flag
# is off:
#   - publish() / emit() are no-ops (immediate return, no allocation)
#   - subscribe() returns an inert Subscription whose queue never fills
# When the flag is on:
#   - publish() fans out to all matching subscribers
#   - subscribe() registers the queue in the bus's scope index

from backend.services.events.types import ActivityEvent, EVENT_KINDS
from backend.services.events.bus import (
    InProcessEventBus,
    Subscription,
    is_enabled,
    bus,
    emit,
)

__all__ = [
    "ActivityEvent",
    "EVENT_KINDS",
    "InProcessEventBus",
    "Subscription",
    "is_enabled",
    "bus",
    "emit",
]
