# coding: utf-8
"""PROJECT INTELLIGENCE — integration with the authorities that already exist.

The correlation rules are pinned in `test_project_intelligence_correlation.py`.
This file pins the WIRING, and above all the ISOLATION: correlation is the one
place in the system that deliberately looks for connections BETWEEN
observations, so it is also the one place where a scoping mistake would not
just leak a row — it would weave another account's rows into your project's
story and present the result as an understanding.

So the adversarial setup here is the nastiest realistic one: two accounts, two
projects, the SAME words in both. Nothing may cross.

Also pinned:
  * candidate synthesis consumes correlated evidence, dedups on the SUBJECT,
    and still creates nothing during ingestion;
  * the ProjectBrain prompt block stays bounded and leads with the synthesis;
  * the workspace payload stays bounded and read-only;
  * Web Build / App Build are untouched by any of it.

No network, no model calls.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from backend.services import project_intelligence as pi

#: These tests exercise the REAL wiring, and two of those paths — the brain's
#: `build_context` and `synthesize_candidates` — take no `now` argument by
#: design (nothing in production wants to tell the Business Brain what time it
#: is). Correlation only considers evidence inside its 14-day window, so the
#: fixtures are anchored to the actual clock and every instant below is
#: expressed relative to it. Determinism is unaffected: one `NOW` is sampled
#: per test session and every offset is derived from it.
NOW = datetime.now(timezone.utc).replace(microsecond=0)


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


@pytest.fixture()
def env(tmp_path, monkeypatch):
    projects_db = str(tmp_path / "projects.db")
    sessions_db = str(tmp_path / "sessions.db")
    monkeypatch.setenv("PROJECTS_DB_PATH", projects_db)
    monkeypatch.setenv("SESSIONS_DB_PATH", sessions_db)
    monkeypatch.setenv("ENABLE_SESSIONS", "true")
    monkeypatch.setenv("ENABLE_PROJECT_BRAIN", "true")

    from backend.services.projects import store as projects_store
    from backend.services.orchestrator import (
        candidate_actions_store as cas, decisions_store, deliverables_store as dls,
        goals_store, observations_store as obs, runs_store, tasks_store,
    )
    from backend.services.sessions import store as sessions_store

    for mod in (projects_store, obs, cas, dls, goals_store, decisions_store,
                tasks_store, runs_store):
        monkeypatch.setattr(mod, "DB_PATH", projects_db, raising=False)
    monkeypatch.setattr(sessions_store, "DB_PATH", sessions_db, raising=False)
    projects_store._reset_for_tests()
    projects_store.init()
    obs.init_observations_table()
    cas.init_candidate_actions_table()
    dls.init_deliverables_table()
    goals_store.init_goals_table()
    decisions_store.init_decisions_table()
    sessions_store.init()

    projects_store.create_project("uA", name="Aurora", description="", project_id="pA")
    projects_store.create_project("uA", name="Second", description="", project_id="pA2")
    projects_store.create_project("uB", name="Theirs", description="", project_id="pB")

    from backend.services.orchestrator import candidate_synthesis as synth
    from backend.services.project_brain import workspace as ws_mod
    return {"obs": obs, "cas": cas, "synth": synth, "ws": ws_mod, "dls": dls,
            "tasks": tasks_store, "projects": projects_store}


def _record(env, *, user="uA", project="pA", source, kind, summary,
            payload=None, ext=None, importance="normal", at=NOW):
    return env["obs"].record_observation(
        user_id=user, project_id=project, source=source, kind=kind,
        summary=summary, payload=payload or {},
        external_id=ext or f"{user}:{project}:{source}:{summary[:20]}",
        importance=importance, observed_at=_iso(at))


def _payment_webhook_story(env, *, user="uA", project="pA", deploy_verb="error"):
    """The same three-source story, recordable under any (user, project)."""
    _record(env, user=user, project=project, source="slack",
            kind="slack.message.created", summary="#eng: payment webhook broken",
            payload={"channel_id": "C1", "channel_name": "eng",
                     "text": "the payment webhook is broken again", "ts": "1"},
            at=NOW - timedelta(hours=5))
    _record(env, user=user, project=project, source="github",
            kind="github.pull_request.merged",
            summary="PR #712 merged: Fix payment webhook retry",
            payload={"repo": "acme/site", "number": 712, "merged": True,
                     "title": "Fix payment webhook retry",
                     "head_ref": "fix/payment-webhook"},
            at=NOW - timedelta(hours=3))
    _record(env, user=user, project=project, source="vercel",
            kind=f"vercel.deployment.{deploy_verb}",
            summary="Production deployment FAILED for korvix (fix/payment-webhook)",
            payload={"vercel_project_id": "prj_1", "project_name": "korvix",
                     "target": "production", "state": deploy_verb.upper(),
                     "git": {"repo": "acme/site", "ref": "fix/payment-webhook"}},
            importance="high", at=NOW - timedelta(hours=1))


# ══════════════════════════════════════════════════════════════════════════
# ISOLATION — the part that must never be wrong
# ══════════════════════════════════════════════════════════════════════════

def test_two_projects_with_identical_wording_never_correlate(env):
    """Same account, two projects, word-for-word the same story. The evidence
    sets must be disjoint — no observation of pA2 may appear in pA's reading."""
    _payment_webhook_story(env, project="pA")
    _payment_webhook_story(env, project="pA2")

    a = pi.for_project("uA", "pA", now=NOW)
    b = pi.for_project("uA", "pA2", now=NOW)
    assert a and b, "both projects should understand their own story"

    ids_a = {i for s in a for i in s["evidence_observation_ids"]}
    ids_b = {i for s in b for i in s["evidence_observation_ids"]}
    assert ids_a and ids_b
    assert ids_a.isdisjoint(ids_b), "evidence leaked between two projects"

    stored_a = {o["id"] for o in env["obs"].list_observations("pA", user_id="uA")}
    assert ids_a <= stored_a, "pA's reading cites a row that is not pA's"


def test_two_OWNERS_with_identical_wording_never_correlate(env):
    """Different accounts. Same words. Zero crossing — and each side's evidence
    count reflects only its own rows, so nothing was quietly counted twice."""
    _payment_webhook_story(env, user="uA", project="pA")
    _payment_webhook_story(env, user="uB", project="pB")

    a = pi.for_project("uA", "pA", now=NOW)
    b = pi.for_project("uB", "pB", now=NOW)
    ids_a = {i for s in a for i in s["evidence_observation_ids"]}
    ids_b = {i for s in b for i in s["evidence_observation_ids"]}
    assert ids_a and ids_b
    assert ids_a.isdisjoint(ids_b)
    assert sum(s["evidence_count"] for s in a) == 3
    assert sum(s["evidence_count"] for s in b) == 3


def test_a_foreign_project_id_yields_nothing_rather_than_someone_elses_story(env):
    """User B naming user A's project id gets an EMPTY reading — the same
    answer a project that does not exist gives, so existence is not revealed."""
    _payment_webhook_story(env, user="uA", project="pA")
    assert pi.for_project("uB", "pA", now=NOW) == []
    assert pi.for_project("uB", "does-not-exist", now=NOW) == []


def test_observations_recorded_by_another_user_on_the_same_project_id_are_invisible(env):
    """Even a row written against this project id by a different owner must not
    become evidence for the owner's reading."""
    _payment_webhook_story(env, user="uA", project="pA")
    _record(env, user="uB", project="pA", source="slack",
            kind="slack.message.created", summary="#eng: intruder",
            payload={"channel_id": "C9", "text": "payment webhook intruder note",
                     "ts": "9"}, ext="intruder", at=NOW)
    cited = {i for s in pi.for_project("uA", "pA", now=NOW)
             for i in s["evidence_observation_ids"]}
    intruder = [o["id"] for o in env["obs"].list_observations("pA", user_id="uB")]
    assert intruder and cited.isdisjoint(set(intruder))


def test_missing_identity_reads_nothing(env):
    _payment_webhook_story(env)
    assert pi.for_project("", "pA") == []
    assert pi.for_project("uA", "") == []


# ══════════════════════════════════════════════════════════════════════════
# CANDIDATE SYNTHESIS
# ══════════════════════════════════════════════════════════════════════════

def test_ingesting_observations_still_creates_nothing(env):
    """Observation ≠ execution. Recording the whole story creates no candidate,
    no task, no run — synthesis only happens when someone asks for it."""
    _payment_webhook_story(env)
    assert env["cas"].list_candidate_actions("pA") == []
    assert env["tasks"].list_tasks_for_project("pA") == []


def test_a_correlated_state_produces_one_evidence_backed_candidate(env):
    _payment_webhook_story(env)          # merged PR + FAILED prod deploy ⇒ conflict
    created = env["synth"].synthesize_candidates("pA", "uA")
    assert created

    candidates = env["cas"].list_candidate_actions("pA")
    assert len(candidates) == 1, [c["title"] for c in candidates]
    candidate = candidates[0]

    # It names the SUBJECT, not the last event that happened to arrive.
    assert "payment webhook" in candidate["title"].lower()
    assert not candidate["title"].startswith("Act on:")
    # Confidence comes from the correlation, not from a hardcoded 0.5.
    assert candidate["confidence"] != 0.5
    state = [s for s in pi.for_project("uA", "pA", now=NOW)
             if s["subject"] == "payment webhook"][0]
    assert candidate["confidence"] == pytest.approx(state["confidence"]["score"])
    # The evidence is carried, so the proposal is reviewable.
    refs = {r["ref"] for r in candidate["evidence_refs"]}
    assert len(refs) >= 3
    assert refs <= set(state["evidence_observation_ids"])
    assert "Contradicting" in candidate["detail"]


def test_the_raw_observation_candidate_is_suppressed_once_it_is_evidence(env):
    """The failed production deploy is HIGH importance and would previously
    have produced its own "Act on: …" row. It is already evidence for the
    correlated candidate, so it must not be proposed a second time."""
    _payment_webhook_story(env)
    env["synth"].synthesize_candidates("pA", "uA")
    titles = [c["title"] for c in env["cas"].list_candidate_actions("pA")]
    assert not any(t.startswith("Act on:") for t in titles), titles


def test_dedup_converges_on_the_subject_not_on_every_event(env):
    """Three more failures on the same subject update ONE candidate."""
    _payment_webhook_story(env)
    env["synth"].synthesize_candidates("pA", "uA")
    for i in range(3):
        _record(env, source="vercel", kind="vercel.deployment.error",
                summary="Production deployment FAILED for korvix (fix/payment-webhook)",
                payload={"vercel_project_id": "prj_1", "project_name": "korvix",
                         "target": "production", "state": "ERROR",
                         "git": {"repo": "acme/site", "ref": "fix/payment-webhook"}},
                importance="high", ext=f"again-{i}", at=NOW - timedelta(minutes=i))
        env["synth"].synthesize_candidates("pA", "uA")
    assert len(env["cas"].list_candidate_actions("pA")) == 1


def test_a_resolved_subject_proposes_nothing(env):
    """Understanding is not a to-do. A story whose evidence says "fixed" must
    not generate work."""
    _payment_webhook_story(env, deploy_verb="ready")
    env["synth"].synthesize_candidates("pA", "uA")
    titles = [c["title"] for c in env["cas"].list_candidate_actions("pA")]
    assert not any("payment webhook" in t.lower() for t in titles), titles


def test_an_uncorroborated_signal_falls_through_to_the_unchanged_path(env):
    """One lone high-importance failure is not a correlated finding, so the
    existing OBSERVATION promotion still handles it — unchanged."""
    _record(env, source="vercel", kind="vercel.deployment.error",
            summary="Production deployment FAILED for korvix",
            payload={"vercel_project_id": "prj_1", "target": "production"},
            importance="high", ext="lone", at=NOW)
    created = env["synth"].synthesize_candidates("pA", "uA")
    assert created
    candidates = env["cas"].list_candidate_actions("pA")
    assert len(candidates) == 1
    assert candidates[0]["title"].startswith("Act on:")
    assert candidates[0]["source"] == "OBSERVATION"


def test_low_importance_chatter_still_proposes_nothing(env):
    for i in range(5):
        _record(env, source="slack", kind="slack.message.created",
                summary=f"#eng: chat {i}",
                payload={"channel_id": "C1", "text": f"chat {i}", "ts": str(i)},
                importance="low", ext=f"c{i}", at=NOW - timedelta(minutes=i))
    env["synth"].synthesize_candidates("pA", "uA")
    assert env["cas"].list_candidate_actions("pA") == []


def test_synthesis_never_creates_a_task_or_a_run(env):
    _payment_webhook_story(env)
    env["synth"].synthesize_candidates("pA", "uA")
    assert env["tasks"].list_tasks_for_project("pA") == []


def test_candidates_are_never_synthesized_from_another_owners_observations(env):
    """The synthesis writes candidates owned by `user_id`; it must therefore
    read only that owner's rows."""
    _payment_webhook_story(env, user="uB", project="pA")
    created = env["synth"].synthesize_candidates("pA", "uA")
    assert created == []
    assert env["cas"].list_candidate_actions("pA") == []


# ══════════════════════════════════════════════════════════════════════════
# WORKSPACE + BRAIN
# ══════════════════════════════════════════════════════════════════════════

def test_the_workspace_surfaces_project_state_and_stays_bounded(env):
    _payment_webhook_story(env)
    snap = env["ws"].build("uA", "pA", now=NOW)
    assert snap is not None
    states = snap["project_state"]
    assert states and states[0]["subject"] == "payment webhook"
    assert states[0]["state"] == pi.STATE_CONFLICTING
    assert len(states) <= 5
    assert snap["counts"]["project_state"] == len(states)


def test_the_workspace_read_still_writes_nothing(env):
    _payment_webhook_story(env)
    env["ws"].build("uA", "pA", now=NOW)
    env["ws"].build("uA", "pA", now=NOW)
    assert env["cas"].list_candidate_actions("pA") == []
    assert env["tasks"].list_tasks_for_project("pA") == []


def test_needs_attention_is_enriched_but_never_reordered(env):
    """The correlated story is attached to the alarm; the RANKING is untouched."""
    _payment_webhook_story(env)
    snap = env["ws"].build("uA", "pA", now=NOW)

    from backend.services.project_brain import attention as attention_mod
    observations = env["obs"].list_observations("pA", user_id="uA")
    baseline = attention_mod.rank_attention(observations, now=NOW)
    assert [i["id"] for i in snap["attention"]] == [i["id"] for i in baseline]

    linked = [i for i in snap["attention"] if i.get("state_id")]
    assert linked, "the failed deploy should name the story it belongs to"
    assert linked[0]["state_subject"] == "payment webhook"
    # Confidence never rides along on an alarm row (Today renders these).
    assert "state_confidence" not in linked[0]


def test_the_brain_context_leads_with_the_synthesis_and_stays_bounded(env):
    from backend.services.project_brain.client import client as brain
    _payment_webhook_story(env)
    block = brain.build_context("uA", "pA")
    assert block is not None
    assert "Project state" in block.text
    assert "payment webhook" in block.text
    # Synthesis first, raw activity second.
    if "Recent connector activity:" in block.text:
        assert block.text.index("Project state") < block.text.index(
            "Recent connector activity:")
    assert len(block.text) <= 4000
    assert block.metadata["intelligence"] >= 1


def test_the_brain_context_stays_bounded_under_a_large_history(env):
    for i in range(200):
        _record(env, source="github", kind="github.commit.pushed",
                summary=f"Commit {i}: payment webhook tweak {i}",
                payload={"repo": "acme/site", "sha": f"{i:040x}",
                         "message": f"payment webhook tweak {i}"},
                ext=f"commit-{i}", at=NOW - timedelta(minutes=i))
    from backend.services.project_brain.client import client as brain
    block = brain.build_context("uA", "pA")
    if block is not None:
        assert len(block.text) <= 4000
        brain_snapshot = brain.get("uA", "pA")
        assert len(brain_snapshot.intelligence) <= 4
        assert len(brain_snapshot.connector_signals) <= 6


def test_the_brain_now_consumes_business_knowledge(env, tmp_memory_plane_db):
    """AUDIT FINDING, pinned: business knowledge existed and reached agent runs
    but never reached project chat."""
    from backend.services.orchestrator import business_knowledge as bk
    recorded = bk.record_knowledge(
        user_id="uA", project_id="pA", domain=bk.DOMAIN_LEARNING,
        summary="Retrying the payment webhook three times removed the dropped-payment class of bug.",
        source="EXPERIMENT")
    assert recorded, "the business-knowledge adapter should have persisted this"

    from backend.services.project_brain.client import client as brain
    snapshot = brain.get("uA", "pA")
    assert any("dropped-payment" in str(k.get("summary"))
               for k in snapshot.business_knowledge)
    assert "Business knowledge" in (brain.build_context("uA", "pA").text or "")


def test_operational_state_is_never_persisted_as_durable_knowledge(env,
                                                                   tmp_memory_plane_db):
    """The boundary, enforced: a correlation is perishable and must not silently
    become a durable fact."""
    from backend.services.orchestrator import business_knowledge as bk
    _payment_webhook_story(env)
    pi.for_project("uA", "pA", now=NOW)
    env["ws"].build("uA", "pA", now=NOW)
    env["synth"].synthesize_candidates("pA", "uA")
    assert bk.list_knowledge(user_id="uA", project_id="pA") == []


# ══════════════════════════════════════════════════════════════════════════
# WEB BUILD / APP BUILD are none of this layer's business
# ══════════════════════════════════════════════════════════════════════════

def test_build_deliverables_never_enter_the_correlation(env):
    """Project Intelligence reads CONNECTOR observations only. A Web/App Build
    deliverable is owned by the build authority and stays there."""
    env["dls"].create_deliverable(
        run_id="run-1", agent_id="builder", node_id="build", kind="web_build",
        title="Landing Page", project_id="pA", status="completed",
        content={"build_type": "web", "build_status": "completed",
                 "artifact_ref": "artifact://abc", "build_ref": "build://xyz"})
    _payment_webhook_story(env)

    states = pi.for_project("uA", "pA", now=NOW)
    blob = str(states)
    assert "artifact://abc" not in blob and "build://xyz" not in blob

    snap = env["ws"].build("uA", "pA", now=NOW)
    assert len(snap["products"]) == 1          # products still projected as before
    assert snap["products"][0]["title"] == "Landing Page"


def test_a_non_connector_observation_source_is_not_correlated(env):
    """The projection reads the canonical connector source registry, so an
    internal observation source cannot be dragged into a project story."""
    _record(env, source="analytics", kind="metric.spike", summary="payment webhook spike",
            ext="an1", at=NOW)
    _record(env, source="slack", kind="slack.message.created",
            summary="#eng: payment webhook spike",
            payload={"channel_id": "C1", "text": "payment webhook spike", "ts": "1"},
            ext="sl1", at=NOW)
    for state in pi.for_project("uA", "pA", now=NOW):
        assert "analytics" not in state["sources"]


# ══════════════════════════════════════════════════════════════════════════
# COST — understanding the project must stay cheap
# ══════════════════════════════════════════════════════════════════════════

def _count_statements(monkeypatch):
    """Count every SQL statement issued, the same way the workspace read-cost
    test does (both connection paths go through `sqlite3.connect`)."""
    import sqlite3
    real_connect = sqlite3.connect
    state = {"count": 0}

    def _connect(*a, **kw):
        conn = real_connect(*a, **kw)
        conn.set_trace_callback(lambda _s: state.__setitem__("count", state["count"] + 1))
        return conn

    monkeypatch.setattr(sqlite3, "connect", _connect)
    return state


def test_reading_a_projects_intelligence_costs_a_constant_number_of_queries(
        env, monkeypatch):
    """One project with 3 observations and one with 300 must cost the SAME.
    A per-observation lookup would show up here immediately."""
    _payment_webhook_story(env)
    counter = _count_statements(monkeypatch)

    counter["count"] = 0
    pi.for_project("uA", "pA", now=NOW)
    small = counter["count"]

    for i in range(300):
        _record(env, source="github", kind="github.commit.pushed",
                summary=f"Commit {i}", payload={"repo": "acme/site", "sha": f"{i:040x}"},
                ext=f"bulk-{i}", at=NOW - timedelta(minutes=i))
    counter["count"] = 0
    pi.for_project("uA", "pA", now=NOW)
    large = counter["count"]

    assert large == small, f"read cost grew from {small} to {large} statements"
    assert small <= 4, f"{small} statements for one bounded projection"


def test_the_input_itself_is_capped_so_cost_cannot_run_away(env):
    """Even handed an unbounded list, the projection reads a bounded prefix."""
    rows = [{"id": f"x{i}", "source": "slack", "kind": "slack.message.created",
             "summary": f"#eng: note {i}", "observed_at": _iso(NOW),
             "payload": {"channel_id": "C1", "text": f"note {i}", "ts": str(i)}}
            for i in range(5000)]
    from backend.services.project_intelligence import events as pev
    assert len(pev.events_from_observations(rows, limit=pi.MAX_OBSERVATIONS)) \
        == pi.MAX_OBSERVATIONS
    assert len(pi.project_states(rows)) <= pi.MAX_STATES


def test_the_workspace_pays_nothing_extra_for_understanding(env, monkeypatch):
    """`project_state` is derived from observations the page ALREADY read, so
    adding it must not have added a single query to the workspace read."""
    _payment_webhook_story(env)
    counter = _count_statements(monkeypatch)

    counter["count"] = 0
    env["ws"].build("uA", "pA", now=NOW)
    with_states = counter["count"]

    from backend.services import project_intelligence as pi_mod
    monkeypatch.setattr(pi_mod, "project_states", lambda *a, **kw: [])
    counter["count"] = 0
    env["ws"].build("uA", "pA", now=NOW)
    without_states = counter["count"]

    assert with_states == without_states, (
        f"correlating cost {with_states - without_states} extra statements")


# ══════════════════════════════════════════════════════════════════════════
# STALE-CANDIDATE LEAK — the legacy path must respect the CURRENT state
# ══════════════════════════════════════════════════════════════════════════
#
# These pin the rule that the older per-observation path may not act as though
# the correlation layer does not exist. Each case below produced a wrong
# candidate before the membership/promotion split.

def _prod_deploy(env, verb, ext, at, importance, ref="fix/checkout-flow",
                 target="production"):
    label = "Production" if target == "production" else "Preview"
    word = "FAILED" if verb == "error" else "succeeded"
    return _record(
        env, source="vercel", kind=f"vercel.deployment.{verb}",
        summary=f"{label} deployment {word} for korvix ({ref})",
        payload={"vercel_project_id": "prj_1", "project_name": "korvix",
                 "target": target, "state": verb.upper(),
                 "git": {"repo": "acme/site", "ref": ref}},
        ext=ext, importance=importance, at=at)


def _titles(env):
    return [c["title"] for c in env["cas"].list_candidate_actions("pA")]


def test_an_old_failed_deploy_proposes_nothing_after_a_newer_success(env):
    """THE LEAK. The failure is HIGH importance and would previously have
    produced "Act on: Production deployment FAILED" — hours after a later
    deploy to the SAME production target went green."""
    _prod_deploy(env, "error", "d1", NOW - timedelta(hours=5), "high")
    _prod_deploy(env, "ready", "d2", NOW - timedelta(hours=1), "normal")

    state = pi.for_project("uA", "pA", now=NOW)[0]
    assert state["state"] == pi.STATE_LIKELY_RESOLVED

    env["synth"].synthesize_candidates("pA", "uA")
    assert _titles(env) == [], "stale work proposed for a resolved subject"


def test_a_resolved_multi_source_subject_proposes_nothing_from_its_old_rows(env):
    """Same rule with a corroborated, multi-source subject."""
    _payment_webhook_story(env)                       # ends on a FAILED deploy
    _record(env, source="vercel", kind="vercel.deployment.ready",
            summary="Production deployment succeeded for korvix (fix/payment-webhook)",
            payload={"vercel_project_id": "prj_1", "project_name": "korvix",
                     "target": "production", "state": "READY",
                     "git": {"repo": "acme/site", "ref": "fix/payment-webhook"}},
            ext="green", at=NOW)

    state = [s for s in pi.for_project("uA", "pA", now=NOW)
             if s["subject"] == "payment webhook"][0]
    assert state["state"] == pi.STATE_LIKELY_RESOLVED

    env["synth"].synthesize_candidates("pA", "uA")
    assert not any(t.startswith("Act on:") for t in _titles(env)), _titles(env)


def test_an_unresolved_subject_yields_exactly_one_intelligence_candidate(env):
    _payment_webhook_story(env, deploy_verb="error")
    _record(env, source="github", kind="github.issue.opened",
            summary="Issue #9 opened: payment webhook drops events",
            payload={"repo": "acme/site", "number": 9,
                     "title": "payment webhook drops events"},
            ext="iss", at=NOW - timedelta(hours=2))
    env["synth"].synthesize_candidates("pA", "uA")
    titles = _titles(env)
    assert len(titles) == 1, titles
    assert titles[0].startswith("Investigate")


def test_a_conflicting_subject_yields_exactly_one_intelligence_candidate(env):
    _payment_webhook_story(env)          # merged PR + FAILED prod deploy
    env["synth"].synthesize_candidates("pA", "uA")
    titles = _titles(env)
    assert len(titles) == 1, titles
    assert "conflicting evidence" in titles[0]


def test_one_target_failing_repeatedly_is_one_problem_not_many(env):
    """Six failed deploys of a single production target are one recurring
    problem. Previously this produced SIX "Act on:" candidates."""
    for i in range(6):
        _prod_deploy(env, "error", f"dep{i}", NOW - timedelta(hours=6 - i), "high")
    env["synth"].synthesize_candidates("pA", "uA")
    titles = _titles(env)
    assert len(titles) == 1, titles
    assert titles[0].startswith("Investigate")


def test_a_promoted_subject_never_also_emits_a_legacy_candidate(env):
    """Regression on the CAP: `evidence_observation_ids` is bounded, so a
    subject with more members than the cap used to leak the overflow rows into
    the legacy path — emitting the correlated candidate AND duplicates of it."""
    _record(env, source="slack", kind="slack.message.created",
            summary="#eng: payment webhook broken",
            payload={"channel_id": "C1", "text": "payment webhook is broken",
                     "ts": "1"}, ext="s0", at=NOW - timedelta(days=1))
    for i in range(20):
        _record(env, source="github", kind="github.commit.pushed",
                summary=f"Commit {i}: payment webhook retry work",
                payload={"repo": "acme/site", "sha": f"{i:040x}",
                         "message": "payment webhook retry work"},
                ext=f"c{i}", at=NOW - timedelta(hours=20 - i))
    for i in range(6):
        _prod_deploy(env, "error", f"vd{i}", NOW - timedelta(hours=6 - i), "high",
                     ref="fix/payment-webhook")

    state = [s for s in pi.for_project("uA", "pA", now=NOW)
             if s["subject"] == "payment webhook"][0]
    assert state["member_count"] > len(state["evidence_observation_ids"]), (
        "this test is only meaningful when members exceed the public id cap")

    env["synth"].synthesize_candidates("pA", "uA")
    titles = _titles(env)
    assert len(titles) == 1, titles
    assert not any(t.startswith("Act on:") for t in titles)


def test_a_lone_uncorrelated_high_importance_signal_still_uses_the_legacy_path(env):
    """The other half of the rule: suppression requires REAL membership, so a
    signal that correlates with nothing must still be proposed."""
    _record(env, source="github", kind="github.check.failed",
            summary="CI 'build-and-test' failed on main",
            payload={"repo": "acme/site", "run_id": 900, "name": "build-and-test",
                     "conclusion": "failure", "branch": "main"},
            ext="ci1", importance="high", at=NOW - timedelta(hours=1))
    created = env["synth"].synthesize_candidates("pA", "uA")
    assert created
    titles = _titles(env)
    assert len(titles) == 1 and titles[0].startswith("Act on:"), titles


def test_a_singleton_subject_never_silences_the_row_it_was_built_from(env):
    """A subject that groups only ONE observation is not a correlation — it is
    that observation restated. It must not be allowed to suppress it."""
    _prod_deploy(env, "error", "solo", NOW - timedelta(hours=1), "high")
    states = pi.for_project("uA", "pA", now=NOW)
    assert states and states[0]["member_count"] == 1
    env["synth"].synthesize_candidates("pA", "uA")
    assert any(t.startswith("Act on:") for t in _titles(env)), _titles(env)


def test_malformed_and_unattributable_rows_cause_no_accidental_suppression(env):
    """A row from an unknown connector, or one with no usable content, cannot
    join a subject — so it cannot be silenced by one, and a real
    high-importance signal alongside it is still proposed."""
    env["obs"].record_observation(
        user_id="uA", project_id="pA", source="mystery",
        kind="mystery.thing.happened", summary="", payload={},
        external_id="m0", importance="high",
        observed_at=_iso(NOW - timedelta(hours=2)))
    _record(env, source="zapier", kind="zapier.zap.ran", summary="a zap ran",
            ext="z1", importance="high", at=NOW)
    _prod_deploy(env, "error", "solo", NOW - timedelta(hours=1), "high")
    env["synth"].synthesize_candidates("pA", "uA")
    # The zapier row, the mystery row and the deploy failure are each alone —
    # none of them is a member of anything, so none of them is suppressed.
    assert len([t for t in _titles(env) if t.startswith("Act on:")]) == 3


def test_the_membership_index_is_complete_where_the_public_id_list_is_capped(env):
    """The index the suppression decision uses must cover EVERY member, not the
    bounded list that travels in payloads."""
    _record(env, source="slack", kind="slack.message.created",
            summary="#eng: payment webhook broken",
            payload={"channel_id": "C1", "text": "payment webhook is broken",
                     "ts": "1"}, ext="s0", at=NOW - timedelta(days=1))
    for i in range(20):
        _record(env, source="github", kind="github.commit.pushed",
                summary=f"Commit {i}: payment webhook retry work",
                payload={"repo": "acme/site", "sha": f"{i:040x}",
                         "message": "payment webhook retry work"},
                ext=f"c{i}", at=NOW - timedelta(hours=20 - i))

    rows = env["obs"].list_observations("pA", user_id="uA")
    states, membership = pi.project_states_with_membership(rows, now=NOW)
    biggest = max(states, key=lambda s: s["member_count"])
    assert len(biggest["evidence_observation_ids"]) <= pi.MAX_EVIDENCE_IDS
    covered = [o for o in rows if o["id"] in membership]
    assert len(covered) > pi.MAX_EVIDENCE_IDS, (
        "membership must exceed the public cap, or it cannot fix the leak")


def test_the_supervisor_reads_only_the_owners_observations(env):
    """Same scoping class as candidate synthesis: the assessment RETURNS these
    rows, so they must be owner-scoped."""
    from backend.services.orchestrator import project_supervisor as sup
    _payment_webhook_story(env, user="uB", project="pA")
    assessment = sup.assess_business_brain(None, project_id="pA", user_id="uA",
                                           learnings=[])
    assert assessment["observations"] == []
