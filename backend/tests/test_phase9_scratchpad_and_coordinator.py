# coding: utf-8
"""
Phase 9 — multi-agent coordination foundations.

Two real primitives this PR adds, both with feature flags so prod stays
byte-identical until ops flips them:

  A) Scratchpad — append-only project-scoped agent journal.
     Tests: write/read, ownership isolation, kind filtering, flag-off
     no-op, route 503 envelope.

  B) Coordinator — rule-based intent classifier that maps a user
     message + asset hints to a Plan over the existing AgentSpec
     registry. NOT executing agents — just producing the plan the FE
     previews. Tests: intent matching, multi-agent fan-out, asset-
     driven rules, fallback, flag-off 503, multilingual (TR) signal.
"""
from __future__ import annotations

import pytest


# ════════════════════════════════════════════════════════════════════════════
# A) Scratchpad
# ════════════════════════════════════════════════════════════════════════════

class TestScratchpadClient:

    def test_disabled_by_default(self, monkeypatch):
        monkeypatch.delenv("ENABLE_SCRATCHPAD", raising=False)
        from backend.services.scratchpad import client as sp
        assert sp.is_enabled() is False
        # Writes are no-ops; reads are empty. No exception.
        assert sp.append(
            user_id="u1", project_id="p1", agent_id="researcher",
            content="hello",
        ) is None
        assert sp.list_project(user_id="u1", project_id="p1") == []

    def test_append_then_list_newest_first(self, tmp_scratchpad_db):
        from backend.services.scratchpad import client as sp
        e1 = sp.append(
            user_id="u1", project_id="p1", agent_id="researcher",
            content="found 3 competitors",
        )
        e2 = sp.append(
            user_id="u1", project_id="p1", agent_id="ux_designer",
            content="propose two-column hero", kind="plan",
        )
        assert e1 is not None and e2 is not None
        rows = sp.list_project(user_id="u1", project_id="p1")
        assert [r.id for r in rows] == [e2.id, e1.id]
        # Persisted attribution + kinds.
        assert rows[0].agent_id == "ux_designer"
        assert rows[0].kind == "plan"
        assert rows[1].agent_id == "researcher"
        assert rows[1].kind == "note"      # default

    def test_cross_user_isolation(self, tmp_scratchpad_db):
        """Bob cannot read Alice's notes by passing her project_id —
        the (user_id, project_id) index keeps the rows partitioned."""
        from backend.services.scratchpad import client as sp
        sp.append(
            user_id="alice", project_id="p1", agent_id="researcher",
            content="alice's research finding",
        )
        bob_rows = sp.list_project(user_id="bob", project_id="p1")
        assert bob_rows == []
        # Alice still sees her own row.
        alice_rows = sp.list_project(user_id="alice", project_id="p1")
        assert len(alice_rows) == 1
        assert "alice's research" in alice_rows[0].content

    def test_kind_filter(self, tmp_scratchpad_db):
        from backend.services.scratchpad import client as sp
        sp.append(user_id="u", project_id="p", agent_id="r",
                         content="A", kind="finding")
        sp.append(user_id="u", project_id="p", agent_id="r",
                         content="B", kind="decision")
        sp.append(user_id="u", project_id="p", agent_id="r",
                         content="C", kind="finding")
        findings = sp.list_project(
            user_id="u", project_id="p", kind="finding",
        )
        decisions = sp.list_project(
            user_id="u", project_id="p", kind="decision",
        )
        assert {r.content for r in findings} == {"A", "C"}
        assert {r.content for r in decisions} == {"B"}

    def test_empty_payload_refused(self, tmp_scratchpad_db):
        """Wholly-empty appends are signal-to-noise hygiene — refused
        with None so callers can't accidentally bloat the journal."""
        from backend.services.scratchpad import client as sp
        assert sp.append(
            user_id="u", project_id="p", agent_id="r",
            content="",       # no content
            kind="note",      # default kind
            metadata=None,    # no metadata
        ) is None

    def test_correlation_threading(self, tmp_scratchpad_db):
        """A question + answer share a correlation_id; the FE can pull
        the threaded view with one query."""
        from backend.services.scratchpad import client as sp
        q = sp.append(
            user_id="u", project_id="p", agent_id="ux_designer",
            content="What palette did marketing pick?", kind="question",
            correlation_id="thread-1",
        )
        a = sp.append(
            user_id="u", project_id="p", agent_id="brand_designer",
            content="Cyan + midnight.", kind="answer",
            correlation_id="thread-1", parent_id=q.id,
        )
        threaded = sp.list_project(
            user_id="u", project_id="p", correlation_id="thread-1",
            newest_first=False,
        )
        assert [r.id for r in threaded] == [q.id, a.id]
        assert threaded[1].parent_id == q.id


class TestScratchpadRoutes:

    def test_disabled_returns_503(self, client, monkeypatch, app):
        monkeypatch.delenv("ENABLE_SCRATCHPAD", raising=False)
        from backend.core.deps import current_user
        from backend.services.auth.identity import User
        app.dependency_overrides[current_user] = lambda: User(
            id="u-503", kind="guest",
            external_id="guest:u-503", display_name="",
        )
        try:
            r = client.get("/v2/projects/p1/scratchpad")
            assert r.status_code == 503
            assert r.json()["detail"]["code"] == "SCRATCHPAD_DISABLED"
        finally:
            app.dependency_overrides.pop(current_user, None)

    def test_append_and_list_via_routes(self, client, tmp_scratchpad_db, app):
        from backend.core.deps import current_user
        from backend.services.auth.identity import User
        app.dependency_overrides[current_user] = lambda: User(
            id="u-rt", kind="email",
            external_id="email:rt@example.com", display_name="RT",
        )
        try:
            r = client.post("/v2/scratchpad", json={
                "project_id": "p-rt", "agent_id": "researcher",
                "kind": "finding", "content": "Three pricing models found.",
            })
            assert r.status_code == 200, r.text
            assert r.json()["data"]["entry"]["agent_id"] == "researcher"
            r2 = client.get("/v2/projects/p-rt/scratchpad")
            assert r2.status_code == 200
            entries = r2.json()["data"]["entries"]
            assert len(entries) == 1
            assert entries[0]["content"] == "Three pricing models found."
        finally:
            app.dependency_overrides.pop(current_user, None)

    def test_empty_payload_returns_422(self, client, tmp_scratchpad_db, app):
        from backend.core.deps import current_user
        from backend.services.auth.identity import User
        app.dependency_overrides[current_user] = lambda: User(
            id="u-422", kind="email",
            external_id="email:422@example.com", display_name="",
        )
        try:
            r = client.post("/v2/scratchpad", json={
                "project_id": "p", "agent_id": "r",
                "content": "", "kind": "note",
            })
            assert r.status_code == 422
            assert r.json()["detail"]["code"] == "SCRATCHPAD_EMPTY_ENTRY"
        finally:
            app.dependency_overrides.pop(current_user, None)


# ════════════════════════════════════════════════════════════════════════════
# B) Coordinator
# ════════════════════════════════════════════════════════════════════════════

class TestCoordinatorAnalyze:

    def test_research_intent_routes_to_researcher(self):
        from backend.services.coordinator import coordinator
        plan = coordinator.analyze(
            user_message="Research Tesla competitors in EU.",
        )
        assert plan.routing_method == "rule_based"
        assert plan.agents[0].agent_id == "researcher"
        assert plan.confidence >= 0.7

    def test_ui_intent_routes_to_ux_designer(self):
        """One specialist match (landing page) → that specialist leads
        directly; no supervisor round-trip overhead for a single-agent
        task. Confirmed by both the agent_id and the intent label."""
        from backend.services.coordinator import coordinator
        plan = coordinator.analyze(
            user_message="Build me a hero section with a CTA.",
        )
        assert plan.agents[0].agent_id == "ux_designer"
        assert plan.intent == "ux_designer"
        assert plan.confidence >= 0.7

    def test_image_attachment_invokes_ux_review(self):
        from backend.services.coordinator import coordinator
        plan = coordinator.analyze(
            user_message="what about this?",
            asset_mime_types=["image/png"],
        )
        ids = [a.agent_id for a in plan.agents]
        assert "ux_designer" in ids
        # Asset note surfaces vision capability in the preview.
        assert any("multimodal" in n.lower() for n in plan.notes)

    def test_turkish_research_signal(self):
        """Multilingual: Turkish 'araştır' must hit the researcher
        rule, not fall back to chat."""
        from backend.services.coordinator import coordinator
        plan = coordinator.analyze(
            user_message="Bana Tesla rakiplerini araştır.",
        )
        assert plan.agents[0].agent_id == "researcher"

    def test_no_signal_falls_back_to_supervisor(self):
        from backend.services.coordinator import coordinator
        plan = coordinator.analyze(
            user_message="hi how are you",
        )
        assert plan.intent == "chat"
        assert plan.confidence == 0.0
        assert plan.agents[0].agent_id == "supervisor"

    def test_code_block_triggers_coder(self):
        from backend.services.coordinator import coordinator
        plan = coordinator.analyze(
            user_message="```\nprint('hi')\n```\nWhy doesn't this run?",
        )
        ids = [a.agent_id for a in plan.agents]
        assert "coder" in ids

    def test_multi_specialist_uses_supervisor_orchestration(self):
        """When research AND design signals both fire, the supervisor
        leads and both specialists depend on it."""
        from backend.services.coordinator import coordinator
        plan = coordinator.analyze(
            user_message=(
                "Research SaaS competitor pricing and build me a hero "
                "section based on what you find."
            ),
        )
        ids = [a.agent_id for a in plan.agents]
        assert ids[0] == "supervisor"
        # Both specialists are present and depend on the supervisor.
        followers = [a for a in plan.agents if a.agent_id != "supervisor"]
        assert {a.agent_id for a in followers} >= {"researcher", "ux_designer"}
        for a in followers:
            assert a.depends_on == ["supervisor"]


class TestCoordinatorRoute:

    def test_disabled_returns_503(self, client, monkeypatch, app):
        monkeypatch.delenv("ENABLE_COORDINATOR", raising=False)
        from backend.core.deps import current_user
        from backend.services.auth.identity import User
        app.dependency_overrides[current_user] = lambda: User(
            id="u-c503", kind="guest",
            external_id="guest:u-c503", display_name="",
        )
        try:
            r = client.post("/v2/coordinator/plan", json={"message": "x"})
            assert r.status_code == 503
            assert r.json()["detail"]["code"] == "COORDINATOR_DISABLED"
        finally:
            app.dependency_overrides.pop(current_user, None)

    def test_route_returns_plan_envelope(self, client, monkeypatch, app):
        monkeypatch.setenv("ENABLE_COORDINATOR", "true")
        from backend.core.deps import current_user
        from backend.services.auth.identity import User
        app.dependency_overrides[current_user] = lambda: User(
            id="u-c", kind="email",
            external_id="email:c@example.com", display_name="",
        )
        try:
            r = client.post("/v2/coordinator/plan", json={
                "message": "Build a SaaS landing page.",
            })
            assert r.status_code == 200, r.text
            plan = r.json()["data"]["plan"]
            assert plan["routing_method"] == "rule_based"
            assert len(plan["agents"]) >= 1
            # Every agent invocation carries a non-empty reason.
            assert all(a.get("reason") for a in plan["agents"])
        finally:
            app.dependency_overrides.pop(current_user, None)

    def test_route_accepts_asset_mime_hint(self, client, monkeypatch, app):
        monkeypatch.setenv("ENABLE_COORDINATOR", "true")
        from backend.core.deps import current_user
        from backend.services.auth.identity import User
        app.dependency_overrides[current_user] = lambda: User(
            id="u-cam", kind="email",
            external_id="email:cam@example.com", display_name="",
        )
        try:
            r = client.post("/v2/coordinator/plan", json={
                "message": "what is this", "asset_mime_types": ["image/png"],
            })
            assert r.status_code == 200, r.text
            plan = r.json()["data"]["plan"]
            ids = [a["agent_id"] for a in plan["agents"]]
            assert "ux_designer" in ids
        finally:
            app.dependency_overrides.pop(current_user, None)
