# coding: utf-8
"""Phase 9 — AgentMessengerClient public surface.

Writes go through send(); reads through list_panel(). Every send()
publishes an `agent_message.posted` event on the bus AFTER the DB
insert succeeds so subscribers can rely on "if the event fired, the
message is persisted."
"""
from __future__ import annotations

import logging
import os
from typing import Optional

from backend.services.agent_messenger import store
from backend.services.agent_messenger.types import (
    AgentMessage, normalize_message_type, MSG_REQUEST,
)


logger = logging.getLogger(__name__)


def is_enabled() -> bool:
    """Gated by ENABLE_REAL_COORDINATION — same flag as the panel
    concept, since they only make sense together."""
    return os.getenv("ENABLE_REAL_COORDINATION", "false").strip().lower() == "true"


class AgentMessengerClient:

    def init(self) -> None:
        if is_enabled():
            store.init()

    def is_enabled(self) -> bool:
        return is_enabled()

    # ── Writes ─────────────────────────────────────────────────────────────

    def send(
        self,
        *,
        panel_id:     str,
        user_id:      str,
        from_agent:   str,
        to_agent:     str,
        content:      str = "",
        message_type: str = MSG_REQUEST,
        in_reply_to:  Optional[str] = None,
        payload:      Optional[dict] = None,
    ) -> Optional[AgentMessage]:
        """Record + broadcast one envelope. Returns the persisted
        record on success, None otherwise (disabled / missing fields /
        DB error). Never raises — the caller is the agent runtime and
        a logging failure must not abort the run."""
        if not is_enabled():
            return None
        if not (panel_id and user_id and from_agent and to_agent):
            return None
        c = (content or "").strip()
        p = dict(payload or {})
        # Empty payload AND empty content is meaningless — refuse so
        # the message log stays a useful timeline.
        if not c and not p:
            return None
        try:
            msg = AgentMessage(
                panel_id=    panel_id,
                user_id=     user_id,
                from_agent=  from_agent,
                to_agent=    to_agent,
                message_type= normalize_message_type(message_type),
                content=     c,
                in_reply_to= in_reply_to,
                payload=     p,
            )
            persisted = store.insert(msg)
        except Exception as e:
            logger.warning("agent_messenger.send DB error: %s", e)
            return None

        # Bus publish — never blocks the write.
        try:
            from backend.services.events import bus as _bus
            from backend.services.events.types import ActivityEvent
            _bus.publish(ActivityEvent(
                kind="agent_message.posted",
                scope=f"panel:{panel_id}",
                agent_id=from_agent,
                payload={
                    "id":           persisted.id,
                    "panel_id":     panel_id,
                    "from_agent":   from_agent,
                    "to_agent":     to_agent,
                    "message_type": persisted.message_type,
                    "in_reply_to":  in_reply_to,
                    # Don't ship the full content on the bus — keep
                    # the event small. SSE clients can fetch the
                    # message body via /v2/panels/{id}/messages.
                    "content_chars": len(persisted.content or ""),
                },
            ))
        except Exception as e:
            logger.debug("agent_messenger.send bus publish failed: %s", e)

        return persisted

    # ── Reads ──────────────────────────────────────────────────────────────

    def list_panel(
        self,
        *,
        panel_id:     str,
        user_id:      str,
        limit:        int = 100,
        offset:       int = 0,
        newest_first: bool = False,
    ) -> list[AgentMessage]:
        if not is_enabled():
            return []
        if not (panel_id and user_id):
            return []
        try:
            return store.list_panel(
                panel_id=panel_id, user_id=user_id,
                limit=limit, offset=offset,
                newest_first=newest_first,
            )
        except Exception as e:
            logger.warning("agent_messenger.list_panel error: %s", e)
            return []


client = AgentMessengerClient()


__all__ = ["AgentMessengerClient", "client", "is_enabled"]
