# coding: utf-8
"""
Web Build cost-attribution & duplicate-call AUDIT — focused tests.

Proves the audit measures correctly and conservatively: canonical stage/agent
attribution at record time, stable sequencing, deterministic duplicate / retry /
unused detection, PROVEN-only consumption, a conservative avoidable-cost
estimate, stage/build reconciliation, usage-missing preserved, and the owner
route's auth + privacy guarantees.

No model calls, no Web Build generation — everything drives the store/tracker
and the deterministic audit module directly.
"""
from __future__ import annotations

import importlib

import pytest

_OWNER_TOKEN = "k" * 32


@pytest.fixture()
def ct(tmp_path, monkeypatch):
    monkeypatch.setenv("COST_TRACKING_DB_PATH", str(tmp_path / "cost.db"))
    from backend.services.cost_tracking import store as s
    importlib.reload(s)
    from backend.services.cost_tracking import tracker as tr
    importlib.reload(tr)
    from backend.services.cost_tracking import audit as au
    importlib.reload(au)
    from backend.services.cost_tracking import types as T
    s._reset_for_tests()
    return {"store": s, "tracker": tr, "audit": au, "T": T}


def _rec(ct, build, *, op, stage=None, agent=None, model="gpt-5", inp=1000, out=500,
         success=True, retry=0, retry_reason=None, fp=None, ctx=0, usage_missing=False):
    T = ct["T"]
    return ct["tracker"].record_ai_call(
        build_id=build, user_id="42", provider="openai", model=model,
        operation_type=op, success=success, retry_number=retry, retry_reason=retry_reason,
        stage=stage, agent=agent, input_fingerprint=fp, context_bytes=ctx,
        usage=T.TokenUsage(input_tokens=inp, output_tokens=out, usage_missing=usage_missing),
    )


def _audit(ct, build):
    return ct["tracker"].build_audit(build)


# ── 1-4. canonical stage recorded for each real paid call site ───────────────
def test_canonical_stages_recorded(ct):
    T = ct["T"]
    b = "op1"
    _rec(ct, b, op=T.OP_PLANNING, stage=T.STAGE_WEB_BUILD_PLANNING, agent=T.AGENT_WEBSITE_BUILDER, fp="a")
    _rec(ct, b, op=T.OP_VISUAL, stage=T.STAGE_VISUAL_INTELLIGENCE, agent=T.AGENT_VISUAL_INTELLIGENCE, fp="b")
    ct["tracker"].record_tool_cost(build_id=b, user_id="42", tool_key="search.tavily", units=3,
                                   operation_type=T.OP_WEB_SEARCH, stage=T.STAGE_WEB_RESEARCH,
                                   agent=T.AGENT_RESEARCH)
    _rec(ct, b, op=T.OP_FRONTEND_GEN, stage=T.STAGE_FRONTEND_GENERATION, agent=T.AGENT_FRONTEND_BUILDER,
         inp=40000, out=15000, fp="c", ctx=160000)
    a = _audit(ct, b)
    stages = {s["stage"] for s in a["stages"]}
    assert {T.STAGE_WEB_BUILD_PLANNING, T.STAGE_VISUAL_INTELLIGENCE,
            T.STAGE_WEB_RESEARCH, T.STAGE_FRONTEND_GENERATION} <= stages
    # visual is its OWN stage, not collapsed into planning
    by = {c["stage"]: c for c in a["calls"]}
    assert by[T.STAGE_VISUAL_INTELLIGENCE]["agent"] == T.AGENT_VISUAL_INTELLIGENCE


# ── 5. repair/retry stage distinct from initial generation ───────────────────
def test_repair_stage_distinct(ct):
    T = ct["T"]
    b = "op2"
    _rec(ct, b, op=T.OP_PLANNING, stage=T.STAGE_WEB_BUILD_PLANNING, fp="x")
    _rec(ct, b, op=T.OP_PLANNING_REPAIR, stage=T.STAGE_PLANNING_REPAIR, retry=1,
         retry_reason="planning_contract", fp="y")
    a = _audit(ct, b)
    stages = {s["stage"] for s in a["stages"]}
    assert T.STAGE_WEB_BUILD_PLANNING in stages and T.STAGE_PLANNING_REPAIR in stages


# ── 6. sequence indexes are stable + monotonic ───────────────────────────────
def test_sequence_stable(ct):
    T = ct["T"]
    b = "op3"
    for i in range(4):
        _rec(ct, b, op=T.OP_PLANNING, stage=T.STAGE_WEB_BUILD_PLANNING, fp=f"f{i}")
    a = _audit(ct, b)
    seqs = [c["sequence"] for c in a["calls"]]
    assert seqs == [0, 1, 2, 3]
    # re-running the audit yields the identical order
    a2 = _audit(ct, b)
    assert [c["sequence"] for c in a2["calls"]] == seqs


# ── 7. retry number + reason preserved ───────────────────────────────────────
def test_retry_number_reason_preserved(ct):
    T = ct["T"]
    b = "op4"
    _rec(ct, b, op=T.OP_FRONTEND_GEN, stage=T.STAGE_FRONTEND_GENERATION, fp="z")
    _rec(ct, b, op=T.OP_CODEGEN_REPAIR, stage=T.STAGE_FRONTEND_REPAIR, retry=2, retry_reason="contract", fp="w")
    a = _audit(ct, b)
    rep = next(c for c in a["calls"] if c["stage"] == T.STAGE_FRONTEND_REPAIR)
    assert rep["retryNumber"] == 2 and rep["retryReason"] == "contract"


# ── 8. exact duplicate detected within one build ─────────────────────────────
def test_exact_duplicate_detected(ct):
    T = ct["T"]
    b = "op5"
    _rec(ct, b, op=T.OP_PLANNING, stage=T.STAGE_WEB_BUILD_PLANNING, fp="same")
    _rec(ct, b, op=T.OP_PLANNING, stage=T.STAGE_WEB_BUILD_PLANNING, fp="same")
    a = _audit(ct, b)
    dupes = [c for c in a["calls"] if c["duplicateKind"] == "exact_input_duplicate"]
    assert len(dupes) == 1 and a["build"]["duplicateCalls"] == 1


# ── 9. different builds are NOT grouped as duplicates ────────────────────────
def test_different_builds_not_duplicates(ct):
    T = ct["T"]
    _rec(ct, "bA", op=T.OP_PLANNING, stage=T.STAGE_WEB_BUILD_PLANNING, fp="shared")
    _rec(ct, "bB", op=T.OP_PLANNING, stage=T.STAGE_WEB_BUILD_PLANNING, fp="shared")
    assert _audit(ct, "bA")["build"]["duplicateCalls"] == 0
    assert _audit(ct, "bB")["build"]["duplicateCalls"] == 0


# ── 10. different models are NOT exact duplicates ────────────────────────────
def test_different_models_not_exact_duplicate(ct):
    T = ct["T"]
    b = "op6"
    _rec(ct, b, op=T.OP_PLANNING, stage=T.STAGE_WEB_BUILD_PLANNING, model="gpt-5", fp="same")
    _rec(ct, b, op=T.OP_PLANNING, stage=T.STAGE_WEB_BUILD_PLANNING, model="gpt-4o", fp="same")
    assert _audit(ct, b)["build"]["duplicateCalls"] == 0


# ── 11. unchanged-input retry is flagged ─────────────────────────────────────
def test_unchanged_input_retry_flagged(ct):
    T = ct["T"]
    b = "op7"
    _rec(ct, b, op=T.OP_FRONTEND_GEN, stage=T.STAGE_FRONTEND_GENERATION, fp="same")
    _rec(ct, b, op=T.OP_FRONTEND_GEN, stage=T.STAGE_FRONTEND_GENERATION, retry=1, fp="same")
    a = _audit(ct, b)
    flagged = [c for c in a["calls"] if "retry_without_input_change" in c["wasteFlags"]
               or c["duplicateKind"] in ("exact_input_duplicate", "retry_duplicate")]
    assert flagged


# ── 12. changed-input retry is NOT an exact duplicate ────────────────────────
def test_changed_input_retry_not_exact_duplicate(ct):
    T = ct["T"]
    b = "op8"
    _rec(ct, b, op=T.OP_FRONTEND_GEN, stage=T.STAGE_FRONTEND_GENERATION, fp="one")
    _rec(ct, b, op=T.OP_FRONTEND_GEN, stage=T.STAGE_FRONTEND_GENERATION, retry=1, fp="two")
    a = _audit(ct, b)
    assert all(c["duplicateKind"] != "exact_input_duplicate" for c in a["calls"])
    assert all("retry_without_input_change" not in c["wasteFlags"] for c in a["calls"])


# ── 13. consumed-output linkage works ────────────────────────────────────────
def test_consumption_proven(ct):
    T = ct["T"]
    b = "op9"
    _rec(ct, b, op=T.OP_PLANNING, stage=T.STAGE_WEB_BUILD_PLANNING, fp="p")
    _rec(ct, b, op=T.OP_FRONTEND_GEN, stage=T.STAGE_FRONTEND_GENERATION, fp="f")
    a = _audit(ct, b)
    plan = next(c for c in a["calls"] if c["stage"] == T.STAGE_WEB_BUILD_PLANNING)
    assert plan["outputConsumed"] == "yes"
    assert plan["consumedByStage"] == T.STAGE_FRONTEND_GENERATION


# ── 14. unknown consumption remains unknown (never guessed false) ────────────
def test_consumption_unknown_stays_unknown(ct):
    T = ct["T"]
    b = "op10"
    # a frontend generation with nothing after it → its consumption is unknown
    _rec(ct, b, op=T.OP_FRONTEND_GEN, stage=T.STAGE_FRONTEND_GENERATION, fp="only")
    a = _audit(ct, b)
    fe = a["calls"][0]
    assert fe["outputConsumed"] == "unknown"
    assert fe["consumedByStage"] is None


# ── 15. exact duplicate contributes to conservative waste estimate ───────────
def test_exact_duplicate_in_waste_estimate(ct):
    T = ct["T"]
    b = "op11"
    _rec(ct, b, op=T.OP_PLANNING, stage=T.STAGE_WEB_BUILD_PLANNING, inp=5000, out=1000, fp="d")
    _rec(ct, b, op=T.OP_PLANNING, stage=T.STAGE_WEB_BUILD_PLANNING, inp=5000, out=1000, fp="d")
    a = _audit(ct, b)
    assert a["build"]["wasteEstimateUsd"] > 0
    assert a["build"]["wasteEstimateConfidence"] == "high"


# ── 16. a large call ALONE is not counted as avoidable waste ─────────────────
def test_large_call_not_waste(ct):
    T = ct["T"]
    b = "op12"
    _rec(ct, b, op=T.OP_FRONTEND_GEN, stage=T.STAGE_FRONTEND_GENERATION,
         inp=90000, out=30000, fp="big", ctx=360000)
    a = _audit(ct, b)
    fe = a["calls"][0]
    assert "large_output" in fe["wasteFlags"]          # flagged as large…
    assert a["build"]["wasteEstimateUsd"] == 0.0        # …but NOT counted avoidable


# ── 17. historical generic row shows as unknown/generic ──────────────────────
def test_historical_generic_row(ct):
    T = ct["T"]
    b = "op13"
    # No stage/agent set, generic operation_type → inferred unknown + flagged
    _rec(ct, b, op=T.OP_OTHER, stage=None, agent=None, fp="g")
    a = _audit(ct, b)
    c = a["calls"][0]
    assert c["stage"] == T.STAGE_UNKNOWN
    assert "generic_stage_label" in c["wasteFlags"]


# ── 18/19. stage totals equal build total; percentages sum within tolerance ──
def test_stage_totals_reconcile(ct):
    T = ct["T"]
    b = "op14"
    _rec(ct, b, op=T.OP_PLANNING, stage=T.STAGE_WEB_BUILD_PLANNING, inp=5000, out=1000, fp="a")
    _rec(ct, b, op=T.OP_VISUAL, stage=T.STAGE_VISUAL_INTELLIGENCE, inp=3000, out=800, fp="b")
    _rec(ct, b, op=T.OP_FRONTEND_GEN, stage=T.STAGE_FRONTEND_GENERATION, inp=40000, out=15000, fp="c")
    a = _audit(ct, b)
    stage_sum = round(sum(s["costUsd"] for s in a["stages"]), 6)
    assert abs(stage_sum - a["build"]["totalCostUsd"]) < 1e-6
    pct_sum = sum(s["percentOfBuild"] for s in a["stages"])
    assert abs(pct_sum - 100.0) < 0.5


# ── 20. retry cost is correct ────────────────────────────────────────────────
def test_retry_cost_correct(ct):
    T = ct["T"]
    b = "op15"
    _rec(ct, b, op=T.OP_PLANNING, stage=T.STAGE_WEB_BUILD_PLANNING, inp=5000, out=1000, fp="a")
    _rec(ct, b, op=T.OP_PLANNING_REPAIR, stage=T.STAGE_PLANNING_REPAIR, retry=1,
         inp=5000, out=1000, fp="b")
    a = _audit(ct, b)
    retry_calls = [c for c in a["calls"] if c["retryNumber"] > 0]
    expected = round(sum(c["costUsd"] for c in retry_calls), 6)
    assert abs(a["build"]["retryCostUsd"] - expected) < 1e-6 and expected > 0


# ── 21. usage-missing stays missing, not zero ────────────────────────────────
def test_usage_missing_preserved(ct):
    T = ct["T"]
    b = "op16"
    _rec(ct, b, op=T.OP_FRONTEND_GEN, stage=T.STAGE_FRONTEND_GENERATION,
         success=False, usage_missing=True, inp=0, out=0, fp="m")
    a = _audit(ct, b)
    c = a["calls"][0]
    assert c["usageMissing"] is True
    assert a["build"]["usageMissingCalls"] == 1


# ── 25. audit payload carries NO fingerprint / prompt / secret ───────────────
def test_no_secrets_in_payload(ct):
    T = ct["T"]
    b = "op17"
    _rec(ct, b, op=T.OP_PLANNING, stage=T.STAGE_WEB_BUILD_PLANNING, fp="secret_fp_value", ctx=1234)
    a = _audit(ct, b)
    import json
    blob = json.dumps(a)
    assert "secret_fp_value" not in blob          # fingerprint never surfaced
    assert "input_fingerprint" not in blob
    for c in a["calls"]:
        assert "input_fingerprint" not in c and "inputFingerprint" not in c
        assert c["contextBytes"] == 1234           # size is exposed; content is not


# ── frontend-gen input attribution survives the background link boundary ─────
def test_background_link_carries_context(ct):
    b = "op18"
    ct["tracker"].link_background_job(job_id="job_x", build_id=b, user_id="42",
                                      input_fingerprint="fp1", context_bytes=99999)
    link = ct["tracker"].build_id_for_job("job_x")
    assert link["input_fingerprint"] == "fp1" and int(link["context_bytes"]) == 99999


# ══ Owner route auth + privacy (22/23/24) ════════════════════════════════════
@pytest.fixture()
def app(tmp_path, monkeypatch):
    monkeypatch.setenv("ENABLE_ADMIN_MODE", "true")
    monkeypatch.setenv("OWNER_EMAIL", "owner@example.com")
    monkeypatch.setenv("OWNER_ID", "0")
    monkeypatch.setenv("OWNER_TOKEN", _OWNER_TOKEN)
    monkeypatch.setenv("COST_TRACKING_DB_PATH", str(tmp_path / "cost.db"))
    monkeypatch.setenv("ADMIN_AUDIT_DB_PATH", str(tmp_path / "audit.db"))
    monkeypatch.setenv("JWT_SECRET_KEY", "t" * 40)
    from backend.services.cost_tracking import store as s
    importlib.reload(s)
    from backend.services.cost_tracking import tracker as tr
    importlib.reload(tr)
    s._reset_for_tests()
    from backend.services.cost_tracking.types import TokenUsage, OP_PLANNING, OP_FRONTEND_GEN, \
        STAGE_WEB_BUILD_PLANNING, STAGE_FRONTEND_GENERATION, AGENT_WEBSITE_BUILDER, AGENT_FRONTEND_BUILDER
    tr.start_build(user_id="42", build_id="op_audit_a", label="a saas landing page")
    tr.record_ai_call(build_id="op_audit_a", user_id="42", provider="openai", model="gpt-5",
                      operation_type=OP_PLANNING, stage=STAGE_WEB_BUILD_PLANNING,
                      agent=AGENT_WEBSITE_BUILDER, input_fingerprint="fpp", context_bytes=8000,
                      usage=TokenUsage(input_tokens=8000, output_tokens=2000))
    tr.record_ai_call(build_id="op_audit_a", user_id="42", provider="openai", model="gpt-5",
                      operation_type=OP_FRONTEND_GEN, stage=STAGE_FRONTEND_GENERATION,
                      agent=AGENT_FRONTEND_BUILDER, input_fingerprint="fpf", context_bytes=160000,
                      usage=TokenUsage(input_tokens=40000, output_tokens=15000))
    from fastapi.testclient import TestClient
    from backend.api import app as _app
    return TestClient(_app, raise_server_exceptions=False)


def test_audit_unauth_401(app):
    assert app.get("/v2/admin/costs/builds/op_audit_a/audit").status_code == 401


def test_audit_non_owner_403(app):
    r = app.get("/v2/admin/costs/builds/op_audit_a/audit",
                headers={"X-Korvix-Owner-Token": "not-the-owner-token"})
    assert r.status_code == 403


def test_audit_owner_200_bounded_safe(app):
    r = app.get("/v2/admin/costs/builds/op_audit_a/audit",
                headers={"X-Korvix-Owner-Token": _OWNER_TOKEN})
    assert r.status_code == 200
    assert "no-store" in (r.headers.get("Cache-Control") or "")
    data = r.json()["data"]
    assert data["build"]["frontendGenerationShare"] > 0
    assert {s["stage"] for s in data["stages"]} >= {"web_build_planning", "frontend_generation"}
    # privacy: no fingerprint/prompt/source in the response
    import json
    blob = json.dumps(data)
    assert "fpp" not in blob and "fpf" not in blob and "input_fingerprint" not in blob


def test_audit_unknown_build_404(app):
    r = app.get("/v2/admin/costs/builds/op_missing_xyz/audit",
                headers={"X-Korvix-Owner-Token": _OWNER_TOKEN})
    assert r.status_code == 404


def test_audit_malformed_build_400(app):
    r = app.get("/v2/admin/costs/builds/bad%20id!/audit",
                headers={"X-Korvix-Owner-Token": _OWNER_TOKEN})
    assert r.status_code in (400, 404)
