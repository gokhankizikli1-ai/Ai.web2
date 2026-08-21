# coding: utf-8
"""PROJECT EVIDENCE IS THE AUTHORITY — the regression suite for a live bug.

WHAT HAPPENED IN PRODUCTION
---------------------------
After the inline "Ask Korvix" surface shipped, clicking a suggested question on
a real Project Workspace — a project with real Vercel deployments and refreshed
activity — streamed an answer that had nothing to do with the project. "Bu
projede son zamanlarda ne değişti?" came back about climate change; "Bu projenin
şu anda ne hakkında olduğunu özetle." came back about a TÜBİTAK research
programme.

Every existing test passed, because every existing test ran with the tool
runtime OFF. Nothing about the injection was broken:

  * the page sent the workspace's `project_id` on every request,
  * the backend resolved the owner and built the Project Context block,
  * the log line said `injected=True`,
  * and the block really was in the system prompt.

What was broken was PRECEDENCE. Each of those questions contains an ordinary
temporal word ("son", "recently", "güncel", "right now"), so the fuzzy
web-search scorer cleared its 0.4 gate and searched the QUESTION ITSELF. A
question about the user's own project has no external subject, so what came back
was generic content about nothing in particular — and that block was folded in
LAST, into both the system prompt AND the user's own turn, under the words
"treat as authoritative", while the project's real evidence sat in the middle
with no claim of authority at all.

So these tests run with the tool runtime ON — production-like — and pin the
rule: for a question about the project the user is looking at, that project's
evidence answers it, and anything external is background or is not fetched at
all.

THE SEAM
--------
The fake provider IS the seam: `stream_chat_completion` receives the exact
`ProviderRequest` the real provider would have received, so every assertion here
is made against the literal final message array, at the last instruction before
the model. Nothing is logged, and no user content leaves the test process.

No network. No model calls. The search tool is a spy that records what it was
asked and returns deliberately unrelated results.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from typing import AsyncIterator, Optional

import pytest

from backend.services.providers.streaming import (
    ProviderStreamDone, ProviderStreamStart, ProviderStreamToken,
)


NOW = datetime(2026, 8, 21, 12, 0, tzinfo=timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat()


# ── The generic, unrelated content the live bug answered with ────────────────
# Deliberately the SHAPE of what the production search returned for a
# self-referential Turkish question: real-looking, well-sourced, and about
# nothing the user asked.
_UNRELATED_SEARCH_BLOCK = (
    "KORVIX WEB SEARCH RESULTS\n"
    "- İklim değişikliği son on yılda belirgin şekilde hızlandı "
    "(iklim-arastirma.example.org)\n"
    "- TÜBİTAK 1001 programı proje başvuruları için son tarih açıklandı "
    "(tubitak-duyuru.example.org)\n"
)
_UNRELATED_MARKERS = ("İklim değişikliği", "TÜBİTAK", "iklim-arastirma.example.org")


# ══════════════════════════════════════════════════════════════════════════
# Fixtures
# ══════════════════════════════════════════════════════════════════════════

class _Captured:
    """Every ProviderRequest the route handed the provider, in order."""

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

    @property
    def last_user(self) -> str:
        for m in reversed(self.requests[-1].messages):
            if m.role == "user":
                return self._text(m)
        return ""

    @property
    def whole_prompt(self) -> str:
        """Everything the model is about to read, system and turns alike."""
        return "\n".join(self._text(m) for m in self.requests[-1].messages)


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
    """A production-like backend: projects, brain and — the part the old tests
    left out — the TOOL RUNTIME. With tools off, the bug is invisible."""
    projects_db = str(tmp_path / "projects.db")
    sessions_db = str(tmp_path / "sessions.db")
    monkeypatch.setenv("PROJECTS_DB_PATH", projects_db)
    monkeypatch.setenv("SESSIONS_DB_PATH", sessions_db)
    monkeypatch.setenv("ENABLE_PROJECTS", "true")
    monkeypatch.setenv("ENABLE_PROJECT_BRAIN", "true")
    monkeypatch.setenv("ENABLE_SESSIONS", "true")
    monkeypatch.setenv("ENABLE_MEMORY_PLANE", "false")
    # ── production-like tool state ───────────────────────────────────────
    monkeypatch.setenv("ENABLE_TOOLS", "true")
    monkeypatch.setenv("ENABLE_WEB_RESEARCH", "true")
    monkeypatch.setenv("ENABLE_TOOLS_RUNTIME", "true")
    monkeypatch.setenv("ENABLE_GITHUB_TOOL", "false")
    monkeypatch.setenv("ENABLE_BROWSER_TOOL", "false")

    from backend.services.projects import store as projects_store
    from backend.services.sessions import store as sessions_store
    from backend.services.orchestrator import observations_store as obs
    for mod in (projects_store, obs):
        monkeypatch.setattr(mod, "DB_PATH", projects_db, raising=False)
    monkeypatch.setattr(sessions_store, "DB_PATH", sessions_db, raising=False)
    projects_store._reset_for_tests()
    projects_store.init()
    obs.init_observations_table()
    sessions_store.init()

    from backend.services.sessions import client as sc
    return SimpleNamespace(projects=projects_store, sessions=sc, obs=obs)


@pytest.fixture()
def search_spy(monkeypatch):
    """Stands in for the live web_research call. Records every invocation and
    returns unrelated-but-plausible results — the failure mode itself."""
    calls: list[dict] = []

    async def _fake(**kwargs):
        calls.append(kwargs)
        return _UNRELATED_SEARCH_BLOCK, {
            "triggered": True, "fetched": True,
            "sources": [{"url": "https://tubitak-duyuru.example.org",
                         "title": "TÜBİTAK 1001"}],
        }

    import backend.services.tool_extraction as te
    monkeypatch.setattr(te, "build_web_search_context_block", _fake, raising=True)
    return calls


@pytest.fixture()
def context_calls(monkeypatch):
    """Records the (project_id, user_id) every context build was asked for, and
    still returns the real block. This is how "the right project, on every
    request" is asserted — the wire itself carries no project id past the route."""
    seen: list[tuple[Optional[str], Optional[str]]] = []
    from backend.services.projects import context as pctx
    real = pctx.build_project_context_block

    def _spy(project_id, *, user_id=None, **kw):
        seen.append((project_id, user_id))
        return real(project_id, user_id=user_id, **kw)

    monkeypatch.setattr(pctx, "build_project_context_block", _spy, raising=True)
    return seen


# ══════════════════════════════════════════════════════════════════════════
# Seeding — a project that looks like the one in the bug report
# ══════════════════════════════════════════════════════════════════════════

def _vercel(env, *, user: str, project: str, kind: str, summary: str,
            hours_ago: int, importance: str = "normal") -> None:
    env.obs.record_observation(
        user_id=user, project_id=project, source="vercel", kind=kind,
        summary=summary,
        payload={"vercel_project_id": "prj_1", "project_name": "korvix-web",
                 "target": "production" if "production" in summary.lower() else "preview"},
        external_id=f"{project}:vercel:{summary[:24]}",
        importance=importance, observed_at=_iso(NOW - timedelta(hours=hours_ago)),
    )


def _project_with_deployments(env, owner: str = "owner-uid",
                              project_id: str = "p-korvix"):
    """The bug report's project: real Vercel activity, one production success
    and one preview deployment, plus a description the answer should use."""
    p = env.projects.create_project(
        owner, name="Korvix Web",
        description="The marketing site and waitlist for Korvix.",
        project_id=project_id,
    )
    _vercel(env, user=owner, project=p.id,
            kind="vercel.deployment.succeeded",
            summary="Production deployment SUCCEEDED for korvix-web (main)",
            hours_ago=2, importance="high")
    _vercel(env, user=owner, project=p.id,
            kind="vercel.deployment.created",
            summary="Preview deployment for korvix-web (feat/pricing-page)",
            hours_ago=6)
    return p


def _empty_project(env, owner: str = "owner-uid", project_id: str = "p-empty"):
    """A real, owned project with no evidence in it at all."""
    return env.projects.create_project(owner, name="Blank", description="",
                                       project_id=project_id)


def _ask(client, *, project_id: Optional[str], question: str,
         history: Optional[list] = None, user: str = "owner-uid"):
    """Exactly the body `lib/inlineAsk.ts` sends: prior turns, then the
    question, the project id as a routing hint, and the request locale."""
    messages = list(history or []) + [{"role": "user", "content": question}]
    body = {
        "user_id": user, "messages": messages,
        "locale": "tr", "language_mode": "auto", "message_language": "tr",
    }
    if project_id is not None:
        body["project_id"] = project_id
    return client.post("/v2/chat/stream", json=body)


#: The prompts the Project Workspace actually sends, verbatim from
#: `src/i18n/locales/tr.ts`. Not paraphrases — the bug lived in the exact words.
SUGGESTED_TR = (
    "Bu projede önce neye bakmalıyım ve neden?",
    "Bu projede son zamanlarda ne değişti?",
    "Bu projenin mevcut durumu ne ve kanıtlar gerçekte ne gösteriyor?",
    "Bu projede hâlâ belirsiz veya doğrulanmamış olan ne ve hangi kanıt eksik?",
    "Bu projenin güncel hedefleri neler?",
    "Bu projenin şu anda ne hakkında olduğunu özetle.",
)
SUGGESTED_EN = (
    "What should I look at first in this project, and why?",
    "What changed in this project recently?",
    "What is the current state of this project, and what does the evidence actually show?",
    "What is still uncertain or unverified in this project, and what evidence is missing?",
    "What are the current goals for this project?",
    "Summarize what this project is about right now.",
)


# ══════════════════════════════════════════════════════════════════════════
# A — "Son zamanlarda ne değişti?" answers from the project's deployments
# ══════════════════════════════════════════════════════════════════════════

def test_A_what_changed_recently_is_answered_from_this_projects_deployments(
        client, env, fake_provider, search_spy, context_calls):
    """The exact reported question, on the exact reported kind of project.

    Before the fix this request ran a web search for "Bu projede son zamanlarda
    ne değişti?" and handed the model unrelated results as authoritative. Now
    the project's own Vercel facts are what is in front of the model, and the
    generic content is not in the prompt at all — there is nothing left for the
    answer to fall back to."""
    proj = _project_with_deployments(env)

    r = _ask(client, project_id=proj.id,
             question="Bu projede son zamanlarda ne değişti?")
    assert r.status_code == 200

    prompt = fake_provider.whole_prompt
    # The project's real evidence reached the model.
    assert "[Project Context — Korvix Web]" in prompt
    assert "Production deployment SUCCEEDED for korvix-web (main)" in prompt
    assert "Preview deployment for korvix-web (feat/pricing-page)" in prompt
    # …under an explicit statement that it is the authority.
    assert "PROJECT EVIDENCE AUTHORITY" in fake_provider.system
    assert fake_provider.system.index("PROJECT EVIDENCE AUTHORITY") \
        < fake_provider.system.index("[Project Context — Korvix Web]")

    # No generic search ran, and no generic content is anywhere in the prompt.
    assert search_spy == [], "a question about this project must not be web-searched"
    for marker in _UNRELATED_MARKERS:
        assert marker not in prompt

    # The context was built for THIS project, for the authenticated owner.
    assert context_calls == [(proj.id, "owner-uid")]


def test_A2_the_english_question_behaves_identically(
        client, env, fake_provider, search_spy):
    """The bug was reported in Turkish; it was never a Turkish bug. "recently"
    scores exactly like "son"."""
    proj = _project_with_deployments(env)
    assert _ask(client, project_id=proj.id,
                question="What changed in this project recently?").status_code == 200
    assert search_spy == []
    assert "Production deployment SUCCEEDED for korvix-web (main)" \
        in fake_provider.whole_prompt


# ══════════════════════════════════════════════════════════════════════════
# B — "Bu proje ne hakkında?"
# ══════════════════════════════════════════════════════════════════════════

def test_B_what_is_this_project_about_uses_the_project_context(
        client, env, fake_provider, search_spy):
    """The question that came back describing a TÜBİTAK programme. The project
    says what it is; that description is what the model gets."""
    proj = _project_with_deployments(env)

    r = _ask(client, project_id=proj.id,
             question="Bu projenin şu anda ne hakkında olduğunu özetle.")
    assert r.status_code == 200

    prompt = fake_provider.whole_prompt
    assert "The marketing site and waitlist for Korvix." in prompt
    assert "[Project Context — Korvix Web]" in prompt
    assert search_spy == []
    for marker in _UNRELATED_MARKERS:
        assert marker not in prompt


# ══════════════════════════════════════════════════════════════════════════
# C — the whole suggestion set, asked in sequence in ONE reused conversation
# ══════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("suggestions", [SUGGESTED_TR, SUGGESTED_EN],
                         ids=["tr", "en"])
def test_C_every_suggested_question_in_a_reused_conversation_stays_on_project(
        client, env, fake_provider, search_spy, context_calls, suggestions):
    """A person clicks several suggestions over one visit. The inline surface
    reuses ONE project conversation, so every request after the first replays
    the earlier turns — which is exactly how one contaminated answer used to
    become a contaminated thread.

    Asserted per request: the context was built for this project and this owner,
    this project's evidence is present, the other project never appears, and no
    generic search ran on any of them."""
    mine = _project_with_deployments(env)
    theirs = env.projects.create_project(
        "other-uid", name="Rival Ltd",
        description="a competitor's private roadmap", project_id="p-rival")
    _vercel(env, user="other-uid", project=theirs.id,
            kind="vercel.deployment.error",
            summary="Production deployment FAILED for rival-app", hours_ago=1)

    history: list[dict] = []
    for question in suggestions:
        assert _ask(client, project_id=mine.id, question=question,
                    history=history).status_code == 200
        prompt = fake_provider.whole_prompt
        assert "[Project Context — Korvix Web]" in prompt, question
        assert "Production deployment SUCCEEDED for korvix-web (main)" in prompt, question
        assert "Rival Ltd" not in prompt, question
        assert "rival-app" not in prompt, question
        for marker in _UNRELATED_MARKERS:
            assert marker not in prompt, question
        # The reused conversation grows exactly as the page grows it.
        history = history + [{"role": "user", "content": question},
                             {"role": "assistant", "content": "ok"}]

    assert len(fake_provider.requests) == len(suggestions)
    # Every single request resolved the SAME project, for the SAME owner.
    assert context_calls == [(mine.id, "owner-uid")] * len(suggestions)
    assert search_spy == []


def test_C2_a_contaminated_history_does_not_make_the_next_answer_contaminated(
        client, env, fake_provider, search_spy):
    """The durable half of the production failure: once one answer was generic,
    it was persisted as a real assistant turn and replayed as history on every
    follow-up, so unrelated questions kept producing unrelated answers.

    History is the user's conversation and is replayed as-is — what must be true
    is that the AUTHORITY in front of the model is still this project's
    evidence, stated as such, and that nothing re-fetches the generic topic."""
    proj = _project_with_deployments(env)
    poisoned = [
        {"role": "user", "content": "Bu projede son zamanlarda ne değişti?"},
        {"role": "assistant",
         "content": "İklim değişikliği son on yılda hızlandı ve TÜBİTAK 1001 "
                    "programı başvuruları açıldı."},
    ]

    r = _ask(client, project_id=proj.id, history=poisoned,
             question="Bu projenin mevcut durumu ne ve kanıtlar gerçekte ne gösteriyor?")
    assert r.status_code == 200

    system = fake_provider.system
    assert "PROJECT EVIDENCE AUTHORITY" in system
    assert "Production deployment SUCCEEDED for korvix-web (main)" in system
    # Nothing fetched more of the same.
    assert search_spy == []
    # The stale turn is still the user's conversation — but it is a USER-side
    # turn, never part of the system prompt's authority.
    for marker in _UNRELATED_MARKERS:
        assert marker not in system


# ══════════════════════════════════════════════════════════════════════════
# D — a project the caller does not own
# ══════════════════════════════════════════════════════════════════════════

def test_D_a_foreign_project_id_injects_nothing_and_fails_closed(
        client, env, fake_provider, search_spy):
    """`project_id` is a routing hint; ownership is the boundary. A caller who
    names someone else's project gets no context — not theirs, and not a
    substitute assembled from anywhere else."""
    mine = _project_with_deployments(env)
    theirs = env.projects.create_project(
        "other-uid", name="Theirs", description="the secret plan is Falcon",
        project_id="p-theirs")
    _vercel(env, user="other-uid", project=theirs.id,
            kind="vercel.deployment.succeeded",
            summary="Production deployment SUCCEEDED for falcon-app", hours_ago=1)

    r = _ask(client, project_id=theirs.id,
             question="Bu projede son zamanlarda ne değişti?")
    assert r.status_code == 200

    prompt = fake_provider.whole_prompt
    assert "[Project Context" not in prompt
    assert "PROJECT EVIDENCE AUTHORITY" not in prompt
    assert "Falcon" not in prompt
    assert "falcon-app" not in prompt
    assert "Theirs" not in prompt
    # …and nothing of the caller's own project leaked in as a consolation prize.
    assert "Korvix Web" not in prompt
    assert mine.id not in prompt


def test_D2_an_unknown_project_id_injects_nothing(client, env, fake_provider):
    _project_with_deployments(env)
    r = _ask(client, project_id="does-not-exist",
             question="Bu projede son zamanlarda ne değişti?")
    assert r.status_code == 200
    assert "[Project Context" not in fake_provider.whole_prompt


# ══════════════════════════════════════════════════════════════════════════
# E — a project with nothing in it
# ══════════════════════════════════════════════════════════════════════════

def test_E_an_empty_project_gets_an_honest_instruction_not_an_invented_topic(
        client, env, fake_provider, search_spy):
    """"I don't have enough about this project yet" is a correct answer. What is
    never correct is inventing a subject for the project — which is what a
    generic search result invited. So: no search, and an explicit instruction
    not to invent one."""
    proj = _empty_project(env)

    r = _ask(client, project_id=proj.id,
             question="Bu projenin şu anda ne hakkında olduğunu özetle.")
    assert r.status_code == 200

    prompt = fake_provider.whole_prompt
    assert search_spy == [], "an empty project is not a reason to search the web"
    for marker in _UNRELATED_MARKERS:
        assert marker not in prompt
    if "PROJECT EVIDENCE AUTHORITY" in prompt:
        # When there IS a block, the honesty rule travels with it.
        assert "does not have that information yet" in prompt
        assert "Do NOT invent a subject" in prompt


# ══════════════════════════════════════════════════════════════════════════
# F — when external research IS what the user asked for
# ══════════════════════════════════════════════════════════════════════════

def test_F_an_explicit_search_on_a_project_turn_is_supplemental_not_authoritative(
        client, env, fake_provider, search_spy):
    """The rule is precedence, not prohibition. A user who says "internetten
    araştır" gets a search — and the results arrive framed as secondary, behind
    the project's own evidence, and NOT stapled to their own message."""
    proj = _project_with_deployments(env)

    r = _ask(client, project_id=proj.id,
             question="Bu projenin rakiplerini internetten araştır")
    assert r.status_code == 200
    assert len(search_spy) == 1, "an explicit request to search must still search"

    system = fake_provider.system
    # Both are present…
    assert "[Project Context — Korvix Web]" in system
    assert "TÜBİTAK" in system
    # …in this order, with the project's authority stated first and the last
    # word in the prompt reserved for it.
    assert system.index("PROJECT EVIDENCE AUTHORITY") < system.index("TÜBİTAK")
    assert "SUPPLEMENTAL EXTERNAL SEARCH RESULTS" in system
    assert system.index("SUPPLEMENTAL EXTERNAL SEARCH RESULTS") < system.index("TÜBİTAK")
    assert "PRECEDENCE REMINDER" in system
    assert system.index("TÜBİTAK") < system.index("PRECEDENCE REMINDER")
    # The capability note no longer tells the model a results block outranks
    # the user's own project.
    assert "PROJECT SCOPE (overrides the paragraph above for this turn)" in system

    # And the user's own turn is still the user's own words.
    assert "TÜBİTAK" not in fake_provider.last_user
    assert "treat as authoritative" not in fake_provider.last_user


def test_F2_a_finance_question_inside_a_project_still_gets_live_data(
        client, env, fake_provider, search_spy):
    """Mandatory-live-data questions are not heuristics and are not suppressed:
    a current price must never be answered from model memory, project or no
    project."""
    proj = _project_with_deployments(env)
    r = _ask(client, project_id=proj.id, question="NVDA hissesi kaç dolar?")
    assert r.status_code == 200
    assert len(search_spy) == 1
    assert "SUPPLEMENTAL EXTERNAL SEARCH RESULTS" in fake_provider.system


# ══════════════════════════════════════════════════════════════════════════
# G — everything OUTSIDE a project is untouched
# ══════════════════════════════════════════════════════════════════════════

def test_G_without_a_project_the_web_search_path_is_exactly_as_before(
        client, env, fake_provider, search_spy):
    """The fix is gated on having project evidence. A plain chat still searches
    on a scored intent and still gets the dual injection that stops the model
    refusing — nothing here regressed for normal chat, Web Build or App Build."""
    _project_with_deployments(env)

    r = _ask(client, project_id=None,
             question="son zamanlarda yapay zeka araçlarında ne değişti?")
    assert r.status_code == 200
    assert len(search_spy) == 1

    system = fake_provider.system
    assert "TÜBİTAK" in system
    assert "SUPPLEMENTAL EXTERNAL SEARCH RESULTS" not in system
    assert "PROJECT EVIDENCE AUTHORITY" not in system
    # The user-turn injection — the thing that keeps the model from refusing —
    # is still there when there is no project evidence to outrank.
    assert "TÜBİTAK" in fake_provider.last_user


# ══════════════════════════════════════════════════════════════════════════
# H — the classifier itself
# ══════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("question", SUGGESTED_TR + SUGGESTED_EN)
def test_H_every_suggested_question_is_recognised_as_about_this_project(question):
    from backend.services.tool_extraction import is_project_self_referential
    assert is_project_self_referential(question), question


@pytest.mark.parametrize("question", [
    "TÜBİTAK proje başvurusu nasıl yapılır?",     # an EXTERNAL project
    "en iyi proje yönetimi araçları neler?",       # a general research question
    "son NVIDIA haberleri neler?",
    "what are the latest AI tools?",
])
def test_H2_an_external_question_is_not_treated_as_self_referential(question):
    from backend.services.tool_extraction import is_project_self_referential
    assert not is_project_self_referential(question), question


@pytest.mark.parametrize("question,kind", [
    ("Bu projede son zamanlarda ne değişti?", "scored"),
    ("internetten araştır: en iyi CRM", "explicit"),
    ("NVDA kaç dolar", "finance"),
    ("İstanbul'da hava nasıl", "weather"),
])
def test_H3_the_intent_reports_WHY_it_fired(question, kind):
    """The suppression rule is only as honest as this classification: a
    deliberate external request and a keyword score must be distinguishable
    without parsing a log string."""
    from backend.services.tool_extraction import detect_web_search_intent
    intent = detect_web_search_intent(question)
    assert intent.triggered
    assert intent.kind == kind
