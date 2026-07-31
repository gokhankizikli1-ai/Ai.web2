# coding: utf-8
"""
Provider-neutral transactional email adapter.

Mirrors the HTTP seam used by the billing checkout clients (a single mockable
`_post` over httpx, Bearer key read dynamically from config, status-code-only
logging, typed domain error). Two backends:

  console  — the DEFAULT and the dev-safe fallback. Never sends anything over
             the network. In a NON-production environment it logs the message
             subject + destination and (only there) the body preview so a
             developer can grab the link from the logs. In production it logs a
             single REDACTED line (destination masked, no subject body, no URL,
             no token) so a verification token can never leak into prod logs.

  resend   — Resend HTTP API. Requires RESEND_API_KEY + EMAIL_FROM. If either is
             missing the adapter FAILS SAFE to the console backend rather than
             raising, so an unconfigured deploy degrades instead of 500-ing the
             signup path.

Security invariants (enforced here, relied on by callers):
  * The raw verification token / full verification URL is NEVER logged.
  * The full destination email is NEVER logged — only a masked form.
  * The API key is NEVER logged.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)


class EmailSendError(Exception):
    """Raised when a configured provider genuinely fails to accept the message.
    Callers treat email delivery as best-effort and must not fail the primary
    flow (signup) on this — they log and continue."""


@dataclass(frozen=True)
class EmailResult:
    provider: str          # "console" | "resend"
    delivered: bool        # True when the provider accepted the message
    detail: str = ""       # non-sensitive status note (never contains the token)


def _mask_email(addr: str) -> str:
    """g***@domain.com — enough to correlate in logs, never the full mailbox."""
    a = (addr or "").strip()
    if "@" not in a:
        return "***"
    local, _, domain = a.partition("@")
    head = local[:1] if local else ""
    return f"{head}***@{domain}"


def _is_production() -> bool:
    from backend.core.config import settings
    return str(getattr(settings, "ENVIRONMENT", "")).strip().lower() == "production"


# ── HTTP seam (single mockable network call — matches billing/checkout) ──────

async def _post(url: str, *, headers: Dict[str, str], body: Dict[str, Any], timeout: float):
    import httpx
    async with httpx.AsyncClient(timeout=timeout) as http:
        return await http.post(url, json=body, headers=headers)


# ── Backends ─────────────────────────────────────────────────────────────────

def _send_console(to: str, subject: str, *, text: Optional[str]) -> EmailResult:
    """Dev-safe backend. Prints nothing sensitive in production."""
    if _is_production():
        # Redacted: no subject text, no body, no URL, no token.
        logger.info("email.console dispatch | to=%s", _mask_email(to))
        return EmailResult(provider="console", delivered=False, detail="console (redacted in prod)")
    # Non-production: developers may see the body (which contains the link) so
    # they can complete a local verification flow without a real mailbox.
    preview = (text or "").strip()
    logger.info(
        "email.console (dev) | to=%s | subject=%s\n%s",
        _mask_email(to), subject, preview,
    )
    return EmailResult(provider="console", delivered=False, detail="console (dev preview)")


async def _send_resend(to: str, subject: str, *, html: str, text: Optional[str]) -> EmailResult:
    from backend.core.config import settings
    api_key = (settings.RESEND_API_KEY or "").strip()
    sender = (settings.EMAIL_FROM or "").strip()
    if not api_key or not sender:
        # Fail SAFE — never crash signup because email isn't provisioned yet.
        logger.warning("email.resend not configured (missing key/from) — using console fallback")
        return _send_console(to, subject, text=text)

    payload: Dict[str, Any] = {"from": sender, "to": [to], "subject": subject, "html": html}
    if text:
        payload["text"] = text
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    try:
        resp = await _post(
            "https://api.resend.com/emails",
            headers=headers, body=payload,
            timeout=float(settings.EMAIL_TIMEOUT_SEC),
        )
    except Exception as exc:  # httpx transport error — status/type only
        logger.warning("email.resend transport error: %s", type(exc).__name__)
        raise EmailSendError("email provider transport error") from None
    if resp.status_code >= 400:
        # Status code only — never the response body (may echo recipient).
        logger.warning("email.resend rejected | status=%d | to=%s", resp.status_code, _mask_email(to))
        raise EmailSendError(f"email provider returned {resp.status_code}")
    logger.info("email.resend accepted | to=%s", _mask_email(to))
    return EmailResult(provider="resend", delivered=True, detail="accepted")


# ── Public entry point ───────────────────────────────────────────────────────

async def send_email(to: str, subject: str, *, html: str, text: Optional[str] = None) -> EmailResult:
    """Send one transactional email via the configured provider.

    Returns an EmailResult. Raises EmailSendError only when a *configured*
    provider actively rejects the message; the console backend never raises.
    Callers (verification send) treat delivery as best-effort.
    """
    from backend.core.config import settings
    provider = str(getattr(settings, "EMAIL_PROVIDER", "console")).strip().lower()
    if provider == "resend":
        return await _send_resend(to, subject, html=html, text=text)
    # Default + unknown → console (dev-safe).
    return _send_console(to, subject, text=text)


__all__ = ["send_email", "EmailResult", "EmailSendError"]
