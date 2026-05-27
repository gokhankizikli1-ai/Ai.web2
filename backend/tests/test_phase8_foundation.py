# coding: utf-8
"""
Phase 8 — Unified AI OS Foundation tests.

Covers the seven subsystems at the SERVICE-CLIENT layer (the public
chokepoint each route calls). Going through the client tests the
flag-gating + ownership + JSON-encoding + dedup logic in one shot
and stays independent of FastAPI's multipart dep (python-multipart
is required by the /v2/assets/upload route but not by the client).

Per-subsystem coverage:
  Assets       upload + list + get + delete + cross-user 404 + flag-off
               + MIME validation + size cap + executable block
  Vision       analyzer dispatch (image / pdf-stub / document / video)
               + cache write/read + flag-off
  Project Brain aggregator empty + populated; build_context output
  Workflows    create / list / cancel + flag-off + type-allowlist
  Agent tasks  create / list / get / cross-user + flag-off
  Recreate     analyze on image asset; warnings when vision off
  Cross-cutting flag-off matrix (chat / memory / jobs untouched)
"""
from __future__ import annotations

import os

import pytest

# ════════════════════════════════════════════════════════════════════════════
# A) Asset System
# ════════════════════════════════════════════════════════════════════════════

# 1×1 transparent PNG (smallest valid PNG; ~70 bytes).
_PNG_BYTES = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\x00"
    b"\x01\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
)


class TestAssets:

    def test_upload_round_trip(self, tmp_assets_db):
        from backend.services.assets import client as ac
        rec = ac.upload(user_id="u1", filename="hello.png",
                        mime_type="image/png", data=_PNG_BYTES)
        assert rec.id and rec.user_id == "u1"
        assert rec.asset_type == "image"
        assert rec.status == "uploaded"
        # The row really is in the store.
        got = ac.get(rec.id, user_id="u1")
        assert got is not None and got.filename == "hello.png"

    def test_upload_video_marked_processing_not_supported(self, tmp_assets_db):
        from backend.services.assets import client as ac
        rec = ac.upload(user_id="u1", filename="clip.mp4",
                        mime_type="video/mp4", data=b"\x00" * 64)
        assert rec.asset_type == "video"
        assert rec.metadata.get("processing_not_supported") is True
        # Video is "ready" — no analysis needed/supported in Phase 8.
        assert rec.status == "ready"

    def test_upload_blocked_executable(self, tmp_assets_db):
        from backend.services.assets import client as ac
        from backend.services.assets.errors import AssetValidationError
        with pytest.raises(AssetValidationError):
            ac.upload(user_id="u1", filename="virus.exe",
                      mime_type="application/x-msdownload",
                      data=b"MZ" + b"\x00" * 128)

    def test_upload_size_cap(self, tmp_assets_db, monkeypatch):
        monkeypatch.setenv("ASSETS_MAX_BYTES", "1024")
        from backend.services.assets import client as ac
        from backend.services.assets.errors import AssetValidationError
        with pytest.raises(AssetValidationError) as e:
            ac.upload(user_id="u1", filename="big.bin",
                      mime_type="application/octet-stream",
                      data=b"x" * 2048)
        assert e.value.code in {"ASSET_TOO_LARGE", "ASSET_UNSUPPORTED_TYPE"}

    def test_list_for_user_filter_by_project(self, tmp_assets_db):
        from backend.services.assets import client as ac
        a = ac.upload(user_id="u1", filename="a.png", mime_type="image/png",
                      data=_PNG_BYTES, project_id="p1")
        b = ac.upload(user_id="u1", filename="b.png", mime_type="image/png",
                      data=_PNG_BYTES + b"\x00", project_id="p2")
        only_p1 = ac.list_user("u1", project_id="p1")
        assert len(only_p1) == 1 and only_p1[0].id == a.id

    def test_cross_user_get_returns_none(self, tmp_assets_db):
        from backend.services.assets import client as ac
        rec = ac.upload(user_id="alice", filename="a.png",
                        mime_type="image/png", data=_PNG_BYTES)
        assert ac.get(rec.id, user_id="bob") is None
        assert ac.get(rec.id, user_id="alice") is not None

    def test_soft_delete(self, tmp_assets_db):
        from backend.services.assets import client as ac
        rec = ac.upload(user_id="u1", filename="bye.png",
                        mime_type="image/png", data=_PNG_BYTES)
        assert ac.delete(rec.id, user_id="u1") is True
        assert ac.get(rec.id, user_id="u1") is None

    def test_list_by_ids_ownership_check(self, tmp_assets_db):
        from backend.services.assets import client as ac
        a = ac.upload(user_id="alice", filename="a.png",
                      mime_type="image/png", data=_PNG_BYTES)
        b = ac.upload(user_id="bob", filename="b.png",
                      mime_type="image/png", data=_PNG_BYTES + b"\x00")
        # Bob asking for [a, b] only gets b (alice's row stays hidden).
        got = ac.list_by_ids("bob", [a.id, b.id])
        ids = {r.id for r in got}
        assert ids == {b.id}

    def test_flag_off_raises(self, monkeypatch, tmp_assets_db):
        monkeypatch.setenv("ENABLE_ASSET_SYSTEM", "false")
        from backend.services.assets import client as ac
        from backend.services.assets.errors import AssetSystemDisabled
        with pytest.raises(AssetSystemDisabled):
            ac.upload(user_id="u1", filename="x.png",
                      mime_type="image/png", data=_PNG_BYTES)
        # Reads silently return empty when off.
        assert ac.list_user("u1") == []
        assert ac.get("anything") is None


# ════════════════════════════════════════════════════════════════════════════
# B) Vision pipeline
# ════════════════════════════════════════════════════════════════════════════

class TestVision:

    def test_image_analysis_metadata_only(self, tmp_assets_db, tmp_vision_db):
        from backend.services.assets import client as ac
        from backend.services.vision import client as vc
        rec = ac.upload(user_id="u1", filename="hello.png",
                        mime_type="image/png", data=_PNG_BYTES)
        result = vc.analyze(rec.id, user_id="u1")
        assert result is not None
        assert result.detected_type == "image"
        # HONEST output — summary mentions size, no hallucinated description.
        assert "hello.png" in result.summary

    def test_document_text_extraction(self, tmp_assets_db, tmp_vision_db):
        from backend.services.assets import client as ac
        from backend.services.vision import client as vc
        text = b"## Project Plan\n\nGoals:\n- Ship MVP\n"
        rec = ac.upload(user_id="u1", filename="plan.md",
                        mime_type="text/markdown", data=text)
        result = vc.analyze(rec.id, user_id="u1")
        assert result is not None
        assert "Project Plan" in (result.extracted_text or "")

    def test_video_analysis_returns_warning(self, tmp_assets_db, tmp_vision_db):
        from backend.services.assets import client as ac
        from backend.services.vision import client as vc
        rec = ac.upload(user_id="u1", filename="clip.mp4",
                        mime_type="video/mp4", data=b"\x00" * 64)
        result = vc.analyze(rec.id, user_id="u1")
        assert result is not None
        assert result.warnings and any(
            "Video" in w or "video" in w for w in result.warnings
        )

    def test_analysis_cached(self, tmp_assets_db, tmp_vision_db):
        from backend.services.assets import client as ac
        from backend.services.vision import client as vc
        rec = ac.upload(user_id="u1", filename="x.png",
                        mime_type="image/png", data=_PNG_BYTES)
        first = vc.analyze(rec.id, user_id="u1")
        cached = vc.get_cached(rec.id)
        assert first is not None and cached is not None
        assert cached["asset_id"] == rec.id

    def test_vision_disabled_returns_none(
        self, monkeypatch, tmp_assets_db, tmp_vision_db,
    ):
        monkeypatch.setenv("ENABLE_VISION_PIPELINE", "false")
        from backend.services.assets import client as ac
        from backend.services.vision import client as vc
        rec = ac.upload(user_id="u1", filename="x.png",
                        mime_type="image/png", data=_PNG_BYTES)
        assert vc.analyze(rec.id, user_id="u1") is None


# ════════════════════════════════════════════════════════════════════════════
# C) Project Brain
# ════════════════════════════════════════════════════════════════════════════

class TestProjectBrain:

    def test_disabled_returns_none(self, monkeypatch):
        monkeypatch.setenv("ENABLE_PROJECT_BRAIN", "false")
        from backend.services.project_brain import client as pb
        assert pb.get("u1", "p1") is None
        assert pb.build_context("u1", "p1") is None

    def test_empty_project_returns_empty_brain(self, monkeypatch):
        monkeypatch.setenv("ENABLE_PROJECT_BRAIN", "true")
        from backend.services.project_brain import client as pb
        brain = pb.get("u-fresh", "p-empty")
        assert brain is not None
        assert brain.project_id == "p-empty"
        assert brain.current_goals == []
        assert brain.linked_assets == []

    def test_populated_brain_pulls_from_subsystems(
        self, monkeypatch, tmp_assets_db, tmp_workflows_db,
        tmp_agent_tasks_db, tmp_memory_plane_db,
    ):
        monkeypatch.setenv("ENABLE_PROJECT_BRAIN", "true")
        # Seed: a goal memory, an asset, a workflow, an agent task.
        from backend.services.memory_plane import client as mp
        from backend.services.assets import client as ac
        from backend.services.workflows import client as wf
        from backend.services.agent_tasks import client as at

        mp.create(user_id="u1", content="Ship MVP by Q3",
                  kind="goal", project_id="p1", importance=0.9)
        mp.create(user_id="u1", content="We picked Vercel",
                  kind="decision", project_id="p1", importance=0.8)
        ac.upload(user_id="u1", filename="design.png",
                  mime_type="image/png", data=_PNG_BYTES,
                  project_id="p1")
        wf.create(user_id="u1", type="research", project_id="p1")
        at.create(user_id="u1", assigned_agent_id="ag-1",
                  task_description="research market size",
                  project_id="p1", summary="Market sizing notes")

        from backend.services.project_brain import client as pb
        brain = pb.get("u1", "p1")
        assert brain is not None
        assert any("MVP" in g for g in brain.current_goals)
        assert any("Vercel" in d for d in brain.recent_decisions)
        assert any(a["filename"] == "design.png" for a in brain.linked_assets)
        assert len(brain.workflow_state) == 1
        assert any("Market" in n for n in brain.agent_notes)

        # build_context produces a non-empty prompt block.
        block = pb.build_context("u1", "p1")
        assert block is not None
        assert "MVP" in block.text and "Vercel" in block.text
        assert "design.png" in block.text


# ════════════════════════════════════════════════════════════════════════════
# D) Workflows
# ════════════════════════════════════════════════════════════════════════════

class TestWorkflows:

    def test_create_default_steps(self, tmp_workflows_db):
        from backend.services.workflows import client as wf
        rec = wf.create(user_id="u1", type="research", project_id="p1")
        assert rec is not None
        assert rec.type == "research"
        # Default steps come from the registry template.
        assert len(rec.steps) >= 3

    def test_unknown_type_normalized_to_research(self, tmp_workflows_db):
        from backend.services.workflows import client as wf
        rec = wf.create(user_id="u1", type="not-a-type")
        assert rec is not None and rec.type == "research"

    def test_list_user(self, tmp_workflows_db):
        from backend.services.workflows import client as wf
        wf.create(user_id="u1", type="research", project_id="p1")
        wf.create(user_id="u1", type="ecommerce", project_id="p1")
        wf.create(user_id="u2", type="research", project_id="p1")
        u1 = wf.list_user("u1", project_id="p1")
        assert len(u1) == 2

    def test_cancel(self, tmp_workflows_db):
        from backend.services.workflows import client as wf
        rec = wf.create(user_id="u1", type="research")
        out = wf.cancel(rec.id, user_id="u1")
        assert out is not None and out.status == "cancelled"

    def test_cancel_cross_user_returns_none(self, tmp_workflows_db):
        from backend.services.workflows import client as wf
        rec = wf.create(user_id="alice", type="research")
        assert wf.cancel(rec.id, user_id="bob") is None

    def test_disabled_blocks_creation(self, monkeypatch):
        monkeypatch.setenv("ENABLE_WORKFLOWS", "false")
        from backend.services.workflows import client as wf
        assert wf.create(user_id="u1", type="research") is None
        assert wf.list_user("u1") == []


# ════════════════════════════════════════════════════════════════════════════
# E) Agent tasks
# ════════════════════════════════════════════════════════════════════════════

class TestAgentTasks:

    def test_create_and_get(self, tmp_agent_tasks_db):
        from backend.services.agent_tasks import client as at
        rec = at.create(user_id="u1", assigned_agent_id="ag-1",
                         task_description="analyze sales CSV")
        assert rec is not None
        got = at.get(rec.id, user_id="u1")
        assert got is not None and got.assigned_agent_id == "ag-1"

    def test_cross_user_get_returns_none(self, tmp_agent_tasks_db):
        from backend.services.agent_tasks import client as at
        rec = at.create(user_id="alice", assigned_agent_id="ag-1",
                         task_description="x")
        assert at.get(rec.id, user_id="bob") is None

    def test_list_filter_by_agent(self, tmp_agent_tasks_db):
        from backend.services.agent_tasks import client as at
        at.create(user_id="u1", assigned_agent_id="ag-A", task_description="a")
        at.create(user_id="u1", assigned_agent_id="ag-B", task_description="b")
        only_a = at.list_user("u1", assigned_agent_id="ag-A")
        assert len(only_a) == 1 and only_a[0].assigned_agent_id == "ag-A"

    def test_disabled_blocks(self, monkeypatch):
        monkeypatch.setenv("ENABLE_AGENT_ORCHESTRATION", "false")
        from backend.services.agent_tasks import client as at
        assert at.create(user_id="u1", assigned_agent_id="ag-1",
                          task_description="x") is None


# ════════════════════════════════════════════════════════════════════════════
# F) Website recreation
# ════════════════════════════════════════════════════════════════════════════

class TestRecreation:

    def test_analyze_image_returns_structured_plan(
        self, monkeypatch, tmp_assets_db, tmp_vision_db,
    ):
        monkeypatch.setenv("ENABLE_WEBSITE_RECREATION", "true")
        from backend.services.assets import client as ac
        from backend.services.website_recreation import client as rc
        rec = ac.upload(user_id="u1", filename="design.png",
                        mime_type="image/png", data=_PNG_BYTES)
        result = rc.analyze(asset_id=rec.id, user_id="u1",
                            user_prompt="A modern SaaS landing page")
        assert result is not None
        assert result.sections           # has at least default sections
        assert result.responsive_notes
        assert result.recommended_tech_stack
        # The generated prompt mentions the user intent verbatim.
        assert "modern SaaS landing page" in result.generated_prompt_for_frontend_agent

    def test_analyze_non_image_returns_warning(
        self, monkeypatch, tmp_assets_db, tmp_vision_db,
    ):
        monkeypatch.setenv("ENABLE_WEBSITE_RECREATION", "true")
        from backend.services.assets import client as ac
        from backend.services.website_recreation import client as rc
        rec = ac.upload(user_id="u1", filename="data.csv",
                        mime_type="text/csv", data=b"a,b\n1,2\n")
        result = rc.analyze(asset_id=rec.id, user_id="u1")
        assert result is not None
        assert result.warnings

    def test_disabled_returns_none(self, monkeypatch, tmp_assets_db):
        monkeypatch.setenv("ENABLE_WEBSITE_RECREATION", "false")
        from backend.services.website_recreation import client as rc
        assert rc.analyze(asset_id="x", user_id="u1") is None


# ════════════════════════════════════════════════════════════════════════════
# G) Cross-cutting — chat / memory / jobs UNCHANGED when Phase 8 flags off
# ════════════════════════════════════════════════════════════════════════════

class TestExistingSystemsUntouched:

    def test_chat_route_still_200_with_phase8_off(self, client, monkeypatch):
        """Critical regression guard: chat must work with all Phase 8
        flags off (which is the default)."""
        for f in (
            "ENABLE_ASSET_SYSTEM", "ENABLE_VISION_PIPELINE",
            "ENABLE_PROJECT_BRAIN", "ENABLE_AGENT_ORCHESTRATION",
            "ENABLE_WORKFLOWS", "ENABLE_WEBSITE_RECREATION",
        ):
            monkeypatch.setenv(f, "false")
        r = client.post("/chat", json={"user_id": "u-phase8-off",
                                       "message": "hello"})
        assert r.status_code == 200

    def test_memory_routes_still_503_when_only_phase8_flags_off(
        self, client, monkeypatch,
    ):
        """Phase 6 contract is unchanged by Phase 8 — memory routes
        still return their own 503 when ENABLE_MEMORY_PLANE is off."""
        monkeypatch.setenv("ENABLE_MEMORY_PLANE", "false")
        r = client.post("/v2/memory", json={"content": "x"})
        assert r.status_code == 503
        assert r.json()["detail"]["code"] == "MEMORY_PLANE_DISABLED"

    def test_jobs_routes_still_503_when_only_phase8_flags_off(
        self, client, monkeypatch,
    ):
        monkeypatch.setenv("ENABLE_JOB_QUEUE", "false")
        r = client.post("/v2/jobs", json={"kind": "echo"})
        assert r.status_code == 503
        assert r.json()["detail"]["code"] == "JOB_QUEUE_DISABLED"
