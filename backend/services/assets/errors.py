# coding: utf-8
"""
Phase 8 — Asset typed errors.

Mirrors the pattern in services/jobs/errors.py: typed exceptions
with stable `code` strings and HTTP status mappings. Routes catch
AssetError subclasses and translate via _translate_asset_error so
the response body always carries a code the FE can branch on.
"""
from __future__ import annotations


class AssetError(Exception):
    code: str = "ASSET_ERROR"
    http_status: int = 500

    def __init__(self, message: str, *, code: str | None = None,
                 http_status: int | None = None, details: dict | None = None) -> None:
        super().__init__(message)
        self.message = message
        if code is not None:
            self.code = code
        if http_status is not None:
            self.http_status = http_status
        self.details = details or {}


class AssetNotFound(AssetError):
    code = "ASSET_NOT_FOUND"
    http_status = 404


class AssetAccessDenied(AssetError):
    """Cross-user access — surfaced as 404 to hide existence."""
    code = "ASSET_ACCESS_DENIED"
    http_status = 404


class AssetValidationError(AssetError):
    """Size cap, MIME blocklist, missing field, etc."""
    code = "ASSET_VALIDATION_ERROR"
    http_status = 400


class AssetStorageError(AssetError):
    """Failure writing to / reading from the storage backend."""
    code = "ASSET_STORAGE_ERROR"
    http_status = 500


class AssetSystemDisabled(AssetError):
    code = "ASSET_SYSTEM_DISABLED"
    http_status = 503


__all__ = [
    "AssetError",
    "AssetNotFound", "AssetAccessDenied",
    "AssetValidationError", "AssetStorageError",
    "AssetSystemDisabled",
]
