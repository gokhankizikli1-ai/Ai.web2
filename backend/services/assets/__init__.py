# coding: utf-8
"""
Phase 8 — Asset System package.

Public API:
    from backend.services.assets import client, AssetRecord, is_enabled

Internals:
    types       AssetRecord, taxonomy, asset_type_from_mime
    errors      AssetError hierarchy
    storage     AssetStorage (interface) + LocalAssetStorage
    validator   MIME + size + executable-blocklist
    store       SQLite adapter (assets.db)
    manager     orchestration
    client      AssetsClient — the flag-gated public surface
"""
from backend.services.assets.client import AssetsClient, client, is_enabled
from backend.services.assets.errors import (
    AssetError, AssetNotFound, AssetAccessDenied,
    AssetValidationError, AssetStorageError, AssetSystemDisabled,
)
from backend.services.assets.types import (
    AssetRecord, ASSET_TYPES,
    ASSET_TYPE_IMAGE, ASSET_TYPE_PDF, ASSET_TYPE_DOCUMENT,
    ASSET_TYPE_VIDEO, ASSET_TYPE_DATA, ASSET_TYPE_UNKNOWN,
    ASSET_STATUSES, STATUS_UPLOADED, STATUS_PROCESSING,
    STATUS_READY, STATUS_FAILED,
    asset_type_from_mime, normalize_status,
)


__all__ = [
    "AssetsClient", "client", "is_enabled",
    "AssetRecord", "ASSET_TYPES",
    "ASSET_TYPE_IMAGE", "ASSET_TYPE_PDF", "ASSET_TYPE_DOCUMENT",
    "ASSET_TYPE_VIDEO", "ASSET_TYPE_DATA", "ASSET_TYPE_UNKNOWN",
    "ASSET_STATUSES", "STATUS_UPLOADED", "STATUS_PROCESSING",
    "STATUS_READY", "STATUS_FAILED",
    "asset_type_from_mime", "normalize_status",
    "AssetError", "AssetNotFound", "AssetAccessDenied",
    "AssetValidationError", "AssetStorageError", "AssetSystemDisabled",
]
