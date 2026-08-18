# coding: utf-8
"""PROJECT KNOWLEDGE — durable decisions, requirements, constraints and facts.

Knowledge is a PROJECTION over two authorities that already existed, plus a
write dispatcher — not a third store. These tests pin exactly that, because the
failure modes are subtle:

  * ROUTING       — a decision must land in the canonical decision authority (so
                    a later build receives it) and a constraint/requirement/fact
                    in the project's own curated memory;
  * NO DUPLICATE  — nothing writes a decision to both;
    AUTHORITY
  * SUPERSESSION  — a user decision is namespaced so it can never silently
                    supersede a decision a build recorded under a real topic;
  * OWNERSHIP     — cross-owner and cross-project reads/writes/removals fail
                    identically to an unknown id;
  * USER ACTION   — knowledge only ever appears because a person recorded it;
                    no chat message is promoted automatically;
  * REMOVABILITY  — a build/research/system-authored item is not the user's to
                    delete here, and the surface says so rather than offering a
                    button that 500s.

No network, no model calls.
"""
from __future__ import annotations

import pytest

from backend.core import deps
from backend.services.auth.identity import User

USER_A = User(id="uA", kind="email", external_id="email:a@x.com", display_name="A")
USER_B = User(id="uB", kind="email", external_id="email:b@x.com", display_name="B")


@pytest.fixture()
def env(tmp_path, monkeypatch, app):
    projects_db = str(tmp_path / "projects.db")
    monkeypatch.setenv("PROJECTS_DB_PATH", projects_db)

    from backend.services.projects import store as projects_store
    from backend.services.projects import knowledge as knowledge_mod
    from backend.services.projects import tasks_store, views_store
    from backend.services.orchestrator import decisions_store
    from backend.services.orchestrator import observations_store as obs

    for mod in (projects_store, tasks_store, views_store, decisions_store, obs):
        monkeypatch.setattr(mod, "DB_PATH", projects_db, raising=False)
    projects_store._reset_for_tests()
    projects_store.init()
    tasks_store.init_tasks_table()
    views_store.init_views_table()
    decisions_store.init_decisions_table()
    obs.init_observations_table()

    projects_store.create_project("uA", name="Fitness App", description="",
                                  project_id="pA")
    projects_store.create_project("uA", name="Second", description="",
                                  project_id="pA2")
    projects_store.create_project("uB", name="Theirs", description="",
                                  project_id="pB")

    from backend.services.project_brain import workspace as ws_mod
    yield {"k": knowledge_mod, "projects": projects_store,
           "dec": decisions_store, "ws": ws_mod}
    app.dependency_overrides.clear()


def _as(app, user):
    app.dependency_overrides[deps.current_user] = lambda: user


# ── write routing ────────────────────────────────────────────────────────────

def test_a_decision_lands_in_the_canonical_decision_authority(env):
    item = env["k"].add_knowledge(project_id="pA", user_id="uA", kind="decision",
                                  text="Launch will initially be free.")
    assert item is not None and item["kind"] == "decision"
    assert item["id"].startswith("decision:")
    # It is a REAL decision — the same rows Project Intelligence, the Project
    # Supervisor and the build context projection already read.
    actives = env["dec"].active_decisions("pA")
    assert [d["value"] for d in actives] == ["Launch will initially be free."]
    assert actives[0]["source"] == env["dec"].SOURCE_USER
    # …and it did NOT also become a project-memory row.
    assert env["projects"].list_memory("pA") == []


@pytest.mark.parametrize("kind", ["requirement", "constraint", "fact", "note"])
def test_non_decision_knowledge_lands_in_curated_project_memory(env, kind):
    item = env["k"].add_knowledge(project_id="pA", user_id="uA", kind=kind,
                                  text="Connectors are read-only in V1.")
    assert item is not None and item["kind"] == kind
    assert item["id"].startswith("memory:")
    rows = env["projects"].list_memory("pA")
    assert [(r.kind, r.content, r.source) for r in rows] == [
        (kind, "Connectors are read-only in V1.", "user")]
    # …and it did NOT also become a decision.
    assert env["dec"].active_decisions("pA") == []


def test_an_unknown_kind_is_refused_rather_than_silently_becoming_a_note(env):
    assert env["k"].add_knowledge(project_id="pA", user_id="uA", kind="epic",
                                  text="Something") is None
    assert env["k"].add_knowledge(project_id="pA", user_id="uA",
                                  kind="decision", text="   ") is None


def test_a_user_decision_can_never_supersede_a_build_decision(env):
    """`record_decision` supersedes by TOPIC. A person writing "pricing is
    free" must not silently retire the semantic `pricing` decision a build
    capability recorded, so user topics are namespaced."""
    env["dec"].record_decision(project_id="pA", user_id="uA", topic="pricing",
                               value="$19/mo", source=env["dec"].SOURCE_BUILD)
    env["k"].add_knowledge(project_id="pA", user_id="uA", kind="decision",
                           text="pricing")
    values = {d["value"] for d in env["dec"].active_decisions("pA")}
    assert values == {"$19/mo", "pricing"}


def test_restating_the_same_decision_restates_it_rather_than_duplicating(env):
    env["k"].add_knowledge(project_id="pA", user_id="uA", kind="decision",
                           text="Launch will initially be free.")
    env["k"].add_knowledge(project_id="pA", user_id="uA", kind="decision",
                           text="launch will initially be free")
    # Same derived topic → the newer statement supersedes the older one.
    assert len(env["dec"].active_decisions("pA")) == 1


def test_the_derived_topic_is_deterministic_and_namespaced(env):
    a = env["k"].user_topic_for("Launch will initially be FREE!")
    b = env["k"].user_topic_for("  launch will initially be free  ")
    assert a == b and a.startswith("user:")


# ── read ─────────────────────────────────────────────────────────────────────

def test_the_list_merges_both_authorities_newest_first(env):
    env["k"].add_knowledge(project_id="pA", user_id="uA", kind="fact",
                           text="Hosted on Vercel.")
    env["k"].add_knowledge(project_id="pA", user_id="uA", kind="decision",
                           text="Launch will initially be free.")
    items = env["k"].list_knowledge("pA")
    assert {i["kind"] for i in items} == {"fact", "decision"}
    stamps = [i["created_at"] for i in items]
    assert stamps == sorted(stamps, reverse=True)


def test_the_list_is_ordered_deterministically_across_repeat_reads(env):
    for i in range(5):
        env["k"].add_knowledge(project_id="pA", user_id="uA", kind="fact",
                               text=f"fact {i}")
        env["k"].add_knowledge(project_id="pA", user_id="uA", kind="decision",
                               text=f"decision {i}")
    assert env["k"].list_knowledge("pA") == env["k"].list_knowledge("pA")


def test_the_list_is_bounded(env):
    for i in range(40):
        env["k"].add_knowledge(project_id="pA", user_id="uA", kind="note",
                               text=f"note {i}")
    assert len(env["k"].list_knowledge("pA", limit=5)) == 5
    assert len(env["k"].list_knowledge("pA", limit=10_000)) <= env["k"].MAX_LIMIT


def test_agent_and_system_memory_is_not_knowledge(env):
    """Project memory also carries agent notes, file summaries and system rows.
    Those are context, not statements the user authored, so Knowledge omits
    them entirely rather than presenting them as the project's own truth."""
    for kind, source in (("agent_note", "agent"), ("file_summary", "tool"),
                         ("system", "system")):
        env["projects"].add_memory("pA", content=f"{kind} row", kind=kind,
                                   source=source)
    assert env["k"].list_knowledge("pA") == []


def test_counts_report_every_kind_even_when_zero(env):
    env["k"].add_knowledge(project_id="pA", user_id="uA", kind="constraint",
                           text="Read-only connectors.")
    counts = env["k"].count_by_kind("pA")
    assert counts["constraint"] == 1 and counts["total"] == 1
    assert counts["decision"] == 0 and counts["requirement"] == 0
    assert counts["fact"] == 0 and counts["note"] == 0


def test_knowledge_never_crosses_projects(env):
    env["k"].add_knowledge(project_id="pA", user_id="uA", kind="fact", text="A")
    env["k"].add_knowledge(project_id="pA2", user_id="uA", kind="fact", text="B")
    assert [i["text"] for i in env["k"].list_knowledge("pA")] == ["A"]
    assert [i["text"] for i in env["k"].list_knowledge("pA2")] == ["B"]


# ── removal ──────────────────────────────────────────────────────────────────

def test_a_user_decision_is_retired_not_deleted(env):
    item = env["k"].add_knowledge(project_id="pA", user_id="uA", kind="decision",
                                  text="Launch will initially be free.")
    assert env["k"].remove_knowledge(project_id="pA", user_id="uA",
                                     knowledge_id=item["id"]) is True
    assert env["k"].list_knowledge("pA") == []
    # The topic's history survives — nothing is destroyed.
    row = env["dec"].get_decision(item["id"].split(":", 1)[1])
    assert row is not None and row["status"] == "superseded"


def test_a_user_memory_item_is_removed(env):
    item = env["k"].add_knowledge(project_id="pA", user_id="uA",
                                  kind="requirement", text="TR + EN homepage.")
    assert env["k"].remove_knowledge(project_id="pA", user_id="uA",
                                     knowledge_id=item["id"]) is True
    assert env["projects"].list_memory("pA") == []


def test_a_build_authored_decision_is_not_the_users_to_remove(env):
    did = env["dec"].record_decision(project_id="pA", user_id="uA",
                                     topic="pricing", value="$19/mo",
                                     source=env["dec"].SOURCE_BUILD)
    items = env["k"].list_knowledge("pA")
    assert [i["removable"] for i in items] == [False]
    assert [i["label"] for i in items] == ["pricing"]   # a real heading, shown
    assert env["k"].remove_knowledge(project_id="pA", user_id="uA",
                                     knowledge_id=f"decision:{did}") is False
    assert len(env["dec"].active_decisions("pA")) == 1


def test_removal_is_refused_across_owners_and_projects(env):
    item = env["k"].add_knowledge(project_id="pA", user_id="uA", kind="decision",
                                  text="Free launch.")
    memo = env["k"].add_knowledge(project_id="pA", user_id="uA", kind="fact",
                                  text="Vercel.")
    for owner, project in (("uB", "pA"), ("uA", "pA2"), ("uB", "pA2")):
        assert env["k"].remove_knowledge(project_id=project, user_id=owner,
                                         knowledge_id=item["id"]) is False
        assert env["k"].remove_knowledge(project_id=project, user_id=owner,
                                         knowledge_id=memo["id"]) is False
    assert len(env["k"].list_knowledge("pA")) == 2


def test_a_malformed_or_unknown_id_is_simply_false(env):
    for bad in ("", "nonsense", "decision:", ":abc", "memory:missing",
                "decision:missing", "other:abc"):
        assert env["k"].remove_knowledge(project_id="pA", user_id="uA",
                                         knowledge_id=bad) is False


# ── workspace projection ─────────────────────────────────────────────────────

def test_the_workspace_shows_only_headline_knowledge_but_counts_everything(env):
    for i in range(6):
        env["k"].add_knowledge(project_id="pA", user_id="uA", kind="decision",
                               text=f"decision {i}")
    env["k"].add_knowledge(project_id="pA", user_id="uA", kind="note",
                           text="a passing note")
    snap = env["ws"].build("uA", "pA")
    assert len(snap["knowledge"]["items"]) == 4          # bounded for the Overview
    assert all(i["kind"] in ("decision", "requirement", "constraint")
               for i in snap["knowledge"]["items"])      # notes/facts stay in the view
    assert snap["knowledge"]["counts"]["decision"] == 6
    assert snap["knowledge"]["counts"]["note"] == 1


def test_no_chat_message_is_ever_promoted_to_knowledge(env):
    """Knowledge exists because a person recorded it. Rendering the workspace
    over a project with chats and observations must not manufacture any."""
    from backend.services.orchestrator import observations_store as obs
    obs.record_observation(user_id="uA", project_id="pA", source="slack",
                           kind="slack.message.posted",
                           summary="We decided launch will be free",
                           external_id="s1", observed_at="2026-06-01T10:00:00Z")
    for _ in range(3):
        env["ws"].build("uA", "pA")
    assert env["k"].list_knowledge("pA") == []
    assert env["dec"].active_decisions("pA") == []
    assert env["projects"].list_memory("pA") == []


# ── HTTP surface ─────────────────────────────────────────────────────────────

def test_route_add_list_remove_round_trip(client, env, app):
    _as(app, USER_A)
    created = client.post("/v2/projects/pA/knowledge",
                          json={"kind": "decision",
                                "text": "Launch will initially be free."})
    assert created.status_code == 201
    item = created.json()["data"]["item"]

    listed = client.get("/v2/projects/pA/knowledge")
    assert listed.status_code == 200
    body = listed.json()["data"]
    assert [i["id"] for i in body["knowledge"]] == [item["id"]]
    assert body["counts"]["decision"] == 1

    removed = client.delete(f"/v2/projects/pA/knowledge/{item['id']}")
    assert removed.status_code == 200
    assert client.get("/v2/projects/pA/knowledge").json()["data"]["knowledge"] == []


def test_route_kind_filter(client, env, app):
    _as(app, USER_A)
    client.post("/v2/projects/pA/knowledge",
                json={"kind": "constraint", "text": "Read-only connectors."})
    client.post("/v2/projects/pA/knowledge",
                json={"kind": "fact", "text": "Hosted on Vercel."})
    res = client.get("/v2/projects/pA/knowledge", params={"kind": "constraint"})
    assert [i["text"] for i in res.json()["data"]["knowledge"]] == [
        "Read-only connectors."]


def test_route_rejects_an_unknown_kind(client, env, app):
    _as(app, USER_A)
    res = client.post("/v2/projects/pA/knowledge",
                      json={"kind": "epic", "text": "Something"})
    assert res.status_code == 400


def test_route_hides_another_owners_project_on_every_verb(client, env, app):
    _as(app, USER_B)
    assert client.get("/v2/projects/pA/knowledge").status_code == 404
    assert client.post("/v2/projects/pA/knowledge",
                       json={"kind": "fact", "text": "x"}).status_code == 404
    assert client.delete("/v2/projects/pA/knowledge/memory:x").status_code == 404
    assert client.get("/v2/projects/nope/knowledge").status_code == 404


def test_route_cannot_remove_an_item_through_another_project_you_own(client, env, app):
    _as(app, USER_A)
    item = client.post("/v2/projects/pA/knowledge",
                       json={"kind": "fact", "text": "Vercel."},
                       ).json()["data"]["item"]
    assert client.delete(f"/v2/projects/pA2/knowledge/{item['id']}").status_code == 404
    assert len(env["k"].list_knowledge("pA")) == 1


def test_route_ignores_a_client_supplied_owner(client, env, app):
    _as(app, USER_B)
    res = client.post("/v2/projects/pA/knowledge",
                      params={"user_id": "uA"}, headers={"X-User-Id": "uA"},
                      json={"kind": "fact", "text": "x", "user_id": "uA"})
    assert res.status_code == 404
    assert env["k"].list_knowledge("pA") == []
