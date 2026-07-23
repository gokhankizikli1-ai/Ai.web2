# coding: utf-8
"""
Tests — Web Build Path Audit (read-only architecture capability map).

Covers:
  1. flag disabled → unavailable, no runtime work;
  2. capability-map shape → stable version, known stages, valid statuses only;
  3. security → no prompts / source / secrets / API keys / user identifiers;
  4. gap consistency → every gap has code, severity and evidence;
  5. serialization → JSON-serializable + bounded;
  6. no generation mutation → the module makes no model/API call and imports nothing from
     the generation or prompt layers.

Pure + deterministic (static data; no LLM / network). The HTTP route is a thin owner-only,
flag-gated wrapper (needs FastAPI, not exercised here).
"""
from __future__ import annotations

import ast
import glob
import json

import pytest

from backend.services import web_build_path_audit as audit
from backend.services.web_build_path_audit.models import _VALID_SEVERITIES, _VALID_STATUSES


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    monkeypatch.delenv("ENABLE_WEB_BUILD_PATH_AUDIT", raising=False)
    yield


# ── 1. Flag disabled ──────────────────────────────────────────────────────────

def test_disabled_returns_none():
    assert audit.is_enabled() is False
    assert audit.build_path_audit() is None


def test_enabled_returns_map(monkeypatch):
    monkeypatch.setenv("ENABLE_WEB_BUILD_PATH_AUDIT", "true")
    assert audit.is_enabled() is True
    assert isinstance(audit.build_path_audit(), dict)


# ── 2. Capability-map shape ───────────────────────────────────────────────────

def test_stable_version_and_known_stages(monkeypatch):
    monkeypatch.setenv("ENABLE_WEB_BUILD_PATH_AUDIT", "true")
    d = audit.build_path_audit()
    assert d["version"] == "web-build-path-audit-v1"
    assert d["entry_path"] == "frontend-driven"
    names = {s["name"] for s in d["stages"]}
    assert {"planning", "frontend_generation", "visual_planning", "image_sourcing",
            "rendered_evaluation", "revision"} <= names


def test_only_valid_statuses(monkeypatch):
    monkeypatch.setenv("ENABLE_WEB_BUILD_PATH_AUDIT", "true")
    d = audit.build_path_audit()
    for stage in d["stages"]:
        for cap in stage["capabilities"]:
            assert cap["status"] in _VALID_STATUSES, cap
            assert cap["name"]


def test_key_findings_present(monkeypatch):
    monkeypatch.setenv("ENABLE_WEB_BUILD_PATH_AUDIT", "true")
    d = audit.build_path_audit()
    # The design-intelligence packages are MISSING on the frontend_generation stage.
    fg = next(s for s in d["stages"] if s["name"] == "frontend_generation")
    statuses = {c["name"]: c["status"] for c in fg["capabilities"]}
    assert statuses["design_personality"] == "missing"
    assert statuses["generation_adaptation"] == "missing"
    assert statuses["sourced_assets"] == "applied"
    # Static-only evaluation.
    ev = next(s for s in d["stages"] if s["name"] == "rendered_evaluation")
    assert ev["facts"]["screenshot_reviewed"] is False
    # Inconsistent image limits.
    img = next(s for s in d["stages"] if s["name"] == "image_sourcing")
    assert img["facts"]["frontend_limit"] == 8 and img["facts"]["backend_limit"] == 16
    assert img["facts"]["limits_consistent"] is False


# ── 3. Security ───────────────────────────────────────────────────────────────

def test_no_secrets_or_user_data(monkeypatch):
    monkeypatch.setenv("ENABLE_WEB_BUILD_PATH_AUDIT", "true")
    blob = json.dumps(audit.build_path_audit()).lower()
    for forbidden in ("sk-", "api_key", "apikey", "password", "bearer ", "secret=",
                      "user_id", "email", "openai_api", "-----begin", "lemon"):
        assert forbidden not in blob, forbidden


def test_formatter_redacts_secret_like_values():
    from backend.services.web_build_path_audit.formatter import format_audit

    class _Fake:
        def to_dict(self):
            return {"note": "token sk-ABCDEF0123456789", "ok": "just a normal note", "n": 3}

    out = format_audit(_Fake())
    assert out["note"] == "[redacted]" and out["ok"] == "just a normal note" and out["n"] == 3


# ── 4. Gap consistency ────────────────────────────────────────────────────────

def test_every_gap_has_code_severity_evidence(monkeypatch):
    monkeypatch.setenv("ENABLE_WEB_BUILD_PATH_AUDIT", "true")
    d = audit.build_path_audit()
    assert d["gaps"], "expected at least one gap"
    seen = set()
    for gap in d["gaps"]:
        assert gap["code"] and gap["code"] not in seen  # unique codes
        seen.add(gap["code"])
        assert gap["severity"] in _VALID_SEVERITIES
        assert gap["evidence"] and gap["description"]
    # The three critical findings are present.
    criticals = {g["code"] for g in d["gaps"] if g["severity"] == "critical"}
    assert {"generation-context-disconnected", "production-path-divergence",
            "no-rendered-evaluation"} <= criticals


# ── 5. Serialization ──────────────────────────────────────────────────────────

def test_json_serializable_and_bounded(monkeypatch):
    monkeypatch.setenv("ENABLE_WEB_BUILD_PATH_AUDIT", "true")
    s = json.dumps(audit.build_path_audit())
    assert 0 < len(s) < 20000  # bounded


# ── 6. No generation mutation / no side effects ───────────────────────────────

def test_module_imports_nothing_from_generation_or_prompts():
    forbidden = ("generation", "prompt", "orchestrator", "ai_client", "openai",
                 "web_build_context", "provider")
    for f in glob.glob("backend/services/web_build_path_audit/*.py"):
        for node in ast.walk(ast.parse(open(f).read())):
            mods = []
            if isinstance(node, ast.Import):
                mods = [a.name for a in node.names]
            elif isinstance(node, ast.ImportFrom):
                mods = [node.module or ""]
            for m in mods:
                assert not any(x in (m or "") for x in forbidden), (f, m)


def test_build_is_pure_repeatable(monkeypatch):
    monkeypatch.setenv("ENABLE_WEB_BUILD_PATH_AUDIT", "true")
    assert audit.build_path_audit() == audit.build_path_audit()  # deterministic, no state
