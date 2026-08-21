# coding: utf-8
"""EVIDENCE DISCIPLINE — what the model is allowed to conclude from a project.

THE PRODUCTION BEHAVIOUR THIS PINS
----------------------------------
With #656 merged, inline Workspace answers stopped coming back about unrelated
web content and started using the project. They then over-read it. On a project
whose entire evidence was two Vercel deployments, the answers said:

    "the app's core functionality is ready for use"
    "testing is being performed"
    "the project is progressing toward its goals"
    "the project is currently evaluating user feedback"

Not one of those was in the evidence. They were in the prompt's SILENCE: the
block said everything the project had and nothing about what it lacked, so the
model supplied the things a project usually has.

WHAT IS ASSERTED HERE
---------------------
These tests read the literal final message array at the provider seam and check
the CONTRACT the model is given, because that is the thing this change controls.
A test cannot prove what a model will say; it can prove that the prompt names
each forbidden claim explicitly, names the evidence that would license it, and
stops naming it the moment that evidence exists. A future edit that drops the
"NOT ESTABLISHED" line — by rewording it, by re-ordering the section under its
character cap, by adding a section that squeezes it out — fails here.

Vercel-only is the negative fixture. GitHub / Slack / Gmail / Calendar / recorded
knowledge / goals are the positive ones, so the fix cannot be "make it refuse
everything".

No network, no model calls: the provider is a capturing fake.
"""
from __future__ import annotations

from types import SimpleNamespace
from typing import AsyncIterator, Optional

import pytest

from backend.services.project_intelligence import grounding as gr
from backend.services.providers.streaming import (
    ProviderStreamDone, ProviderStreamStart, ProviderStreamToken,
)


# ══════════════════════════════════════════════════════════════════════════
# Fixtures
# ══════════════════════════════════════════════════════════════════════════

class _Captured:
    def __init__(self) -> None:
        self.requests: list = []

    def _text(self, msg) -> str:
        if isinstance(msg.content, str):
            return msg.content
        if isinstance(msg.content, list):
            return "\n".join(str(b.get("text", "")) for b in msg.content
                             if isinstance(b, dict))
        return ""

    @property
    def system(self) -> str:
        for m in self.requests[-1].messages:
            if m.role == "system":
                return self._text(m)
        return ""


@pytest.fixture()
def fake_provider(monkeypatch):
    captured = _Captured()

    class _FakeProvider:
        name = "fake-stream"
        default_model = "fake-model-1"
        supports_streaming = True

        def model_supports_vision(self, _model):
            return False

        async def stream_chat_completion(self, req) -> AsyncIterator:
            captured.requests.append(req)
            yield ProviderStreamStart(provider=self.name, model=req.model)
            yield ProviderStreamToken(delta="ok")
            yield ProviderStreamDone(
                finish_reason="stop", model=req.model,
                usage=type("U", (), {"prompt_tokens": 1, "completion_tokens": 1,
                                     "total_tokens": 2})(),
            )

    from backend.routes import v2_chat_stream as stream_route
    monkeypatch.setattr(stream_route, "get_provider", lambda _name: _FakeProvider())
    return captured


@pytest.fixture()
def env(tmp_path, monkeypatch):
    projects_db = str(tmp_path / "projects.db")
    sessions_db = str(tmp_path / "sessions.db")
    monkeypatch.setenv("PROJECTS_DB_PATH", projects_db)
    monkeypatch.setenv("SESSIONS_DB_PATH", sessions_db)
    monkeypatch.setenv("ENABLE_PROJECTS", "true")
    monkeypatch.setenv("ENABLE_PROJECT_BRAIN", "true")
    monkeypatch.setenv("ENABLE_SESSIONS", "true")
    monkeypatch.setenv("ENABLE_MEMORY_PLANE", "false")
    monkeypatch.setenv("ENABLE_TOOLS", "false")
    monkeypatch.setenv("ENABLE_TOOLS_RUNTIME", "false")

    from backend.services.projects import store as projects_store
    from backend.services.sessions import store as sessions_store
    from backend.services.orchestrator import observations_store as obs
    from backend.services.orchestrator import goals_store
    # Every project-scoped store this test touches is redirected at THIS test's
    # temp file — goals included. A goal written by one test into a module-level
    # DB_PATH is a goal every later test inherits, and "this project has goals"
    # is precisely one of the facts under test here.
    for mod in (projects_store, obs, goals_store):
        monkeypatch.setattr(mod, "DB_PATH", projects_db, raising=False)
    monkeypatch.setattr(sessions_store, "DB_PATH", sessions_db, raising=False)
    projects_store._reset_for_tests()
    projects_store.init()
    obs.init_observations_table()
    goals_store.init_goals_table()
    sessions_store.init()

    from backend.services.sessions import client as sc
    return SimpleNamespace(projects=projects_store, sessions=sc, obs=obs,
                           goals=goals_store)


OWNER = "owner-uid"
PID = "p-evidence"


def _record(env, *, source: str, kind: str, summary: str,
            payload: dict | None = None, ext: str | None = None) -> None:
    env.obs.record_observation(
        user_id=OWNER, project_id=PID, source=source, kind=kind,
        summary=summary, payload=payload or {},
        external_id=ext or f"{PID}:{source}:{summary[:24]}",
        importance="normal")


def _vercel_only(env, description: str = "The marketing site and waitlist."):
    """The bug report's project: Vercel connected, two real deployment events,
    and nothing else in the world."""
    p = env.projects.create_project(OWNER, name="Korvix Web",
                                    description=description, project_id=PID)
    _record(env, source="vercel", kind="vercel.deployment.ready",
            summary="Production deployment ready for korvix-web (main)",
            payload={"target": "production", "state": "READY",
                     "project_name": "korvix-web", "uid": "dpl_1"})
    _record(env, source="vercel", kind="vercel.deployment.ready",
            summary="Preview deployment ready for korvix-web (feat/pricing)",
            payload={"target": "preview", "state": "READY",
                     "project_name": "korvix-web", "uid": "dpl_2"})
    return p


def _ask(client, question: str, project_id: str = PID):
    return client.post("/v2/chat/stream", json={
        "user_id": OWNER, "project_id": project_id,
        "messages": [{"role": "user", "content": question}],
    })


#: The four Workspace intents, as the page sends them (English locale).
Q_CHANGED = ("What changed in this project recently? List only the changes the "
             "evidence actually records, each with its source and date, and "
             "skip any consequence no source records.")
Q_STATE = ("What is the current state of this project? Give me only what the "
           "evidence establishes, source by source, and then say plainly what "
           "it does not establish.")
Q_UNCERTAIN = ("What is still unverified in this project? Name each open "
               "question and the specific evidence that would settle it — a "
               "check, a deployment, a person's report, a recorded goal.")
Q_ABOUT = ("What is this project about? Answer only from its description, "
           "goals and recorded knowledge — if those are empty, say so rather "
           "than inferring a topic from deployments or activity.")

#: The claims the production answers invented, and the words they used.
FORBIDDEN_MARKERS = {
    "tests":            "that anything was tested or that tests ran",
    "functionality":    "that it works, is functional, or is ready for use",
    "users":            "that anyone is using it, or that it has users",
    "feedback":         "that user feedback exists or is being reviewed",
    "goal_progress":    "that it is progressing toward or meeting any goal",
    "business_outcome": "that any revenue, growth or business result occurred",
}


# ══════════════════════════════════════════════════════════════════════════
# A — the Vercel-only project cannot license any of the invented claims
# ══════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("question", [Q_CHANGED, Q_STATE, Q_UNCERTAIN, Q_ABOUT],
                         ids=["changed", "state", "uncertain", "about"])
def test_A_a_vercel_only_project_forbids_every_invented_claim(
        client, env, fake_provider, question):
    """One assertion per production symptom, on all four intents. Before this
    change the prompt was silent about every one of them."""
    _vercel_only(env)
    assert _ask(client, question).status_code == 200

    system = fake_provider.system
    assert "Evidence base" in system
    assert "NOT ESTABLISHED by anything in this project" in system
    for label, marker in FORBIDDEN_MARKERS.items():
        assert marker in system, f"{label} is not forbidden in the prompt"


def test_A2_the_deployment_itself_is_still_reported_as_established(
        client, env, fake_provider):
    """Discipline is not silence. What Vercel DID report is stated as a fact,
    with its source — and flagged as the single uncorroborated source it is."""
    _vercel_only(env)
    assert _ask(client, Q_CHANGED).status_code == 200
    system = fake_provider.system
    assert "ESTABLISHED: a deployment was reported" in system
    assert "(vercel)" in system
    assert "one tool only, uncorroborated" in system


def test_A3_the_missing_evidence_is_named_not_left_as_a_gap(
        client, env, fake_provider):
    """"Say what is absent and what would settle it" is only honest if the
    prompt actually carries the concrete list."""
    _vercel_only(env)
    assert _ask(client, Q_UNCERTAIN).status_code == 200
    system = fake_provider.system
    assert "Would establish what is missing:" in system
    assert "CI / test result from GitHub checks" in system


def test_A4_the_answering_contract_travels_with_the_block(
        client, env, fake_provider):
    """The per-project facts are useless without the rule for using them. Both
    halves must be in front of the model, and the rule must come first."""
    _vercel_only(env)
    assert _ask(client, Q_STATE).status_code == 200
    system = fake_provider.system
    assert "EVIDENCE DISCIPLINE" in system
    assert "AN EVENT PROVES ITSELF AND NOTHING MORE" in system
    assert "ONE SOURCE IS NOT CORROBORATION" in system
    assert "INTERPRETATION SEPARATELY, AND LABELLED" in system
    assert system.index("EVIDENCE DISCIPLINE") < system.index("Evidence base")


def test_A5_a_deployment_is_never_described_as_readiness_anywhere_in_the_prompt(
        client, env, fake_provider):
    """The prompt's own prose must not model the mistake. No sentence composed
    by the backend may equate a deploy with a working, tested, or ready
    product — a model copies the register it is given."""
    _vercel_only(env)
    assert _ask(client, Q_STATE).status_code == 200
    system = fake_provider.system
    established = [ln for ln in system.splitlines()
                   if ln.startswith("- ESTABLISHED:")]
    assert established
    for line in established:
        low = line.lower()
        for word in ("ready for use", "functional", "working", "tested",
                     "users are", "user feedback"):
            assert word not in low, line


def test_A6_an_empty_project_forbids_everything_including_the_deployment(
        client, env, fake_provider):
    env.projects.create_project(OWNER, name="Blank", description="",
                                project_id=PID)
    assert _ask(client, Q_ABOUT).status_code == 200
    system = fake_provider.system
    if "Evidence base" in system:
        assert "that anything was deployed" in system
        assert "that any code changed" in system


# ══════════════════════════════════════════════════════════════════════════
# B — when the evidence IS there, the prohibition lifts
# ══════════════════════════════════════════════════════════════════════════

def test_B_github_checks_lift_the_tests_prohibition(client, env, fake_provider):
    _vercel_only(env)
    _record(env, source="github", kind="github.check.succeeded",
            summary="CI passed for PR #212 (pytest)",
            payload={"repo": "acme/site", "name": "pytest",
                     "conclusion": "success"})
    assert _ask(client, Q_STATE).status_code == 200
    system = fake_provider.system
    assert FORBIDDEN_MARKERS["tests"] not in system
    assert "ESTABLISHED: a check / test run reported a result" in system
    # …and a green check still does not license "it works".
    assert "evidence about the CHECKS" in system
    assert FORBIDDEN_MARKERS["users"] in system
    assert FORBIDDEN_MARKERS["feedback"] in system


def test_B2_a_message_lifts_a_prohibition_only_when_its_words_say_so(
        client, env, fake_provider):
    """REVIEW FINDING, pinned. A standup note is not customer feedback. The
    first cut lifted the feedback and functionality prohibitions on the mere
    EXISTENCE of a Slack message."""
    _vercel_only(env)
    _record(env, source="slack", kind="slack.message.created",
            summary="#eng: standup at 10",
            payload={"text": "standup at 10, I am late", "channel_id": "C1",
                     "channel_name": "eng"})
    assert _ask(client, Q_STATE).status_code == 200
    system = fake_provider.system
    # Coordination is real — people ARE writing here.
    assert "that anyone is discussing or working on it" not in system
    # Everything else stays forbidden.
    for claim in ("functionality", "users", "feedback"):
        assert FORBIDDEN_MARKERS[claim] in system, claim


def test_B2b_a_message_that_does_report_a_customer_problem_is_quotable(
        client, env, fake_provider):
    """The other half: when the words ARE about a customer and a broken form,
    the claim comes into play — as something to QUOTE, never as a finding."""
    _vercel_only(env)
    _record(env, source="slack", kind="slack.message.created",
            summary="#support: customer report",
            payload={"text": "a customer reported the waitlist form is broken",
                     "channel_id": "C1", "channel_name": "support"})
    assert _ask(client, Q_STATE).status_code == 200
    system = fake_provider.system
    # There is now something to QUOTE…
    assert "ADJACENT EVIDENCE" in system
    assert "QUOTE it and say who" in system
    assert "wording is a hint, not proof it works" in system
    # …and the claims themselves stay unassertable: a message's wording is not
    # the claim, and letting it lift the prohibition would hand the contract to
    # whoever wrote the message.
    assert "it does NOT lift the prohibition above" in system
    for claim in ("feedback", "functionality", "users", "business_outcome",
                  "goal_progress"):
        assert FORBIDDEN_MARKERS[claim] in system, claim


def test_B2c_an_automated_digest_licenses_nothing(client, env, fake_provider):
    """A no-reply build mail is traffic, not people communicating."""
    _vercel_only(env)
    _record(env, source="gmail", kind="gmail.message.received",
            summary="Your weekly deployment digest",
            payload={"subject": "Your weekly deployment digest",
                     "from": "noreply@vercel.com"})
    assert _ask(client, Q_STATE).status_code == 200
    system = fake_provider.system
    for claim in ("functionality", "users", "feedback"):
        assert FORBIDDEN_MARKERS[claim] in system, claim
    assert "that anyone is discussing or working on it" in system


def test_B3_gmail_is_read_the_same_way_as_slack(client, env, fake_provider):
    _vercel_only(env)
    _record(env, source="gmail", kind="gmail.message.received",
            summary="Customer complaint: waitlist form",
            payload={"subject": "Customer complaint: the waitlist form is broken",
                     "from": "someone@customer.example"})
    assert _ask(client, Q_STATE).status_code == 200
    system = fake_provider.system
    assert "a message reads like feedback" in system
    assert FORBIDDEN_MARKERS["feedback"] in system   # quotable, not assertable


def test_B4_a_calendar_event_lifts_coordination_and_nothing_else(
        client, env, fake_provider):
    _vercel_only(env)
    _record(env, source="calendar", kind="calendar.event.created",
            summary="Roadmap review",
            payload={"title": "Roadmap review", "event_id": "e1"})
    assert _ask(client, Q_STATE).status_code == 200
    system = fake_provider.system
    assert "that anyone is discussing or working on it" not in system
    assert FORBIDDEN_MARKERS["functionality"] in system
    assert FORBIDDEN_MARKERS["users"] in system


def test_B5_recorded_goals_make_progress_discussable_but_not_established(
        client, env, fake_provider):
    """The honest middle: with goals recorded, "progressing toward its goals"
    is still not established — but the prompt now says progress may be
    discussed against the goals BY NAME rather than banning the subject."""
    _vercel_only(env)
    env.goals.create_goal(project_id=PID, user_id=OWNER,
                          title="Ship the public waitlist")

    assert _ask(client, Q_STATE).status_code == 200
    system = fake_provider.system
    # The goal gives the words a referent — it is quotable by name…
    assert "goals exist, but nothing links a change to one" in system
    assert "ADJACENT EVIDENCE" in system
    # …and "the project is progressing toward its goals" is still not something
    # any evidence here establishes.
    assert FORBIDDEN_MARKERS["goal_progress"] in system


def test_B6_a_rich_project_forbids_little_and_still_carries_the_contract(
        client, env, fake_provider):
    """Every machine and human source at once. The prohibition list shrinks to
    what is genuinely absent, and the discipline rules stay."""
    _vercel_only(env)
    _record(env, source="github", kind="github.pull_request.merged",
            summary="PR #212 merged: pricing page",
            payload={"repo": "acme/site", "number": 212, "merged": True})
    _record(env, source="github", kind="github.check.succeeded",
            summary="CI passed", payload={"repo": "acme/site", "name": "pytest"})
    _record(env, source="slack", kind="slack.message.created",
            summary="#support: customer says checkout is broken",
            payload={"text": "a customer says checkout is broken",
                     "channel_id": "C1"})
    assert _ask(client, Q_CHANGED).status_code == 200
    system = fake_provider.system
    # Machine-recorded facts become assertable…
    assert FORBIDDEN_MARKERS["tests"] not in system
    assert "that any code changed" not in system
    # …the human-read ones stay quotable-only…
    for still_forbidden in ("functionality", "feedback", "users",
                            "business_outcome"):
        assert FORBIDDEN_MARKERS[still_forbidden] in system, still_forbidden
    assert "ADJACENT EVIDENCE" in system
    assert "EVIDENCE DISCIPLINE" in system


# ══════════════════════════════════════════════════════════════════════════
# C — the four intents ask four different questions
# ══════════════════════════════════════════════════════════════════════════

def test_C_the_four_intents_are_distinct_and_each_names_its_own_evidence_rule():
    """They used to be four phrasings of "tell me about this project", which is
    why they produced four variations of the same over-read paragraph."""
    prompts = [Q_CHANGED, Q_STATE, Q_UNCERTAIN, Q_ABOUT]
    assert len(set(prompts)) == 4
    assert "each with its source and date" in Q_CHANGED
    assert "what it does not establish" in Q_STATE
    assert "the specific evidence that would settle it" in Q_UNCERTAIN
    assert "rather than inferring a topic from deployments" in Q_ABOUT


@pytest.mark.parametrize("question", [Q_CHANGED, Q_STATE, Q_UNCERTAIN, Q_ABOUT])
def test_C2_no_intent_can_be_routed_to_a_web_search(question):
    """The intents were rewritten; #656's routing fix must survive the rewrite.
    Each is still recognisably about THIS project, and none of them reads as an
    explicit request to search the web, a price question or a weather
    question."""
    from backend.services.tool_extraction import (
        detect_web_search_intent, is_project_self_referential,
    )
    assert is_project_self_referential(question), question
    intent = detect_web_search_intent(question)
    assert intent.kind in ("scored", "none"), (intent.kind, intent.triggers)


def test_C3_shipped_locales_carry_the_same_four_intents():
    """The prompts live in three locale files. A rewrite that lands in English
    only would leave Turkish and German users on the old, vaguer questions —
    which is where the bug was reported."""
    import re
    from pathlib import Path
    root = Path(__file__).resolve().parents[2] / "src" / "i18n" / "locales"
    for locale in ("en", "tr", "de"):
        text = (root / f"{locale}.ts").read_text(encoding="utf-8")
        for key in ("projectAskChangedPrompt", "projectAskStatePrompt",
                    "projectAskUncertainPrompt", "projectAskAboutPrompt"):
            match = re.search(key + r": '((?:[^'\\]|\\.)*)'", text)
            assert match, f"{locale}.{key} missing"
            # Long enough to carry an evidence rule at all — the old ones were
            # one short question with no constraint in them.
            assert len(match.group(1)) > 80, f"{locale}.{key} lost its rule"


# ══════════════════════════════════════════════════════════════════════════
# D — the grounding the prompt shows is the grounding the authority computed
# ══════════════════════════════════════════════════════════════════════════

def test_D_the_prompt_states_exactly_what_the_projection_decided(
        client, env, fake_provider):
    """No second opinion: what the block forbids is precisely the claim set
    `project_intelligence.ground_claims` reported as unsupported for these
    rows."""
    _vercel_only(env)
    assert _ask(client, Q_STATE).status_code == 200
    system = fake_provider.system

    rows = env.obs.list_observations(PID, user_id=OWNER, limit=60)
    computed = gr.ground_claims(rows, goals=[], decisions=[], knowledge=[])
    unsupported = set(gr.not_established(computed))

    for claim, marker in FORBIDDEN_MARKERS.items():
        if claim in unsupported:
            assert marker in system, claim
        else:
            assert marker not in system, claim


def test_D2_a_foreign_project_gets_no_evidence_base_at_all(
        client, env, fake_provider):
    """Ownership is upstream of all of this. Nothing here weakens it — and no
    grounding line may leak the shape of a project the caller cannot see."""
    _vercel_only(env)
    theirs = env.projects.create_project("other-uid", name="Theirs",
                                         description="x", project_id="p-theirs")
    assert _ask(client, Q_STATE, project_id=theirs.id).status_code == 200
    system = fake_provider.system
    assert "Evidence base" not in system
    assert "Korvix Web" not in system
