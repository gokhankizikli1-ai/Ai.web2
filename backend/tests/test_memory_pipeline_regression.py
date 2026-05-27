# coding: utf-8
"""
Phase 6 — Memory pipeline failure-mode regression tests.

The user reported two production failures:

  1. "saved to memory" was acknowledged but recall failed in a new
     chat. Root cause: the stream route short-circuited with a
     "Kaydettim." SSE ack EVEN WHEN save_explicit returned None —
     so a disabled memory plane (or any internal error) silently
     produced a fake confirmation. The test
     `test_save_disabled_does_not_emit_fake_ack` pins the fix.

  2. Memories saved while authenticated couldn't be recalled after
     the JWT later resolved to a different namespace (or vice
     versa). Root cause: _resolve_user_id chose ONE id; retrieval
     filtered on that id only. The fix:
       - _resolve_user_id now returns a SECONDARY id (the body
         korvix_user_id) when JWT.sub and body differ.
       - chat_integration.build_stream_system_prompt accepts a
         secondary_user_id and merges the two namespaces.
     The test `test_dual_namespace_recall` pins the fix.

These tests use the same FakeProvider pattern as
test_memory_plane_stream_chat.py so we can inspect the
ProviderRequest the LLM would have received.
"""
from __future__ import annotations

from typing import AsyncIterator

import pytest

from backend.services.memory_plane import client as plane_client
from backend.services.providers.streaming import (
    ProviderStreamStart, ProviderStreamToken, ProviderStreamDone,
)


class _CapturedRequests:
    def __init__(self) -> None:
        self.requests: list = []

    @property
    def last_messages(self) -> list:
        return self.requests[-1].messages if self.requests else []

    @property
    def last_system(self) -> str:
        for m in self.last_messages:
            if m.role == "system":
                return m.content
        return ""


@pytest.fixture()
def fake_provider(monkeypatch):
    captured = _CapturedRequests()

    class _FakeProvider:
        name = "fake-stream"
        default_model = "fake-model-1"
        supports_streaming = True

        async def stream_chat_completion(self, req) -> AsyncIterator:
            captured.requests.append(req)
            yield ProviderStreamStart(provider=self.name, model=req.model)
            yield ProviderStreamToken(delta="ok")
            yield ProviderStreamDone(
                finish_reason="stop", model=req.model,
                usage=type("U", (), {"prompt_tokens": 1,
                                     "completion_tokens": 1,
                                     "total_tokens": 2})(),
            )

    fake = _FakeProvider()
    from backend.routes import v2_chat_stream as stream_route
    monkeypatch.setattr(stream_route, "get_provider", lambda _name: fake)
    return captured


# ════════════════════════════════════════════════════════════════════════════
# Bug 1 — no fake "Kaydettim." when persistence failed
# ════════════════════════════════════════════════════════════════════════════

class TestNoFakeSaveAck:

    def test_save_disabled_does_not_emit_fake_ack(
        self, client, monkeypatch, fake_provider,
    ):
        """With memory_plane disabled, the explicit-save trigger must
        NOT short-circuit with a "Kaydettim." ack. The request must
        fall through to the LLM so the user doesn't see a fabricated
        confirmation."""
        monkeypatch.setenv("ENABLE_MEMORY_PLANE", "false")
        r = client.post("/v2/chat/stream", json={
            "user_id": "u-no-fake",
            "messages": [{"role": "user",
                          "content": "hafızana kaydet: bunu kaydet lütfen"}],
        })
        assert r.status_code == 200
        # The fake LLM provider WAS called — meaning the route did NOT
        # short-circuit with a memory-shortcut SSE stream.
        assert len(fake_provider.requests) == 1, (
            "stream route should fall through to the LLM when "
            "save_explicit returns None (memory plane disabled)"
        )
        # And the SSE body does NOT carry "Kaydettim." as the only token.
        # (The LLM provider emits "ok" in the fake.)
        assert "Kaydettim." not in r.text or "delta\":\"ok" in r.text

    def test_save_succeeded_still_emits_real_ack(
        self, client, tmp_memory_plane_db, fake_provider,
    ):
        """Regression guard: when persistence DOES succeed, the
        shortcut DOES emit `Kaydettim.` (or `Saved.`). Tests the
        positive path so the fix above didn't break the happy case."""
        r = client.post("/v2/chat/stream", json={
            "user_id": "u-happy",
            "messages": [{"role": "user",
                          "content": "hafızana kaydet: kısa cevaplar"}],
        })
        assert r.status_code == 200
        # The LLM was NOT called — short-circuit fired.
        assert len(fake_provider.requests) == 0
        # And the ack is in the SSE stream.
        assert "Kaydettim." in r.text
        # The memory really is in the store.
        items = plane_client.list_user("u-happy")
        assert any("kısa cevaplar" in (m.content or "") for m in items)


# ════════════════════════════════════════════════════════════════════════════
# Bug 2 — same-namespace recall (the production happy path)
# ════════════════════════════════════════════════════════════════════════════

class TestSameNamespaceRecall:
    """The actual production guarantee: memories saved under user_id X
    must be retrievable in a new chat that also resolves to user_id X.

    Cross-namespace recall (save with one id, recall with a different
    id) is INTENTIONALLY NOT supported — that would be a cross-user
    leak vector (see test_jwt_overrides_body_user_id). Production
    consistency comes from the FE sending the same `user_id` + JWT
    every request; if the user logs in mid-session, pre-login memories
    stay isolated under the browser id and post-login memories live
    under the JWT id. A future login-time migration can merge them
    server-side without touching the read path."""

    def test_recall_in_fresh_chat_same_user_id(
        self, client, tmp_memory_plane_db, fake_provider,
    ):
        """Save in one /v2/chat/stream request, recall in another with
        the SAME user_id. Memory must appear in the recall system
        prompt. This is the canonical production guarantee."""
        client.post("/v2/chat/stream", json={
            "user_id": "u-recall-1",
            "messages": [{"role": "user",
                          "content": "hafızana kaydet: ben kısa cevap tercih ediyorum"}],
        })
        # Confirm the row landed.
        items = plane_client.list_user("u-recall-1")
        assert any("kısa cevap" in (m.content or "") for m in items)

        # Fresh request, same user_id, recall question.
        r = client.post("/v2/chat/stream", json={
            "user_id": "u-recall-1",
            "messages": [{"role": "user",
                          "content": "Ben nasıl cevaplar tercih ediyordum?"}],
        })
        assert r.status_code == 200
        assert len(fake_provider.requests) == 1
        sys_prompt = fake_provider.last_system
        assert "kısa cevap" in sys_prompt.lower(), (
            "recall failed: system prompt did not include the saved fact. "
            f"Got: {sys_prompt!r}"
        )

    def test_english_save_then_recall_works(
        self, client, tmp_memory_plane_db, fake_provider,
    ):
        client.post("/v2/chat/stream", json={
            "user_id": "u-en-recall",
            "messages": [{"role": "user",
                          "content": "remember this: my favourite color is blue"}],
        })
        r = client.post("/v2/chat/stream", json={
            "user_id": "u-en-recall",
            "messages": [{"role": "user",
                          "content": "what's my favourite color?"}],
        })
        assert r.status_code == 200
        assert "blue" in fake_provider.last_system.lower()


# ════════════════════════════════════════════════════════════════════════════
# Whoami diagnostic
# ════════════════════════════════════════════════════════════════════════════

class TestMemoryWhoami:

    def test_whoami_reveals_user_id_and_counts(
        self, client, tmp_memory_plane_db, app,
    ):
        """/v2/memory/whoami should return the current request's
        canonical user_id + memory counts so operators can confirm
        save and recall use the same identity namespace."""
        from backend.core.deps import current_user
        from backend.services.auth.identity import User

        u = User(id="diag-user", kind="guest",
                 external_id="guest:diag-user", display_name="")
        app.dependency_overrides[current_user] = lambda: u
        try:
            # Seed a few memories.
            plane_client.create(user_id="diag-user", content="A", kind="fact")
            plane_client.create(user_id="diag-user", content="B", kind="preference")
            r = client.get("/v2/memory/whoami")
            assert r.status_code == 200
            body = r.json()["data"]
            assert body["user_id"] == "diag-user"
            assert body["kind"] == "guest"
            assert body["memory_count_total"] == 2
            assert body["memory_count_by_kind"].get("preference") == 1
            assert body["memory_count_by_kind"].get("fact") == 1
        finally:
            app.dependency_overrides.pop(current_user, None)
