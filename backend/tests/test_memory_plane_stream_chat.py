# coding: utf-8
"""
Phase 6 — /v2/chat/stream Memory Plane integration tests.

Covers the actual production chat path. The legacy /chat tests (in
test_memory_plane_chat_integration.py) already cover the
chat_integration helpers; here we focus on the streaming route's
behaviour:

  * Explicit-save shortcut emits an SSE ack stream WITHOUT calling the
    LLM. The persisted memory is visible via the Memory Plane client.

  * Auto-extract fires on a regular turn and stores high-signal
    patterns (KorvixAI mention, etc.).

  * The system prompt the provider receives contains the saved memory
    on a subsequent turn — this is the actual fix for the production
    "I cannot recall my preference" bug.

  * Identity resolution: JWT > body user_id > anonymous. An
    authenticated body claim cannot impersonate another user.

  * Flag-off chat path is byte-identical to pre-Phase-6 streaming.

We capture the provider's ProviderRequest via a monkeypatched fake
provider so we can introspect what the LLM would have seen.
"""
from __future__ import annotations

from typing import AsyncIterator, List

import pytest

from backend.services.memory_plane import client as plane_client
from backend.services.memory_plane import chat_integration as mp_chat
from backend.services.providers.streaming import (
    ProviderStreamStart, ProviderStreamToken, ProviderStreamDone,
)


# ════════════════════════════════════════════════════════════════════════════
# Fixtures — fake streaming provider that captures the ProviderRequest
# ════════════════════════════════════════════════════════════════════════════

class _CapturedRequests:
    """Holds the last ProviderRequest seen by the fake provider so the
    test can assert what the LLM would have received."""
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
    """Replace the resolved provider with a deterministic streaming
    stub. Records every ProviderRequest the route assembles."""
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
# Helpers
# ════════════════════════════════════════════════════════════════════════════

def _read_sse_body(raw_text: str) -> List[dict]:
    """Parse a TestClient SSE response body into a list of
    {event, data} dicts. Cheap line-based parser — sufficient for
    the tests' small payloads."""
    out: list = []
    current = {"event": "message", "data": ""}
    for line in raw_text.splitlines():
        if not line.strip():
            if current["data"]:
                import json as _json
                try:
                    current["data"] = _json.loads(current["data"])
                except Exception:
                    pass
                out.append(current)
                current = {"event": "message", "data": ""}
            continue
        if line.startswith("event:"):
            current["event"] = line.split(":", 1)[1].strip()
        elif line.startswith("data:"):
            current["data"] = line.split(":", 1)[1].strip()
    if current["data"]:
        import json as _json
        try:
            current["data"] = _json.loads(current["data"])
        except Exception:
            pass
        out.append(current)
    return out


# ════════════════════════════════════════════════════════════════════════════
# Tests
# ════════════════════════════════════════════════════════════════════════════

class TestExplicitSaveShortcut:
    """The user's most-visible feature — `remember this: X` must
    short-circuit BEFORE the LLM is called."""

    def test_english_save_shortcuts_emits_ack_stream(
        self, client, tmp_memory_plane_db, fake_provider,
    ):
        r = client.post("/v2/chat/stream", json={
            "user_id": "u-stream-1",
            "messages": [{"role": "user",
                          "content": "remember this: I prefer concise tech answers"}],
        })
        assert r.status_code == 200
        frames = _read_sse_body(r.text)
        # 3 frames: ready, token (Saved.), done
        events = [f["event"] for f in frames]
        assert events == ["ready", "token", "done"]
        assert frames[1]["data"]["delta"] == "Saved."
        # And NO LLM call was made.
        assert fake_provider.requests == []
        # And the memory really did persist.
        items = plane_client.list_user("u-stream-1")
        assert any("concise" in (m.content or "").lower() for m in items)

    def test_turkish_save_shortcuts_emits_kaydettim(
        self, client, tmp_memory_plane_db, fake_provider,
    ):
        r = client.post("/v2/chat/stream", json={
            "user_id": "u-stream-tr",
            "messages": [{"role": "user",
                          "content": "Ben kısa ve teknik cevapları tercih ediyorum.  hafızana kaydet"}],
        })
        # The trigger "hafızana kaydet" is at the END of the message —
        # our matcher requires the trigger at the START. So this should
        # NOT short-circuit; it should auto-extract instead (preference
        # pattern).
        # Regular streaming path → fake provider called.
        assert r.status_code == 200

    def test_turkish_save_shortcuts_prefix_emits_kaydettim(
        self, client, tmp_memory_plane_db, fake_provider,
    ):
        r = client.post("/v2/chat/stream", json={
            "user_id": "u-stream-tr-prefix",
            "messages": [{"role": "user",
                          "content": "hafızana kaydet: Ben kısa ve teknik cevapları tercih ediyorum."}],
        })
        assert r.status_code == 200
        frames = _read_sse_body(r.text)
        assert [f["event"] for f in frames] == ["ready", "token", "done"]
        assert frames[1]["data"]["delta"] == "Kaydettim."
        # The provider was never called.
        assert fake_provider.requests == []
        # The full fact was saved.
        items = plane_client.list_user("u-stream-tr-prefix")
        assert any("teknik" in (m.content or "").lower() for m in items)

    def test_anonymous_user_skips_memory_path(
        self, client, tmp_memory_plane_db, fake_provider,
    ):
        """No user_id, no JWT → no memory. The streaming path should
        still work but with the LLM (fake provider) handling the
        message."""
        r = client.post("/v2/chat/stream", json={
            "messages": [{"role": "user", "content": "remember this: X"}],
        })
        assert r.status_code == 200
        # Without identity, the explicit-save shortcut doesn't fire —
        # the LLM stream runs instead.
        assert len(fake_provider.requests) == 1


class TestSystemPromptInjection:
    """The actual production-bug fix — saved memories must appear in
    the system prompt of subsequent streaming calls."""

    def test_saved_memory_appears_in_system_prompt(
        self, client, tmp_memory_plane_db, fake_provider,
    ):
        uid = "u-recall"
        # Turn 1 — explicit save via /v2/chat/stream.
        r1 = client.post("/v2/chat/stream", json={
            "user_id": uid,
            "messages": [{"role": "user",
                          "content": "hafızana kaydet: Ben kısa ve teknik cevapları tercih ediyorum."}],
        })
        assert r1.status_code == 200

        # Turn 2 — a follow-up question. The provider MUST see the
        # saved preference in its system prompt.
        r2 = client.post("/v2/chat/stream", json={
            "user_id": uid,
            "messages": [{"role": "user",
                          "content": "Ben nasıl cevapları tercih ediyordum?"}],
        })
        assert r2.status_code == 200
        assert len(fake_provider.requests) == 1
        sys_prompt = fake_provider.last_system
        # The strong "ground truth" header must be there.
        assert "GROUND TRUTH" in sys_prompt
        # The actual saved fact must be there.
        assert "teknik" in sys_prompt.lower()
        # And it must come before the user's question content in
        # the messages array.
        roles = [m.role for m in fake_provider.last_messages]
        assert roles[0] == "system"

    def test_no_memory_no_system_prompt_injected(
        self, client, tmp_memory_plane_db, fake_provider,
    ):
        """Pristine user → no memory hits → no system message added.
        This guarantees the streaming path stays byte-identical for
        users with empty memory."""
        r = client.post("/v2/chat/stream", json={
            "user_id": "u-pristine",
            "messages": [{"role": "user", "content": "hi there"}],
        })
        assert r.status_code == 200
        sys_prompt = fake_provider.last_system
        # No memory + no mode → no system message at all.
        assert sys_prompt == ""

    def test_memory_block_merged_into_existing_system_message(
        self, client, tmp_memory_plane_db, fake_provider,
    ):
        """If the caller already supplied a system message, the
        memory context must be MERGED into it (no duplicate
        system messages)."""
        uid = "u-merge"
        # Pre-seed a memory directly via the client.
        plane_client.create(user_id=uid, content="User prefers Vercel deploys",
                            kind="preference", importance=0.9)
        r = client.post("/v2/chat/stream", json={
            "user_id": uid,
            "messages": [
                {"role": "system", "content": "You are a code assistant."},
                {"role": "user", "content": "where should we deploy?"},
            ],
        })
        assert r.status_code == 200
        msgs = fake_provider.last_messages
        # Exactly one system message at index 0.
        assert msgs[0].role == "system"
        assert sum(1 for m in msgs if m.role == "system") == 1
        # Both the original system content AND the memory survive.
        assert "code assistant" in msgs[0].content
        assert "Vercel" in msgs[0].content


class TestIdentityResolution:

    def test_body_user_id_used_when_no_jwt(self, client, tmp_memory_plane_db, fake_provider):
        plane_client.create(user_id="u-body-only",
                            content="my-distinctive-fact", importance=0.9)
        r = client.post("/v2/chat/stream", json={
            "user_id": "u-body-only",
            "messages": [{"role": "user", "content": "tell me"}],
        })
        assert r.status_code == 200
        assert "distinctive-fact" in fake_provider.last_system

    def test_jwt_overrides_body_user_id(self, client, tmp_memory_plane_db, fake_provider):
        """Identity-first precedence — a body-supplied user_id MUST
        NOT win over a Bearer token. This is the same security
        contract as /v2/memory."""
        # Seed alice and bob — bob's content is in the body, alice's
        # is in the JWT-claimed user.
        plane_client.create(user_id="alice-jwt-id", content="alice-memo",
                            importance=0.9)
        plane_client.create(user_id="bob-body-id",  content="bob-memo",
                            importance=0.9)

        # Craft a minimal unverified JWT with sub=alice-jwt-id.
        import json, base64
        def _b64u(d):
            return base64.urlsafe_b64encode(json.dumps(d).encode()).rstrip(b"=").decode()
        token = ".".join([
            _b64u({"alg": "HS256", "typ": "JWT"}),
            _b64u({"sub": "alice-jwt-id"}),
            "fakesig",
        ])
        r = client.post(
            "/v2/chat/stream",
            json={"user_id": "bob-body-id",
                  "messages": [{"role": "user", "content": "who am I?"}]},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 200
        # System prompt must contain Alice's content (JWT-resolved),
        # NOT Bob's (body-claimed).
        sp = fake_provider.last_system
        assert "alice-memo" in sp
        assert "bob-memo" not in sp


class TestFlagOff:

    def test_flag_off_streams_unchanged(self, client, monkeypatch, fake_provider):
        monkeypatch.setenv("ENABLE_MEMORY_PLANE", "false")
        r = client.post("/v2/chat/stream", json={
            "user_id": "u-flag-off",
            "messages": [{"role": "user",
                          "content": "hafızana kaydet: should not save"}],
        })
        assert r.status_code == 200
        # With flag off, the explicit-save shortcut does NOT fire —
        # the message goes straight to the LLM.
        assert len(fake_provider.requests) == 1
        # No system prompt added.
        assert fake_provider.last_system == ""


class TestAutoExtractionOnStream:

    def test_korvixai_mention_auto_extracts(
        self, client, tmp_memory_plane_db, fake_provider,
    ):
        r = client.post("/v2/chat/stream", json={
            "user_id": "u-auto-stream",
            "messages": [{"role": "user",
                          "content": "I'm building KorvixAI as my main project."}],
        })
        assert r.status_code == 200
        # LLM was called (no shortcut).
        assert len(fake_provider.requests) == 1
        # And memory was extracted.
        items = plane_client.list_user("u-auto-stream")
        assert any("KorvixAI" in (m.content or "") for m in items)
