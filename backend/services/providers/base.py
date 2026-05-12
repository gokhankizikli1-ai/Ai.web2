# coding: utf-8
"""
BaseAIProvider — abstract interface every provider implementation
satisfies. Keeps the orchestration layer SDK-agnostic.

Contract:

  - `name` is the canonical short id ("openai", "anthropic", "google", …)
  - `default_model` is the model used when ProviderRequest.model is empty
  - `is_available()` is a cheap, no-network capability check (e.g. "is the
    API key configured?"). Used by /v2/health.metadata.providers and by
    the registry's `bootstrap_default_providers()`.
  - `chat_completion()` is the only required async method. Subclasses
    raise the right `ProviderError` subclass on failure — they NEVER
    return a result with an error field set.

Subclasses MUST honour `request.timeout_s` and translate native SDK
exceptions into our `ProviderError` hierarchy so the orchestration
layer never sees provider-specific exception types leak out.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Dict, Any

from backend.services.providers.types import ProviderRequest, ProviderResult


class BaseAIProvider(ABC):
    # Canonical name used in registry keys, /v2/health metadata, and
    # ProviderResult.provider. lowercase, no spaces.
    name: str = ""

    # Model id used when ProviderRequest.model is missing or empty.
    default_model: str = ""

    @abstractmethod
    def is_available(self) -> bool:
        """Synchronous capability probe.

        Must NOT make a network call. Should return False quickly when
        the provider cannot serve traffic (e.g. no API key configured).
        The registry uses this at bootstrap time to decide whether to
        register the provider at all.
        """
        ...

    @abstractmethod
    async def chat_completion(self, request: ProviderRequest) -> ProviderResult:
        """Send a single chat-completion request and return the result.

        On failure raise the most specific ProviderError subclass. Never
        return a ProviderResult with an error field — there isn't one.
        """
        ...

    def describe(self) -> Dict[str, Any]:
        """Public-safe capability descriptor for /v2/health.

        Subclasses can override to add provider-specific fields (e.g.
        organisation id) but MUST NOT include secrets.
        """
        return {
            "name":          self.name,
            "default_model": self.default_model,
            "available":     self.is_available(),
        }


__all__ = ["BaseAIProvider"]
