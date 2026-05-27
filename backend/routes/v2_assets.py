# coding: utf-8
"""/v2/assets — Phase 8 Asset System REST API."""
from __future__ import annotations

import logging
import os
import re
from typing import Any, Dict, List, Optional

from fastapi import (
    APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, Path,
)
from fastapi.responses import Response
from pydantic import BaseModel, Field

from backend.core.deps import current_user
from backend.core.responses import ok as envelope_ok
from backend.services.assets import client as assets_client
from backend.services.assets.errors import (
    AssetError, AssetSystemDisabled, AssetValidationError,
)
from backend.services.assets.types import ASSET_TYPES
from backend.services.auth.identity import User


logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v2/assets", tags=["assets-v2"])


def _is_enabled() -> bool:
    return os.getenv("ENABLE_ASSET_SYSTEM", "false").strip().lower() == "true"


def _ensure_enabled() -> None:
    if not _is_enabled():
        raise HTTPException(
            status_code=503,
            detail={
                "code":     "ASSET_SYSTEM_DISABLED",
                "message":  "Asset system is disabled. Set ENABLE_ASSET_SYSTEM=true.",
                "rollback": "Unset ENABLE_ASSET_SYSTEM (or set false) to disable.",
            },
        )


def _not_found(asset_id: str) -> HTTPException:
    return HTTPException(
        status_code=404,
        detail={"code": "ASSET_NOT_FOUND",
                "message": f"asset {asset_id!r} not found"},
    )


def _translate(e: AssetError) -> HTTPException:
    return HTTPException(
        status_code=e.http_status,
        detail={"code": e.code, "message": e.message, **(e.details or {})},
    )


# ── Routes ───────────────────────────────────────────────────────────────────

@router.post("/upload")
async def upload_asset(
    file:        UploadFile = File(...),
    project_id:  Optional[str] = Form(None),
    chat_id:     Optional[str] = Form(None),
    message_id:  Optional[str] = Form(None),
    user: User = Depends(current_user),
) -> Dict[str, Any]:
    """Multipart upload. The file is streamed in-memory (bounded by
    ASSETS_MAX_BYTES via the validator), persisted via the storage
    backend, then a metadata row is written."""
    _ensure_enabled()
    try:
        data = await file.read()
    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail={"code": "ASSET_READ_FAILED",
                    "message": f"could not read upload: {e}"},
        )
    try:
        rec = assets_client.upload(
            user_id=    user.id,
            filename=   file.filename or "asset",
            mime_type=  file.content_type,
            data=       data,
            project_id= project_id,
            chat_id=    chat_id,
            message_id= message_id,
        )
    except AssetError as e:
        raise _translate(e)
    except ValueError as e:
        raise HTTPException(
            status_code=400,
            detail={"code": "ASSET_INVALID", "message": str(e)},
        )
    url = assets_client.public_url(rec.id or "", user_id=user.id)
    return envelope_ok(
        data={"asset": {**rec.to_dict(), "public_url": url}},
        endpoint="/v2/assets/upload",
        user_id=user.id,
    )


@router.get("")
def list_assets(
    limit:      int = Query(50, ge=1, le=200),
    offset:     int = Query(0, ge=0),
    project_id: Optional[str] = Query(None, max_length=64),
    chat_id:    Optional[str] = Query(None, max_length=64),
    asset_type: Optional[str] = Query(None, max_length=32),
    user: User = Depends(current_user),
) -> Dict[str, Any]:
    """List the caller's assets, newest first."""
    _ensure_enabled()
    items = assets_client.list_user(
        user.id,
        project_id=project_id, chat_id=chat_id,
        asset_type=asset_type, limit=limit, offset=offset,
    )
    payload = []
    for a in items:
        d = a.to_dict()
        d["public_url"] = assets_client.public_url(a.id or "", user_id=user.id)
        payload.append(d)
    return envelope_ok(
        data={"assets": payload},
        endpoint="/v2/assets", user_id=user.id,
        count=len(items), limit=limit, offset=offset,
    )


@router.get("/project/{project_id}")
def list_project_assets(
    project_id: str = Path(..., max_length=64),
    limit:      int = Query(50, ge=1, le=200),
    offset:     int = Query(0, ge=0),
    user: User = Depends(current_user),
) -> Dict[str, Any]:
    """Assets scoped to one project. Project ownership inferred via the
    asset's user_id — if no rows match, the response is empty rather
    than 404 (an empty project legitimately has zero assets)."""
    _ensure_enabled()
    items = assets_client.list_user(
        user.id, project_id=project_id, limit=limit, offset=offset,
    )
    payload = [{**a.to_dict(),
                "public_url": assets_client.public_url(a.id or "", user_id=user.id)}
               for a in items]
    return envelope_ok(
        data={"assets": payload},
        endpoint=f"/v2/assets/project/{project_id}",
        user_id=user.id, count=len(items), limit=limit, offset=offset,
    )


@router.get("/{asset_id}")
def get_asset(
    asset_id: str = Path(..., max_length=128),
    user: User = Depends(current_user),
) -> Dict[str, Any]:
    _ensure_enabled()
    rec = assets_client.get(asset_id, user_id=user.id)
    if rec is None:
        raise _not_found(asset_id)
    d = rec.to_dict()
    d["public_url"] = assets_client.public_url(asset_id, user_id=user.id)
    return envelope_ok(data={"asset": d},
                       endpoint=f"/v2/assets/{asset_id}",
                       user_id=user.id)


@router.delete("/{asset_id}")
def delete_asset(
    asset_id: str = Path(..., max_length=128),
    user: User = Depends(current_user),
) -> Dict[str, Any]:
    """Soft-delete (the row is hidden from reads). Cross-user → 404."""
    _ensure_enabled()
    try:
        ok = assets_client.delete(asset_id, user_id=user.id)
    except AssetError as e:
        raise _translate(e)
    if not ok:
        raise _not_found(asset_id)
    return envelope_ok(data={"deleted_id": asset_id},
                       endpoint=f"/v2/assets/{asset_id}",
                       user_id=user.id)


class AttachBody(BaseModel):
    message_id: str = Field(..., min_length=1, max_length=128)


@router.post("/{asset_id}/attach-to-message")
def attach_to_message(
    asset_id: str = Path(..., max_length=128),
    body: AttachBody = ...,
    user: User = Depends(current_user),
) -> Dict[str, Any]:
    _ensure_enabled()
    try:
        rec = assets_client.attach_to_message(
            asset_id, user_id=user.id, message_id=body.message_id,
        )
    except AssetError as e:
        raise _translate(e)
    if rec is None:
        raise _not_found(asset_id)
    return envelope_ok(data={"asset": rec.to_dict()},
                       endpoint=f"/v2/assets/{asset_id}/attach-to-message",
                       user_id=user.id)


# ── Blob serving (local storage backend) ─────────────────────────────────────

_SAFE_KEY_RE = re.compile(r"^[A-Za-z0-9_\-./]+$")


@router.get("/blob/{key:path}")
def serve_blob(
    key: str = Path(..., min_length=1, max_length=512),
) -> Response:
    """Serve the raw bytes for an asset key.

    The local storage backend's `public_url` points here. We do NOT
    require auth on this route — the storage key is effectively
    opaque (sha256 prefix + sanitised filename) and including a path
    that doesn't decode to a known row 404s. Sensitive deployments
    should switch to a signed-URL backend (R2/S3) for true access
    control.
    """
    _ensure_enabled()
    if not _SAFE_KEY_RE.match(key):
        raise HTTPException(status_code=400,
                            detail={"code": "ASSET_BAD_KEY",
                                    "message": "invalid blob key"})
    # Resolve the key to bytes via the storage backend (we don't have
    # the asset_id; this path is keyed by storage_path).
    from backend.services.assets.manager import manager as _mgr
    from backend.services.assets.errors import AssetStorageError
    try:
        data = _mgr._get_storage().read(key)
    except AssetStorageError:
        raise HTTPException(status_code=404,
                            detail={"code": "ASSET_BLOB_NOT_FOUND",
                                    "message": "blob not found"})
    # Best-effort content-type — fall back to octet-stream so the
    # browser handles the download safely.
    import mimetypes
    ct, _ = mimetypes.guess_type(key)
    return Response(content=data, media_type=ct or "application/octet-stream")


# ── Diagnostic ───────────────────────────────────────────────────────────────

@router.get("/health/diagnostic", include_in_schema=False)
def diagnostic() -> Dict[str, Any]:
    return envelope_ok(data=assets_client.stats(),
                       endpoint="/v2/assets/health/diagnostic")


__all__ = ["router"]
