# coding: utf-8
# CRITICAL REBUILD — product-specific renderer package.
#
# Each module owns ONE product family's layout architecture and emits its
# own <body> markup + a CSS block. `base` assembles the document and owns
# the shared sandbox-safe interaction script.

from __future__ import annotations

from backend.services.generation.renderers import (
    base, booking, dashboard, ecommerce, editor, landing, portfolio,
)

# layout key → renderer module (each exposes `render(spec)` and `CSS`).
RENDERERS = {
    "editor":    editor,
    "app":       dashboard,
    "dashboard": dashboard,
    "ecommerce": ecommerce,
    "booking":   booking,
    "landing":   landing,
    "portfolio": portfolio,
}

__all__ = ["base", "RENDERERS", "editor", "dashboard", "ecommerce",
           "booking", "landing", "portfolio"]
