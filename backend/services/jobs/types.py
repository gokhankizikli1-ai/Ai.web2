# coding: utf-8
"""
Phase 7 — Job Queue typed payloads.

Plain dataclasses. The store/manager/runner/API all speak these
shapes; adding a field is the ONLY place the schema evolves.

Design notes:
  * Status is a closed set — `JOB_STATUSES`. The manager enforces
    legal transitions (queued → running → succeeded/failed/cancelled;
    failed → retrying → running ...). Unknown statuses coerce to
    "failed" for safety so a corrupted row never surfaces as
    "running" forever.
  * `payload_json` / `result_json` / `error_json` are stored as TEXT
    (JSON-encoded). Dataclass fields expose them as `dict | None` for
    typed callsite ergonomics.
  * `idempotency_key` is unique per (user_id, kind) when present. The
    manager uses this to dedupe duplicate submits (refresh-spam,
    retries-from-FE, etc.) without storing extra rows.
  * `progress` is an int 0..100 plus an optional `progress_label`
    string so SSE consumers can show "Step 3 of 5 — extracting".
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field, asdict
from typing import Any, Optional


# ── Status taxonomy ──────────────────────────────────────────────────────────

STATUS_QUEUED    = "queued"
STATUS_RUNNING   = "running"
STATUS_SUCCEEDED = "succeeded"
STATUS_FAILED    = "failed"
STATUS_CANCELLED = "cancelled"
STATUS_RETRYING  = "retrying"

JOB_STATUSES: tuple[str, ...] = (
    STATUS_QUEUED, STATUS_RUNNING, STATUS_SUCCEEDED,
    STATUS_FAILED, STATUS_CANCELLED, STATUS_RETRYING,
)

# Terminal = no further transitions allowed (manager will reject).
TERMINAL_STATUSES: frozenset[str] = frozenset({
    STATUS_SUCCEEDED, STATUS_FAILED, STATUS_CANCELLED,
})


def normalize_status(status: Optional[str]) -> str:
    if not status:
        return STATUS_QUEUED
    s = str(status).lower().strip()
    return s if s in JOB_STATUSES else STATUS_FAILED


# ── Defaults ─────────────────────────────────────────────────────────────────

DEFAULT_MAX_ATTEMPTS = 1                  # 1 attempt = no retries unless caller opts in
DEFAULT_TIMEOUT_S    = 600                # 10 minutes — generous; per-kind handlers can clamp
MAX_PAYLOAD_BYTES    = 256 * 1024         # 256 KB — anything bigger should be an artifact ref


# ── Records ──────────────────────────────────────────────────────────────────

@dataclass
class JobRecord:
    """A single durable job row.

    `id`, `created_at`, `updated_at` are filled by the store on insert.
    """
    kind:            str
    user_id:         str
    project_id:      Optional[str] = None
    agent_id:        Optional[str] = None
    status:          str = STATUS_QUEUED
    payload:         dict = field(default_factory=dict)
    result:          Optional[dict] = None
    error:           Optional[dict] = None
    progress:        int = 0
    progress_label:  Optional[str] = None
    idempotency_key: Optional[str] = None
    attempts:        int = 0
    max_attempts:    int = DEFAULT_MAX_ATTEMPTS
    timeout_s:       Optional[int] = DEFAULT_TIMEOUT_S
    metadata:        dict = field(default_factory=dict)
    # Server-populated
    id:              Optional[str] = None
    created_at:      Optional[str] = None
    queued_at:       Optional[str] = None
    started_at:      Optional[str] = None
    finished_at:     Optional[str] = None
    cancelled_at:    Optional[str] = None
    updated_at:      Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        """API-safe projection."""
        return asdict(self)

    @property
    def is_terminal(self) -> bool:
        return self.status in TERMINAL_STATUSES


@dataclass
class JobEvent:
    """One pub/sub event emitted by the JobEventBus.

    Consumed by the SSE stream route to push live updates to the
    frontend. `kind` is one of: snapshot | status | progress |
    log | done | error.
    """
    job_id:    str
    kind:      str
    payload:   dict = field(default_factory=dict)
    timestamp: str = ""


# ── JSON helpers (store ↔ record) ────────────────────────────────────────────

def encode_json(value: Optional[dict]) -> Optional[str]:
    """Encode a dict for storage. Returns None when value is None;
    returns "{}" for the empty dict so a NOT NULL column stays happy."""
    if value is None:
        return None
    try:
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    except Exception:
        return None


def decode_json(raw: Optional[str]) -> Optional[dict]:
    if not raw:
        return None
    try:
        v = json.loads(raw)
        return v if isinstance(v, dict) else None
    except Exception:
        return None


__all__ = [
    "JOB_STATUSES", "TERMINAL_STATUSES", "normalize_status",
    "STATUS_QUEUED", "STATUS_RUNNING", "STATUS_SUCCEEDED",
    "STATUS_FAILED", "STATUS_CANCELLED", "STATUS_RETRYING",
    "DEFAULT_MAX_ATTEMPTS", "DEFAULT_TIMEOUT_S", "MAX_PAYLOAD_BYTES",
    "JobRecord", "JobEvent",
    "encode_json", "decode_json",
]
