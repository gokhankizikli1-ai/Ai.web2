# coding: utf-8
"""Shared connector authority — the ONE way to run a provider's bounded read
for ONE (project, provider) binding.

WHY THIS MODULE EXISTS
----------------------
Every connector already owns its own `sync.sync_connection(conn)`: the provider
fetch, the normalization, and the ingestion into the single canonical
`observations_store`. NOTHING of that lives here and nothing here reimplements
any of it.

What DID live in only one place — inside the `POST /v2/connectors/{p}/sync`
route handler — was the small amount of glue that turns "this project is bound
to this provider" into "run that provider's read, safely":

    re-check that the caller owns the project (never trust the binding's
    denormalized owner) → resolve the provider's connection record → refuse a
    revoked authorization → refuse a binding that still needs a resource chosen
    → call the provider's OWN sync → report the outcome truthfully

The Project Workspace's smart refresh needs exactly that same glue. Copying it
would have created a second, silently-drifting definition of "is this binding
syncable?" — the kind of duplication where one copy learns about a new provider
guard and the other does not. So the glue moved here, the route now calls it,
and there is one implementation with one place to get it right.

WHAT THIS MODULE IS NOT
-----------------------
  * NOT a second connector abstraction. It resolves the EXISTING per-provider
    config/store/sync modules through the EXISTING `registry`; it knows nothing
    about any provider's API.
  * NOT a scheduler, queue or background service. It runs one bounded read,
    synchronously, on the caller's thread, and returns. WHEN to call it is the
    caller's decision (an explicit user Sync, or the refresh coordinator).
  * NOT an ownership authority. It re-asserts the ownership check the callers
    already perform, as defence in depth — it never widens access.
  * NOT an observation writer. The provider's own sync records observations
    through the one canonical store, exactly as it always did.

COST: one bounded provider read per call, and only when every guard passes.
ZERO model tokens.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Dict, Optional

from backend.services.connectors import registry
from backend.services.connectors import store as shared

logger = logging.getLogger(__name__)

# ── Outcome vocabulary. STABLE codes, never user-facing prose. ───────────────
OUTCOME_SYNCED = "synced"                    # the provider read ran
OUTCOME_NOT_CONNECTED = "not_connected"      # no connection record (or revoked)
OUTCOME_NEEDS_SELECTION = "needs_resource_selection"
OUTCOME_DISABLED = "connector_disabled"      # the provider is off on this deploy
OUTCOME_NOT_OWNED = "not_owned"              # project missing or someone else's
OUTCOME_UNKNOWN_PROVIDER = "unknown_provider"
OUTCOME_FAILED = "failed"                    # the provider read raised


@dataclass(frozen=True)
class SyncOutcome:
    """What happened for ONE (project, provider).

    `ok`          the provider read RAN (it was not skipped and did not raise).
                  Deliberately NOT "everything succeeded": the provider's own
                  `SyncReport` already reports per-resource failure truthfully,
                  and this is the exact meaning `POST /v2/connectors/{p}/sync`
                  has always given the field.
    `report_ok`   the provider's own verdict — every resource synced cleanly.
                  This is what the refresh coordinator logs, and it is why a
                  rate-limited provider is not mistaken for a healthy one.
    `report`      the provider's `SyncReport.as_dict()` when a read ran.
    `detail`      a short, provider-supplied reason for a raised read. Present
                  only on `OUTCOME_FAILED`.
    """
    project_id: str
    provider: str
    outcome: str
    ok: bool = False
    report_ok: bool = False
    report: Optional[Dict[str, Any]] = None
    detail: str = ""

    def as_dict(self) -> Dict[str, Any]:
        """The per-project row shape `POST /v2/connectors/{p}/sync` returns —
        unchanged, field for field, from before this module existed."""
        out: Dict[str, Any] = {"project_id": self.project_id, "ok": self.ok}
        if self.outcome != OUTCOME_SYNCED:
            out["reason"] = self.detail or self.outcome
        if self.report is not None:
            out["sync"] = self.report
        return out


# ── provider module resolution (lazy — a disabled connector costs nothing) ───

def config_module(provider: str):
    """The provider's `config` module, or None for an unknown provider."""
    provider = str(provider or "").strip().lower()
    try:
        if provider == registry.PROVIDER_GMAIL:
            from backend.services.gmail import config as mod
        elif provider == registry.PROVIDER_CALENDAR:
            from backend.services.google_calendar import config as mod
        elif provider == registry.PROVIDER_GITHUB:
            from backend.services.github import config as mod
        elif provider == registry.PROVIDER_VERCEL:
            from backend.services.vercel import config as mod
        elif provider == registry.PROVIDER_SLACK:
            from backend.services.slack import config as mod
        else:
            return None
    except Exception as exc:  # pragma: no cover — defensive
        logger.debug("connectors.sync: config for %s unavailable: %s", provider, exc)
        return None
    return mod


def store_module(provider: str):
    """The provider's `store` module, or None for an unknown provider."""
    provider = str(provider or "").strip().lower()
    try:
        if provider == registry.PROVIDER_GMAIL:
            from backend.services.gmail import store as mod
        elif provider == registry.PROVIDER_CALENDAR:
            from backend.services.google_calendar import store as mod
        elif provider == registry.PROVIDER_GITHUB:
            from backend.services.github import store as mod
        elif provider == registry.PROVIDER_VERCEL:
            from backend.services.vercel import store as mod
        elif provider == registry.PROVIDER_SLACK:
            from backend.services.slack import store as mod
        else:
            return None
    except Exception as exc:  # pragma: no cover — defensive
        logger.debug("connectors.sync: store for %s unavailable: %s", provider, exc)
        return None
    return mod


def sync_module(provider: str):
    """The provider's `sync` module, or None for an unknown provider."""
    provider = str(provider or "").strip().lower()
    try:
        if provider == registry.PROVIDER_GMAIL:
            from backend.services.gmail import sync as mod
        elif provider == registry.PROVIDER_CALENDAR:
            from backend.services.google_calendar import sync as mod
        elif provider == registry.PROVIDER_GITHUB:
            from backend.services.github import sync as mod
        elif provider == registry.PROVIDER_VERCEL:
            from backend.services.vercel import sync as mod
        elif provider == registry.PROVIDER_SLACK:
            from backend.services.slack import sync as mod
        else:
            return None
    except Exception as exc:  # pragma: no cover — defensive
        logger.debug("connectors.sync: sync for %s unavailable: %s", provider, exc)
        return None
    return mod


def is_provider_enabled(provider: str) -> bool:
    """Whether this deployment has the provider's connector switched on. A
    disabled connector must never be reached by ANY caller — an explicit Sync
    503s at the route, and the refresh coordinator simply skips it."""
    cfg = config_module(provider)
    if cfg is None:
        return False
    try:
        return bool(cfg.is_enabled())
    except Exception:  # pragma: no cover — defensive
        return False


# ── owner check (defence in depth, identical for every caller) ───────────────

def _owns_project(user_id: str, project_id: str) -> bool:
    """Whether `user_id` owns `project_id`, per the canonical projects record.

    Every caller has already gated on this; re-checking here means a binding
    whose denormalized `owner_user_id` has drifted can never cause a read into
    somebody else's project. Fail-CLOSED on any store error."""
    if not (user_id and project_id):
        return False
    try:
        from backend.services.projects import store as projects_store
        project = projects_store.get_project(str(project_id))
    except Exception as exc:  # pragma: no cover — defensive
        logger.debug("connectors.sync: projects store unavailable: %s", exc)
        return False
    return project is not None and str(project.owner_user_id) == str(user_id)


# ── the one entry point ──────────────────────────────────────────────────────

def sync_binding(user_id: str, project_id: str, provider: str) -> SyncOutcome:
    """Run the provider's OWN bounded read for one (project, provider), or say
    truthfully why it did not run. NEVER raises.

    The guards, in order — each one is a reason NOT to touch the provider:

      unknown provider        → the registry has never heard of it
      connector disabled      → this deployment has the connector switched off
      project not owned       → missing, or another account's
      no connection / revoked → nothing authorized to read with
      needs resource chosen   → the binding names no repo / project / channel

    Only when every guard passes is a single provider call made."""
    project_id = str(project_id or "").strip()
    provider = str(provider or "").strip().lower()

    spec = registry.spec(provider)
    if spec is None:
        return SyncOutcome(project_id, provider, OUTCOME_UNKNOWN_PROVIDER)
    if not is_provider_enabled(provider):
        return SyncOutcome(project_id, provider, OUTCOME_DISABLED)
    if not _owns_project(str(user_id or ""), project_id):
        return SyncOutcome(project_id, provider, OUTCOME_NOT_OWNED)

    st = store_module(provider)
    sm = sync_module(provider)
    if st is None or sm is None:  # pragma: no cover — defensive
        return SyncOutcome(project_id, provider, OUTCOME_UNKNOWN_PROVIDER)

    try:
        conn = st.get_connection(project_id)
    except Exception as exc:
        logger.warning("connectors.sync: %s connection read failed for %s: %s",
                       provider, project_id, exc)
        return SyncOutcome(project_id, provider, OUTCOME_FAILED,
                           detail=type(exc).__name__)
    if conn is None or getattr(conn, "is_revoked", False):
        return SyncOutcome(project_id, provider, OUTCOME_NOT_CONNECTED)
    if spec.requires_resource_selection and getattr(conn, "is_connected", True) is False:
        return SyncOutcome(project_id, provider, OUTCOME_NEEDS_SELECTION)

    try:
        report = sm.sync_connection(conn)
    except Exception as exc:
        # A provider timeout, rate limit or dead credential must never propagate
        # to the caller: an explicit Sync reports it, and a background refresh
        # simply leaves the persisted snapshot untouched.
        logger.info("connectors.sync: %s sync failed for %s: %s",
                    provider, project_id, type(exc).__name__)
        return SyncOutcome(project_id, provider, OUTCOME_FAILED,
                           detail=type(exc).__name__)

    return SyncOutcome(project_id, provider, OUTCOME_SYNCED, ok=True,
                       report_ok=bool(getattr(report, "ok", False)),
                       report=report.as_dict())


def bound_providers(user_id: str, project_id: str) -> list:
    """The providers this (user, project) actually has a LIVE binding for, in
    the registry's stable display order.

    "Live" means: the binding's recorded owner is the caller, and its status is
    neither pending-selection nor revoked. A project with no connectors returns
    [] and every caller then does nothing at all."""
    project_id = str(project_id or "").strip()
    user_id = str(user_id or "").strip()
    if not (project_id and user_id):
        return []
    try:
        bindings = shared.list_project_bindings(project_id)
    except Exception as exc:
        logger.debug("connectors.sync: bindings unavailable for %s: %s",
                     project_id, exc)
        return []

    live: Dict[str, bool] = {}
    for b in bindings:
        if str(getattr(b, "owner_user_id", "")) != user_id:
            continue   # defence in depth — a binding is never cross-owner
        if str(b.status) != shared.BIND_CONNECTED:
            continue   # pending selection / revoked is not something to read
        live[str(b.provider)] = True
    return [p for p in registry.PROVIDER_ORDER if p in live]


__all__ = [
    "SyncOutcome", "sync_binding", "bound_providers", "is_provider_enabled",
    "config_module", "store_module", "sync_module",
    "OUTCOME_SYNCED", "OUTCOME_NOT_CONNECTED", "OUTCOME_NEEDS_SELECTION",
    "OUTCOME_DISABLED", "OUTCOME_NOT_OWNED", "OUTCOME_UNKNOWN_PROVIDER",
    "OUTCOME_FAILED",
]
