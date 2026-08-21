# coding: utf-8
"""EVIDENCE GROUNDING — the projection that says what the evidence does NOT establish.

The unit half of the production fix. `test_workspace_answer_evidence_discipline`
covers what reaches the model; this covers the rule itself, because the rule is
what must not drift: a deployment event establishes a deployment event, and any
future edit that quietly promotes it into "the product works" fails here first.

Pure functions over rows. No store, no app, no network, no model.
"""
from __future__ import annotations

import pytest

from backend.services.project_intelligence import grounding as gr


NOW = "2026-08-21T10:00:00+00:00"


def _obs(oid: str, source: str, kind: str, summary: str,
         payload: dict | None = None, at: str = NOW) -> dict:
    return {"id": oid, "source": source, "kind": kind, "summary": summary,
            "payload": payload or {}, "observed_at": at}


# The connector kinds the REAL connectors record. A fixture that invents
# "vercel.deployment.succeeded" would be testing a code path production never
# reaches — the recorded kinds are ready / error / canceled.
def _vercel_production_ready(oid: str = "v1") -> dict:
    return _obs(oid, "vercel", "vercel.deployment.ready",
                "Production deployment ready for korvix-web (main)",
                {"target": "production", "state": "READY",
                 "project_name": "korvix-web", "uid": "dpl_1"})


def _vercel_preview_ready(oid: str = "v2") -> dict:
    return _obs(oid, "vercel", "vercel.deployment.ready",
                "Preview deployment ready for korvix-web (feat/pricing)",
                {"target": "preview", "state": "READY",
                 "project_name": "korvix-web", "uid": "dpl_2"})


VERCEL_ONLY = [_vercel_production_ready(), _vercel_preview_ready()]


def _claim(grounding: dict, code: str) -> dict:
    for row in grounding["claims"]:
        if row["claim"] == code:
            return row
    raise AssertionError(f"claim {code} missing from grounding")


# ══════════════════════════════════════════════════════════════════════════
# A Vercel-only project — the exact shape that produced the invented answers
# ══════════════════════════════════════════════════════════════════════════

def test_a_deployment_establishes_a_deployment_and_nothing_else():
    g = gr.ground_claims(VERCEL_ONLY)
    assert _claim(g, gr.CLAIM_DEPLOYMENT)["support"] == gr.SUPPORT_DIRECT
    assert _claim(g, gr.CLAIM_DEPLOYMENT)["sources"] == ["vercel"]
    # Every one of these was asserted in production off these two events.
    for code in (gr.CLAIM_TESTS, gr.CLAIM_FUNCTIONALITY, gr.CLAIM_USERS,
                 gr.CLAIM_FEEDBACK, gr.CLAIM_GOAL_PROGRESS,
                 gr.CLAIM_BUSINESS_OUTCOME, gr.CLAIM_CODE_CHANGE,
                 gr.CLAIM_COORDINATION):
        assert _claim(g, code)["support"] == gr.SUPPORT_NONE, code


def test_a_single_reporting_tool_is_marked_uncorroborated():
    g = gr.ground_claims(VERCEL_ONLY)
    assert g["single_source_project"] is True
    assert _claim(g, gr.CLAIM_DEPLOYMENT)["single_source"] is True


def test_what_is_missing_is_named_concretely_not_left_to_inference():
    g = gr.ground_claims(VERCEL_ONLY)
    missing = gr.missing_evidence(g)
    assert gr.EV_CI in missing            # to claim tests ran
    assert gr.EV_HUMAN_REPORT in missing  # to claim it works / has users
    assert gr.EV_GOAL in missing          # to claim goal progress
    assert gr.EV_METRIC_KNOWLEDGE in missing
    # A claim that IS established asks for nothing.
    assert _claim(g, gr.CLAIM_DEPLOYMENT)["missing"] == []


def test_a_failed_deployment_establishes_a_deployment_too():
    """Polarity is the subject layer's job. Grounding answers a different
    question — whether a KIND of evidence exists at all — and a red deploy is
    still deployment evidence."""
    g = gr.ground_claims([_obs("v3", "vercel", "vercel.deployment.error",
                               "Production deployment failed",
                               {"target": "production", "state": "ERROR"})])
    assert _claim(g, gr.CLAIM_DEPLOYMENT)["support"] == gr.SUPPORT_DIRECT
    assert _claim(g, gr.CLAIM_FUNCTIONALITY)["support"] == gr.SUPPORT_NONE


def test_an_empty_project_establishes_nothing_at_all():
    g = gr.ground_claims([])
    assert gr.unsupported(g) == list(gr.CLAIMS)
    assert g["sources"] == []
    assert g["single_source_project"] is False


# ══════════════════════════════════════════════════════════════════════════
# Evidence that DOES exist — the projection must not be uniformly negative
# ══════════════════════════════════════════════════════════════════════════

def test_github_checks_establish_that_tests_ran():
    g = gr.ground_claims(VERCEL_ONLY + [
        _obs("g1", "github", "github.check.succeeded",
             "CI passed for PR #212", {"repo": "acme/site", "name": "pytest"}),
    ])
    assert _claim(g, gr.CLAIM_TESTS)["support"] == gr.SUPPORT_DIRECT
    assert "github" in _claim(g, gr.CLAIM_TESTS)["sources"]


def test_a_passing_check_is_ADJACENT_to_functionality_never_proof_of_it():
    """The distinction the whole module exists for: a green check is real
    evidence about the check. Reported as `indirect`, so the consumer is
    required to phrase it as what it is."""
    g = gr.ground_claims(VERCEL_ONLY + [
        _obs("g1", "github", "github.check.succeeded", "CI passed",
             {"repo": "acme/site", "name": "pytest"}),
    ])
    assert _claim(g, gr.CLAIM_FUNCTIONALITY)["support"] == gr.SUPPORT_INDIRECT
    # …and it still says nothing whatsoever about users.
    assert _claim(g, gr.CLAIM_USERS)["support"] == gr.SUPPORT_NONE


def test_github_pull_requests_establish_a_code_change():
    g = gr.ground_claims([
        _obs("g2", "github", "github.pull_request.merged",
             "PR #212 merged: pricing page copy",
             {"repo": "acme/site", "number": 212, "merged": True}),
    ])
    assert _claim(g, gr.CLAIM_CODE_CHANGE)["support"] == gr.SUPPORT_DIRECT


def test_a_message_establishes_only_what_its_own_words_carry():
    """REVIEW FINDING. The first cut counted a message's EXISTENCE: any Slack
    post or mail made "someone's feedback is on record" established. A standup
    note is not feedback, and its existence is not evidence of anything but
    coordination."""
    chit_chat = gr.ground_claims(VERCEL_ONLY + [
        _obs("s1", "slack", "slack.message.created", "#eng: standup at 10",
             {"text": "standup at 10, I am late", "channel_id": "C1"}),
    ])
    assert _claim(chit_chat, gr.CLAIM_COORDINATION)["support"] == gr.SUPPORT_DIRECT
    for code in (gr.CLAIM_FUNCTIONALITY, gr.CLAIM_USERS, gr.CLAIM_FEEDBACK):
        assert _claim(chit_chat, code)["support"] == gr.SUPPORT_NONE, code


def test_a_message_that_does_talk_about_customers_is_a_HINT_to_be_quoted():
    """…and when the words ARE about a customer and a broken form, the claim
    becomes available — as `indirect`, marked `textual`. A keyword is not a
    reading of a message, so it never reaches `direct`."""
    g = gr.ground_claims(VERCEL_ONLY + [
        _obs("s1", "slack", "slack.message.created", "#support: customer report",
             {"text": "a customer reported the waitlist form is broken",
              "channel_id": "C1"}),
    ])
    for code in (gr.CLAIM_FUNCTIONALITY, gr.CLAIM_USERS, gr.CLAIM_FEEDBACK):
        row = _claim(g, code)
        assert row["support"] == gr.SUPPORT_INDIRECT, code
        assert row["basis"] == gr.BASIS_TEXTUAL, code
        assert row["support"] != gr.SUPPORT_DIRECT, code


def test_gmail_is_read_the_same_way_as_slack():
    quiet = gr.ground_claims([
        _obs("m1", "gmail", "gmail.message.received", "Re: waitlist",
             {"subject": "Re: waitlist", "from": "a@example.com"}),
    ])
    assert _claim(quiet, gr.CLAIM_FEEDBACK)["support"] == gr.SUPPORT_NONE

    loud = gr.ground_claims([
        _obs("m2", "gmail", "gmail.message.received",
             "Customer complaint: waitlist form",
             {"subject": "Customer complaint: the waitlist form is broken",
              "from": "a@customer.example"}),
    ])
    assert _claim(loud, gr.CLAIM_FEEDBACK)["support"] == gr.SUPPORT_INDIRECT


def test_an_automated_sender_is_not_a_person_and_not_coordination():
    """A no-reply build digest is traffic, not people communicating. It used to
    establish feedback."""
    for payload in ({"subject": "Your weekly deployment digest",
                     "from": "noreply@vercel.com"},
                    {"subject": "customer report", "from": "notifications@x.io"}):
        g = gr.ground_claims([
            _obs("m1", "gmail", "gmail.message.received", "digest", payload),
        ])
        assert _claim(g, gr.CLAIM_COORDINATION)["support"] == gr.SUPPORT_NONE, payload
        assert _claim(g, gr.CLAIM_FEEDBACK)["support"] == gr.SUPPORT_NONE, payload

    bot = gr.ground_claims([
        _obs("s1", "slack", "slack.message.created", "build failed",
             {"text": "a customer facing error occurred", "channel_id": "C1",
              "bot_id": "B123"}),
    ])
    assert _claim(bot, gr.CLAIM_COORDINATION)["support"] == gr.SUPPORT_NONE
    assert _claim(bot, gr.CLAIM_USERS)["support"] == gr.SUPPORT_NONE


def test_a_signal_word_never_matches_inside_another_word():
    """The same substring trap the finance detector fell into: "user" must not
    hit inside "abuser", and "review" must not hit inside "previewing"."""
    g = gr.ground_claims([
        _obs("s1", "slack", "slack.message.created", "note",
             {"text": "the abuser table migration is previewing fine",
              "channel_id": "C1"}),
    ])
    assert _claim(g, gr.CLAIM_USERS)["support"] == gr.SUPPORT_NONE
    assert _claim(g, gr.CLAIM_FEEDBACK)["support"] == gr.SUPPORT_NONE


def test_calendar_establishes_coordination_and_nothing_about_the_product():
    g = gr.ground_claims(VERCEL_ONLY + [
        _obs("c1", "calendar", "calendar.event.created", "Roadmap review",
             {"title": "Roadmap review", "event_id": "e1"}),
    ])
    assert _claim(g, gr.CLAIM_COORDINATION)["support"] == gr.SUPPORT_DIRECT
    assert _claim(g, gr.CLAIM_FUNCTIONALITY)["support"] == gr.SUPPORT_NONE
    assert _claim(g, gr.CLAIM_USERS)["support"] == gr.SUPPORT_NONE


def test_recorded_customer_knowledge_establishes_users_and_feedback():
    g = gr.ground_claims(VERCEL_ONLY, knowledge=[
        {"domain": "customer", "summary": "3 customers asked for SSO",
         "source": "gmail"},
    ])
    assert _claim(g, gr.CLAIM_USERS)["support"] == gr.SUPPORT_DIRECT
    assert _claim(g, gr.CLAIM_FEEDBACK)["support"] == gr.SUPPORT_DIRECT


def test_recorded_metric_knowledge_establishes_a_business_outcome():
    g = gr.ground_claims(VERCEL_ONLY, knowledge=[
        {"domain": "metric", "summary": "signups +12% week over week"},
    ])
    assert _claim(g, gr.CLAIM_BUSINESS_OUTCOME)["support"] == gr.SUPPORT_DIRECT
    # A metric is not a customer talking.
    assert _claim(g, gr.CLAIM_FEEDBACK)["support"] == gr.SUPPORT_NONE


def test_goals_make_progress_DISCUSSABLE_but_never_established():
    """Recorded goals give the words a referent. They do not make "we are
    progressing" true — no connector event says a change advanced a goal."""
    none_yet = gr.ground_claims(VERCEL_ONLY)
    assert _claim(none_yet, gr.CLAIM_GOAL_PROGRESS)["support"] == gr.SUPPORT_NONE
    assert gr.EV_GOAL in _claim(none_yet, gr.CLAIM_GOAL_PROGRESS)["missing"]

    with_goals = gr.ground_claims(VERCEL_ONLY, goals=["Ship the waitlist"],
                                  decisions=["Bill annually"])
    row = _claim(with_goals, gr.CLAIM_GOAL_PROGRESS)
    assert row["support"] == gr.SUPPORT_INDIRECT
    assert row["support"] != gr.SUPPORT_DIRECT


# ══════════════════════════════════════════════════════════════════════════
# Shape guarantees the consumers rely on
# ══════════════════════════════════════════════════════════════════════════

def test_every_claim_is_reported_exactly_once_in_the_declared_order():
    g = gr.ground_claims(VERCEL_ONLY)
    assert [r["claim"] for r in g["claims"]] == list(gr.CLAIMS)


def test_the_projection_never_raises_on_junk():
    for junk in ([None], [{}], [{"source": "x"}], "not a list", None,
                 [{"source": "vercel", "kind": "vercel.deployment.ready",
                   "payload": "not-a-dict"}]):
        out = gr.ground_claims(junk)          # type: ignore[arg-type]
        assert isinstance(out, dict) and "claims" in out


def test_the_inferred_claims_are_exactly_the_ones_production_invented():
    """A guard on the vocabulary itself. Adding a claim code is fine; quietly
    moving one of these OUT of the inferred set is the regression."""
    assert gr.INFERRED_CLAIMS == frozenset({
        gr.CLAIM_FUNCTIONALITY, gr.CLAIM_USERS, gr.CLAIM_FEEDBACK,
        gr.CLAIM_GOAL_PROGRESS, gr.CLAIM_BUSINESS_OUTCOME,
    })


@pytest.mark.parametrize("claim", sorted(gr.INFERRED_CLAIMS))
def test_no_amount_of_build_evidence_alone_establishes_an_inferred_claim(claim):
    """Deployments, commits and green checks from every machine source at once
    — the richest possible MACHINE evidence — still establish none of the
    claims that need a person or a recorded fact."""
    machines = [
        _vercel_production_ready(), _vercel_preview_ready(),
        _obs("g1", "github", "github.pull_request.merged", "PR #1 merged",
             {"repo": "a/b", "number": 1, "merged": True}),
        _obs("g2", "github", "github.commit.pushed", "3 commits pushed",
             {"repo": "a/b"}),
        _obs("g3", "github", "github.deployment_status.success",
             "deployment succeeded", {"repo": "a/b", "state": "success",
                                      "environment": "production"}),
    ]
    row = _claim(gr.ground_claims(machines), claim)
    assert row["support"] == gr.SUPPORT_NONE, row
