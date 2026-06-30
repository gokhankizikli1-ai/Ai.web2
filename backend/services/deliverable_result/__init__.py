# coding: utf-8
"""
Deliverable Result — stable, renderer-agnostic result/preview layer.

Turns completed orchestrator deliverables into a PreviewPayload that future
modules (Website Builder, Startup, Ecommerce, Game, Research) consume without
knowing the internal deliverable schema. Built on the orchestrator's existing
get_run_snapshot (ownership-enforced) — no second store, no fabrication.

    from backend.services.deliverable_result import resolve_run_result
    payload = resolve_run_result(run_id, user_id=principal.user_id)
    payload.status        # ResultStatus
    payload.renderer      # "iframe" | "code" | "markdown" | "file_tree" | "none"
    payload.html_preview  # set only for iframe artifacts
"""
from backend.services.deliverable_result.resolver import (
    resolve_run_result, resolve_project_result,
)
from backend.services.deliverable_result.types import (
    ResultStatus, NON_TERMINAL, PreviewPayload, SourceDeliverable,
)

__all__ = [
    "resolve_run_result", "resolve_project_result",
    "ResultStatus", "NON_TERMINAL", "PreviewPayload", "SourceDeliverable",
]
