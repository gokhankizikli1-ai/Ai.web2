# coding: utf-8
# Phase 4.2 — model routing.
#
# Picks the LLM model id for an AgentSpec at runtime based on env vars,
# letting the operator promote heavier reasoning models for the
# Supervisor + research/strategy specialists without code changes.
#
# Tier hierarchy:
#   orchestrator  — Supervisor (always)
#   reasoning     — research / strategist / product_strategist
#   specialist    — every other built-in specialist (frontend/backend/...)
#   fast          — legacy /chat fallback when no spec is attached
#
# Each tier is overridable via env. When the env var is unset, the
# tier's default below applies. Phase 4.2's defaults promote
# specialists from gpt-4o-mini → gpt-4o so they actually produce
# senior-level output — the headline fix this phase delivers.
#
# Env vars are read each call so a Railway env flip takes effect
# without a redeploy or process restart.

import logging
import os
from typing import Any, Optional

logger = logging.getLogger(__name__)


# Per-tier env-var names. Operators set these on Railway.
#
# Phase 4.3 added per-role tiers (frontend / backend / research) so
# different specialist roles route to different providers without
# code changes. The original Phase 4.2 tiers (orchestrator /
# specialist / reasoning / fast) still apply as fallbacks when a
# role-specific env isn't set.
ENV_VARS = {
    "orchestrator":  "MODEL_ORCHESTRATOR",
    "specialist":    "MODEL_SPECIALIST",
    "fast":          "MODEL_FAST",
    "reasoning":     "MODEL_REASONING",
    # Phase 4.3 — per-role tiers
    "frontend":      "MODEL_FRONTEND",
    "backend":       "MODEL_BACKEND",
    "research":      "MODEL_RESEARCH",
}

# Per-tier FALLBACK env-var names. Used when the primary call fails
# (auth error / rate limit / timeout / provider unavailable). Each
# tier has its own fallback so operators can wire e.g.
#   MODEL_FRONTEND=claude-sonnet-4   MODEL_FRONTEND_FALLBACK=gpt-4o
# and a Sonnet outage still lets frontend work continue on GPT-4o.
FALLBACK_ENV_VARS = {tier: f"{ev}_FALLBACK" for tier, ev in ENV_VARS.items()}

# Per-tier defaults. Phase 4.3 frontend/backend/research tiers default
# to the corresponding modern provider models:
#   frontend  → Claude Sonnet 4   (best UI / architecture instinct)
#   backend   → GPT-4.1            (best code + system design)
#   research  → Gemini 2.5 Pro     (long context for synthesis)
# Operators can downgrade any tier to a cheaper model via env. The
# generic specialist tier still defaults to gpt-4o so unmapped roles
# stay on OpenAI by default.
DEFAULTS = {
    "orchestrator":  "gpt-4o",            # Supervisor stays on OpenAI for tool calling (Phase 4.3.B will swap to Claude Opus)
    "specialist":    "gpt-4o",
    "fast":          "gpt-4o-mini",
    "reasoning":     "gpt-4o",
    # Phase 4.3 — per-role
    "frontend":      "claude-sonnet-4-5-20250929",   # claude-sonnet-4 canonical id
    "backend":       "gpt-4o",                        # GPT-4.1 fronts as gpt-4o today; env override lets you set the actual id when it's GA
    "research":      "gemini-2.5-pro",                # Gemini 2.5 Pro
}

# Per-tier FALLBACK defaults. Used when the primary fails and the
# operator hasn't set a fallback env. Picked so a provider outage
# never blocks the user — fallback always lands on a different
# provider when possible.
FALLBACK_DEFAULTS = {
    "orchestrator":  "gpt-4o-mini",
    "specialist":    "gpt-4o-mini",
    "fast":          "gpt-4o-mini",   # already cheapest; fallback = same model with retry
    "reasoning":     "gpt-4o-mini",
    "frontend":      "gpt-4o",        # Claude Sonnet → GPT-4o cross-provider fallback
    "backend":       "gpt-4o-mini",   # GPT-4.1 → gpt-4o-mini same-provider cheaper fallback
    "research":      "gpt-4o",        # Gemini → GPT-4o cross-provider fallback
}

# Spec id → tier mapping for finer control. Specs that benefit from
# extended reasoning live here; everything else falls through to
# "specialist" (or "orchestrator" via can_delegate detection).
#
# Phase 4.3 routes researcher to its own research tier (Gemini) and
# keeps strategist/product_strategist on the generic reasoning tier
# so they can use whatever the operator prefers without coupling
# to long-context Gemini specifically.
SPEC_ID_TIERS = {
    "supervisor":         "orchestrator",
    "researcher":         "research",          # was "reasoning" pre-4.3
    "strategist":         "reasoning",
    "product_strategist": "reasoning",
}

# Role keyword → tier mapping. Used for PROJECT AGENTS (created
# dynamically by the user via the agents panel) where the spec id
# isn't a built-in but the role label gives away the intent.
# Matched case-insensitively as substring against spec.role.
ROLE_KEYWORD_TIERS = {
    "frontend":  "frontend",
    "front-end": "frontend",
    "ui":        "frontend",
    "backend":   "backend",
    "back-end":  "backend",
    "api":       "backend",
    "database":  "backend",
    "research":  "research",
    "analyst":   "research",
}


def resolve_model_for_spec(spec: Any) -> str:
    """Pick the LLM model id for `spec`.

    Lookup order:
      1. The tier's env var (e.g. MODEL_ORCHESTRATOR for the Supervisor).
      2. The tier's default (DEFAULTS map above).
      3. The spec's own `default_model` field — last-resort safety net
         so an unknown spec never returns an empty model id.
    """
    if spec is None:
        return os.getenv(ENV_VARS["fast"], DEFAULTS["fast"])

    tier = _tier_for_spec(spec)
    env_var = ENV_VARS.get(tier, ENV_VARS["specialist"])
    value = (os.getenv(env_var) or "").strip()
    if value:
        return value
    default = DEFAULTS.get(tier)
    if default:
        return default
    # Absolute last resort — fall back to whatever the spec was created with
    return getattr(spec, "default_model", "gpt-4o-mini") or "gpt-4o-mini"


def _tier_for_spec(spec: Any) -> str:
    """Categorise an AgentSpec into a routing tier.

    Order:
      1. can_delegate=True → orchestrator (Supervisor)
      2. SPEC_ID_TIERS map (built-in specs with explicit tier)
      3. ROLE_KEYWORD_TIERS — project agents matched by role label
         ("Frontend Engineer" → frontend, "Backend Engineer" → backend,
         "Research Analyst" → research)
      4. Default → specialist (the generic-quality tier)
    """
    if getattr(spec, "can_delegate", False):
        return "orchestrator"
    spec_id = getattr(spec, "id", "") or ""
    if spec_id in SPEC_ID_TIERS:
        return SPEC_ID_TIERS[spec_id]
    role = (getattr(spec, "role", "") or "").lower()
    if role:
        for keyword, tier in ROLE_KEYWORD_TIERS.items():
            if keyword in role:
                return tier
    return "specialist"


def resolve_fallback_for_spec(spec: Any) -> Optional[str]:
    """Pick the fallback model id for `spec`, or None if no fallback
    is configured.

    Lookup order (mirrors resolve_model_for_spec):
      1. The tier's FALLBACK env var (e.g. MODEL_FRONTEND_FALLBACK).
      2. The tier's FALLBACK_DEFAULTS entry.
      3. None — caller decides whether to retry with the same model.
    """
    if spec is None:
        return None
    tier = _tier_for_spec(spec)
    env_var = FALLBACK_ENV_VARS.get(tier)
    if env_var:
        value = (os.getenv(env_var) or "").strip()
        if value:
            return value
    return FALLBACK_DEFAULTS.get(tier)


def model_chain_for_spec(spec: Any) -> list:
    """Return [primary, fallback?] — a list (1-2 items) of model ids
    the call layer should try in order. Single-element when no
    fallback is configured for this tier."""
    primary = resolve_model_for_spec(spec)
    fallback = resolve_fallback_for_spec(spec)
    if fallback and fallback != primary:
        return [primary, fallback]
    return [primary]


def routing_summary() -> dict:
    """Surface live routing config for /v2/orchestrate/health.
    Lets operators sanity-check which env values won + see the
    fallback chain per tier."""
    out: dict = {}
    for tier, env_var in ENV_VARS.items():
        env_value = (os.getenv(env_var) or "").strip()
        fallback_env_var = FALLBACK_ENV_VARS.get(tier)
        fallback_env_value = (os.getenv(fallback_env_var) or "").strip() if fallback_env_var else ""
        out[tier] = {
            "env_var":           env_var,
            "configured":        bool(env_value),
            "effective":         env_value or DEFAULTS[tier],
            "fallback_env_var":  fallback_env_var,
            "fallback_configured": bool(fallback_env_value),
            "fallback_effective": (
                fallback_env_value or FALLBACK_DEFAULTS.get(tier) or None
            ),
        }
    return out


def log_model_selection(spec: Any, model: str, *, run_id: Optional[str] = None) -> None:
    """Phase 4.2 — emit a structured log line every time a model is
    selected for an agent invocation. Surfaces in Railway logs as:

      agent.model_selected | run_id=abc | agent=ux_designer | role=ux
        | tier=specialist | model=gpt-4o | source=env|default

    so operators can see at-a-glance which model each agent used."""
    tier = _tier_for_spec(spec) if spec is not None else "fast"
    env_var = ENV_VARS.get(tier, ENV_VARS["specialist"])
    source = "env" if (os.getenv(env_var) or "").strip() else "default"
    logger.info(
        "agent.model_selected | run_id=%s | agent=%s | role=%s | tier=%s "
        "| model=%s | source=%s",
        run_id or "-",
        getattr(spec, "id", "-"),
        getattr(spec, "role", "-"),
        tier,
        model,
        source,
    )


__all__ = [
    "ENV_VARS",
    "FALLBACK_ENV_VARS",
    "DEFAULTS",
    "FALLBACK_DEFAULTS",
    "SPEC_ID_TIERS",
    "ROLE_KEYWORD_TIERS",
    "resolve_model_for_spec",
    "resolve_fallback_for_spec",
    "model_chain_for_spec",
    "routing_summary",
    "log_model_selection",
]
