# coding: utf-8
"""
Phase 6.x — Memory hydration / cache / preference / pipeline tests.

The spec asks for 8 scenarios; this file pins them all plus the new
trigger / extractor patterns:

  TestSaveRetrieveSameChat       — round-trip in one session
  TestSaveRetrieveNewChat        — save in chat A, recall in chat B
  TestStreamingRetrieval         — system prompt receives the memory
  TestProviderSwitchRetrieval    — switching provider preserves retrieval
  TestCacheInvalidation          — new save busts the user's cache
  TestRankingOrder               — durable kinds outrank ordinary facts
  TestFallbackRetrieval          — preference fallback when no semantic match
  TestOwnerSessionRetrieval      — owner sees their own memories
  TestProjectMemoryRetrieval     — project-scoped retrieval works

Plus the trigger / extractor failure modes the user reported in
production:
  TestNewTriggersAndExtractors
    - "Ben kısa cevaplar seviyorum bunu kaydet"   suffix trigger
    - "Ben X seviyorum"                            tr_like auto-extract
    - "Bunu kaydet: X"                             prefix trigger
"""
from __future__ import annotations

from typing import AsyncIterator

import pytest

from backend.services.memory_plane import (
    cache as mp_cache,
    client as plane_client,
    hydrate_for_chat,
    top_preferences,
)
from backend.services.memory_plane import chat_integration as mp_chat
from backend.services.memory_plane.extractor import extract
from backend.services.providers.streaming import (
    ProviderStreamStart, ProviderStreamToken, ProviderStreamDone,
)


# ── Helper: capture provider request to inspect system prompt ───────────────

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


@pytest.fixture(autouse=True)
def _reset_cache():
    """Every test starts with a clean cache so cache hits don't
    leak across tests."""
    mp_cache._reset_for_tests()
    yield
    mp_cache._reset_for_tests()


# ════════════════════════════════════════════════════════════════════════════
# Pipeline core
# ════════════════════════════════════════════════════════════════════════════

class TestHydrationCore:

    def test_disabled_returns_empty_snapshot(self, monkeypatch):
        monkeypatch.setenv("ENABLE_MEMORY_PLANE", "false")
        snap = hydrate_for_chat(user_id="u1")
        assert snap.is_empty()
        assert snap.duration_ms >= 0

    def test_empty_user_returns_empty_snapshot(self, tmp_memory_plane_db):
        snap = hydrate_for_chat(user_id="u-fresh")
        assert snap.is_empty()
        assert snap.cache_hit is False

    def test_populated_user_returns_memories(self, tmp_memory_plane_db):
        plane_client.create(user_id="u1", content="Kısa cevaplar tercih ediyorum",
                            kind="preference", importance=0.9)
        snap = hydrate_for_chat(user_id="u1")
        assert snap.hit_count >= 1
        assert "Kısa cevaplar" in snap.context_text


# ════════════════════════════════════════════════════════════════════════════
# Cache behaviour
# ════════════════════════════════════════════════════════════════════════════

class TestCacheBehaviour:

    def test_cache_hit_skips_db(self, tmp_memory_plane_db):
        plane_client.create(user_id="u1", content="cached-pref",
                            kind="preference", importance=0.9)
        first  = hydrate_for_chat(user_id="u1")
        second = hydrate_for_chat(user_id="u1")
        assert first.cache_hit is False
        assert second.cache_hit is True
        # Both return the same content.
        assert first.context_text == second.context_text

    def test_cache_invalidated_on_save(self, tmp_memory_plane_db):
        """Save → cache miss → cache populated → new save → cache busted."""
        plane_client.create(user_id="u1", content="A", kind="preference",
                            importance=0.9)
        hydrate_for_chat(user_id="u1")  # warm cache
        assert mp_cache.get("u1") is not None
        # New save MUST invalidate.
        plane_client.create(user_id="u1", content="B", kind="preference",
                            importance=0.9)
        assert mp_cache.get("u1") is None

    def test_cache_invalidated_on_delete(self, tmp_memory_plane_db):
        rec = plane_client.create(user_id="u1", content="A", kind="preference")
        hydrate_for_chat(user_id="u1")  # warm
        assert mp_cache.get("u1") is not None
        plane_client.delete(rec.id, user_id="u1")
        assert mp_cache.get("u1") is None

    def test_cache_isolated_per_user(self, tmp_memory_plane_db):
        plane_client.create(user_id="alice", content="A", kind="preference")
        plane_client.create(user_id="bob",   content="B", kind="preference")
        hydrate_for_chat(user_id="alice")
        hydrate_for_chat(user_id="bob")
        # Invalidating alice does NOT bust bob.
        mp_cache.invalidate_user("alice")
        assert mp_cache.get("alice") is None
        assert mp_cache.get("bob")   is not None


# ════════════════════════════════════════════════════════════════════════════
# Ranking + fallback
# ════════════════════════════════════════════════════════════════════════════

class TestRankingAndFallback:

    def test_durable_kinds_outrank_plain_facts(self, tmp_memory_plane_db):
        # Plain fact created first (would normally beat preference on
        # recency). Preference / style / goal must still surface first.
        plane_client.create(user_id="u1", content="boring fact",
                            kind="fact", importance=0.5)
        plane_client.create(user_id="u1", content="formal tone please",
                            kind="style", importance=0.5)
        plane_client.create(user_id="u1", content="ship by Q3",
                            kind="goal", importance=0.5)
        plane_client.create(user_id="u1", content="short answers",
                            kind="preference", importance=0.5)
        snap = hydrate_for_chat(user_id="u1")
        # Durable kinds appear first in the block, before plain fact.
        ix_style = snap.context_text.find("formal tone")
        ix_pref  = snap.context_text.find("short answers")
        ix_goal  = snap.context_text.find("Q3")
        ix_fact  = snap.context_text.find("boring fact")
        for ix_durable in (ix_style, ix_pref, ix_goal):
            assert ix_durable != -1 and (ix_fact == -1 or ix_durable < ix_fact)

    def test_preference_fallback_when_no_semantic_match(self, tmp_memory_plane_db):
        """The user asks an unrelated question; semantic search returns
        nothing of interest. Preference fallback must still inject the
        saved durable memories."""
        plane_client.create(user_id="u1",
                            content="Always answer in bullet points",
                            kind="style", importance=0.9)
        # Query is intentionally unrelated to "bullet points".
        snap = hydrate_for_chat(user_id="u1", query="weather in tokyo")
        assert snap.hit_count >= 1
        assert "bullet points" in snap.context_text


# ════════════════════════════════════════════════════════════════════════════
# Save → retrieve scenarios (the user's spec)
# ════════════════════════════════════════════════════════════════════════════

class TestSaveRetrieveScenarios:

    def test_save_retrieve_same_chat(
        self, client, tmp_memory_plane_db, fake_provider,
    ):
        """Save and recall in the same chat — system prompt has it."""
        client.post("/v2/chat/stream", json={
            "user_id": "u-same-chat",
            "messages": [{"role": "user",
                          "content": "hafızana kaydet: kısa cevaplar tercih ediyorum"}],
        })
        r = client.post("/v2/chat/stream", json={
            "user_id": "u-same-chat",
            "messages": [
                {"role": "user", "content": "ne tercih ediyordum?"},
            ],
        })
        assert r.status_code == 200
        assert "kısa" in fake_provider.last_system.lower()

    def test_save_retrieve_new_chat(
        self, client, tmp_memory_plane_db, fake_provider,
    ):
        """Save in chat A; new chat B (fresh messages array) under
        the SAME user_id recalls it."""
        client.post("/v2/chat/stream", json={
            "user_id": "u-new-chat",
            "messages": [{"role": "user",
                          "content": "remember this: I like concise replies"}],
        })
        # Fresh request, no prior messages — same user_id.
        r = client.post("/v2/chat/stream", json={
            "user_id": "u-new-chat",
            "messages": [{"role": "user",
                          "content": "what do I like?"}],
        })
        assert r.status_code == 200
        assert "concise" in fake_provider.last_system.lower()

    def test_streaming_retrieval_includes_ground_truth_header(
        self, client, tmp_memory_plane_db, fake_provider,
    ):
        """The system prompt has the strong recall instruction so the
        LLM doesn't paraphrase / fabricate."""
        client.post("/v2/chat/stream", json={
            "user_id": "u-stream",
            "messages": [{"role": "user",
                          "content": "remember this: always reply in JSON"}],
        })
        r = client.post("/v2/chat/stream", json={
            "user_id": "u-stream",
            "messages": [{"role": "user", "content": "what format?"}],
        })
        assert r.status_code == 200
        sp = fake_provider.last_system
        assert "GROUND TRUTH" in sp
        assert "JSON" in sp

    def test_provider_switch_retrieval(
        self, client, tmp_memory_plane_db, fake_provider,
    ):
        """Changing mode (and thus the routed provider) doesn't lose
        memory injection."""
        client.post("/v2/chat/stream", json={
            "user_id": "u-prov",
            "messages": [{"role": "user",
                          "content": "remember this: I want Turkish replies"}],
        })
        # Different mode — same fake_provider intercepts; we just need
        # to confirm memory still reaches the system message.
        r = client.post("/v2/chat/stream", json={
            "user_id": "u-prov",
            "mode":    "deep_think",
            "messages": [{"role": "user", "content": "ok"}],
        })
        assert r.status_code == 200
        assert "Turkish" in fake_provider.last_system

    def test_owner_session_retrieval(
        self, client, tmp_memory_plane_db, fake_provider,
    ):
        """An owner session is just another user_id namespace as far
        as memory plane is concerned. Save + recall round-trips."""
        client.post("/v2/chat/stream", json={
            "user_id": "owner-id",
            "messages": [{"role": "user",
                          "content": "remember this: I prefer code with comments"}],
        })
        r = client.post("/v2/chat/stream", json={
            "user_id": "owner-id",
            "messages": [{"role": "user", "content": "code style?"}],
        })
        assert r.status_code == 200
        assert "comments" in fake_provider.last_system.lower()

    def test_project_memory_retrieval(
        self, client, tmp_memory_plane_db, fake_provider,
    ):
        """When the chat carries a project_id, retrieval filters to
        that project. Out-of-project memories don't bleed in."""
        # Save under project A.
        plane_client.create(user_id="u-proj", content="A-only fact",
                            kind="preference", project_id="proj-A",
                            importance=0.9)
        # Save under project B.
        plane_client.create(user_id="u-proj", content="B-only fact",
                            kind="preference", project_id="proj-B",
                            importance=0.9)
        # Query with project A → A-only surfaces, B-only doesn't.
        snap = hydrate_for_chat(user_id="u-proj", project_id="proj-A")
        assert "A-only" in snap.context_text
        assert "B-only" not in snap.context_text


# ════════════════════════════════════════════════════════════════════════════
# Trigger + extractor expansions (the specific production failure)
# ════════════════════════════════════════════════════════════════════════════

class TestNewTriggersAndExtractors:

    def test_suffix_trigger_bunu_kaydet(self):
        """The exact phrasing the user reported in production —
        save command at the END of a declarative statement."""
        cmd = mp_chat.is_explicit_save_command(
            "Ben kısa cevaplar seviyorum bunu kaydet"
        )
        assert cmd is not None
        assert "kısa cevaplar seviyorum" in cmd["fact"].lower()
        assert cmd.get("position") == "suffix"

    def test_suffix_trigger_save_this_english(self):
        cmd = mp_chat.is_explicit_save_command(
            "My favourite editor is Neovim please save this"
        )
        assert cmd is not None
        assert "Neovim" in cmd["fact"]

    @pytest.mark.parametrize("msg,expected", [
        ("Bunu kaydet: müşteri adı Mehmet",       "Mehmet"),
        ("bunu da kaydet: yarın 14:00 toplantı", "toplantı"),
        ("lütfen kaydet: deploy command is ./go", "deploy"),
    ])
    def test_new_prefix_triggers(self, msg, expected):
        cmd = mp_chat.is_explicit_save_command(msg)
        assert cmd is not None
        assert expected.lower() in cmd["fact"].lower()

    def test_turkish_seviyorum_autoextracts_as_preference(self):
        """"Ben X seviyorum" should be picked up by the auto-extractor
        as a HIGH-importance preference — even without an explicit
        save trigger."""
        cands = extract("Ben kısa cevaplar seviyorum")
        prefs = [c for c in cands if c.kind == "preference"]
        assert prefs, "tr_like extractor missed 'seviyorum' pattern"
        # Importance HIGH so the preference fallback can surface it.
        assert prefs[0].importance >= 0.7

    def test_turkish_severim_autoextracts_as_preference(self):
        cands = extract("Türkçe yanıtları severim")
        prefs = [c for c in cands if c.kind == "preference"]
        assert prefs


# ════════════════════════════════════════════════════════════════════════════
# Performance — soft target <100ms per the spec
# ════════════════════════════════════════════════════════════════════════════

class TestPerformance:

    def test_cached_hydration_is_fast(self, tmp_memory_plane_db):
        """Cache hit should be sub-millisecond in-process. Spec says
        <100ms total; cache hit is the common case."""
        plane_client.create(user_id="u1", content="x", kind="preference",
                            importance=0.9)
        hydrate_for_chat(user_id="u1")  # warm
        snap = hydrate_for_chat(user_id="u1")
        assert snap.cache_hit is True
        assert snap.duration_ms < 50

    def test_cold_hydration_is_under_100ms(self, tmp_memory_plane_db):
        """Cold path (cache miss) should still be well under the
        100ms target on small SQLite stores."""
        for i in range(8):
            plane_client.create(user_id="u1", content=f"item {i}",
                                kind="preference", importance=0.5 + i * 0.05)
        # Bust any warm cache.
        mp_cache.invalidate_user("u1")
        snap = hydrate_for_chat(user_id="u1")
        assert snap.hit_count >= 1
        assert snap.duration_ms < 100, f"cold hydration too slow: {snap.duration_ms}ms"


# ════════════════════════════════════════════════════════════════════════════
# End-to-end: the user's exact reported scenario
# ════════════════════════════════════════════════════════════════════════════

class TestUserReportedScenario:
    """The exact failure the user described:
        User: 'Ben kısa cevaplar seviyorum bunu kaydet.'
        Assistant: '...kaydettim.'
        User (later): 'Nasıl cevaplar seviyorum?'
        Assistant: 'Bu konuda kaydım yok.'   ← THE BUG

    After this PR the save fires (suffix trigger + tr_like auto-extract),
    and recall in a fresh chat finds the preference via fallback."""

    def test_full_round_trip(
        self, client, tmp_memory_plane_db, fake_provider,
    ):
        # Step 1: user says the natural Turkish phrasing.
        r1 = client.post("/v2/chat/stream", json={
            "user_id": "u-reported",
            "messages": [{"role": "user",
                          "content": "Ben kısa cevaplar seviyorum bunu kaydet"}],
        })
        # The save shortcut fires → no LLM call → SSE carries
        # "Kaydettim." token.
        assert r1.status_code == 200
        assert "Kaydettim." in r1.text
        assert len(fake_provider.requests) == 0  # short-circuited

        # And the row really is in the store.
        items = plane_client.list_user("u-reported")
        assert any("kısa cevap" in (m.content or "").lower() for m in items)

        # Step 2: fresh chat, recall question.
        r2 = client.post("/v2/chat/stream", json={
            "user_id": "u-reported",
            "messages": [{"role": "user",
                          "content": "Nasıl cevaplar seviyorum?"}],
        })
        assert r2.status_code == 200
        # The system prompt MUST include the saved preference.
        sp = fake_provider.last_system
        assert "kısa cevap" in sp.lower(), (
            f"recall failed — system prompt missing the saved fact:\n{sp!r}"
        )
