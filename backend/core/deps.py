# coding: utf-8
"""
FastAPI dependencies for auth.

  current_user(request)   ALWAYS returns a User. Resolution order:
                           1. request.state.user (populated by
                              AuthMiddleware when ENABLE_AUTH_V2=true)
                           2. Authorization: Bearer <jwt> header,
                              decoded directly here (works whether or
                              not AuthMiddleware is enabled)
                           3. Synthetic guest fallback
                          This is the fix for "Owner Mode invisible
                          after login on a deploy without ENABLE_AUTH_V2"
                          — without step 2, the JWT issued by /auth/login
                          and /auth/google was being ignored by every
                          /v2/admin/* route.

  require_auth(request)   Returns a User. Raises UnauthorizedError when
                          the request is a guest.

  require_owner(request)  Returns the authenticated owner. Identity
                          path OR OWNER_TOKEN header path.
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import Request

from backend.services.auth.errors import MissingTokenError
from backend.services.auth.identity import User


logger = logging.getLogger(__name__)


_FALLBACK_GUEST = User(
    id="guest:no-middleware",
    kind="guest",
    external_id="guest:no-middleware",
    display_name="",
)


# ── Bearer-token fallback ────────────────────────────────────────────────
#
# When AuthMiddleware is OFF, /v2/admin/* routes still need to recognise
# a freshly-logged-in user — otherwise Owner Mode never activates after
# Google login on a deploy where ENABLE_AUTH_V2 wasn't flipped. This
# helper decodes the JWT directly and tries both identity backends
# (auth_users for Google/Apple/guest, auth_password_users for email
# signup). Returns None on any failure; callers fall back to guest.

def _extract_bearer(request: Request) -> str:
    try:
        raw = request.headers.get("Authorization", "") or ""
    except Exception:
        return ""
    raw = raw.strip()
    if not raw.lower().startswith("bearer "):
        return ""
    return raw[7:].strip()


def _user_from_bearer(token: str) -> Optional[User]:
    """Verify a Bearer JWT and resolve it to a User dataclass.

    Returns None when:
      - token can't be verified (bad signature, expired, missing secret)
      - sub claim is empty
      - user no longer exists in either identity backend
    Never raises — callers depend on a clean None.
    """
    if not token:
        return None
    try:
        from backend.services.auth import tokens
        claims = tokens.verify(token, expected_type="access")
    except Exception as exc:
        logger.debug("current_user bearer decode failed: %s", exc)
        return None

    sub = str(claims.get("sub", "") or "").strip()
    if not sub:
        return None

    # 1) Identity store — Google / Apple / guest (matches the kind values
    #    in auth_users.kind). This is where Google logins land.
    try:
        from backend.services.auth.storage import get_user_by_id
        u = get_user_by_id(sub)
        if u is not None:
            return u
    except Exception as exc:
        logger.debug("current_user identity lookup failed: %s", exc)

    # 2) Password store — email/password signup. Synthesize a User
    #    dataclass with the same external_id convention the identity
    #    store would use, so downstream owner-email matching works
    #    consistently across both auth paths.
    try:
        from backend.services.auth import passwords
        pwu = passwords.get_by_id(sub)
        if pwu is not None:
            email = str(pwu.get("email", "") or "").strip().lower()
            return User(
                id=sub,
                kind="email",
                external_id=f"email:{email}" if email else f"password:{sub}",
                display_name=str(pwu.get("display_name") or ""),
            )
    except Exception as exc:
        logger.debug("current_user password lookup failed: %s", exc)

    return None


def current_user(request: Request) -> User:
    """Best-effort identity. Always returns a User, never raises.

    Resolution order:
      1. request.state.user (AuthMiddleware path) — preferred when set
         and non-guest, since the middleware already validated the token.
      2. Authorization: Bearer header — decoded inline so admin routes
         work whether or not ENABLE_AUTH_V2 is on. Required for the
         common "Google login on prod" path.
      3. Whatever the middleware did set (incl. a guest user) — keeps
         the original guest-id flow intact.
      4. Synthetic guest fallback when nothing else worked.
    """
    state_user = getattr(request.state, "user", None)
    if isinstance(state_user, User) and not state_user.is_guest:
        return state_user

    # Try the bearer header directly. Cheap when no header is present
    # (returns "" → None) so this isn't a per-request DB cost for
    # anonymous traffic.
    bearer = _extract_bearer(request)
    if bearer:
        bearer_user = _user_from_bearer(bearer)
        if bearer_user is not None:
            return bearer_user

    if isinstance(state_user, User):
        return state_user
    return _FALLBACK_GUEST


def require_auth(request: Request) -> User:
    """Returns the request's authenticated user. Raises if guest."""
    user = current_user(request)
    if user.is_guest:
        raise MissingTokenError(
            "This route requires authentication. Pass an Authorization: Bearer header."
        )
    return user


_OWNER_TOKEN_HEADER = "X-Korvix-Owner-Token"


def _extract_owner_token(request: Request) -> str:
    """Pull the owner-token header (if any) off a request. Truncates
    aggressively so a hostile client can't blow the request size budget."""
    try:
        raw = request.headers.get(_OWNER_TOKEN_HEADER, "") or ""
    except Exception:
        return ""
    return raw.strip()[:512]


def require_owner(request: Request) -> User:
    """Returns the authenticated owner identity. Raises when neither
    unlock path matches.

    SECURITY PRECEDENCE — identity-first. See backend.services.admin
    .owner.is_owner_request() for the full rationale. Short version:

      1. AUTHENTICATED user with extractable email:
           - email matches OWNER_EMAIL → return that user.
           - email does NOT match      → raise. OWNER_TOKEN is NOT
                                          consulted in this branch.
      2. GUEST / no email:
           - OWNER_TOKEN matches → return the (guest) user.
           - no token / wrong   → raise MissingTokenError.

    This was changed from a union check (identity OR token) after a
    bug where a non-owner Google sign-in could still appear as owner
    because OWNER_TOKEN was left in localStorage by a previous unlock.
    """
    from backend.core.errors import UnauthorizedError
    from backend.services.admin.owner import (
        is_owner, match_owner_token,
    )
    from backend.services.admin.owner import _user_email as _email_of

    user = current_user(request)
    token = _extract_owner_token(request)

    # Identity path — authoritative for any signed-in user with an email.
    if not user.is_guest:
        email = _email_of(user)
        if email is not None:
            if is_owner(user):
                return user
            # Signed in but not the owner. Don't fall back to token.
            raise UnauthorizedError(
                "This route requires owner privileges.",
                code="owner_required",
            )
        # Authenticated but no email — fall through to token check.

    # Token path — only for guests or no-email identities.
    if token and match_owner_token(token):
        return user

    if user.is_guest and not token:
        raise MissingTokenError(
            "This route requires owner privileges. Provide a Bearer auth "
            "token or X-Korvix-Owner-Token header.",
        )
    raise UnauthorizedError(
        "This route requires owner privileges.",
        code="owner_required",
    )


# ── Authoritative user-id resolution (shared) ────────────────────────────
#
# Single source of truth for "which user_id do we trust", used by every
# guest-allowed route that takes a user_id in its body (chat, orchestrate).
# Identity comes from the AUTHENTICATED context, never blindly from the
# request payload — a logged-in client cannot act as another account by
# putting a different user_id in the body.
#
# Precedence (mirrors AuthMiddleware + current_user):
#   1. Verified JWT subject — request.state.user_id (AuthMiddleware path)
#      or an inline Bearer verify here, so the guarantee holds whether or
#      not ENABLE_AUTH_V2 is on. A bad/expired token does NOT fall through
#      to body.user_id (that would re-open the impersonation hole) — it
#      falls through to the guest/legacy paths as if no token was sent.
#   2. X-Korvix-Guest-Id header — the FE's stable browser nonce (the
#      identity for guest sessions, which this product explicitly supports).
#   3. body_user_id — legacy fallback, ONLY when neither auth signal
#      exists. Logged so pre-fix / proxied clients are visible in prod.
#
# Extracted from routes/chat.py (the original Phase-1 P0 fix) so
# /v2/orchestrate and any future user_id-bearing route reuse the exact same
# precedence instead of re-implementing (and drifting from) it.

def resolve_uid_and_source(
    request: Request, body_user_id: str = "", *, log_prefix: str = "",
) -> tuple[str, str]:
    """Resolve the trusted user_id AND its provenance in one place.

    Returns (user_id, source) where source ∈
    {"middleware","jwt","guest-header","body","anonymous"}. This is THE
    implementation; resolve_authoritative_uid is a thin wrapper. Having a
    single function means /chat, /v2/chat/stream and /v2/orchestrate cannot
    drift apart on the identity contract.
    """
    tag = (log_prefix or "AUTH").strip()

    # 1a. AuthMiddleware-populated state (ENABLE_AUTH_V2=true path).
    state_uid = getattr(request.state, "user_id", None)
    if isinstance(state_uid, str) and state_uid and state_uid != "guest:anonymous":
        return state_uid, "middleware"

    # 1b. Direct Authorization header — middleware may be off; VERIFY the
    #     signature here so the security guarantee holds either way. (We must
    #     never trust an unsigned/forged `sub`.)
    try:
        auth = (request.headers.get("authorization") or "").strip()
    except Exception:
        auth = ""
    if auth.lower().startswith("bearer "):
        token = auth[7:].strip()
        if token:
            try:
                from backend.services.auth import tokens
                claims = tokens.verify(token, expected_type="access")
                sub = claims.get("sub")
                if isinstance(sub, str) and sub:
                    return sub, "jwt"
            except Exception as exc:
                # Bad / expired / mis-signed token → DO NOT fall back to
                # body.user_id. Fall through to guest/legacy paths.
                logger.warning(
                    "%s | bearer present but unverifiable (%s) — falling "
                    "through to guest path, NOT body.user_id",
                    tag, type(exc).__name__,
                )

    # 2. Guest stable nonce from the FE.
    try:
        guest_hdr = (request.headers.get("x-korvix-guest-id") or "").strip()
    except Exception:
        guest_hdr = ""
    if guest_hdr:
        return guest_hdr[:64], "guest-header"  # match AuthMiddleware truncation

    # 3. Legacy fallback — body.user_id. Pre-fix clients still work; new
    #    clients hit this only when explicitly anonymous + no guest nonce.
    if body_user_id:
        logger.warning(
            "%s | no auth signal (no Bearer, no X-Korvix-Guest-Id) — falling "
            "back to body.user_id. Pre-fix client OR proxy stripped the header.",
            tag,
        )
        return body_user_id, "body"

    return "anonymous", "anonymous"


def resolve_authoritative_uid(
    request: Request, body_user_id: str = "", *, log_prefix: str = "",
) -> str:
    """Trusted user_id (see resolve_uid_and_source for the full contract)."""
    return resolve_uid_and_source(request, body_user_id, log_prefix=log_prefix)[0]


def authorize_user_scope(request: Request, requested_user_id: str, *, normalize=None) -> bool:
    """Return True if the caller is allowed to act on `requested_user_id`.

    Used to retrofit ownership onto the legacy, pre-auth per-user routes
    (/memory, /profile) WITHOUT trusting the caller-supplied id for
    identity.

      - Owner → always allowed (may inspect any user).
      - Otherwise the caller's AUTHENTICATED identity (verified JWT, or a
        guest's X-Korvix-Guest-Id nonce) must match `requested_user_id`.
        Crucially the identity is resolved with NO body/path fallback, so
        an unauthenticated caller resolves to "anonymous" and can never
        match a real user's id — closing the IDOR.

    `normalize` lets a route map both ids through its own id scheme (e.g.
    the int-hash these legacy routes use) before comparing.
    """
    # Identity WITHOUT the requested-id fallback — an unauthenticated
    # caller must NOT resolve to the id they are asking about.
    caller = resolve_authoritative_uid(request, "", log_prefix="LEGACY")
    try:
        u = current_user(request)
        from backend.services.admin.owner import is_owner_request
        if is_owner_request(u, owner_token=_extract_owner_token(request)):
            return True
    except Exception:  # pragma: no cover — never let the authz check 500
        pass
    a, b = caller, str(requested_user_id or "")
    if normalize is not None:
        try:
            a, b = normalize(caller), normalize(str(requested_user_id or ""))
        except Exception:  # pragma: no cover
            return False
    return str(a) == str(b)


__all__ = [
    "current_user",
    "require_auth",
    "require_owner",
    "resolve_authoritative_uid",
    "resolve_uid_and_source",
    "authorize_user_scope",
]
