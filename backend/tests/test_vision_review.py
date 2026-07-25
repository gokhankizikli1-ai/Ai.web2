# coding: utf-8
"""Tests — /v2/web-build/vision-review (PR #521).

Covers: auth required, flag gating, image validation (mime / size / base64), reuse of the shared
OpenAI provider, vision-model requirement, provider timeout/error fail-open, typed JSON parsing,
malformed-provider-JSON fail-open, rate limiting, and that the screenshot is never echoed back.
"""
from __future__ import annotations

import base64
import json
from types import SimpleNamespace

import pytest

from backend.services.providers import register_provider
from backend.services.providers.base import BaseAIProvider
from backend.services.providers.errors import ProviderTimeoutError
from backend.services.providers.registry import _reset_for_tests
from backend.services.providers.types import ProviderRequest, ProviderResult, ProviderUsage
from backend.core.deps import require_auth
from backend.api import app


# A tiny but VALID base64 image data URL (3 decoded bytes).
_TINY_WEBP = "data:image/webp;base64," + base64.b64encode(b"abc").decode()
_GOOD_REVIEW = {
    "verdict": "needs-repair", "score": 40,
    "issues": [{"code": "generic-template", "area": "composition", "severity": "major",
                "message": "generic SaaS hero", "repairInstruction": "differentiate the hero"}],
    "templateSimilaritySignals": ["purple gradient hero"],
    "proofAssessment": "weak", "hierarchyAssessment": "flat", "compositionAssessment": "ok",
}


class FakeVisionProvider(BaseAIProvider):
    name = "openai"
    default_model = "gpt-4o"
    supports_vision = True
    vision_models = ("gpt-4o", "gpt-4.1", "gpt-4-turbo", "gpt-4-vision")

    def __init__(self, *, content: str | None = None, raises: Exception | None = None):
        self._content = content if content is not None else json.dumps(_GOOD_REVIEW)
        self._raises = raises
        self.called = False
        self.last_request: ProviderRequest | None = None

    def is_available(self) -> bool:
        return True

    async def chat_completion(self, request: ProviderRequest) -> ProviderResult:
        self.called = True
        self.last_request = request
        if self._raises is not None:
            raise self._raises
        return ProviderResult(
            content=self._content, model=self.default_model, provider=self.name,
            usage=ProviderUsage(prompt_tokens=10, completion_tokens=20, total_tokens=30),
        )


@pytest.fixture()
def authed(monkeypatch):
    """Enable the flag + register a fake OpenAI provider + bypass auth. Returns the provider."""
    monkeypatch.setenv("ENABLE_RENDERED_VISION_REVIEW", "true")
    provider = FakeVisionProvider()
    register_provider(provider)
    app.dependency_overrides[require_auth] = lambda: SimpleNamespace(id="user-1", is_guest=False)
    yield provider
    app.dependency_overrides.pop(require_auth, None)
    _reset_for_tests()


def _post(client, **over):
    body = {"runId": "mrun_1", "imageDataUrl": _TINY_WEBP,
            "contractSummary": "First viewport: functional product.", "planSummary": "Product demo.",
            "runtimeFindings": ["no hero visible"]}
    body.update(over)
    return client.post("/v2/web-build/vision-review", json=body)


# ── 14. Authentication required ───────────────────────────────────────────────
def test_requires_authentication(client, monkeypatch):
    monkeypatch.setenv("ENABLE_RENDERED_VISION_REVIEW", "true")
    r = _post(client)
    assert r.status_code != 200            # guest rejected (never a review)


# ── 15. Feature flag off ──────────────────────────────────────────────────────
def test_flag_off_503(client, monkeypatch):
    monkeypatch.setenv("ENABLE_RENDERED_VISION_REVIEW", "false")
    app.dependency_overrides[require_auth] = lambda: SimpleNamespace(id="u", is_guest=False)
    try:
        r = _post(client)
        assert r.status_code == 503
    finally:
        app.dependency_overrides.pop(require_auth, None)


# ── 20/21/24. Happy path: provider reused + vision model + typed JSON parsing ──
def test_happy_path_reuses_provider_and_returns_typed_json(client, authed):
    r = _post(client)
    assert r.status_code == 200
    data = r.json()["data"]
    assert data["ok"] is True
    assert data["review"]["verdict"] == "needs-repair"
    assert data["provider"] == "openai"
    assert authed.called is True                      # the SHARED provider was used
    # Multimodal content: a text block + an image_url block was sent.
    msgs = authed.last_request.messages
    user_msg = [m for m in msgs if m.role == "user"][0]
    kinds = [b.get("type") for b in user_msg.content]
    assert "text" in kinds and "image_url" in kinds


# ── 16. Unsupported MIME rejected ─────────────────────────────────────────────
def test_unsupported_mime_400(client, authed):
    r = _post(client, imageDataUrl="data:image/gif;base64," + base64.b64encode(b"abc").decode())
    assert r.status_code == 400


# ── 17. Oversized image rejected ──────────────────────────────────────────────
def test_oversized_image_400(client, authed):
    big = base64.b64encode(b"x" * 1_700_000).decode()
    r = _post(client, imageDataUrl="data:image/webp;base64," + big)
    assert r.status_code == 400


# ── 18. Malformed base64 rejected ─────────────────────────────────────────────
def test_malformed_base64_400(client, authed):
    r = _post(client, imageDataUrl="data:image/webp;base64,@@@notbase64@@@")
    assert r.status_code == 400


# ── 21. Vision-capable model required ─────────────────────────────────────────
def test_non_vision_model_fails_open(client, monkeypatch):
    monkeypatch.setenv("ENABLE_RENDERED_VISION_REVIEW", "true")

    class NoVision(FakeVisionProvider):
        supports_vision = False
        vision_models = ()

    register_provider(NoVision())
    app.dependency_overrides[require_auth] = lambda: SimpleNamespace(id="u", is_guest=False)
    try:
        r = _post(client)
        assert r.status_code == 200
        assert r.json()["data"]["ok"] is False       # fail-open, never blocks the build
    finally:
        app.dependency_overrides.pop(require_auth, None)
        _reset_for_tests()


# ── 22. Provider timeout fail-open (200, review null) ─────────────────────────
def test_provider_timeout_fail_open(client, monkeypatch):
    monkeypatch.setenv("ENABLE_RENDERED_VISION_REVIEW", "true")
    register_provider(FakeVisionProvider(raises=ProviderTimeoutError("slow")))
    app.dependency_overrides[require_auth] = lambda: SimpleNamespace(id="u", is_guest=False)
    try:
        r = _post(client)
        assert r.status_code == 200
        assert r.json()["data"]["ok"] is False
        assert r.json()["data"]["review"] is None
    finally:
        app.dependency_overrides.pop(require_auth, None)
        _reset_for_tests()


# ── 25. Malformed provider JSON fail-open ─────────────────────────────────────
def test_malformed_provider_json_fail_open(client, monkeypatch):
    monkeypatch.setenv("ENABLE_RENDERED_VISION_REVIEW", "true")
    register_provider(FakeVisionProvider(content="this is not json"))
    app.dependency_overrides[require_auth] = lambda: SimpleNamespace(id="u", is_guest=False)
    try:
        r = _post(client)
        assert r.status_code == 200
        assert r.json()["data"]["review"] is None
        assert r.json()["data"]["errorCode"] == "malformed-json"
    finally:
        app.dependency_overrides.pop(require_auth, None)
        _reset_for_tests()


# ── 26. The screenshot data URL is never echoed back in the response ──────────
def test_screenshot_not_echoed(client, authed):
    r = _post(client)
    assert _TINY_WEBP not in r.text
    assert "base64" not in r.text


# ── 28. Rate limit → 429 after the per-user window is exhausted ───────────────
def test_rate_limit_429(client, authed):
    last = None
    for _ in range(20):
        last = _post(client)
    assert last.status_code == 429
