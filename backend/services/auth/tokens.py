# coding: utf-8
"""
Minimal HS256 JWT issue/verify — pure stdlib.

Why not PyJWT? Phase 3a ships without adding a new pip dependency to
keep the Railway redeploy contract minimal. Stdlib HS256 is ~80 lines
and easy to audit. The public API (`issue`, `verify`) is identical to
what PyJWT would give us, so swapping libraries later is a one-file
change.

Security mitigations:
  - Algorithm pinned to HS256. We reject any `alg` claim that isn't
    "HS256" — closes the algorithm-confusion / alg=none family of
    attacks.
  - hmac.compare_digest used for signature comparison — timing-safe.
  - base64url with manual padding so we never accept malformed input.
  - exp / nbf / iat / iss claims validated explicitly. Tokens with
    no `exp` are rejected.
  - Refuses to issue or verify tokens when `JWT_SECRET_KEY` is empty
    AND `ENVIRONMENT` is not literally "development". A leaked
    `DEBUG=True` in a production-labelled deploy is NOT trusted to
    enable the insecure fallback — that was Phase-1 finding R1.
  - Rejects any provided `JWT_SECRET_KEY` shorter than 32 bytes
    (Phase-1 finding R2). A 1-char prod secret is worse than no
    secret because the latter fails closed.

Token shape (claims):
  sub:   user id (string)
  iat:   issued-at (unix seconds)
  exp:   expiry  (unix seconds)
  nbf:   not-before (unix seconds, equal to iat)
  iss:   issuer (from settings.JWT_ISSUER)
  type:  "access" | "refresh"
  jti:   unique token id (uuid4 hex) — used by refresh-token storage
         for rotation/revocation
  + caller-supplied custom claims (e.g. {"kind": "guest"})
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import os
import secrets
import time
from typing import Any, Dict

from backend.core.config import settings


logger = logging.getLogger(__name__)


ALGORITHM = "HS256"
_HEADER_JSON = json.dumps({"alg": ALGORITHM, "typ": "JWT"}, separators=(",", ":")).encode()

# Production-hardening constants (Phase-1 PR #1).
# 32 bytes ≈ 256 bits — matches the HS256 output width. Shorter keys
# weaken the HMAC and are almost always typos.
_MIN_SECRET_BYTES = 32
_INSECURE_DEV_KEY = b"insecure-dev-key-do-not-use-in-production"


# ── Errors ────────────────────────────────────────────────────────────────
# Raised by verify(). The middleware translates these into 401 + an
# envelope error so the frontend can distinguish "expired, please refresh"
# from "malformed, please log in again".

class TokenError(Exception):
    code = "token_invalid"


class TokenExpiredError(TokenError):
    code = "token_expired"


class TokenSignatureError(TokenError):
    code = "token_bad_signature"


class TokenSecretMissingError(TokenError):
    code = "token_secret_missing"


# ── base64url helpers (with padding-tolerant decode) ──────────────────────

def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(data: str) -> bytes:
    # base64url-without-padding is what JWT uses. Re-pad before decode.
    rem = len(data) % 4
    if rem:
        data += "=" * (4 - rem)
    return base64.urlsafe_b64decode(data.encode("ascii"))


# ── Secret-key plumbing ───────────────────────────────────────────────────

def _secret() -> bytes:
    """Return the HMAC key bytes. Fails closed in any environment that
    isn't literal "development" when the key is missing or too short.

    Reads `os.environ["JWT_SECRET_KEY"]` DYNAMICALLY at each call (not
    cached on `settings`) so tests can monkeypatch the env var and have
    it take effect immediately, AND so Railway env-var rotations don't
    require a process restart to pick up.

    Hardening rules (Phase-1 PR #1):
      1. If a key is provided, it MUST be at least _MIN_SECRET_BYTES
         long. A too-short key raises — fail loudly at first use.
      2. If no key is provided, the insecure dev fallback is used ONLY
         when `ENVIRONMENT == "development"` (case-insensitive, trimmed).
         `settings.DEBUG` is intentionally NOT consulted: it's derived
         from ENVIRONMENT at import time and can desync from the
         current process env. A leaked DEBUG=True must NOT cause us to
         sign tokens with the public dev key.
      3. Any other environment with no key raises TokenSecretMissingError.
         AuthMiddleware catches this and degrades the request to an
         anonymous guest — the system is locked but doesn't crash.
    """
    key = os.environ.get("JWT_SECRET_KEY", "") or settings.JWT_SECRET_KEY
    if key:
        key_bytes = key.encode("utf-8")
        if len(key_bytes) < _MIN_SECRET_BYTES:
            raise TokenSecretMissingError(
                f"JWT_SECRET_KEY is too short ({len(key_bytes)} bytes). "
                f"Minimum is {_MIN_SECRET_BYTES} bytes."
            )
        return key_bytes

    env = os.environ.get("ENVIRONMENT", "production").strip().lower()
    if env == "development":
        logger.warning(
            "JWT_SECRET_KEY is empty — using INSECURE development fallback. "
            "Set JWT_SECRET_KEY before any production deploy."
        )
        return _INSECURE_DEV_KEY

    raise TokenSecretMissingError(
        "JWT_SECRET_KEY is not configured and ENVIRONMENT is not 'development'. "
        "Refusing to issue or verify tokens."
    )


# ── Issue ─────────────────────────────────────────────────────────────────

def issue(
    sub: str,
    *,
    token_type: str = "access",
    ttl_seconds: int,
    extra_claims: Dict[str, Any] | None = None,
) -> tuple[str, Dict[str, Any]]:
    """Sign and return a JWT plus the decoded claim set.

    Args:
      sub:           user id (becomes the `sub` claim — string).
      token_type:    "access" or "refresh". Stored as `type` claim so
                     verify() can reject access tokens used as refresh
                     (or vice versa).
      ttl_seconds:   seconds until expiry. No default — callers must
                     pick deliberately based on access vs refresh.
      extra_claims:  free-form extras merged into the payload (e.g.
                     {"kind": "guest", "scope": "chat"}). MUST NOT
                     overwrite the standard claims (iat / exp / nbf /
                     iss / sub / type / jti) — that's enforced here.

    Returns: (encoded_jwt, claims_dict).
    """
    now = int(time.time())
    jti = secrets.token_hex(16)
    claims: Dict[str, Any] = {
        "sub":  str(sub),
        "iat":  now,
        "nbf":  now,
        "exp":  now + ttl_seconds,
        "iss":  settings.JWT_ISSUER,
        "type": token_type,
        "jti":  jti,
    }
    if extra_claims:
        for k, v in extra_claims.items():
            if k in claims:
                raise ValueError(f"extra_claims cannot override standard claim '{k}'")
            claims[k] = v

    payload_json = json.dumps(claims, separators=(",", ":"), sort_keys=True).encode()
    head_b64 = _b64url_encode(_HEADER_JSON)
    body_b64 = _b64url_encode(payload_json)
    signing_input = f"{head_b64}.{body_b64}".encode("ascii")
    sig = hmac.new(_secret(), signing_input, hashlib.sha256).digest()
    token = f"{head_b64}.{body_b64}.{_b64url_encode(sig)}"
    return token, claims


# ── Verify ────────────────────────────────────────────────────────────────

def verify(token: str, *, expected_type: str | None = None) -> Dict[str, Any]:
    """Verify a JWT and return its claims.

    Raises:
      TokenError              malformed token or header
      TokenSignatureError     signature mismatch (timing-safe compare)
      TokenExpiredError       exp claim in the past
      TokenSecretMissingError no JWT_SECRET_KEY in production

    Always validates:
      - algorithm header is exactly "HS256" (no alg=none, no algorithm
        confusion)
      - signature is correct
      - exp is present and in the future
      - nbf, if present, is in the past or equal to now
      - type, if `expected_type` is passed, matches the claim
    """
    if not isinstance(token, str) or token.count(".") != 2:
        raise TokenError("token is not a JWT")
    head_b64, body_b64, sig_b64 = token.split(".")

    # Header check first — refuse any algorithm except HS256 to close the
    # alg=none / RS-vs-HS confusion attacks.
    try:
        header = json.loads(_b64url_decode(head_b64))
    except Exception as exc:
        raise TokenError(f"unparseable header: {exc}")
    if not isinstance(header, dict) or header.get("alg") != ALGORITHM:
        raise TokenError(f"unsupported alg: {header.get('alg')!r}")
    if header.get("typ") not in (None, "JWT"):
        raise TokenError(f"unsupported typ: {header.get('typ')!r}")

    # Signature check — timing-safe.
    signing_input = f"{head_b64}.{body_b64}".encode("ascii")
    expected = hmac.new(_secret(), signing_input, hashlib.sha256).digest()
    try:
        actual = _b64url_decode(sig_b64)
    except Exception as exc:
        raise TokenSignatureError(f"unparseable signature: {exc}")
    if not hmac.compare_digest(expected, actual):
        raise TokenSignatureError("signature mismatch")

    # Payload + claim validation.
    try:
        claims = json.loads(_b64url_decode(body_b64))
    except Exception as exc:
        raise TokenError(f"unparseable payload: {exc}")
    if not isinstance(claims, dict):
        raise TokenError("payload is not an object")

    now = int(time.time())
    exp = claims.get("exp")
    if not isinstance(exp, int) or exp <= now:
        raise TokenExpiredError(f"token expired at {exp}, now is {now}")
    nbf = claims.get("nbf")
    if isinstance(nbf, int) and nbf > now + 5:   # 5s clock-skew tolerance
        raise TokenError(f"token not yet valid (nbf={nbf}, now={now})")
    if expected_type is not None and claims.get("type") != expected_type:
        raise TokenError(f"wrong token type: expected {expected_type}, got {claims.get('type')}")

    return claims


__all__ = [
    "ALGORITHM",
    "issue", "verify",
    "TokenError", "TokenExpiredError", "TokenSignatureError",
    "TokenSecretMissingError",
]
