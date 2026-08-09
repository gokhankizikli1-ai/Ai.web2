# coding: utf-8
"""Regression: a Web Build design-REVIEW request classifies to the review task kinds and stays a
synchronous review — the same canonical `frontend_builder` mode as generation, never a different
mode. Guards against a routing change that would send the review down a different (mode-mismatched)
handler than generation.

`_frontend_task_kind` is the single server-side classifier that drives transport (sync vs
background), token budget, and cost-stage attribution for a frontend_builder request. It must map:
  * the initial review envelope  → 'initial-review'   (synchronous)
  * the post-repair review        → 'final-review'     (synchronous)
  * a plain build envelope        → 'initial-generation' (background)
and reviews must NOT be background tasks. None of this depends on owner/all_scoped — the classifier
reads only the task markers in the message.
"""
from __future__ import annotations

import pytest

# `ai_client` imports the provider SDKs (openai / google-generativeai / duckduckgo_search / …) at
# module load. In CI those are installed; in a minimal sandbox they may not be, so skip cleanly
# rather than fail collection (the classifier itself is a pure function).
ai_client = pytest.importorskip("ai_client")
_frontend_task_kind = ai_client._frontend_task_kind
_frontend_task_is_background = ai_client._frontend_task_is_background


_BUILDER = "[FRONTEND BUILDER REQUEST]"
_REVIEW = "[FRONTEND REVIEW REQUEST]"


def _initial_review_msg() -> str:
    return (
        f"{_BUILDER}\n{_REVIEW}\n"
        "Task: static design-quality review of an ALREADY-VALIDATED model-native project (stage: initial).\n"
        "BEGIN_FRONTEND_BUILD_SPEC_JSON\n{}\nEND_FRONTEND_BUILD_SPEC_JSON\n"
    )


def _final_review_msg() -> str:
    return (
        f"{_BUILDER}\n{_REVIEW}\n"
        "Task: static design-quality review of an ALREADY-VALIDATED model-native project (stage: post-repair).\n"
        "BEGIN_FRONTEND_BUILD_SPEC_JSON\n{}\nEND_FRONTEND_BUILD_SPEC_JSON\n"
    )


def _generation_msg() -> str:
    return f"{_BUILDER}\nBEGIN_FRONTEND_BUILD_SPEC_JSON\n{{}}\nEND_FRONTEND_BUILD_SPEC_JSON\n"


def test_initial_review_classifies_to_initial_review():
    assert _frontend_task_kind(_initial_review_msg()) == "initial-review"


def test_final_review_classifies_to_final_review():
    assert _frontend_task_kind(_final_review_msg()) == "final-review"


def test_generation_classifies_to_initial_generation():
    assert _frontend_task_kind(_generation_msg()) == "initial-generation"


def test_reviews_are_synchronous_not_background():
    # Reviews stay synchronous (they must not be promoted to the background full-source transport,
    # which is what carries the different budget/lifecycle). Generation IS background.
    assert _frontend_task_is_background("initial-review") is False
    assert _frontend_task_is_background("final-review") is False
    assert _frontend_task_is_background("initial-generation") is True


def test_non_builder_message_is_unknown_not_review():
    assert _frontend_task_kind("just a normal chat message") == "unknown"


def test_repair_and_revision_are_not_reviews():
    assert _frontend_task_kind(f"{_BUILDER}\n[FRONTEND REPAIR REQUEST]\n") == "quality-repair"
    assert _frontend_task_kind(f"{_BUILDER}\n[FRONTEND REVISION REQUEST]\n") == "revision"
