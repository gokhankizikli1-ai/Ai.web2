# coding: utf-8
"""
Web Build context — attach design intelligence to generation.

This is the small ADAPTER that connects the isolated intelligence foundations to Web
Build generation. It renders the compact context blocks the website-generating model
receives ALONGSIDE its existing prompt, composed from independently flag-gated parts:

  1. DESIGN PERSONALITY GUIDANCE — the inferred design personality (who the brand is)
     with its visual/motion direction and avoid list, as a contextual BIAS. Gated by
     ``ENABLE_DESIGN_PERSONALITY``. The inferred personality also lightly biases the
     Visual Strategy archetype below (never overrides explicit user/domain signals).
  2. DESIGN INTELLIGENCE — a Visual Strategy + Motion Strategy (how the brand should
     feel, what visual language to use, how motion should behave). Gated by
     ``ENABLE_VISUAL_CONTEXT_INJECTION``.
  3. QUALITY GUIDELINES — the Web Quality Guard's design-quality principles (what makes
     the site feel professionally designed). Gated by ``ENABLE_WEB_QUALITY_GUARD``.

The three flags are independent: each part appears only when its own flag is on, and the
seam that consumes this module (the orchestrator's prompt assembly) is UNCHANGED — it
still appends the single string this returns. With all flags off the return is ``""`` so
generation is byte-for-byte unchanged. The personality is inferred at most ONCE per call.

Design constraints honoured here:
  • the blocks are text, never raw JSON, and never expose internal fields or flags;
  • empty sections are omitted; each block is bounded (design < ~500, quality < ~300);
  • the original user prompt is never duplicated into them;
  • every path is fail-open — any failure yields ``""`` for that part, so a broken layer
    can never break a generation run.
"""
from __future__ import annotations

import logging
import os
from typing import Any, Dict, List, Optional

from backend.services import motion_intelligence, visual_intelligence
from backend.services.web_build_context.formatter import build_design_context

logger = logging.getLogger(__name__)

_MAX_REQUEST = 2000
# Optional structured signals the caller may already have (e.g. on a blueprint).
_CONTEXT_KEYS = (
    "industry", "sector", "subsector", "audience", "targetAudience", "target_audience",
    "brand_style", "brandStyle", "emotional_tone", "emotionalTone", "image_style", "imageStyle",
)
_INDUSTRY_KEYS = ("industry", "sector", "subsector", "siteType", "site_type")


def is_enabled() -> bool:
    """True only when ``ENABLE_VISUAL_CONTEXT_INJECTION`` is explicitly ``"true"``.

    Governs the DESIGN INTELLIGENCE part only; the QUALITY GUIDELINES part has its own
    flag (``ENABLE_WEB_QUALITY_GUARD``) inside the Web Quality Guard."""
    return (os.getenv("ENABLE_VISUAL_CONTEXT_INJECTION", "false") or "").strip().lower() == "true"


# A concise, controlled brand-style hint per inferred personality — used ONLY to bias
# the Visual Strategy archetype toward the personality (never to override explicit
# signals). Kept here (not in the personality package) so the package stays untouched.
_PERSONALITY_BIAS: Dict[str, str] = {
    "trustworthy_premium": "premium corporate trustworthy",
    "cinematic_elegant": "cinematic luxury elegant",
    "playful": "playful vibrant friendly",
    "natural_editorial": "natural editorial warm",
    "minimal_modern": "minimal clean modern",
    "bold_creative": "bold creative expressive",
    "futuristic": "premium futuristic",
    "approachable_professional": "modern professional",
}


def _signal(user_request: str, context: Optional[Dict[str, Any]],
            personality_value: str = "") -> Dict[str, Any]:
    signal: Dict[str, Any] = {"prompt": (user_request or "")[:_MAX_REQUEST]}
    if isinstance(context, dict):
        for key in _CONTEXT_KEYS:
            value = context.get(key)
            if isinstance(value, str) and value.strip():
                signal[key] = value.strip()[:200]
    # Bias (not override): APPEND the personality hint to the brand-style signal so the
    # archetype leans toward the inferred personality while the explicit brand_style,
    # industry and prompt tokens still dominate resolution.
    bias = _PERSONALITY_BIAS.get(personality_value or "")
    if bias:
        existing = str(signal.get("brand_style") or signal.get("brandStyle") or "").strip()
        signal["brand_style"] = (f"{existing} {bias}".strip())[:200]
    return signal


def _design_block(user_request: str, context: Optional[Dict[str, Any]],
                  personality_value: str = "") -> str:
    """The DESIGN INTELLIGENCE block (Visual + Motion). ``""`` when its flag is off,
    there is no signal, or anything fails. When a personality was inferred, its value
    lightly biases the Visual Strategy archetype (see :func:`_signal`)."""
    if not is_enabled():
        return ""
    # No signal at all → inject nothing (avoid a generic block on an empty request).
    if not (user_request or "").strip() and not context:
        return ""
    try:
        visual = visual_intelligence.analyze(_signal(user_request, context, personality_value))
        motion = motion_intelligence.analyze(visual)
        return build_design_context(visual, motion)
    except Exception as exc:  # noqa: BLE001 — injection must never break a generation run
        logger.debug("[WB_CTX] design context build soft-failed: %s", type(exc).__name__)
        return ""


def _quality_block(user_request: str, context: Optional[Dict[str, Any]]) -> str:
    """The QUALITY GUIDELINES block. Gated by ``ENABLE_WEB_QUALITY_GUARD`` inside the
    guard (returns ``""`` when off). Lazily imported so this module carries no import-time
    dependency on the guard and cannot create a cycle. Never raises."""
    try:
        from backend.services import web_quality_guard
        quality_ctx: Dict[str, Any] = {"prompt": (user_request or "")[:_MAX_REQUEST]}
        if isinstance(context, dict):
            for key in _INDUSTRY_KEYS:
                value = context.get(key)
                if isinstance(value, str) and value.strip():
                    quality_ctx.setdefault("industry", value.strip()[:200])
                    break
        return web_quality_guard.build_quality_context(quality_ctx)
    except Exception as exc:  # noqa: BLE001 — guidance must never break a generation run
        logger.debug("[WB_CTX] quality guidelines build soft-failed: %s", type(exc).__name__)
        return ""


def _infer_personality(user_request: str, context: Optional[Dict[str, Any]]) -> Any:
    """Infer the DesignPersonalityProfile ONCE for this build, from the strongest
    available business/user context. Gated by ``ENABLE_DESIGN_PERSONALITY`` inside the
    package (returns ``None`` when the flag is off). Lazily imported so this module has no
    import-time dependency on the package and cannot create a cycle. Never raises."""
    try:
        from backend.services import design_personality
        source: Dict[str, Any] = dict(context) if isinstance(context, dict) else {}
        # The live user request is the authoritative prompt signal.
        source["prompt"] = (user_request or "")[:_MAX_REQUEST]
        return design_personality.build_design_personality(source)
    except Exception as exc:  # noqa: BLE001 — inference must never break a generation run
        logger.debug("[WB_CTX] design personality inference soft-failed: %s", type(exc).__name__)
        return None


def _personality_block(profile: Any) -> str:
    """Render the compact DESIGN PERSONALITY GUIDANCE block for a profile, or ``""``.

    It states explicitly that the guidance is a BIAS (explicit user + strong domain
    requirements win, Avoid entries are negative constraints, and AI alone must not force
    a futuristic aesthetic). It never leaks internal scoring/reasoning (matched signals)."""
    if profile is None:
        return ""
    try:
        personality = str(getattr(getattr(profile, "design_personality", ""), "value", "") or "").replace("_", " ").strip()
        visual = " ".join(str(getattr(profile, "visual_direction", "") or "").split())[:200]
        motion = " ".join(str(getattr(profile, "motion_direction", "") or "").split())[:160]
        avoid_list = getattr(profile, "avoid_list", None) or []
        avoid = ", ".join(str(a).strip() for a in avoid_list if str(a).strip())[:200]
        confidence = getattr(profile, "confidence", 0.0)
        try:
            confidence = round(float(confidence), 2)
        except (TypeError, ValueError):
            confidence = 0.0
        if not personality:
            return ""
        lines = ["DESIGN PERSONALITY GUIDANCE", f"- Personality: {personality}"]
        if visual:
            lines.append(f"- Visual direction: {visual}")
        if motion:
            lines.append(f"- Motion direction: {motion}")
        if avoid:
            lines.append(f"- Avoid (negative constraints): {avoid}")
        lines.append(f"- Confidence: {confidence}")
        lines.append(
            "This is a contextual bias, not a replacement for explicit user requirements. "
            "Explicit user requests override inferred preferences; strong business/domain "
            "requirements override weak aesthetic defaults. Treat every Avoid entry as a "
            "negative constraint. Never default to a generic futuristic AI aesthetic solely "
            "because the product uses AI."
        )
        return "\n".join(lines)
    except Exception as exc:  # noqa: BLE001
        logger.debug("[WB_CTX] personality block build soft-failed: %s", type(exc).__name__)
        return ""


def build_web_build_design_context(
    user_request: str, context: Optional[Dict[str, Any]] = None,
) -> str:
    """Compose the Web Build context block(s) to append to the generation prompt:
    DESIGN PERSONALITY GUIDANCE, DESIGN INTELLIGENCE, and/or QUALITY GUIDELINES — each
    included only when its own flag is on. Returns ``""`` when all are off / produce
    nothing / fail, so the (unchanged) caller appends nothing and behaviour is exactly as
    before. The design personality is inferred at most ONCE here and reused (to bias the
    visual archetype and to render its guidance block). Never raises.

    ``context`` is an OPTIONAL dict of already-known signals (industry, audience, brand
    style…) such as a run's blueprint; absent, the blocks are derived from the request."""
    # Design Observability (ENABLE_DESIGN_OBSERVABILITY): read-only, log-only, fail-open.
    # It records WHY the design direction was chosen but NEVER affects the returned string;
    # a strict no-op when its flag is off.
    try:
        from backend.services import design_observability
        build_id = None
        if isinstance(context, dict):
            for key in ("build_id", "buildId", "run_id", "runId", "node_id", "id"):
                value = context.get(key)
                if isinstance(value, str) and value.strip():
                    build_id = value.strip()[:200]
                    break
        design_observability.observe(user_request, context, build_id=build_id)
    except Exception as exc:  # noqa: BLE001 — observability must never break a run
        logger.debug("[WB_CTX] design observability soft-failed: %s", type(exc).__name__)

    # Generation Adaptation (ENABLE_GENERATION_ADAPTATION): when on, a single compact
    # DESIGN GENERATION RULES block — synthesized from the SAME intelligence — SUPERSEDES
    # the raw blocks below, so the model gets actionable rules without prompt duplication.
    # Fail-open: on any error (or an empty result) fall through to the existing composition;
    # when the flag is off this is skipped entirely and behaviour is byte-for-byte unchanged.
    try:
        from backend.services import generation_adaptation
        if generation_adaptation.is_enabled():
            rules = generation_adaptation.build_generation_rules(user_request, context)
            if rules:
                return rules
    except Exception as exc:  # noqa: BLE001 — never break a generation run
        logger.debug("[WB_CTX] generation adaptation soft-failed: %s", type(exc).__name__)

    # Inferred ONCE per build; None when ENABLE_DESIGN_PERSONALITY is off.
    profile = _infer_personality(user_request, context)
    personality_value = str(getattr(getattr(profile, "design_personality", ""), "value", "") or "")

    parts: List[str] = []
    guidance = _personality_block(profile)
    if guidance:
        parts.append(guidance)
    design = _design_block(user_request, context, personality_value)
    if design:
        parts.append(design)
    quality = _quality_block(user_request, context)
    if quality:
        parts.append(quality)
    return "\n\n".join(parts)


__all__ = ["is_enabled", "build_web_build_design_context", "build_design_context"]
