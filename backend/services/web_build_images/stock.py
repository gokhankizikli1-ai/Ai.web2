# coding: utf-8
"""
Web Build — stock photo search (Phase 14K.2).

Server-side Pexels + Unsplash search, normalized so the frontend never sees a
raw provider payload and NEVER sees a provider key. Keys are read per-call from
the environment (PEXELS_API_KEY, UNSPLASH_ACCESS_KEY) and used only for the
outbound provider request; UNSPLASH_SECRET_KEY is NOT required for public photo
search and is never read here. Nothing key-related is logged or returned.

Provider rules implemented (from the official docs):
  • Pexels: hotlink the provider-hosted `src` URLs; credit the photographer and
    link to Pexels. No download-tracking request is required.
  • Unsplash: hotlink the `urls`; credit the photographer with a UTM-tagged link
    to their profile and to Unsplash; and, when a photo is actually USED
    (the user Applies it), trigger a download event by GET-ing the photo's
    `links.download_location` with the Client-ID. That call is `track_download`
    below and is invoked ONLY on Apply — never for viewing thumbnails.

Images are hotlinked, never rehosted or proxied through Korvix.
"""
from __future__ import annotations

import asyncio
import logging
import os
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse

import httpx

logger = logging.getLogger(__name__)

PEXELS_SEARCH = "https://api.pexels.com/v1/search"
UNSPLASH_SEARCH = "https://api.unsplash.com/search/photos"
# Required by Unsplash's attribution guideline for referral links.
_UTM = "utm_source=korvixai&utm_medium=referral"
_TIMEOUT = 8.0
MAX_PER_PAGE = 30
MAX_QUERY = 120
_ALLOWED_ORIENTATION = {"landscape", "portrait", "square"}
ProviderStatus = str  # 'ok' | 'unavailable' | 'error'


def _pexels_key() -> str:
    return (os.getenv("PEXELS_API_KEY") or "").strip()


def _unsplash_key() -> str:
    return (os.getenv("UNSPLASH_ACCESS_KEY") or "").strip()


def availability() -> Dict[str, bool]:
    """Which providers are configured (booleans only — never key material)."""
    return {"pexels": bool(_pexels_key()), "unsplash": bool(_unsplash_key())}


def _clip(value: Optional[str], limit: int) -> Optional[str]:
    if not value:
        return None
    v = str(value).strip()
    return v[:limit] if v else None


def _https_only(url: Optional[str]) -> str:
    """Only accept provider-hosted https URLs; reject anything else."""
    if not url:
        return ""
    u = str(url).strip()
    if not u.lower().startswith("https://") or len(u) > 2048:
        return ""
    return u


async def _search_pexels(
    client: httpx.AsyncClient, query: str, page: int, per_page: int, orientation: Optional[str],
) -> Tuple[List[Dict[str, Any]], ProviderStatus]:
    key = _pexels_key()
    if not key:
        return [], "unavailable"
    params: Dict[str, Any] = {"query": query, "page": page, "per_page": per_page}
    if orientation:
        params["orientation"] = orientation
    try:
        r = await client.get(PEXELS_SEARCH, params=params, headers={"Authorization": key})
        if r.status_code == 429:
            return [], "error"
        r.raise_for_status()
        data = r.json()
    except Exception as exc:  # noqa: BLE001 — never leak provider internals to the client
        logger.warning("[STOCK] pexels request failed: %s", type(exc).__name__)
        return [], "error"

    out: List[Dict[str, Any]] = []
    for p in (data.get("photos") or []):
        src = p.get("src") or {}
        name = _clip(p.get("photographer"), 120) or "Pexels"
        out.append({
            "id": f"pexels:{p.get('id')}",
            "provider": "pexels",
            "providerImageId": str(p.get("id") or ""),
            "thumbnailUrl": _https_only(src.get("medium") or src.get("small") or src.get("tiny")),
            "previewUrl": _https_only(src.get("large") or src.get("large2x") or src.get("medium")),
            "fullUrl": _https_only(src.get("original") or src.get("large2x") or src.get("large")),
            "width": p.get("width"),
            "height": p.get("height"),
            "alt": _clip(p.get("alt"), 200),
            # Provider-supplied dominant color — used by the Image Intelligence layer
            # for color-harmony scoring. Optional; absent on older payloads.
            "avgColor": _clip(p.get("avg_color"), 9),
            "photographerName": name,
            "photographerUrl": _https_only(p.get("photographer_url")) or None,
            "providerPageUrl": _https_only(p.get("url")) or "https://www.pexels.com",
            "attributionText": f"Photo by {name} on Pexels",
            "downloadLocation": None,  # Pexels requires no download tracking
        })
    return out, "ok"


async def _search_unsplash(
    client: httpx.AsyncClient, query: str, page: int, per_page: int, orientation: Optional[str],
) -> Tuple[List[Dict[str, Any]], ProviderStatus]:
    key = _unsplash_key()
    if not key:
        return [], "unavailable"
    params: Dict[str, Any] = {"query": query, "page": page, "per_page": per_page}
    if orientation:
        params["orientation"] = "squarish" if orientation == "square" else orientation
    try:
        r = await client.get(
            UNSPLASH_SEARCH, params=params,
            headers={"Authorization": f"Client-ID {key}", "Accept-Version": "v1"},
        )
        if r.status_code in (403, 429):  # rate limit / demo cap
            return [], "error"
        r.raise_for_status()
        data = r.json()
    except Exception as exc:  # noqa: BLE001
        logger.warning("[STOCK] unsplash request failed: %s", type(exc).__name__)
        return [], "error"

    out: List[Dict[str, Any]] = []
    for p in (data.get("results") or []):
        urls = p.get("urls") or {}
        user = p.get("user") or {}
        user_links = user.get("links") or {}
        photo_links = p.get("links") or {}
        name = _clip(user.get("name"), 120) or "Unsplash"
        profile = _https_only(user_links.get("html"))
        html = _https_only(photo_links.get("html")) or "https://unsplash.com"
        sep = "&" if "?" in html else "?"
        out.append({
            "id": f"unsplash:{p.get('id')}",
            "provider": "unsplash",
            "providerImageId": str(p.get("id") or ""),
            "thumbnailUrl": _https_only(urls.get("small") or urls.get("thumb")),
            "previewUrl": _https_only(urls.get("regular") or urls.get("small")),
            "fullUrl": _https_only(urls.get("full") or urls.get("raw")),
            "width": p.get("width"),
            "height": p.get("height"),
            "alt": _clip(p.get("alt_description") or p.get("description"), 200),
            # Unsplash's dominant color hex — feeds Image Intelligence color scoring.
            "avgColor": _clip(p.get("color"), 9),
            "photographerName": name,
            "photographerUrl": (f"{profile}?{_UTM}" if profile else None),
            "providerPageUrl": f"{html}{sep}{_UTM}",
            "attributionText": f"Photo by {name} on Unsplash",
            # Used ONLY on Apply to trigger the required download event.
            "downloadLocation": _https_only(photo_links.get("download_location")) or None,
        })
    return out, "ok"


def _dedupe(results: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    seen = set()
    out: List[Dict[str, Any]] = []
    for r in results:
        key = r.get("fullUrl") or r.get("previewUrl") or r.get("id")
        if not r.get("thumbnailUrl"):
            continue  # drop entries with no usable thumbnail
        if key in seen:
            continue
        seen.add(key)
        out.append(r)
    return out


def _interleave(pex: List[Dict[str, Any]], uns: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    merged: List[Dict[str, Any]] = []
    for i in range(max(len(pex), len(uns))):
        if i < len(pex):
            merged.append(pex[i])
        if i < len(uns):
            merged.append(uns[i])
    return merged


async def search(query: str, provider: str, page: int, per_page: int, orientation: Optional[str]) -> Dict[str, Any]:
    """
    Search one or both providers. One provider failing does not fail the other;
    each provider's status is reported honestly. Returns a normalized payload.
    """
    run_pex = provider in ("all", "pexels")
    run_uns = provider in ("all", "unsplash")
    statuses: Dict[str, ProviderStatus] = {"pexels": "unavailable", "unsplash": "unavailable"}
    pex_results: List[Dict[str, Any]] = []
    uns_results: List[Dict[str, Any]] = []

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        tasks = []
        if run_pex:
            tasks.append(("pexels", _search_pexels(client, query, page, per_page, orientation)))
        if run_uns:
            tasks.append(("unsplash", _search_unsplash(client, query, page, per_page, orientation)))
        gathered = await asyncio.gather(*(t[1] for t in tasks), return_exceptions=True)

    for (name, _), res in zip(tasks, gathered):
        if isinstance(res, Exception):
            statuses[name] = "error"
            continue
        rows, status = res
        statuses[name] = status
        if name == "pexels":
            pex_results = rows
        else:
            uns_results = rows

    merged = _dedupe(_interleave(pex_results, uns_results) if provider == "all"
                     else (pex_results + uns_results))
    has_more = len(pex_results) >= per_page or len(uns_results) >= per_page
    return {
        "query": query,
        "page": page,
        "perPage": per_page,
        "providers": statuses,
        "results": merged,
        "hasMore": has_more,
    }


def track_download(provider: str, download_location: str) -> bool:
    """
    Fire Unsplash's required download event when a photo is USED (Apply). Strict
    host allow-list (api.unsplash.com only) prevents this from becoming an SSRF
    relay. No-op for Pexels (no tracking requirement). Never raises.
    """
    if provider != "unsplash":
        return False
    key = _unsplash_key()
    url = _https_only(download_location)
    if not key or not url:
        return False
    try:
        if urlparse(url).netloc.lower() != "api.unsplash.com":
            return False
        with httpx.Client(timeout=_TIMEOUT) as client:
            client.get(url, headers={"Authorization": f"Client-ID {key}", "Accept-Version": "v1"})
        return True
    except Exception as exc:  # noqa: BLE001
        logger.warning("[STOCK] unsplash download-track failed: %s", type(exc).__name__)
        return False


__all__ = ["availability", "search", "track_download", "MAX_PER_PAGE", "MAX_QUERY"]
