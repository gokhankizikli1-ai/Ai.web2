# coding: utf-8
"""
Phase 9 part 2 — coordination foundation tests.

Covers four new primitives + one classifier extension:
  - Panels service + routes
  - AgentPresence in-memory registry + bus publish
  - AgentMessenger persistent log + bus publish
  - Coordinator.classify() complexity probe + /v2/coordinator/classify
  - Scratchpad panel_id / status / supersedes extensions
"""
from __future__ import annotations

import pytest


# ════════════════════════════════════════════════════════════════════════════
# A) Panels service
# ════════════════════════════════════════════════════════════════════════════

class TestPanelsClient:

    def test_disabled_by_default(self, monkeypatch):
        monkeypatch.delenv("ENABLE_REAL_COORDINATION", raising=False)
        from backend.services.panels import client as pn
        assert pn.is_enabled() is False
        assert pn.create(user_id="u", title="t") is None
        assert pn.list_user(user_id="u") == []

    def test_create_and_get(self, tmp_panels_db):
        from backend.services.panels import client as pn
        rec = pn.create(
            user_id="u1", title="Build Shopify SaaS",
            project_id="p1", coordinator_intent="multi_agent",
        )
        assert rec is not None
        assert rec.status == "active"
        # Round-trip ownership.
        same = pn.get(rec.id, user_id="u1")
        assert same is not None and same.title == "Build Shopify SaaS"
        # Cross-user request returns None.
        assert pn.get(rec.id, user_id="other") is None

    def test_terminal_lock(self, tmp_panels_db):
        """Once a panel is completed it cannot move back to active —
        the FE shouldn't be able to silently revive an old run."""
        from backend.services.panels import client as pn
        rec = pn.create(user_id="u", title="x")
        done = pn.mark_status(rec.id, user_id="u", status="completed")
        assert done.status == "completed"
        # Try to re-open — store refuses, returns the current (terminal) row.
        revived = pn.mark_status(rec.id, user_id="u", status="active")
        assert revived.status == "completed"

    def test_list_user_filters(self, tmp_panels_db):
        from backend.services.panels import client as pn
        a = pn.create(user_id="u", title="A", project_id="p1")
        b = pn.create(user_id="u", title="B", project_id="p2")
        pn.mark_status(b.id, user_id="u", status="completed")
        active = pn.list_user(user_id="u", status="active")
        completed = pn.list_user(user_id="u", status="completed")
        p1_only = pn.list_user(user_id="u", project_id="p1")
        assert {p.id for p in active} == {a.id}
        assert {p.id for p in completed} == {b.id}
        assert {p.id for p in p1_only} == {a.id}


class TestPanelsRoutes:

    def test_disabled_returns_503(self, client, monkeypatch, app):
        monkeypatch.delenv("ENABLE_REAL_COORDINATION", raising=False)
        from backend.core.deps import current_user
        from backend.services.auth.identity import User
        app.dependency_overrides[current_user] = lambda: User(
            id="u", kind="guest", external_id="guest:u", display_name="",
        )
        try:
            r = client.post("/v2/panels", json={"title": "x"})
            assert r.status_code == 503
            assert r.json()["detail"]["code"] == "REAL_COORDINATION_DISABLED"
        finally:
            app.dependency_overrides.pop(current_user, None)

    def test_create_get_list(self, client, tmp_panels_db, app):
        from backend.core.deps import current_user
        from backend.services.auth.identity import User
        app.dependency_overrides[current_user] = lambda: User(
            id="u-r", kind="email",
            external_id="email:r@example.com", display_name="R",
        )
        try:
            r = client.post("/v2/panels", json={
                "title": "Build SaaS landing",
                "project_id": "proj-1",
                "coordinator_intent": "multi_agent",
            })
            assert r.status_code == 200, r.text
            pid = r.json()["data"]["panel"]["id"]
            # GET single
            r2 = client.get(f"/v2/panels/{pid}")
            assert r2.status_code == 200
            assert r2.json()["data"]["panel"]["title"] == "Build SaaS landing"
            # LIST
            r3 = client.get("/v2/panels?project_id=proj-1")
            assert r3.status_code == 200
            ids = [p["id"] for p in r3.json()["data"]["panels"]]
            assert pid in ids
        finally:
            app.dependency_overrides.pop(current_user, None)


# ════════════════════════════════════════════════════════════════════════════
# B) AgentPresence
# ════════════════════════════════════════════════════════════════════════════

class TestAgentPresence:

    def test_disabled_by_default(self, monkeypatch):
        monkeypatch.delenv("ENABLE_AGENT_PRESENCE", raising=False)
        from backend.services.agent_presence import client as pres
        assert pres.is_enabled() is False
        # Writes are no-ops; reads are empty.
        assert pres.update(
            panel_id="p", agent_id="researcher", state="thinking",
        ) is None
        assert pres.snapshot(panel_id="p") == []

    def test_update_and_snapshot(self, agent_presence_enabled):
        from backend.services.agent_presence import client as pres
        pres.update(panel_id="P1", agent_id="researcher",
                           state="thinking", current_task="competitor scan")
        pres.update(panel_id="P1", agent_id="ux_designer",
                           state="analyzing", current_task="screenshot review")
        rows = pres.snapshot(panel_id="P1")
        assert len(rows) == 2
        states = {r.agent_id: r.state for r in rows}
        assert states == {"researcher": "thinking", "ux_designer": "analyzing"}

    def test_panel_scoped(self, agent_presence_enabled):
        from backend.services.agent_presence import client as pres
        pres.update(panel_id="P1", agent_id="r", state="thinking")
        pres.update(panel_id="P2", agent_id="r", state="coding")
        p1 = pres.snapshot(panel_id="P1")
        p2 = pres.snapshot(panel_id="P2")
        assert len(p1) == 1 and p1[0].state == "thinking"
        assert len(p2) == 1 and p2[0].state == "coding"

    def test_state_change_resets_started_at(self, agent_presence_enabled):
        import time
        from backend.services.agent_presence import client as pres
        r1 = pres.update(panel_id="P", agent_id="a", state="thinking")
        # Same state again → started_at unchanged.
        time.sleep(0.02)
        r2 = pres.update(panel_id="P", agent_id="a", state="thinking")
        assert r2.started_at_ms == r1.started_at_ms
        # Different state → started_at refreshes.
        time.sleep(0.02)
        r3 = pres.update(panel_id="P", agent_id="a", state="coding")
        assert r3.started_at_ms > r1.started_at_ms

    def test_bus_publish(self, agent_presence_enabled, monkeypatch):
        """Update must emit a `presence.changed` event on the bus
        scoped to panel:<id> — that's how SSE subscribers will get
        live push updates without a polling fallback."""
        monkeypatch.setenv("ENABLE_REALTIME_EVENTS", "true")
        from backend.services.events import bus as _bus
        captured = []
        # Subscribe BEFORE the update so we see the publish.
        with _bus.subscribe("panel:P") as sub:
            from backend.services.agent_presence import client as pres
            pres.update(
                panel_id="P", agent_id="researcher", state="researching",
                current_task="x",
            )
            # Drain at most one event with a small timeout.
            import asyncio
            async def drain():
                try:
                    while True:
                        evt = await asyncio.wait_for(sub.get(), timeout=0.2)
                        captured.append(evt)
                except asyncio.TimeoutError:
                    return
            asyncio.run(drain())
        assert any(e.kind == "presence.changed" for e in captured)


# ════════════════════════════════════════════════════════════════════════════
# C) AgentMessenger
# ════════════════════════════════════════════════════════════════════════════

class TestAgentMessenger:

    def test_disabled_by_default(self, monkeypatch):
        monkeypatch.delenv("ENABLE_REAL_COORDINATION", raising=False)
        from backend.services.agent_messenger import client as ms
        assert ms.is_enabled() is False
        assert ms.send(
            panel_id="p", user_id="u", from_agent="a", to_agent="b",
            content="hi",
        ) is None

    def test_send_and_list(self, tmp_agent_messages_db):
        from backend.services.agent_messenger import client as ms
        m1 = ms.send(
            panel_id="P", user_id="u", from_agent="researcher",
            to_agent="ux_designer", message_type="request",
            content="any palette preferences?",
        )
        m2 = ms.send(
            panel_id="P", user_id="u", from_agent="ux_designer",
            to_agent="researcher", message_type="response",
            content="cyan + midnight", in_reply_to=m1.id,
        )
        log = ms.list_panel(panel_id="P", user_id="u")
        assert [m.id for m in log] == [m1.id, m2.id]
        assert log[1].in_reply_to == m1.id
        assert log[1].message_type == "response"

    def test_empty_payload_refused(self, tmp_agent_messages_db):
        from backend.services.agent_messenger import client as ms
        assert ms.send(
            panel_id="P", user_id="u", from_agent="a", to_agent="b",
            content="", payload=None,
        ) is None

    def test_cross_user_isolation(self, tmp_agent_messages_db):
        from backend.services.agent_messenger import client as ms
        ms.send(panel_id="P", user_id="alice",
                       from_agent="a", to_agent="b", content="x")
        bob_view = ms.list_panel(panel_id="P", user_id="bob")
        assert bob_view == []


# ════════════════════════════════════════════════════════════════════════════
# D) Coordinator.classify()
# ════════════════════════════════════════════════════════════════════════════

class TestCoordinatorClassify:

    def test_simple_greeting_is_low(self):
        from backend.services.coordinator import coordinator
        r = coordinator.classify(user_message="hi")
        assert r["complexity"] == "low"
        assert r["should_spawn_panel"] is False

    def test_short_question_no_panel(self):
        from backend.services.coordinator import coordinator
        r = coordinator.classify(user_message="what is React?")
        assert r["should_spawn_panel"] is False

    def test_build_request_spawns_panel(self):
        from backend.services.coordinator import coordinator
        r = coordinator.classify(
            user_message="Build me a SaaS landing page with hero, pricing, "
                         "and testimonials. Compare with three competitors first.",
        )
        assert r["should_spawn_panel"] is True
        assert r["complexity"] in ("medium", "high")
        assert any(t in ("build", "compare") for t in r["triggers"])

    def test_image_attachment_bumps_score(self):
        """One trigger keyword ("compare") + image attachment should
        push the score past the panel-spawn threshold even on a short
        prompt. Image alone is +1; a trigger is +2."""
        from backend.services.coordinator import coordinator
        r = coordinator.classify(
            user_message="Compare this dashboard layout to a clean design.",
            asset_mime_types=["image/png"],
        )
        assert r["complexity"] in ("medium", "high")
        assert r["should_spawn_panel"] is True
        assert "compare" in r["triggers"]

    def test_turkish_trigger(self):
        from backend.services.coordinator import coordinator
        r = coordinator.classify(
            user_message="Bana Tesla rakiplerini araştır ve detaylı bir rapor hazırla.",
        )
        assert "araştır" in r["triggers"]
        assert r["should_spawn_panel"] is True


class TestCoordinatorClassifyRoute:

    def test_disabled_returns_503(self, client, monkeypatch, app):
        monkeypatch.delenv("ENABLE_COORDINATOR", raising=False)
        from backend.core.deps import current_user
        from backend.services.auth.identity import User
        app.dependency_overrides[current_user] = lambda: User(
            id="u", kind="guest", external_id="guest:u", display_name="",
        )
        try:
            r = client.post("/v2/coordinator/classify", json={"message": "x"})
            assert r.status_code == 503
        finally:
            app.dependency_overrides.pop(current_user, None)

    def test_route_returns_classification(self, client, monkeypatch, app):
        monkeypatch.setenv("ENABLE_COORDINATOR", "true")
        from backend.core.deps import current_user
        from backend.services.auth.identity import User
        app.dependency_overrides[current_user] = lambda: User(
            id="u", kind="email", external_id="email:c@example.com", display_name="",
        )
        try:
            r = client.post("/v2/coordinator/classify", json={
                "message": "Build a competitor analysis report for Tesla.",
            })
            assert r.status_code == 200, r.text
            payload = r.json()["data"]["classification"]
            assert "complexity" in payload
            assert "should_spawn_panel" in payload
            assert "triggers" in payload
        finally:
            app.dependency_overrides.pop(current_user, None)


# ════════════════════════════════════════════════════════════════════════════
# E) Scratchpad extensions (panel_id / status / supersedes)
# ════════════════════════════════════════════════════════════════════════════

class TestScratchpadExtensions:

    def test_append_with_panel_id_and_status(self, tmp_scratchpad_db):
        from backend.services.scratchpad import client as sp
        e = sp.append(
            user_id="u", project_id="p", agent_id="researcher",
            content="three pricing models found", kind="finding",
            panel_id="PANEL-1", references=["asset:abc", "msg:xyz"],
        )
        assert e is not None
        assert e.panel_id == "PANEL-1"
        assert e.references == ["asset:abc", "msg:xyz"]
        assert e.status == "active"

    def test_filter_by_panel_and_status(self, tmp_scratchpad_db):
        from backend.services.scratchpad import client as sp
        sp.append(user_id="u", project_id="p", agent_id="r",
                  content="A", panel_id="P1", kind="finding")
        sp.append(user_id="u", project_id="p", agent_id="r",
                  content="B", panel_id="P2", kind="finding")
        p1 = sp.list_project(user_id="u", project_id="p", panel_id="P1")
        p2 = sp.list_project(user_id="u", project_id="p", panel_id="P2")
        assert [e.content for e in p1] == ["A"]
        assert [e.content for e in p2] == ["B"]

    def test_supersedes_marks_predecessor(self, tmp_scratchpad_db):
        """Posting a new entry with supersedes_id atomically flips the
        earlier entry to status='superseded' — the FE never sees both
        as active."""
        from backend.services.scratchpad import client as sp
        e1 = sp.append(user_id="u", project_id="p", agent_id="r",
                       content="v1 finding", panel_id="P", kind="finding")
        e2 = sp.append(user_id="u", project_id="p", agent_id="r",
                       content="v2 finding", panel_id="P", kind="finding",
                       supersedes_id=e1.id)
        # Re-read e1 — should be superseded.
        all_rows = sp.list_project(user_id="u", project_id="p", panel_id="P",
                                   newest_first=False)
        statuses = {row.id: row.status for row in all_rows}
        assert statuses[e1.id] == "superseded"
        assert statuses[e2.id] == "active"
        # Filtering by status='active' hides the superseded row.
        active = sp.list_project(user_id="u", project_id="p", panel_id="P",
                                 status="active")
        assert [e.id for e in active] == [e2.id]

    def test_mark_status(self, tmp_scratchpad_db):
        from backend.services.scratchpad import client as sp
        e = sp.append(user_id="u", project_id="p", agent_id="r",
                      content="proposed palette: cyan",
                      panel_id="P", kind="proposal")
        accepted = sp.mark_status(e.id, user_id="u", status="accepted")
        assert accepted is not None
        assert accepted.status == "accepted"
        rejected_unknown = sp.mark_status(
            "does-not-exist", user_id="u", status="rejected",
        )
        assert rejected_unknown is None
