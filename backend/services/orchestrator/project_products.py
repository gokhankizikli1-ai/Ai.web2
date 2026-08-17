# coding: utf-8
"""The ONE project-scoped projection of generated Web/App products.

WHY THIS MODULE EXISTS
----------------------
Three surfaces need "the products of project X":

  * `GET /v2/orchestrator/projects/{id}/products`  (the products endpoint)
  * the Phase 8 Project Brain aggregate             (prompt injection)
  * the Project Workspace read model                (the Project page)

Each of them was (or would have been) re-deriving the same rows from
`deliverables_store` with its own copy of the kind filter and the same
`content` unpacking. That is exactly the kind of duplicated interpretation that
drifts: one surface learns about a new build kind and the others silently keep
showing stale shapes.

So the interpretation lives here, once. This is NOT a new store and NOT a
second products authority: `deliverables_store` still owns produced products and
`build_execution_store` still owns in-flight/failed executions. This module only
reads them and returns BOUNDED REFERENCES — build type, title, status, artifact
and build refs, originating run — never the duplicated source tree, which the
artifact authority owns.

SCOPING
-------
Both stores are keyed by `project_id` ONLY, so they carry no owner column to
defend with. Callers MUST have already proved that the caller owns the project
(the products route and the workspace read model both do, through the canonical
`projects` record) before calling in here. Nothing in this module performs an
ownership check, and nothing in it accepts a user id — that would imply a
guarantee it cannot make.

COST: pure SQLite reads. ZERO model tokens.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List

logger = logging.getLogger(__name__)

#: Deliverable kinds that represent a generated Web/App product. Kept in sync
#: with the build capability's deliverable kinds.
PRODUCT_KINDS = ("web_build", "app_build", "build")

#: Default read bound. Callers that render a compact surface pass a smaller one.
DEFAULT_LIMIT = 200


def _product_view(deliverable: Dict[str, Any]) -> Dict[str, Any]:
    """One deliverable row → the canonical bounded product reference."""
    content = deliverable.get("content") or {}
    if not isinstance(content, dict):
        content = {}
    return {
        "deliverable_id": deliverable.get("id"),
        "build_type":     content.get("build_type") or (
            "app" if deliverable.get("kind") == "app_build" else "web"),
        "title":          (deliverable.get("title") or "").strip(),
        "status":         content.get("build_status") or deliverable.get("status"),
        "artifact_ref":   content.get("artifact_ref") or "",
        "build_ref":      content.get("build_ref") or "",
        "run_id":         deliverable.get("run_id"),
        "node_id":        deliverable.get("node_id"),
        # The chat the product was generated in, when Save-to-Project recorded
        # one. It is the user's OWN conversation id — the only durable place a
        # saved build can actually be reopened — so the workspace can offer a
        # real "open" instead of a link that resolves to nothing.
        "thread_id":      content.get("thread_id") or "",
        "updated_at":     deliverable.get("updated_at"),
    }


def list_products(project_id: str, *, limit: int = DEFAULT_LIMIT) -> List[Dict[str, Any]]:
    """Generated Web/App products of a project, newest-first as the deliverables
    authority orders them. Never raises — an unavailable store yields []."""
    if not project_id:
        return []
    out: List[Dict[str, Any]] = []
    try:
        from backend.services.orchestrator import deliverables_store as dls
        # Read a wider slice than `limit` is NOT done here: the store's ordering
        # is the authority, and asking it for `limit` rows after filtering would
        # need a store-side kind filter. We read the store's own bound and stop
        # once `limit` products have been collected.
        for d in dls.list_for_project(project_id, limit=DEFAULT_LIMIT):
            if str(d.get("kind")) not in PRODUCT_KINDS:
                continue
            out.append(_product_view(d))
            if len(out) >= max(1, int(limit or DEFAULT_LIMIT)):
                break
    except Exception as exc:  # pragma: no cover — never 500 a project surface
        logger.warning("project_products: deliverables unavailable for %s: %s",
                       project_id, exc)
    return out


def list_executions(project_id: str, *, limit: int = DEFAULT_LIMIT) -> List[Dict[str, Any]]:
    """In-flight / terminal build EXECUTIONS of a project (the build runner's own
    authority). Refs only. Never raises."""
    if not project_id:
        return []
    out: List[Dict[str, Any]] = []
    try:
        from backend.services.orchestrator import build_execution_store as bes
        for e in bes.list_for_project(project_id, limit=max(1, int(limit or DEFAULT_LIMIT))):
            out.append({
                "id":           e.get("id"),
                "build_type":   e.get("build_type"),
                "status":       e.get("status"),
                "artifact_ref": e.get("artifact_ref") or "",
                "build_ref":    e.get("build_ref") or "",
                "run_id":       e.get("run_id"),
                "updated_at":   e.get("updated_at"),
            })
    except Exception as exc:  # pragma: no cover
        logger.warning("project_products: executions unavailable for %s: %s",
                       project_id, exc)
    return out


__all__ = ["PRODUCT_KINDS", "DEFAULT_LIMIT", "list_products", "list_executions"]
