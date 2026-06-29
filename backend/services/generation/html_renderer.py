# coding: utf-8
# CRITICAL REBUILD — premium HTML renderer (facade).
#
# The public surface the engine calls. The heavy lifting now lives in the
# product-specific renderer package (`renderers/`): one module per product
# family (editor / dashboard / ecommerce / booking / landing / portfolio),
# each with its own layout architecture, dispatched by `spec.layout`. This
# module just routes and assembles, and keeps the historical helper API
# (`render_premium_page`, `ensure_viewport`, `ensure_csp`) stable.

from __future__ import annotations

from backend.services.generation.renderers import RENDERERS, base
from backend.services.generation.renderers.base import ensure_csp, ensure_viewport
from backend.services.generation.spec import ProductSpec


def render_premium_page(spec: ProductSpec) -> str:
    """Render the full premium, interactive HTML document for a spec,
    dispatching to the product-specific renderer for its layout."""
    layout = (spec.layout or "").lower() or ("app" if spec.is_dashboard else "landing")
    module = RENDERERS.get(layout) or (RENDERERS["app"] if spec.is_dashboard else RENDERERS["landing"])
    body = module.render(spec)
    extra_css = getattr(module, "CSS", "")
    return base.document(spec, body, extra_css)


__all__ = ["render_premium_page", "ensure_viewport", "ensure_csp"]
