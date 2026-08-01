# coding: utf-8
"""
Verification-email orchestration: cooldown/abuse checks → mint token → build the
link → render + dispatch via the provider-neutral mail adapter.

Kept separate from `verification.py` (pure state/token store) so the token store
stays trivially unit-testable without importing httpx/email templates, and so
the async send path lives in one place.

The link points at the SPA using a HashRouter fragment:
    {PUBLIC_APP_URL}/#/verify-email?token=<raw>
The token rides in the URL *fragment*, which browsers never transmit to the
server, so the raw token cannot land in backend access logs. The SPA reads it
and POSTs it to /v2/auth/email-verification/confirm.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional
from urllib.parse import quote

from backend.core.config import settings
from backend.services.auth import verification

logger = logging.getLogger(__name__)

# Best-effort per-IP hourly cap (in-process; resets on redeploy). The durable
# per-user cap in verification.send_cooldown_remaining is the primary control;
# this adds a cheap IP-level brake against spraying many accounts from one host.
_IP_HITS: Dict[str, List[datetime]] = {}


@dataclass(frozen=True)
class SendOutcome:
    sent: bool
    cooldown_remaining: int = 0
    reason: str = ""       # non-secret: "sent" | "cooldown" | "ip_rate_limited" | "skipped"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _ip_allowed(ip: Optional[str]) -> bool:
    ip = (ip or "").strip()
    if not ip:
        return True
    cap = max(1, int(getattr(settings, "EMAIL_VERIFICATION_MAX_SENDS_PER_IP_HOUR", 20) or 20))
    now = _now()
    cutoff = now - timedelta(hours=1)
    hits = [t for t in _IP_HITS.get(ip, []) if t > cutoff]
    if len(hits) >= cap:
        _IP_HITS[ip] = hits
        return False
    hits.append(now)
    _IP_HITS[ip] = hits
    # Opportunistic cleanup so the dict can't grow unbounded.
    if len(_IP_HITS) > 4096:
        for k in [k for k, v in _IP_HITS.items() if not any(t > cutoff for t in v)]:
            _IP_HITS.pop(k, None)
    return True


def _link_base() -> str:
    # Spec name EMAIL_VERIFICATION_BASE_URL wins; fall back to PUBLIC_APP_URL.
    base = (getattr(settings, "EMAIL_VERIFICATION_BASE_URL", "") or "").rstrip("/")
    if base:
        return base
    return (settings.PUBLIC_APP_URL or "https://korvixai.com").rstrip("/")


def build_verification_link(raw_token: str) -> str:
    return f"{_link_base()}/#/verify-email?token={quote(raw_token, safe='')}"


def _render(link: str, ttl_min: int) -> Dict[str, str]:
    subject = "Verify your email for KorvixAI"
    text = (
        "Welcome to KorvixAI!\n\n"
        "Confirm your email address to activate your account and unlock your "
        f"starter credits. This link expires in {ttl_min} minutes:\n\n"
        f"{link}\n\n"
        "If you didn't create a KorvixAI account, you can ignore this email.\n"
    )
    html = (
        '<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;'
        'max-width:480px;margin:0 auto;color:#0f172a">'
        '<h2 style="margin:0 0 12px">Verify your email</h2>'
        '<p style="margin:0 0 16px;color:#475569;line-height:1.5">'
        'Confirm your email address to activate your KorvixAI account and unlock '
        'your starter credits.</p>'
        f'<p style="margin:0 0 24px"><a href="{link}" '
        'style="display:inline-block;background:#3B82F6;color:#fff;text-decoration:none;'
        'padding:11px 20px;border-radius:8px;font-weight:600">Verify email</a></p>'
        f'<p style="margin:0 0 8px;color:#94a3b8;font-size:12px">This link expires in '
        f'{ttl_min} minutes. If the button doesn\'t work, paste this URL into your '
        'browser:</p>'
        f'<p style="margin:0;color:#64748b;font-size:12px;word-break:break-all">{link}</p>'
        '<p style="margin:24px 0 0;color:#94a3b8;font-size:12px">If you didn\'t create '
        'a KorvixAI account, you can safely ignore this email.</p>'
        '</div>'
    )
    return {"subject": subject, "html": html, "text": text}


async def send_verification_email(
    user_id: str,
    email: str,
    *,
    request_ip: Optional[str] = None,
) -> SendOutcome:
    """Mint a token and dispatch the verification email, honouring cooldown +
    per-IP abuse limits. Best-effort: a delivery failure never raises to the
    caller (signup/resend must still succeed). Returns a non-secret outcome."""
    uid = (user_id or "").strip()
    em = (email or "").strip()
    if not uid or not em:
        return SendOutcome(sent=False, reason="skipped")

    cooldown = verification.send_cooldown_remaining(uid)
    if cooldown > 0:
        return SendOutcome(sent=False, cooldown_remaining=cooldown, reason="cooldown")

    if not _ip_allowed(request_ip):
        # Generic to the caller; logged at info without the IP.
        logger.info("verification.send ip-rate-limited")
        return SendOutcome(sent=False, reason="ip_rate_limited")

    try:
        raw = verification.issue_token(uid, em, request_ip=request_ip)
    except Exception:
        logger.warning("verification.send: token mint failed")
        return SendOutcome(sent=False, reason="skipped")

    # Display TTL in minutes, derived from the authoritative seconds-based TTL.
    ttl_min = max(1, round(verification._ttl_seconds() / 60))
    link = build_verification_link(raw)
    msg = _render(link, ttl_min)
    try:
        from backend.services.email import send_email
        await send_email(em, msg["subject"], html=msg["html"], text=msg["text"])
    except Exception:
        # Delivery failed but the token is live — the user can resend. Never
        # surface the provider error (or the link) to the caller.
        logger.warning("verification.send: delivery failed (non-fatal)")
        return SendOutcome(sent=True, cooldown_remaining=verification.send_cooldown_remaining(uid), reason="sent")

    return SendOutcome(
        sent=True,
        cooldown_remaining=verification.send_cooldown_remaining(uid),
        reason="sent",
    )


__all__ = ["send_verification_email", "build_verification_link", "SendOutcome"]
