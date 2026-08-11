# coding: utf-8
"""Phase 1 — preserve image art direction end-to-end and consume it conservatively in the Smart Image
ranker. Pure/deterministic; ZERO network, ZERO model/vision, ZERO stock-provider calls.

Traces the data path:
  StockNeedItem  →  _need_from_item (route projection)  →  _requirement_from_need  →  ImageRequirement
and verifies the deterministic ranking effects (people / authenticity) plus subject dominance.

The image_intelligence package __init__ imports the stock provider (httpx) at load; `importorskip`
skips cleanly in a minimal sandbox and runs in CI (same convention as test_frontend_task_kind_review).
"""
from __future__ import annotations

import pytest

pytest.importorskip("httpx")      # image_intelligence.providers → web_build_images.stock → httpx
pytest.importorskip("pydantic")   # StockNeedItem is a pydantic model

from backend.routes.v2_web_build_images import StockNeedItem, StockSourceBody, _need_from_item
from backend.services.image_intelligence.design_intent import (
    _requirement_from_need, build_design_intent, ImageRequirement,
)
from backend.services.image_intelligence import ranking
from backend.services.image_intelligence.providers import ImageCandidate


def _cand(alt: str, w: int = 2000, h: int = 1125, color: str = "#204060", photog: str = "A") -> ImageCandidate:
    pid = str(abs(hash(alt)) % 99999)
    return ImageCandidate(
        id=f"pexels:{pid}", provider="pexels", provider_image_id=pid,
        url=f"https://cdn/pexels/{pid}.jpg", width=w, height=h,
        alt=alt, dominant_color=color, photographer_name=photog, raw={"alt": alt},
    )


_RICH = dict(
    slotId="hero", query="restaurant interior espresso dining room coffee bar",
    orientation="landscape", purpose="hero", required=True, altText="cozy restaurant",
    role="hero-signature", subject="restaurant interior", people="avoid",
    framing="wide establishing", lighting="warm ambient", tone="inviting",
    authenticity="authentic-photo-required", aspectRatio="16:9", focalPoint="center",
    negativeSpace=True, loadingPriority="eager", noRepeat=True,
)
_LEGACY = dict(slotId="hero", query="ocean resort sunset", orientation="landscape",
               purpose="hero", required=True, altText="beach")


# ── A / B / J — the HTTP contract accepts legacy AND rich needs ──────────────────────────────

def test_A_route_accepts_legacy_need_old_fields_only():
    body = StockSourceBody(needs=[StockNeedItem(**_LEGACY)])
    assert body.needs[0].slotId == "hero"
    assert body.needs[0].people == ""            # new fields default to neutral
    assert body.needs[0].noRepeat is True


def test_B_route_accepts_rich_art_direction_need():
    item = StockNeedItem(**_RICH)
    assert item.people == "avoid" and item.authenticity == "authentic-photo-required"
    assert item.negativeSpace is True and item.aspectRatio == "16:9"


def test_route_rejects_nothing_on_unknown_enum_value():
    # A bad enum value is accepted as a bounded string at the wire (neutralized downstream, not 422'd).
    item = StockNeedItem(**{**_LEGACY, "people": "weird", "authenticity": "nope", "loadingPriority": "turbo"})
    assert item.people == "weird"  # accepted here…
    req = _requirement_from_need(_need_from_item(item))
    assert req.people == "" and req.authenticity == "" and req.loading_priority == ""  # …neutralized here


# ── C — rich fields survive the FULL projection into ImageRequirement ────────────────────────

def test_C_rich_fields_survive_route_projection_to_requirement():
    need = _need_from_item(StockNeedItem(**_RICH))
    req = _requirement_from_need(need)
    assert req.role == "hero-signature"
    assert req.people == "avoid"
    assert req.authenticity == "authentic-photo-required"
    assert req.aspect_ratio_hint == "16:9"
    assert req.focal_point == "center"
    assert req.negative_space is True
    assert req.loading_priority == "eager"
    assert req.framing == "wide establishing"
    # diagnostic: which art-direction fields were received (booleans only, no raw values)
    received = req.art_direction_fields()
    assert received["people"] and received["authenticity"] and received["role"] and received["negativeSpace"]


def test_C_build_design_intent_carries_art_direction():
    intent = build_design_intent([_need_from_item(StockNeedItem(**_RICH))], None)
    hero = intent.hero_image_requirement
    assert hero is not None and hero.people == "avoid" and hero.authenticity == "authentic-photo-required"


# ── D / E — people rule (metadata-truthful, alt-only) ────────────────────────────────────────

def test_D_people_avoid_ranks_person_below_similar_non_person():
    req = _requirement_from_need(_need_from_item(StockNeedItem(**{**_RICH, "people": "avoid"})))
    intent = build_design_intent([_need_from_item(StockNeedItem(**_RICH))], None)
    person = _cand("restaurant interior with a waiter portrait")
    non_person = _cand("restaurant interior dining room espresso")
    s_person = ranking.score_relevance(intent, req, person)
    s_non = ranking.score_relevance(intent, req, non_person)
    assert s_non > s_person
    delta, consumed = ranking.art_direction_adjustment(req, person)
    assert delta < 0 and consumed["people"] is True


def test_E_people_required_rewards_people_candidate():
    req_req = _requirement_from_need(_need_from_item(StockNeedItem(**{**_RICH, "people": "required"})))
    req_none = _requirement_from_need(_need_from_item(StockNeedItem(**{**_RICH, "people": ""})))
    intent = build_design_intent([_need_from_item(StockNeedItem(**_RICH))], None)
    staff = _cand("restaurant staff team serving")
    assert ranking.score_relevance(intent, req_req, staff) > ranking.score_relevance(intent, req_none, staff)
    delta, consumed = ranking.art_direction_adjustment(req_req, staff)
    assert delta > 0 and consumed["people"] is True


# ── F — authenticity (penalize obvious non-photographic metadata) ────────────────────────────

def test_F_authentic_photo_required_penalizes_illustration_render():
    req = _requirement_from_need(_need_from_item(StockNeedItem(**{**_RICH, "authenticity": "authentic-photo-required"})))
    intent = build_design_intent([_need_from_item(StockNeedItem(**_RICH))], None)
    photo = _cand("restaurant interior espresso")
    illus = _cand("restaurant interior espresso 3d render illustration")
    assert ranking.score_relevance(intent, req, photo) > ranking.score_relevance(intent, req, illus)
    delta, consumed = ranking.art_direction_adjustment(req, illus)
    assert delta < 0 and consumed["authenticity"] is True


# ── G — missing alt metadata must NOT falsely fail/reject ────────────────────────────────────

def test_G_missing_alt_is_neutral_not_rejected():
    req = _requirement_from_need(_need_from_item(StockNeedItem(**{**_RICH, "people": "avoid"})))
    intent = build_design_intent([_need_from_item(StockNeedItem(**_RICH))], None)
    blank = _cand("")
    assert ranking.score_relevance(intent, req, blank) == 45.0     # neutral floor, not 0
    delta, consumed = ranking.art_direction_adjustment(req, blank)
    assert delta == 0.0 and consumed == {"people": False, "authenticity": False}


# ── H — subject semantics dominate generic style vocabulary ──────────────────────────────────

def test_H_subject_relevance_dominates_generic_style_words():
    need = dict(slotId="hero", query="restaurant interior espresso dining room coffee bar",
                orientation="landscape", purpose="hero", required=True, altText="")
    req = _requirement_from_need(need)
    intent = build_design_intent([need], {"brandStyle": "premium editorial", "imageStyle": "natural"})
    subject_cand = _cand("restaurant interior dining room espresso")
    style_cand = _cand("premium editorial luxury elegant interior")
    assert ranking.score_relevance(intent, req, subject_cand) > ranking.score_relevance(intent, req, style_cand)


# ── I — malformed/unknown art-direction values degrade safely ────────────────────────────────

def test_I_malformed_values_degrade_safely():
    need = {"slotId": "s", "query": "x", "people": "weird", "authenticity": 123,
            "loadingPriority": "turbo", "negativeSpace": "yes", "noRepeat": "no", "role": 999}
    req = _requirement_from_need(need)
    assert req.people == "" and req.authenticity == "" and req.loading_priority == ""
    assert req.negative_space is False           # non-bool → default False
    assert req.no_repeat is True                 # non-bool → default True
    # A malformed need never rejects the candidate: no adjustment fires.
    delta, consumed = ranking.art_direction_adjustment(req, _cand("a man portrait 3d render"))
    assert delta == 0.0 and consumed == {"people": False, "authenticity": False}


# ── J — legacy need ranks exactly as before (no art direction present) ───────────────────────

def test_J_legacy_need_backward_compatible():
    req = _requirement_from_need(_need_from_item(StockNeedItem(**_LEGACY)))
    assert not any(req.art_direction_fields().values())     # nothing received
    assert req.subject == "ocean resort sunset" and req.no_repeat is True
    intent = build_design_intent([_need_from_item(StockNeedItem(**_LEGACY))], None)
    cand = _cand("ocean resort sunset beach")
    # A legacy need applies ZERO art-direction adjustment → identical to the pre-Phase-1 relevance.
    delta, _ = ranking.art_direction_adjustment(req, cand)
    assert delta == 0.0


# ── INTEGRATION — art direction survives sourcing.source_images' normalization boundary ──────
# This is the boundary the earlier unit tests missed: sourcing.source_images REBUILDS each need into a
# `clean_needs` dict before calling image_intelligence.select_assets. We capture the exact dict that
# reaches select_assets and prove the art direction is still present there and all the way into the
# ImageRequirement — and that a legacy 6-field need still carries neutral values (unchanged behaviour).

def _run_sourcing_capture(monkeypatch, need_dicts):
    """Drive sourcing.source_images with the provider disabled (empty search) and capture the exact
    needs list handed to image_intelligence.select_assets — the real projection boundary."""
    import asyncio
    from backend.services.web_build_images import sourcing

    captured = {}

    async def fake_select(needs, context=None, provider_name=None):
        captured["needs"] = [dict(n) for n in needs]   # snapshot the select_assets input
        return []                                       # force the deterministic fallback path

    async def fake_search(query, provider, page, per_page, orientation):
        return {"results": [], "providers": {"pexels": "ok", "unsplash": "ok"}}

    monkeypatch.setattr(sourcing.image_intelligence, "is_enabled", lambda: True)
    monkeypatch.setattr(sourcing.image_intelligence, "select_assets", fake_select)
    monkeypatch.setattr(sourcing.stock, "availability", lambda: {"pexels": True, "unsplash": True})
    monkeypatch.setattr(sourcing.stock, "search", fake_search)
    asyncio.run(sourcing.source_images(need_dicts, None))
    return captured.get("needs")


def test_INTEGRATION_art_direction_survives_sourcing_into_select_assets(monkeypatch):
    need = _need_from_item(StockNeedItem(**_RICH))          # route projection
    passed = _run_sourcing_capture(monkeypatch, [need])     # ← through sourcing.source_images
    assert passed is not None and len(passed) == 1
    n = passed[0]
    # the art direction reached the select_assets input (previously dropped by clean_needs)
    assert n["role"] == "hero-signature"
    assert n["people"] == "avoid"
    assert n["authenticity"] == "authentic-photo-required"
    assert n["aspectRatio"] == "16:9"
    assert n["focalPoint"] == "center"
    assert n["negativeSpace"] is True
    assert n["loadingPriority"] == "eager"
    assert n["framing"] == "wide establishing"
    # …and it survives all the way into the ImageRequirement build_design_intent constructs
    intent = build_design_intent(passed, None)
    hero = intent.hero_image_requirement
    assert hero is not None
    assert hero.people == "avoid" and hero.authenticity == "authentic-photo-required" and hero.role == "hero-signature"


def test_INTEGRATION_legacy_need_unchanged_through_sourcing(monkeypatch):
    need = _need_from_item(StockNeedItem(**_LEGACY))
    passed = _run_sourcing_capture(monkeypatch, [need])
    assert passed is not None and len(passed) == 1
    n = passed[0]
    # base fields preserved exactly; art fields carried as neutral/empty (no behaviour change)
    assert n["slotId"] == "hero" and n["query"] == "ocean resort sunset" and n["required"] is True
    assert n["people"] == "" and n["authenticity"] == "" and n["role"] == "" and n["negativeSpace"] is False
    assert n["noRepeat"] is True
    req = build_design_intent(passed, None).hero_image_requirement
    assert req is not None and not any(req.art_direction_fields().values())


# ── M — no vision/model call exists in this phase ────────────────────────────────────────────

def test_M_no_vision_or_model_call_in_ranking_or_intent():
    # Prove no model/vision/provider CLIENT is imported or called in the ranking/intent modules (the
    # only Phase-1 additions). We check concrete import/call signatures, not the bare word "vision"
    # (comments legitimately reference the deferred Phase-2 vision pass).
    import inspect
    from backend.services.image_intelligence import ranking as rk
    from backend.services.image_intelligence import design_intent as di
    banned_signatures = (
        "import openai", "import anthropic", "google.generativeai", "genai",
        ".chat.completions", "responses.create", "images.generate",
        "import httpx", "import aiohttp", "import requests", "await client",
    )
    for mod in (rk, di):
        low = inspect.getsource(mod).lower()
        for sig in banned_signatures:
            assert sig not in low, f"{sig!r} must not appear in {mod.__name__}"
