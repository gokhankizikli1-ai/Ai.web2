# coding: utf-8
"""
Phase 8 — Asset typed payloads.

Plain dataclasses; one source of truth for the asset row shape that
flows from upload → store → routes → analysis → chat-context
injection. New fields land here only; the store + serializers derive
their shapes from this module.
"""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Any, Optional


# ── Asset type taxonomy ──────────────────────────────────────────────────────
#
# Decoupled from MIME — the asset_type bucket is what the UI + chat
# context-builder branch on. New MIMEs fall into "unknown" rather
# than crashing.

ASSET_TYPE_IMAGE    = "image"
ASSET_TYPE_PDF      = "pdf"
ASSET_TYPE_DOCUMENT = "document"  # text/md/json/csv/etc.
ASSET_TYPE_VIDEO    = "video"
ASSET_TYPE_DATA     = "data"      # generic binary data (csv/json beyond doc cap)
ASSET_TYPE_UNKNOWN  = "unknown"

ASSET_TYPES: tuple[str, ...] = (
    ASSET_TYPE_IMAGE, ASSET_TYPE_PDF, ASSET_TYPE_DOCUMENT,
    ASSET_TYPE_VIDEO, ASSET_TYPE_DATA, ASSET_TYPE_UNKNOWN,
)


def asset_type_from_mime(mime: Optional[str]) -> str:
    """Classify a MIME type into the coarse asset_type bucket."""
    if not mime:
        return ASSET_TYPE_UNKNOWN
    m = mime.lower().split(";", 1)[0].strip()
    if m.startswith("image/"):
        return ASSET_TYPE_IMAGE
    if m == "application/pdf":
        return ASSET_TYPE_PDF
    if m.startswith("video/"):
        return ASSET_TYPE_VIDEO
    if m.startswith("text/") or m in {
        "application/json", "application/xml",
        "application/yaml", "application/x-yaml",
        "application/markdown",
    }:
        return ASSET_TYPE_DOCUMENT
    if m in {"application/csv", "text/csv"}:
        return ASSET_TYPE_DOCUMENT
    return ASSET_TYPE_UNKNOWN


# ── Asset status taxonomy ────────────────────────────────────────────────────

STATUS_UPLOADED   = "uploaded"     # bytes received, not yet processed
STATUS_PROCESSING = "processing"   # analysis job running
STATUS_READY      = "ready"        # analysis complete (or basic-metadata-only for video)
STATUS_FAILED     = "failed"       # validation or analysis error

ASSET_STATUSES: tuple[str, ...] = (
    STATUS_UPLOADED, STATUS_PROCESSING, STATUS_READY, STATUS_FAILED,
)


def normalize_status(status: Optional[str]) -> str:
    if not status:
        return STATUS_UPLOADED
    s = str(status).lower().strip()
    return s if s in ASSET_STATUSES else STATUS_UPLOADED


# ── Asset record ─────────────────────────────────────────────────────────────

@dataclass
class AssetRecord:
    """One uploaded asset row.

    `storage_path` is the abstract storage key — for the local
    backend, this is the path under ASSETS_STORAGE_LOCAL_ROOT; for
    a future R2/S3 backend it's the object key. Never a fully-qualified
    URL — URL composition lives in the storage adapter.

    `chat_id` / `message_id` are optional weak links — attaching an
    asset to a message is a separate concern from owning it.
    """
    user_id:      str
    filename:     str
    mime_type:    str
    size_bytes:   int
    storage_path: str
    asset_type:   str = ASSET_TYPE_UNKNOWN
    status:       str = STATUS_UPLOADED
    project_id:   Optional[str] = None
    chat_id:      Optional[str] = None
    message_id:   Optional[str] = None
    metadata:     dict = field(default_factory=dict)
    # Server-populated:
    id:           Optional[str] = None
    created_at:   Optional[str] = None
    updated_at:   Optional[str] = None
    deleted_at:   Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        """API-safe projection. `storage_path` is INCLUDED — it's an
        opaque ID, not a credential. URLs are composed by the storage
        adapter on demand (see AssetStorage.public_url)."""
        d = asdict(self)
        # `deleted_at` is internal-only — soft-deleted rows aren't
        # returned by the API at all, so dropping the key keeps
        # responses tight.
        d.pop("deleted_at", None)
        return d


__all__ = [
    "AssetRecord",
    "ASSET_TYPES", "ASSET_TYPE_IMAGE", "ASSET_TYPE_PDF",
    "ASSET_TYPE_DOCUMENT", "ASSET_TYPE_VIDEO", "ASSET_TYPE_DATA",
    "ASSET_TYPE_UNKNOWN",
    "ASSET_STATUSES", "STATUS_UPLOADED", "STATUS_PROCESSING",
    "STATUS_READY", "STATUS_FAILED",
    "asset_type_from_mime", "normalize_status",
]
