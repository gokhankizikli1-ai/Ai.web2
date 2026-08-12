# coding: utf-8
"""Phase 1 — bounded pixel-level VISUAL rerank of high-impact photographic slots.

Proves the exit-gate properties WITHOUT any real network / provider SDK: a fake vision
provider is injected via ``provider_getter`` so the single multimodal call is simulated.

Verified here:
  * TOP-N only — the vision call inspects at most ``top_n`` candidates, never the pool.
  * High-impact gating — hero / hero-background / primary-about are eligible; gallery,
    illustrative, and decorative about tiles are NOT.
  * Metadata fallback / FAIL OPEN — provider missing, non-vision model, provider error,
    malformed reply, out-of-range index → the metadata winner (available[0]) is kept.
  * No candidate explosion — candidateCount never exceeds top_n; no stock search occurs.
  * Config flags default OFF and stay bounded.

Same importorskip convention as the sibling art-direction test (the package __init__
imports the stock provider → httpx at load time).
"""
from __future__ import annotations

import pytest

pytest.importorskip("httpx")      # image_intelligence.providers → web_build_images.stock → httpx

from backend.services.image_intelligence import config, visual_rerank
from backend.services.image_intelligence.design_intent import DesignIntent, ImageRequirement
from backend.services.image_intelligence.providers import ImageCandidate
from backend.services.image_intelligence.ranking import ScoredImage


# ── Fixtures ─────────────────────────────────────────────────────────────────────
def _scored(i: int, final: float) -> ScoredImage:
    cand = ImageCandidate(
        id=f"pexels:{i}", provider="pexels", provider_image_id=str(i),
        url=f"https://cdn/pexels/{i}.jpg", width=2000, height=1125,
        alt=f"candidate {i}", photographer_name=f"P{i}", raw={},
    )
    return ScoredImage(candidate=cand, breakdown={}, final_score=final)


def _intent() -> DesignIntent:
    return DesignIntent(industry="restaurant", brand_style="warm modern", emotional_tone="inviting")


def _hero_req(**over) -> ImageRequirement:
    base = dict(slot_id="hero", purpose="hero", orientation="landscape",
                subject="restaurant interior", role="hero-signature",
                people="avoid", authenticity="authentic-photo-required", required=True)
    base.update(over)
    return ImageRequirement(**base)


class _FakeResult:
    def __init__(self, content: str) -> None:
        self.content = content
        self.model = "gpt-4o"
        self.provider = "openai"


class _FakeProvider:
    """Records the request it was given so the test can assert candidate count / model."""

    supports_vision = True

    def __init__(self, content: str = '{"bestIndex": 0, "reason": "ok"}', *, raise_exc: Exception | None = None):
        self._content = content
        self._raise = raise_exc
        self.calls = 0
        self.last_request = None

    def model_supports_vision(self, model):  # noqa: D401 - mirrors the real provider API
        return bool(model) and str(model).lower().startswith("gpt-4o")

    async def chat_completion(self, request):
        self.calls += 1
        self.last_request = request
        if self._raise is not None:
            raise self._raise
        return _FakeResult(self._content)


def _getter(provider):
    return lambda name: provider


# ── High-impact gating ─────────────────────────────────────────────────────────────
def test_gating_hero_and_background_and_primary_about_are_eligible():
    assert visual_rerank.is_high_impact_slot(_hero_req()) is True
    assert visual_rerank.is_high_impact_slot(_hero_req(purpose="background", role="")) is True
    assert visual_rerank.is_high_impact_slot(
        ImageRequirement(slot_id="a", purpose="about", role="primary-about story", required=True)
    ) is True
    assert visual_rerank.is_high_impact_slot(
        ImageRequirement(slot_id="a", purpose="about", role="", required=True)
    ) is True


def test_gating_excludes_gallery_illustrative_and_decorative_about():
    assert visual_rerank.is_high_impact_slot(
        ImageRequirement(slot_id="g", purpose="gallery", role="gallery-tile")
    ) is False
    # explicitly illustrative/generatable → not a photographic decision
    assert visual_rerank.is_high_impact_slot(_hero_req(authenticity="illustrative-ok")) is False
    assert visual_rerank.is_high_impact_slot(_hero_req(authenticity="generatable")) is False
    # a decorative (not required) about tile is not high-impact
    assert visual_rerank.is_high_impact_slot(
        ImageRequirement(slot_id="a", purpose="about", role="", required=False)
    ) is False


# ── TOP-N only + successful rerank ──────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_reranks_to_model_choice_and_inspects_topn_only():
    provider = _FakeProvider('{"bestIndex": 2, "reason": "best framing"}')
    available = [_scored(i, final=90.0 - i) for i in range(5)]     # 5 available, metadata winner = index 0
    winner, diag = await visual_rerank.rerank_winner(
        _intent(), _hero_req(), available, top_n=3, provider_getter=_getter(provider),
    )
    # picked the model's choice within the top-3 shortlist
    assert winner.candidate.id == "pexels:2"
    assert diag["succeeded"] is True
    assert diag["visualRerankAttempted"] is True
    assert diag["selectedRankBefore"] == 2 and diag["selectedRankAfter"] == 0
    assert diag["reason"] == "reranked"
    # TOP-N only: candidateCount capped at top_n, and the request carried exactly 3 image blocks
    assert diag["candidateCount"] == 3
    image_blocks = [b for b in provider.last_request.messages[1].content if b.get("type") == "image_url"]
    assert len(image_blocks) == 3
    assert provider.calls == 1                                    # ONE multimodal call, not one-per-candidate


@pytest.mark.asyncio
async def test_confirming_metadata_winner_reports_no_change():
    provider = _FakeProvider('{"bestIndex": 0, "reason": "already best"}')
    available = [_scored(i, 90.0 - i) for i in range(3)]
    winner, diag = await visual_rerank.rerank_winner(
        _intent(), _hero_req(), available, top_n=3, provider_getter=_getter(provider),
    )
    assert winner.candidate.id == "pexels:0"
    assert diag["succeeded"] is True and diag["reason"] == "confirmed-metadata-winner"


# ── FAIL OPEN paths — always the metadata winner, never a raise ────────────────────
@pytest.mark.asyncio
async def test_fail_open_on_provider_error():
    provider = _FakeProvider(raise_exc=RuntimeError("boom"))
    available = [_scored(i, 90.0 - i) for i in range(3)]
    winner, diag = await visual_rerank.rerank_winner(
        _intent(), _hero_req(), available, top_n=3, provider_getter=_getter(provider),
    )
    assert winner.candidate.id == "pexels:0"                      # metadata winner preserved
    assert diag["succeeded"] is False and diag["reason"] == "provider-error"
    assert diag["visualRerankAttempted"] is True


@pytest.mark.asyncio
async def test_fail_open_on_malformed_verdict():
    provider = _FakeProvider("not json at all")
    available = [_scored(i, 90.0 - i) for i in range(3)]
    winner, diag = await visual_rerank.rerank_winner(
        _intent(), _hero_req(), available, top_n=3, provider_getter=_getter(provider),
    )
    assert winner.candidate.id == "pexels:0"
    assert diag["succeeded"] is False and diag["reason"] == "malformed-verdict"


@pytest.mark.asyncio
async def test_fail_open_on_out_of_range_index():
    provider = _FakeProvider('{"bestIndex": 9}')                  # out of the 0..2 shortlist
    available = [_scored(i, 90.0 - i) for i in range(3)]
    winner, diag = await visual_rerank.rerank_winner(
        _intent(), _hero_req(), available, top_n=3, provider_getter=_getter(provider),
    )
    assert winner.candidate.id == "pexels:0"
    assert diag["succeeded"] is False and diag["reason"] == "malformed-verdict"


@pytest.mark.asyncio
async def test_fail_open_when_model_not_vision_capable():
    provider = _FakeProvider('{"bestIndex": 1}')
    available = [_scored(i, 90.0 - i) for i in range(3)]
    winner, diag = await visual_rerank.rerank_winner(
        _intent(), _hero_req(), available, top_n=3,
        provider_getter=_getter(provider), model="text-only-model",
    )
    assert winner.candidate.id == "pexels:0"
    assert diag["reason"] == "vision-model-unavailable"
    assert provider.calls == 0                                    # never spent a call


@pytest.mark.asyncio
async def test_fail_open_when_provider_getter_raises():
    def boom(_name):
        raise RuntimeError("no provider")

    available = [_scored(i, 90.0 - i) for i in range(3)]
    winner, diag = await visual_rerank.rerank_winner(
        _intent(), _hero_req(), available, top_n=3, provider_getter=boom,
    )
    assert winner.candidate.id == "pexels:0"
    assert diag["reason"] == "provider-unavailable"


@pytest.mark.asyncio
async def test_insufficient_candidates_skips_call():
    provider = _FakeProvider('{"bestIndex": 0}')
    available = [_scored(0, 90.0)]                                # only one candidate → nothing to rerank
    winner, diag = await visual_rerank.rerank_winner(
        _intent(), _hero_req(), available, top_n=3, provider_getter=_getter(provider),
    )
    assert winner.candidate.id == "pexels:0"
    assert diag["reason"] == "insufficient-candidates"
    assert diag["visualRerankAttempted"] is False
    assert provider.calls == 0


# ── Config flags: OFF by default, bounded ──────────────────────────────────────────
def test_config_defaults_off_and_bounded(monkeypatch):
    monkeypatch.delenv("ENABLE_SMART_IMAGE_VISUAL_RERANK", raising=False)
    monkeypatch.delenv("SMART_IMAGE_VISUAL_RERANK_TOPN", raising=False)
    monkeypatch.delenv("SMART_IMAGE_VISUAL_RERANK_BUDGET", raising=False)
    assert config.visual_rerank_enabled() is False
    assert config.visual_rerank_topn() == 3
    assert config.visual_rerank_budget() == 2


def test_config_bounds_clamp(monkeypatch):
    monkeypatch.setenv("ENABLE_SMART_IMAGE_VISUAL_RERANK", "TRUE")
    monkeypatch.setenv("SMART_IMAGE_VISUAL_RERANK_TOPN", "99")
    monkeypatch.setenv("SMART_IMAGE_VISUAL_RERANK_BUDGET", "-5")
    assert config.visual_rerank_enabled() is True
    assert config.visual_rerank_topn() == 5                       # clamped to [2,5]
    assert config.visual_rerank_budget() == 0                     # clamped to [0,4]
    monkeypatch.setenv("SMART_IMAGE_VISUAL_RERANK_TOPN", "1")
    assert config.visual_rerank_topn() == 2


# ── BATCH visual selection (≥2 high-impact slots in ONE request) ──────────────────
def _about_req(**over) -> ImageRequirement:
    base = dict(slot_id="about", purpose="about", orientation="landscape",
                subject="chef portrait", role="primary-about storytelling",
                people="required", authenticity="authentic-photo-required", required=True)
    base.update(over)
    return ImageRequirement(**base)


def _slot(slot_id: str, req: ImageRequirement, n: int) -> tuple:
    # a top-N shortlist of n scored candidates whose ids are unique to this slot
    sl = []
    for i in range(n):
        c = ImageCandidate(id=f"{slot_id}:{i}", provider="pexels", provider_image_id=str(i),
                           url=f"https://cdn/{slot_id}/{i}.jpg", width=2000, height=1125,
                           alt=f"{slot_id} {i}", photographer_name=f"P{i}", raw={})
        sl.append(ScoredImage(candidate=c, breakdown={}, final_score=90.0 - i))
    return (slot_id, req, sl)


@pytest.mark.asyncio
async def test_batch_A_B_H_two_slots_one_provider_call():
    prov = _FakeProvider('{"slots":[{"slotId":"hero","bestIndex":2},{"slotId":"about","bestIndex":1}]}')
    slots = [_slot("hero", _hero_req(), 3), _slot("about", _about_req(), 3)]
    picks, diag = await visual_rerank.rerank_batch(_intent(), slots, top_n=3, provider_getter=_getter(prov))
    # B: both slots decided, A: exactly ONE provider round-trip
    assert picks["hero"] == 2 and picks["about"] == 1
    assert prov.calls == 1 and diag["providerCallCount"] == 1
    assert diag["visualRerankMode"] == "batch" and diag["eligibleSlotCount"] == 2 and diag["attemptedSlotCount"] == 2
    # H: top-N bound preserved — 3 + 3 candidate images in the single request
    assert diag["candidateCountTotal"] == 6
    images = [b for b in prov.last_request.messages[1].content if b.get("type") == "image_url"]
    assert len(images) == 6 and all(b["image_url"]["detail"] == "low" for b in images)
    assert diag["changedWinnerCount"] == 2 and diag["failedSlotCount"] == 0 and diag["succeeded"] is True


@pytest.mark.asyncio
async def test_batch_D_malformed_all_metadata_winners():
    prov = _FakeProvider("not json at all")
    slots = [_slot("hero", _hero_req(), 3), _slot("about", _about_req(), 3)]
    picks, diag = await visual_rerank.rerank_batch(_intent(), slots, top_n=3, provider_getter=_getter(prov))
    assert picks["hero"] is None and picks["about"] is None       # → caller keeps metadata winners
    assert diag["failedSlotCount"] == 2 and diag["succeeded"] is False and diag["reason"] == "malformed-verdict"


@pytest.mark.asyncio
async def test_batch_E_partial_only_affected_slot_fails_open():
    # hero valid, about missing from the reply → about nulls, hero unaffected.
    prov = _FakeProvider('{"slots":[{"slotId":"hero","bestIndex":1}]}')
    slots = [_slot("hero", _hero_req(), 3), _slot("about", _about_req(), 3)]
    picks, diag = await visual_rerank.rerank_batch(_intent(), slots, top_n=3, provider_getter=_getter(prov))
    assert picks["hero"] == 1 and picks["about"] is None
    assert diag["failedSlotCount"] == 1 and diag["succeeded"] is True


@pytest.mark.asyncio
async def test_batch_out_of_range_index_nulls_that_slot():
    prov = _FakeProvider('{"slots":[{"slotId":"hero","bestIndex":9},{"slotId":"about","bestIndex":0}]}')
    slots = [_slot("hero", _hero_req(), 3), _slot("about", _about_req(), 3)]
    picks, _ = await visual_rerank.rerank_batch(_intent(), slots, top_n=3, provider_getter=_getter(prov))
    assert picks["hero"] is None and picks["about"] == 0


@pytest.mark.asyncio
async def test_batch_fail_open_provider_unavailable_no_call():
    def boom(_name):
        raise RuntimeError("no provider")
    slots = [_slot("hero", _hero_req(), 3), _slot("about", _about_req(), 3)]
    picks, diag = await visual_rerank.rerank_batch(_intent(), slots, top_n=3, provider_getter=boom)
    assert picks["hero"] is None and picks["about"] is None
    assert diag["providerCallCount"] == 0 and diag["reason"] == "provider-unavailable"


@pytest.mark.asyncio
async def test_batch_thin_shortlist_slot_is_not_attempted():
    # a slot with <2 usable candidates is never judged (kept as metadata), others still batch.
    prov = _FakeProvider('{"slots":[{"slotId":"hero","bestIndex":1}]}')
    slots = [_slot("hero", _hero_req(), 3), _slot("about", _about_req(), 1)]
    picks, diag = await visual_rerank.rerank_batch(_intent(), slots, top_n=3, provider_getter=_getter(prov))
    assert picks["hero"] == 1 and picks["about"] is None
    assert diag["attemptedSlotCount"] == 1 and diag["failedSlotCount"] == 1


def test_batch_J_prompt_prioritizes_slot_brief_over_consistency():
    # J: the judge is instructed to satisfy each slot's OWN brief first and NEVER pick a semantically
    # weaker image just for cross-image consistency. (Deterministic proof of the obligation text.)
    p = visual_rerank._BATCH_SYSTEM_PROMPT.lower()
    assert "brief" in p
    assert "never choose a semantically weaker image" in p
    assert "consisten" in p            # consistency is only a tie-breaker, mentioned after the brief
    assert p.index("brief") < p.index("consisten")
