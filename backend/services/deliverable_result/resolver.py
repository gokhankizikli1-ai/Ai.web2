# coding: utf-8
"""
Deliverable Result resolver.

Reads COMPLETED orchestrator deliverables and resolves them into a stable,
renderer-agnostic PreviewPayload. It builds on the orchestrator's existing
`get_run_snapshot` (which already enforces ownership + reconciles run status)
and `list_runs` — it does NOT create a second deliverable store and it never
fabricates output.

Module placement: sits in the orchestrator/project result domain. It imports
the orchestrator service; product_intelligence must NOT import this, and this
never imports a renderer or the website builder.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from backend.services.deliverable_result.types import (
    PreviewPayload, ResultStatus, SourceDeliverable,
)

logger = logging.getLogger(__name__)

# Preview kinds that represent a real product artifact, in priority order
# (a built HTML page beats an intermediate markdown planning doc).
_PREVIEW_PRIORITY = {"iframe": 0, "file_tree": 1, "code": 2, "markdown": 3}

_FAILED_RUN = {"failed", "errored"}
_CANCELLED_RUN = {"cancelled", "canceled"}
_DONE_RUN = {"completed", "finished"}


def _artifact_of(deliverable: dict) -> dict:
    content = deliverable.get("content") or {}
    art = content.get("artifact")
    return art if isinstance(art, dict) else {}


def _has_artifact(deliverable: dict) -> bool:
    return bool(_artifact_of(deliverable))


def _matches_filters(deliverable: dict, *, artifact_type: Optional[str], renderer: Optional[str]) -> bool:
    art = _artifact_of(deliverable)
    if artifact_type and str(art.get("type") or "") != artifact_type:
        return False
    if renderer and str(art.get("preview") or "") != renderer:
        return False
    return True


def _preview_rank(deliverable: dict) -> int:
    return _PREVIEW_PRIORITY.get(str(_artifact_of(deliverable).get("preview") or ""), 9)


def _select_final(
    completed: List[dict], *, artifact_type: Optional[str], renderer: Optional[str],
) -> Optional[dict]:
    """Pick the 'final' deliverable: the best preview tier (a built HTML page
    beats an intermediate planning doc), newest within that tier."""
    candidates = [d for d in completed if _matches_filters(d, artifact_type=artifact_type, renderer=renderer)]
    if not candidates:
        return None
    best_pref = min(_preview_rank(d) for d in candidates)
    tier = [d for d in candidates if _preview_rank(d) == best_pref]
    # Newest within the best tier (higher version, later updated_at).
    tier.sort(key=lambda d: (int(d.get("version") or 0), str(d.get("updated_at") or "")), reverse=True)
    return tier[0]


def _source_refs(deliverables: List[dict]) -> List[SourceDeliverable]:
    return [
        SourceDeliverable(
            id=str(d.get("id") or ""), node_id=str(d.get("node_id") or ""),
            kind=str(d.get("kind") or ""), status=str(d.get("status") or ""),
            agent_id=str(d.get("agent_id") or ""), title=str(d.get("title") or ""),
            version=int(d.get("version") or 0),
        )
        for d in deliverables
    ]


def _payload_from_final(
    final: dict, *, project_id: Optional[str], run_id: str, workflow_id: Optional[str],
    deliverables: List[dict],
) -> PreviewPayload:
    art = _artifact_of(final)
    content = final.get("content") or {}
    preview = str(art.get("preview") or "") or "none"
    body = art.get("content")
    summary = str(content.get("text") or "")[:600] or None
    return PreviewPayload(
        status=ResultStatus.COMPLETED,
        project_id=project_id, run_id=run_id, workflow_id=workflow_id,
        artifact_id=str(final.get("id") or "") or None,
        artifact_type=str(art.get("type") or final.get("kind") or "") or None,
        renderer=preview,
        title=str(art.get("title") or final.get("title") or "") or None,
        summary=summary,
        content=body if isinstance(body, str) else None,
        html_preview=body if (preview == "iframe" and isinstance(body, str)) else None,
        # The full artifact dict (type/files/download/preview) is the
        # renderer-agnostic structured payload future modules read.
        structured_data=art or None,
        source_deliverables=_source_refs(deliverables),
        created_at=final.get("created_at"),
        updated_at=final.get("updated_at"),
    )


def resolve_run_result(
    run_id: str,
    *,
    user_id: str,
    artifact_type: Optional[str] = None,
    renderer: Optional[str] = None,
    include_partial: bool = False,
) -> PreviewPayload:
    """Resolve a run's deliverables into a stable result payload.

    Ownership is enforced by get_run_snapshot (cross-user → NOT_FOUND).
    """
    try:
        from backend.services.orchestrator import get_run_snapshot
        snapshot = get_run_snapshot(run_id, user_id=user_id)
    except Exception as exc:  # pragma: no cover — never 500 on a read
        logger.warning("result resolver: snapshot failed: %s", exc)
        return PreviewPayload(status=ResultStatus.NOT_FOUND, run_id=run_id,
                              errors=["snapshot_unavailable"])
    if snapshot is None:
        return PreviewPayload(status=ResultStatus.NOT_FOUND, run_id=run_id)

    run = snapshot.get("run") or {}
    project_id = run.get("project_id")
    overall = str(snapshot.get("status") or run.get("status") or "").lower()
    wf = snapshot.get("workflow") or {}
    workflow_id = (wf.get("id") if isinstance(wf, dict) else None) or (run.get("metadata") or {}).get("workflow_id")
    deliverables = snapshot.get("deliverables") or []
    sources = _source_refs(deliverables)
    created_at = run.get("started_at") or run.get("created_at")
    updated_at = run.get("finished_at") or run.get("updated_at")

    def _base(status: ResultStatus, **kw) -> PreviewPayload:
        return PreviewPayload(
            status=status, project_id=project_id, run_id=run_id,
            workflow_id=workflow_id, source_deliverables=sources,
            created_at=created_at, updated_at=updated_at, **kw,
        )

    # ── Failure / cancellation — explicit terminal states ────────────────
    if overall in _FAILED_RUN:
        errs = [str(run.get("error") or "run_failed")]
        errs += [str(d.get("error")) for d in deliverables if d.get("status") == "failed" and d.get("error")]
        return _base(ResultStatus.FAILED, errors=errs)
    if overall in _CANCELLED_RUN:
        return _base(ResultStatus.CANCELLED, warnings=["run_cancelled"])

    completed = [d for d in deliverables if d.get("status") == "completed" and _has_artifact(d)]
    run_done = overall in _DONE_RUN

    # ── A final artifact exists → COMPLETED (or PARTIAL while running) ────
    final = _select_final(completed, artifact_type=artifact_type, renderer=renderer)
    if final is not None:
        # A real PRODUCT artifact (anything other than an intermediate
        # markdown planning doc) is COMPLETED even before the run finishes.
        # An intermediate-only result while the run is still going is PARTIAL.
        is_product = str(_artifact_of(final).get("preview") or "") != "markdown"
        if is_product or run_done:
            return _payload_from_final(
                final, project_id=project_id, run_id=run_id,
                workflow_id=workflow_id, deliverables=deliverables,
            )
        # markdown-only and run still in progress.
        if include_partial:
            payload = _payload_from_final(
                final, project_id=project_id, run_id=run_id,
                workflow_id=workflow_id, deliverables=deliverables,
            )
            payload.status = ResultStatus.PARTIAL
            payload.warnings.append("run still in progress; partial result")
            return payload
        return _base(ResultStatus.PARTIAL,
                     warnings=["intermediate deliverable ready; run in progress"])

    # Filters were supplied but nothing matched while artifacts DO exist.
    if (artifact_type or renderer) and completed:
        return _base(ResultStatus.ARTIFACT_NOT_FOUND,
                     warnings=[f"no deliverable matched filters "
                               f"(artifact_type={artifact_type}, renderer={renderer})"])

    # ── Terminal run, but no usable artifact ─────────────────────────────
    if overall in _DONE_RUN:
        if completed:
            # Completed deliverables exist but none was selectable as final
            # (e.g. only intermediate kinds) — surface the newest as partial
            # when allowed, else report no final artifact.
            if include_partial:
                newest = max(completed, key=lambda d: str(d.get("updated_at") or ""))
                return _payload_from_final(
                    newest, project_id=project_id, run_id=run_id,
                    workflow_id=workflow_id, deliverables=deliverables,
                )
            return _base(ResultStatus.PARTIAL, warnings=["completed deliverables present; pass include_partial=true"])
        return _base(ResultStatus.COMPLETED_NO_ARTIFACT,
                     warnings=["run finished without a final artifact"])

    # ── Still in progress ────────────────────────────────────────────────
    if completed:
        if include_partial:
            newest = max(completed, key=lambda d: str(d.get("updated_at") or ""))
            payload = _payload_from_final(
                newest, project_id=project_id, run_id=run_id,
                workflow_id=workflow_id, deliverables=deliverables,
            )
            payload.status = ResultStatus.PARTIAL
            payload.warnings.append("run still in progress; partial result")
            return payload
        return _base(ResultStatus.PARTIAL, warnings=["run in progress; some deliverables ready"])

    # No deliverables yet.
    if overall in ("running", "in_progress"):
        return _base(ResultStatus.RUNNING, warnings=["run in progress; no deliverables yet"])
    return _base(ResultStatus.PENDING, warnings=["run queued; nothing produced yet"])


def resolve_project_result(
    project_id: str,
    *,
    user_id: str,
    latest: bool = True,
    artifact_type: Optional[str] = None,
    renderer: Optional[str] = None,
    include_partial: bool = False,
) -> PreviewPayload:
    """Resolve the result of a project's most recent run (user-scoped)."""
    try:
        from backend.services.orchestrator import list_runs
        rows = list_runs(user_id=user_id, project_id=project_id, limit=50)
    except Exception as exc:  # pragma: no cover
        logger.warning("result resolver: list_runs failed: %s", exc)
        rows = []
    if not rows:
        return PreviewPayload(status=ResultStatus.NO_RUN, project_id=project_id,
                              warnings=["no run found for this project"])
    # list_runs is ordered newest-first; pick the latest run.
    chosen = rows[0] if latest else rows[-1]
    run_id = chosen.get("id") or chosen.get("run_id")
    payload = resolve_run_result(
        run_id, user_id=user_id, artifact_type=artifact_type,
        renderer=renderer, include_partial=include_partial,
    )
    payload.project_id = payload.project_id or project_id
    return payload


__all__ = ["resolve_run_result", "resolve_project_result"]
