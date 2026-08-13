# coding: utf-8
"""Phase 5 — cost enforcement + approval policy.

Covers the spec's scenarios:
  A. approved paid task executes
  B. same approved task retries safely without double charge (idempotent)
  C. task changed after approval → approval invalid
  D. insufficient credits → no paid execution
  E. global spend block → no paid execution
  F. free deterministic task → no approval required
"""
from __future__ import annotations

import importlib
from types import SimpleNamespace

import pytest


@pytest.fixture()
def policy_env(tmp_path, monkeypatch):
    monkeypatch.setenv("PROJECTS_DB_PATH", str(tmp_path / "projects.db"))
    monkeypatch.setenv("ENABLE_EXECUTION_APPROVAL", "true")
    from backend.services.orchestrator import (
        approvals_store, execution_policy, deliverables_store, tasks_store,
        build_capability,
    )
    importlib.reload(approvals_store)
    importlib.reload(execution_policy)
    importlib.reload(deliverables_store)
    importlib.reload(tasks_store)
    importlib.reload(build_capability)
    approvals_store.init_approvals_table()
    deliverables_store.init_deliverables_table()
    tasks_store.init_tasks_table()
    # Default the injectable cost gates to "OK" so approval is the variable
    # under test; individual tests override.
    monkeypatch.setattr(execution_policy, "_global_spend_ok", lambda uid: True)
    monkeypatch.setattr(execution_policy, "_credits_available", lambda uid, cap: True)
    yield approvals_store, execution_policy, deliverables_store, tasks_store, build_capability
    build_capability.unregister_build_executor("web")
    build_capability.unregister_build_executor("app")


# ── Policy classification ────────────────────────────────────────────────

def test_F_free_capability_is_auto(policy_env):
    _, ep, *_ = policy_env
    assert ep.classify_capability("research") == ep.POLICY_AUTO
    assert ep.classify_capability("product") == ep.POLICY_AUTO
    assert ep.classify_capability("plan") == ep.POLICY_AUTO
    d = ep.authorize(user_id="u1", capability="research", spec={})
    assert d.allowed and d.tier == ep.POLICY_AUTO


def test_paid_capability_is_approval_required(policy_env):
    _, ep, *_ = policy_env
    assert ep.classify_capability("web_build") == ep.POLICY_APPROVAL_REQUIRED
    assert ep.classify_capability("app_build") == ep.POLICY_APPROVAL_REQUIRED


def test_denied_capability_never_auto(policy_env):
    _, ep, *_ = policy_env
    d = ep.authorize(user_id="u1", capability="delete_project", spec={})
    assert not d.allowed and d.tier == ep.POLICY_DENIED


def test_A_approved_paid_task_is_allowed(policy_env):
    approvals, ep, *_ = policy_env
    spec = {"pages": ["home", "pricing"]}
    fp = ep.operation_fingerprint("web_build", spec)
    approvals.record_approval(user_id="u1", capability="web_build", fingerprint=fp)
    d = ep.authorize(user_id="u1", capability="web_build", spec=spec)
    assert d.allowed and d.code == ep.CODE_ALLOWED


def test_unapproved_paid_task_is_blocked(policy_env):
    _, ep, *_ = policy_env
    d = ep.authorize(user_id="u1", capability="web_build", spec={"x": 1})
    assert not d.allowed and d.code == ep.CODE_APPROVAL_REQUIRED


def test_C_changed_spec_invalidates_approval(policy_env):
    approvals, ep, *_ = policy_env
    spec_v1 = {"pages": ["home"]}
    approvals.record_approval(
        user_id="u1", capability="web_build",
        fingerprint=ep.operation_fingerprint("web_build", spec_v1),
    )
    # Approval holds for v1.
    assert ep.authorize(user_id="u1", capability="web_build", spec=spec_v1).allowed
    # Materially changed plan → different fingerprint → not approved.
    spec_v2 = {"pages": ["home", "checkout", "dashboard"]}
    d2 = ep.authorize(user_id="u1", capability="web_build", spec=spec_v2)
    assert not d2.allowed and d2.code == ep.CODE_APPROVAL_REQUIRED


def test_inline_user_approval_records_and_allows(policy_env):
    approvals, ep, *_ = policy_env
    spec = {"a": 1}
    d = ep.authorize(user_id="u1", capability="app_build", spec=spec,
                     inline_approval=True, approved_by="u1")
    assert d.allowed
    # Now durably recorded — a later (non-inline) authorize also passes.
    d2 = ep.authorize(user_id="u1", capability="app_build", spec=spec)
    assert d2.allowed


def test_D_insufficient_credits_blocks(policy_env, monkeypatch):
    approvals, ep, *_ = policy_env
    spec = {"a": 1}
    approvals.record_approval(
        user_id="u1", capability="web_build",
        fingerprint=ep.operation_fingerprint("web_build", spec),
    )
    monkeypatch.setattr(ep, "_credits_available", lambda uid, cap: False)
    d = ep.authorize(user_id="u1", capability="web_build", spec=spec)
    assert not d.allowed and d.code == ep.CODE_CREDIT_UNAVAILABLE


def test_E_global_spend_block(policy_env, monkeypatch):
    approvals, ep, *_ = policy_env
    spec = {"a": 1}
    approvals.record_approval(
        user_id="u1", capability="web_build",
        fingerprint=ep.operation_fingerprint("web_build", spec),
    )
    monkeypatch.setattr(ep, "_global_spend_ok", lambda uid: False)
    d = ep.authorize(user_id="u1", capability="web_build", spec=spec)
    assert not d.allowed and d.code == ep.CODE_GLOBAL_SPEND_BLOCK


# ── Enforcement dormant by default ───────────────────────────────────────

def test_enforcement_dormant_allows_everything(tmp_path, monkeypatch):
    monkeypatch.setenv("PROJECTS_DB_PATH", str(tmp_path / "projects.db"))
    monkeypatch.delenv("ENABLE_EXECUTION_APPROVAL", raising=False)
    from backend.services.orchestrator import execution_policy as ep
    importlib.reload(ep)
    assert not ep.is_enforced()
    d = ep.authorize(user_id="u1", capability="web_build", spec={"x": 1})
    assert d.allowed  # dormant → paid build not blocked


# ── Idempotent charging via settle_charge ────────────────────────────────

def test_B_settle_charge_is_idempotent(policy_env, monkeypatch):
    _, ep, *_ = policy_env
    charges = []

    class _FakeCredits:
        @staticmethod
        def is_enabled():
            return True

        @staticmethod
        def consume(user_id, amount, *, reason="", reference=None, metadata=None):
            # Emulate the ledger's UNIQUE (user_id, reference) idempotency.
            if reference in {c[2] for c in charges}:
                return SimpleNamespace(applied=True, reason_code="replay")
            charges.append((user_id, amount, reference))
            return SimpleNamespace(applied=True, reason_code="ok")

    import backend.services.billing.credits.service as credits_service
    monkeypatch.setattr(credits_service, "is_enabled", _FakeCredits.is_enabled)
    monkeypatch.setattr(credits_service, "consume", _FakeCredits.consume)

    ref = "wf:w1:step:s1"
    ok1 = ep.settle_charge(user_id="u1", capability="web_build", reference=ref)
    ok2 = ep.settle_charge(user_id="u1", capability="web_build", reference=ref)
    assert ok1 and ok2
    # Charged exactly once for the same stable reference.
    assert len(charges) == 1


# ── End-to-end through the build capability handler ──────────────────────

def _ctx(payload, user_id="u1", idem=None):
    from backend.services.jobs.registry import JobContext

    async def _report(pct, label=None):
        return None

    async def _cancelled():
        return False

    record = SimpleNamespace(id="job1", user_id=user_id, payload=payload,
                             idempotency_key=idem)
    return JobContext(record=record, report_progress=_report,
                      is_cancelled=_cancelled)


@pytest.mark.asyncio
async def test_build_handler_blocks_without_approval(policy_env):
    approvals, ep, ds, ts, bc = policy_env

    async def _mock(inp):
        return bc.BuildExecutorResult(status="completed", artifact_ref="r")

    bc.register_build_executor("web", _mock)
    did = ds.create_deliverable(run_id="r1", agent_id="b", node_id="web",
                                kind="web_build", project_id="p1")
    tid = ts.create_task(run_id="r1", title="web", assigned_agent="b", project_id="p1")

    with pytest.raises(RuntimeError):
        await bc._web_build_handler(_ctx({
            "run_id": "r1", "node_id": "web", "deliverable_id": did, "task_id": tid,
            "project_id": "p1", "product_spec": {"pages": ["home"]},
        }))
    d = ds.get_deliverable(did)
    assert d["status"] == "failed"
    assert d["content"]["requires_approval"] is True


@pytest.mark.asyncio
async def test_build_handler_runs_with_approval(policy_env):
    approvals, ep, ds, ts, bc = policy_env
    spec = {"pages": ["home"]}
    approvals.record_approval(
        user_id="u1", capability="web_build",
        fingerprint=ep.operation_fingerprint("web_build", spec),
    )

    async def _mock(inp):
        return bc.BuildExecutorResult(status="completed", artifact_ref="webrun:1")

    bc.register_build_executor("web", _mock)
    did = ds.create_deliverable(run_id="r1", agent_id="b", node_id="web",
                                kind="web_build", project_id="p1")
    tid = ts.create_task(run_id="r1", title="web", assigned_agent="b", project_id="p1")

    result = await bc._web_build_handler(_ctx({
        "run_id": "r1", "node_id": "web", "deliverable_id": did, "task_id": tid,
        "project_id": "p1", "product_spec": spec,
    }, idem="wf:w1:step:web"))
    assert result["build_status"] == "completed"
    assert ds.get_deliverable(did)["status"] == "completed"
