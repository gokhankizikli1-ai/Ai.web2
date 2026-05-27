# coding: utf-8
"""
Phase 9 — Agent-to-agent typed messaging.

Sits ABOVE events/bus. The bus carries free-form ActivityEvents
(observability); this layer adds:

  - typed message types (request / response / propose / revise /
    approve / reject / final) the FE can render as semantic chips
    instead of raw JSON.
  - persistent log (agent_messages.db) so the FE can hydrate panel
    history on reload without replaying every bus event since boot.

The bus and the log are written in lockstep — the log is the source
of truth on reload; the bus is the live push channel.
"""
from backend.services.agent_messenger.client import (
    AgentMessengerClient, client, is_enabled,
)
from backend.services.agent_messenger.types import (
    AgentMessage, AGENT_MESSAGE_TYPES, normalize_message_type,
    MSG_REQUEST, MSG_RESPONSE, MSG_PROPOSE, MSG_REVISE,
    MSG_APPROVE, MSG_REJECT, MSG_FINAL,
)

__all__ = [
    "AgentMessengerClient", "client", "is_enabled",
    "AgentMessage", "AGENT_MESSAGE_TYPES", "normalize_message_type",
    "MSG_REQUEST", "MSG_RESPONSE", "MSG_PROPOSE", "MSG_REVISE",
    "MSG_APPROVE", "MSG_REJECT", "MSG_FINAL",
]
