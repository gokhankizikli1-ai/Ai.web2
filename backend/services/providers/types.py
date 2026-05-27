# coding: utf-8
"""
Wire types between the orchestration layer and a provider.

Plain @dataclass — no Pydantic dependency, no Optional import gymnastics.
Used in three places:

  - Route handler / ai_service builds a `ProviderRequest`.
  - `BaseAIProvider.chat_completion()` accepts it, returns `ProviderResult`.
  - `ProviderResult.to_legacy_chat_dict()` produces the dict the existing
    frontend reads (`reply`, `model`, `provider`, `usage`) so the new
    layer can drop into the legacy /chat path without contract changes.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Literal, Optional, Union


Role = Literal["system", "user", "assistant"]

# Phase 9 vision wiring — message content can be either a plain string
# (the historical case, byte-identical to pre-vision behaviour) or a
# list of provider-shaped content blocks for multimodal turns. For
# OpenAI the list shape is `[{"type":"text","text":...},
# {"type":"image_url","image_url":{"url":"data:..."}}]`; for Anthropic
# it's `[{"type":"text","text":...},
# {"type":"image","source":{"type":"base64","media_type":...,
# "data":...}}]`. v2_chat_stream builds the list per-provider before
# constructing the ProviderRequest; the provider adapters then pass
# the list through unchanged.
ProviderContent = Union[str, List[Dict[str, Any]]]


@dataclass
class ProviderMessage:
    role: Role
    content: ProviderContent


@dataclass
class ProviderRequest:
    """Single chat-completion request to a provider.

    The orchestration layer is responsible for constructing the message
    list (history + system prompt + new user turn). The provider only
    sees the final shape and decides how to serialise it to its SDK.
    """
    messages:    List[ProviderMessage]
    model:       str                                                # e.g. "gpt-4o-mini"
    temperature: float = 0.7
    max_tokens:  Optional[int] = None
    timeout_s:   float = 30.0
    # Free-form passthrough for provider-specific knobs (response_format,
    # tools, seed, …). Providers ignore keys they don't recognise.
    extra:       Dict[str, Any] = field(default_factory=dict)


@dataclass
class ProviderUsage:
    """Token-accounting block normalised across providers."""
    prompt_tokens:     int = 0
    completion_tokens: int = 0
    total_tokens:      int = 0


@dataclass
class ProviderResult:
    """A successful chat completion. Errors raise exceptions instead of
    returning a result with `error` set — keeps the happy path narrow."""
    content:       str
    model:         str        # exact model id the provider used
    provider:      str        # canonical provider name (e.g. "openai")
    usage:         ProviderUsage = field(default_factory=ProviderUsage)
    finish_reason: Optional[str] = None     # "stop" | "length" | "tool_calls" | …
    raw:           Optional[Dict[str, Any]] = None   # provider raw response, for debugging

    def to_legacy_chat_dict(self) -> Dict[str, Any]:
        """Project to the shape the existing frontend reads from /chat.

        Keeps the legacy contract intact — `reply`, `model`, `provider`,
        `usage` are all the field names the current useChat.ts expects.
        Use this in any orchestration code that needs to feed the v3
        legacy response builder.
        """
        return {
            "reply":    self.content,
            "model":    self.model,
            "provider": self.provider,
            "usage": {
                "prompt_tokens":     self.usage.prompt_tokens,
                "completion_tokens": self.usage.completion_tokens,
                "total_tokens":      self.usage.total_tokens,
            },
            "finish_reason": self.finish_reason,
        }


__all__ = [
    "ProviderMessage", "ProviderRequest", "ProviderResult",
    "ProviderUsage", "Role", "ProviderContent",
]
