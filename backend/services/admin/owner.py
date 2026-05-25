# coding: utf-8
"""
Owner detection — the single source of truth.

Every other module asks `is_owner(...)` instead of comparing emails
inline. This makes ownership rotation a one-line env change.

Two unlock paths:

  A. Identity-based — `is_owner(user)`.
     Rules (in order):
       1. ENABLE_ADMIN_MODE off → false (kill-switch).
       2. user is a guest → false. Owners must be authenticated.
       3. Email match: settings.OWNER_EMAIL (CSV, lowercased) contains
          the user's email (from external_id or metadata.email).
       4. ID match: settings.OWNER_ID (CSV) contains the user's id or
          external_id.

  B. Token-based — `match_owner_token(provided)`.
     A shared secret in OWNER_TOKEN. The frontend stores it in
     localStorage and sends X-Korvix-Owner-Token; the backend
     compares with hmac.compare_digest. This is the production-safe
     unlock for owners whose browser doesn't have a real backend
     auth session (e.g. zustand-only login). Treated as fully
     equivalent to identity-based ownership.

Both paths obey ENABLE_ADMIN_MODE. Detection is logged at DEBUG
level so an operator can see exactly which check matched (or which
check failed) without leaking values to the response.
"""
from __future__ import annotations

import hmac
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


def _owner_token() -> str:
    """OWNER_TOKEN — shared secret. Empty string ⇒ token unlock disabled.
    Length minimum is enforced at compare time (a 4-char token would be
    brute-forceable in seconds; we refuse it)."""
    return (os.getenv("OWNER_TOKEN", "") or "").strip()


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


# ── Identity path ─────────────────────────────────────────────────────────

def is_owner(user: Optional[User]) -> bool:
    """Return True iff `user` is the configured project owner by identity.

    Conservative: any unexpected shape returns False. Never raises —
    callers (badge rendering, route gating) need a boolean.
    """
    if user is None:
        return False
    if not _admin_mode_enabled():
        return False
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


# ── Token path ────────────────────────────────────────────────────────────

# Refuse to accept dangerously-short tokens as a defence against a
# brute-force loop hitting /v2/admin/status with random guesses.
_MIN_TOKEN_LEN = 16


def match_owner_token(provided: Optional[str]) -> bool:
    """Constant-time compare of `provided` against settings.OWNER_TOKEN.

    Returns False (without comparing) when:
      - ENABLE_ADMIN_MODE is off
      - OWNER_TOKEN is unset / empty / shorter than the min length
      - `provided` is empty
    """
    if not _admin_mode_enabled():
        return False
    token = _owner_token()
    if len(token) < _MIN_TOKEN_LEN:
        return False
    if not provided or len(provided) < _MIN_TOKEN_LEN:
        return False
    # hmac.compare_digest is constant-time and refuses to leak length
    # information through early-exit.
    return hmac.compare_digest(provided.encode("utf-8"), token.encode("utf-8"))


def is_owner_request(
    user: Optional[User],
    *,
    owner_token: Optional[str] = None,
) -> bool:
    """Request-aware owner check. True if EITHER unlock path matches."""
    if is_owner(user):
        return True
    if match_owner_token(owner_token):
        return True
    return False


# ── Capability surface ────────────────────────────────────────────────────

def _full_capabilities() -> list:
    return [
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
    ]


def owner_capabilities(
    user: Optional[User],
    *,
    owner_token: Optional[str] = None,
) -> dict:
    """Surface-able capability map. Used by /v2/admin/status to tell the
    frontend exactly which UI affordances to render. Keeping this as
    plain data (not a list of route paths) means the frontend never
    hard-codes backend URLs.
    """
    if not is_owner_request(user, owner_token=owner_token):
        return {
            "is_owner":     False,
            "admin_mode":   False,
            "capabilities": [],
        }
    return {
        "is_owner":     True,
        "admin_mode":   True,
        "capabilities": _full_capabilities(),
    }


# ── Diagnostic output ─────────────────────────────────────────────────────

def detection_debug(
    user: Optional[User],
    *,
    owner_token_present: bool = False,
    owner_token_matches: bool = False,
) -> dict:
    """Explain exactly why detection succeeded or failed.

    Returned shape is safe to surface ONLY to confirmed owners (the
    /status route hides it from non-owners unless ENABLE_ADMIN_DEBUG
    is set). NEVER returns the actual OWNER_TOKEN / OWNER_EMAIL — only
    truthy flags and the user-side observed values.
    """
    enabled = _admin_mode_enabled()
    emails = _owner_emails()
    ids    = _owner_ids()
    token  = _owner_token()

    out: dict = {
        "enable_admin_mode":  enabled,
        "owner_email_set":    bool(emails),
        "owner_email_count":  len(emails),
        "owner_id_set":       bool(ids),
        "owner_id_count":     len(ids),
        "owner_token_set":    bool(token) and len(token) >= _MIN_TOKEN_LEN,
        "owner_token_present_in_request": owner_token_present,
        "owner_token_matches":            owner_token_matches,
        "user_present":       user is not None,
    }
    if user is not None:
        out["user_kind"]     = user.kind
        out["user_is_guest"] = user.is_guest
        email = _user_email(user)
        out["user_email_observed"] = email or ""
        out["user_email_match"] = bool(email) and email in emails
        out["user_id_match"] = (
            user.id in ids or user.external_id in ids
        ) if ids else False
    else:
        out["user_kind"] = None
        out["user_is_guest"] = None
        out["user_email_observed"] = ""
        out["user_email_match"] = False
        out["user_id_match"] = False

    # First-failure reason — the field the operator should fix first.
    out["first_failure"] = _first_failure(out)
    return out


def _first_failure(d: dict) -> Optional[str]:
    if not d["enable_admin_mode"]:
        return "ENABLE_ADMIN_MODE=false on backend"
    # Token-path success short-circuits everything else: even a guest
    # with the correct OWNER_TOKEN is the owner, so first_failure
    # must be None in that case.
    if d["owner_token_matches"]:
        return None
    if d["owner_token_present_in_request"] and not d["owner_token_matches"]:
        if not d["owner_token_set"]:
            return "OWNER_TOKEN not set on backend (or shorter than 16 chars)"
        return "owner token sent by client does NOT match OWNER_TOKEN"
    if not d["user_present"]:
        return "no User attached to request (auth middleware off?)"
    if d["user_is_guest"]:
        return "user is a guest — sign in or use OWNER_TOKEN"
    if not d["owner_email_set"] and not d["owner_id_set"] and not d["owner_token_set"]:
        return "OWNER_EMAIL / OWNER_ID / OWNER_TOKEN all unset on backend"
    if d["owner_email_set"] and not d["user_email_match"]:
        return (
            f"user email '{d['user_email_observed'] or '<none>'}' "
            f"does not match OWNER_EMAIL"
        )
    if d["owner_id_set"] and not d["user_id_match"]:
        return "user id / external_id does not match OWNER_ID"
    return None  # No failure — caller IS the owner


def log_detection(user: Optional[User], decision: bool, **extra) -> None:
    """One-line DEBUG log so an operator can trace owner decisions.
    Never logs the OWNER_TOKEN, OWNER_EMAIL, or any other secret —
    only the user-observed values (their own email, their own id)."""
    if not logger.isEnabledFor(logging.DEBUG):
        return
    email = _user_email(user) if user else None
    logger.debug(
        "owner.detect | decision=%s | kind=%s | guest=%s | "
        "email_obs=%s | extra=%s",
        decision,
        getattr(user, "kind", None),
        getattr(user, "is_guest", None),
        email or "<none>",
        extra or {},
    )


__all__ = [
    "is_owner",
    "is_owner_request",
    "match_owner_token",
    "owner_capabilities",
    "detection_debug",
    "log_detection",
]
