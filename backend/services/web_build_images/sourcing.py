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
from typing import Any, Dict, List, Optional, Tuple

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


_MAX_VARIANTS = 3
_URL_HEX = re.compile(r"https?://\S+|#[0-9A-Fa-f]{3,8}\b")


def _clean_variants(raw: Any, primary: str) -> List[str]:
    """Sanitize + dedupe up to _MAX_VARIANTS fallback query variants. Drops empties,
    anything equal to the primary, and duplicates. Ignores malformed input (fail-safe)."""
    if not isinstance(raw, (list, tuple)):
        return []
    out: List[str] = []
    seen = {primary.strip().lower()}
    for item in raw:
        if len(out) >= _MAX_VARIANTS:
            break
        # Defense-in-depth: drop any URL/hex tokens before the shared query sanitizer
        # (the frontend already sanitizes, but variants are external input).
        pre = _URL_HEX.sub(" ", item) if isinstance(item, str) else ""
        v = sanitize_query(pre)
        low = v.lower()
        if v and low not in seen:
            seen.add(low)
            out.append(v)
    return out


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


# ── Deterministic metadata ranking (DEFAULT path; ZERO extra provider calls) ──────
# The legacy path already fetches _PER_NEED_RESULTS candidates per slot but previously
# took the first-unused one. This ranks those SAME candidates using only truthful,
# already-captured metadata (orientation, resolution, aspect, description token overlap,
# provider order) so each slot gets the most suitable of the images we already fetched.
# It is NOT the flag-gated Image-Intelligence engine (that stays as-is); it is a small,
# always-on, deterministic tie-breaker inside the existing legacy selection. No new
# provider calls, no new flag, no vision/model call.
_HERO_MIN_MP = 1.4          # hero/background want ≥ ~1.4 megapixels
_MIN_MP = 0.4               # other slots want ≥ ~0.4 megapixels
_WEAK_FLOOR = 6.0           # below this, an OPTIONAL slot is left empty rather than shipping junk
_PHOTOG_MARGIN = 8.0        # prefer an unused photographer within this score margin (diversity)
_MAX_VARIANT_SEARCHES = 4   # hard cap on fallback-variant provider searches per build
_JUNK_RE = re.compile(r"placeholder|/logo|logo\.|\bicon\b|sprite|watermark|favicon", re.I)
_TOKEN_RE = re.compile(r"[a-z0-9]+")


def _tokens(text: Optional[str]) -> set:
    return {t for t in _TOKEN_RE.findall((text or "").lower()) if len(t) > 2}


def _cand_orientation(w: Any, h: Any) -> Optional[str]:
    try:
        w = int(w or 0); h = int(h or 0)
    except (TypeError, ValueError):
        return None
    if w <= 0 or h <= 0:
        return None
    if w >= h * 1.15:
        return "landscape"
    if h >= w * 1.15:
        return "portrait"
    return "square"


def _score_candidate(need: Dict[str, Any], row: Dict[str, Any], idx: int) -> float:
    """Deterministic suitability score from AVAILABLE metadata only. Higher = better.
    Never claims visual understanding — only orientation, resolution, aspect, description
    token overlap and provider result order (all truthful/derivable)."""
    score = 0.0
    try:
        w = int(row.get("width") or 0); h = int(row.get("height") or 0)
    except (TypeError, ValueError):
        w = h = 0
    alt = str(row.get("alt") or row.get("altText") or "")
    url = stock._https_only(row.get("previewUrl") or row.get("fullUrl")) or ""
    purpose = need.get("purpose") or ""
    want = need.get("orientation")
    hero = purpose in ("hero", "background")
    if _JUNK_RE.search(url) or _JUNK_RE.search(alt):
        score -= 50.0
    ori = _cand_orientation(w, h)
    if want and ori:
        if ori == want:
            score += 25.0
        elif want == "landscape" and ori == "portrait":
            score -= 30.0            # unusable crop for a wide hero
        elif want == "portrait" and ori == "landscape":
            score -= 20.0
        else:
            score -= 6.0
    if w and h:
        ar = w / h
        if want == "landscape" and ar >= 1.4:
            score += 10.0
        elif want == "landscape" and ar < 1.1:
            score -= 10.0
    mp = (w * h) / 1_000_000.0 if (w and h) else 0.0
    floor = _HERO_MIN_MP if hero else _MIN_MP
    if mp:
        score += (min(10.0, 4.0 + (mp - floor)) if mp >= floor else -min(18.0, (floor - mp) * 12.0))
    overlap = len(( _tokens(need.get("query")) | _tokens(need.get("altText")) ) & _tokens(alt))
    score += min(24.0, overlap * 6.0)
    score += max(0.0, 8.0 - idx * 0.5)   # provider relevance order (earlier ⇒ more relevant)
    return score


def _confidence(score: float) -> str:
    return "high" if score >= 55.0 else ("medium" if score >= 30.0 else "low")


def _pick_best(
    need: Dict[str, Any], rows: List[Dict[str, Any]],
    used_ids: set, used_photographers: set, stats: Dict[str, int],
) -> Tuple[Optional[Dict[str, Any]], float]:
    """Rank the already-fetched candidates and return the best unused, suitable one.
    Preserves cross-slot uniqueness + photographer diversity. Leaves an OPTIONAL slot
    empty when every candidate is weak (Phase 4); a REQUIRED slot always keeps its best."""
    scored: List[Tuple[float, int, Dict[str, Any]]] = []
    for idx, row in enumerate(rows):
        rkey = _row_key(row)
        if not rkey or rkey in used_ids:
            continue
        if not stock._https_only(row.get("previewUrl") or row.get("fullUrl")):
            continue
        scored.append((_score_candidate(need, row, idx), idx, row))
        stats["candidatesEvaluated"] = stats.get("candidatesEvaluated", 0) + 1
    if not scored:
        return None, 0.0
    scored.sort(key=lambda t: (-t[0], t[1]))
    top_score = scored[0][0]
    if not need.get("required") and top_score < _WEAK_FLOOR:
        stats["weakDropped"] = stats.get("weakDropped", 0) + 1
        return None, top_score
    chosen, chosen_score = scored[0][2], top_score
    for s, _idx, row in scored:        # photographer diversity within the margin
        if top_score - s > _PHOTOG_MARGIN:
            break
        ph = (row.get("photographerName") or "").strip().lower()
        if not ph or ph not in used_photographers:
            chosen, chosen_score = row, s
            break
    return chosen, chosen_score


async def _select_deterministic(
    needs: List[Dict[str, Any]],
    used_ids: set,
    used_photographers: set,
    provider_status: Dict[str, str],
    cache: Optional[Dict[str, List[Dict[str, Any]]]] = None,
    stats: Optional[Dict[str, int]] = None,
) -> Dict[str, Dict[str, Any]]:
    """Legacy search + METADATA-RANKED selection for a SUBSET of needs.

    Shares the caller's `used_ids` / `used_photographers` (so it never re-picks a photo
    or photographer the smart pass already used) and updates `provider_status` with the
    real per-provider outcome. Uses a request-local search cache so identical queries hit
    the network once. Ranks the fetched candidates deterministically (no extra calls). A
    REQUIRED slot whose PRIMARY query returned nothing may try ONE bounded fallback
    variant. Returns {slotId: asset}. Never raises."""
    if not needs:
        return {}
    if cache is None:
        cache = {}
    if stats is None:
        stats = {}
    cache_lock = asyncio.Lock()
    sem = asyncio.Semaphore(_CONCURRENCY)
    variant_budget = {"left": _MAX_VARIANT_SEARCHES}

    async def _one_search(query: str, orientation: Optional[str]) -> List[Dict[str, Any]]:
        key = f"{query}|{orientation or ''}"
        async with cache_lock:
            if key in cache:
                return cache[key]
        async with sem:
            try:
                payload = await stock.search(query, "all", 1, _PER_NEED_RESULTS, orientation)
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

    async def search_need(need: Dict[str, Any]) -> List[Dict[str, Any]]:
        rows = await _one_search(need["query"], need.get("orientation"))
        # Bounded fallback: only when a REQUIRED slot's primary query found nothing, try ONE
        # sanitized variant. Hard-capped per build so variants never multiply provider calls.
        if not rows and need.get("required"):
            for variant in (need.get("variants") or []):
                async with cache_lock:
                    if variant_budget["left"] <= 0:
                        break
                    variant_budget["left"] -= 1
                stats["variantSearches"] = stats.get("variantSearches", 0) + 1
                rows = await _one_search(variant, need.get("orientation"))
                if rows:
                    break
        return rows

    results = await asyncio.gather(*(search_need(n) for n in needs), return_exceptions=True)

    picked: Dict[str, Dict[str, Any]] = {}
    for need, rows in zip(needs, results):
        if isinstance(rows, Exception) or not rows:
            continue
        chosen, chosen_score = _pick_best(need, rows, used_ids, used_photographers, stats)
        if not chosen:
            continue
        asset = _asset_from_row(need["slotId"], need.get("altText", ""), chosen)
        if not asset["url"]:
            continue
        asset["selectionScore"] = round(chosen_score, 1)
        asset["selectionConfidence"] = _confidence(chosen_score)
        used_ids.add(_row_key(chosen))
        ph = asset["photographerName"].strip().lower()
        if ph:
            used_photographers.add(ph)
        stats["rankedSelected"] = stats.get("rankedSelected", 0) + 1
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
            # Optional, bounded, sanitized fallback query variants (Phase 1). Deduped, ≤3,
            # never equal to the primary query. Old clients omit this ⇒ empty ⇒ unchanged.
            "variants": _clean_variants(n.get("queryVariants"), q),
            # ── Art direction (Phase 1) — PRESERVE through this normalization boundary so the Smart
            #    Image layer (image_intelligence.select_assets → build_design_intent → ImageRequirement)
            #    actually receives it. Previously THIS whitelist dropped these fields even though the
            #    route forwarded them. Bounded here as defence-in-depth; design_intent re-sanitizes and
            #    neutralizes unknown enum values (the canonical validator). The DETERMINISTIC fallback
            #    ignores these keys, so it never consumes an unsupported field, and old 6-field needs
            #    simply carry empty/neutral values ⇒ behaviour unchanged.
            "role": str(n.get("role") or "").strip()[:80],
            "subject": str(n.get("subject") or "").strip()[:120],
            "people": str(n.get("people") or "").strip()[:16],
            "framing": str(n.get("framing") or "").strip()[:80],
            "lighting": str(n.get("lighting") or "").strip()[:60],
            "tone": str(n.get("tone") or "").strip()[:60],
            "authenticity": str(n.get("authenticity") or "").strip()[:40],
            "aspectRatio": str(n.get("aspectRatio") or "").strip()[:12],
            "focalPoint": str(n.get("focalPoint") or "").strip()[:60],
            "negativeSpace": n.get("negativeSpace") if isinstance(n.get("negativeSpace"), bool) else False,
            "loadingPriority": str(n.get("loadingPriority") or "").strip()[:16],
            "noRepeat": n.get("noRepeat") if isinstance(n.get("noRepeat"), bool) else True,
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
    det_stats: Dict[str, int] = {
        "candidatesEvaluated": 0, "rankedSelected": 0, "variantSearches": 0, "weakDropped": 0,
    }
    if missing_needs:
        fallback_picked = await _select_deterministic(
            missing_needs, used_ids, used_photographers, provider_status, stats=det_stats,
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
        # Bounded, secret-free sourcing diagnostics (optional; frontend works without it).
        "intelligence": {
            "smartImagesEnabled": image_intelligence.is_enabled(),
            "deterministicRanked": det_stats["rankedSelected"],
            "candidatesEvaluated": det_stats["candidatesEvaluated"],
            "variantSearches": det_stats["variantSearches"],
            "weakDropped": det_stats["weakDropped"],
            "variantSearchBudget": _MAX_VARIANT_SEARCHES,
            "resultsPerNeed": _PER_NEED_RESULTS,
        },
    }


__all__ = ["source_images", "sanitize_query", "MAX_IMAGES", "MAX_NEED_QUERY"]
