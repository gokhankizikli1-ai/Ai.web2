# coding: utf-8
"""Connected-brain Phases 4 + 5 — Project Intelligence packet + Decisions.

Decisions are durable + supersedable; the capability-aware packet projects the
right bounded, provenance-tagged knowledge to each specialist, scoped by
run/project (no cross-project/user leak).
"""
from __future__ import annotations

import importlib

import pytest

from backend.services.orchestrator.project_intelligence import (
    build_intelligence_packet, TOTAL_CHAR_BUDGET,
)


def _deliv(node, *, status="completed", kind="markdown", content=None, did=None):
    return {"id": did or f"d_{node}", "node_id": node, "status": status,
            "kind": kind, "title": node, "agent_id": node,
            "content": content if content is not None else {}}


# ── Decisions store (Phase 5) ────────────────────────────────────────────

@pytest.fixture()
def dec(tmp_path, monkeypatch):
    monkeypatch.setenv("PROJECTS_DB_PATH", str(tmp_path / "projects.db"))
    from backend.services.orchestrator import decisions_store
    importlib.reload(decisions_store)
    decisions_store.init_decisions_table()
    return decisions_store


def test_decision_supersession(dec):
    dec.record_decision(project_id="p1", user_id="u1", topic="pricing",
                        value="$9", source="PRODUCT")
    dec.record_decision(project_id="p1", user_id="u1", topic="pricing",
                        value="$19", source="USER", reason="user changed it")
    actives = dec.active_decisions("p1")
    pricing = [d for d in actives if d["topic"] == "pricing"]
    assert len(pricing) == 1
    assert pricing[0]["value"] == "$19"           # newest wins
    # History retains both.
    hist = dec.history_for_topic("p1", "pricing")
    assert [h["value"] for h in hist] == ["$9", "$19"]
    assert hist[0]["status"] == "superseded"
    assert hist[0]["superseded_by"] == hist[1]["id"]


def test_ingest_decisions_from_content(dec):
    ids = dec.ingest_decisions_from_content(
        {"decisions": [{"topic": "mvp", "value": "inventory alerts"},
                       {"topic": "model", "value": "subscription"},
                       {"bad": "ignored"}]},
        project_id="p1", user_id="u1", source="PRODUCT")
    assert len(ids) == 2
    assert {d["topic"] for d in dec.active_decisions("p1")} == {"mvp", "model"}


def test_decision_cross_project_isolation(dec):
    dec.record_decision(project_id="pA", user_id="u1", topic="pricing", value="$19")
    dec.record_decision(project_id="pB", user_id="u2", topic="pricing", value="$49")
    assert dec.active_decisions("pA")[0]["value"] == "$19"
    assert dec.active_decisions("pB")[0]["value"] == "$49"


# ── Project Intelligence packet (Phase 4) ────────────────────────────────

def test_product_receives_research_upstream():
    deliverables = [_deliv("research", content={
        "text": "Target customer: independent restaurants; biggest issue: manual inventory waste",
        "facts": [{"text": "SMB restaurants are the target"},
                  "manual inventory waste is the core pain"]})]
    packet = build_intelligence_packet(
        capability="product", run_id="r1", project_id="p1",
        depends_on=["research"], user_goal="restaurant inventory SaaS",
        deliverables=deliverables, decisions=[],
        upstream_block="[UPSTREAM RESULT] node=research · kind=markdown\nTarget customer: independent restaurants")
    assert "PROJECT GOAL" in packet
    assert "independent restaurants" in packet
    assert "RELEVANT PROJECT FACTS" in packet
    assert "SMB restaurants are the target" in packet


def test_web_and_app_receive_product_decisions():
    decisions = [{"topic": "pricing", "value": "$19/mo", "source": "PRODUCT"},
                 {"topic": "mvp", "value": "low-stock alerts", "source": "PRODUCT"}]
    for cap in ("web_build", "app_build"):
        packet = build_intelligence_packet(
            capability=cap, run_id="r1", project_id="p1", depends_on=["product"],
            user_goal="SaaS", deliverables=[], decisions=decisions,
            upstream_block="[UPSTREAM RESULT] node=product\nDefine product")
        assert "ACTIVE PROJECT DECISIONS" in packet
        assert "pricing: $19/mo" in packet
        assert "low-stock alerts" in packet


def test_superseded_decision_not_projected():
    # decisions_store.active_decisions already excludes superseded; the packet
    # only ever sees actives. Simulate: only $19 is passed as active.
    packet = build_intelligence_packet(
        capability="web_build", run_id="r1", project_id="p1", depends_on=[],
        user_goal="g", deliverables=[],
        decisions=[{"topic": "pricing", "value": "$19", "source": "PRODUCT"}])
    assert "$19" in packet and "$9" not in packet


def test_user_constraints_rendered_separately():
    packet = build_intelligence_packet(
        capability="product", run_id="r1", project_id="p1", depends_on=[],
        user_goal="g", deliverables=[],
        decisions=[{"topic": "budget", "value": "under $5k", "source": "USER"}])
    assert "USER CONSTRAINT" in packet
    assert "budget: under $5k" in packet


def test_artifacts_are_references_only():
    huge = "x" * 100_000
    deliverables = [_deliv("web", kind="web_build", content={
        "build_type": "web", "build_status": "completed",
        "artifact_ref": "webrun:1", "text": huge})]
    packet = build_intelligence_packet(
        capability="qa", run_id="r1", project_id="p1", depends_on=[],
        user_goal="g", deliverables=deliverables, decisions=[])
    assert "webrun:1" in packet
    assert huge not in packet
    assert len(packet) <= TOTAL_CHAR_BUDGET


def test_packet_is_budgeted():
    # Many long decisions must not blow the total budget.
    decisions = [{"topic": f"t{i}", "value": "v" * 500, "source": "PRODUCT"}
                 for i in range(50)]
    packet = build_intelligence_packet(
        capability="web_build", run_id="r1", project_id="p1", depends_on=[],
        user_goal="g", deliverables=[], decisions=decisions)
    assert len(packet) <= TOTAL_CHAR_BUDGET


def test_capability_specific_sections():
    # research does NOT receive artifacts; qa DOES.
    arts = [_deliv("web", kind="web_build", content={
        "build_type": "web", "build_status": "completed", "artifact_ref": "webrun:1"})]
    research_packet = build_intelligence_packet(
        capability="research", run_id="r1", project_id="p1", depends_on=[],
        user_goal="g", deliverables=arts, decisions=[])
    qa_packet = build_intelligence_packet(
        capability="qa", run_id="r1", project_id="p1", depends_on=[],
        user_goal="g", deliverables=arts, decisions=[])
    assert "webrun:1" not in research_packet
    assert "webrun:1" in qa_packet


def test_empty_when_nothing_to_project():
    assert build_intelligence_packet(
        capability="research", run_id="r1", project_id="p1", depends_on=[],
        user_goal="", deliverables=[], decisions=[], upstream_block="") == ""
