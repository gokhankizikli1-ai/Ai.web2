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

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from backend.core.deps import current_user
from backend.services.auth.identity import User
from backend.services import web_build_images as img

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
    return asset


__all__ = ["router"]
