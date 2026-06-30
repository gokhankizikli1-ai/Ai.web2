# coding: utf-8
"""
Centralized data-path resolution for KorvixAI.

WHY THIS MODULE EXISTS
----------------------
Every persistent subsystem in this repo writes a SQLite file. Historically
each store resolved its own path independently:

    os.getenv("JOBS_DB_PATH", "jobs.db")          # relative → CWD
    DB_PATH = "memory.db"                          # hardcoded relative (root)

On Railway the container filesystem is EPHEMERAL: anything written under the
working directory is wiped on every redeploy. With relative paths and no
mounted volume, user accounts (auth.db), chat memory (memory.db), jobs,
projects and deliverables silently disappear on each deploy. This was the #1
"Critical" finding of the Phase 0 architecture audit.

This module gives every store ONE place to resolve its file, so a single
env var (KORVIX_DATA_DIR, or Railway's RAILWAY_VOLUME_MOUNT_PATH) can point
ALL databases at a mounted, durable volume without touching application code.

DESIGN CONTRACT (backwards compatibility is mandatory)
------------------------------------------------------
`resolve_db_path(filename, env_var)` resolves in strict precedence:

  1. An explicit per-store env var (e.g. JOBS_DB_PATH) ALWAYS wins, exactly
     as before. This keeps every existing deployment and the test-suite
     (which sets X_DB_PATH per test) byte-for-byte unchanged.
  2. Else, if a data dir is configured (KORVIX_DATA_DIR or, on Railway,
     RAILWAY_VOLUME_MOUNT_PATH), the file lands in that directory.
  3. Else, the bare relative filename — identical to the legacy default.

So: with NO new env vars set, behaviour is unchanged. Set KORVIX_DATA_DIR
(or mount a Railway volume) and every DB moves onto durable storage. No
application code changes, no schema migration — just a path prefix.

This module is pure stdlib and import-safe (no side effects beyond an
opt-in mkdir of the configured data dir).
"""
from __future__ import annotations

import logging
import os

logger = logging.getLogger(__name__)

# Env var an operator sets explicitly to choose the data directory.
_DATA_DIR_ENV = "KORVIX_DATA_DIR"
# Railway injects this automatically for a mounted volume. We honour it as a
# fallback so "mount a volume" is the only step required on Railway.
_RAILWAY_VOLUME_ENV = "RAILWAY_VOLUME_MOUNT_PATH"


def data_dir() -> str:
    """Return the configured durable data directory, or "" when none is set.

    Read dynamically (not cached) so tests and ops can change the
    environment without reimporting the module.
    """
    explicit = (os.getenv(_DATA_DIR_ENV) or "").strip()
    if explicit:
        return explicit
    volume = (os.getenv(_RAILWAY_VOLUME_ENV) or "").strip()
    if volume:
        return volume
    return ""


def persistence_is_durable() -> bool:
    """True when a data directory is configured (DBs survive redeploys).

    False means every default-path SQLite file lives under the ephemeral
    working directory and will be lost on the next Railway redeploy.
    """
    return bool(data_dir())


def _ensure_dir(path: str) -> None:
    """Best-effort mkdir -p. Never raises — a failed mkdir falls back to
    whatever sqlite does with the path (which will surface its own error)."""
    try:
        os.makedirs(path, exist_ok=True)
    except OSError as exc:  # pragma: no cover — platform/permission dependent
        logger.warning("paths: could not create data dir %r: %s", path, exc)


def resolve_db_path(filename: str, env_var: str | None = None) -> str:
    """Resolve the on-disk path for a SQLite file.

    Precedence (see module docstring): explicit env var → data dir → bare
    filename. `filename` should be the legacy default (e.g. "jobs.db").
    """
    # 1. Explicit per-store override — authoritative, preserves legacy +
    #    test behaviour exactly.
    if env_var:
        explicit = (os.getenv(env_var) or "").strip()
        if explicit:
            return explicit

    # 2. Configured durable data directory.
    base = data_dir()
    if base:
        _ensure_dir(base)
        return os.path.join(base, filename)

    # 3. Legacy default — bare relative filename under the CWD.
    return filename


def persistence_summary() -> dict:
    """Compact, secret-free snapshot for startup logging and /health.

    Intentionally does NOT enumerate individual DB files — just the mode and
    the directory — so it is safe to surface on a diagnostics endpoint.
    """
    base = data_dir()
    return {
        "durable": bool(base),
        "data_dir": base or "(cwd — EPHEMERAL on Railway)",
        "source": (
            _DATA_DIR_ENV if (os.getenv(_DATA_DIR_ENV) or "").strip()
            else _RAILWAY_VOLUME_ENV if (os.getenv(_RAILWAY_VOLUME_ENV) or "").strip()
            else "none"
        ),
    }


__all__ = [
    "data_dir",
    "persistence_is_durable",
    "resolve_db_path",
    "persistence_summary",
]
