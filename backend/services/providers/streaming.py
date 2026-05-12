# coding: utf-8
"""
Provider streaming event types (Phase 4a).

Providers that implement `stream_chat_completion()` yield instances of
these dataclasses. The SSE route translates each into an SSE frame
without leaking provider-specific shape into the wire protocol.

Event taxonomy:

  ProviderStreamStart    Emitted once when the upstream connection is
                         established. Carries provider name + model id
                         the upstream actually selected (may differ
                         from the requested model when fallback kicks in).

  ProviderStreamToken    Incremental content delta. Yielded zero or
                         more times. `delta` is the new content chunk
                         (NOT the cumulative text); the client is
                         responsible for concatenating.

  ProviderStreamDone     Terminal success. Carries finish_reason +
                         usage block. After this, the generator stops.

  ProviderStreamError    Terminal failure. Carries the
                         `ProviderError`-derived code + message. After
                         this, the generator stops. The SSE route emits
                         it as an `error` frame.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, Optional, Union

from backend.services.providers.types import ProviderUsage


@dataclass
class ProviderStreamStart:
    provider: str
    model:    str
    extra:    Dict[str, Any] = field(default_factory=dict)


@dataclass
class ProviderStreamToken:
    delta: str
    # Some providers emit role hints on the first token (e.g. "assistant").
    # Most callers can ignore this.
    role: Optional[str] = None


@dataclass
class ProviderStreamDone:
    finish_reason: Optional[str] = None
    usage:         ProviderUsage = field(default_factory=ProviderUsage)
    model:         Optional[str] = None


@dataclass
class ProviderStreamError:
    code:     str           # matches the originating ProviderError's `code` claim
    message:  str
    provider: str = "unknown"


ProviderStreamEvent = Union[
    ProviderStreamStart,
    ProviderStreamToken,
    ProviderStreamDone,
    ProviderStreamError,
]


__all__ = [
    "ProviderStreamStart",
    "ProviderStreamToken",
    "ProviderStreamDone",
    "ProviderStreamError",
    "ProviderStreamEvent",
]
