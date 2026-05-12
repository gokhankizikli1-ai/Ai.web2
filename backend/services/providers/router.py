# coding: utf-8
"""
Provider Routing v1 — mode-based provider selection.

Pure logic. No I/O. No network. select_provider(mode) returns the
provider name the orchestration layer SHOULD use AND a structured
reason so the call site can log it.

Routing table (all routes behind env flags except "fast"):

  fast       → openai     (always; no flag — this is the default)
  deep_think → anthropic  (flag: ENABLE_MODE_ROUTING_DEEP_THINK)
  coding     → anthropic  (flag: ENABLE_MODE_ROUTING_CODING)
  research   → google     (flag: ENABLE_MODE_ROUTING_RESEARCH)
  creative   → anthropic  (flag: ENABLE_MODE_ROUTING_CREATIVE)
  default    → openai     (anything else)

When a mode's flag is OFF, the router routes to the safe default
(openai). Production behaviour is therefore byte-identical until an
operator explicitly flips the flag on Railway.

The router does NOT consult the registry. It does NOT verify that the
selected provider is available. Those checks happen at the call site
(get_provider raises ProviderUnavailableError) so a router decision
and a runtime failure are observable separately in logs.

Future-ready surface (NOT enabled in v1):
  - per-mode preference lists with fallback chain (ENABLE_PROVIDER_FALLBACK)
  - per-user routing overrides (sticky A/B testing)
  - cost-cap-aware routing (cheaper model after a daily spend threshold)
"""
from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from typing import Dict, Optional


logger = logging.getLogger(__name__)


# Safe default — used both as the floor when a flag is off AND for any
# unknown / blank mode value.
DEFAULT_PROVIDER = "openai"


# Mode → (preferred_provider, flag_name) table. flag_name=None means
# the route is always on (only valid for the DEFAULT_PROVIDER target).
# Adding a new mode here is the only place callers need to touch.
_ROUTES: Dict[str, "ModeRoute"] = {}


@dataclass(frozen=True)
class ModeRoute:
    """One row in the routing table.

    Args:
      mode:               canonical mode name (lowercase + underscores)
      preferred_provider: provider name to route TO when the flag is on
      flag_name:          env-var gate. None means the route is always on
                          (only valid when preferred_provider matches
                          DEFAULT_PROVIDER).
    """
    mode:               str
    preferred_provider: str
    flag_name:          Optional[str] = None


@dataclass(frozen=True)
class ProviderSelection:
    """The router's decision. Always returns SOME provider — there's no
    'unroutable' state for the caller to handle. The `reason` field
    explains how we got there (useful for structured logs)."""
    mode:           str
    provider:       str
    reason:         str       # "default_for_mode" | "flag_off" | "unknown_mode" | "always"


def _register_route(route: ModeRoute) -> None:
    _ROUTES[route.mode] = route


def _flag_on(name: Optional[str]) -> bool:
    """Read an env-var flag dynamically. Tests can monkeypatch os.environ
    and the next call will see the change."""
    if not name:
        return True
    return os.environ.get(name, "").strip().lower() == "true"


# ── Default routing table ────────────────────────────────────────────────
# Edit this block (and the matching docs in /v2/health) when adding modes.
_register_route(ModeRoute("fast",       "openai",    None))
_register_route(ModeRoute("deep_think", "anthropic", "ENABLE_MODE_ROUTING_DEEP_THINK"))
_register_route(ModeRoute("coding",     "anthropic", "ENABLE_MODE_ROUTING_CODING"))
_register_route(ModeRoute("research",   "google",    "ENABLE_MODE_ROUTING_RESEARCH"))
_register_route(ModeRoute("creative",   "anthropic", "ENABLE_MODE_ROUTING_CREATIVE"))


def select_provider(mode: Optional[str]) -> ProviderSelection:
    """Pick a provider for the given mode.

    Always returns a valid ProviderSelection. The caller is then
    responsible for resolving the name to an actual BaseAIProvider
    instance via get_provider() — if that step fails, the user gets a
    clean PROVIDER_UNAVAILABLE error (separate from the routing
    decision).
    """
    if not mode:
        return ProviderSelection(
            mode=     "(none)",
            provider= DEFAULT_PROVIDER,
            reason=   "default_no_mode",
        )

    canonical = mode.strip().lower().replace("-", "_")
    route = _ROUTES.get(canonical)
    if route is None:
        return ProviderSelection(
            mode=     canonical,
            provider= DEFAULT_PROVIDER,
            reason=   "unknown_mode",
        )

    if route.flag_name is None:
        # "fast" or any always-on default-provider mode.
        return ProviderSelection(
            mode=     canonical,
            provider= route.preferred_provider,
            reason=   "always",
        )

    if _flag_on(route.flag_name):
        return ProviderSelection(
            mode=     canonical,
            provider= route.preferred_provider,
            reason=   "flag_on",
        )

    # Flag is off — fall back to the safe default.
    return ProviderSelection(
        mode=     canonical,
        provider= DEFAULT_PROVIDER,
        reason=   "flag_off",
    )


def describe_routing() -> Dict[str, object]:
    """Public-safe snapshot of the routing table for /v2/health.

    Format:
      {
        "modes": [
          {"mode": "fast",       "resolves_to": "openai",    "flag": null,                              "flag_on": true,  "preferred": "openai"},
          {"mode": "deep_think", "resolves_to": "openai",    "flag": "ENABLE_MODE_ROUTING_DEEP_THINK",   "flag_on": false, "preferred": "anthropic"},
          ...
        ],
        "default_provider": "openai"
      }
    Operators can read this to see exactly which mode routes where right
    now, without making a real chat call.
    """
    modes = []
    for mode, route in _ROUTES.items():
        sel = select_provider(mode)
        modes.append({
            "mode":         mode,
            "resolves_to":  sel.provider,
            "flag":         route.flag_name,
            "flag_on":      _flag_on(route.flag_name) if route.flag_name else True,
            "preferred":    route.preferred_provider,
        })
    # Stable order: fast first, then alphabetical so the JSON is grep-able.
    modes.sort(key=lambda m: (0 if m["mode"] == "fast" else 1, m["mode"]))
    return {
        "modes":            modes,
        "default_provider": DEFAULT_PROVIDER,
    }


def _reset_routes_for_tests() -> None:
    """Internal — tests that need a clean routing table call this. Use
    sparingly; the table is intentionally global so production code
    paths see a stable surface."""
    pass  # Currently the table is module-level constants; tests that
    # want a clean state should monkeypatch _ROUTES directly. This stub
    # exists as a hook for future test ergonomics.


__all__ = [
    "DEFAULT_PROVIDER",
    "ModeRoute",
    "ProviderSelection",
    "select_provider",
    "describe_routing",
]
