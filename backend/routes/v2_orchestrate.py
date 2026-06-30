# coding: utf-8
# Phase 3.4 — Orchestrator HTTP entrypoint.
#
# POST /v2/orchestrate
#   Body:
#     user_id    str        — owning user
#     message    str        — user request handed to the supervisor
#     project_id str?       — optional project namespace for shared
#                             memory injection (Phase 2)
#     agent_id   str?       — root agent (default "supervisor")
#     mode       str?       — optional mode hint surfaced in metadata
#     metadata   dict?      — additive bag, echoed in the run row
#
#   Response (200):
#     run_id        str
#     reply         str
#     agent_id      str         — root agent
#     agents_used   list[str]   — every spec.id touched (root + sub-agents)
#     trace         dict        — compact summary (counts, last error)
#     metadata      dict        — token estimate, budgets used, etc.
#
# Errors are surfaced as HTTPException:
#   503  ENABLE_ORCHESTRATOR is off
#   404  Unknown agent_id
#   422  Validation (Pydantic)
#   500  Orchestrator crash (still records the run row as 'errored')
#
# Gated by ENABLE_ORCHESTRATOR (default false). Project context
# injection is gated by ENABLE_PROJECTS (Phase 2 default). Realtime
# events fire only when ENABLE_REALTIME_EVENTS=true (Phase 3.2 default
# off). Each flag is independent — the orchestrator works with any
# combination.

import logging
import os
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

# Module-level imports so tests can monkeypatch `run_agent` on this
# module without breaking the production import path. The runtime
# itself is cheap to import (no network / no DB).
from backend.services.agent.runtime import run_agent
from backend.services.agent.types import AgentRequest

router = APIRouter(prefix="/v2/orchestrate", tags=["orchestrator"])
logger = logging.getLogger(__name__)


def _enabled() -> bool:
    return os.getenv("ENABLE_ORCHESTRATOR", "false").strip().lower() == "true"


def _ensure_enabled() -> None:
    if not _enabled():
        raise HTTPException(
            status_code=503,
            detail={
                "error":    "orchestrator_disabled",
                "message":  "Orchestrator is disabled. Set ENABLE_ORCHESTRATOR=true to activate.",
                "rollback": "Unset ENABLE_ORCHESTRATOR (or set 'false') to disable again.",
            },
        )


# Bring up runs + tasks tables once at import time when the flag is on.
if _enabled():
    try:
        from backend.services.orchestrator import (
            init_runs_table as _init_runs,
            init_tasks_table as _init_tasks,
        )
        _init_runs()
        _init_tasks()     # Phase 5.1 — task graph storage
        logger.info("orchestrator tables initialized (runs + tasks)")
    except Exception as exc:  # pragma: no cover — defensive
        logger.warning("orchestrator.runs_table init failed: %s", exc)


# ── Request / response models ──────────────────────────────────────────

class OrchestrateRecentMessage(BaseModel):
    role:    str = Field(..., pattern="^(user|assistant|system)$")
    content: str = Field(..., min_length=1, max_length=8_000)


class OrchestrateBody(BaseModel):
    user_id:         str
    message:         str = Field(..., min_length=1, max_length=20_000)
    project_id:      Optional[str] = None
    agent_id:        Optional[str] = "supervisor"
    mode:            Optional[str] = None
    metadata:        Optional[Dict[str, Any]] = None
    # Phase 4.2 — frontend can pass the last N messages from the
    # project chat so the supervisor + downstream specialists have
    # conversation continuity. Cap is enforced server-side (last 12
    # messages used regardless of how many are sent).
    recent_messages: Optional[List[OrchestrateRecentMessage]] = None


# ── Health ─────────────────────────────────────────────────────────────

@router.get("/health")
def orchestrate_health() -> dict:
    """Always-callable status endpoint — reports flag state + counts."""
    stats: dict = {}
    if _enabled():
        try:
            from backend.services.orchestrator import runs_stats
            stats = runs_stats()
        except Exception as exc:
            stats = {"error": str(exc)}
    return {
        "enabled":  _enabled(),
        "phase":    "3.4 — supervisor + delegate over HTTP",
        "depends_on": {
            "ENABLE_PROJECTS":       os.getenv("ENABLE_PROJECTS", "false"),
            "ENABLE_REALTIME_EVENTS": os.getenv("ENABLE_REALTIME_EVENTS", "false"),
        },
        "limits": {
            "max_depth":          os.getenv("ORCHESTRATOR_MAX_DEPTH", "2"),
            # Phase 4.1 raised defaults to accommodate 5-agent panels
            "max_parallel":       os.getenv("ORCHESTRATOR_MAX_PARALLEL", "5"),
            "total_token_budget": os.getenv("ORCHESTRATOR_TOTAL_TOKEN_BUDGET", "80000"),
        },
        # Phase 4.2 — model routing config so operators can see which
        # tier env vars are configured + which models are effective.
        "model_routing": _routing_summary_safe(),
        "stats":    stats,
    }


def _routing_summary_safe() -> dict:
    """Lazy + defensive — model_routing module is small + side-effect
    free, but isolate the import so /health never errors."""
    try:
        from backend.services.agent.model_routing import routing_summary
        return routing_summary()
    except Exception as exc:
        return {"error": str(exc)}


# ── Main route ─────────────────────────────────────────────────────────

@router.post("")
async def orchestrate(body: OrchestrateBody, request: Request) -> dict:
    _ensure_enabled()

    # ── 0a. Authoritative identity ─────────────────────────────────────
    # SECURITY: never trust body.user_id for identity. A logged-in client
    # could otherwise orchestrate (and write run/task rows) under another
    # account by putting a different user_id in the payload. Resolve from
    # the authenticated context (verified JWT → guest nonce → body
    # fallback) via the SAME helper /chat uses. body.user_id is only used
    # as a last-resort legacy fallback for anonymous, header-less clients.
    from backend.core.deps import resolve_authoritative_uid
    resolved_uid = resolve_authoritative_uid(
        request, str(body.user_id or ""), log_prefix="ORCH",
    )

    # ── 0. Owner-session detection ─────────────────────────────────────
    # Run BEFORE spec lookup so the policy decision is visible across
    # the rest of this function (system prompt, start_run, audit).
    # Two paths checked, in order:
    #   - identity: request.state.user (set by AuthMiddleware when on)
    #     matches OWNER_EMAIL / OWNER_ID via admin.owner.is_owner()
    #   - token:    X-Korvix-Owner-Token header matches OWNER_TOKEN
    # Either match yields is_owner=True; the source string distinguishes
    # them for audit + the FE activity feed.
    # Identity-first precedence (matches admin.owner.is_owner_request):
    # an AUTHENTICATED non-owner can NEVER be promoted via OWNER_TOKEN.
    # Otherwise a leftover token in localStorage would override a real
    # sign-in. Token unlock is reserved for guests / no-email identities.
    is_owner_session = False
    owner_source = ""
    owner_name = ""
    owner_email = ""
    try:
        from backend.core.deps import current_user, _extract_owner_token
        from backend.services.admin.owner import (
            is_owner as _ident_is_owner,
            match_owner_token as _match_tok,
            _user_email as _email_of,
        )
        _u = current_user(request)
        _ot = _extract_owner_token(request)
        if not _u.is_guest:
            # Authenticated path — identity is authoritative.
            email = _email_of(_u)
            if email:
                if _ident_is_owner(_u):
                    is_owner_session, owner_source = True, "identity"
                    owner_email = email
                    owner_name = getattr(_u, "display_name", "") or ""
                # else: signed in but NOT the owner. Do NOT consult token.
            else:
                # Authenticated but no email extractable (degraded
                # JWT). Fall through to token check.
                if _ot and _match_tok(_ot):
                    is_owner_session, owner_source = True, "token"
        else:
            # Guest — token-only unlock allowed.
            if _ot and _match_tok(_ot):
                is_owner_session, owner_source = True, "token"
    except Exception as _owner_err:  # pragma: no cover — never break orchestrate
        logger.debug("orchestrate | owner detection failed: %s", _owner_err)

    # ── 1. Resolve the root agent spec ─────────────────────────────────
    target_id = (body.agent_id or "supervisor").strip()
    from backend.services.agent.specs import get_spec
    spec = get_spec(target_id)
    if spec is None:
        raise HTTPException(
            status_code=404,
            detail={"error": "agent_not_found", "agent_id": target_id},
        )

    # ── 2. Build project context block (Phase 2 integration) ───────────
    project_block = ""
    project_ctx_token = None
    if body.project_id:
        try:
            from backend.services.projects.context import (
                build_project_context_block, set_current_project_context,
            )
            project_block = build_project_context_block(body.project_id) or ""
            if project_block:
                project_ctx_token = set_current_project_context(project_block)
        except Exception as exc:
            logger.debug("orchestrate | project context skipped (%s)", exc)

    # ── 3. Create the run row ─────────────────────────────────────────
    from backend.services.orchestrator import (
        create_run, finish_run, error_run, init_runs_table,
    )
    # Defensive: ensure table exists (in case the import-time init was skipped)
    try: init_runs_table()
    except Exception: pass

    from backend.services.agent.run_context import start_run, get_current_run
    # Generate a run id up front so we can pin both the DB row and the
    # RunContext to the same id — events / traces / DB stay correlated.
    import uuid as _uuid
    run_id = _uuid.uuid4().hex[:12]

    create_run(
        run_id=run_id,
        user_id=resolved_uid,
        project_id=body.project_id,
        agent_id=spec.id,
        metadata={
            "spec_kind": spec.kind,
            "mode_hint": body.mode,
            **(body.metadata or {}),
        },
    )

    # ── 4. Build the AgentRequest. Phase 3.6: if the caller's
    # target is the Supervisor AND a project_id is set, augment the
    # supervisor's system prompt with a list of project-specific
    # agents so the supervisor knows it can delegate to them
    # (their agent_ids resolve via Phase 3.3's get_spec fallback).
    # Phase 4.2 — model routing for the supervisor. Same resolution as
    # specialists go through inside delegate(), so a Railway operator
    # setting MODEL_ORCHESTRATOR=gpt-4o gets it applied here too.
    from backend.services.agent.model_routing import (
        resolve_model_for_spec, log_model_selection,
    )
    selected_supervisor_model = resolve_model_for_spec(spec)
    log_model_selection(spec, selected_supervisor_model, run_id=run_id)

    effective_system_prompt = spec.system_prompt
    if spec.id == "supervisor" and body.project_id:
        try:
            from backend.services.projects import list_agents as _list_project_agents
            proj_agents = _list_project_agents(body.project_id)
        except Exception:
            proj_agents = []
        if proj_agents:
            lines = ["", "PROJECT AGENTS AVAILABLE (prefer over built-ins when role matches):"]
            for pa in proj_agents:
                lines.append(f"  - {pa.id}  ({pa.role or pa.name})")
            effective_system_prompt = (
                spec.system_prompt + "\n" + "\n".join(lines) +
                "\n\nCall delegate(agent_id=<id-above>, task=...) using the "
                "exact id listed above to invoke a project agent."
            )

    # Phase 4.2 — recent messages context. When the frontend sends
    # the last N project messages, append them to the supervisor's
    # prompt so it has conversation continuity (mirrors how /chat
    # auto-includes per-user history). Capped at 12 messages /
    # 6k chars total to keep prompt size bounded.
    if body.recent_messages:
        history_lines = ["", "RECENT CONVERSATION (most recent last):"]
        total_chars = 0
        for m in body.recent_messages[-12:]:
            speaker = m.role.upper()
            text = m.content.strip()
            if not text:
                continue
            line = f"  [{speaker}] {text[:600]}"
            if total_chars + len(line) > 6000:
                history_lines.append("  …[truncated]")
                break
            history_lines.append(line)
            total_chars += len(line)
        if len(history_lines) > 2:  # something was actually appended
            effective_system_prompt += "\n" + "\n".join(history_lines)

    # Owner orchestration policy — applied LAST so it sits closest to
    # the user message in the assembled prompt (strongest signal). The
    # composer is a no-op when is_owner_session is false, so this line
    # is safe to leave unconditional.
    try:
        from backend.services.admin.orchestration import compose_system_prompt
        effective_system_prompt = compose_system_prompt(
            effective_system_prompt,
            is_owner=is_owner_session,
            user_message=body.message,
            owner_name=owner_name or None,
            owner_email=owner_email or None,
        )
    except Exception as _pol_err:  # pragma: no cover — never break orchestrate
        logger.warning("orchestrate | owner policy composer failed: %s", _pol_err)

    agent_request = AgentRequest(
        user_message=body.message.strip(),
        mode=(body.mode or spec.id),
        user_id=str(resolved_uid),
        # Phase 4.2 — env-tiered model routing (was spec.default_model).
        model=selected_supervisor_model,
        temperature=spec.temperature,
        max_tokens=2000,
        system_prompt=effective_system_prompt,
        max_steps=spec.max_steps,
        spec=spec,                                     # Phase 3.4 — enables spec-aware path
        metadata_in={
            "orchestrator_entry": True,
            "run_id":             run_id,
            "project_id":         body.project_id,
        },
    )

    # ── 5. Push the RunContext + invoke the runtime ────────────────────
    reply = ""
    response = None
    err_msg: Optional[str] = None
    try:
        with start_run(
            user_id=resolved_uid,
            project_id=body.project_id,
            project_context_block=project_block,
            run_id=run_id,
            metadata={
                "entry":        "v2_orchestrate",
                "spec_id":      spec.id,
                "is_owner":     is_owner_session,
                "owner_source": owner_source,
            },
            is_owner=is_owner_session,
            owner_source=owner_source,
        ):
            response = await run_agent(agent_request)
            reply = response.reply or ""
    except Exception as exc:  # pragma: no cover — runtime swallows internally
        err_msg = f"{type(exc).__name__}: {exc}"
        logger.exception("orchestrate | runtime raised unexpectedly")
    finally:
        # Always release the Phase 2 ContextVar push.
        if project_ctx_token is not None:
            try:
                from backend.services.projects.context import reset_current_project_context
                reset_current_project_context(project_ctx_token)
            except Exception:
                pass

    # ── 6. Read aggregate scratch counters (set by delegate.py) ───────
    # NOTE: the RunContext has been popped at this point — the scratch
    # dict was shared by reference into delegate's child contexts, so
    # we can't easily re-read it. We carry the data out via the
    # response.metadata that delegate populated. For aggregates, use
    # the trace and the response itself.

    agents_used: List[str] = [spec.id]
    delegations: int = 0
    if response is not None:
        # Count delegate steps in the trace to derive agents_used + delegations.
        for step in (response.trace or []):
            if getattr(step, "kind", "") == "tool_call" and getattr(step, "name", "") == "delegate":
                delegations += 1
                # The delegate result envelope was JSON-serialized into the
                # tool message; output.agent_id surfaces the chosen specialist.
                out = getattr(step, "output", None) or {}
                if isinstance(out, dict):
                    sub_id = (out.get("output") or {}).get("agent_id") if isinstance(out.get("output"), dict) else None
                    if sub_id and sub_id not in agents_used:
                        agents_used.append(sub_id)

    # ── 7. Finalize the run row ────────────────────────────────────────
    if err_msg or response is None:
        error_run(run_id, error=err_msg or "no response")
    else:
        finish_run(
            run_id,
            reply_chars=len(reply or ""),
            trace_steps=len(response.trace or []),
            tool_calls=getattr(response, "tool_calls", 0),
            delegations=delegations,
            metadata={
                "elapsed_ms":  getattr(response, "elapsed_ms", 0),
                "partial":     bool(getattr(response, "partial", False)),
                "fallback":    bool(getattr(response, "fallback", False)),
                "steps_used":  getattr(response, "steps_used", 0),
                "agents_used": agents_used,
            },
        )

    # ── 8. Response envelope ───────────────────────────────────────────
    if err_msg:
        raise HTTPException(
            status_code=500,
            detail={
                "error":   "orchestrator_crashed",
                "run_id":  run_id,
                "message": err_msg,
            },
        )

    trace_summary = {
        "steps":       len(response.trace or []) if response else 0,
        "tool_calls":  getattr(response, "tool_calls", 0) if response else 0,
        "delegations": delegations,
        "partial":     bool(getattr(response, "partial", False)) if response else False,
        "fallback":    bool(getattr(response, "fallback", False)) if response else True,
    }

    # Phase 5.1 — task graph envelope. Loaded from the persistent
    # tasks_store so the response carries the full per-task lifecycle
    # the frontend can render as a timeline. When no tasks were
    # created (older runs, /chat fallback, or first deploy before
    # tasks_table init), this returns an empty graph — the response
    # shape stays stable so the frontend always gets the field.
    task_graph_envelope: dict = {
        "run_id": run_id, "tasks": [],
        "counts": {}, "total_count": 0, "total_duration_ms": 0,
    }
    try:
        from backend.services.orchestrator import ExecutionGraph
        task_graph_envelope = ExecutionGraph.for_run(run_id).to_envelope()
    except Exception as exc:
        logger.debug("orchestrate | task_graph envelope soft-failed: %s", exc)

    # Owner-session payload — the FE reads metadata.owner_session to
    # render the "Owner Session Active" chip in the activity feed
    # without a separate /v2/admin/status round-trip. is_owner=false
    # for everyone else; the field always exists so the FE can use a
    # stable type.
    owner_session_payload: Dict[str, Any] = {
        "is_owner":     is_owner_session,
        "source":       owner_source,
        "capabilities": [],
    }
    if is_owner_session:
        try:
            from backend.services.admin.orchestration import owner_context_for_run
            owner_session_payload = owner_context_for_run(
                is_owner=True, source=owner_source,
            ).to_dict()
        except Exception:
            pass

    return {
        "run_id":      run_id,
        "reply":       reply,
        "agent_id":    spec.id,
        "agents_used": agents_used,
        "trace":       trace_summary,
        "task_graph":  task_graph_envelope,   # Phase 5.1
        "metadata": {
            "project_id":         body.project_id,
            "project_context":    bool(project_block),
            "elapsed_ms":         getattr(response, "elapsed_ms", 0) if response else 0,
            "model":              spec.default_model,
            "max_depth":          int(os.getenv("ORCHESTRATOR_MAX_DEPTH", "2")),
            "max_parallel":       int(os.getenv("ORCHESTRATOR_MAX_PARALLEL", "5")),
            "total_token_budget": int(os.getenv("ORCHESTRATOR_TOTAL_TOKEN_BUDGET", "80000")),
            # Owner-session signal for the FE — always present, false
            # for ordinary users. The capability list lets the FE
            # render exactly what the owner has unlocked this turn.
            "owner_session":      owner_session_payload,
        },
    }


# ── Read-route authorization helpers ──────────────────────────────────
#
# SECURITY (audit P0): the run/task read routes used to be fully open —
# any caller could enumerate ANY user's runs/tasks by guessing a user_id
# or run_id. We close the cross-tenant hole WITHOUT breaking the product's
# first-class guest support:
#
#   - AUTHENTICATED (non-guest) caller → scoped to their own data; an
#     attempt to read another user's run/task graph returns 404 (existence-
#     hiding), unless they are the owner (owners may inspect everything).
#   - GUEST / anonymous caller → legacy behaviour: results are scoped by
#     the identifiers they explicitly pass. Guests have no server-verified
#     identity to enforce, and this preserves the existing FE + test
#     contract for the (default-OFF) orchestrator.
#
# The whole router is gated by ENABLE_ORCHESTRATOR, so this is hardening
# applied BEFORE the surface is ever enabled in production.

def _has_verified_identity(request: Request) -> bool:
    """True when the request carries a server-VERIFIED identity (a valid
    JWT, or AuthMiddleware state) — as opposed to a guest nonce / body id.

    This is intentionally independent of whether the user row exists in the
    auth store: a token-only caller is still bound to its `sub`, and runs
    are keyed by that subject, so isolation must be enforced for them too.
    """
    if getattr(request.state, "is_guest", False) is True:
        return False
    st = getattr(request.state, "user_id", None)
    if isinstance(st, str) and st and st != "guest:anonymous":
        return True
    try:
        auth = (request.headers.get("authorization") or "").strip()
    except Exception:
        return False
    if auth.lower().startswith("bearer "):
        token = auth[7:].strip()
        if token:
            try:
                from backend.services.auth import tokens
                claims = tokens.verify(token, expected_type="access")
                return claims.get("kind") != "guest"
            except Exception:
                return False
    return False


def _caller(request: Request, body_user_id: str = "") -> tuple[str, bool, bool]:
    """Return (resolved_uid, is_authenticated, is_owner) for a read route."""
    from backend.core.deps import (
        current_user, resolve_authoritative_uid, _extract_owner_token,
    )
    resolved = resolve_authoritative_uid(request, str(body_user_id or ""), log_prefix="ORCH")
    is_authed = _has_verified_identity(request)
    is_owner = False
    try:
        u = current_user(request)
        from backend.services.admin.owner import is_owner_request
        is_owner = is_owner_request(u, owner_token=_extract_owner_token(request))
    except Exception:  # pragma: no cover — never let authz checks 500 a read
        pass
    return resolved, is_authed, is_owner


# ── Convenience read route — list a project's recent runs ─────────────
# Tiny GET so the frontend can render a "previous orchestrations" list
# in Phase 3.5 without needing a new endpoint then.

@router.get("/runs")
def list_runs_route(
    request: Request,
    user_id: Optional[str] = None,
    project_id: Optional[str] = None,
    limit: int = 50,
) -> dict:
    _ensure_enabled()
    from backend.services.orchestrator import list_runs
    resolved, is_authed, is_owner = _caller(request, user_id or "")
    # Owner → honour the explicit filter. Authenticated non-owner → force
    # scope to self (a spoofed ?user_id is ignored). Guest → legacy: honour
    # whatever user_id was passed.
    if is_owner:
        eff_user = user_id
    elif is_authed:
        eff_user = resolved
    else:
        eff_user = user_id
    rows = list_runs(user_id=eff_user, project_id=project_id, limit=limit)
    return {"runs": rows}


def _run_visible(row: dict, resolved: str, is_authed: bool, is_owner: bool) -> bool:
    """A run is visible to owners always; to an authenticated caller only
    when it is theirs; to guests/anonymous under the legacy open contract."""
    if is_owner:
        return True
    if is_authed:
        return str(row.get("user_id") or "") == str(resolved)
    return True


@router.get("/runs/{run_id}")
def get_run_route(run_id: str, request: Request) -> dict:
    _ensure_enabled()
    from backend.services.orchestrator import get_run
    row = get_run(run_id)
    resolved, is_authed, is_owner = _caller(request)
    # Hide existence on a cross-user read (404, not 403).
    if not row or not _run_visible(row, resolved, is_authed, is_owner):
        raise HTTPException(status_code=404, detail={"error": "run_not_found"})
    return row


# ── Phase 5.1 — task graph endpoints ──────────────────────────────────

@router.get("/runs/{run_id}/tasks")
def get_run_tasks_route(run_id: str, request: Request) -> dict:
    """Return the execution graph for a run. Used by the frontend to
    backfill after a tab refresh — the SSE stream only delivers events
    going forward, so on mount the UI fetches the historical task
    list from here."""
    _ensure_enabled()
    from backend.services.orchestrator import ExecutionGraph, get_run
    # Authorize against the parent run's ownership before returning its
    # task graph (same existence-hiding contract as GET /runs/{id}).
    row = get_run(run_id)
    resolved, is_authed, is_owner = _caller(request)
    if row is not None and not _run_visible(row, resolved, is_authed, is_owner):
        raise HTTPException(status_code=404, detail={"error": "run_not_found"})
    return ExecutionGraph.for_run(run_id).to_envelope()


@router.get("/projects/{project_id}/tasks")
def get_project_tasks_route(project_id: str, request: Request, limit: int = 100) -> dict:
    """List recent tasks for a project (across all runs). Cap at 500
    to bound payload size; default 100. Sorted newest-first."""
    _ensure_enabled()
    from backend.services.orchestrator import list_tasks_for_project, list_runs
    resolved, is_authed, is_owner = _caller(request)
    # Authenticated non-owner: only expose a project's tasks when at least
    # one run in that project belongs to them (existence-hiding 404 else).
    if is_authed and not is_owner:
        own = list_runs(user_id=resolved, project_id=project_id, limit=1)
        if not own:
            raise HTTPException(status_code=404, detail={"error": "project_not_found"})
    rows = list_tasks_for_project(
        project_id, limit=limit, user_id=resolved if is_authed and not is_owner else None,
    )
    return {"tasks": rows}
