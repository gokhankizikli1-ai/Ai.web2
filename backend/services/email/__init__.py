# coding: utf-8
"""Provider-neutral transactional email.

Public surface:
  send_email(to, subject, *, html, text=None) -> EmailResult
  EmailResult, EmailSendError

Backends are selected by EMAIL_PROVIDER (see backend.core.config):
  - "console" (default): dev-safe, never prints the token/URL in production.
  - "resend":  Resend HTTP API (Bearer RESEND_API_KEY).
"""
from backend.services.email.adapter import (
    EmailResult,
    EmailSendError,
    send_email,
)

__all__ = ["send_email", "EmailResult", "EmailSendError"]
