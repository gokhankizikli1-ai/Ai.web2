# coding: utf-8
"""
Single source of truth for the backend version string.

Surfaced via /v2/health.data.version and /v2/health.metadata.build_phase
so the frontend (and operators) can confirm which deploy is serving
traffic without digging through Railway logs. Bump the string when you
ship a phase that changes the public contract; leave it alone for
internal-only changes.
"""

# Bumped per phase. Format: "<phase>-<descriptor>".
BACKEND_VERSION = "phase-b-foundation"

# Frozen at first import — used to compute uptime in /v2/health.
import time as _time
from datetime import datetime as _dt, timezone as _tz
PROCESS_STARTED_AT = _time.time()
_PROCESS_STARTED_AT_ISO = _dt.now(_tz.utc).isoformat()


def uptime_seconds() -> int:
    """Seconds since this Python process booted."""
    return int(_time.time() - PROCESS_STARTED_AT)


def started_at_iso() -> str:
    """ISO-8601 UTC timestamp of process start. Surfaced by the
    /v2/admin/build-info endpoint so the FE BuildInfoOverlay can show
    'this Railway process booted at X' alongside the commit SHA."""
    return _PROCESS_STARTED_AT_ISO


__all__ = [
    "BACKEND_VERSION", "PROCESS_STARTED_AT", "uptime_seconds", "started_at_iso",
]
