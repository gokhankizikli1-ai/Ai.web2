# coding: utf-8
"""
/v2/web-build/vision-review — PR #521.

ONE authenticated route that runs the CONDITIONAL rendered vision review for a freshly generated
Web Build. It reuses the EXISTING OpenAI provider (never a second client), the EXISTING multimodal
ProviderRequest/ProviderMessage contract, and one configured vision-capable model. It:

  • requires an authenticated user (rejects guests),
  • is gated by ENABLE_RENDERED_VISION_REVIEW (default false → 503),
  • validates runId + image MIME + encoded byte size + bounded context text,
  • rate-limits per user (in-process fixed window; no billing coupling),
  • sends ONE bounded strict-QA prompt + the single screenshot to the vision model,
  • returns typed bounded JSON for the frontend sanitizer,
  • NEVER logs the screenshot / data URL, NEVER persists the image or the raw provider response,
  • FAILS OPEN: any provider failure returns `review: null` (200) so the build is never blocked.

It does NOT touch billing / auth contracts / database schemas / entitlements.
"""
from __future__ import annotations

import base64
import binascii
import json
import logging
import os
import re
import time
from collections import deque
from threading import Lock
from typing import Any, Deque, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from backend.core.config import settings
from backend.core.deps import require_auth
from backend.core.responses import ok as envelope_ok
from backend.services.auth.identity import User
from backend.services.providers import get_provider
from backend.services.providers.errors import ProviderError
from backend.services.providers.types import ProviderMessage, ProviderRequest

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v2/web-build", tags=["web-build-vision-review"])

# ── Bounds (safe code defaults — no extra env vars) ──────────────────────────
_ALLOWED_MIME = {"image/webp", "image/jpeg", "image/png"}
_MAX_IMAGE_BYTES = 1_600_000          # matches the frontend capture ceiling
_MAX_SUMMARY_CHARS = 4000
_MAX_FINDINGS = 12
_MAX_FINDING_CHARS = 300
_MAX_RUN_ID = 128
_VISION_TIMEOUT_S = 30.0
_DATA_URL_RE = re.compile(r"^data:(image/(?:webp|jpeg|jpg|png));base64,([A-Za-z0-9+/=]+)$")

# ── In-process per-user rate limit (fixed window). Deliberately NOT the billing
#    quota system — this route must not couple to billing/entitlements. ────────
_RATE_MAX = 12
_RATE_WINDOW_S = 60.0
_RATE_MAX_KEYS = 4096
_rate_lock = Lock()
_rate_hits: Dict[str, Deque[float]] = {}


def _is_enabled() -> bool:
    return os.getenv("ENABLE_RENDERED_VISION_REVIEW", "false").strip().lower() == "true"


def _disabled_503() -> HTTPException:
    return HTTPException(
        status_code=503,
        detail={"code": "VISION_REVIEW_DISABLED",
                "message": "Rendered vision review is disabled. Set ENABLE_RENDERED_VISION_REVIEW=true."},
    )


def _bad_request(code: str, message: str) -> HTTPException:
    return HTTPException(status_code=400, detail={"code": code, "message": message})


def _rate_limited(user_id: str, now: float) -> bool:
    """Fixed-window per-user limiter. Fail-open on any internal error (never block a build)."""
    try:
        with _rate_lock:
            if len(_rate_hits) > _RATE_MAX_KEYS:
                _rate_hits.clear()               # crude bound; correctness over precision
            hits = _rate_hits.setdefault(user_id, deque())
            while hits and now - hits[0] > _RATE_WINDOW_S:
                hits.popleft()
            if len(hits) >= _RATE_MAX:
                return True
            hits.append(now)
            return False
    except Exception:  # pragma: no cover - defensive
        return False


class VisionReviewRequest(BaseModel):
    runId: str = Field(..., max_length=_MAX_RUN_ID)
    # data:image/<webp|jpeg|png>;base64,<...> — the single desktop screenshot. Never logged/stored.
    imageDataUrl: str = Field(..., max_length=_MAX_IMAGE_BYTES * 2)
    contractSummary: str = Field(default="", max_length=_MAX_SUMMARY_CHARS)
    planSummary: str = Field(default="", max_length=_MAX_SUMMARY_CHARS)
    runtimeFindings: List[str] = Field(default_factory=list)


def _validate_image(data_url: str) -> Dict[str, Any]:
    """Validate + decode the screenshot data URL. Raises HTTPException(400) on any problem.
    Returns {mime, byte_length}. Never returns / logs the raw bytes."""
    m = _DATA_URL_RE.match(data_url or "")
    if not m:
        raise _bad_request("INVALID_IMAGE", "imageDataUrl must be a base64 image data URL.")
    mime = m.group(1).replace("image/jpg", "image/jpeg")
    if mime not in _ALLOWED_MIME:
        raise _bad_request("UNSUPPORTED_MIME", "Only webp / jpeg / png screenshots are accepted.")
    b64 = m.group(2)
    try:
        raw = base64.b64decode(b64, validate=True)
    except (binascii.Error, ValueError):
        raise _bad_request("MALFORMED_IMAGE", "imageDataUrl base64 payload is malformed.")
    n = len(raw)
    if n <= 0:
        raise _bad_request("BLANK_IMAGE", "The screenshot decoded to zero bytes.")
    if n > _MAX_IMAGE_BYTES:
        raise _bad_request("IMAGE_TOO_LARGE", "The screenshot exceeds the size limit.")
    return {"mime": mime, "byte_length": n}


# ── Strict visual-QA prompt (no chain-of-thought, strict JSON, minimal-design safe) ──
_SYSTEM_PROMPT = (
    "You are a STRICT visual QA reviewer for a generated website's FIRST desktop viewport. "
    "You are NOT a designer generating a new site; you judge the single screenshot against the "
    "build's binding contract and plan. Judge only what is VISIBLE in the screenshot.\n"
    "Flag, when clearly present: first-viewport contract violations; a dominant element that does "
    "not match the plan; a generic AI-template look; a default dark-purple/neon fallback; an "
    "oversized headline dominating the viewport; decorative dashboards/charts posing as real "
    "product proof; meaningless node diagrams or skeleton bars; repeated identical card grids; "
    "weak visual hierarchy; poor spacing/composition; an inappropriate visual medium; missing "
    "business-specific proof; unjustified pricing/testimonials/final-CTA; a mismatch between the "
    "requested brand and the produced visual language.\n"
    "PROTECT valid minimal design. Do NOT demand more sections for density, animation for "
    "excitement, gradients, imagery when typography-first/no-image is intended, or a marketing "
    "hero for app-first experiences.\n"
    "Return STRICT JSON ONLY (no markdown, no prose, no explanation outside JSON, no confidence or "
    "reasoning fields) with EXACTLY this shape:\n"
    '{"verdict":"pass"|"needs-repair","score":0-100,'
    '"issues":[{"code":str,"area":str,"severity":"minor"|"major"|"blocker","message":str,'
    '"repairInstruction":str}],"templateSimilaritySignals":[str],"proofAssessment":str,'
    '"hierarchyAssessment":str,"compositionAssessment":str}\n'
    "Each repairInstruction must be targeted, section-specific, preservation-aware and doable in "
    "ONE bounded repair. Use severity minor for advisory nits (they will not force a repair)."
)


def _clean_findings(items: Any) -> List[str]:
    out: List[str] = []
    if isinstance(items, list):
        for it in items:
            if isinstance(it, str):
                t = it.strip()[:_MAX_FINDING_CHARS]
                if t:
                    out.append(t)
            if len(out) >= _MAX_FINDINGS:
                break
    return out


def _build_user_content(body: VisionReviewRequest, data_url: str) -> List[Dict[str, Any]]:
    """The multimodal user turn: bounded context text + the single screenshot image_url block.
    NO source code / tokens / history / hidden prompts are included."""
    parts: List[str] = ["Review this generated first desktop viewport against the build contract."]
    contract = (body.contractSummary or "").strip()[:_MAX_SUMMARY_CHARS]
    plan = (body.planSummary or "").strip()[:_MAX_SUMMARY_CHARS]
    findings = _clean_findings(body.runtimeFindings)
    if contract:
        parts.append("GENERATION CONTRACT (binding):\n" + contract)
    if plan:
        parts.append("EXPERIENCE PLAN (summary):\n" + plan)
    if findings:
        parts.append("RUNTIME FINDINGS:\n- " + "\n- ".join(findings))
    text = "\n\n".join(parts)
    return [
        {"type": "text", "text": text},
        {"type": "image_url", "image_url": {"url": data_url, "detail": "auto"}},
    ]


def _fail_open(user_id: str, run_id: str, error_code: str, meta: Dict[str, Any]) -> Dict[str, Any]:
    """Return a 200 fail-open envelope (review=null) so a vision failure never blocks the build."""
    return envelope_ok(
        data={"review": None, "ok": False, "errorCode": error_code},
        endpoint="/v2/web-build/vision-review",
        user_id=user_id,
        runId=run_id,
        **meta,
    )


@router.post("/vision-review")
async def vision_review(
    body: VisionReviewRequest,
    user: User = Depends(require_auth),
) -> Dict[str, Any]:
    if not _is_enabled():
        raise _disabled_503()

    run_id = (body.runId or "").strip()[:_MAX_RUN_ID]
    if not run_id:
        raise _bad_request("INVALID_RUN_ID", "runId is required.")

    now = time.monotonic()
    if _rate_limited(user.id, now):
        raise HTTPException(
            status_code=429,
            detail={"code": "VISION_REVIEW_RATE_LIMITED", "message": "Too many vision reviews; slow down."},
        )

    # Validate the image up front (400 on any problem) — before spending a model call.
    img = _validate_image(body.imageDataUrl)
    obs: Dict[str, Any] = {"inputByteLength": img["byte_length"], "mimeType": img["mime"]}

    # Reuse the shared OpenAI provider + one vision-capable model. Never a second client.
    try:
        provider = get_provider("openai")
    except Exception:
        return _fail_open(user.id, run_id, "provider-unavailable", obs)
    model = settings.MODEL_STRONG
    if not getattr(provider, "supports_vision", False) or not provider.model_supports_vision(model):
        return _fail_open(user.id, run_id, "vision-model-unavailable", {**obs, "model": model})

    request = ProviderRequest(
        messages=[
            ProviderMessage(role="system", content=_SYSTEM_PROMPT),
            ProviderMessage(role="user", content=_build_user_content(body, body.imageDataUrl)),
        ],
        model=model,
        temperature=0.0,
        max_tokens=1200,
        timeout_s=_VISION_TIMEOUT_S,
        extra={"response_format": {"type": "json_object"}},
    )

    started = time.monotonic()
    try:
        result = await provider.chat_completion(request)
    except ProviderError as exc:
        # Fail-open: a provider timeout / auth / rate-limit / unavailability must not block the
        # build. Log the CODE only — never the screenshot.
        logger.info("vision-review provider error: %s", getattr(exc, "code", "provider-error"))
        return _fail_open(user.id, run_id, "provider-error", {**obs, "model": model})
    except Exception:  # pragma: no cover - defensive, never leak internals
        logger.info("vision-review unexpected provider failure")
        return _fail_open(user.id, run_id, "provider-error", {**obs, "model": model})
    latency_ms = int((time.monotonic() - started) * 1000)

    # Parse the model JSON. The raw response is NEVER persisted; only the typed review is returned
    # (the frontend sanitizer validates/bounds it further).
    review: Optional[Dict[str, Any]] = None
    try:
        parsed = json.loads(result.content or "")
        if isinstance(parsed, dict):
            review = parsed
    except (ValueError, TypeError):
        review = None
    if review is None:
        return _fail_open(user.id, run_id, "malformed-json",
                          {**obs, "model": model, "provider": result.provider, "latencyMs": latency_ms})

    # Best-effort, non-fatal usage accounting (maps provider usage → cost tracker).
    _record_cost(run_id, user.id, result, latency_ms)

    return envelope_ok(
        data={"review": review, "ok": True, "model": result.model, "provider": result.provider},
        endpoint="/v2/web-build/vision-review",
        user_id=user.id,
        runId=run_id,
        latencyMs=latency_ms,
        inputByteLength=img["byte_length"],
    )


def _record_cost(run_id: str, user_id: str, result: Any, latency_ms: int) -> None:
    """Best-effort cost accounting — never fatal, never blocks the response."""
    try:
        from backend.services.cost_tracking import tracker
        from backend.services.cost_tracking.types import TokenUsage
        usage = getattr(result, "usage", None)
        tok = TokenUsage(
            input_tokens=getattr(usage, "prompt_tokens", 0) or 0,
            output_tokens=getattr(usage, "completion_tokens", 0) or 0,
        )
        tracker.record_ai_call(
            build_id=run_id, user_id=user_id, provider=getattr(result, "provider", "openai"),
            model=getattr(result, "model", ""), operation_type="web_build_vision_review",
            usage=tok, success=True, duration_ms=latency_ms, stage="vision-review",
        )
    except Exception:  # pragma: no cover - accounting must never break the route
        pass


__all__ = ["router"]
