# coding: utf-8
"""Owner-vs-normal PARITY tests for the task-scoped frontend system prompt.

Bug: `WEB_BUILD_FRONTEND_SYSTEM_PROMPT_MODE=owner_scoped` gave a VERIFIED OWNER session the
minimal task-scoped system prompt (better generation adherence) while every non-owner build
still shipped the full five-task legacy prompt. The `all_scoped` value grants the SAME
task-scoped subset to EVERY build request, so a normal beta/paid build gets the identical prompt
the owner gets. Entitlement/quota are enforced upstream (ai_guard preflight); this only shapes
the prompt text and never changes model/token/effort/provider-call count.

These tests pin:
  * all_scoped: owner_session=True and owner_session=False produce the IDENTICAL scoped prompt.
  * owner_scoped stays owner-only (non-owner → complete legacy prompt).
  * disabled / unknown → complete legacy prompt for everyone (fail-closed default).
  * the integrity floor / legacy fallback is preserved (structurally broken legacy → legacy).
"""
from __future__ import annotations

import os
import contextlib

from backend.services.ai.frontend_task_prompt import (
    resolve_frontend_system_prompt_mode,
    select_frontend_system_prompt,
    _MODE_ENV,
    _COMMON_SENTINEL,
)


@contextlib.contextmanager
def _mode(value):
    """Temporarily set WEB_BUILD_FRONTEND_SYSTEM_PROMPT_MODE."""
    prev = os.environ.get(_MODE_ENV)
    if value is None:
        os.environ.pop(_MODE_ENV, None)
    else:
        os.environ[_MODE_ENV] = value
    try:
        yield
    finally:
        if prev is None:
            os.environ.pop(_MODE_ENV, None)
        else:
            os.environ[_MODE_ENV] = prev


# A minimal but structurally valid legacy prompt: the shared boundary (carrying the sentinel) plus
# the six ordered markers, each with enough body to clear the integrity floor.
def _legacy_prompt():
    pad = "x" * 200
    return (
        f"IDENTITY AND ROUTING. {_COMMON_SENTINEL}. {pad}\n"
        "======== TASK A - INITIAL BUILD ========\n" + pad + "\n"
        "======== MECHANICAL CONTRACT CHECKLIST (TASK A, TASK C, TASK D) ========\n" + pad + "\n"
        "======== TASK B - STATIC DESIGN-QUALITY REVIEW ========\n" + pad + "\n"
        "======== TASK C - BOUNDED REPAIR ========\n" + pad + "\n"
        "======== TASK D - STRUCTURAL CONTRACT REPAIR ========\n" + pad + "\n"
        "======== TASK E - EXISTING PROJECT REVISION ========\n" + pad + "\n"
    )


def test_resolve_mode_recognizes_all_scoped_and_owner_scoped():
    with _mode("all_scoped"):
        assert resolve_frontend_system_prompt_mode() == "all_scoped"
    with _mode("  ALL_SCOPED  "):
        assert resolve_frontend_system_prompt_mode() == "all_scoped"
    with _mode("owner_scoped"):
        assert resolve_frontend_system_prompt_mode() == "owner_scoped"
    with _mode("nonsense"):
        assert resolve_frontend_system_prompt_mode() == "disabled"
    with _mode(None):
        assert resolve_frontend_system_prompt_mode() == "disabled"


def test_all_scoped_owner_and_normal_get_identical_scoped_prompt():
    """The core parity guarantee: same task, same legacy prompt → byte-identical scoped output
    regardless of owner_session, and strictly smaller than legacy (i.e. the scoping happened)."""
    legacy = _legacy_prompt()
    with _mode("all_scoped"):
        owner_prompt, owner_diag = select_frontend_system_prompt(
            task_kind="initial-generation", legacy_prompt=legacy, owner_session=True
        )
        normal_prompt, normal_diag = select_frontend_system_prompt(
            task_kind="initial-generation", legacy_prompt=legacy, owner_session=False
        )
    assert owner_prompt == normal_prompt, "owner and normal must receive the identical prompt"
    assert owner_prompt != legacy and len(owner_prompt) < len(legacy), "scoping must have occurred"
    assert _COMMON_SENTINEL in normal_prompt, "shared untrusted-input boundary must be preserved"
    assert owner_diag["system_prompt_mode"] == "all_scoped"
    assert normal_diag["system_prompt_mode"] == "all_scoped"


def test_owner_scoped_stays_owner_only():
    """Legacy owner-only mode: owner gets the scoped subset, a normal build gets full legacy."""
    legacy = _legacy_prompt()
    with _mode("owner_scoped"):
        owner_prompt, owner_diag = select_frontend_system_prompt(
            task_kind="initial-generation", legacy_prompt=legacy, owner_session=True
        )
        normal_prompt, normal_diag = select_frontend_system_prompt(
            task_kind="initial-generation", legacy_prompt=legacy, owner_session=False
        )
    assert owner_prompt != legacy and len(owner_prompt) < len(legacy)
    assert owner_diag["system_prompt_mode"] == "owner_scoped"
    # Non-owner under owner_scoped: unchanged complete legacy prompt (the pre-fix behavior).
    assert normal_prompt == legacy
    assert normal_diag["system_prompt_mode"] == "legacy"


def test_disabled_and_unknown_return_legacy_for_everyone():
    legacy = _legacy_prompt()
    for value in ("disabled", "nonsense", None):
        with _mode(value):
            for owner in (True, False):
                prompt, diag = select_frontend_system_prompt(
                    task_kind="initial-generation", legacy_prompt=legacy, owner_session=owner
                )
                assert prompt == legacy
                assert diag["system_prompt_mode"] == "legacy"


def test_all_scoped_preserves_integrity_floor_and_legacy_fallback():
    """A structurally broken legacy prompt (missing markers) must fall back to the complete legacy
    prompt even under all_scoped — the parity fix never weakens the integrity floor."""
    broken = f"only the boundary {_COMMON_SENTINEL} and no task markers at all"
    with _mode("all_scoped"):
        prompt, diag = select_frontend_system_prompt(
            task_kind="initial-generation", legacy_prompt=broken, owner_session=False
        )
    assert prompt == broken
    assert diag["system_prompt_mode"] == "legacy"


def test_all_scoped_unknown_task_kind_falls_back_to_legacy():
    legacy = _legacy_prompt()
    with _mode("all_scoped"):
        prompt, diag = select_frontend_system_prompt(
            task_kind="not-a-real-kind", legacy_prompt=legacy, owner_session=False
        )
    assert prompt == legacy
    assert diag["system_prompt_mode"] == "legacy"


def test_all_scoped_parity_across_all_mapped_task_kinds():
    """Every task kind that maps to a scoped selection must be owner-agnostic under all_scoped."""
    legacy = _legacy_prompt()
    kinds = ["initial-generation", "initial-review", "final-review", "quality-repair", "contract-repair", "revision"]
    with _mode("all_scoped"):
        for kind in kinds:
            owner_prompt, _ = select_frontend_system_prompt(kind, legacy, owner_session=True)
            normal_prompt, _ = select_frontend_system_prompt(kind, legacy, owner_session=False)
            assert owner_prompt == normal_prompt, f"parity broken for task kind {kind}"
            assert len(owner_prompt) < len(legacy), f"scoping did not occur for {kind}"
