# coding: utf-8
"""
Phase 9 — chat-asset integration + orchestration activity tests.

Covers the two new backend behaviours shipped in this PR:

  A) /v2/chat/stream — when the body carries `asset_ids`, the route
     fetches each asset (ownership-checked), reads the cached vision
     analysis when present, folds a compact asset-context block into
     the system prompt BEFORE the LLM call. Disabled-asset-system
     gracefully skips without breaking the stream.

  B) /v2/orchestration/activity — read-only aggregator merging recent
     jobs + workflows + agent_tasks into a single time-ordered feed.
     Empty when all subsystems are off (never 503).
"""
from __future__ import annotations

from typing import AsyncIterator

import pytest

from backend.services.providers.streaming import (
    ProviderStreamStart, ProviderStreamToken, ProviderStreamDone,
)


# ── Fake provider that captures the ProviderRequest ─────────────────────────

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
        # Phase 9 vision — the default fake provider is text-only so
        # the route's "model doesn't support vision" path is the one
        # exercised by tests that don't override the fixture.
        supports_vision = False
        vision_models = ()

        def model_supports_vision(self, _model):
            return False

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


# 1×1 PNG so the asset-upload path produces a real "image" asset_type.
_PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\x00"
    b"\x01\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
)


# ════════════════════════════════════════════════════════════════════════════
# A) Asset-aware chat
# ════════════════════════════════════════════════════════════════════════════

class TestChatAssetInjection:

    def test_asset_summary_folded_into_system_prompt(
        self, client, tmp_assets_db, tmp_memory_plane_db, fake_provider,
    ):
        """Upload an asset via the client (not multipart so we don't
        need python-multipart in the test env), then POST to /v2/chat/stream
        with the asset_id. The provider's last system message must
        contain the asset summary."""
        from backend.services.assets import client as ac
        rec = ac.upload(user_id="u-asset-chat", filename="design.png",
                        mime_type="image/png", data=_PNG)
        r = client.post("/v2/chat/stream", json={
            "user_id": "u-asset-chat",
            "messages": [{"role": "user", "content": "What's in this design?"}],
            "asset_ids": [rec.id],
        })
        assert r.status_code == 200
        assert len(fake_provider.requests) == 1
        sp = fake_provider.last_system
        # Asset block carries filename, mime, size — and is anchored
        # by the dedicated header.
        assert "Attached assets" in sp
        assert "design.png" in sp

    def test_multiple_assets_all_folded(
        self, client, tmp_assets_db, tmp_memory_plane_db, fake_provider,
    ):
        from backend.services.assets import client as ac
        a = ac.upload(user_id="u-many", filename="a.png",
                      mime_type="image/png", data=_PNG)
        b = ac.upload(user_id="u-many", filename="b.png",
                      mime_type="image/png", data=_PNG + b"\x00")
        r = client.post("/v2/chat/stream", json={
            "user_id": "u-many",
            "messages": [{"role": "user", "content": "compare these"}],
            "asset_ids": [a.id, b.id],
        })
        assert r.status_code == 200
        sp = fake_provider.last_system
        assert "a.png" in sp and "b.png" in sp

    def test_cross_user_asset_ignored(
        self, client, tmp_assets_db, tmp_memory_plane_db, fake_provider,
    ):
        """Bob can't see Alice's asset via the chat path — the
        list_by_ids ownership check drops Alice's row before the
        system prompt is built."""
        from backend.services.assets import client as ac
        alice_asset = ac.upload(user_id="alice", filename="secret.png",
                                mime_type="image/png", data=_PNG)
        r = client.post("/v2/chat/stream", json={
            "user_id": "bob",
            "messages": [{"role": "user", "content": "what's that?"}],
            "asset_ids": [alice_asset.id],
        })
        assert r.status_code == 200
        sp = fake_provider.last_system
        assert "secret.png" not in sp
        # And no asset block at all when nothing resolved.
        assert "Attached assets" not in sp

    def test_asset_system_disabled_chat_still_works(
        self, client, monkeypatch, tmp_memory_plane_db, fake_provider,
    ):
        """With ENABLE_ASSET_SYSTEM=false the chat path silently
        ignores asset_ids and streams normally — no 503, no broken
        prompt."""
        monkeypatch.setenv("ENABLE_ASSET_SYSTEM", "false")
        r = client.post("/v2/chat/stream", json={
            "user_id": "u-off",
            "messages": [{"role": "user", "content": "hi"}],
            "asset_ids": ["does-not-matter"],
        })
        assert r.status_code == 200
        assert len(fake_provider.requests) == 1
        # No asset block since assets are off.
        assert "Attached assets" not in fake_provider.last_system

    def test_video_asset_surfaces_processing_warning(
        self, client, tmp_assets_db, tmp_memory_plane_db, fake_provider,
    ):
        """Video uploads get `processing_not_supported` metadata. The
        asset block must carry an honest note instead of pretending
        we understood the video frames."""
        from backend.services.assets import client as ac
        v = ac.upload(user_id="u-vid", filename="clip.mp4",
                      mime_type="video/mp4", data=b"\x00" * 256)
        r = client.post("/v2/chat/stream", json={
            "user_id": "u-vid",
            "messages": [{"role": "user", "content": "what's in this?"}],
            "asset_ids": [v.id],
        })
        assert r.status_code == 200
        sp = fake_provider.last_system
        assert "clip.mp4" in sp
        assert "not supported" in sp.lower() or "frame" in sp.lower()


    # ── Phase 9 vision pipeline ────────────────────────────────────────

    def test_vision_capable_provider_gets_multimodal_user_content(
        self, client, tmp_assets_db, tmp_memory_plane_db, monkeypatch,
    ):
        """Vision-capable model + image asset ⇒ the user message's
        content arrives at the provider as a LIST of content blocks
        ([text, image_url]) — the actual image bytes are inlined as a
        base64 data URL, not just described in the system prompt."""
        captured = _CapturedRequests()

        class _VisionProvider:
            name = "openai"
            default_model = "gpt-4o-mini"
            supports_streaming = True
            supports_vision = True
            vision_models = ("gpt-4o",)

            def model_supports_vision(self, model):
                m = (model or self.default_model).lower()
                return any(m.startswith(p) for p in self.vision_models)

            async def stream_chat_completion(self, req):
                captured.requests.append(req)
                yield ProviderStreamStart(provider=self.name, model=req.model)
                yield ProviderStreamToken(delta="ok")
                yield ProviderStreamDone(
                    finish_reason="stop", model=req.model,
                    usage=type("U", (), {"prompt_tokens": 1,
                                         "completion_tokens": 1,
                                         "total_tokens": 2})(),
                )

        from backend.routes import v2_chat_stream as stream_route
        monkeypatch.setattr(stream_route, "get_provider", lambda _n: _VisionProvider())

        from backend.services.assets import client as ac
        rec = ac.upload(user_id="u-vision", filename="design.png",
                        mime_type="image/png", data=_PNG)
        r = client.post("/v2/chat/stream", json={
            "user_id": "u-vision",
            "messages": [{"role": "user", "content": "describe this"}],
            "asset_ids": [rec.id],
        })
        assert r.status_code == 200

        # User message content is now a LIST of blocks, not a string.
        last_user = next(
            (m for m in reversed(captured.last_messages) if m.role == "user"),
            None,
        )
        assert last_user is not None, "no user message reached the provider"
        assert isinstance(last_user.content, list), (
            f"expected multimodal list, got {type(last_user.content)}: "
            f"{last_user.content!r}"
        )
        # First block carries the caption text.
        assert last_user.content[0]["type"] == "text"
        assert last_user.content[0]["text"] == "describe this"
        # Subsequent blocks are image_url (OpenAI shape) with a base64
        # data URL referencing the uploaded PNG.
        image_blocks = [b for b in last_user.content if b.get("type") == "image_url"]
        assert len(image_blocks) == 1
        url = image_blocks[0]["image_url"]["url"]
        assert url.startswith("data:image/png;base64,")

    def test_vision_incapable_model_emits_warning(
        self, client, tmp_assets_db, tmp_memory_plane_db, fake_provider,
    ):
        """If the configured model isn't in the provider's vision list
        AND the user attached an image, the route emits an SSE
        `warning` frame so the UI can render
        'This model does not support image analysis.' The token stream
        still completes — warnings are non-fatal."""
        from backend.services.assets import client as ac
        rec = ac.upload(user_id="u-no-vision", filename="design.png",
                        mime_type="image/png", data=_PNG)
        r = client.post("/v2/chat/stream", json={
            "user_id": "u-no-vision",
            "messages": [{"role": "user", "content": "describe"}],
            "asset_ids": [rec.id],
        })
        assert r.status_code == 200
        body = r.text
        assert "event: warning" in body
        assert "VISION_UNAVAILABLE" in body
        # And the stream still produced tokens + done — warning is
        # non-fatal.
        assert "event: token" in body
        assert "event: done" in body

    def test_vision_warning_skipped_when_only_non_image_assets(
        self, client, tmp_assets_db, tmp_memory_plane_db, fake_provider,
    ):
        """A PDF attachment on a non-vision model should NOT trigger
        the 'image analysis' warning — only images need vision."""
        from backend.services.assets import client as ac
        # 4-byte stub PDF — uploader doesn't validate the magic bytes,
        # only the MIME type.
        rec = ac.upload(user_id="u-pdf", filename="notes.pdf",
                        mime_type="application/pdf", data=b"%PDF")
        r = client.post("/v2/chat/stream", json={
            "user_id": "u-pdf",
            "messages": [{"role": "user", "content": "summarise"}],
            "asset_ids": [rec.id],
        })
        assert r.status_code == 200
        assert "event: warning" not in r.text
        assert "VISION_UNAVAILABLE" not in r.text


# ════════════════════════════════════════════════════════════════════════════
# B) /v2/orchestration/activity aggregator
# ════════════════════════════════════════════════════════════════════════════

class TestOrchestrationActivity:

    def test_all_subsystems_off_returns_empty(self, client, monkeypatch, app):
        """When jobs / workflows / agent_orchestration are all off,
        the aggregator returns an empty list — never 503. The FE
        falls back to its demo display."""
        for f in ("ENABLE_JOB_QUEUE", "ENABLE_WORKFLOWS",
                  "ENABLE_AGENT_ORCHESTRATION"):
            monkeypatch.setenv(f, "false")
        from backend.core.deps import current_user
        from backend.services.auth.identity import User
        u = User(id="u-empty", kind="guest",
                 external_id="guest:u-empty", display_name="")
        app.dependency_overrides[current_user] = lambda: u
        try:
            r = client.get("/v2/orchestration/activity")
            assert r.status_code == 200
            assert r.json()["data"]["activity"] == []
            assert r.json()["metadata"]["active_count"] == 0
            assert r.json()["metadata"]["sources"] == {
                "jobs": 0, "workflows": 0, "agent_tasks": 0,
            }
        finally:
            app.dependency_overrides.pop(current_user, None)

    def test_workflows_merge_into_activity(
        self, client, tmp_workflows_db, app,
    ):
        """Create two workflows; the aggregator returns them as
        rows with the canonical AIActivity shape (status one of
        active/completed/queued)."""
        from backend.core.deps import current_user
        from backend.services.auth.identity import User
        from backend.services.workflows import client as wfc
        u = User(id="u-wf", kind="guest",
                 external_id="guest:u-wf", display_name="")
        app.dependency_overrides[current_user] = lambda: u
        try:
            wfc.create(user_id="u-wf", type="research", project_id="p1")
            wfc.create(user_id="u-wf", type="ecommerce", project_id="p1")
            r = client.get("/v2/orchestration/activity").json()
            assert r["metadata"]["sources"]["workflows"] == 2
            assert len(r["data"]["activity"]) == 2
            assert all(row["source"] == "workflow" for row in r["data"]["activity"])
            # Status from `queued` (workflow default) maps to "queued"
            # in the AIActivity vocab.
            assert all(row["status"] == "queued" for row in r["data"]["activity"])
        finally:
            app.dependency_overrides.pop(current_user, None)

    def test_jobs_workflows_tasks_combined(
        self, client, tmp_jobs_db, tmp_workflows_db, tmp_agent_tasks_db, app,
    ):
        """All three subsystems present → one merged time-ordered feed."""
        from backend.core.deps import current_user
        from backend.services.auth.identity import User
        from backend.services.workflows import client as wfc
        from backend.services.agent_tasks import client as atc
        u = User(id="u-mix", kind="guest",
                 external_id="guest:u-mix", display_name="")
        app.dependency_overrides[current_user] = lambda: u
        try:
            # Use the lower-level store for jobs to avoid needing an
            # asyncio event loop for the runner.
            from backend.services.jobs import store as jstore
            from backend.services.jobs.types import JobRecord
            jstore.insert(JobRecord(
                kind="echo", user_id="u-mix", payload={"x": 1},
            ))
            wfc.create(user_id="u-mix", type="research")
            atc.create(
                user_id="u-mix", assigned_agent_id="agent-A",
                task_description="analyze the market briefly",
            )
            r = client.get("/v2/orchestration/activity").json()
            sources = r["metadata"]["sources"]
            assert sources["jobs"]        == 1
            assert sources["workflows"]   == 1
            assert sources["agent_tasks"] == 1
            assert len(r["data"]["activity"]) == 3
            # Each carries its `source` discriminator.
            seen = {row["source"] for row in r["data"]["activity"]}
            assert seen == {"job", "workflow", "agent_task"}
        finally:
            app.dependency_overrides.pop(current_user, None)

    def test_cross_user_isolation(
        self, client, tmp_workflows_db, app,
    ):
        """Workflows belonging to Alice never surface in Bob's feed."""
        from backend.core.deps import current_user
        from backend.services.auth.identity import User
        from backend.services.workflows import client as wfc
        alice = User(id="alice", kind="guest", external_id="guest:alice",
                     display_name="")
        bob   = User(id="bob",   kind="guest", external_id="guest:bob",
                     display_name="")
        app.dependency_overrides[current_user] = lambda: alice
        try:
            wfc.create(user_id="alice", type="research")
            app.dependency_overrides[current_user] = lambda: bob
            r = client.get("/v2/orchestration/activity").json()
            assert r["data"]["activity"] == []
        finally:
            app.dependency_overrides.pop(current_user, None)

    def test_limit_param(
        self, client, tmp_workflows_db, app,
    ):
        from backend.core.deps import current_user
        from backend.services.auth.identity import User
        from backend.services.workflows import client as wfc
        u = User(id="u-lim", kind="guest", external_id="guest:u-lim",
                 display_name="")
        app.dependency_overrides[current_user] = lambda: u
        try:
            for _ in range(6):
                wfc.create(user_id="u-lim", type="research")
            r = client.get("/v2/orchestration/activity?limit=3").json()
            assert len(r["data"]["activity"]) == 3
            # The aggregator's metadata.sources still reports the
            # PER-SOURCE batch size (limit forwarded to each subsystem),
            # so 6 ≥ 3 won't be 3 — we just assert the truncation.
        finally:
            app.dependency_overrides.pop(current_user, None)
