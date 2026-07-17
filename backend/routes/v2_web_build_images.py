# coding: utf-8
"""
Web Build — Real Image Generation V1 (Phase 10D) HTTP surface.

Thin, guarded wrapper over backend.services.web_build_images. Turns a single
Image Pipeline slot into a REAL generated illustrative image, server-side only.

  • API keys never leave the server. The frontend only ever sees a data: URL
    (or a provider-hosted URL) plus honest status/labels.
  • Video is out of scope. Proof-heavy slots are refused (manual upload).
  • Fails OPEN: disabled / unconfigured / owner-gated / provider error all
    return HTTP 200 with a structured `disabled`/`failed` asset so the Preview
    never breaks and never shows a fake success.

Gated by ENABLE_WEB_BUILD_IMAGE_GEN (read per-request). Optionally owner-only
via IMAGE_GENERATION_OWNER_ONLY (default true) so paid generation can't be
triggered by anonymous visitors.

Endpoints:
  GET  /v2/web-build/images/health    — flag + provider + configured (no keys)
  POST /v2/web-build/images/generate  — generate one slot
"""
from __future__ import annotations

import logging
import os
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field

from backend.core.deps import current_user
from backend.services.auth.identity import User
from backend.services import web_build_images as img
from backend.services.web_build_images import stock, sourcing, uploads
from backend.services.assets import client as assets_client
from backend.services.assets.errors import AssetError, AssetSystemDisabled

router = APIRouter(prefix="/v2/web-build/images", tags=["web-build-images"])
logger = logging.getLogger(__name__)


def _owner_only() -> bool:
    return os.getenv("IMAGE_GENERATION_OWNER_ONLY", "true").strip().lower() == "true"


def _is_owner(request: Request, user: User) -> bool:
    try:
        from backend.services.admin.owner import is_owner_request
        tok = request.headers.get("x-korvix-owner-token") or None
        return bool(is_owner_request(user, owner_token=tok))
    except Exception:
        return False


class ImagePromptBody(BaseModel):
    positive: str = Field(default="", max_length=2000)
    negative: str = Field(default="", max_length=2000)
    style: str = Field(default="", max_length=600)
    aspectRatio: str = Field(default="16:9", max_length=12)
    safetyNotes: List[str] = Field(default_factory=list, max_length=12)


class GenerateBody(BaseModel):
    slotId: str = Field(..., max_length=120)
    target: str = Field(default="", max_length=120)
    kind: str = Field(default="", max_length=60)
    source: str = Field(default="", max_length=40)
    manualUploadRecommended: bool = Field(default=False)
    honestyLabel: str = Field(default="AI-generated illustrative image", max_length=200)
    prompt: ImagePromptBody = Field(default_factory=ImagePromptBody)
    provider: Optional[str] = Field(default=None, max_length=20)
    # Phase 14M — optional Web Build correlation id so a generated image's
    # cost rolls up under the same build as its planning/code-gen calls. This
    # is an ASSOCIATION key only; the cost itself is priced server-side from
    # the centralized image table — never from any client-sent value (task #8).
    buildId: Optional[str] = Field(default=None, max_length=120)
    quality: Optional[str] = Field(default=None, max_length=20)


@router.get("/health")
def image_gen_health() -> Dict[str, Any]:
    """Always callable. Lets the frontend show provider state honestly BEFORE
    a user clicks Generate — no key material is ever returned."""
    provider = img.active_provider()
    return {
        "enabled": img.is_enabled(),
        "provider": provider,
        "configured": img.provider_configured(provider),
        "ownerOnly": _owner_only(),
        "missingReason": img.missing_reason(),
        "video": False,  # explicit: video is never supported here
    }


@router.post("/generate")
def image_gen_generate(
    body: GenerateBody,
    request: Request,
    user: User = Depends(current_user),
) -> Dict[str, Any]:
    """Generate one image slot. Never raises to the client — every failure
    mode returns a 200 with a structured disabled/failed asset."""
    honesty = body.honestyLabel or "AI-generated illustrative image"

    # ── Founder-Beta AI protection (Phase 14L.1) ──────────────────────────
    # AI image GENERATION is a protected operation, DISABLED by default in the
    # Limited Founder Beta. The global kill switch + the image_generation policy
    # gate are checked here BEFORE any provider call. Stock search and device
    # upload live on OTHER routes and are unaffected. Returns the existing
    # graceful 200 disabled asset (Preview never breaks) plus a stable code the
    # frontend localizes. Fail-open on an integration error (the existing
    # ENABLE_WEB_BUILD_IMAGE_GEN + owner gates below still apply).
    try:
        from backend.services.ai_guard import service as _ai_guard, policy as _ai_policy
        _pf = _ai_guard.preflight(
            user_id=str(getattr(user, "id", "anon")),
            operation_type=_ai_policy.OP_IMAGE_GENERATION,
            message=body.slotId or "",
            idempotency_key=(request.headers.get("x-korvix-operation-id") or "").strip()[:80] or None,
        )
        if not _pf.allowed:
            return {
                "slotId": body.slotId, "status": "disabled", "provider": img.active_provider(),
                "honestyLabel": honesty, "promptSummary": "",
                "reason": "AI image generation is unavailable in the Limited Founder Beta",
                "code": _pf.code,
            }
    except Exception:
        pass

    if not img.is_enabled():
        return {
            "slotId": body.slotId, "status": "disabled", "provider": img.active_provider(),
            "honestyLabel": honesty, "promptSummary": "",
            "reason": "image generation is disabled on this deployment",
        }

    # Owner gating — return a graceful disabled asset (not a hard 403) so the
    # Preview stays intact for non-owner viewers.
    if _owner_only() and not _is_owner(request, user):
        return {
            "slotId": body.slotId, "status": "disabled", "provider": img.active_provider(),
            "honestyLabel": honesty, "promptSummary": "",
            "reason": "image generation is owner-only on this deployment",
        }

    req: Dict[str, Any] = {
        "slotId": body.slotId,
        "target": body.target,
        "kind": body.kind,
        "source": body.source,
        "manualUploadRecommended": body.manualUploadRecommended,
        "honestyLabel": honesty,
        "prompt": {
            "positive": body.prompt.positive,
            "negative": body.prompt.negative,
            "style": body.prompt.style,
            "aspectRatio": body.prompt.aspectRatio,
            "safetyNotes": body.prompt.safetyNotes,
        },
    }
    asset = img.generate_image(req)
    logger.info(
        "[WEB_BUILD_IMG] slot=%s kind=%s status=%s provider=%s uid=%s",
        body.slotId, body.kind, asset.get("status"), asset.get("provider"), getattr(user, "id", "?"),
    )

    # ── Cost tracking (Phase 14M) — bill one generated image as a non-token
    # tool cost against its build (task #4). Only when a real image was
    # produced; priced from the centralized image table by provider+quality.
    try:
        if str(asset.get("status") or "").lower() in ("ok", "generated", "success", "completed"):
            from backend.services.cost_tracking import tracker as _ct
            from backend.services.cost_tracking.types import OP_IMAGE_GEN
            _prov = str(asset.get("provider") or img.active_provider() or "").lower()
            _q = (body.quality or "").strip().lower()
            _tool_key = f"image.{_prov}" + (f".{_q}" if _q else "")
            _bid = (body.buildId or "").strip() or ("imggen_" + str(getattr(user, "id", "anon")))
            _ct.record_tool_cost(
                build_id=_bid, user_id=str(getattr(user, "id", "anon")),
                tool_key=_tool_key, units=1, provider=_prov,
                operation_type=OP_IMAGE_GEN,
            )
    except Exception as _cterr:
        logger.debug("[WEB_BUILD_IMG] cost_tracking skipped: %s", _cterr)

    return asset


# ── Stock photo search (Phase 14K.2) ────────────────────────────────────────
# Server-side Pexels/Unsplash search. Authenticated (same current_user pattern
# as /generate). Keys stay server-side; only normalized results are returned.
# Validation caps query/page/per_page and enforces a strict provider enum so the
# endpoint can never become an unbounded public relay.
_STOCK_PROVIDERS = {"all", "pexels", "unsplash"}


@router.get("/stock/health")
def stock_health() -> Dict[str, Any]:
    """Which stock providers are configured (booleans only — no key material)."""
    return {"providers": stock.availability()}


@router.get("/stock/search")
async def stock_search(
    request: Request,
    user: User = Depends(current_user),
    q: str = "",
    provider: str = "all",
    page: int = 1,
    per_page: int = 24,
    orientation: str = "",
) -> Dict[str, Any]:
    """Search real stock photos. Never raises to the client — validation errors
    and provider failures return a structured, honest payload."""
    query = (q or "").strip()[: stock.MAX_QUERY]
    prov = provider if provider in _STOCK_PROVIDERS else "all"
    page = max(1, min(int(page or 1), 200))
    per_page = max(1, min(int(per_page or 24), stock.MAX_PER_PAGE))
    orient = orientation if orientation in {"landscape", "portrait", "square"} else None

    if not query:
        avail0 = stock.availability()
        return {
            "query": "", "page": page, "perPage": per_page,
            "providers": {k: ("ok" if v else "unavailable") for k, v in avail0.items()},
            "results": [], "hasMore": False, "error": "empty_query",
        }

    avail = stock.availability()
    if not avail["pexels"] and not avail["unsplash"]:
        return {
            "query": query, "page": page, "perPage": per_page,
            "providers": {"pexels": "unavailable", "unsplash": "unavailable"},
            "results": [], "hasMore": False, "error": "no_providers_configured",
        }

    try:
        payload = await stock.search(query, prov, page, per_page, orient)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[STOCK] search failed: %s", type(exc).__name__)
        return {
            "query": query, "page": page, "perPage": per_page,
            "providers": {"pexels": "error", "unsplash": "error"},
            "results": [], "hasMore": False, "error": "search_failed",
        }
    logger.info("[STOCK] q_len=%d provider=%s page=%d results=%d uid=%s",
                len(query), prov, page, len(payload.get("results") or []), getattr(user, "id", "?"))
    return payload


class StockTrackBody(BaseModel):
    provider: str = Field(default="", max_length=20)
    downloadLocation: str = Field(default="", max_length=2048)


@router.post("/stock/track")
def stock_track(
    body: StockTrackBody,
    user: User = Depends(current_user),
) -> Dict[str, Any]:
    """Fire Unsplash's required download event when a photo is applied. Strictly
    host-limited to api.unsplash.com server-side. No-op for Pexels."""
    tracked = stock.track_download(body.provider, body.downloadLocation)
    return {"tracked": bool(tracked)}


# ── Generation-time stock image sourcing (Phase 14K.4) ──────────────────────
# Turns a small, pre-planned list of image needs into a manifest of real stock
# photographs used to make a NEW Web Build generation visually complete. Same
# authenticated pattern; keys stay server-side; Unsplash usage is tracked here.
class StockNeedItem(BaseModel):
    slotId: str = Field(default="", max_length=120)
    query: str = Field(default="", max_length=200)
    orientation: str = Field(default="", max_length=16)
    purpose: str = Field(default="", max_length=40)
    required: bool = Field(default=False)
    altText: str = Field(default="", max_length=200)


class StockSourceBody(BaseModel):
    needs: List[StockNeedItem] = Field(default_factory=list, max_length=32)
    maxImages: int = Field(default=8, ge=0, le=16)


@router.post("/stock/source")
async def stock_source(
    body: StockSourceBody,
    request: Request,
    user: User = Depends(current_user),
) -> Dict[str, Any]:
    """Source one unique stock photo per image need for a NEW generation. Never
    raises to the client — provider/validation failures return a structured,
    honest manifest so website generation can always proceed."""
    cap = min(int(body.maxImages or 0) or sourcing.MAX_IMAGES, sourcing.MAX_IMAGES)
    needs = [
        {
            "slotId": n.slotId,
            "query": n.query,
            "orientation": n.orientation,
            "altText": n.altText,
        }
        for n in (body.needs or [])
    ][:cap]
    try:
        result = await sourcing.source_images(needs)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[STOCK_SRC] sourcing failed: %s", type(exc).__name__)
        return {
            "status": "error", "assets": [],
            "providers": {"pexels": "error", "unsplash": "error"},
            "warnings": ["sourcing_failed"], "requested": len(needs), "sourced": 0, "elapsedMs": 0,
        }
    logger.info("[STOCK_SRC] uid=%s requested=%d sourced=%d status=%s",
                getattr(user, "id", "?"), result.get("requested", 0), result.get("sourced", 0), result.get("status"))
    return result


# ── Device image upload (Phase 14K.6) ───────────────────────────────────────
# Authenticated multipart upload of a user's own image to REPLACE an auto-sourced
# example image. Reuses the existing asset system for storage + stable delivery;
# strict signature/dimension validation runs BEFORE any byte is stored. The image
# is never sent to a provider/AI; only the caller's own account can upload here.
_MAX_UPLOAD_BYTES = uploads.MAX_BYTES


@router.post("/upload")
async def upload_web_build_image(
    file: UploadFile = File(...),
    project_id: Optional[str] = Form(None),
    slot_id: Optional[str] = Form(None),
    node_id: Optional[str] = Form(None),
    user: User = Depends(current_user),
) -> Dict[str, Any]:
    """Validate + store a user image; return a stable delivery URL + dimensions.
    Never raises a raw exception to the client — validation and storage failures
    map to structured, localizable error codes."""
    try:
        data = await file.read()
    except Exception:  # noqa: BLE001
        raise HTTPException(status_code=400, detail={"code": "read_failed", "message": "Could not read the uploaded file."})
    if len(data or b"") > _MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail={"code": "too_large", "message": "The image is too large."})

    try:
        valid = uploads.validate_image(data, declared_mime=file.content_type)
    except uploads.ImageUploadError as exc:
        raise HTTPException(status_code=400, detail={"code": exc.code, "message": exc.message})

    # Store via the asset system. A safe, format-derived filename is used (never the
    # user's original filename), so no local device path/name is ever persisted or
    # returned. Width/height ride in metadata (AssetRecord has no such columns).
    safe_name = f"web-build-image.{valid.ext}"
    try:
        rec = assets_client.upload(
            user_id=user.id,
            filename=safe_name,
            mime_type=valid.mime,
            data=data,
            project_id=(project_id or None),
            metadata={
                "source": "web-build-image",
                "width": valid.width,
                "height": valid.height,
                "slotId": (slot_id or "")[:120],
            },
        )
    except AssetSystemDisabled:
        raise HTTPException(status_code=503, detail={"code": "storage_unavailable", "message": "Image uploads are not available on this deployment."})
    except AssetError as exc:
        raise HTTPException(status_code=400, detail={"code": "storage_failed", "message": "The image could not be saved."})
    except Exception:  # noqa: BLE001
        raise HTTPException(status_code=500, detail={"code": "storage_failed", "message": "The image could not be saved."})

    url = assets_client.public_url(rec.id or "", user_id=user.id) or ""
    if not url:
        raise HTTPException(status_code=500, detail={"code": "storage_failed", "message": "The image could not be saved."})

    logger.info("[WB_IMG_UPLOAD] uid=%s asset=%s fmt=%s %dx%d bytes=%d slot=%s",
                getattr(user, "id", "?"), rec.id, valid.fmt, valid.width, valid.height, valid.size_bytes,
                (slot_id or "")[:60])
    # `url` is the local blob route (relative) or a cloud CDN URL (absolute); the
    # frontend resolves relative URLs against the API base. `node_id` is echoed for
    # the caller's own targeting (never used to build a storage path here).
    return {
        "assetId": rec.id,
        "url": url,
        "mimeType": valid.mime,
        "width": valid.width,
        "height": valid.height,
        "source": "user-upload",
        "nodeId": (node_id or "")[:256],
    }


__all__ = ["router"]
