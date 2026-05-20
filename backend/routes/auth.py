# coding: utf-8
"""
Auth routes.

  GET  /auth/status   legacy liveness (unchanged — backward compatible)
  POST /auth/signup    email + password registration → access token
  POST /auth/login     email + password → access token
  GET  /auth/me        current user (protected; Bearer access token)
  POST /auth/logout    stateless logout (client discards token)

Additive & Railway-safe:
  - New paths only; no existing route/response shape changed.
  - Reuses the existing stdlib JWT (backend.services.auth.tokens) and
    JWT_SECRET_KEY — no new env var, no new pip dependency.
  - Credentials live in a new table in the existing auth.db
    (backend.services.auth.passwords).
  - Service/token imports are lazy inside handlers so a problem here can
    never break app boot or other routers.
  - Guest / anonymous /chat is untouched and keeps working — these
    endpoints are opt-in. `get_optional_user` is provided so chat history
    can be linked to a user_id in a LATER change without new infra.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel

router = APIRouter(prefix="/auth", tags=["auth"])
logger = logging.getLogger(__name__)

# 24h access token. Stateless: no server-side access-token store, so
# logout is client-side discard. Refresh-token issuance is intentionally
# out of scope for this minimal, backward-safe slice.
ACCESS_TTL_SECONDS = 24 * 3600


# ── Request models (no pydantic.EmailStr — email-validator isn't a dep) ──

class SignupRequest(BaseModel):
    email: str
    password: str
    display_name: str = ""


class LoginRequest(BaseModel):
    email: str
    password: str


# ── Helpers ───────────────────────────────────────────────────────────────

def _err(status_code: int, code: str, message: str) -> HTTPException:
    return HTTPException(
        status_code=status_code,
        detail={"error": code, "code": code, "message": message},
    )


def _issue_access(user: Dict[str, Any]) -> Dict[str, Any]:
    """Issue an access token for a user dict. Maps a missing
    JWT_SECRET_KEY to a clean 503 instead of a 500/crash. Annotates
    is_owner on the user before returning so every path (login/signup/
    google) carries the gate consistently. JWT `kind` claim mirrors the
    user's actual provider rather than being hardcoded to 'email'."""
    user = _annotate_owner(user)
    kind = str(user.get("kind") or "email")
    from backend.services.auth import tokens
    try:
        token, _claims = tokens.issue(
            sub=user["id"],
            token_type="access",
            ttl_seconds=ACCESS_TTL_SECONDS,
            extra_claims={"kind": kind, "email": user.get("email", "")},
        )
    except tokens.TokenSecretMissingError:
        raise _err(503, "auth_not_configured",
                   "Authentication is not configured (JWT_SECRET_KEY missing).")
    return {
        "access_token": token,
        "token_type": "bearer",
        "expires_in": ACCESS_TTL_SECONDS,
        "user": user,
    }


def _decode_bearer(authorization: Optional[str]) -> Dict[str, Any]:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise _err(401, "missing_token", "Authorization: Bearer <token> required.")
    raw = authorization.split(" ", 1)[1].strip()
    from backend.services.auth import tokens
    try:
        return tokens.verify(raw, expected_type="access")
    except tokens.TokenExpiredError:
        raise _err(401, "expired_token", "Access token expired. Please log in again.")
    except tokens.TokenSecretMissingError:
        raise _err(503, "auth_not_configured",
                   "Authentication is not configured (JWT_SECRET_KEY missing).")
    except tokens.TokenError:
        raise _err(401, "invalid_token", "Invalid authentication token.")


def _owner_email() -> str:
    """OWNER_EMAIL env (single canonical owner address). Empty when unset
    → no user can ever be flagged as owner."""
    import os
    return os.getenv("OWNER_EMAIL", "").strip().lower()


def _annotate_owner(user: Dict[str, Any]) -> Dict[str, Any]:
    """Additive: stamp is_owner on the user dict. Never raises."""
    try:
        owner = _owner_email()
        email = str(user.get("email", "")).strip().lower()
        user["is_owner"] = bool(owner) and email == owner
    except Exception:
        user["is_owner"] = False
    return user


def _identity_user_dict(iuser) -> Dict[str, Any]:
    """Map an auth_users (identity-store) row to the public user dict
    shape used by /auth/me. For OAuth users we use external_id as the
    canonical email (provider-verified)."""
    email = iuser.external_id if iuser.kind in ("email", "google", "apple") else ""
    return {
        "id":            iuser.id,
        "email":         email,
        "kind":          iuser.kind,
        "display_name":  iuser.display_name or "",
        "created_at":    iuser.created_at,
        "last_login_at": iuser.last_seen_at,
    }


def get_current_user(authorization: Optional[str] = Header(default=None)) -> Dict[str, Any]:
    """Protected-user dependency. Use as `Depends(get_current_user)` on
    any route that must have an authenticated user. Resolves users from
    BOTH backends — email/password (passwords store) and OAuth/identity
    (auth_users store) — so Google/Apple tokens authenticate the same
    way as email/password ones."""
    claims = _decode_bearer(authorization)
    sub = str(claims.get("sub", ""))
    # 1) password user (email/password signup)
    from backend.services.auth import passwords
    user = passwords.get_by_id(sub)
    if user is not None:
        return _annotate_owner(user)
    # 2) identity user (Google / Apple / guest)
    try:
        from backend.services.auth.storage import get_user_by_id
        iuser = get_user_by_id(sub)
        if iuser is not None:
            return _annotate_owner(_identity_user_dict(iuser))
    except Exception as exc:
        logger.warning("auth.get_current_user: identity lookup failed: %s", exc)
    raise _err(401, "invalid_token", "Account no longer exists.")


def get_optional_user(
    authorization: Optional[str] = Header(default=None),
) -> Optional[Dict[str, Any]]:
    """Non-enforcing variant — returns the user or None, never raises.
    Reserved so a later change can link chat history to a user_id
    WITHOUT changing existing anonymous/guest behaviour. Not wired into
    /chat in this change."""
    try:
        return get_current_user(authorization)
    except HTTPException:
        return None


# ── Routes ────────────────────────────────────────────────────────────────

@router.get("/status")
async def auth_status():
    # Unchanged — pre-existing contract.
    return {"authenticated": False}


@router.post("/signup", status_code=status.HTTP_201_CREATED)
async def signup(body: SignupRequest):
    from backend.services.auth import passwords
    try:
        user = passwords.create_user(body.email, body.password, body.display_name)
    except passwords.EmailExistsError as e:
        raise _err(409, "email_exists", str(e))
    except passwords.InvalidInputError as e:
        raise _err(400, "validation_error", str(e))
    logger.info("auth.signup ok | user=%s", user["id"])
    return _issue_access(user)


@router.post("/login")
async def login(body: LoginRequest):
    from backend.services.auth import passwords
    user = passwords.verify_credentials(body.email, body.password)
    if user is None:
        # Generic — never reveal whether the email exists.
        raise _err(401, "invalid_credentials", "Invalid email or password.")
    try:
        passwords.touch_login(user["id"])
        # Re-read so the login response's `last_login_at` matches what a
        # subsequent GET /auth/me returns (same source). Best-effort:
        # never fail the login on this.
        fresh = passwords.get_by_id(user["id"])
        if fresh is not None:
            user = fresh
    except Exception as exc:  # best-effort; never fail login on this
        logger.warning("auth.login touch failed (non-fatal): %s", exc)
    logger.info("auth.login ok | user=%s", user["id"])
    return _issue_access(user)


@router.get("/me")
async def me(user: Dict[str, Any] = Depends(get_current_user)):
    return {"user": user}


@router.post("/logout")
async def logout(authorization: Optional[str] = Header(default=None)):
    """Stateless logout. Access tokens are short-lived and not stored
    server-side, so logout = the client discards the token. Idempotent
    and forgiving (always 200, even without a valid token)."""
    return {
        "ok": True,
        "detail": "Logged out. Discard the access token client-side; "
                  "it expires automatically.",
    }


# ── OAuth (Google / Apple) ────────────────────────────────────────────────

class OAuthRequest(BaseModel):
    id_token: str


def _verify_google_id_token(id_token: str) -> Dict[str, Any]:
    """Verify a Google ID token via the public tokeninfo endpoint.

    Pure stdlib (no new pip dep). The tokeninfo endpoint Google operates
    at https://oauth2.googleapis.com/tokeninfo validates the token's
    signature, expiry, audience and issuer server-side, then returns the
    decoded claims. We additionally verify:
      - email_verified === "true"
      - aud === VITE_GOOGLE_CLIENT_ID (when configured server-side via
        GOOGLE_CLIENT_ID) so a token issued for a different app can't
        log into ours.
    """
    import json as _json
    import os as _os
    import urllib.parse as _urlparse
    import urllib.request as _urlreq
    url = "https://oauth2.googleapis.com/tokeninfo?" + _urlparse.urlencode({"id_token": id_token})
    req = _urlreq.Request(url, headers={"User-Agent": "KorvixAI/1.0"})
    try:
        with _urlreq.urlopen(req, timeout=10) as r:
            body = r.read()
    except Exception as exc:
        raise _err(401, "invalid_id_token", f"Could not verify Google id_token: {exc}")
    try:
        payload = _json.loads(body)
    except Exception:
        raise _err(401, "invalid_id_token", "Google tokeninfo returned non-JSON.")
    if not isinstance(payload, dict) or payload.get("error_description"):
        raise _err(401, "invalid_id_token", str(payload.get("error_description") or payload.get("error") or "Token rejected by Google."))
    aud = str(payload.get("aud", ""))
    expected_aud = _os.getenv("GOOGLE_CLIENT_ID", "").strip()
    if expected_aud and aud != expected_aud:
        raise _err(401, "invalid_id_token",
                   "Google id_token audience does not match GOOGLE_CLIENT_ID.")
    if str(payload.get("email_verified", "")).lower() not in ("true", "1"):
        raise _err(401, "invalid_id_token", "Google email is not verified.")
    email = str(payload.get("email", "")).strip().lower()
    if not email:
        raise _err(401, "invalid_id_token", "Google id_token missing email claim.")
    return {
        "email": email,
        "name":  str(payload.get("name", "")) or email.split("@")[0],
        "sub":   str(payload.get("sub", "")),
    }


@router.post("/google")
def auth_google(body: OAuthRequest):
    """Verify a Google ID token server-side and issue our own access
    token. Creates/looks up the user in the identity store by email.
    NEVER trusts frontend-only email claims — the email comes from the
    Google-verified payload.

    Plain `def` (not `async def`) because Google's tokeninfo verifier
    uses blocking `urllib.request.urlopen`; FastAPI runs sync handlers
    in a thread pool so a 10s tokeninfo call can't freeze the event
    loop for all other concurrent requests.
    """
    claims = _verify_google_id_token(body.id_token)
    try:
        from backend.services.auth.storage import get_or_create_user, touch_user
        iuser = get_or_create_user("google", claims["email"], display_name=claims["name"])
        try:
            touch_user(iuser.id)
        except Exception as exc:
            logger.warning("auth.google touch_user failed (non-fatal): %s", exc)
    except Exception as exc:
        logger.error("auth.google: identity store error: %s", exc)
        raise _err(500, "auth_storage_error", "Could not persist Google user.")
    user = _annotate_owner(_identity_user_dict(iuser))
    logger.info("auth.google ok | user=%s | email=%s", iuser.id, claims["email"])
    return _issue_access(user)


@router.post("/apple")
async def auth_apple(body: OAuthRequest):
    """Apple Sign-In endpoint — feature-gated.

    Verifying Apple ID tokens requires RS256 signature verification
    against Apple's JWKS, which needs the `cryptography` Python package
    (not currently in requirements). Until that dep is added + verified
    on Railway, this endpoint returns 503 with a clear message so the
    frontend can display 'Apple sign-in coming soon' rather than failing
    silently. Enabling: install `cryptography` and replace this stub
    with a JWKS-based verifier, then drop the env gate.
    """
    import os as _os
    if _os.getenv("ENABLE_APPLE_AUTH", "false").strip().lower() != "true":
        # Acknowledge the request shape (body is read so the client
        # gets a parser-level OK) and return a clean service-disabled.
        _ = body.id_token  # noqa: F841 — intentionally unused
        raise HTTPException(
            status_code=503,
            detail={
                "error":   "apple_auth_unavailable",
                "code":    "SERVICE_DISABLED",
                "message": "Apple sign-in is not enabled on this deployment. "
                           "Set ENABLE_APPLE_AUTH=true after installing the "
                           "`cryptography` package + a JWKS verifier.",
            },
        )
    # ENABLE_APPLE_AUTH=true but verifier not implemented — fail loudly.
    raise HTTPException(
        status_code=501,
        detail={
            "error":   "apple_auth_not_implemented",
            "code":    "NOT_IMPLEMENTED",
            "message": "Apple verifier scaffold present but server-side JWKS "
                       "verification is pending. Add `cryptography` to "
                       "requirements.txt and wire JWKS in this handler.",
        },
    )
