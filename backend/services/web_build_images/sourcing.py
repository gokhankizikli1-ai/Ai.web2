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

from backend.services import image_intelligence
from backend.services.web_build_images import stock

logger = logging.getLogger(__name__)

# The SINGLE authoritative cap on sourced images per generation. It matches the HTTP
# surface (StockSourceBody.maxImages is bounded le=16) and is the only image-count
# limit — the Image Intelligence layer never caps again, it processes the bounded needs
# list it receives from here.
MAX_IMAGES = 16
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


async def _track_unsplash_downloads(download_locations: List[str]) -> None:
    """Fire Unsplash's required download event for SELECTED assets — best-effort, never raises."""
    if not download_locations:
        return
    try:
        await asyncio.gather(*(
            asyncio.to_thread(stock.track_download, "unsplash", dl) for dl in download_locations
        ), return_exceptions=True)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[STOCK_SRC] unsplash tracking failed: %s", type(exc).__name__)


# ── Shared uniqueness + provider-status helpers ───────────────────────────────
# A STABLE, provider-aware identifier used identically by the smart and deterministic
# paths so a photo chosen by one can never be re-selected by the other. Provider +
# provider image id when available (this is exactly the normalized row["id"] form,
# e.g. "pexels:123"), else the https URL. Both paths key off THIS, so they never
# compare row["id"] against providerImageId in incompatible formats.
def _uniqueness_key(provider: Optional[str], provider_image_id: Optional[str], url: Optional[str]) -> str:
    p = (provider or "").strip().lower()
    pid = (provider_image_id or "").strip()
    if p and pid:
        return f"{p}:{pid}"
    return (url or "").strip()


def _asset_key(asset: Dict[str, Any]) -> str:
    return _uniqueness_key(asset.get("provider"), asset.get("providerImageId"),
                           asset.get("url") or asset.get("thumbnailUrl"))


def _row_key(row: Dict[str, Any]) -> str:
    return _uniqueness_key(row.get("provider"), row.get("providerImageId"),
                           stock._https_only(row.get("previewUrl") or row.get("fullUrl")))


_STATUS_RANK = {"ok": 2, "error": 1, "unavailable": 0}


def _merge_status(current: str, incoming: str) -> str:
    """Keep the most informative provider status (ok > error > unavailable)."""
    return current if _STATUS_RANK.get(current, 0) >= _STATUS_RANK.get(incoming, 0) else incoming


def _smart_assets(
    selections: List[Any], alt_by_slot: Dict[str, str],
    used_ids: set, used_photographers: set,
) -> Dict[str, Dict[str, Any]]:
    """Project smart SelectedAssets into manifest assets, enforcing the SAME global
    uniqueness (image id + photographer) the deterministic pass uses. Each kept asset
    retains its intelligenceScore. Returns {slotId: asset}."""
    picked: Dict[str, Dict[str, Any]] = {}
    for sel in selections:
        asset = _asset_from_row(sel.slot_id, alt_by_slot.get(sel.slot_id, ""), sel.row)
        if not asset["url"]:
            continue
        key = _asset_key(asset)
        if not key or key in used_ids:
            continue  # smart shouldn't dup, but enforce globally to be safe
        asset["intelligenceScore"] = sel.score
        used_ids.add(key)
        ph = asset["photographerName"].strip().lower()
        if ph:
            used_photographers.add(ph)
        picked[sel.slot_id] = asset
    return picked


async def _select_deterministic(
    needs: List[Dict[str, Any]],
    used_ids: set,
    used_photographers: set,
    provider_status: Dict[str, str],
    cache: Optional[Dict[str, List[Dict[str, Any]]]] = None,
) -> Dict[str, Dict[str, Any]]:
    """Legacy search + first-unused selection for a SUBSET of needs.

    Shares the caller's `used_ids` / `used_photographers` (so it never re-picks a photo
    or photographer the smart pass already used) and updates `provider_status` with the
    real per-provider outcome. Uses a request-local search cache so identical queries hit
    the network once. Returns {slotId: asset}. Never raises."""
    if not needs:
        return {}
    if cache is None:
        cache = {}
    cache_lock = asyncio.Lock()
    sem = asyncio.Semaphore(_CONCURRENCY)

    async def search_need(need: Dict[str, Any]) -> List[Dict[str, Any]]:
        key = f"{need['query']}|{need.get('orientation') or ''}"
        async with cache_lock:
            if key in cache:
                return cache[key]
        async with sem:
            try:
                payload = await stock.search(need["query"], "all", 1, _PER_NEED_RESULTS, need.get("orientation"))
            except Exception as exc:  # noqa: BLE001 — never leak provider internals
                logger.warning("[STOCK_SRC] search failed: %s", type(exc).__name__)
                return []
        prov = payload.get("providers") or {}
        for name in ("pexels", "unsplash"):
            st = prov.get(name)
            if st:
                provider_status[name] = _merge_status(provider_status.get(name, "unavailable"), st)
        rows = payload.get("results") or []
        async with cache_lock:
            cache[key] = rows
        return rows

    results = await asyncio.gather(*(search_need(n) for n in needs), return_exceptions=True)

    picked: Dict[str, Dict[str, Any]] = {}
    for need, rows in zip(needs, results):
        if isinstance(rows, Exception) or not rows:
            continue
        chosen = None
        fallback = None
        for row in rows:
            rkey = _row_key(row)
            if not rkey or rkey in used_ids or not stock._https_only(row.get("previewUrl") or row.get("fullUrl")):
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
        asset = _asset_from_row(need["slotId"], need.get("altText", ""), chosen)
        if not asset["url"]:
            continue
        used_ids.add(_row_key(chosen))
        ph = asset["photographerName"].strip().lower()
        if ph:
            used_photographers.add(ph)
        picked[need["slotId"]] = asset
    return picked


async def source_images(
    needs: List[Dict[str, Any]],
    context: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Source one unique stock asset per need. Never raises. Returns:
      { status, assets, providers, warnings, requested, sourced, elapsedMs[, engine] }

    Flow (ENABLE_SMART_IMAGES on): context-aware smart selection runs first and MAY
    return a partial set; any slots it could not fill are completed by the deterministic
    legacy selection for THOSE slots only. Smart and fallback assets share one
    uniqueness/photographer space, a smart asset is never replaced by a legacy one,
    requested slot order is preserved, and Unsplash downloads are tracked exactly once.
    With the flag off (or smart empty) the full deterministic path runs — same algorithm
    and selection as before.
    """
    started = time.monotonic()
    avail = stock.availability()

    # Validate + cap the incoming needs (defence in depth — the caller already caps to
    # the authoritative MAX_IMAGES).
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
            # purpose/required drive the Image Intelligence query + ranking; harmless to
            # the deterministic path. Preserved here (previously dropped) so purpose-aware
            # search actually receives each slot's real role.
            "purpose": str(n.get("purpose") or "").strip().lower()[:40],
            "required": bool(n.get("required")),
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

    used_ids: set = set()
    used_photographers: set = set()
    provider_status: Dict[str, str] = {"pexels": "unavailable", "unsplash": "unavailable"}
    by_slot: Dict[str, Dict[str, Any]] = {}
    warnings: List[str] = []
    smart_slots: set = set()
    alt_by_slot = {n["slotId"]: n.get("altText", "") for n in clean_needs}

    # ── Smart pass (opt-in) — may return a PARTIAL selection; never raises here. ────
    if image_intelligence.is_enabled():
        try:
            selections = await image_intelligence.select_assets(clean_needs, context)
        except Exception as exc:  # noqa: BLE001 — fail open to the deterministic pass
            logger.warning("[STOCK_SRC] smart selection failed: %s", type(exc).__name__)
            selections = []
        if selections:
            smart_picked = _smart_assets(selections, alt_by_slot, used_ids, used_photographers)
            by_slot.update(smart_picked)
            smart_slots = set(smart_picked.keys())
            if smart_slots:
                # Smart searched every configured provider; reflect availability as ok.
                for name, ok in avail.items():
                    if ok:
                        provider_status[name] = _merge_status(provider_status[name], "ok")

    # ── Deterministic pass — ONLY for slots the smart pass did not fill. ───────────
    missing_needs = [n for n in clean_needs if n["slotId"] not in by_slot]
    fallback_picked: Dict[str, Dict[str, Any]] = {}
    if missing_needs:
        fallback_picked = await _select_deterministic(
            missing_needs, used_ids, used_photographers, provider_status,
        )
        by_slot.update(fallback_picked)

    # ── Assemble in REQUESTED slot order. ─────────────────────────────────────────
    assets: List[Dict[str, Any]] = [by_slot[n["slotId"]] for n in clean_needs if n["slotId"] in by_slot]

    # ── Unsplash usage tracking — SELECTED assets only, exactly once. ─────────────
    seen_dl: set = set()
    unsplash_tracks: List[str] = []
    for asset in assets:
        if asset.get("provider") == "unsplash":
            dl = asset.get("downloadLocation")
            if dl and dl not in seen_dl:
                seen_dl.add(dl)
                unsplash_tracks.append(dl)
    await _track_unsplash_downloads(unsplash_tracks)

    if len(assets) < len(clean_needs):
        warnings.append(f"sourced {len(assets)} of {len(clean_needs)} requested images")

    if smart_slots and fallback_picked:
        engine = "smart+fallback"
    elif smart_slots:
        engine = "smart"
    else:
        engine = "legacy"

    status = "ok" if assets else "no-results"
    elapsed = int((time.monotonic() - started) * 1000)
    logger.info(
        "[STOCK_SRC] engine=%s needs=%d smart=%d fallback=%d sourced=%d pexels=%s unsplash=%s elapsed_ms=%d",
        engine, len(clean_needs), len(smart_slots), len(fallback_picked), len(assets),
        provider_status["pexels"], provider_status["unsplash"], elapsed,
    )
    return {
        "status": status,
        "assets": assets,
        "providers": provider_status,
        "warnings": warnings,
        "requested": len(clean_needs),
        "sourced": len(assets),
        "elapsedMs": elapsed,
        "engine": engine,
    }


__all__ = ["source_images", "sanitize_query", "MAX_IMAGES", "MAX_NEED_QUERY"]
