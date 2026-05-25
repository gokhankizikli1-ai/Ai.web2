# coding: utf-8
"""
Owner detection — the single source of truth.

Every other module asks `is_owner(user)` instead of comparing emails
inline. This makes ownership rotation a one-line env change.

Rules (in order):
  1. If `ENABLE_ADMIN_MODE` is false → never an owner. The kill-switch
     short-circuits before any string comparisons so an accidental
     OWNER_EMAIL leak in CI doesn't grant access.
  2. If user is a guest → never an owner. Owners must be authenticated.
  3. Email match: settings.OWNER_EMAIL (comma-separated list, lowercased)
     contains the user's email. We support `kind == "email"` (the
     external_id is `email:<address>`) AND the metadata.email field
     populated by OAuth providers (Google / GitHub / Apple).
  4. ID match: settings.OWNER_ID (comma-separated list) contains the
     user's `id` (uuid hex) OR `external_id`.

The function is pure (no DB calls, no side effects) so it's safe to
call in hot paths like the auth middleware tail. Cost is two list-of-
short-string `in` checks.
"""
from __future__ import annotations

import logging
import os
from typing import Optional, Set

from backend.services.auth.identity import User


logger = logging.getLogger(__name__)


# Environment vars are read at call time, not import time, so a test can
# monkeypatch them without reloading this module. The cost is a single
# os.environ lookup per `is_owner()` call — negligible vs the database
# touches the same request will do.

def _admin_mode_enabled() -> bool:
    return os.getenv("ENABLE_ADMIN_MODE", "false").strip().lower() == "true"


def _owner_emails() -> Set[str]:
    """Parse OWNER_EMAIL into a normalised set. Empty string → empty set."""
    raw = (os.getenv("OWNER_EMAIL", "") or "").strip().lower()
    if not raw:
        return set()
    return {e.strip() for e in raw.split(",") if e.strip()}


def _owner_ids() -> Set[str]:
    """Parse OWNER_ID into a set of allowed user / external ids.
    Treats "0" / "" as "disabled" so the historical default is a no-op."""
    raw = (os.getenv("OWNER_ID", "0") or "").strip()
    if not raw or raw == "0":
        return set()
    return {v.strip() for v in raw.split(",") if v.strip() and v.strip() != "0"}


def _user_email(user: User) -> Optional[str]:
    """Best-effort extraction of an email from a User. Returns None when
    no email is available (e.g. raw guest, or OAuth provider that
    didn't publish an email)."""
    if not user:
        return None
    # email-kind: external_id is "email:<address>"
    if user.kind == "email" and user.external_id.startswith("email:"):
        return user.external_id[len("email:"):].strip().lower() or None
    # OAuth providers populate metadata.email when available.
    meta = getattr(user, "metadata", None) or {}
    email = meta.get("email") if isinstance(meta, dict) else None
    if isinstance(email, str) and email.strip():
        return email.strip().lower()
    return None


def is_owner(user: Optional[User]) -> bool:
    """Return True iff the user is the configured project owner.

    Conservative: any unexpected shape returns False. Never raises —
    callers (badge rendering, route gating) need a boolean.
    """
    if user is None:
        return False
    # Kill-switch: ENABLE_ADMIN_MODE off ⇒ owner detection disabled
    # globally. This prevents a misconfigured staging env from
    # accidentally promoting a real user.
    if not _admin_mode_enabled():
        return False
    # Guests can never be owners.
    if user.is_guest:
        return False

    email = _user_email(user)
    if email and email in _owner_emails():
        return True

    ids = _owner_ids()
    if ids:
        if user.id in ids:
            return True
        if user.external_id in ids:
            return True

    return False


def owner_capabilities(user: Optional[User]) -> dict:
    """Surface-able capability map. Used by /v2/admin/status to tell the
    frontend exactly which UI affordances to render. Keeping this as
    plain data (not a list of route paths) means the frontend never
    hard-codes backend URLs.
    """
    if not is_owner(user):
        return {
            "is_owner":         False,
            "admin_mode":       False,
            "capabilities":     [],
        }
    return {
        "is_owner":   True,
        "admin_mode": True,
        "capabilities": [
            "debug_logs",
            "model_routing",
            "provider_selection",
            "agent_traces",
            "internal_agents",
            "memory_inspector",
            "tool_history",
            "prompt_inspector",
            "deployment_diagnostics",
            "advanced_codegen",
            "owner_agent",
            "safe_cyber_review",
        ],
    }


__all__ = ["is_owner", "owner_capabilities"]
