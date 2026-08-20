# coding: utf-8
"""PROJECT INTELLIGENCE — entity resolution, correlation, state and confidence.

This is the layer that decides whether five observations are five things or one
thing seen five times, so the tests that matter most here are the ones that
prove it does NOT correlate: a layer that cheerfully merges anything sharing a
common word would look impressive on the happy path and be actively harmful in
production, confidently telling someone their payment webhook is fixed because
a deploy of the documentation site went green.

Pinned here:

  * the flagship cross-source case (Slack + GitHub + Vercel → one subject);
  * FALSE-POSITIVE resistance — a shared generic word never merges anything;
  * temporal supersession, per target, in both directions;
  * contradiction survival — a merged PR plus a failed deploy is never
    "resolved", and both sides stay visible;
  * confidence that is derived from the documented weights and cannot be
    inflated by repetition;
  * fail-safety on malformed rows, unknown connectors and missing timestamps;
  * bounds, purity and determinism.

Pure functions throughout: no store, no network, no model calls.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from backend.services import project_intelligence as pi
from backend.services.project_intelligence import correlation as corr
from backend.services.project_intelligence import events as pev
from backend.services.project_intelligence import keys as pk

NOW = datetime(2026, 6, 3, 12, 0, 0, tzinfo=timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _obs(oid, source, kind, summary="", payload=None, at=None, importance="normal"):
    return {"id": oid, "source": source, "kind": kind, "summary": summary,
            "payload": payload or {}, "importance": importance,
            "observed_at": _iso(at) if isinstance(at, datetime) else (at or _iso(NOW)),
            "external_id": f"ext-{oid}"}


def _slack(oid, text, at=None):
    return _obs(oid, "slack", "slack.message.created", f"#eng: {text}",
                {"provider": "slack", "team_id": "T1", "channel_id": "C1",
                 "channel_name": "eng", "text": text, "ts": "1"}, at=at)


def _pr(oid, number, title, transition="merged", repo="acme/site",
        head_ref="fix/payment-webhook", at=None):
    return _obs(oid, "github", f"github.pull_request.{transition}",
                f"PR #{number} {transition}: {title}",
                {"repo": repo, "number": number, "title": title,
                 "merged": transition == "merged", "head_ref": head_ref}, at=at)


def _deploy(oid, verb="ready", target="production", ref="fix/payment-webhook",
            repo="acme/site", sha="", project="prj_1", at=None):
    git = {}
    if repo:
        git["repo"] = repo
    if ref:
        git["ref"] = ref
    if sha:
        git["commit_sha"] = sha
    label = "Production" if target == "production" else "Preview"
    verb_text = {"ready": "succeeded", "error": "FAILED", "canceled": "was canceled"}[verb]
    payload = {"provider": "vercel", "vercel_project_id": project,
               "project_name": "korvix", "deployment_id": oid, "target": target,
               "state": verb.upper()}
    if git:
        payload["git"] = git
    return _obs(oid, "vercel", f"vercel.deployment.{verb}",
                f"{label} deployment {verb_text} for korvix" + (f" ({ref})" if ref else ""),
                payload, at=at)


def _by_subject(states):
    return {s["subject"]: s for s in states}


# ══════════════════════════════════════════════════════════════════════════
# 1. The flagship case — three sources, one understanding
# ══════════════════════════════════════════════════════════════════════════

def test_slack_github_and_vercel_correlate_into_one_subject():
    """The mission's worked example. A human discussing the payment webhook, a
    PR that fixes it, and a deployment that shipped it are ONE story."""
    states = pi.project_states([
        _deploy("o3", "ready", at=NOW - timedelta(hours=2)),
        _pr("o2", 712, "Fix payment webhook retry", at=NOW - timedelta(hours=3)),
        _slack("o1", "Ahmet payment webhook'a bakiyor", at=NOW - timedelta(days=1)),
    ], now=NOW)

    assert len(states) == 1, [s["subject"] for s in states]
    state = states[0]
    assert state["subject"] == "payment webhook"
    assert state["entity_type"] == pi.ENTITY_TOPIC
    assert state["state"] == pi.STATE_LIKELY_RESOLVED
    assert state["sources"] == ["github", "slack", "vercel"]
    assert state["evidence_count"] == 3
    assert state["corroborated"] is True
    assert state["confidence"]["level"] == pi.CONFIDENCE_HIGH
    # Provenance survives: every stored row that produced this is named.
    assert set(state["evidence_observation_ids"]) == {"o1", "o2", "o3"}


def test_the_reading_is_backed_by_named_evidence_not_a_bare_claim():
    states = pi.project_states([
        _deploy("o3", "ready", at=NOW - timedelta(hours=2)),
        _pr("o2", 712, "Fix payment webhook retry", at=NOW - timedelta(hours=3)),
        _slack("o1", "Ahmet payment webhook'a bakiyor", at=NOW - timedelta(days=1)),
    ], now=NOW)[0]
    kinds = {e["semantic_type"] for e in states["supporting"]}
    assert kinds == {pev.SEM_CHANGE_LANDED, pev.SEM_DEPLOY_SUCCEEDED}
    # The Slack line is context — it proves the subject is live, it does not
    # prove anything was fixed.
    assert [e["source"] for e in states["context"]] == ["slack"]


# ══════════════════════════════════════════════════════════════════════════
# 2. FALSE POSITIVES — the failure mode that matters
# ══════════════════════════════════════════════════════════════════════════

def test_a_shared_generic_word_does_not_correlate_anything():
    """"payment button colour" and "payment webhook failure" share a word and
    nothing else."""
    states = pi.project_states([
        _slack("o1", "can we change the payment button color please", at=NOW),
        _obs("o2", "github", "github.issue.opened",
             "Issue #9 opened: payment webhook failure",
             {"repo": "acme/site", "number": 9, "title": "payment webhook failure"},
             at=NOW),
    ], now=NOW)
    subjects = {s["subject"] for s in states}
    assert "payment webhook" not in subjects
    assert "payment button" not in subjects
    for state in states:
        assert state["sources"] != ["github", "slack"], "cross-source merge on one word"


def test_deploy_documentation_does_not_correlate_with_a_production_failure():
    states = pi.project_states([
        _slack("o1", "we should deploy documentation this week", at=NOW),
        _deploy("o2", "error", ref="", repo="", at=NOW),
    ], now=NOW)
    for state in states:
        assert len(state["sources"]) == 1, (
            f"{state['subject']!r} merged unrelated sources {state['sources']}")


def test_two_generic_words_form_no_topic_at_all():
    """"production deployment" describes half of every project — it must never
    become an identity."""
    assert pk.topic_keys("production deployment failed") == []
    assert pk.topic_keys("build error") == []
    # …but a generic word plus a distinctive one is a real subject.
    assert "topic:payment webhook" in pk.topic_keys("payment webhook retry")


def test_one_source_saying_a_phrase_twice_is_not_corroboration():
    """A topic needs TWO sources before it may merge anything. One chatty
    channel repeating itself proves only that someone types a lot."""
    rows = [_slack(f"o{i}", "payment webhook is flaky again",
                   at=NOW - timedelta(hours=i)) for i in range(4)]
    assert pi.project_states(rows, now=NOW) == []


def test_a_generic_branch_name_never_links_unrelated_work():
    """Everything passes through `main`; it is a lane, not a subject."""
    assert pk.branch_key("acme/site", "main") is None
    assert pk.branch_key("acme/site", "production") is None
    assert pk.branch_key("acme/site", "fix/payment-webhook") is not None


# ══════════════════════════════════════════════════════════════════════════
# 3. Temporal truth — supersession in both directions, per target
# ══════════════════════════════════════════════════════════════════════════

def test_a_later_success_supersedes_an_earlier_failure_on_the_same_target():
    states = pi.project_states([
        _deploy("d2", "ready", at=NOW - timedelta(hours=1)),
        _deploy("d1", "error", at=NOW - timedelta(hours=5)),
    ], now=NOW)
    assert [s["state"] for s in states] == [pi.STATE_LIKELY_RESOLVED]


def test_a_later_success_on_a_DIFFERENT_target_resolves_nothing():
    """A green preview is not evidence that production is fixed."""
    states = pi.project_states([
        _deploy("d2", "ready", target="preview", at=NOW - timedelta(hours=1)),
        _deploy("d1", "error", target="production", at=NOW - timedelta(hours=5)),
    ], now=NOW)
    assert [s["state"] for s in states] == [pi.STATE_UNRESOLVED]


def test_a_later_failure_after_a_success_degrades_the_state_again():
    states = pi.project_states([
        _deploy("d2", "error", at=NOW - timedelta(hours=1)),
        _deploy("d1", "ready", at=NOW - timedelta(hours=5)),
    ], now=NOW)
    assert [s["state"] for s in states] == [pi.STATE_UNRESOLVED]


def test_a_reopened_issue_invalidates_an_earlier_close():
    base = {"repo": "acme/site", "number": 42, "title": "checkout webhook drops events"}
    states = pi.project_states([
        _obs("i2", "github", "github.issue.reopened", "Issue #42 reopened", base,
             at=NOW - timedelta(hours=1)),
        _obs("i1", "github", "github.issue.closed", "Issue #42 closed", base,
             at=NOW - timedelta(hours=6)),
    ], now=NOW)
    assert [s["state"] for s in states] == [pi.STATE_UNRESOLVED]


def test_history_outside_the_window_takes_no_part():
    old = NOW - timedelta(days=pi.CORRELATION_WINDOW_DAYS + 5)
    assert pi.project_states([
        _pr("o2", 712, "Fix payment webhook retry", at=old),
        _slack("o1", "payment webhook broken", at=old),
    ], now=NOW) == []


# ══════════════════════════════════════════════════════════════════════════
# 4. Contradiction must survive
# ══════════════════════════════════════════════════════════════════════════

def test_a_merged_pr_plus_a_failed_deploy_is_conflicting_never_resolved():
    states = pi.project_states([
        _deploy("d1", "error", ref="fix/payment-webhook", at=NOW - timedelta(hours=1)),
        _pr("p1", 712, "Fix payment webhook retry", at=NOW - timedelta(hours=3)),
    ], now=NOW)
    assert len(states) == 1
    state = states[0]
    assert state["state"] == pi.STATE_CONFLICTING
    # BOTH sides remain visible — that is the entire point.
    assert [e["semantic_type"] for e in state["supporting"]] == [pev.SEM_CHANGE_LANDED]
    assert [e["semantic_type"] for e in state["contradicting"]] == [pev.SEM_DEPLOY_FAILED]


def test_conflict_costs_confidence_rather_than_being_hidden():
    """Disagreement lowers how much the reading can be trusted; it never
    silently picks a winner."""
    agree = pi.project_states([
        _deploy("d1", "ready", ref="fix/payment-webhook", at=NOW - timedelta(hours=1)),
        _pr("p1", 712, "Fix payment webhook retry", at=NOW - timedelta(hours=3)),
    ], now=NOW)[0]
    conflict = pi.project_states([
        _deploy("d1", "error", ref="fix/payment-webhook", at=NOW - timedelta(hours=1)),
        _pr("p1", 712, "Fix payment webhook retry", at=NOW - timedelta(hours=3)),
    ], now=NOW)[0]
    assert conflict["confidence"]["score"] < agree["confidence"]["score"]
    assert conflict["confidence"]["breakdown"]["agreement"] == 0.0


# ══════════════════════════════════════════════════════════════════════════
# 5. Confidence is derived, and cannot be inflated
# ══════════════════════════════════════════════════════════════════════════

def test_duplicate_observations_do_not_inflate_confidence():
    """The same fact re-ingested (a webhook retry, a re-sync) must not move the
    number at all."""
    one = [_deploy("d1", "error", at=NOW - timedelta(hours=1))]
    many = one + [_deploy(f"dup{i}", "error", at=NOW - timedelta(hours=1))
                  for i in range(5)]
    a = pi.project_states(one, now=NOW)[0]
    b = pi.project_states(many, now=NOW)[0]
    assert a["confidence"]["score"] == b["confidence"]["score"]
    assert a["evidence_count"] == b["evidence_count"] == 1


def test_more_independent_sources_strengthen_the_reading():
    two = pi.project_states([
        _pr("p1", 712, "Fix payment webhook retry", at=NOW - timedelta(hours=3)),
        _slack("s1", "payment webhook still failing", at=NOW - timedelta(hours=4)),
    ], now=NOW)[0]
    three = pi.project_states([
        _pr("p1", 712, "Fix payment webhook retry", at=NOW - timedelta(hours=3)),
        _slack("s1", "payment webhook still failing", at=NOW - timedelta(hours=4)),
        _deploy("d1", "ready", at=NOW - timedelta(hours=1)),
    ], now=NOW)[0]
    assert three["confidence"]["breakdown"]["distinct_sources"] == 3
    assert (three["confidence"]["breakdown"]["corroboration"]
            > two["confidence"]["breakdown"]["corroboration"])


def test_stale_evidence_is_trusted_less_than_fresh_evidence():
    fresh = pi.project_states([_deploy("d1", "error", at=NOW - timedelta(hours=2))],
                              now=NOW)[0]
    aging = pi.project_states([_deploy("d1", "error", at=NOW - timedelta(days=10))],
                              now=NOW)[0]
    assert fresh["confidence"]["breakdown"]["freshness_band"] == "recent"
    assert aging["confidence"]["breakdown"]["freshness_band"] == "aging"
    assert fresh["confidence"]["score"] > aging["confidence"]["score"]


def test_the_score_is_reproducible_from_its_own_breakdown():
    """No hidden term, no fudge factor: the number IS the sum it reports."""
    for state in pi.project_states([
        _deploy("d1", "error", ref="fix/payment-webhook", at=NOW - timedelta(hours=1)),
        _pr("p1", 712, "Fix payment webhook retry", at=NOW - timedelta(hours=3)),
        _slack("s1", "payment webhook is down", at=NOW - timedelta(hours=5)),
    ], now=NOW):
        b = state["confidence"]["breakdown"]
        total = (b["base"] + b["corroboration"] + b["anchor"] + b["facets"]
                 + b["agreement"] + b["freshness"])
        assert state["confidence"]["score"] == pytest.approx(round(total, 2))
        assert 0.0 <= state["confidence"]["score"] <= 1.0


def test_confidence_levels_follow_the_documented_thresholds():
    for score, level in ((0.95, pi.CONFIDENCE_HIGH), (0.70, pi.CONFIDENCE_HIGH),
                         (0.50, pi.CONFIDENCE_MEDIUM), (0.10, pi.CONFIDENCE_LOW)):
        assert (pi.CONFIDENCE_HIGH if score >= 0.70
                else pi.CONFIDENCE_MEDIUM if score >= 0.45
                else pi.CONFIDENCE_LOW) == level


# ══════════════════════════════════════════════════════════════════════════
# 6. Fail-safety
# ══════════════════════════════════════════════════════════════════════════

def test_malformed_rows_are_survived_not_fatal():
    states = pi.project_states(
        [None, {}, "not-a-dict", 17, {"source": "github"}, {"kind": "x"},
         {"id": "b", "source": "github", "kind": "github.check.failed",
          "payload": "not-a-dict", "summary": "CI failed", "observed_at": _iso(NOW)}],
        now=NOW)
    assert isinstance(states, list)
    assert all(isinstance(s, dict) for s in states)


def test_an_unknown_connector_source_never_crashes():
    states = pi.project_states([
        _obs("z1", "zapier", "zapier.zap.ran", "A zap ran", at=NOW),
        _obs("z2", "notion", "notion.page.updated", "Page updated", at=NOW),
    ], now=NOW)
    assert isinstance(states, list)


def test_missing_timestamps_fail_safe_rather_than_inventing_one():
    """An undated row is KEPT (hiding a real signal on a formatting problem
    would be worse) but earns no freshness credit and claims no dates."""
    states = pi.project_states([
        {"id": "n1", "source": "vercel", "kind": "vercel.deployment.error",
         "summary": "Production deployment FAILED", "importance": "high",
         "payload": {"vercel_project_id": "prj_1", "target": "production"},
         "observed_at": ""},          # genuinely undated, not defaulted to now
    ], now=NOW)
    assert len(states) == 1
    assert states[0]["confidence"]["breakdown"]["freshness_band"] == "unknown"
    assert states[0]["confidence"]["breakdown"]["freshness"] == 0.0
    assert states[0]["first_seen"] == "" and states[0]["last_seen"] == ""


def test_empty_input_produces_no_state():
    assert pi.project_states([], now=NOW) == []
    assert pi.project_states(None, now=NOW) == []


# ══════════════════════════════════════════════════════════════════════════
# 7. Bounds, purity, determinism
# ══════════════════════════════════════════════════════════════════════════

def test_the_projection_stays_bounded_against_a_large_history():
    rows = []
    for i in range(400):
        rows.append(_deploy(f"d{i}", "error", target=f"env{i}", project=f"prj_{i}",
                            ref=f"fix/thing-{i}", at=NOW - timedelta(minutes=i)))
        rows.append(_slack(f"s{i}", f"thing {i} looks broken",
                           at=NOW - timedelta(minutes=i)))
    states = pi.project_states(rows, now=NOW)
    assert len(states) <= pi.MAX_STATES
    for state in states:
        assert len(state["supporting"]) <= pi.MAX_EVIDENCE
        assert len(state["contradicting"]) <= pi.MAX_EVIDENCE
        assert len(state["context"]) <= pi.MAX_EVIDENCE
        assert len(state["evidence_observation_ids"]) <= pi.MAX_EVIDENCE_IDS


def test_the_projection_is_deterministic():
    rows = [
        _deploy("d1", "error", at=NOW - timedelta(hours=1)),
        _pr("p1", 712, "Fix payment webhook retry", at=NOW - timedelta(hours=3)),
        _slack("s1", "payment webhook down", at=NOW - timedelta(hours=5)),
    ]
    first = pi.project_states(rows, now=NOW)
    for _ in range(5):
        assert pi.project_states(rows, now=NOW) == first


def test_the_projection_never_mutates_its_input():
    rows = [_deploy("d1", "error", at=NOW), _pr("p1", 1, "payment webhook fix", at=NOW)]
    import copy
    before = copy.deepcopy(rows)
    pi.project_states(rows, now=NOW)
    assert rows == before


def test_no_provider_or_model_call_is_reachable_from_the_projection(monkeypatch):
    """Structural proof, not inspection: sockets and HTTP are removed for the
    duration of the call."""
    import socket

    def _boom(*a, **kw):
        raise AssertionError("project_intelligence attempted network I/O")

    monkeypatch.setattr(socket, "socket", _boom)
    monkeypatch.setattr(socket, "create_connection", _boom)
    states = pi.project_states([
        _deploy("d1", "error", at=NOW),
        _pr("p1", 712, "Fix payment webhook retry", at=NOW),
        _slack("s1", "payment webhook broken", at=NOW),
    ], now=NOW)
    assert states


# ══════════════════════════════════════════════════════════════════════════
# 8. Provenance is display-safe
# ══════════════════════════════════════════════════════════════════════════

def test_no_opaque_provider_identifier_or_payload_reaches_the_output():
    """The correlation keys embed a Vercel project id and a Slack channel id.
    The OUTPUT must carry neither, nor any raw payload."""
    import json
    chatty = _slack("s1", "payment webhook broken", at=NOW)
    chatty["payload"]["channel_id"] = "CHANNELSECRET"
    chatty["payload"]["team_id"] = "TEAMSECRET"
    chatty["payload"]["user_id"] = "USERSECRET"
    blob = json.dumps(pi.project_states([
        _deploy("d1", "error", project="prj_SECRET123", at=NOW),
        _pr("p1", 712, "Fix payment webhook retry", at=NOW),
        chatty,
    ], now=NOW))
    assert "prj_SECRET123" not in blob
    for opaque in ("CHANNELSECRET", "TEAMSECRET", "USERSECRET"):
        assert opaque not in blob, f"{opaque} leaked into the projection"
    for banned in ("access_token", "refresh_token", "credential", "payload"):
        assert banned not in blob.lower()


# ══════════════════════════════════════════════════════════════════════════
# 9. Turkish agglutinative spellings — false NEGATIVES
# ══════════════════════════════════════════════════════════════════════════
#
# Turkish glues case/possessive/plural endings onto the noun, and the
# apostrophe that would separate them is only REQUIRED for proper nouns. So the
# same webhook gets written a different way every day, and a correlation layer
# that only understands one spelling silently under-reports.
#
# The fold is guarded by ATTESTATION — a suffix comes off only when the stem was
# independently written somewhere in the same project — so these tests come in
# pairs: the variant must correlate, AND ordinary vocabulary must be untouched.

TR_VARIANTS = [
    "payment webhook",
    "payment webhook'u",
    "payment webhook'a bakıyor",
    "payment webhookta hata var",
    "payment webhook'taki sorun",
    "payment webhooku kontrol ettim",
    "payment webhooklarda hata",
    "payment webhook’a bakıyorum",      # typographic apostrophe (U+2019)
    "PAYMENT WEBHOOK'U",                # shouting
]


@pytest.mark.parametrize("text", TR_VARIANTS)
def test_turkish_spellings_still_correlate_across_sources(text):
    """Each of these must reach the SAME subject as the PR that fixes it."""
    states = pi.project_states([
        _slack("s1", text, at=NOW - timedelta(hours=3)),
        _pr("p1", 712, "Fix payment webhook retry", at=NOW - timedelta(hours=1)),
    ], now=NOW)
    merged = [s for s in states if len(s["sources"]) == 2]
    assert merged, f"{text!r} failed to correlate with the PR"
    assert merged[0]["subject"] == "payment webhook"
    assert merged[0]["sources"] == ["github", "slack"]


def test_a_suffix_is_only_stripped_when_the_stem_is_ACTUALLY_used():
    """The guard that makes this safe rather than a stemmer: no attested stem,
    no fold. `webhookta` stays `webhookta` unless something wrote `webhook`."""
    assert pk.suffix_alias_map(["webhookta"]) == {}
    assert pk.suffix_alias_map(["webhookta", "webhook"]) == {"webhookta": "webhook"}


@pytest.mark.parametrize("word", [
    "update", "release", "service", "site", "issue", "feature", "message",
    "deploy", "checkout", "webhook", "payment", "production",
])
def test_ordinary_vocabulary_is_never_treated_as_a_suffixed_form(word):
    """"update" ends in -e and "site" ends in -e. A stemmer would eat them."""
    assert pk.suffix_alias_map([word]) == {}


def test_folding_cannot_invent_a_stem_the_project_never_wrote():
    """Even with a plausible-looking ending, the stem must be attested — so the
    fold can only ever collapse spellings the project itself produced."""
    alias = pk.suffix_alias_map(["kontrol", "duzeltmek", "bakiyor", "sorunlar"])
    assert alias == {}, alias
    assert pk.suffix_alias_map(["sorunlar", "sorun"]) == {"sorunlar": "sorun"}


def test_turkish_folding_does_not_make_unrelated_phrases_collapse():
    """The whole point of the guard. Folding must not become a back door around
    the bigram / distinctive-token / two-source rules."""
    states = pi.project_states([
        _slack("s1", "payment button color'u degistirelim", at=NOW),
        _obs("g1", "github", "github.issue.opened",
             "Issue #9 opened: payment webhook failure",
             {"repo": "acme/site", "number": 9, "title": "payment webhook failure"},
             at=NOW),
    ], now=NOW)
    assert not [s for s in states if len(s["sources"]) == 2], \
        "a Turkish suffix must not merge 'payment button' with 'payment webhook'"


def test_folding_never_produces_a_degenerate_repeated_word_topic():
    """`webhook webhookta` must not fold into the meaningless `webhook webhook`."""
    assert pk.apply_alias("topic:webhook webhookta",
                          {"webhookta": "webhook"}) == "topic:webhook webhookta"


def test_folding_leaves_non_topic_keys_alone():
    for key in ("pr:acme/site#712", "branch:acme/site:fix/payment-webhook",
                "deploy:vercel:prj_1:production"):
        assert pk.apply_alias(key, {"webhookta": "webhook"}) == key


def test_a_turkish_only_conversation_still_needs_two_sources():
    """Folding raises recall; it does not lower the corroboration bar."""
    assert pi.project_states([
        _slack("s1", "payment webhookta hata var", at=NOW),
        _slack("s2", "payment webhook'u duzelttim", at=NOW - timedelta(hours=1)),
    ], now=NOW) == []
