# coding: utf-8
"""
Image Intelligence — the provider abstraction.

A single, scalable seam between the ranking engine and whatever actually returns
candidate images. Today one provider is registered — :class:`StockImageProvider`,
an adapter over the existing server-side ``web_build_images.stock`` module
(Pexels + Unsplash, keys never leave the server). Tomorrow a Pixabay adapter or an
AI-generation adapter can be registered under a new name without touching the engine
or the sourcing orchestration.

The contract is deliberately small:

    search(query, requirement)   → list[ImageCandidate]
    get_details(candidate)       → ImageCandidate            (enrich, best-effort)
    validate_license(candidate)  → LicenseResult             (is it safe to use?)

``ImageProvider`` is a ``typing.Protocol`` so any object with these methods qualifies
— no inheritance required. Every method is total: failures degrade to empty results,
never exceptions.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Protocol, runtime_checkable

from backend.services.image_intelligence.design_intent import ImageRequirement
from backend.services.web_build_images import stock


@dataclass
class ImageCandidate:
    """A normalized, provider-agnostic image candidate the engine can score."""

    id: str
    provider: str
    provider_image_id: str
    url: str                       # preview/regular URL (what the site will hotlink)
    thumbnail_url: str = ""
    full_url: str = ""
    width: int = 0
    height: int = 0
    alt: str = ""                  # provider description — the relevance signal
    dominant_color: str = ""       # hex, provider-supplied — the color signal
    photographer_name: str = ""
    photographer_url: Optional[str] = None
    provider_page_url: str = ""
    download_location: Optional[str] = None
    attribution_text: str = ""
    raw: Dict[str, Any] = field(default_factory=dict)  # original row (for manifest projection)

    @property
    def megapixels(self) -> float:
        return (max(0, self.width) * max(0, self.height)) / 1_000_000.0

    @property
    def aspect_ratio(self) -> Optional[float]:
        return (self.width / self.height) if self.width > 0 and self.height > 0 else None


@dataclass
class LicenseResult:
    ok: bool
    reason: str = ""
    requires_attribution: bool = True


@runtime_checkable
class ImageProvider(Protocol):
    """Any image source the ranking engine can pull candidates from."""

    name: str

    async def search(self, query: str, requirement: ImageRequirement) -> List[ImageCandidate]:
        ...

    async def get_details(self, candidate: ImageCandidate) -> ImageCandidate:
        ...

    def validate_license(self, candidate: ImageCandidate) -> LicenseResult:
        ...


def _as_int(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def _candidate_from_stock_row(row: Dict[str, Any]) -> Optional[ImageCandidate]:
    url = stock._https_only(row.get("previewUrl") or row.get("fullUrl") or row.get("thumbnailUrl"))
    if not url:
        return None
    return ImageCandidate(
        id=str(row.get("id") or url),
        provider=str(row.get("provider") or "unknown"),
        provider_image_id=str(row.get("providerImageId") or ""),
        url=url,
        thumbnail_url=stock._https_only(row.get("thumbnailUrl")) or url,
        full_url=stock._https_only(row.get("fullUrl")) or url,
        width=_as_int(row.get("width")),
        height=_as_int(row.get("height")),
        alt=str(row.get("alt") or "").strip(),
        dominant_color=str(row.get("avgColor") or "").strip(),
        photographer_name=str(row.get("photographerName") or "").strip(),
        photographer_url=stock._https_only(row.get("photographerUrl")) or None,
        provider_page_url=stock._https_only(row.get("providerPageUrl")) or "",
        download_location=stock._https_only(row.get("downloadLocation")) or None,
        attribution_text=str(row.get("attributionText") or "").strip(),
        raw=row,
    )


class StockImageProvider:
    """Adapter over ``web_build_images.stock`` — searches Pexels + Unsplash at once.

    Reuses the existing normalized rows (and their license/attribution metadata) so
    nothing about key handling, hotlinking or download-tracking changes. This is an
    adapter, not a rewrite.
    """

    name = "stock"

    def __init__(self, results_per_query: int = 15) -> None:
        self._results_per_query = max(1, min(results_per_query, stock.MAX_PER_PAGE))

    async def search(self, query: str, requirement: ImageRequirement) -> List[ImageCandidate]:
        orientation = requirement.orientation if requirement.orientation in stock._ALLOWED_ORIENTATION else None
        try:
            payload = await stock.search(query, "all", 1, self._results_per_query, orientation)
        except Exception:  # noqa: BLE001 — providers never bubble up to the engine
            return []
        candidates: List[ImageCandidate] = []
        for row in (payload.get("results") or []):
            candidate = _candidate_from_stock_row(row)
            if candidate is not None:
                candidates.append(candidate)
        return candidates

    async def get_details(self, candidate: ImageCandidate) -> ImageCandidate:
        # Stock search already returns everything the engine needs (dimensions, color,
        # attribution). No second round-trip required.
        return candidate

    def validate_license(self, candidate: ImageCandidate) -> LicenseResult:
        # Pexels & Unsplash search results are free-to-use with attribution. We require
        # a provider-hosted https URL and known provider before a candidate is usable.
        if candidate.provider not in ("pexels", "unsplash"):
            return LicenseResult(ok=False, reason="unknown_provider")
        if not candidate.url.lower().startswith("https://"):
            return LicenseResult(ok=False, reason="non_https_url")
        return LicenseResult(ok=True, requires_attribution=True)


# ── Registry (the extension seam) ───────────────────────────────────────────────

_PROVIDERS: Dict[str, ImageProvider] = {}
_DEFAULT_PROVIDER = "stock"


def register_provider(provider: ImageProvider) -> None:
    """Register (or replace) a provider under its ``name``."""
    _PROVIDERS[provider.name] = provider


def get_provider(name: Optional[str] = None) -> ImageProvider:
    """Return a registered provider (default: ``stock``)."""
    if not _PROVIDERS:
        register_provider(StockImageProvider())
    return _PROVIDERS.get((name or _DEFAULT_PROVIDER), _PROVIDERS[_DEFAULT_PROVIDER])


async def search_licensed(
    provider: ImageProvider, query: str, requirement: ImageRequirement,
) -> List[ImageCandidate]:
    """Search a provider and keep only license-valid candidates. Never raises."""
    candidates = await provider.search(query, requirement)
    out: List[ImageCandidate] = []
    for candidate in candidates:
        try:
            if provider.validate_license(candidate).ok:
                out.append(candidate)
        except Exception:  # noqa: BLE001
            continue
    return out


# Register the built-in provider on import so the default path needs no setup.
register_provider(StockImageProvider())


__all__ = [
    "ImageCandidate", "LicenseResult", "ImageProvider", "StockImageProvider",
    "register_provider", "get_provider", "search_licensed",
]
