# coding: utf-8
"""
Image Intelligence — Phase 1 pixel-level VISUAL rerank (bounded, high-impact only).

The metadata :class:`ImageRankingEngine` cannot see pixels; it ranks on provider
alt-text, resolution and aspect. For the handful of slots where the *image itself*
carries the page — the hero, a hero/background, a primary about/storytelling shot —
that blind spot is expensive: two candidates can be metadata-equivalent yet one is a
generic desk photo and the other is the on-brand, correctly-framed, people-present
photograph the art direction asked for. Only pixels can tell them apart.

This module runs a SINGLE multimodal request per eligible slot over the TOP-N
metadata-ranked candidates (never one request per candidate, never a new stock
search, never the whole pool) and returns the candidate the judge picks on VISIBLE
evidence against the Phase-1 art direction. Everything about it is bounded and
fail-open:

  * Gated OFF by default (``ENABLE_SMART_IMAGE_VISUAL_RERANK``) — when off, the smart
    path is byte-identical.
  * High-impact photographic slots ONLY (:func:`is_high_impact_slot`).
  * Reuses the shared OpenAI provider + one vision model (``settings.MODEL_STRONG``) —
    the SAME plumbing as the Rendered Vision Review. Never a second client/model.
  * Any timeout / provider failure / malformed reply → the metadata winner is
    preserved unchanged (:func:`rerank_winner` returns ``available[0]``).
  * No raw image bytes or prompt text are persisted — only bounded, secret-free
    diagnostics are returned to the caller.
"""
from __future__ import annotations

import json
import logging
import time
from typing import Any, Awaitable, Callable, Dict, List, Optional, Tuple

from backend.services.image_intelligence.design_intent import DesignIntent, ImageRequirement
from backend.services.image_intelligence.ranking import ScoredImage

logger = logging.getLogger(__name__)

# ── Bounds (safe code defaults — no extra env vars for these knobs) ─────────────
_RERANK_TIMEOUT_S = 20.0
_RERANK_MAX_TOKENS = 200          # a tiny JSON verdict; never a description
_MAX_BRIEF_CHARS = 900            # the art-direction brief text is bounded

# High-impact photographic slots the visual pass is allowed to touch. A hero or a
# hero/background is always eligible; an ``about`` slot only when it is the primary
# storytelling shot (required, or its role names it so) — never every about tile.
_HIGH_IMPACT_PURPOSES = frozenset({"hero", "background"})
_HIGH_IMPACT_ROLE_TOKENS = ("hero", "signature", "storytelling", "primary-about", "about-primary")
# Authenticity values that mark a slot as explicitly NON-photographic — those are
# never sent through a photographic visual judge.
_NON_PHOTO_AUTHENTICITY = frozenset({"illustrative-ok", "generatable"})

# Injection seam: the caller (or a test) can pass its own provider getter. Defaults to
# the shared registry so production reuses the exact same OpenAI provider instance.
ProviderGetter = Callable[[str], Any]


def is_high_impact_slot(req: ImageRequirement) -> bool:
    """True only for the photographic slots where a pixel-level pick is worth a vision
    call: hero, hero/background, or the PRIMARY about/storytelling shot. Explicitly
    illustrative/generatable slots are excluded (not a photographic decision). This is
    the sole gate on *which* slots may ever incur a visual-rerank cost."""
    try:
        if (req.authenticity or "").strip().lower() in _NON_PHOTO_AUTHENTICITY:
            return False
        if (req.purpose or "").strip().lower() in _HIGH_IMPACT_PURPOSES:
            return True
        role = (req.role or "").strip().lower()
        if role and any(tok in role for tok in _HIGH_IMPACT_ROLE_TOKENS):
            return True
        # A primary about/story image (required storytelling slot) is high-impact even
        # without an explicit role token; a decorative about tile (not required) is not.
        if (req.purpose or "").strip().lower() == "about" and req.required:
            return True
        return False
    except Exception:  # noqa: BLE001 — the gate must never raise into selection
        return False


_SYSTEM_PROMPT = (
    "You are an art director choosing the single best photograph for one high-impact "
    "website slot. You are shown a small numbered set of real candidate photos and a "
    "brief describing the slot's art direction. Judge ONLY what is visibly true in each "
    "photo (subject, whether people are present, framing/composition, orientation, "
    "lighting, mood, authenticity, and space for text). Do not invent details you "
    "cannot see. Pick the candidate that best satisfies the brief. Respond with STRICT "
    'JSON only: {"bestIndex": <0-based integer>, "reason": "<short visible-evidence '
    'justification>"}. bestIndex MUST be one of the shown indices.'
)


def _art_direction_brief(intent: DesignIntent, req: ImageRequirement) -> str:
    """A compact, bounded art-direction brief from the Phase-1 fields. Contains only the
    already-derived per-slot direction — no user copy, no research, no secrets."""
    lines: List[str] = ["SLOT ART DIRECTION:"]

    def add(label: str, value: Any) -> None:
        text = str(value or "").strip()
        if text:
            lines.append(f"- {label}: {text[:160]}")

    add("role", req.role)
    add("subject", req.subject)
    add("people", req.people)                       # required | optional | avoid
    add("framing", req.framing)
    add("lighting", req.lighting)
    add("tone", req.tone)
    add("authenticity", req.authenticity)
    add("orientation", req.orientation)
    add("aspect ratio", req.aspect_ratio_hint)
    add("focal point", req.focal_point)
    if req.negative_space:
        lines.append("- negative space: room for headline/CTA text is desired")
    add("industry", intent.industry)
    add("brand style", intent.brand_style)
    add("emotional tone", intent.emotional_tone)
    return "\n".join(lines)[:_MAX_BRIEF_CHARS]


def _candidate_url(scored: ScoredImage) -> str:
    """The hotlink URL a vision model can fetch. Prefer the preview ``url``; fall back to
    the thumbnail. Empty when neither is usable (that candidate is skipped)."""
    cand = scored.candidate
    return (getattr(cand, "url", "") or getattr(cand, "thumbnail_url", "") or "").strip()


def _build_user_content(intent: DesignIntent, req: ImageRequirement,
                        shortlist: List[ScoredImage]) -> List[Dict[str, Any]]:
    """One multimodal user turn: the bounded brief text, then ONE image block per
    candidate (indexed 0..n-1). Low detail keeps the single call cheap and bounded."""
    parts: List[Dict[str, Any]] = [
        {"type": "text",
         "text": _art_direction_brief(intent, req)
                 + f"\n\nThere are {len(shortlist)} candidates, indexed 0 to {len(shortlist) - 1}, "
                   "shown in order below. Choose the single best index."},
    ]
    for i, scored in enumerate(shortlist):
        parts.append({"type": "text", "text": f"Candidate {i}:"})
        parts.append({"type": "image_url", "image_url": {"url": _candidate_url(scored), "detail": "low"}})
    return parts


def _parse_best_index(content: Optional[str], count: int) -> Optional[int]:
    """Extract a valid 0-based index from the model's JSON verdict, or ``None`` (→ fail
    open). Any parse error, wrong type, or out-of-range index yields ``None``."""
    try:
        parsed = json.loads(content or "")
    except (ValueError, TypeError):
        return None
    if not isinstance(parsed, dict):
        return None
    raw = parsed.get("bestIndex")
    if isinstance(raw, bool):        # bool is an int subclass — reject explicitly
        return None
    if not isinstance(raw, int):
        try:
            raw = int(str(raw).strip())
        except (TypeError, ValueError):
            return None
    return raw if 0 <= raw < count else None


def _base_diag(eligible: bool, candidate_count: int, reason: str) -> Dict[str, Any]:
    """A bounded, secret-free diagnostic row (attached to the winner's score metadata)."""
    return {
        "visualRerankEligible": eligible,
        "visualRerankAttempted": False,
        "candidateCount": candidate_count,
        "succeeded": False,
        "selectedRankBefore": 0,
        "selectedRankAfter": 0,
        "latencyMs": 0,
        "reason": reason,
    }


async def rerank_winner(
    intent: DesignIntent,
    req: ImageRequirement,
    available: List[ScoredImage],
    *,
    top_n: int,
    provider_getter: Optional[ProviderGetter] = None,
    model: Optional[str] = None,
) -> Tuple[ScoredImage, Dict[str, Any]]:
    """Pick the visually-best candidate for one high-impact slot from the TOP-N of an
    already-uniqueness-filtered, metadata-ranked ``available`` list.

    ``available`` MUST be pre-filtered for cross-slot uniqueness by the caller, so any
    index this returns is safe to select. Returns ``(winner, diagnostics)``; on ANY
    problem (too few candidates, provider unavailable, vision unsupported, timeout,
    provider error, malformed reply, out-of-range index) it FAILS OPEN and returns
    ``available[0]`` — the metadata winner — with diagnostics explaining the skip. Never
    raises, never grows the candidate pool, never triggers a stock search.
    """
    # Guard: nothing to choose between → keep the metadata winner.
    if not available:
        return available[0] if available else None, _base_diag(True, 0, "no-candidates")  # type: ignore[index]

    shortlist = [s for s in available[: max(2, top_n)] if _candidate_url(s)]
    if len(shortlist) < 2:
        return available[0], _base_diag(True, len(shortlist), "insufficient-candidates")

    # Wire types are pure dataclasses (no SDK); ProviderError is the fail-open catch.
    try:
        from backend.services.providers.errors import ProviderError
        from backend.services.providers.types import ProviderMessage, ProviderRequest
    except Exception:  # noqa: BLE001 — provider wire layer unavailable → fail open
        return available[0], _base_diag(True, len(shortlist), "provider-import-unavailable")

    # Resolve the shared provider. The registry import is LAZY — only taken on the real
    # path (no injected getter) — so a missing provider SDK never breaks selection when a
    # caller/test supplies its own getter. Never a second client.
    try:
        getter = provider_getter
        if getter is None:
            from backend.services.providers import get_provider as getter  # type: ignore[no-redef]
        provider = getter("openai")
    except Exception:  # noqa: BLE001
        return available[0], _base_diag(True, len(shortlist), "provider-unavailable")

    # Resolve the vision model. settings is only imported when the caller didn't pin one.
    use_model = model or ""
    if not use_model:
        try:
            from backend.core.config import settings
            use_model = getattr(settings, "MODEL_STRONG", "") or ""
        except Exception:  # noqa: BLE001
            return available[0], _base_diag(True, len(shortlist), "provider-unavailable")
    if not getattr(provider, "supports_vision", False) or not provider.model_supports_vision(use_model):
        return available[0], _base_diag(True, len(shortlist), "vision-model-unavailable")

    request = ProviderRequest(
        messages=[
            ProviderMessage(role="system", content=_SYSTEM_PROMPT),
            ProviderMessage(role="user", content=_build_user_content(intent, req, shortlist)),
        ],
        model=use_model,
        temperature=0.0,
        max_tokens=_RERANK_MAX_TOKENS,
        timeout_s=_RERANK_TIMEOUT_S,
        extra={"response_format": {"type": "json_object"}},
    )

    diag = _base_diag(True, len(shortlist), "attempted")
    diag["visualRerankAttempted"] = True
    started = time.monotonic()
    try:
        result = await provider.chat_completion(request)
    except ProviderError as exc:
        diag["latencyMs"] = int((time.monotonic() - started) * 1000)
        diag["reason"] = "provider-error"
        logger.info("[IMG_INTEL] visual rerank provider error: %s", getattr(exc, "code", "provider-error"))
        return available[0], diag
    except Exception:  # noqa: BLE001 — defensive; never leak internals, never block
        diag["latencyMs"] = int((time.monotonic() - started) * 1000)
        diag["reason"] = "provider-error"
        logger.info("[IMG_INTEL] visual rerank unexpected provider failure")
        return available[0], diag
    diag["latencyMs"] = int((time.monotonic() - started) * 1000)

    best = _parse_best_index(getattr(result, "content", None), len(shortlist))
    if best is None:
        diag["reason"] = "malformed-verdict"
        return available[0], diag

    diag["succeeded"] = True
    diag["selectedRankBefore"] = best      # the chosen candidate's metadata position (0 = no change)
    diag["selectedRankAfter"] = 0          # it is now the selected winner
    diag["reason"] = "reranked" if best != 0 else "confirmed-metadata-winner"
    return shortlist[best], diag


__all__ = ["is_high_impact_slot", "rerank_winner"]
