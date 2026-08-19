# coding: utf-8
"""
Web Build — DURABLE persistence for a generated image.

A provider returns a session-only ``data:`` URL. That is fine for the manual Preview action
(look at it, discard it), but it is NOT usable for an image the Web Build writes into generated
project source: a base64 blob would be re-serialized into every saved payload, would blow the
browser storage quota, and would not survive save → reopen → revision.

This module makes a generated image durable using the EXISTING asset system — the same storage
authority that already backs the device-upload route. It introduces no second storage, no new
bucket, no new env var and no new delivery route:

    data: URL  →  bytes  →  uploads.validate_image (the EXISTING validator)
               →  assets_client.upload             (the EXISTING storage)
               →  assets_client.public_url         (the EXISTING delivery URL)

Every failure is returned as a structured, non-fatal result: the caller keeps the honest
``dataUrl`` behaviour it always had, and the Web Build routing falls back rather than injecting a
non-durable asset into a build.
"""
from __future__ import annotations

import base64
import binascii
import logging
import re
from dataclasses import dataclass
from typing import Any, Dict, Optional

from backend.services.assets import client as assets_client
from backend.services.assets.errors import AssetError, AssetSystemDisabled
from backend.services.web_build_images import uploads

logger = logging.getLogger(__name__)

# A generated PNG is comfortably under this; anything larger is refused rather than stored.
MAX_GENERATED_BYTES = 20 * 1024 * 1024

_DATA_URL_RE = re.compile(r"^data:(image/[a-z0-9.+-]{1,20});base64,(.+)$", re.IGNORECASE | re.DOTALL)


@dataclass
class PersistedImage:
    asset_id: str
    url: str
    mime: str
    width: int
    height: int
    size_bytes: int


def decode_data_url(data_url: str) -> Optional[tuple]:
    """(mime, bytes) for a base64 image data URL, else None. Never raises."""
    try:
        m = _DATA_URL_RE.match((data_url or "").strip())
        if not m:
            return None
        raw = base64.b64decode(m.group(2), validate=False)
        if not raw or len(raw) > MAX_GENERATED_BYTES:
            return None
        return (m.group(1).lower(), raw)
    except (binascii.Error, ValueError, TypeError):
        return None
    except Exception:  # noqa: BLE001 — persistence must never raise into generation
        return None


def persist_generated_image(
    data_url: str, *, user_id: str, slot_id: str = "", project_id: Optional[str] = None,
    provider: str = "",
) -> Optional[PersistedImage]:
    """Store a generated image through the existing asset system and return its stable delivery
    URL. Returns None when the bytes are unusable, the asset system is disabled, or storage
    failed — the caller then treats the image as NOT durably persistable. Never raises."""
    decoded = decode_data_url(data_url)
    if decoded is None:
        return None
    declared_mime, raw = decoded

    try:
        valid = uploads.validate_image(raw, declared_mime=declared_mime)
    except uploads.ImageUploadError as exc:
        logger.info("[WEB_BUILD_IMG] generated image rejected by validator: %s", exc.code)
        return None
    except Exception:  # noqa: BLE001
        return None

    try:
        rec = assets_client.upload(
            user_id=user_id,
            # A safe, format-derived filename — never anything caller-controlled.
            filename=f"web-build-generated.{valid.ext}",
            mime_type=valid.mime,
            data=raw,
            project_id=(project_id or None),
            metadata={
                "source": "web-build-generated-image",
                "width": valid.width,
                "height": valid.height,
                "slotId": (slot_id or "")[:120],
                "provider": (provider or "")[:40],
                # The honest provenance marker: this asset is AI-generated artwork.
                "generated": True,
            },
        )
    except AssetSystemDisabled:
        logger.info("[WEB_BUILD_IMG] asset system disabled — generated image not persisted")
        return None
    except AssetError as exc:
        logger.warning("[WEB_BUILD_IMG] generated image storage failed: %s", type(exc).__name__)
        return None
    except Exception:  # noqa: BLE001
        logger.warning("[WEB_BUILD_IMG] generated image storage failed")
        return None

    url = assets_client.public_url(getattr(rec, "id", "") or "", user_id=user_id) or ""
    if not url:
        return None
    return PersistedImage(
        asset_id=getattr(rec, "id", "") or "",
        url=url,
        mime=valid.mime,
        width=valid.width,
        height=valid.height,
        size_bytes=valid.size_bytes,
    )


def attach_persistence(
    asset: Dict[str, Any], *, user_id: str, project_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Persist a READY generated asset and return it with `url`/`assetId`/`persisted` attached.
    A non-ready asset, or any storage failure, is returned unchanged (honest, non-durable)."""
    try:
        if str(asset.get("status") or "").lower() != "ready":
            return asset
        data_url = str(asset.get("dataUrl") or "")
        if not data_url:
            # Some providers already return a hosted URL; nothing to store.
            return {**asset, "persisted": bool(asset.get("url"))}
        stored = persist_generated_image(
            data_url, user_id=user_id, slot_id=str(asset.get("slotId") or ""),
            project_id=project_id, provider=str(asset.get("provider") or ""),
        )
        if stored is None:
            return {**asset, "persisted": False}
        out = {**asset, "url": stored.url, "assetId": stored.asset_id, "persisted": True,
               "width": stored.width, "height": stored.height, "bytes": stored.size_bytes}
        # The base64 payload is dropped once a durable URL exists: it must never reach a
        # persisted build payload, and it would only duplicate the stored bytes on the wire.
        out.pop("dataUrl", None)
        return out
    except Exception:  # noqa: BLE001
        return {**asset, "persisted": False}


__all__ = [
    "MAX_GENERATED_BYTES", "PersistedImage", "decode_data_url",
    "persist_generated_image", "attach_persistence",
]
