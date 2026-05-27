# coding: utf-8
"""
Phase 8 — Upload validator.

One place to enforce MIME allowlist + size cap + executable blocklist.
Called by the asset manager before any byte hits the storage backend.

Design rules:
  * Allowlist by ASSET_TYPE bucket — the bucket comes from
    `asset_type_from_mime` in types.py, so a new MIME automatically
    inherits the allow-by-bucket policy.
  * Hard blocklist on common executable / script types so an
    accidental drag of a binary doesn't sit on disk.
  * Filename is sanitised by the storage layer; here we just ensure
    it's non-empty.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Iterable, Optional

from backend.services.assets.errors import AssetValidationError
from backend.services.assets.types import (
    asset_type_from_mime,
    ASSET_TYPE_IMAGE, ASSET_TYPE_PDF, ASSET_TYPE_DOCUMENT,
    ASSET_TYPE_VIDEO, ASSET_TYPE_DATA, ASSET_TYPE_UNKNOWN,
)


# ── Policy ──────────────────────────────────────────────────────────────────

# Buckets we accept. UNKNOWN is rejected by default so unidentified
# MIMEs don't sneak past the filter.
_ALLOWED_ASSET_TYPES: frozenset[str] = frozenset({
    ASSET_TYPE_IMAGE, ASSET_TYPE_PDF, ASSET_TYPE_DOCUMENT,
    ASSET_TYPE_VIDEO, ASSET_TYPE_DATA,
})

# MIMEs we hard-block regardless of bucket. Executables, scripts,
# anything that could be misinterpreted as code by downstream systems.
_BLOCKED_MIMES: frozenset[str] = frozenset({
    "application/x-msdownload",                  # .exe
    "application/x-executable",
    "application/x-sh",
    "application/x-shellscript",
    "application/x-bat",
    "application/x-msdos-program",
    "application/javascript",                    # avoid bundled JS that might be embedded
    "application/x-httpd-php",
    "application/x-perl",
    "application/x-python-code",
})

# Extension blocklist as a second-pass defence (some uploads come
# without a useful MIME).
_BLOCKED_EXTENSIONS: frozenset[str] = frozenset({
    ".exe", ".com", ".bat", ".cmd", ".sh", ".bash",
    ".ps1", ".vbs", ".scr", ".msi", ".jar", ".app", ".dmg",
    ".php", ".pl", ".pyc", ".pyd",
})


def _max_bytes() -> int:
    try:
        return int(os.getenv("ASSETS_MAX_BYTES", str(10 * 1024 * 1024)))
    except Exception:
        return 10 * 1024 * 1024


@dataclass
class ValidationOutcome:
    """Successful validation returns the canonical asset_type so the
    caller writes the same bucket the validator approved."""
    asset_type: str
    mime_type:  str


def validate_upload(
    *,
    filename: str,
    mime_type: Optional[str],
    size_bytes: int,
) -> ValidationOutcome:
    """Validate a pending upload. Raises AssetValidationError with
    a stable code on any reject. Returns the canonical asset_type
    bucket on success."""
    if not filename or not filename.strip():
        raise AssetValidationError("filename is required",
                                   code="ASSET_FILENAME_EMPTY")
    fn = filename.strip()
    ext = ("." + fn.rsplit(".", 1)[1].lower()) if "." in fn else ""

    if size_bytes is None or size_bytes <= 0:
        raise AssetValidationError("upload is empty",
                                   code="ASSET_EMPTY",
                                   details={"size_bytes": size_bytes})
    cap = _max_bytes()
    if size_bytes > cap:
        raise AssetValidationError(
            f"upload exceeds {cap} bytes",
            code="ASSET_TOO_LARGE",
            details={"size_bytes": size_bytes, "limit": cap},
        )

    mt = (mime_type or "").lower().strip()
    if mt in _BLOCKED_MIMES:
        raise AssetValidationError(
            f"MIME type {mt!r} is blocked",
            code="ASSET_BLOCKED_MIME",
            details={"mime_type": mt},
        )
    if ext in _BLOCKED_EXTENSIONS:
        raise AssetValidationError(
            f"file extension {ext!r} is blocked",
            code="ASSET_BLOCKED_EXTENSION",
            details={"extension": ext},
        )

    bucket = asset_type_from_mime(mt or _ext_to_mime_guess(ext))
    if bucket == ASSET_TYPE_UNKNOWN and ext not in {".csv", ".json", ".md", ".txt"}:
        raise AssetValidationError(
            "unsupported file type",
            code="ASSET_UNSUPPORTED_TYPE",
            details={"mime_type": mt, "extension": ext},
        )
    if bucket == ASSET_TYPE_UNKNOWN:
        # Extension hint promotes to document.
        bucket = ASSET_TYPE_DOCUMENT

    if bucket not in _ALLOWED_ASSET_TYPES:
        raise AssetValidationError(
            "asset type is not allowed",
            code="ASSET_BUCKET_DISALLOWED",
            details={"asset_type": bucket},
        )

    return ValidationOutcome(asset_type=bucket, mime_type=mt or _ext_to_mime_guess(ext))


def _ext_to_mime_guess(ext: str) -> str:
    """Best-effort MIME from extension when the upload didn't carry
    one. Conservative — only common types we already accept."""
    mapping = {
        ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".webp": "image/webp", ".gif": "image/gif",
        ".pdf": "application/pdf",
        ".txt": "text/plain", ".md": "text/markdown",
        ".json": "application/json",
        ".csv": "text/csv",
        ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
    }
    return mapping.get(ext, "application/octet-stream")


__all__ = ["validate_upload", "ValidationOutcome"]
