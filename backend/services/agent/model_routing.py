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
ENV_VARS = {
    "orchestrator":  "MODEL_ORCHESTRATOR",
    "specialist":    "MODEL_SPECIALIST",
    "fast":          "MODEL_FAST",
    "reasoning":     "MODEL_REASONING",
}

# Per-tier defaults. The Phase 4.2 default for `specialist` is gpt-4o
# (NOT gpt-4o-mini) — this is the central quality boost. Operators can
# downgrade via MODEL_SPECIALIST=gpt-4o-mini if cost matters more than
# quality.
DEFAULTS = {
    "orchestrator":  "gpt-4o",
    "specialist":    "gpt-4o",
    "fast":          "gpt-4o-mini",
    "reasoning":     "gpt-4o",
}

# Spec id → tier mapping for finer control. Specs that benefit from
# extended reasoning live here; everything else falls through to
# "specialist" (or "orchestrator" via can_delegate detection).
SPEC_ID_TIERS = {
    "supervisor":         "orchestrator",
    "researcher":         "reasoning",
    "strategist":         "reasoning",
    "product_strategist": "reasoning",
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
    """Categorise an AgentSpec into a routing tier."""
    if getattr(spec, "can_delegate", False):
        return "orchestrator"
    spec_id = getattr(spec, "id", "") or ""
    return SPEC_ID_TIERS.get(spec_id, "specialist")


def routing_summary() -> dict:
    """Surface live routing config for /v2/orchestrate/health.
    Lets operators sanity-check which env values won."""
    out: dict = {}
    for tier, env_var in ENV_VARS.items():
        env_value = (os.getenv(env_var) or "").strip()
        out[tier] = {
            "env_var":  env_var,
            "configured": bool(env_value),
            "effective": env_value or DEFAULTS[tier],
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
    "DEFAULTS",
    "SPEC_ID_TIERS",
    "resolve_model_for_spec",
    "routing_summary",
    "log_model_selection",
]
