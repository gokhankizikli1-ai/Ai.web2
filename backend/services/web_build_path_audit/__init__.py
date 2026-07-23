# coding: utf-8
"""
Web Build Path Audit — read-only architecture source-of-truth for Web Build.

Answers the one question that matters before further design work: *which intelligence
decisions actually reach the production model that generates the website source files?*
It is a STATIC capability map derived from the call graph (see :mod:`.registry`) — it runs
no analysis, makes no model call, touches no generation path, and returns only references
and short notes (never prompts, source, secrets, or user data).

Feature flag (default OFF → zero runtime work beyond a flag check):

    ENABLE_WEB_BUILD_PATH_AUDIT=false

Public API:
    is_enabled()        — is the audit surface turned on?
    version()           — the stable audit schema version
    build_path_audit()  — the sanitized audit dict, or None when disabled
"""
from __future__ import annotations

import os
from typing import Any, Dict, Optional

from backend.services.web_build_path_audit.formatter import format_audit
from backend.services.web_build_path_audit.registry import VERSION, build_audit


def is_enabled() -> bool:
    """True only when ``ENABLE_WEB_BUILD_PATH_AUDIT`` is explicitly ``"true"``."""
    return (os.getenv("ENABLE_WEB_BUILD_PATH_AUDIT", "false") or "").strip().lower() == "true"


def version() -> str:
    return VERSION


def build_path_audit() -> Optional[Dict[str, Any]]:
    """Return the sanitized static path-audit dict when enabled, else ``None``. Pure and
    total — no I/O, no model calls, never raises."""
    if not is_enabled():
        return None
    try:
        return format_audit(build_audit())
    except Exception:  # noqa: BLE001 — a diagnostics read must never raise
        return None


__all__ = ["is_enabled", "version", "build_path_audit"]
