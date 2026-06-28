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
    _current_date_directive,
    build_system_prompt,
)


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
