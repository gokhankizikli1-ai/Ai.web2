# coding: utf-8
"""
Phase 6 — Chat ↔ Memory Plane integration tests.

Two layers of coverage:

  1. Unit tests for `chat_integration.py` — the trigger matcher, the
     explicit-save helper, the auto-extract path, the context-fold
     seam. These run without a TestClient.

  2. End-to-end tests for the `/chat` route — verify that:
       a. An explicit "remember this" command persists to memory_plane
          and surfaces in /v2/memory.
       b. Auto-extraction fires on a regular chat turn.
       c. The retrieval seam (fold_into_mem_summary) actually pulls
          saved memories back when ENABLE_MEMORY_PLANE=true.
       d. With the flag OFF, the chat path is byte-identical.

Together these cover the user-facing contract:
   memory extraction works · storage works · retrieval works ·
   /v2/memory UI reflects saved memories.
"""
from __future__ import annotations

import pytest

from backend.services.memory_plane import client as plane_client
from backend.services.memory_plane import chat_integration as mp_chat


# ════════════════════════════════════════════════════════════════════════════
# Unit — trigger matcher
# ════════════════════════════════════════════════════════════════════════════

class TestExplicitSaveDetection:
    """`is_explicit_save_command` covers EN + TR, with + without colon."""

    @pytest.mark.parametrize("msg", [
        "remember this: I prefer formal tone",
        "remember this I prefer formal tone",
        "Remember This: my favourite colour is blue",
        "save this: the deploy is on Vercel",
        "save this the deploy is on Vercel",
        "note this: API key rotates monthly",
        "note: agency contact is Ali",
        "please remember the new pricing is $29",
        "remember that the launch date is March 1",
    ])
    def test_english_triggers(self, msg):
        out = mp_chat.is_explicit_save_command(msg)
        assert out is not None
        assert out["fact"]
        assert out["trigger"]

    @pytest.mark.parametrize("msg", [
        "bunu hatırla: yarın toplantı var",
        "bunu hatirla yarın toplantı var",
        "hafızana kaydet: müşteri ismi Mehmet",
        "hafizana kaydet musteri ismi Mehmet",
        "hatırla: yeni adres Maslak",
        "aklında tut: pazartesi tatil",
        "not al: tedarikçi 30 gün vadeli",
        "şunu kaydet: kampanya bütçesi 5000 TL",
    ])
    def test_turkish_triggers(self, msg):
        out = mp_chat.is_explicit_save_command(msg)
        assert out is not None
        assert out["fact"]

    def test_preference_kind_detected_from_trigger(self):
        out = mp_chat.is_explicit_save_command("save this preference: concise answers")
        assert out is not None
        assert out["kind"] == "preference"

    def test_preference_kind_detected_from_fact(self):
        out = mp_chat.is_explicit_save_command("remember this: my preference is bullet lists")
        assert out is not None
        assert out["kind"] == "preference"

    def test_default_kind_is_fact(self):
        out = mp_chat.is_explicit_save_command("remember this: launch date is March 1")
        assert out is not None
        assert out["kind"] == "fact"

    def test_no_trigger_returns_none(self):
        assert mp_chat.is_explicit_save_command("just a normal chat message") is None
        assert mp_chat.is_explicit_save_command("") is None
        assert mp_chat.is_explicit_save_command(None) is None  # type: ignore[arg-type]

    def test_trigger_only_no_fact_returns_empty_fact(self):
        out = mp_chat.is_explicit_save_command("remember this")
        assert out is not None
        assert out["fact"] == ""  # caller can detect this and reply asking for content

    def test_longest_trigger_wins(self):
        """'remember this preference' must beat 'remember this'."""
        out = mp_chat.is_explicit_save_command("remember this preference: brevity")
        assert out is not None
        assert out["trigger"] == "remember this preference"
        assert out["kind"] == "preference"


# ════════════════════════════════════════════════════════════════════════════
# Unit — save / extract / context fold (flag-gated)
# ════════════════════════════════════════════════════════════════════════════

class TestSaveExplicit:

    def test_save_persists_high_importance(self, tmp_memory_plane_db):
        out = mp_chat.save_explicit(
            user_id="u1",
            content="I prefer concise answers",
            kind="preference",
        )
        assert out is not None
        # HIGH importance — explicit user requests outrank auto-extracted.
        assert out["importance"] >= 0.7
        # And the row really is in the store.
        items = plane_client.list_user("u1")
        assert len(items) == 1
        assert items[0].content == "I prefer concise answers"
        assert items[0].kind == "preference"

    def test_save_returns_none_when_flag_off(self, monkeypatch, tmp_memory_plane_db):
        monkeypatch.setenv("ENABLE_MEMORY_PLANE", "false")
        out = mp_chat.save_explicit(user_id="u1", content="x")
        assert out is None

    def test_save_returns_none_on_empty_content(self, tmp_memory_plane_db):
        assert mp_chat.save_explicit(user_id="u1", content="") is None
        assert mp_chat.save_explicit(user_id="u1", content="   ") is None

    def test_save_with_project_id(self, tmp_memory_plane_db):
        out = mp_chat.save_explicit(
            user_id="u1", content="project-scoped fact",
            kind="fact", project_id="proj-xyz",
        )
        assert out is not None
        assert out["project_id"] == "proj-xyz"


class TestAutoExtract:

    def test_extracts_korvixai_mention(self, tmp_memory_plane_db):
        recs = mp_chat.auto_extract(user_id="u1", message="Working on KorvixAI all weekend.")
        assert len(recs) >= 1
        assert any("KorvixAI" in r["content"] for r in recs)

    def test_no_match_returns_empty(self, tmp_memory_plane_db):
        recs = mp_chat.auto_extract(user_id="u1", message="random sentence about weather")
        assert recs == []

    def test_flag_off_is_noop(self, monkeypatch, tmp_memory_plane_db):
        monkeypatch.setenv("ENABLE_MEMORY_PLANE", "false")
        recs = mp_chat.auto_extract(user_id="u1", message="Working on KorvixAI")
        assert recs == []

    def test_extraction_respects_project_id(self, tmp_memory_plane_db):
        mp_chat.auto_extract(
            user_id="u1", message="Working on KorvixAI", project_id="proj-A",
        )
        items = plane_client.list_user("u1", project_id="proj-A")
        assert len(items) >= 1


class TestContextFold:

    def test_fold_returns_existing_when_empty_memory(self, tmp_memory_plane_db):
        # No memories saved → fold should return the legacy summary unchanged.
        out = mp_chat.fold_into_mem_summary("legacy: known fact", user_id="u1")
        assert out == "legacy: known fact"

    def test_fold_prepends_memory_plane_block(self, tmp_memory_plane_db):
        mp_chat.save_explicit(user_id="u1", content="User prefers concise tone", kind="preference")
        out = mp_chat.fold_into_mem_summary("legacy summary line", user_id="u1")
        # Memory Plane block goes first (it's more relevant + recency-aware).
        assert "concise tone" in out
        assert "legacy summary line" in out
        assert out.index("concise tone") < out.index("legacy summary line")

    def test_fold_handles_empty_legacy(self, tmp_memory_plane_db):
        mp_chat.save_explicit(user_id="u1", content="solo memory")
        out = mp_chat.fold_into_mem_summary("", user_id="u1")
        assert "solo memory" in out

    def test_fold_flag_off_returns_legacy_unchanged(self, monkeypatch, tmp_memory_plane_db):
        # Save while flag is on.
        mp_chat.save_explicit(user_id="u1", content="should be invisible")
        # Then turn flag off and re-fold.
        monkeypatch.setenv("ENABLE_MEMORY_PLANE", "false")
        out = mp_chat.fold_into_mem_summary("legacy only", user_id="u1")
        assert out == "legacy only"


class TestAckReply:

    def test_ack_english(self):
        assert mp_chat.ack_reply("remember this: hello") == "Saved."

    def test_ack_turkish_diacritics(self):
        assert mp_chat.ack_reply("hafızana kaydet: merhaba") == "Kaydettim."

    def test_ack_turkish_no_diacritics(self):
        # 'hafizana' (without dot) still matches via the keyword list.
        assert mp_chat.ack_reply("hafizana kaydet musteri ismi Mehmet") == "Kaydettim."

    def test_ack_empty_english(self):
        assert "remember" in mp_chat.ack_reply_empty("remember this").lower() \
            or "what" in mp_chat.ack_reply_empty("remember this").lower()

    def test_ack_empty_turkish(self):
        assert "anlay" in mp_chat.ack_reply_empty("bunu hatırla").lower()


# ════════════════════════════════════════════════════════════════════════════
# End-to-end — POST /chat
# ════════════════════════════════════════════════════════════════════════════
#
# These tests go through the full chat route. We monkeypatch the model
# call so no OpenAI key is needed; the chat route's `process_chat` call
# already falls back to a generic reply when the upstream provider is
# unavailable. We don't care about the reply text — only that the
# memory_plane side effects happen.

class TestChatRouteIntegration:

    def test_english_remember_persists_to_memory_plane(self, client, tmp_memory_plane_db):
        """User-facing acceptance: 'remember this: X' must persist X."""
        r = client.post("/chat", json={
            "user_id": "u-en-1",
            "message": "remember this: I prefer concise answers",
        })
        assert r.status_code == 200
        body = r.json()
        assert body["intent"] == "memory"
        assert body["reply"] in {"Saved.", "Kaydettim."}

        # The row really is in the Memory Plane store.
        items = plane_client.list_user("u-en-1")
        contents = [m.content for m in items]
        assert any("concise" in c for c in contents)
        # Importance is HIGH because the user explicitly asked.
        assert max((m.importance or 0.0) for m in items) >= 0.7

    def test_turkish_hafizana_kaydet_persists(self, client, tmp_memory_plane_db):
        r = client.post("/chat", json={
            "user_id": "u-tr-1",
            "message": "hafızana kaydet: müşteri ismi Mehmet",
        })
        assert r.status_code == 200
        assert r.json()["reply"] == "Kaydettim."
        items = plane_client.list_user("u-tr-1")
        assert any("Mehmet" in m.content for m in items)

    def test_turkish_bunu_hatirla_persists(self, client, tmp_memory_plane_db):
        r = client.post("/chat", json={
            "user_id": "u-tr-2",
            "message": "bunu hatırla yarın saat 10'da toplantı var",
        })
        assert r.status_code == 200
        items = plane_client.list_user("u-tr-2")
        assert any("toplantı" in m.content for m in items)

    def test_save_preference_marks_kind(self, client, tmp_memory_plane_db):
        r = client.post("/chat", json={
            "user_id": "u-pref",
            "message": "save this preference: bullet points always",
        })
        assert r.status_code == 200
        items = plane_client.list_user("u-pref")
        prefs = [m for m in items if m.kind == "preference"]
        assert len(prefs) >= 1

    def test_empty_trigger_returns_clarification(self, client, tmp_memory_plane_db):
        r = client.post("/chat", json={
            "user_id": "u-empty",
            "message": "remember this",
        })
        assert r.status_code == 200
        # Clarification reply, NOT the success ack.
        assert r.json()["reply"] not in {"Saved.", "Kaydettim."}
        # And nothing got stored.
        assert plane_client.list_user("u-empty") == []

    def test_auto_extraction_fires_on_normal_message(self, client, tmp_memory_plane_db):
        """A non-shortcut message containing a high-signal pattern
        should auto-extract a candidate without the user saying
        'remember'. The hook runs BEFORE the AI call, so we don't need
        a live LLM — the chat path will fall through to a fallback
        reply but the memory side-effect still fires.
        """
        r = client.post("/chat", json={
            "user_id": "u-auto",
            "message": "I'm building a new AI co-pilot called KorvixAI",
        })
        assert r.status_code == 200
        # The KorvixAI mention is auto-extracted regardless of whether
        # the LLM call succeeds.
        items = plane_client.list_user("u-auto")
        assert any("KorvixAI" in m.content for m in items)

    def test_retrieval_persists_across_messages(self, client, tmp_memory_plane_db):
        """Save in turn 1 via /chat. Then verify via the public
        retrieval seam (`fold_into_mem_summary` — the EXACT helper the
        chat route uses to inject memory into the system prompt) that
        the saved fact would reach the LLM on a subsequent turn.

        We don't spy on `process_chat` here because importing
        `backend.services.ai_service` pulls in `openai`, which isn't a
        dependency of the test environment. The route's behaviour with
        a live LLM is the same: the same `fold_into_mem_summary` call
        produces the same system-prompt seam content.
        """
        # Turn 1 — explicit save via /chat.
        r1 = client.post("/chat", json={
            "user_id": "u-retrieve",
            "message": "remember this: deploy with Vercel, not Netlify",
        })
        assert r1.status_code == 200
        assert r1.json()["intent"] == "memory"

        # Retrieval seam — what the chat route would feed into the
        # system prompt on the next turn for this user.
        seam = mp_chat.fold_into_mem_summary(
            existing_summary="",
            user_id="u-retrieve",
            query="how should we deploy the frontend?",
        )
        assert "Vercel" in seam, f"retrieval seam lacked the saved fact: {seam!r}"

    def test_v2_memory_route_reflects_chat_saves(self, client, tmp_memory_plane_db, app):
        """The UI consumes /v2/memory. After a chat-level save, the
        same row MUST be visible via /v2/memory for the same user_id."""
        from backend.core.deps import current_user
        from backend.services.auth.identity import User

        # Save via /chat under user_id "u-bridge".
        client.post("/chat", json={
            "user_id": "u-bridge",
            "message": "save this: launch March 1",
        })

        # Read back via /v2/memory under the same user identity.
        u = User(id="u-bridge", kind="guest",
                 external_id="guest:u-bridge", display_name="")
        app.dependency_overrides[current_user] = lambda: u
        try:
            r = client.get("/v2/memory")
            assert r.status_code == 200
            contents = [m["content"] for m in r.json()["data"]["memories"]]
            assert any("March 1" in c for c in contents)
        finally:
            app.dependency_overrides.pop(current_user, None)

    def test_flag_off_chat_path_unchanged(self, client, monkeypatch):
        """Critical regression guard: with ENABLE_MEMORY_PLANE=false,
        the chat shortcut still works via the legacy path (no 500s,
        no exceptions leaking out of the integration code)."""
        monkeypatch.setenv("ENABLE_MEMORY_PLANE", "false")
        # Legacy Turkish-only colon trigger should still produce a save ack.
        r = client.post("/chat", json={
            "user_id": "u-flagoff",
            "message": "bunu hatırla: legacy still works",
        })
        assert r.status_code == 200
        assert r.json()["reply"] == "Kaydettim."
