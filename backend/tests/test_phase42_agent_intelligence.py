# coding: utf-8
"""Phase 4.2 — agent intelligence upgrade tests.

Locks in the four intelligence levers Phase 4.2 added:

  1. Model routing (MODEL_ORCHESTRATOR / MODEL_SPECIALIST / MODEL_FAST /
     MODEL_REASONING env vars + tier-based resolver + logging)
  2. Quality guard (anti-generic response validator + one-shot retry)
  3. Project context expansion (recent_messages in OrchestrateBody)
  4. Telemetry events (agent.context_lookup / agent.draft_generated /
     agent.quality_check / agent.regenerated)

Plus a regression battery confirming normal /chat is unchanged.
"""
import asyncio
import importlib
import os
import sys
import tempfile

import pytest


# ══════════════════════════════════════════════════════════════════════
# Model routing

def test_routing_default_models_are_phase42_defaults():
    """Phase 4.2 promoted specialists from gpt-4o-mini → gpt-4o.
    Pin those defaults so a regression doesn't silently downgrade
    quality."""
    from backend.services.agent.model_routing import DEFAULTS
    assert DEFAULTS["orchestrator"] == "gpt-4o"
    assert DEFAULTS["specialist"]   == "gpt-4o"
    assert DEFAULTS["fast"]         == "gpt-4o-mini"
    assert DEFAULTS["reasoning"]    == "gpt-4o"


def test_routing_uses_env_var_when_set(monkeypatch):
    monkeypatch.setenv("MODEL_SPECIALIST", "claude-3-sonnet")
    from backend.services.agent.model_routing import resolve_model_for_spec
    from backend.services.agent.specs import get_spec
    assert resolve_model_for_spec(get_spec("coder")) == "claude-3-sonnet"
    assert resolve_model_for_spec(get_spec("ux_designer")) == "claude-3-sonnet"


def test_routing_supervisor_uses_orchestrator_tier(monkeypatch):
    monkeypatch.setenv("MODEL_ORCHESTRATOR", "gpt-5-orchestrator")
    monkeypatch.setenv("MODEL_SPECIALIST",   "gpt-4o-mini")
    from backend.services.agent.model_routing import resolve_model_for_spec
    from backend.services.agent.specs import get_spec
    assert resolve_model_for_spec(get_spec("supervisor")) == "gpt-5-orchestrator"
    # Specialist not affected by orchestrator env
    assert resolve_model_for_spec(get_spec("coder")) == "gpt-4o-mini"


def test_routing_research_strategist_use_reasoning_tier(monkeypatch):
    monkeypatch.setenv("MODEL_REASONING",  "o1-preview")
    monkeypatch.setenv("MODEL_SPECIALIST", "gpt-4o-mini")
    from backend.services.agent.model_routing import resolve_model_for_spec
    from backend.services.agent.specs import get_spec
    for sid in ("researcher", "strategist", "product_strategist"):
        assert resolve_model_for_spec(get_spec(sid)) == "o1-preview", \
            f"{sid} should resolve to MODEL_REASONING"
    # Other specialists still on specialist tier
    assert resolve_model_for_spec(get_spec("coder")) == "gpt-4o-mini"


def test_routing_summary_reports_each_tier():
    from backend.services.agent.model_routing import routing_summary
    summary = routing_summary()
    for tier in ("orchestrator", "specialist", "fast", "reasoning"):
        assert tier in summary
        assert "env_var" in summary[tier]
        assert "effective" in summary[tier]
        assert "configured" in summary[tier]


def test_routing_handles_none_spec_with_fast_fallback(monkeypatch):
    monkeypatch.setenv("MODEL_FAST", "gpt-4o-nano")
    from backend.services.agent.model_routing import resolve_model_for_spec
    assert resolve_model_for_spec(None) == "gpt-4o-nano"


def test_routing_log_model_selection_emits_structured_line(caplog):
    import logging
    caplog.set_level(logging.INFO, logger="backend.services.agent.model_routing")
    from backend.services.agent.model_routing import log_model_selection
    from backend.services.agent.specs import get_spec
    log_model_selection(get_spec("ux_designer"), "gpt-4o", run_id="r123")
    msgs = [r.getMessage() for r in caplog.records]
    matching = [m for m in msgs if "agent.model_selected" in m and "ux_designer" in m]
    assert matching, f"expected agent.model_selected log line; got {msgs}"
    assert "tier=specialist" in matching[0]
    assert "model=gpt-4o" in matching[0]


# ══════════════════════════════════════════════════════════════════════
# Quality guard

def test_guard_accepts_well_formed_frontend_reply():
    """A reply that meets every contract requirement passes the guard."""
    from backend.services.agent.quality_guard import check_specialist_output
    from backend.services.agent.specs import get_spec
    output = (
        "## Intent\nBuild a marketing landing page for a SaaS product.\n\n"
        "## Design direction\n- Linear-style density, emerald accents, 8px grid.\n\n"
        "## Component architecture\n"
        "- <LandingShell>\n  - <PrimaryNav>\n  - <Hero>\n  - <Features>\n\n"
        "## File structure\n```\nsrc/pages/Landing.tsx\nsrc/components/Hero.tsx\n```\n\n"
        "## Implementation plan\n"
        "1. Build PrimaryNav with Tailwind sm/md/lg breakpoints, mobile-first.\n"
        "2. Add framer-motion stagger fade-in to Hero on viewport enter.\n"
        "3. Implement Features grid with hover scale 1.02.\n"
        "4. Wire CTA to /signup route with form prefill.\n"
        "5. Add OG image meta tags for social shares.\n\n"
        "## Code skeleton\n```tsx\nimport { motion } from 'framer-motion';\n"
        "export function Hero({ headline }: { headline: string }) {\n"
        "  return <motion.h1 initial={{opacity:0}} animate={{opacity:1}}>{headline}</motion.h1>;\n"
        "}\n```\n\n"
        "## Next actions\n- Wire CTA route\n- Add OG meta\n- Polish hover states\n"
    )
    verdict = check_specialist_output(get_spec("coder"), output)
    # Coder role isn't 'frontend' in the role string — get_spec returns
    # a coder spec whose role is 'engineer'. Use the actual frontend
    # role by passing a spec WITH role='frontend'.
    from backend.services.agent.specs.types import AgentSpec
    fe_spec = AgentSpec(
        id="test-fe", name="x", role="frontend",
        system_prompt="x" * 200, can_delegate=False,
    )
    verdict = check_specialist_output(fe_spec, output)
    assert verdict.ok is True, f"unexpected guard failures: {verdict.reasons}"


def test_guard_rejects_wix_recommendation():
    """The core anti-generic check: recommending Wix is a hard fail."""
    from backend.services.agent.quality_guard import check_specialist_output
    from backend.services.agent.specs.types import AgentSpec
    fe_spec = AgentSpec(id="t", name="x", role="frontend",
                        system_prompt="x"*200, can_delegate=False)
    bad = "For your landing page, you can use Wix or WordPress. " * 5
    verdict = check_specialist_output(fe_spec, bad)
    assert verdict.ok is False
    assert any("wix" in r.lower() for r in verdict.reasons)


def test_guard_rejects_filler_opener():
    from backend.services.agent.quality_guard import check_specialist_output
    from backend.services.agent.specs.types import AgentSpec
    spec = AgentSpec(id="t", name="x", role="ux",
                     system_prompt="x"*200, can_delegate=False)
    bad = (
        "Great question! Let me think about this. " +
        "## Audience\nB2B SaaS buyers.\n\n" +
        "## Information hierarchy\n1. Hero\n2. Features\n3. Pricing\n"
    )
    verdict = check_specialist_output(spec, bad)
    assert verdict.ok is False
    assert any("filler" in r.lower() or "great question" in r.lower()
               for r in verdict.reasons)


def test_guard_rejects_missing_required_sections():
    from backend.services.agent.quality_guard import check_specialist_output
    from backend.services.agent.specs.types import AgentSpec
    spec = AgentSpec(id="t", name="x", role="backend",
                     system_prompt="x"*200, can_delegate=False)
    bad = (
        "Here's the API design.\n"
        "```python\nasync def handler(): ...\n```\n"
        "Use middleware for auth and rate-limiting." * 5  # bulk up the chars
    )
    verdict = check_specialist_output(spec, bad)
    assert verdict.ok is False
    # Missing ## API contract / ## Schema / ## Implementation
    assert any("missing required section" in r.lower() for r in verdict.reasons)


def test_guard_rejects_technical_role_without_code_block():
    from backend.services.agent.quality_guard import check_specialist_output
    from backend.services.agent.specs.types import AgentSpec
    fe_spec = AgentSpec(id="t", name="x", role="frontend",
                        system_prompt="x"*200, can_delegate=False)
    no_code = (
        "## Intent\nBuild a landing page.\n\n"
        "## Component architecture\n- Hero\n- Nav\n- Footer\n\n"
        "## File structure\n- src/pages/Landing.tsx\n\n"
        "## Implementation plan\n1. Build hero. 2. Build nav. 3. Build footer.\n\n"
        "## Code skeleton\nReact component with hero, nav, footer.\n\n"
        "## Design direction\nDark theme.\n## Next actions\n- Ship\n"
    )
    verdict = check_specialist_output(fe_spec, no_code)
    assert verdict.ok is False
    assert any("code block" in r.lower() for r in verdict.reasons)


def test_guard_rejects_too_short_reply():
    from backend.services.agent.quality_guard import check_specialist_output
    from backend.services.agent.specs.types import AgentSpec
    spec = AgentSpec(id="t", name="x", role="frontend",
                     system_prompt="x"*200, can_delegate=False)
    verdict = check_specialist_output(spec, "Use React.")
    assert verdict.ok is False
    assert any("chars" in r for r in verdict.reasons)


def test_guard_counter_example_context_does_not_trigger():
    """Specialists who DOCUMENT what they won't recommend (per the
    Phase 3.6.1 prompts) shouldn't fail the guard for mentioning the
    forbidden word in a counter-example context."""
    from backend.services.agent.quality_guard import check_specialist_output
    from backend.services.agent.specs.types import AgentSpec
    fe_spec = AgentSpec(id="t", name="x", role="frontend",
                        system_prompt="x"*200, can_delegate=False)
    text = (
        "## Intent\nBuild a landing page. I never recommend Wix or "
        "WordPress for this — they don't give us code ownership.\n\n"
        "## Component architecture\n- <LandingShell>\n  - <Hero>\n\n"
        "## File structure\n```\nsrc/pages/Landing.tsx\n```\n\n"
        "## Implementation plan\n1. Build Hero.\n2. Wire CTAs.\n3. Add motion.\n\n"
        "## Code skeleton\n```tsx\nexport function Hero(){return <h1>Ship.</h1>}\n```\n\n"
        "## Next actions\n- Build it\n- Ship it\n"
    )
    verdict = check_specialist_output(fe_spec, text)
    # 'wix' appears but in 'never recommend Wix' context — guard
    # should NOT trigger on the no-code platform check.
    nocode_reasons = [r for r in verdict.reasons if "wix" in r.lower() or "no-code" in r.lower()]
    assert not nocode_reasons, f"counter-example shouldn't trigger guard: {nocode_reasons}"


def test_guard_returns_suggested_fix_on_failure():
    """The retry prompt has to include the specific failure reasons
    so the LLM can target them on round 2."""
    from backend.services.agent.quality_guard import check_specialist_output
    from backend.services.agent.specs.types import AgentSpec
    fe_spec = AgentSpec(id="t", name="x", role="frontend",
                        system_prompt="x"*200, can_delegate=False)
    verdict = check_specialist_output(fe_spec, "Great question! Use Wix.")
    assert verdict.ok is False
    assert verdict.suggested_fix     # non-empty
    assert "previous response failed" in verdict.suggested_fix.lower()
    assert "regenerate" in verdict.suggested_fix.lower()


def test_guard_safe_with_none_spec_or_output():
    from backend.services.agent.quality_guard import check_specialist_output
    assert check_specialist_output(None, "x").ok is True
    from backend.services.agent.specs.types import AgentSpec
    spec = AgentSpec(id="t", name="x", role="frontend",
                     system_prompt="x"*200, can_delegate=False)
    assert check_specialist_output(spec, None).ok is True


# ══════════════════════════════════════════════════════════════════════
# Delegate runs guard + emits new telemetry events

def _make_stub_runner_with_reply(replies_in_order):
    """Stub run_agent that returns the next reply from `replies_in_order`
    on each call. Used to simulate quality-guard-triggered retries."""
    from backend.services.agent.types import AgentResponse
    state = {"i": 0}
    captured = {"calls": []}

    async def _stub(req):
        idx = state["i"]
        state["i"] += 1
        reply = replies_in_order[min(idx, len(replies_in_order) - 1)]
        captured["calls"].append({
            "mode":         req.mode,
            "model":        req.model,
            "user_message": req.user_message,
            "round":        idx,
        })
        return AgentResponse(
            reply=reply, mode=req.mode, model=req.model,
            steps_used=1, tool_calls=0, elapsed_ms=10,
        )
    return _stub, captured


def test_delegate_passes_quality_check_for_good_output(monkeypatch):
    """A specialist that produces well-formed output passes the guard
    and does NOT trigger a retry (single LLM call)."""
    monkeypatch.setenv("ENABLE_REALTIME_EVENTS", "true")
    good_output = (
        "## Intent\nBuild the landing page.\n\n"
        "## Component architecture\n- <Landing>\n  - <Hero>\n\n"
        "## File structure\n```\nsrc/pages/Landing.tsx\n```\n\n"
        "## Implementation plan\n1. Hero with framer-motion stagger.\n"
        "2. CTAs wire to /signup, mobile-first sm/md breakpoints.\n"
        "3. Add OG meta. 4. Wire form. 5. Ship.\n\n"
        "## Code skeleton\n```tsx\nexport const Hero = () => <h1>Ship</h1>;\n```\n\n"
        "## Design direction\nSky accents.\n\n## Next actions\n- Ship\n- Tweak copy\n- Add OG\n"
    )
    stub, captured = _make_stub_runner_with_reply([good_output])

    from backend.services.agent.delegate import spawn_and_delegate

    async def _drive():
        return await spawn_and_delegate(
            role="frontend",
            persona_summary="Senior FE",
            task="Build me a landing page",
            caller_spec_id="supervisor",
            _run_agent_fn=stub,
        )
    res = asyncio.run(_drive())
    assert res["ok"] is True
    # Only one call — no retry triggered
    assert len(captured["calls"]) == 1


def test_delegate_triggers_retry_on_guard_rejection(monkeypatch):
    """When the first draft fails the guard, delegate retries ONCE
    with the suggested_fix appended."""
    monkeypatch.setenv("ENABLE_REALTIME_EVENTS", "true")
    bad_output  = "Great question! Use Wix or WordPress."
    good_output = (
        "## Intent\nBuild it.\n\n## Component architecture\n- <App>\n\n"
        "## File structure\n```\nsrc/App.tsx\n```\n\n"
        "## Implementation plan\n1. Tailwind sm/md/lg setup, mobile-first.\n"
        "2. framer-motion stagger reveal.\n3. CTA wires.\n4. Ship.\n5. Polish.\n\n"
        "## Code skeleton\n```tsx\nexport const App = () => null;\n```\n\n"
        "## Design direction\nClean.\n\n## Next actions\n- Ship now\n- Polish\n- Tweak\n"
    )
    stub, captured = _make_stub_runner_with_reply([bad_output, good_output])

    from backend.services.agent.delegate import spawn_and_delegate

    async def _drive():
        return await spawn_and_delegate(
            role="frontend",
            persona_summary="Senior FE",
            task="Build me a landing page",
            caller_spec_id="supervisor",
            _run_agent_fn=stub,
        )
    res = asyncio.run(_drive())
    assert res["ok"] is True
    # TWO calls — the retry triggered
    assert len(captured["calls"]) == 2
    # The retry call's user_message contains the suggested_fix
    retry_msg = captured["calls"][1]["user_message"]
    assert "previous response failed" in retry_msg.lower()
    # The final reply IS the good output (retry succeeded)
    assert "## Code skeleton" in res["reply"]


def test_delegate_keeps_original_when_retry_also_bad(monkeypatch):
    """If the retry ALSO fails the guard, we keep the first draft
    rather than swap to a shorter/worse retry."""
    monkeypatch.setenv("ENABLE_REALTIME_EVENTS", "true")
    bad1 = "Use Wix to build a landing page quickly with no code. " * 10  # ≥400 chars
    bad2 = "Short."  # much shorter, also fails the guard
    stub, captured = _make_stub_runner_with_reply([bad1, bad2])

    from backend.services.agent.delegate import spawn_and_delegate

    async def _drive():
        return await spawn_and_delegate(
            role="frontend",
            persona_summary="FE",
            task="Build",
            caller_spec_id="supervisor",
            _run_agent_fn=stub,
        )
    res = asyncio.run(_drive())
    assert res["ok"] is True   # delegate succeeds — we always return SOMETHING
    assert len(captured["calls"]) == 2
    # Original (longer) reply preserved (>= 70% of retry-too-short fallback)
    assert "Wix" in res["reply"]


def test_delegate_emits_phase_4_2_telemetry_events(monkeypatch):
    """The new telemetry events (context_lookup / draft_generated /
    quality_check) fire when the bus is enabled."""
    monkeypatch.setenv("ENABLE_REALTIME_EVENTS", "true")
    # Re-bind module references after any prior test's bus reload
    import importlib as _il, sys as _s
    for m in ("backend.services.events.bus", "backend.services.events"):
        if m in _s.modules:
            _il.reload(_s.modules[m])

    good = (
        "## Intent\nx\n\n## Component architecture\n- <App>\n\n"
        "## File structure\n```\nsrc/App.tsx\n```\n\n"
        "## Implementation plan\n1. mobile-first sm/md breakpoints.\n"
        "2. framer-motion stagger reveal.\n3. CTA.\n4. Ship.\n5. Polish.\n\n"
        "## Code skeleton\n```tsx\nexport const App = () => null;\n```\n\n"
        "## Design direction\nclean\n\n## Next actions\n- Ship\n- Polish\n- Iterate\n"
    )
    stub, _ = _make_stub_runner_with_reply([good])

    from backend.services.events import bus
    from backend.services.agent.delegate import spawn_and_delegate
    from backend.services.agent.run_context import start_run

    async def _drive():
        with bus.subscribe("*") as sub:
            with start_run(
                user_id="u-1",
                project_id="p-tele",
                project_context_block="[Project Context — Test]\nstack: next",
            ):
                await spawn_and_delegate(
                    role="frontend",
                    persona_summary="Senior FE",
                    task="Build it",
                    caller_spec_id="supervisor",
                    _run_agent_fn=stub,
                )
            seen = []
            for _ in range(12):
                try:
                    e = await asyncio.wait_for(sub.get(), 0.2)
                    seen.append(e.kind)
                except asyncio.TimeoutError:
                    break
            return seen

    kinds = asyncio.run(_drive())
    # Phase 4.2 new events must appear
    assert "agent.context_lookup"  in kinds
    assert "agent.draft_generated" in kinds
    assert "agent.quality_check"   in kinds


# ══════════════════════════════════════════════════════════════════════
# Project context expansion — recent_messages in OrchestrateBody

@pytest.fixture
def orchestrate_client(monkeypatch):
    """TestClient with /v2/orchestrate + /projects wired against a
    temp projects.db."""
    fd, path = tempfile.mkstemp(suffix="-phase42.db")
    os.close(fd)
    monkeypatch.setenv("PROJECTS_DB_PATH", path)
    monkeypatch.setenv("ENABLE_ORCHESTRATOR", "true")
    monkeypatch.setenv("ENABLE_PROJECTS", "true")
    for m in (
        "backend.services.projects.store",
        "backend.services.projects.context",
        "backend.services.orchestrator.runs_store",
        "backend.routes.projects",
        "backend.routes.v2_orchestrate",
    ):
        if m in sys.modules:
            importlib.reload(sys.modules[m])
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from backend.services.projects import store as pstore
    from backend.services.orchestrator import init_runs_table
    pstore.init()
    init_runs_table()
    from backend.routes import projects as p_route
    from backend.routes import v2_orchestrate as o_route
    app = FastAPI()
    app.include_router(p_route.router)
    app.include_router(o_route.router)
    yield TestClient(app)
    try: os.unlink(path)
    except FileNotFoundError: pass


def test_orchestrate_accepts_recent_messages_field(orchestrate_client, monkeypatch):
    """The OrchestrateBody schema accepts recent_messages without error."""
    from backend.routes import v2_orchestrate
    from backend.services.agent.types import AgentResponse
    captured = {}
    async def _stub(req):
        captured["system_prompt"] = req.system_prompt
        return AgentResponse(reply="ack", mode=req.mode, model=req.model)
    monkeypatch.setattr(v2_orchestrate, "run_agent", _stub)

    r = orchestrate_client.post("/v2/orchestrate", json={
        "user_id": "u-1",
        "message": "Continue from where we left off",
        "recent_messages": [
            {"role": "user",      "content": "Build me a SaaS landing page"},
            {"role": "assistant", "content": "Sure, let me plan that"},
            {"role": "user",      "content": "Focus on the hero first"},
        ],
    })
    assert r.status_code == 200, r.text
    # The recent messages were injected into the supervisor's prompt
    sp = captured["system_prompt"]
    assert "RECENT CONVERSATION" in sp
    assert "Build me a SaaS landing page" in sp
    assert "Focus on the hero first" in sp


def test_orchestrate_caps_recent_messages_at_12(orchestrate_client, monkeypatch):
    """Excess messages are dropped, keeping the latest 12."""
    from backend.routes import v2_orchestrate
    from backend.services.agent.types import AgentResponse
    captured = {}
    async def _stub(req):
        captured["system_prompt"] = req.system_prompt
        return AgentResponse(reply="ack", mode=req.mode, model=req.model)
    monkeypatch.setattr(v2_orchestrate, "run_agent", _stub)

    msgs = [
        {"role": "user" if i % 2 == 0 else "assistant",
         "content": f"message number {i}"}
        for i in range(25)
    ]
    r = orchestrate_client.post("/v2/orchestrate", json={
        "user_id": "u-1", "message": "hi",
        "recent_messages": msgs,
    })
    assert r.status_code == 200
    sp = captured["system_prompt"]
    # Only the last 12 should appear — verify by counting + checking
    # the boundary messages. (substring matching for "message number 1"
    # would falsely match "message number 12"; use exact-with-suffix
    # patterns instead.)
    assert sp.count("message number") == 12
    # Newest 12 = indices 13..24 inclusive
    assert "message number 24" in sp
    assert "message number 13" in sp
    # Older messages (indices 0..12) must be dropped
    assert "message number 0\n" not in sp + "\n"
    assert "message number 12\n" not in sp + "\n"


def test_orchestrate_omitting_recent_messages_keeps_original_prompt(
    orchestrate_client, monkeypatch,
):
    """recent_messages is optional — when absent, the supervisor prompt
    has no RECENT CONVERSATION section."""
    from backend.routes import v2_orchestrate
    from backend.services.agent.types import AgentResponse
    captured = {}
    async def _stub(req):
        captured["system_prompt"] = req.system_prompt
        return AgentResponse(reply="ack", mode=req.mode, model=req.model)
    monkeypatch.setattr(v2_orchestrate, "run_agent", _stub)

    r = orchestrate_client.post("/v2/orchestrate", json={
        "user_id": "u-1", "message": "hi",
    })
    assert r.status_code == 200
    assert "RECENT CONVERSATION" not in captured["system_prompt"]


def test_orchestrate_health_surfaces_model_routing(orchestrate_client):
    r = orchestrate_client.get("/v2/orchestrate/health")
    assert r.status_code == 200
    body = r.json()
    assert "model_routing" in body
    assert "orchestrator" in body["model_routing"]
    assert body["model_routing"]["orchestrator"]["env_var"] == "MODEL_ORCHESTRATOR"


# ══════════════════════════════════════════════════════════════════════
# Normal /chat unchanged

def test_chat_request_without_spec_still_works_unchanged():
    """Phase 4.2 didn't touch the /chat path. AgentRequest.spec=None
    means tools_for_mode (not tools_for_spec), default model from the
    fast tier (gpt-4o-mini), no quality guard wrapping (only delegate
    flows through the guard)."""
    from backend.services.agent.types import AgentRequest
    req = AgentRequest(user_message="hi", mode="fast", user_id="u-1")
    assert getattr(req, "spec", "MISSING") is None
    assert req.system_prompt == ""


def test_event_kinds_extended_in_canonical_order():
    """The Phase 4.2 event kinds must appear in EVENT_KINDS so
    subscribers / docs / tests can rely on them being canonical."""
    from backend.services.events import EVENT_KINDS
    for new_kind in (
        "agent.context_lookup",
        "agent.draft_generated",
        "agent.quality_check",
        "agent.regenerated",
    ):
        assert new_kind in EVENT_KINDS
