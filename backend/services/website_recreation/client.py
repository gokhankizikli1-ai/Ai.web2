# coding: utf-8
"""Phase 8 — Recreation foundation."""
from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from typing import Optional

from backend.services.assets import client as assets_client
from backend.services.vision import client as vision_client
from backend.services.website_recreation.types import RecreationResult


logger = logging.getLogger(__name__)


def is_enabled() -> bool:
    return os.getenv("ENABLE_WEBSITE_RECREATION", "false").strip().lower() == "true"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# Conservative defaults — everything that the heuristic foundation
# can offer without inventing facts. The frontend agent prompt is
# the most valuable output here because it gives a downstream
# code-generation pass real grounding.
_DEFAULT_SECTIONS         = ["hero", "features", "social_proof", "cta", "footer"]
_DEFAULT_RESPONSIVE       = ["stack vertically below 768px",
                             "max content width ~1200px",
                             "tap targets ≥ 44px on mobile"]
_DEFAULT_STACK            = ["Next.js (App Router)", "Tailwind CSS",
                             "Framer Motion", "shadcn/ui"]


class RecreationClient:

    def is_enabled(self) -> bool:
        return is_enabled()

    def analyze(
        self, *, asset_id: str, user_id: str,
        user_prompt: Optional[str] = None,
    ) -> Optional[RecreationResult]:
        """Produce a structured rebuild plan from a screenshot.

        Returns None when the asset is missing OR ENABLE_WEBSITE_RECREATION
        is off. Returns a result with `warnings` populated when the
        vision pipeline couldn't analyze the image (so the FE knows
        the plan is metadata-only)."""
        if not is_enabled():
            return None
        rec = assets_client.get(asset_id, user_id=user_id)
        if rec is None:
            return None
        if rec.asset_type != "image":
            # We don't yet derive recreation plans from non-images.
            return RecreationResult(
                asset_id=asset_id,
                warnings=[f"asset is not an image (type={rec.asset_type!r})"],
                created_at=_now(),
            )

        # Pull an analysis (fresh if vision is enabled; cached otherwise).
        analysis = vision_client.analyze(asset_id, user_id=user_id) or \
                   vision_client.get_cached(asset_id)
        warnings: list[str] = []
        colors: list[str] = []
        typography: list[str] = []
        layout: list[str] = []
        page_type = "landing"

        if analysis:
            data = analysis.to_dict() if hasattr(analysis, "to_dict") else (analysis or {})
            colors     = data.get("colors") or []
            typography = data.get("typography") or []
            layout     = data.get("layout_structure") or []
            if data.get("warnings"):
                warnings.extend(data["warnings"])
        else:
            warnings.append("vision analysis unavailable; recreation plan is heuristic-only")

        # Build the frontend-agent prompt. Always grounded — when we
        # don't know typography we say so, never invent.
        prompt_parts: list[str] = [
            f"Rebuild the design shown in screenshot {rec.filename!r}.",
            f"Page type: {page_type}.",
        ]
        if user_prompt:
            prompt_parts.append(f"User intent: {user_prompt.strip()[:400]}.")
        prompt_parts.append("Stack: " + ", ".join(_DEFAULT_STACK) + ".")
        if colors:
            prompt_parts.append("Colors observed: " + ", ".join(colors[:6]) + ".")
        if typography:
            prompt_parts.append("Typography hints: " + ", ".join(typography[:4]) + ".")
        if layout:
            prompt_parts.append("Detected layout sections: " + ", ".join(layout[:6]) + ".")
        if warnings:
            prompt_parts.append(
                "Caveat: " + " ".join(warnings) +
                " Use sensible defaults where details are missing."
            )

        sections = layout if layout else list(_DEFAULT_SECTIONS)
        component_plan: list[dict] = [
            {"name": s, "kind": "section", "notes": "to be detailed by frontend agent"}
            for s in sections
        ]

        return RecreationResult(
            asset_id=                       asset_id,
            page_type=                      page_type,
            sections=                       sections,
            layout_structure=               layout or sections,
            color_palette=                  colors,
            typography_notes=               typography,
            component_plan=                 component_plan,
            responsive_notes=               list(_DEFAULT_RESPONSIVE),
            recommended_tech_stack=         list(_DEFAULT_STACK),
            generated_prompt_for_frontend_agent="\n".join(prompt_parts),
            warnings=                       warnings,
            metadata={
                "source_asset": {
                    "filename":   rec.filename,
                    "mime_type":  rec.mime_type,
                    "size_bytes": rec.size_bytes,
                },
                "user_prompt_provided": bool(user_prompt),
            },
            created_at=_now(),
        )

    def stats(self) -> dict:
        return {"enabled": is_enabled()}


client: RecreationClient = RecreationClient()


__all__ = ["RecreationClient", "client", "is_enabled"]
