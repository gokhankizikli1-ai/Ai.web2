# coding: utf-8
"""
AI provider abstraction layer (Phase B foundation).

Three concerns are kept strictly separate:

  - `base.py`     defines `BaseAIProvider`, the abstract interface every
                  provider implementation must satisfy.
  - `types.py`    defines `ProviderRequest`, `ProviderMessage`, and
                  `ProviderResult` — the wire shape between the
                  orchestration layer (route handler / ai_service) and a
                  provider. Plain dataclasses, no Pydantic dependency.
  - `errors.py`   defines the provider exception hierarchy. All errors
                  subclass `backend.core.errors.ApiError` so they auto-
                  route through the v2 envelope handler when enabled,
                  and fall through to the legacy global handler when not.

Concrete providers live next to those:

  - `openai_provider.py`  real OpenAI impl, used when OPENAI_API_KEY is set
  - `registry.py`         in-memory singleton listing what's available

This package does NOT replace `backend/services/ai_service.py`. The
legacy chat route keeps its current orchestration. The provider layer
is a clean parallel module that ai_service (or future /v2/chat) can
adopt incrementally — no big-bang rewrites.
"""
from backend.services.providers.types import ProviderMessage, ProviderRequest, ProviderResult
from backend.services.providers.errors import (
    ProviderError, ProviderTimeoutError, ProviderRateLimitError,
    ProviderUnavailableError, ProviderAuthError, ProviderInvalidRequestError,
)
from backend.services.providers.base import BaseAIProvider
from backend.services.providers.registry import (
    KNOWN_PROVIDERS,
    register_provider, get_provider, list_provider_names, provider_capabilities,
    bootstrap_default_providers,
)

# Bootstrap-on-import: registers OpenAI when OPENAI_API_KEY is set. Safe
# to call multiple times; idempotent.
bootstrap_default_providers()

__all__ = [
    "ProviderMessage", "ProviderRequest", "ProviderResult",
    "ProviderError", "ProviderTimeoutError", "ProviderRateLimitError",
    "ProviderUnavailableError", "ProviderAuthError", "ProviderInvalidRequestError",
    "BaseAIProvider",
    "KNOWN_PROVIDERS",
    "register_provider", "get_provider", "list_provider_names", "provider_capabilities",
    "bootstrap_default_providers",
]
