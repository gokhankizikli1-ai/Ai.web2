# coding: utf-8
"""
Tests for the deterministic metadata ranker + bounded query-variant support added to
the EXISTING stock-image sourcing service (backend/services/web_build_images/sourcing.py).

No network: stock.search / stock.availability are monkeypatched. No provider keys needed.
Covers: ranking by orientation/resolution/token-overlap, junk penalty, determinism,
cross-slot dedup, photographer diversity, weak-drop (optional vs required), variant
sanitation + bounded fallback, legacy 6-field backward compatibility, diagnostics, and
fail-open behavior.
"""
from __future__ import annotations

import asyncio

import pytest

from backend.services.web_build_images import sourcing


def _row(pid, w, h, alt, url=None, photog="A", provider="pexels"):
    u = url or f"https://cdn/{provider}/{pid}.jpg"
    return {
        "provider": provider, "providerImageId": str(pid), "id": f"{provider}:{pid}",
        "previewUrl": u, "fullUrl": u, "thumbnailUrl": f"https://cdn/{provider}/{pid}-t.jpg",
        "width": w, "height": h, "alt": alt, "photographerName": photog,
        "photographerUrl": "https://cdn/p", "providerPageUrl": "https://cdn/page",
        "attributionText": "Photo", "downloadLocation": None,
    }


def _need(slot="hero", query="ocean resort sunset", orientation="landscape", purpose="hero", required=True, variants=None):
    return {"slotId": slot, "query": query, "orientation": orientation, "purpose": purpose,
            "required": required, "queryVariants": variants or []}


def _patch_search(monkeypatch, rows_by_query, avail=("ok", "ok")):
    monkeypatch.setattr(sourcing.stock, "availability", lambda: {"pexels": avail[0] == "ok", "unsplash": avail[1] == "ok"})

    async def fake_search(query, provider, page, per_page, orientation):
        rows = rows_by_query.get(query, [])
        return {"results": rows, "providers": {"pexels": "ok" if rows else "error", "unsplash": "ok" if rows else "error"}}

    monkeypatch.setattr(sourcing.stock, "search", fake_search)


# ── Ranker unit tests ─────────────────────────────────────────────────────────
def test_ranker_prefers_suitable_landscape_over_first_result():
    need = _need()
    rows = [
        _row("1", 500, 900, "portrait person", photog="A"),          # portrait, wrong for landscape hero
        _row("2", 2000, 1125, "ocean resort sunset beach", photog="B"),  # landscape hi-res + token overlap
    ]
    chosen, score = sourcing._pick_best(need, rows, set(), set(), {})
    assert chosen["providerImageId"] == "2"
    assert sourcing._confidence(score) == "high"


def test_ranker_is_deterministic():
    need = _need()
    rows = [_row("1", 2000, 1125, "ocean resort sunset"), _row("2", 1800, 1000, "ocean beach")]
    a = sourcing._pick_best(need, list(rows), set(), set(), {})
    b = sourcing._pick_best(need, list(rows), set(), set(), {})
    assert a[0]["providerImageId"] == b[0]["providerImageId"] and a[1] == b[1]


def test_ranker_penalizes_junk_and_low_resolution():
    need = _need()
    good = _row("2", 1900, 1080, "ocean resort sunset")
    junk = _row("1", 1900, 1080, "ocean resort", url="https://cdn/company-logo.jpg")
    assert sourcing._score_candidate(need, good, 0) > sourcing._score_candidate(need, junk, 0)
    lowres = _row("3", 200, 120, "ocean resort sunset")
    assert sourcing._score_candidate(need, good, 0) > sourcing._score_candidate(need, lowres, 0)


def test_pick_best_respects_cross_slot_dedup():
    need = _need()
    rows = [_row("1", 2000, 1125, "ocean resort sunset")]
    used = {sourcing._row_key(rows[0])}
    chosen, _ = sourcing._pick_best(need, rows, used, set(), {})
    assert chosen is None   # the only candidate is already used elsewhere


def test_weak_optional_slot_dropped_but_required_kept():
    # A single very-wrong candidate (portrait, tiny, no overlap) for a landscape slot.
    weak = [_row("1", 200, 400, "unrelated abstract", photog="A")]
    opt = _need(slot="g1", purpose="gallery", required=False)
    chosen_opt, score_opt = sourcing._pick_best(opt, list(weak), set(), set(), {})
    assert chosen_opt is None                      # optional weak → dropped
    req = _need(slot="hero", purpose="hero", required=True)
    chosen_req, _ = sourcing._pick_best(req, list(weak), set(), set(), {})
    assert chosen_req is not None                  # required → keep best available (coverage floor)


# ── Variant sanitation ────────────────────────────────────────────────────────
def test_clean_variants_sanitizes_dedupes_caps_and_drops_primary():
    out = sourcing._clean_variants(
        ["ocean resort sunset", "  ocean   view  ", "ocean view", "https://x.com #FF0", "a", "x", "y", "z"],
        primary="ocean resort sunset",
    )
    assert "ocean resort sunset" not in out          # equal to primary → dropped
    assert out.count("ocean view") <= 1              # deduped
    assert all("://" not in v and "#" not in v and "FF0" not in v for v in out)
    assert len(out) <= 3                              # capped


def test_clean_variants_ignores_malformed():
    assert sourcing._clean_variants(None, "q") == []
    assert sourcing._clean_variants("not a list", "q") == []
    assert sourcing._clean_variants([1, {}, None, ""], "q") == []


# ── End-to-end via source_images (monkeypatched providers) ─────────────────────
def test_legacy_six_field_request_still_works_and_ranks(monkeypatch):
    _patch_search(monkeypatch, {"ocean resort sunset": [
        _row("1", 500, 900, "portrait"), _row("2", 2000, 1125, "ocean resort sunset"),
    ]})
    needs = [{"slotId": "hero", "query": "ocean resort sunset", "orientation": "landscape",
              "purpose": "hero", "required": True, "altText": "hero"}]   # legacy 6-field (no variants)
    out = asyncio.run(sourcing.source_images(needs))
    assert out["status"] == "ok" and out["sourced"] == 1
    assert out["assets"][0]["providerImageId"] == "2"                    # ranked, not first
    assert out["assets"][0]["selectionConfidence"] in ("high", "medium", "low")
    assert out["intelligence"]["deterministicRanked"] == 1
    assert out["intelligence"]["smartImagesEnabled"] is False


def test_query_variants_used_as_bounded_fallback_for_required(monkeypatch):
    # Primary returns nothing; the variant returns a good landscape image.
    _patch_search(monkeypatch, {
        "primary query": [],
        "fallback variant": [_row("9", 2000, 1125, "great landscape")],
    })
    needs = [{"slotId": "hero", "query": "primary query", "orientation": "landscape",
              "purpose": "hero", "required": True, "altText": "h",
              "queryVariants": ["fallback variant", "fallback variant", "primary query"]}]
    out = asyncio.run(sourcing.source_images(needs))
    assert out["sourced"] == 1 and out["assets"][0]["providerImageId"] == "9"
    assert out["intelligence"]["variantSearches"] == 1                  # bounded, one variant used
    assert out["intelligence"]["variantSearches"] <= out["intelligence"]["variantSearchBudget"]


def test_malformed_variants_are_ignored(monkeypatch):
    _patch_search(monkeypatch, {"office": [_row("1", 1900, 1080, "office desk")]})
    needs = [{"slotId": "s", "query": "office", "orientation": "landscape", "purpose": "gallery",
              "required": True, "altText": "a", "queryVariants": [123, None, {"x": 1}]}]
    out = asyncio.run(sourcing.source_images(needs))            # must not raise
    assert out["status"] == "ok" and out["sourced"] == 1


def test_fail_open_when_no_providers(monkeypatch):
    monkeypatch.setattr(sourcing.stock, "availability", lambda: {"pexels": False, "unsplash": False})
    out = asyncio.run(sourcing.source_images([{"slotId": "s", "query": "q", "orientation": "landscape", "required": True}]))
    assert out["status"] == "no-providers" and out["assets"] == []


def test_response_shape_is_backward_compatible(monkeypatch):
    _patch_search(monkeypatch, {"office": [_row("1", 1900, 1080, "office")]})
    out = asyncio.run(sourcing.source_images([{"slotId": "s", "query": "office", "orientation": "landscape", "required": True, "altText": "a"}]))
    for key in ("status", "assets", "providers", "warnings", "requested", "sourced", "elapsedMs", "engine"):
        assert key in out                                          # no legacy field removed
    a = out["assets"][0]
    for key in ("slotId", "provider", "providerImageId", "url", "altText", "attributionText", "photographerName"):
        assert key in a                                            # attribution + identity preserved


# ── Route-level (TestClient) backward compatibility ────────────────────────────
def test_route_accepts_legacy_and_variant_requests(client, monkeypatch):
    _patch_search(monkeypatch, {"ocean resort": [_row("1", 2000, 1125, "ocean resort")]})
    # legacy 6-field
    r1 = client.post("/v2/web-build/images/stock/source",
                     json={"needs": [{"slotId": "hero", "query": "ocean resort", "orientation": "landscape",
                                       "purpose": "hero", "required": True, "altText": "h"}], "maxImages": 4})
    assert r1.status_code == 200 and r1.json()["sourced"] == 1
    # with queryVariants (new optional field)
    r2 = client.post("/v2/web-build/images/stock/source",
                     json={"needs": [{"slotId": "hero", "query": "ocean resort", "orientation": "landscape",
                                       "purpose": "hero", "required": True, "altText": "h",
                                       "queryVariants": ["seaside resort", "beach hotel"]}], "maxImages": 4})
    assert r2.status_code == 200 and r2.json()["sourced"] == 1
    # unknown extra field is ignored (lenient schema) — must not 422
    r3 = client.post("/v2/web-build/images/stock/source",
                     json={"needs": [{"slotId": "hero", "query": "ocean resort", "somethingNew": 1}]})
    assert r3.status_code == 200
