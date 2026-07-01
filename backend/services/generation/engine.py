# coding: utf-8
# EPIC 2 — Generation engine.
#
# The single seam the orchestrator calls. It owns the multi-pass
# generation pipeline and is DELIBERATELY decoupled from orchestration
# and from the rendering target:
#
#   build_prompt()      planning + (invisible) prompt expansion +
#                       component selection + design directives → the
#                       prompt handed to the (unchanged) agent runtime.
#   finalize_artifact() layout extraction + visual-polish/design-system
#                       enforcement + accessibility (viewport) + internal
#                       quality review + one deterministic refinement
#                       (premium fallback) + artifact metadata.
#
# FUTURE-PROOF: page rendering goes through a Renderer registry. Today
# the only renderer is `html` (single-file HTML). A future milestone can
# register a `react_vite` renderer (multi-file project) and flip
# GENERATION_RENDERER without touching orchestration, templates, runtime
# or this engine's public API.

from __future__ import annotations

import os
from typing import Any, Dict, List, Optional

from backend.services.generation.components import (
    catalog_prompt_block, detect_components,
)
from backend.services.generation.html_renderer import (
    ensure_csp, ensure_viewport, render_premium_page,
)
from backend.services.generation.prompt_expander import expand
from backend.services.generation import quality
from backend.services.generation.spec import ProductSpec

# Deliverable kinds that represent a full UI page/prototype (vs. markdown
# planning artifacts like concept/screens/file lists).
PAGE_KINDS = {"landing_page_html", "app_prototype_html", "html", "web_page"}


# ── Renderer registry (the swap seam) ─────────────────────────────────

# Layout-specific structural guidance for the LLM path (Sprint 1.9). The
# deterministic fallback renderer already enforces this per-layout shape via
# dedicated modules (renderers/mobile.py, dashboard.py, landing.py, ...) —
# this block gets the SAME structural intent to the model so a good LLM
# reply doesn't need the fallback to look right.
_LAYOUT_GUIDANCE: Dict[str, str] = {
    "mobile": (
        "LAYOUT — MOBILE APP SHELL (not a desktop dashboard):\n"
        "- A centered, phone-width canvas (~390-430px) even on a wide screen — NOT a left sidebar.\n"
        "- A sticky top app-bar (avatar/title + a notification icon).\n"
        "- A scrollable content column: a hero/profile card (consider a circular progress ring), "
        "a 2-column metric grid, a vertical list panel, and a couple of pill-shaped quick-action buttons.\n"
        "- A STICKY BOTTOM TAB BAR with 3-5 icon+label destinations (use the navigation items) — "
        "this replaces the sidebar entirely.\n"
        "- Optionally a floating action button above the tab bar for the primary action."
    ),
    "app": (
        "LAYOUT — SAAS APP SHELL:\n"
        "- A fixed left sidebar (navigation + brand) and a sticky top bar (search + actions).\n"
        "- Dashboard cards, charts/sparkline mockups, an activity feed, and a settings panel."
    ),
    "landing": (
        "LAYOUT — MARKETING LANDING PAGE:\n"
        "- Sticky top nav, then a SPLIT HERO — not a centered text block: headline/CTAs on one side, "
        "a large product visual (mockup, dashboard preview, or illustration) on the other, with depth "
        "(a soft glow, a layered/floating element) rather than a single flat panel.\n"
        "- A primary + secondary CTA in the hero, a social-proof logo row, a feature grid, pricing, "
        "testimonials, an FAQ, a closing CTA band and a rich footer.\n"
        "- Alternate a subtle background tone between sections (not every section on the identical "
        "background) so the page reads as a sequence of deliberate sections, not one flat scroll.\n"
        "- Generous whitespace between sections; avoid four-identical-cards as the default layout — "
        "prefer one dominant element per section over a wall of equal-weight boxes."
    ),
}


def _layout_guidance(spec: ProductSpec) -> str:
    return _LAYOUT_GUIDANCE.get((spec.layout or "").lower(), "")


class HtmlRenderer:
    """Single-file HTML renderer. The default page renderer."""
    name = "html"
    artifact_type = "html"
    preview = "iframe"

    def build_prompt(self, *, base_instructions: str, spec: ProductSpec) -> str:
        return f"""You are a senior product designer and front-end engineer. Produce a PREMIUM, production-quality prototype that looks like a real, funded startup product (think Linear, Stripe, Vercel, Apple, Notion, Raycast) — NOT a beginner HTML template.

TASK:
{base_instructions}

INTERNAL PRODUCT SPECIFICATION (use it; do NOT echo it back):
{spec.to_prompt_block()}

ASSEMBLE THE PAGE FROM THESE REUSABLE COMPONENTS (use the ones that fit):
{catalog_prompt_block()}

{_layout_guidance(spec)}

DESIGN REQUIREMENTS:
- Dark mode by default; cohesive design system (consistent typography scale, spacing, radius, soft shadows, gradients, glassmorphism where tasteful).
- Fully responsive, mobile-first. Smooth transitions and subtle micro-animations.
- Semantic HTML (header/nav/main/section/footer), accessible focus states.
- Clean, organized CSS in a single <style> block. No inline styles unless unavoidable. No external scripts.
- Icons: inline SVG or CSS-only only — never reference an external icon font or CDN.

COPYWRITING:
- Realistic, specific, startup-quality copy for THIS product. Real headlines, feature names, button labels and navigation.
- NEVER output placeholders like "My App", "Feature 1", "Lorem ipsum", "Title goes here".

OUTPUT:
- Return ONLY one complete, self-contained HTML document starting with <!DOCTYPE html>. A Google Fonts <link> is allowed; nothing else external.
"""

    def finalize(self, *, node_title: str, raw_reply: str, spec: ProductSpec) -> Dict:
        from backend.services.orchestrator.artifacts import _strip_html  # reuse extractor
        extracted = _strip_html(raw_reply or "")
        qscore, issues = quality.score(extracted)
        # retail_analytics (the Shopify/fashion commerce-analytics vertical)
        # has an exact, numbers-specific spec — $482K revenue, 4.2x ROAS, a
        # best-sellers table — that only the deterministic renderer
        # reproduces. quality.is_premium() only checks generic structural
        # signals (sections/CSS/semantics/responsiveness), so a structurally
        # fine but generic model reply can clear that bar while silently
        # dropping the vertical's whole point. Always render the guaranteed
        # spec for this build type instead of gambling on the model reply.
        if spec.product_type == "retail_analytics":
            final_html, source = render_premium_page(spec), "generated"
            qscore, issues = quality.score(final_html)
        elif quality.is_premium(extracted):
            # Keep the bespoke model page, but guarantee viewport + the
            # network-blocking CSP (the preview iframe runs scripts).
            final_html, source = ensure_csp(ensure_viewport(extracted)), "model"
        else:
            # Internal quality review failed → one deterministic refinement
            # pass: render the guaranteed-premium page from the spec.
            final_html, source = render_premium_page(spec), "generated"
            qscore, issues = quality.score(final_html)

        components_used = detect_components(final_html)
        title = spec.name if source == "generated" else (node_title or spec.name)
        return {
            "type": "html",
            "title": title,
            "language": "html",
            "content": final_html,
            "files": [],
            "preview": "iframe",
            "download": {"filename": _slug(spec.name) + ".html", "mime": "text/html"},
            "metadata": _metadata(spec, "html", components_used, final_html, source, qscore),
        }


_RENDERERS: Dict[str, object] = {"html": HtmlRenderer()}


def register_renderer(name: str, renderer: object) -> None:
    """Register a page renderer (e.g. a future `react_vite`)."""
    _RENDERERS[name] = renderer


def _page_renderer():
    name = (os.getenv("GENERATION_RENDERER", "html").strip().lower() or "html")
    return _RENDERERS.get(name) or _RENDERERS["html"]


# ── Public engine API (called by the orchestrator's agent.run) ────────

def build_prompt(*, deliverable_kind: str, node_role: str,
                 base_instructions: str, user_request: str,
                 blueprint: Optional[Dict[str, Any]] = None) -> str:
    """Pass 1-3: planning + invisible prompt expansion + component
    selection + design directives. Returns the prompt for the (unchanged)
    agent runtime. For non-page nodes (concept/screens/file lists), the
    base instructions are kept but enriched with product context so copy
    stays on-brand and premium.

    `blueprint` (Sprint 1.9) is the OPTIONAL Sprint 1.3 ProductBlueprint
    summary carried on the orchestrator run's metadata — see
    prompt_expander.expand() for what it does. None (the default) is fully
    backward compatible."""
    spec = expand(user_request or "", blueprint=blueprint)
    if (deliverable_kind or "").lower() in PAGE_KINDS:
        return _page_renderer().build_prompt(base_instructions=base_instructions, spec=spec)
    # Planning / markdown nodes — light context injection.
    return (
        f"{base_instructions}\n\n"
        f"PRODUCT CONTEXT (use it; keep copy specific and premium — no placeholders):\n"
        f"{spec.to_prompt_block()}"
    )


def finalize_artifact(*, deliverable_kind: str, node_title: str,
                      raw_reply: str, user_request: str,
                      blueprint: Optional[Dict[str, Any]] = None) -> Dict:
    """Pass 4-6: visual polish + design-system enforcement + accessibility
    + internal quality review + one deterministic refinement, returning a
    typed artifact (+ metadata). Page kinds go through the active page
    renderer; everything else reuses the base artifact builder.

    `blueprint` — see build_prompt(). None is fully backward compatible."""
    kind = (deliverable_kind or "").lower()
    if kind in PAGE_KINDS:
        spec = expand(user_request or "", blueprint=blueprint)
        return _page_renderer().finalize(
            node_title=node_title, raw_reply=raw_reply, spec=spec,
        )
    # Non-page artifact (markdown / file list / code) — reuse the base
    # builder and attach light metadata for a consistent FE contract.
    from backend.services.orchestrator.artifacts import build_artifact
    art = build_artifact(kind=deliverable_kind, title=node_title, text=raw_reply)
    spec = expand(user_request or "", blueprint=blueprint)
    art.setdefault("metadata", _metadata(
        spec, art.get("type", "markdown"),
        components_used=[], html="", source="model", qscore=None,
    ))
    return art


# ── Metadata (requirement #10) ────────────────────────────────────────

def _metadata(spec: ProductSpec, artifact_type: str, components_used: List[str],
              html: str, source: str, qscore) -> Dict:
    interactions = _count_interactions(html) if artifact_type == "html" else 0
    return {
        "title": spec.name,
        "description": spec.description,
        "artifact_type": artifact_type,
        "theme": {"mode": "dark" if spec.dark_mode else "light",
                  "accent": spec.theme.get("accent")},
        "components_used": components_used,
        "responsive": True,
        "dark_mode": spec.dark_mode,
        "interactive": interactions > 0,
        "interactions": interactions,
        "complexity": _complexity(html, components_used),
        "files": [_slug(spec.name) + (".html" if artifact_type == "html" else ".md")],
        "source": source,
        "quality_score": qscore,
        "product_type": spec.product_type,
        "intent": spec.intent,
        "layout": spec.layout,
        "renderer_category": spec.renderer,
        "style": (spec.style or {}).get("mode_name") or (spec.style or {}).get("label"),
    }


def _count_interactions(html: str) -> int:
    """Count the distinct wired interaction kinds present in the page
    (nav/panel switch, reveal, scroll, selectable, FAQ). Used for the
    `interactions` metadata + the quality signal."""
    h = html or ""
    n = 0
    for marker in ("data-nav=", "data-reveal=", "data-scroll=",
                   "data-select-group", "<details", "data-tab=",
                   "data-search", "data-folder=", "data-note",
                   "data-filter=", "data-add-cart", "data-product=",
                   "data-room=", "data-book"):
        if marker in h:
            n += 1
    return n


def _complexity(html: str, components_used: List[str]) -> str:
    n = len(components_used)
    size = len(html or "")
    if n >= 6 or size >= 12000: return "high"
    if n >= 3 or size >= 4000:  return "medium"
    return "low"


def _slug(s: str) -> str:
    import re
    return re.sub(r"[^a-zA-Z0-9]+", "-", (s or "app").strip()).strip("-").lower() or "app"


__all__ = [
    "PAGE_KINDS", "build_prompt", "finalize_artifact",
    "register_renderer", "HtmlRenderer",
]
