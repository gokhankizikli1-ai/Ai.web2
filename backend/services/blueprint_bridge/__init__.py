# coding: utf-8
"""
Blueprint → Orchestrator bridge.

The thin, typed connector that makes a ProductBlueprint actionable by the
existing Project Orchestrator — without either side importing the other.

    from backend.services.blueprint_bridge import plan_to_orchestration, dry_run, execute
    plan, request = plan_to_orchestration("build a landing page for a fintech startup")
    preview = dry_run(request)                 # no jobs, no LLM
    # result = await execute(request, user_id=principal.user_id)   # gated
"""
from backend.services.blueprint_bridge.adapter import blueprint_to_request
from backend.services.blueprint_bridge.bridge import (
    is_enabled, BridgeDisabled, plan_to_orchestration,
    execution_prerequisites, dry_run, execute,
)
from backend.services.blueprint_bridge.types import (
    OrchestrationRequest, ProposedStep, DryRunResult, ExecutionResult,
)

__all__ = [
    "blueprint_to_request",
    "is_enabled", "BridgeDisabled", "plan_to_orchestration",
    "execution_prerequisites", "dry_run", "execute",
    "OrchestrationRequest", "ProposedStep", "DryRunResult", "ExecutionResult",
]
