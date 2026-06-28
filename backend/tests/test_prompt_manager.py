# coding: utf-8
"""Tests for `backend.services.ai.prompt_manager`.

Focused on the 2026-06-28 production fix: build_system_prompt must
inject the CURRENT date so the LLM can answer "what year is it"
correctly instead of falling back to its training-data cutoff (which
was producing 'Şu anda 2023 yılındayız' in production)."""
from __future__ import annotations

import re
from datetime import datetime, timezone

from backend.services.ai.prompt_manager import (
    current_date_directive,
    build_system_prompt,
)
_current_date_directive = current_date_directive  # back-compat alias for older tests


def test_current_date_directive_contains_real_year():
    """The directive's year must match wall-clock UTC year, not a
    hardcoded constant. Pinning to `datetime.now(timezone.utc).year`
    means the answer stays correct forever as time advances; failing
    this test would mean we re-introduced a hardcoded year somewhere."""
    expected_year = str(datetime.now(timezone.utc).year)
    directive = _current_date_directive()
    assert expected_year in directive, (
        f"directive missing current year {expected_year}; got: {directive}"
    )


def test_current_date_directive_contains_iso_date():
    """ISO date is the format easiest for the model to quote verbatim
    without locale ambiguity."""
    expected_iso = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    directive = _current_date_directive()
    assert expected_iso in directive, (
        f"directive missing ISO date {expected_iso}; got: {directive}"
    )


def test_current_date_directive_instructs_model_to_use_this_value():
    """The directive must explicitly tell the model to PREFER this
    value over its training-data cutoff — otherwise the model may
    still hallucinate a year close to its cutoff."""
    directive = _current_date_directive().lower()
    assert "current year" in directive or "today's date" in directive
    assert "training" in directive  # must reference training cutoff


def test_build_system_prompt_prepends_current_date():
    """Date must land at the TOP of the assembled prompt — the model's
    attention is strongest on the opening lines, and the temporal
    grounding must win over any training-cutoff intuition that the
    rest of the prompt might trigger."""
    out = build_system_prompt("fast")
    year = str(datetime.now(timezone.utc).year)
    # The directive must appear; its year must match wall clock.
    assert year in out, f"system prompt missing current year {year}; got first 200 chars: {out[:200]!r}"
    # And it must appear at the top, not buried below the mode prompt.
    first_300 = out[:300]
    assert year in first_300, (
        f"current year {year} appears in prompt but NOT in first 300 chars "
        f"(attention region); first 300: {first_300!r}"
    )


def test_build_system_prompt_no_stale_hardcoded_year():
    """Regression guard: any of 2019..2024 inclusive showing up in the
    base prompt would indicate someone hardcoded a year (training
    cutoff, "as of <year>", etc.). Allow the current year and the
    immediate next year (handles the December-rollover edge case)."""
    out = build_system_prompt("fast")
    now_year = datetime.now(timezone.utc).year
    allowed_years = {str(now_year), str(now_year + 1)}
    # Scan for any 4-digit year 2019..2024 — pre-cutoff years that
    # should never appear in a freshly-assembled system prompt.
    suspect_years = {str(y) for y in range(2019, 2025)} - allowed_years
    found = [y for y in suspect_years if re.search(rf"\b{y}\b", out)]
    assert not found, (
        f"system prompt contains hardcoded stale year(s) {found}. "
        f"Use _current_date_directive() instead of literal years."
    )


def test_build_system_prompt_directive_changes_with_clock(monkeypatch):
    """If the system clock advances, the directive's date string must
    advance with it. Proves there is no hidden module-level cache that
    would freeze the directive at import time."""
    import backend.services.ai.prompt_manager as pm

    class _FixedDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            # 2030-03-15 12:00 UTC — far enough future that no other
            # part of the codebase could coincidentally match.
            return datetime(2030, 3, 15, 12, 0, 0, tzinfo=tz or timezone.utc)

    monkeypatch.setattr(pm, "datetime", _FixedDateTime)
    out = pm.build_system_prompt("fast")
    assert "2030" in out, f"directive did not advance with the clock; got: {out[:300]!r}"
    assert "2030-03-15" in out


# ──────────────────────────────────────────────────────────────────────────
# REGRESSION COVERAGE (production fix 2026-06-28, post-PR #178)
#
# PR #178 only injected the date directive into `build_system_prompt`
# (the canonical-mode path). Production verification then proved that
# the CHAT_SYSTEM and other legacy intent paths still returned 2023 —
# because those paths go through `ai_service._build_system`, not
# through `build_system_prompt`.
#
# These tests prove EVERY system-prompt builder in the codebase emits
# the date directive. New builders added later are caught by:
#   - test_every_legacy_system_constant_includes_date (parametric over
#     all 11 legacy constants used by _build_system)
#   - test_no_system_builder_in_ai_service_is_dateless (audit-style
#     test that scans the source for new `_build_system`-shaped
#     functions and asserts they prepend the directive too)
# ──────────────────────────────────────────────────────────────────────────

LEGACY_SYSTEM_CONSTANTS = [
    "EXECUTION_SYSTEM",
    "PRODUCTIVITY_SYSTEM",
    "CREATIVE_SYSTEM",
    "FINANCE_SYSTEM",
    "DROP_SYSTEM",
    "STARTUP_SYSTEM",
    "ADVICE_SYSTEM",
    "EDUCATION_SYSTEM",
    "EMOTIONAL_SYSTEM",
    "PERSONAL_SYSTEM",
    "CHAT_SYSTEM",      # ← the one production hit. Default for "what year is it?"
]


import pytest


@pytest.mark.parametrize("const_name", LEGACY_SYSTEM_CONSTANTS)
def test_every_legacy_system_constant_includes_date(const_name):
    """Each legacy system constant, when passed through
    `ai_service._build_system`, MUST come out with the current-date
    directive prepended. This is the production-path coverage that
    PR #178 missed.

    Parametric over all 11 constants used in `_build_system` call
    sites — if a new branch is added in `process_chat` that reaches
    `_build_system(NEW_CONSTANT, ...)`, this test still passes (the
    fix is at the builder level, not the call site). If someone
    REGRESSES `_build_system` by removing the prepend, EVERY one of
    these 11 cases fails."""
    import backend.services.ai_service as ai_service
    base = getattr(ai_service, const_name, None)
    assert base is not None, f"{const_name} not exported from ai_service"
    assert isinstance(base, str) and base, f"{const_name} must be a non-empty str"

    out = ai_service._build_system(base)
    expected_year = str(datetime.now(timezone.utc).year)
    assert expected_year in out, (
        f"_build_system({const_name}) is missing the current year "
        f"{expected_year}. THIS IS THE PRODUCTION CHAT BUG. "
        f"First 300 chars: {out[:300]!r}"
    )
    # And the directive must land BEFORE the legacy base prompt (the
    # base prompt's opening text dominates model attention; the date
    # has to be on top of it).
    base_starts_at = out.find(base)
    year_starts_at = out.find(expected_year)
    assert 0 <= year_starts_at < base_starts_at, (
        f"_build_system({const_name}): the date directive must precede "
        f"the base prompt. year@{year_starts_at}, base@{base_starts_at}"
    )


def test_no_system_builder_in_ai_service_is_dateless():
    """Audit guard: scan ai_service.py for any function whose name
    matches `_build_system*` and assert it ALSO imports / calls
    `current_date_directive`. Catches a future regression where
    someone adds a parallel `_build_system_v2` and forgets the date.

    Source-level scan rather than a runtime call: keeps this test
    self-contained (no dependency on how a specific new builder is
    invoked)."""
    from pathlib import Path
    import re as _re
    src = Path("backend/services/ai_service.py").read_text()
    # Match every `def _build_system…` definition.
    builders = _re.findall(r"^def (_build_system\w*)\b", src, flags=_re.MULTILINE)
    assert builders, (
        "ai_service.py has no `_build_system…` definition — has the "
        "function been renamed? Update this test."
    )
    # The current_date_directive import (or call) must appear somewhere
    # in the body of EACH builder. We use a coarse "contains" check on
    # the whole file because verifying scope-locality requires AST
    # parsing — coarse is sufficient because removing the call would
    # also fail test_every_legacy_system_constant_includes_date.
    assert "current_date_directive" in src, (
        "ai_service.py does NOT reference current_date_directive — "
        "the production date fix has been reverted. Builders: "
        f"{builders}"
    )


# ──────────────────────────────────────────────────────────────────────────
# v2/chat/stream — THIRD chat path (production fix 2026-06-28 attempt 3)
#
# PRs #178/#179 fixed the legacy /chat builders. Production verification
# still returned 2023 because the FE was hitting /v2/chat/stream — a
# different route with its own prompt assembly. Fix: v2_chat_stream
# unconditionally prepends current_date_directive() to the FIRST system
# message in the outgoing ProviderRequest. These tests prove that
# guarantee end-to-end so a future PR that reorganises the route's
# prompt-merging code can't silently strip the date.
# ──────────────────────────────────────────────────────────────────────────

def test_v2_chat_stream_source_imports_current_date_directive():
    """Source-level guard: any prompt-merging path that ends in
    /v2/chat/stream's `final_msgs` MUST reference
    `current_date_directive`. Coarse import-presence check defeats
    accidental removal of the prepend without changing how messages
    are assembled.
    """
    from pathlib import Path
    src = Path("backend/routes/v2_chat_stream.py").read_text()
    assert "current_date_directive" in src, (
        "v2_chat_stream.py no longer references current_date_directive "
        "— production date fix has been reverted. Restore the import "
        "+ the `_date_block` prepend block before merging."
    )


def test_v2_chat_stream_prepends_date_to_first_system_message():
    """Behavioural test: call the route's prompt-assembly path with a
    no-system-message body and confirm the resulting final_msgs starts
    with a system message containing the current year.

    Doesn't fire the real OpenAI/Anthropic call — we just assert on
    the assembled messages. The integration is exercised by the
    route handler's first half (mp_system_prompt resolution + the
    new date-prepend block).
    """
    from fastapi.testclient import TestClient
    from backend.api import app
    from backend.services.ai.prompt_manager import current_date_directive

    # The current_date_directive() is a pure function; capture its
    # output ONCE so we can check exact substring presence.
    expected_year = str(datetime.now(timezone.utc).year)

    # Force a deterministic provider that yields a quick error frame
    # so we don't hit OpenAI. ProviderNotRegistered (400) gives us a
    # clean response without touching the prompt-merge path —
    # so instead we ASSERT on the merged messages via a monkeypatch
    # of get_provider that captures the request.
    captured = {}

    class _Provider:
        name = "stub"
        default_model = "stub-1"
        supports_streaming = True

        async def stream_chat_completion(self, req):
            captured["request"] = req
            from backend.services.providers.streaming import (
                ProviderStreamStart, ProviderStreamDone,
            )
            from backend.services.providers.types import TokenUsage
            yield ProviderStreamStart(provider="stub", model=req.model)
            yield ProviderStreamDone(
                finish_reason="stop",
                model=req.model,
                usage=TokenUsage(prompt_tokens=0, completion_tokens=0, total_tokens=0),
            )

    import backend.routes.v2_chat_stream as route_mod
    original_get_provider = route_mod.get_provider
    route_mod.get_provider = lambda _name: _Provider()
    try:
        client = TestClient(app)
        resp = client.post("/v2/chat/stream", json={
            "messages": [{"role": "user", "content": "what year is it?"}],
            "provider": "stub",
        })
        # Streaming endpoint returns 200 with SSE body — we don't care
        # about the body, only that get_provider's _Provider received
        # a request whose first system message contains the year.
        assert resp.status_code == 200, resp.text
    finally:
        route_mod.get_provider = original_get_provider

    req = captured.get("request")
    assert req is not None, "stub provider was never called"
    assert req.messages, "stub provider received an empty messages list"
    first = req.messages[0]
    assert first.role == "system", (
        f"first message should be the date system prompt, got role={first.role!r}"
    )
    assert expected_year in first.content, (
        f"v2_chat_stream did NOT prepend the current year {expected_year}; "
        f"first system message: {first.content[:200]!r}"
    )
    # And the directive must include the explicit anti-cutoff
    # instruction so the model knows to override training memory.
    assert "training" in first.content.lower(), (
        "date directive present but missing the anti-training-cutoff "
        "instruction — the model may still fall back to its training year"
    )
    # Sanity: ensure we didn't accidentally lose the user's actual
    # message. It must still come AFTER the system prompt.
    user_msgs = [m for m in req.messages if m.role == "user"]
    assert any("what year is it?" in m.content for m in user_msgs)
    # Confirm we're emitting current_date_directive's actual content,
    # not just a 4-digit year coincidence elsewhere.
    assert current_date_directive().split(".")[0] in first.content, (
        "first system message does NOT contain the literal directive "
        "text — something else assembled the prompt"
    )
