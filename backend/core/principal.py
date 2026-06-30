# coding: utf-8
"""
Centralized identity + permission model for KorvixAI.

WHY THIS MODULE EXISTS
----------------------
KorvixAI is a multi-tenant AI Operating System: every request belongs to
exactly one principal, and every resource (project, memory, workflow,
event, task, artifact, message) has explicit ownership. Before this module
identity was resolved in several places with subtly different rules
(routes/chat.py, routes/v2_chat_stream.py, inline owner-detection blocks),
and permission was expressed with ad-hoc booleans (is_guest / is_owner).

`Principal` is the ONE authoritative answer to "who is making this request,
and what may they touch". It is built on the existing, audited primitives
in backend.core.deps (current_user, resolve_authoritative_uid) +
backend.services.admin.owner (is_owner_request) — it unifies them, it does
not replace them. Identity ALWAYS originates from authenticated context
(verified JWT / AuthMiddleware state / guest nonce), NEVER from a request
payload.

PERMISSION LEVELS (explicit — no magic booleans)
-------------------------------------------------
  GUEST     — unauthenticated browser session (stable X-Korvix-Guest-Id
              nonce). First-class: the product supports guest usage.
  USER      — authenticated via a verified JWT.
  OWNER     — USER (or token-unlock) matching OWNER_EMAIL(S)/OWNER_ID.
  ADMIN     — reserved for a future RBAC role; today owners are admins.
  INTERNAL  — system-initiated execution with no end user (maintenance,
              schema bring-up). Full trust; NEVER created from a request.
  WORKER    — background execution ON BEHALF OF a specific user (a job the
              user enqueued). Carries `on_behalf_of`; scopes data to that
              user. NEVER impersonates via ambient request state.

Only GUEST/USER/OWNER are ever produced by `resolve_principal(request)`.
INTERNAL/WORKER come exclusively from the explicit factory functions, so a
network request can never escalate to a system principal.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from enum import Enum
from typing import Callable, Optional

from fastapi import Request

logger = logging.getLogger(__name__)


class PrincipalKind(str, Enum):
    GUEST = "guest"
    USER = "user"
    OWNER = "owner"
    ADMIN = "admin"
    INTERNAL = "internal"
    WORKER = "worker"


# Identity provenance — how the principal was established. Useful for audit
# logs and for spotting pre-fix / proxied clients in production.
class IdentitySource(str, Enum):
    MIDDLEWARE = "middleware"      # request.state set by AuthMiddleware
    JWT = "jwt"                    # verified Bearer token (inline)
    GUEST_HEADER = "guest-header"  # X-Korvix-Guest-Id nonce
    BODY = "body"                  # legacy body.user_id fallback
    ANONYMOUS = "anonymous"        # nothing presented
    SYSTEM = "system"             # internal/worker factory


@dataclass(frozen=True)
class Principal:
    """The authoritative identity for one unit of work."""
    user_id: str
    kind: PrincipalKind
    source: IdentitySource = IdentitySource.ANONYMOUS
    email: Optional[str] = None
    display_name: str = ""
    # For WORKER principals: the user the background work runs for. Data
    # access is scoped to THIS id, never to ambient state.
    on_behalf_of: Optional[str] = None

    # ── Permission level predicates (explicit, not magic booleans) ────────
    @property
    def is_guest(self) -> bool:
        return self.kind == PrincipalKind.GUEST

    @property
    def is_authenticated(self) -> bool:
        return self.kind in (PrincipalKind.USER, PrincipalKind.OWNER, PrincipalKind.ADMIN)

    @property
    def is_owner(self) -> bool:
        return self.kind in (PrincipalKind.OWNER, PrincipalKind.ADMIN)

    @property
    def is_admin(self) -> bool:
        return self.kind == PrincipalKind.ADMIN

    @property
    def is_internal(self) -> bool:
        return self.kind in (PrincipalKind.INTERNAL, PrincipalKind.WORKER)

    @property
    def effective_user_id(self) -> str:
        """The id whose data this principal may touch. For workers that's
        the user the job runs for; otherwise the principal's own id."""
        return self.on_behalf_of or self.user_id

    # ── Ownership decisions ───────────────────────────────────────────────
    def owns_user(self, target_user_id: Optional[str]) -> bool:
        """True if this principal may act on data owned by `target_user_id`.

        Owners/admins and internal/worker principals are trusted (a worker is
        already scoped to its on_behalf_of id by `effective_user_id`, which
        the caller should use). Everyone else must match exactly.
        """
        if self.is_owner or self.kind == PrincipalKind.INTERNAL:
            return True
        if self.kind == PrincipalKind.WORKER:
            return bool(target_user_id) and str(self.effective_user_id) == str(target_user_id)
        return bool(target_user_id) and str(self.effective_user_id) == str(target_user_id)

    def may_access_scope(
        self,
        scope: str,
        *,
        project_owner_lookup: Optional[Callable[[str], Optional[str]]] = None,
        run_owner_lookup: Optional[Callable[[str], Optional[str]]] = None,
    ) -> bool:
        """Authorize a subscription/stream scope string.

        Conventions: "user:<id>", "project:<id>", "run:<id>", "*".
          - owner/admin/internal → any scope (incl. "*").
          - "*" wildcard → owner/admin/internal ONLY (else cross-tenant leak).
          - "user:<id>" → must be the principal's own id.
          - "project:<id>" / "run:<id>" → must own the resource, verified via
            the supplied lookup (returns owner_user_id or None). No lookup
            ⇒ deny (fail secure).
        """
        if self.is_owner or self.kind == PrincipalKind.INTERNAL:
            return True
        s = (scope or "*").strip()
        if s == "*" or not s:
            return False
        if ":" not in s:
            return False
        kind, _, ident = s.partition(":")
        kind = kind.strip().lower()
        ident = ident.strip()
        if not ident:
            return False
        if kind == "user":
            return self.owns_user(ident)
        if kind == "project":
            if project_owner_lookup is None:
                return False
            try:
                owner = project_owner_lookup(ident)
            except Exception:  # pragma: no cover — fail secure
                return False
            return owner is not None and self.owns_user(owner)
        if kind == "run":
            if run_owner_lookup is None:
                return False
            try:
                owner = run_owner_lookup(ident)
            except Exception:  # pragma: no cover — fail secure
                return False
            return owner is not None and self.owns_user(owner)
        return False

    def to_audit(self) -> dict:
        """Secret-free representation for audit logs."""
        return {
            "user_id": self.user_id,
            "kind": self.kind.value,
            "source": self.source.value,
            "on_behalf_of": self.on_behalf_of,
        }


# ── The single request → principal resolver ──────────────────────────────

def resolve_principal(request: Request) -> Principal:
    """Resolve the authoritative Principal for an HTTP request.

    Built on the audited deps primitives so there is exactly ONE identity
    contract across the app:
      - identity string via deps.resolve_authoritative_uid (verified JWT →
        guest nonce → body fallback; a bad token never falls to the body),
      - User object via deps.current_user (for email/display + owner check),
      - owner decision via admin.owner.is_owner_request.

    Returns GUEST/USER/OWNER only. Never raises.
    """
    from backend.core.deps import (
        current_user, resolve_authoritative_uid, _extract_owner_token,
    )

    uid = resolve_authoritative_uid(request, "", log_prefix="PRINCIPAL")

    # Provenance (best-effort, for audit only).
    source = IdentitySource.ANONYMOUS
    try:
        st = getattr(request.state, "user_id", None)
        if isinstance(st, str) and st and st != "guest:anonymous":
            source = IdentitySource.MIDDLEWARE
        elif (request.headers.get("authorization") or "").lower().startswith("bearer "):
            source = IdentitySource.JWT
        elif (request.headers.get("x-korvix-guest-id") or "").strip():
            source = IdentitySource.GUEST_HEADER
    except Exception:
        pass

    email: Optional[str] = None
    display_name = ""
    authenticated = False
    is_owner = False
    try:
        u = current_user(request)
        authenticated = not u.is_guest
        display_name = getattr(u, "display_name", "") or ""
        from backend.services.admin.owner import is_owner_request, _user_email
        email = _user_email(u)
        is_owner = is_owner_request(u, owner_token=_extract_owner_token(request))
    except Exception:  # pragma: no cover — never let identity resolution 500
        pass

    # A token-only caller (valid signature, user row absent) is still
    # authenticated for scoping: their data is keyed by the verified `sub`.
    if source in (IdentitySource.MIDDLEWARE, IdentitySource.JWT) and uid not in ("", "anonymous"):
        authenticated = True

    if is_owner:
        kind = PrincipalKind.OWNER
    elif authenticated:
        kind = PrincipalKind.USER
    else:
        kind = PrincipalKind.GUEST

    return Principal(
        user_id=uid, kind=kind, source=source,
        email=email, display_name=display_name,
    )


# ── Explicit non-request principals (background execution) ────────────────

def system_principal(reason: str = "system") -> Principal:
    """Full-trust internal principal for system-initiated work (schema
    bring-up, maintenance sweeps). NEVER derived from a request."""
    return Principal(
        user_id=f"system:{reason}", kind=PrincipalKind.INTERNAL,
        source=IdentitySource.SYSTEM,
    )


def worker_principal(on_behalf_of: str) -> Principal:
    """Background-execution principal that runs ON BEHALF OF a user (e.g. a
    job the user enqueued). Data access is scoped to `on_behalf_of`; it does
    NOT inherit owner/admin powers and cannot read another user's data."""
    return Principal(
        user_id=f"worker:{on_behalf_of}", kind=PrincipalKind.WORKER,
        source=IdentitySource.SYSTEM, on_behalf_of=str(on_behalf_of),
    )


__all__ = [
    "PrincipalKind",
    "IdentitySource",
    "Principal",
    "resolve_principal",
    "system_principal",
    "worker_principal",
]
