# coding: utf-8
"""
Image Intelligence — the smart visual-asset selection layer for the Web Builder.

    User prompt → Website Analyzer → Design Intent → Image Intelligence Service
      → Image Search Provider → Image Ranking Engine → Selected Assets → Generator

This package is the "Image Intelligence Service" box in that flow. Its public entry
point, :func:`select_assets`, turns a per-slot image-needs plan (+ optional design
context) into the best-ranked, license-cleared, de-duplicated asset per slot.

It is gated by ``ENABLE_SMART_IMAGES`` (see :mod:`.config`) and is used ONLY on the
smart path; the caller keeps its existing deterministic selection for the default
path and as the fail-open fallback. Nothing here raises to the caller.

Public API:
    is_enabled()                     — is the smart path turned on?
    build_design_intent(...)         — assemble the Design Intent object
    select_assets(...)               — intent → provider → ranking → selected rows
    ImageRankingEngine, DesignIntent, ImageCandidate, ImageProvider, ...
"""
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from backend.services.image_intelligence.config import is_enabled, load_weights
from backend.services.image_intelligence.design_intent import (
    DesignIntent, ImageRequirement, build_design_intent,
)
from backend.services.image_intelligence.providers import (
    ImageCandidate, ImageProvider, LicenseResult, StockImageProvider,
    get_provider, register_provider, search_licensed,
)
from backend.services.image_intelligence.query_builder import build_search_query
from backend.services.image_intelligence.ranking import (
    ImageRankingEngine, ScoredImage, register_scorer,
)

logger = logging.getLogger(__name__)

# When two top candidates score within this margin, prefer the one whose photographer
# hasn't been used yet — image diversity for free, without dropping a clearly better shot.
_DIVERSITY_MARGIN = 6.0
_SEARCH_CONCURRENCY = 4
# NOTE: there is intentionally NO image-count cap here. The authoritative bound lives in
# the caller (web_build_images.sourcing.MAX_IMAGES), which trims the needs list before it
# reaches this layer; capping again would silently truncate a validly larger request.


@dataclass
class SelectedAsset:
    """One slot's winning candidate plus its transparent score breakdown."""

    slot_id: str
    candidate: ImageCandidate
    score: Dict[str, float]

    @property
    def row(self) -> Dict[str, Any]:
        """The original provider row (for the caller's existing manifest projection)."""
        return self.candidate.raw


async def select_assets(
    needs: List[Dict[str, Any]],
    context: Optional[Dict[str, Any]] = None,
    provider_name: Optional[str] = None,
) -> List[SelectedAsset]:
    """Rank and select the best license-cleared asset for each image need.

    Fully self-contained: builds the Design Intent, searches the provider once per
    unique (query, orientation), ranks candidates with the :class:`ImageRankingEngine`,
    and picks a unique, photographer-diverse winner per slot. Returns an empty list on
    any failure so the caller can fall back to its deterministic path. Never raises.
    """
    try:
        # Optional Visual → image context enrichment (ENABLE_VISUAL_IMAGE_CONTEXT,
        # default off). A strict no-op when the flag is off: it returns `context`
        # unchanged, so the Design Intent — and therefore search/ranking — is identical.
        from backend.services.image_intelligence import visual_image_context
        context = visual_image_context.enrich_design_context(context)

        intent = build_design_intent(needs, context)
        # Process EVERY requirement the (already-bounded) caller sent — no local cap.
        requirements = intent.all_requirements()
        if not requirements:
            return []

        provider = get_provider(provider_name)
        engine = ImageRankingEngine(load_weights())

        # Context-aware DISCOVERY: search the provider with a query built from the slot
        # subject + Design Intent + purpose + orientation (not the bare subject), so the
        # candidate pool the ranking engine scores is already on-brand. The cache key is
        # the FINAL contextual query + orientation, so identical final searches still
        # share one provider request while different purposes get distinct pools.
        cache: Dict[str, List[ImageCandidate]] = {}
        cache_lock = asyncio.Lock()
        sem = asyncio.Semaphore(_SEARCH_CONCURRENCY)

        async def candidates_for(req: ImageRequirement) -> List[ImageCandidate]:
            query = build_search_query(intent, req)
            if not query:
                return []
            key = f"{query.strip().lower()}|{req.orientation}"
            async with cache_lock:
                if key in cache:
                    return cache[key]
            async with sem:
                found = await search_licensed(provider, query, req)
            async with cache_lock:
                cache[key] = found
            return found

        ranked_per_req = await asyncio.gather(
            *(_rank_req(engine, intent, req, candidates_for) for req in requirements),
            return_exceptions=True,
        )

        # Deterministic cross-slot selection: best unused candidate, preferring an
        # unused photographer when it costs little (within the diversity margin).
        used_ids: set = set()
        used_photographers: set = set()
        selections: List[SelectedAsset] = []
        for req, ranked in zip(requirements, ranked_per_req):
            if isinstance(ranked, Exception) or not ranked:
                continue
            chosen = _pick(ranked, used_ids, used_photographers)
            if chosen is None:
                continue
            cand = chosen.candidate
            used_ids.add(cand.id)
            photographer = cand.photographer_name.strip().lower()
            if photographer:
                used_photographers.add(photographer)
            selections.append(SelectedAsset(slot_id=req.slot_id, candidate=cand, score=chosen.as_metadata()))

        return selections
    except Exception as exc:  # noqa: BLE001 — smart path must never break generation
        logger.warning("[IMG_INTEL] select_assets failed: %s", type(exc).__name__)
        return []


async def _rank_req(engine, intent, req, candidates_for) -> List[ScoredImage]:
    candidates = await candidates_for(req)
    return engine.rank(intent, req, candidates)


def _pick(ranked: List[ScoredImage], used_ids: set, used_photographers: set) -> Optional[ScoredImage]:
    """Best unused candidate, preferring an unused photographer within the score margin."""
    available = [s for s in ranked if s.candidate.id not in used_ids]
    if not available:
        return None
    best = available[0]
    for scored in available:
        if best.final_score - scored.final_score > _DIVERSITY_MARGIN:
            break  # remaining candidates are meaningfully worse — stop looking
        photographer = scored.candidate.photographer_name.strip().lower()
        if not photographer or photographer not in used_photographers:
            return scored
    return best


__all__ = [
    "is_enabled", "build_design_intent", "select_assets", "SelectedAsset",
    "DesignIntent", "ImageRequirement", "ImageCandidate", "ImageProvider",
    "LicenseResult", "StockImageProvider", "ImageRankingEngine", "ScoredImage",
    "get_provider", "register_provider", "register_scorer", "load_weights",
]
