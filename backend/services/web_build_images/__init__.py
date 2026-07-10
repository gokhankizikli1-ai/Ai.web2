# coding: utf-8
"""
Web Build — Real Image Generation V1 (Phase 10D) provider bridge.

Turns an Image Pipeline (Phase 10C) slot into a REAL generated image, safely
and server-side only. Design constraints (must not be violated):

  • API keys are read from SERVER env only — never returned to the frontend.
  • Video is OUT OF SCOPE. This module never generates video.
  • Proof-heavy slots (real project/food/location/archive/listing photos,
    logos, testimonials, certificates, before/after) are NEVER generated —
    they are downgraded to `disabled` with a "manual upload required" reason.
    Only illustrative / abstract / ambient slots are generatable.
  • Fails OPEN: if the provider is disabled, unconfigured, or errors, it
    returns a structured `disabled`/`failed` asset — it never raises to the
    caller and never fabricates a fake success.

Provider adapters (adapter pattern):
    generate_image(request)          → dispatch by IMAGE_GENERATION_PROVIDER
      _generate_openai(...)          → OpenAI Images (gpt-image-1 / dall-e-3)
      _generate_stability(...)       → Stability AI REST
      _generate_custom(...)          → a self-hosted HTTP endpoint you control
      (replicate → documented, returns disabled in V1)

Env (server-side only):
    ENABLE_WEB_BUILD_IMAGE_GEN   master flag (default off → disabled)
    IMAGE_GENERATION_PROVIDER    openai | stability | custom | replicate | disabled
    IMAGE_GENERATION_API_KEY     provider key (falls back to OPENAI_API_KEY /
                                 STABILITY_API_KEY for the matching provider)
    IMAGE_GENERATION_MODEL       optional model override
    IMAGE_GENERATION_CUSTOM_URL  custom provider POST endpoint
"""
from __future__ import annotations

import base64
import logging
import os
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

# ── Kinds that ALWAYS represent something real → never generated ──────────────
# (belt-and-suspenders: even if a slot is mislabelled provider-ready upstream,
#  these are blocked so we can never fabricate real-looking proof.)
_ALWAYS_MANUAL_KINDS = {
    "project-photo",
    "gallery-photo",
    "before-after-pair",
    "restaurant-space",
    "product-listing-image",
    "archive-scan",
    "portfolio-work-image",
    "team-or-studio-photo",
}
# Kinds that are inherently illustrative / abstract / ambient → generatable.
_ILLUSTRATIVE_KINDS = {
    "abstract-brand-image",
    "illustrative-product-scene",
    "hero-background",
    "catalog-cover",
    "food-photo",          # only when the slot itself is provider-ready (illustrative dish)
    "hero-image",
}


def is_enabled() -> bool:
    return os.getenv("ENABLE_WEB_BUILD_IMAGE_GEN", "false").strip().lower() == "true"


def active_provider() -> str:
    p = (os.getenv("IMAGE_GENERATION_PROVIDER", "") or "").strip().lower()
    return p or ("openai" if _provider_key("openai") else "disabled")


def _provider_key(provider: str) -> str:
    """Resolve the API key for a provider from server env only. Never logged,
    never returned to the frontend."""
    generic = (os.getenv("IMAGE_GENERATION_API_KEY", "") or "").strip()
    if generic:
        return generic
    if provider == "openai":
        return (os.getenv("OPENAI_API_KEY", "") or "").strip()
    if provider == "stability":
        return (os.getenv("STABILITY_API_KEY", "") or "").strip()
    if provider == "replicate":
        return (os.getenv("REPLICATE_API_TOKEN", "") or "").strip()
    return ""


def provider_configured(provider: Optional[str] = None) -> bool:
    p = (provider or active_provider())
    if p in ("disabled", "", None):
        return False
    if p == "custom":
        return bool((os.getenv("IMAGE_GENERATION_CUSTOM_URL", "") or "").strip())
    return bool(_provider_key(p))


def missing_reason() -> Optional[str]:
    """A short, non-sensitive reason the feature is not usable, or None when it
    is ready. Never leaks key material — only presence/absence."""
    if not is_enabled():
        return "ENABLE_WEB_BUILD_IMAGE_GEN is off"
    p = active_provider()
    if p in ("disabled", ""):
        return "IMAGE_GENERATION_PROVIDER is not set"
    if p == "replicate":
        return "Replicate is not wired in V1 (use openai, stability or custom)"
    if not provider_configured(p):
        if p == "custom":
            return "IMAGE_GENERATION_CUSTOM_URL is not set"
        return f"{p} API key is not configured on the server"
    return None


# ── Safety gate (mirrors the frontend gate byte-for-byte in intent) ───────────
def generation_allowed(kind: str, source: str, manual_upload_recommended: bool) -> Dict[str, Any]:
    """Decide whether a slot may be generated. Returns
    {allowed: bool, reason: str}. Proof-heavy slots are refused so the pipeline
    can never fabricate real-looking evidence."""
    k = (kind or "").strip()
    s = (source or "").strip()
    if manual_upload_recommended or s == "manual-upload":
        return {"allowed": False, "reason": "manual upload required for real proof"}
    if k in _ALWAYS_MANUAL_KINDS:
        return {"allowed": False, "reason": "manual upload required for real proof"}
    if s in ("provider-ready", "prompt-ready") and k in _ILLUSTRATIVE_KINDS:
        return {"allowed": True, "reason": "illustrative image — safe to generate"}
    # css-placeholder / none / anything else → the Preview keeps its CSS/SVG frame.
    return {"allowed": False, "reason": "handled as a CSS/SVG placeholder (no generation)"}


# ── Aspect ratio → provider size helpers ──────────────────────────────────────
def _openai_size(aspect: str) -> str:
    a = (aspect or "").strip()
    if a in ("1:1",):
        return "1024x1024"
    if a in ("9:16",):
        return "1024x1792"
    # 16:9 / 21:9 / 3:2 / 4:3 and anything else → landscape
    return "1792x1024"


def _disabled_asset(slot_id: str, honesty_label: str, reason: str, status: str = "disabled") -> Dict[str, Any]:
    return {
        "slotId": slot_id,
        "status": status,
        "provider": active_provider(),
        "error": reason if status == "failed" else None,
        "honestyLabel": honesty_label or "AI-generated illustrative image",
        "promptSummary": "",
        "reason": reason,
    }


def generate_image(request: Dict[str, Any]) -> Dict[str, Any]:
    """Adapter dispatch. `request` mirrors the frontend ImageGenerationRequest:
    {slotId, target, kind, source?, manualUploadRecommended?, honestyLabel,
     prompt:{positive,negative,style,aspectRatio,safetyNotes}}.
    Always returns a GeneratedImageAsset-shaped dict; never raises."""
    slot_id = str(request.get("slotId") or "")
    honesty = str(request.get("honestyLabel") or "AI-generated illustrative image")
    prompt = request.get("prompt") or {}
    kind = str(request.get("kind") or "")
    source = str(request.get("source") or "")
    manual = bool(request.get("manualUploadRecommended") or False)

    if not is_enabled():
        return _disabled_asset(slot_id, honesty, "image generation is disabled on this deployment")

    gate = generation_allowed(kind, source, manual)
    if not gate["allowed"]:
        return _disabled_asset(slot_id, honesty, gate["reason"])

    provider = active_provider()
    reason = missing_reason()
    if reason is not None:
        return _disabled_asset(slot_id, honesty, reason)

    positive = str(prompt.get("positive") or "").strip()
    negative = str(prompt.get("negative") or "").strip()
    style = str(prompt.get("style") or "").strip()
    aspect = str(prompt.get("aspectRatio") or "16:9").strip()
    prompt_summary = (positive[:140] + ("…" if len(positive) > 140 else "")) if positive else ""
    if not positive:
        return _disabled_asset(slot_id, honesty, "empty prompt", status="failed")

    try:
        if provider == "openai":
            data_url = _generate_openai(positive, negative, style, aspect)
        elif provider == "stability":
            data_url = _generate_stability(positive, negative, style, aspect)
        elif provider == "custom":
            data_url = _generate_custom(positive, negative, style, aspect, request)
        else:  # replicate or unknown — documented as disabled in V1
            return _disabled_asset(slot_id, honesty, f"{provider} is not supported in V1")
    except Exception as exc:  # fail open — never crash the caller
        logger.error("[WEB_BUILD_IMG] generation failed slot=%s provider=%s: %s", slot_id, provider, exc)
        return _disabled_asset(slot_id, honesty, "image generation failed on the server", status="failed")

    if not data_url:
        return _disabled_asset(slot_id, honesty, "provider returned no image", status="failed")

    return {
        "slotId": slot_id,
        "status": "ready",
        "dataUrl": data_url,
        "provider": provider,
        "error": None,
        "honestyLabel": honesty,
        "promptSummary": prompt_summary,
    }


# ── Provider adapters ─────────────────────────────────────────────────────────
def _compose_prompt(positive: str, style: str, negative: str) -> str:
    parts = [positive]
    if style:
        parts.append(f"Style: {style}")
    if negative:
        parts.append(f"Avoid: {negative}")
    parts.append(
        "Illustrative only. No text, no logos, no brand names, no real people, "
        "no fake metrics or testimonials, no UI screenshots implying real data."
    )
    return " ".join(parts)


def _generate_openai(positive: str, negative: str, style: str, aspect: str) -> Optional[str]:
    """OpenAI Images → returns a data: URL (base64). Key is server-side only."""
    key = _provider_key("openai")
    if not key:
        return None
    model = (os.getenv("IMAGE_GENERATION_MODEL", "") or "gpt-image-1").strip()
    from openai import OpenAI  # local import so a missing lib can't break app boot
    client = OpenAI(api_key=key)
    kwargs: Dict[str, Any] = {
        "model": model,
        "prompt": _compose_prompt(positive, style, negative),
        "size": _openai_size(aspect),
        "n": 1,
    }
    # dall-e-3 accepts response_format=b64_json; gpt-image-1 returns b64 by default.
    if model.startswith("dall-e"):
        kwargs["response_format"] = "b64_json"
    resp = client.images.generate(**kwargs)
    b64 = getattr(resp.data[0], "b64_json", None)
    if not b64:
        url = getattr(resp.data[0], "url", None)
        return url  # some models return a hosted URL instead of b64
    return f"data:image/png;base64,{b64}"


def _generate_stability(positive: str, negative: str, style: str, aspect: str) -> Optional[str]:
    """Stability AI (SD3/Core) → returns a data: URL. Key is server-side only."""
    key = _provider_key("stability")
    if not key:
        return None
    import httpx
    model = (os.getenv("IMAGE_GENERATION_MODEL", "") or "sd3.5-large-turbo").strip()
    ar = aspect if aspect in {"16:9", "1:1", "21:9", "3:2", "4:3", "9:16", "2:3", "5:4"} else "16:9"
    endpoint = "https://api.stability.ai/v2beta/stable-image/generate/core"
    with httpx.Client(timeout=60.0) as hc:
        r = hc.post(
            endpoint,
            headers={"authorization": f"Bearer {key}", "accept": "image/*"},
            files={"none": ""},
            data={
                "prompt": _compose_prompt(positive, style, ""),
                "negative_prompt": negative,
                "aspect_ratio": ar,
                "model": model,
                "output_format": "png",
            },
        )
    if r.status_code >= 400:
        logger.error("[WEB_BUILD_IMG] stability http %s", r.status_code)
        return None
    b64 = base64.b64encode(r.content).decode("ascii")
    return f"data:image/png;base64,{b64}"


def _generate_custom(positive: str, negative: str, style: str, aspect: str, request: Dict[str, Any]) -> Optional[str]:
    """A self-hosted endpoint you control. Contract:
        POST $IMAGE_GENERATION_CUSTOM_URL
        {prompt, negative, style, aspectRatio}  (Bearer key if IMAGE_GENERATION_API_KEY set)
        → {dataUrl}  or  {url}
    Lets you front any in-house/self-hosted model without new backend code."""
    url = (os.getenv("IMAGE_GENERATION_CUSTOM_URL", "") or "").strip()
    if not url:
        return None
    import httpx
    headers = {"content-type": "application/json"}
    key = _provider_key("custom") or (os.getenv("IMAGE_GENERATION_API_KEY", "") or "").strip()
    if key:
        headers["authorization"] = f"Bearer {key}"
    with httpx.Client(timeout=90.0) as hc:
        r = hc.post(
            url,
            headers=headers,
            json={
                "prompt": _compose_prompt(positive, style, negative),
                "negative": negative,
                "style": style,
                "aspectRatio": aspect,
                "kind": request.get("kind"),
                "target": request.get("target"),
            },
        )
    if r.status_code >= 400:
        logger.error("[WEB_BUILD_IMG] custom http %s", r.status_code)
        return None
    try:
        body = r.json()
    except Exception:
        return None
    return body.get("dataUrl") or body.get("url")


__all__ = [
    "is_enabled",
    "active_provider",
    "provider_configured",
    "missing_reason",
    "generation_allowed",
    "generate_image",
]
