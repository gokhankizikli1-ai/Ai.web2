# coding: utf-8
"""
Build-task provider routing (Phase 1: skeleton + decision-only shadow mode).

A small, centralized, server-authoritative policy that computes which provider
/model the Web Build and App Build tasks WOULD use, without changing execution.
Phase 1 ships two modes only — `disabled` (default; byte-identical behavior) and
`shadow` (compute + log the decision, zero Anthropic calls). See `policy.py`.

Public surface (all decision-only, never raise, never call a provider):

    from backend.services import build_routing
    build_routing.note_web_build_frontend_task(frontend_kind, executed_model=...)
    build_routing.note_web_build_planning(executed_model=..., is_repair=...)
    build_routing.note_app_build_agent_run(spec_id=..., deliverable_kind=..., executed_model=...)
    build_routing.describe_readiness()      # owner-only diagnostics snapshot
    build_routing.routing_mode()            # "disabled" | "shadow"
"""
from backend.services.build_routing import types, policy, execution
from backend.services.build_routing.types import (
    BuildRoutingDecision,
    MODE_DISABLED, MODE_SHADOW, MODE_OWNER_ONLY, MODE_ALL_USERS,
    VALID_MODES, REAL_EXECUTION_MODES,
    VALID_TASK_KINDS, WEB_BUILD_TASK_KINDS, APP_BUILD_TASK_KINDS,
    POLICY_VERSION,
)
from backend.services.build_routing.policy import (
    routing_mode, decide, claude_planning_eligible,
    web_task_from_frontend_kind, app_task_from_markers,
    note_web_build_frontend_task, note_web_build_planning, note_app_build_agent_run,
    record_execution, describe_readiness,
)
from backend.services.build_routing.execution import execute_website_planning

__all__ = [
    "types", "policy", "execution",
    "BuildRoutingDecision",
    "MODE_DISABLED", "MODE_SHADOW", "MODE_OWNER_ONLY", "MODE_ALL_USERS",
    "VALID_MODES", "REAL_EXECUTION_MODES",
    "VALID_TASK_KINDS", "WEB_BUILD_TASK_KINDS", "APP_BUILD_TASK_KINDS",
    "POLICY_VERSION",
    "routing_mode", "decide", "claude_planning_eligible",
    "web_task_from_frontend_kind", "app_task_from_markers",
    "note_web_build_frontend_task", "note_web_build_planning", "note_app_build_agent_run",
    "record_execution", "describe_readiness",
    "execute_website_planning",
]
