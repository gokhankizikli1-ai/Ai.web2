# coding: utf-8
"""
Route-facing glue for the starter-credit abuse gate: assemble a GrantContext from
the request (trusted-proxy IP + signed install cookie + provider + owner exempt)
and manage the HttpOnly installation-id cookie.

The install id is SERVER-issued and HMAC-signed (see services/auth/starter_abuse):
a client can present only ids we minted, and we persist only a keyed HASH. The
cookie is HttpOnly + SameSite=Lax, and Secure in production. It is one supporting
signal, never the sole denial reason; account-switching in one browser therefore
shares one install id (so a browser cannot farm multiple starter grants).
"""
from __future__ import annotations

import logging
from typing import Optional, Tuple

logger = logging.getLogger(__name__)

INSTALL_COOKIE = "korvix_iid"
_ONE_YEAR = 365 * 24 * 3600


def _is_production() -> bool:
    try:
        from backend.core.config import settings
        return str(getattr(settings, "ENVIRONMENT", "")).strip().lower() == "production"
    except Exception:
        return False


def build_context(request, *, provider: str, is_owner: bool = False):
    """Return (GrantContext, install_raw). `install_raw` is the value to write back
    to the cookie (existing verified id, or a freshly minted one). Never raises."""
    from backend.services.auth import starter_abuse
    from backend.services.credits_gateway import GrantContext
    raw: Optional[str] = None
    try:
        raw = starter_abuse.verify_install_id(request.cookies.get(INSTALL_COOKIE))
    except Exception:
        raw = None
    if not raw:
        raw = starter_abuse.issue_install_id()
    try:
        ip = starter_abuse.client_ip(request)
    except Exception:
        ip = None
    ctx = GrantContext(provider=provider, ip=ip, install_id=raw, exempt=bool(is_owner))
    return ctx, raw


def set_install_cookie(response, install_raw: str) -> None:
    """Persist the signed install id as an HttpOnly cookie. Best-effort."""
    if not install_raw or response is None:
        return
    try:
        response.set_cookie(
            key=INSTALL_COOKIE,
            value=install_raw,
            max_age=_ONE_YEAR,
            httponly=True,
            secure=_is_production(),
            samesite="lax",
            path="/",
        )
    except Exception:  # pragma: no cover — cookie set must never break the response
        logger.debug("starter_ctx: set_install_cookie failed (non-fatal)")


__all__ = ["build_context", "set_install_cookie", "INSTALL_COOKIE"]
