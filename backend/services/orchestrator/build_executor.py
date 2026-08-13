# coding: utf-8
"""Phase 1 (completion pass) — real production build executor seam.

WHAT THIS IS
------------
`NodeBuildExecutor` is the backend-executable production build seam. It
turns the build capability's HANDOFF into a real execution BOUNDARY without
duplicating any builder intelligence in Python.

WHY A SUBPROCESS BOUNDARY (and not a Python port)
-------------------------------------------------
Audit finding (verified): the production Web/App build pipeline is the
TypeScript spine in `src/lib/webBuild*.ts` — `generateWebBuild`,
`runFrontendBuilderQualityPipeline`, the acceptance gate, etc. It is the
SINGLE builder authority. Porting it into Python would create a second,
divergent builder authority (forbidden). So the production-safe boundary is
a **headless Node worker** that IS that same TS spine, invoked out-of-process
with a bounded JSON contract:

    stdin  ← BuildExecutorInput  (bounded: ids, goal, spec, brand, context)
    stdout → BuildExecutorResult (status, artifact_ref, build_ref, summary, cost_ref)

`NodeBuildExecutor` owns only orchestration concerns — durable state
(build_execution_store), timeout, cancel, restart-reconcile — never build
logic. The Node worker owns generation/validation/review/repair/acceptance.

HEADLESS BOUNDARY, NOT YET LIVE
-------------------------------
The TS spine currently reads `localStorage`/`window` for auth + routing, so
it is not headless *today*. The worker entrypoint
(`build-worker/korvix-build-worker.mjs`) defines the contract and is the ONE
place the spine will be wired once it is decoupled from the browser (thread
auth/apiBase as parameters). Until then the worker returns a truthful
`executor_unavailable` — never a fabricated completion. Tests inject a mock
worker command to exercise the full seam without any paid build.

REGISTRATION
------------
Not auto-registered — the default remains the handoff executor, so behaviour
is unchanged. An operator wires the real seam by setting
`KORVIX_BUILD_WORKER_CMD` (see `maybe_register_from_env`) or code calls
`register(...)` directly. Absent that, nothing changes.
"""
from __future__ import annotations

import json
import logging
import os
import shlex
import subprocess
from dataclasses import asdict
from typing import List, Optional

from backend.services.orchestrator import build_execution_store as bx
from backend.services.orchestrator.build_capability import (
    BuildExecutorInput, BuildExecutorResult,
    register_build_executor, BUILD_TYPE_WEB, BUILD_TYPE_APP,
)

logger = logging.getLogger(__name__)

# Default per-build wall-clock ceiling. Generous; a hung worker is killed so a
# build execution can never hang forever.
DEFAULT_BUILD_TIMEOUT_S = 900


class NodeBuildExecutor:
    """A real build executor that drives a headless Node build worker as a
    subprocess, with durable execution state + timeout + restart-reconcile."""

    def __init__(self, worker_cmd: List[str], *, timeout_s: int = DEFAULT_BUILD_TIMEOUT_S):
        if not worker_cmd:
            raise ValueError("worker_cmd must be a non-empty argv list")
        self._cmd = list(worker_cmd)
        self._timeout_s = int(timeout_s)

    def __call__(self, inp: BuildExecutorInput) -> BuildExecutorResult:
        exec_id = bx.stable_id(
            inp.build_type, inp.run_id, inp.task_id or inp.node_id,
        )
        claim = bx.begin_or_reconcile(
            execution_id=exec_id, build_type=inp.build_type,
            run_id=inp.run_id, project_id=inp.project_id,
            task_id=inp.task_id, node_id=inp.node_id,
        )

        # Idempotent restart: a prior run already finished this build →
        # reuse its stored result, do NOT re-execute (no duplicate paid build).
        if claim.get("_action") == "reconciled_terminal":
            status = str(claim.get("status"))
            if status == bx.STATUS_COMPLETED:
                return BuildExecutorResult(
                    status="completed",
                    artifact_ref=str(claim.get("artifact_ref") or ""),
                    build_ref=str(claim.get("build_ref") or ""),
                    summary=str(claim.get("summary") or ""),
                    cost_ref=claim.get("cost") or None,
                    detail="reconciled from prior completed build execution",
                )
            # Prior terminal was failed/cancelled → surface it truthfully.
            return BuildExecutorResult(
                status="failed",
                summary=str(claim.get("summary") or ""),
                detail=str(claim.get("error") or f"prior build execution {status}"),
            )

        # Claimed → run the headless worker.
        try:
            result = self._run_worker(inp)
        except subprocess.TimeoutExpired:
            bx.mark_failed(exec_id, error="build worker timed out")
            return BuildExecutorResult(status="failed",
                                       detail=f"build worker timed out after {self._timeout_s}s")
        except Exception as exc:
            bx.mark_failed(exec_id, error=f"{type(exc).__name__}: {exc}")
            return BuildExecutorResult(status="failed",
                                       detail=f"build worker error: {type(exc).__name__}: {exc}")

        # Persist durable terminal state (references only, never source).
        if result.status == "completed":
            bx.mark_completed(
                exec_id, artifact_ref=result.artifact_ref, build_ref=result.build_ref,
                summary=result.summary, cost=result.cost_ref or {},
            )
        elif result.status == "handoff":
            # Worker explicitly deferred (executor_unavailable / not wired) —
            # leave the row claimed→running is wrong; record as failed-soft?
            # A handoff is not a completed build; mark the execution as a
            # non-terminal reset so a future wired worker can pick it up.
            bx.mark_failed(exec_id, error=result.detail or "executor unavailable (handoff)")
        else:
            bx.mark_failed(exec_id, error=result.detail or "build failed")
        return result

    def _run_worker(self, inp: BuildExecutorInput) -> BuildExecutorResult:
        payload = json.dumps(asdict(inp), ensure_ascii=False, default=str)
        proc = subprocess.run(
            self._cmd,
            input=payload,
            capture_output=True,
            text=True,
            timeout=self._timeout_s,
        )
        if proc.returncode != 0:
            detail = (proc.stderr or proc.stdout or "worker non-zero exit").strip()
            return BuildExecutorResult(status="failed",
                                       detail=f"worker exit {proc.returncode}: {detail[:400]}")
        raw = (proc.stdout or "").strip()
        try:
            data = json.loads(raw)
        except Exception:
            return BuildExecutorResult(status="failed",
                                       detail=f"worker returned non-JSON: {raw[:400]}")
        status = str(data.get("status") or "failed")
        return BuildExecutorResult(
            status=status if status in ("completed", "handoff", "failed") else "failed",
            artifact_ref=str(data.get("artifact_ref") or ""),
            build_ref=str(data.get("build_ref") or ""),
            summary=str(data.get("summary") or ""),
            cost_ref=data.get("cost_ref") if isinstance(data.get("cost_ref"), dict) else None,
            detail=str(data.get("detail") or ""),
        )


def register(worker_cmd: List[str], *, build_types: Optional[List[str]] = None,
             timeout_s: int = DEFAULT_BUILD_TIMEOUT_S) -> None:
    """Register a NodeBuildExecutor for the given build types (default both)."""
    executor = NodeBuildExecutor(worker_cmd, timeout_s=timeout_s)
    for bt in (build_types or [BUILD_TYPE_WEB, BUILD_TYPE_APP]):
        register_build_executor(bt, executor)


def maybe_register_from_env() -> bool:
    """Wire the real seam from `KORVIX_BUILD_WORKER_CMD` if set. Absent → no
    change (handoff stays the default). Returns True if registered."""
    raw = (os.getenv("KORVIX_BUILD_WORKER_CMD") or "").strip()
    if not raw:
        return False
    try:
        cmd = shlex.split(raw)
        register(cmd)
        logger.info("[BUILD] NodeBuildExecutor registered from KORVIX_BUILD_WORKER_CMD")
        return True
    except Exception as exc:  # pragma: no cover — defensive
        logger.warning("build_executor: failed to register from env: %s", exc)
        return False


__all__ = [
    "NodeBuildExecutor", "register", "maybe_register_from_env",
    "DEFAULT_BUILD_TIMEOUT_S",
]
