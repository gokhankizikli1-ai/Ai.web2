# coding: utf-8
"""
Web Build — generation-time stock image SOURCING orchestration (Phase 14K.4).

Given a small, pre-planned list of "image needs" (one per generated image slot),
this service turns them into a normalized manifest of REAL, license-cleared stock
photographs sourced from Pexels + Unsplash. It reuses the existing provider
abstraction in `stock.py` (keys stay server-side; images are hotlinked from the
provider CDNs, never rehosted or proxied).

Responsibilities:
  • sanitize + bound each slot query (never trust the caller; never a raw prompt);
  • search providers in parallel with a small concurrency cap + a request-local
    dedupe cache so identical queries hit the network once;
  • select ONE unique asset per slot deterministically — avoiding repeated image
    ids and repeated photographers where alternatives exist;
  • trigger Unsplash's required download event server-side for SELECTED assets
    only (official usage rule — not for merely viewing search results);
  • degrade honestly: one provider failing never fails the other, both failing
    yields an empty manifest (generation still proceeds), and nothing here raises.

Only safe operational metadata is logged (slot counts, provider status, elapsed);
never the query text, never key material.
"""
from __future__ import annotations

import asyncio
import logging
import re
import time
from typing import Any, Dict, List, Optional

from backend.services.web_build_images import stock

logger = logging.getLogger(__name__)

MAX_IMAGES = 8            # hard cap on sourced images per generation
MAX_NEED_QUERY = 120     # query length cap (mirrors stock.MAX_QUERY)
_PER_NEED_RESULTS = 15   # results fetched per slot (headroom for de-dup)
_CONCURRENCY = 4         # parallel provider searches
_ALLOWED_ORIENTATION = {"landscape", "portrait", "square"}
_WS = re.compile(r"\s+")
# Keep letters/numbers/spaces and a few safe separators; drop everything else so a
# query can never smuggle operators, markup or secrets into a provider request.
_QUERY_STRIP = re.compile(r"[^0-9A-Za-zÀ-ɏЀ-ӿ\s\-&',]")


def sanitize_query(raw: Optional[str]) -> str:
    """Normalize + bound a slot query. Returns '' when nothing usable remains."""
    if not raw:
        return ""
    cleaned = _QUERY_STRIP.sub(" ", str(raw))
    cleaned = _WS.sub(" ", cleaned).strip()
    if len(cleaned) < 2:
        return ""
    return cleaned[:MAX_NEED_QUERY]


def _orientation(value: Optional[str]) -> Optional[str]:
    return value if value in _ALLOWED_ORIENTATION else None


def _asset_from_row(slot_id: str, alt: str, row: Dict[str, Any]) -> Dict[str, Any]:
    """Project a normalized stock row into a persisted manifest asset."""
    url = stock._https_only(row.get("previewUrl") or row.get("fullUrl") or row.get("thumbnailUrl"))
    return {
        "slotId": slot_id,
        "provider": row.get("provider"),
        "providerImageId": str(row.get("providerImageId") or ""),
        "url": url,
        "thumbnailUrl": stock._https_only(row.get("thumbnailUrl")) or url,
        "photographerName": (row.get("photographerName") or "").strip() or "Unknown",
        "photographerUrl": stock._https_only(row.get("photographerUrl")) or None,
        "providerPageUrl": stock._https_only(row.get("providerPageUrl")) or "",
        "downloadLocation": stock._https_only(row.get("downloadLocation")) or None,
        "attributionText": (row.get("attributionText") or "").strip(),
        "altText": (alt or "").strip()[:200],
        "width": row.get("width"),
        "height": row.get("height"),
    }


async def source_images(needs: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Source one unique stock asset per need. Never raises. Returns:
      { status, assets, providers, warnings, requested, sourced, elapsedMs }
    """
    started = time.monotonic()
    avail = stock.availability()
    warnings: List[str] = []

    # Validate + cap the incoming needs (defence in depth — the caller already caps).
    clean_needs: List[Dict[str, Any]] = []
    for n in (needs or [])[: MAX_IMAGES * 2]:
        if not isinstance(n, dict):
            continue
        q = sanitize_query(n.get("query"))
        slot_id = str(n.get("slotId") or "").strip()[:120]
        if not q or not slot_id:
            continue
        clean_needs.append({
            "slotId": slot_id,
            "query": q,
            "orientation": _orientation(n.get("orientation")),
            "altText": str(n.get("altText") or "").strip()[:200],
        })
        if len(clean_needs) >= MAX_IMAGES:
            break

    if not avail["pexels"] and not avail["unsplash"]:
        return {
            "status": "no-providers",
            "assets": [], "providers": {"pexels": "unavailable", "unsplash": "unavailable"},
            "warnings": ["no stock providers are configured"],
            "requested": len(clean_needs), "sourced": 0,
            "elapsedMs": int((time.monotonic() - started) * 1000),
        }
    if not clean_needs:
        return {
            "status": "empty", "assets": [],
            "providers": {k: ("ok" if v else "unavailable") for k, v in avail.items()},
            "warnings": ["no valid image needs"], "requested": 0, "sourced": 0,
            "elapsedMs": int((time.monotonic() - started) * 1000),
        }

    # Request-local dedupe cache: identical (query, orientation) → one search.
    cache: Dict[str, List[Dict[str, Any]]] = {}
    cache_lock = asyncio.Lock()
    sem = asyncio.Semaphore(_CONCURRENCY)
    provider_status: Dict[str, str] = {"pexels": "unavailable", "unsplash": "unavailable"}

    async def search_need(need: Dict[str, Any]) -> List[Dict[str, Any]]:
        key = f"{need['query']}|{need['orientation'] or ''}"
        async with cache_lock:
            if key in cache:
                return cache[key]
        async with sem:
            try:
                payload = await stock.search(need["query"], "all", 1, _PER_NEED_RESULTS, need["orientation"])
            except Exception as exc:  # noqa: BLE001 — never leak provider internals
                logger.warning("[STOCK_SRC] search failed: %s", type(exc).__name__)
                return []
        prov = payload.get("providers") or {}
        for name in ("pexels", "unsplash"):
            st = prov.get(name)
            if st and provider_status.get(name) != "ok":
                provider_status[name] = st
        rows = payload.get("results") or []
        async with cache_lock:
            cache[key] = rows
        return rows

    results = await asyncio.gather(*(search_need(n) for n in clean_needs), return_exceptions=True)

    # Deterministic selection: first unused image, preferring an unused photographer.
    used_ids: set = set()
    used_photographers: set = set()
    assets: List[Dict[str, Any]] = []
    unsplash_tracks: List[str] = []

    for need, rows in zip(clean_needs, results):
        if isinstance(rows, Exception) or not rows:
            continue
        chosen = None
        fallback = None
        for row in rows:
            rid = row.get("id") or row.get("previewUrl")
            if not rid or rid in used_ids or not stock._https_only(row.get("previewUrl") or row.get("fullUrl")):
                continue
            if fallback is None:
                fallback = row
            photographer = (row.get("photographerName") or "").strip().lower()
            if photographer and photographer in used_photographers:
                continue
            chosen = row
            break
        chosen = chosen or fallback
        if not chosen:
            continue
        asset = _asset_from_row(need["slotId"], need["altText"], chosen)
        if not asset["url"]:
            continue
        used_ids.add(chosen.get("id") or chosen.get("previewUrl"))
        ph = asset["photographerName"].strip().lower()
        if ph:
            used_photographers.add(ph)
        if asset["provider"] == "unsplash" and asset["downloadLocation"]:
            unsplash_tracks.append(asset["downloadLocation"])
        assets.append(asset)

    # Unsplash usage tracking — SELECTED assets only, server-side, best-effort.
    if unsplash_tracks:
        try:
            await asyncio.gather(*(
                asyncio.to_thread(stock.track_download, "unsplash", dl) for dl in unsplash_tracks
            ), return_exceptions=True)
        except Exception as exc:  # noqa: BLE001
            logger.warning("[STOCK_SRC] unsplash tracking failed: %s", type(exc).__name__)

    if len(assets) < len(clean_needs):
        warnings.append(f"sourced {len(assets)} of {len(clean_needs)} requested images")

    status = "ok" if assets else "no-results"
    elapsed = int((time.monotonic() - started) * 1000)
    logger.info(
        "[STOCK_SRC] needs=%d sourced=%d pexels=%s unsplash=%s elapsed_ms=%d",
        len(clean_needs), len(assets), provider_status["pexels"], provider_status["unsplash"], elapsed,
    )
    return {
        "status": status,
        "assets": assets,
        "providers": provider_status,
        "warnings": warnings,
        "requested": len(clean_needs),
        "sourced": len(assets),
        "elapsedMs": elapsed,
    }


__all__ = ["source_images", "sanitize_query", "MAX_IMAGES", "MAX_NEED_QUERY"]
