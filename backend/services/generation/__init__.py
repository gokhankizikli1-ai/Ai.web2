# coding: utf-8
# EPIC 2 — Premium application generation engine.
#
# Orchestration-independent. The orchestrator's agent.run step calls
# build_prompt() + finalize_artifact(); everything else (prompt
# expansion, design system, component library, premium renderer, quality
# review, metadata) lives here and is swappable via the renderer
# registry (future React/Vite multi-file generator).

from backend.services.generation.engine import (
    build_prompt, finalize_artifact, register_renderer,
    PAGE_KINDS, HtmlRenderer,
)

__all__ = [
    "build_prompt", "finalize_artifact", "register_renderer",
    "PAGE_KINDS", "HtmlRenderer",
]
