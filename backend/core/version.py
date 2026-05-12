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
PROCESS_STARTED_AT = _time.time()


def uptime_seconds() -> int:
    """Seconds since this Python process booted."""
    return int(_time.time() - PROCESS_STARTED_AT)


__all__ = ["BACKEND_VERSION", "PROCESS_STARTED_AT", "uptime_seconds"]
