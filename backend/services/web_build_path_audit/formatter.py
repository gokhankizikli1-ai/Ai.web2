# coding: utf-8
"""
Web Build Path Audit — serialization + safety sanitization.

Turns the static audit into a bounded, JSON-safe dict and enforces the security boundary:
strings are length-capped and a defensive scan drops any value that looks like a secret
(API-key-ish tokens). The registry content is already reference-only (file paths + symbol
names + short notes) — this is belt-and-suspenders so the runtime response can never leak
a prompt, source code, or a credential.
"""
from __future__ import annotations

import re
from typing import Any

_MAX_STR = 400
_MAX_LIST = 64
# Heuristic secret markers — if a string smells like a credential, blank it.
_SECRET_RE = re.compile(
    r"(sk-[A-Za-z0-9]{8,}|api[_-]?key\s*[:=]|secret\s*[:=]|bearer\s+[A-Za-z0-9._-]{8,}|"
    r"password\s*[:=]|-----BEGIN)",
    re.IGNORECASE,
)


def _clean_str(value: str) -> str:
    text = " ".join(str(value).split()).strip()
    if _SECRET_RE.search(text):
        return "[redacted]"
    return text[:_MAX_STR]


def _sanitize(value: Any) -> Any:
    if isinstance(value, str):
        return _clean_str(value)
    if isinstance(value, bool) or value is None or isinstance(value, (int, float)):
        return value
    if isinstance(value, dict):
        return {str(k)[:120]: _sanitize(v) for k, v in list(value.items())[:_MAX_LIST]}
    if isinstance(value, (list, tuple)):
        return [_sanitize(v) for v in list(value)[:_MAX_LIST]]
    return _clean_str(str(value))


def format_audit(audit: Any) -> dict:
    """Serialize the audit to a bounded, sanitized, JSON-safe dict. Never raises."""
    try:
        raw = audit.to_dict() if hasattr(audit, "to_dict") else dict(audit)
        result = _sanitize(raw)
        return result if isinstance(result, dict) else {}
    except Exception:  # noqa: BLE001 — a diagnostics read must never raise
        return {}


__all__ = ["format_audit"]
