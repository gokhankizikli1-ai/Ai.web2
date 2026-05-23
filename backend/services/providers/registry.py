# coding: utf-8
"""
Provider registry — in-memory singleton listing what's available.

Lifecycle:
  - `bootstrap_default_providers()` runs at package import time; it
    registers each known provider that passes its `is_available()` check.
  - `register_provider(provider)` adds (or replaces) a provider by name.
    Used by tests and by future plugin code.
  - `get_provider(name)` returns the registered instance or raises
    `ProviderUnavailableError`.
  - `provider_capabilities()` returns the public-safe descriptor list
    used by /v2/health.metadata.providers.

Future-ready placeholders for Claude / Gemini / DeepSeek live as
unregistered names in `KNOWN_PROVIDERS` — they appear in `/v2/health`
as `{available: false, registered: false}` so the frontend can see
where the next integration points will be without us shipping fake
implementations.
"""
from __future__ import annotations

import logging
import threading
from typing import Dict, List

from backend.services.providers.base import BaseAIProvider
from backend.services.providers.errors import ProviderUnavailableError

logger = logging.getLogger(__name__)


# ── Internal state ────────────────────────────────────────────────────────
_LOCK: threading.Lock = threading.Lock()
_REGISTRY: Dict[str, BaseAIProvider] = {}
_BOOTSTRAPPED: bool = False


# Known providers the platform plans to support. Names listed here but
# not in _REGISTRY are surfaced as `{available: false, registered: false}`
# by `provider_capabilities()` — explicit placeholders, not fake
# implementations.
KNOWN_PROVIDERS: List[str] = [
    "openai",      # implemented in openai_provider.py
    "anthropic",   # Phase B+: BaseAIProvider subclass to be added
    "google",      # Phase B+: Gemini
    "deepseek",    # Phase B+: DeepSeek
]


def register_provider(provider: BaseAIProvider) -> None:
    """Add or replace a provider in the registry. Idempotent."""
    if not provider.name:
        raise ValueError("provider.name must be non-empty")
    with _LOCK:
        _REGISTRY[provider.name] = provider
    logger.info("provider registered: %s | model=%s | available=%s",
                provider.name, provider.default_model, provider.is_available())


def get_provider(name: str) -> BaseAIProvider:
    """Return the registered provider or raise ProviderUnavailableError.

    Use this from orchestration code so the error envelope flows out
    naturally when an operator misconfigures a model id.
    """
    with _LOCK:
        provider = _REGISTRY.get(name)
    if provider is None:
        raise ProviderUnavailableError(
            f"Provider '{name}' is not registered.",
            provider=name,
            details={"registered": list_provider_names()},
        )
    return provider


def list_provider_names() -> List[str]:
    """Names of currently-registered providers."""
    with _LOCK:
        return sorted(_REGISTRY.keys())


def provider_capabilities() -> List[Dict[str, object]]:
    """Public-safe descriptor list for /v2/health.metadata.providers.

    For each name in KNOWN_PROVIDERS (so Phase-3 / Phase-C reviewers see
    where the next integration points sit), emit:

        { name, registered, available, default_model? }

    Registered providers expose their full describe(); unregistered
    ones are placeholders.
    """
    with _LOCK:
        registered = dict(_REGISTRY)
    out: List[Dict[str, object]] = []
    seen = set()
    # Registered first, in deterministic order.
    for name in sorted(registered.keys()):
        seen.add(name)
        out.append({"registered": True, **registered[name].describe()})
    # Then placeholders.
    for name in KNOWN_PROVIDERS:
        if name in seen:
            continue
        out.append({
            "name":          name,
            "registered":    False,
            "available":     False,
            "default_model": "",
        })
    return out


def bootstrap_default_providers() -> None:
    """Register every default provider whose is_available() returns True.

    Called once from `backend/services/providers/__init__.py`. Safe to
    call multiple times — guarded by `_BOOTSTRAPPED` to keep startup
    logs from doubling.
    """
    global _BOOTSTRAPPED
    if _BOOTSTRAPPED:
        return
    _BOOTSTRAPPED = True

    # OpenAI — register only if the SDK is importable AND the key is set.
    try:
        from backend.services.providers.openai_provider import OpenAIProvider
        p = OpenAIProvider()
        if p.is_available():
            register_provider(p)
        else:
            logger.info("openai provider skipped: OPENAI_API_KEY not set")
    except Exception as exc:
        logger.warning("openai provider bootstrap failed (non-fatal): %s", exc)

    # Phase 6a — Anthropic. Same pattern as OpenAI: register only when
    # both the SDK is importable AND the key is set. Failure here is
    # non-fatal — the registry simply doesn't list it and /v2/health
    # reports registered=false from the KNOWN_PROVIDERS placeholder.
    try:
        from backend.services.providers.anthropic_provider import AnthropicProvider
        p = AnthropicProvider()
        if p.is_available():
            register_provider(p)
        else:
            logger.info("anthropic provider skipped: ANTHROPIC_API_KEY not set")
    except Exception as exc:
        logger.warning("anthropic provider bootstrap failed (non-fatal): %s", exc)

    # Phase 4.3 — Google Gemini. google-generativeai SDK is in
    # requirements.txt; register only when GEMINI_API_KEY is set so
    # operators who don't use Gemini don't pay any cost.
    try:
        from backend.services.providers.gemini_provider import GeminiProvider
        p = GeminiProvider()
        if p.is_available():
            register_provider(p)
        else:
            logger.info("gemini provider skipped: GEMINI_API_KEY not set")
    except Exception as exc:
        logger.warning("gemini provider bootstrap failed (non-fatal): %s", exc)


def _reset_for_tests() -> None:
    """Internal — clears the registry. Used by smoke tests; not exported."""
    global _BOOTSTRAPPED
    with _LOCK:
        _REGISTRY.clear()
    _BOOTSTRAPPED = False


__all__ = [
    "KNOWN_PROVIDERS",
    "register_provider", "get_provider",
    "list_provider_names", "provider_capabilities",
    "bootstrap_default_providers",
]
