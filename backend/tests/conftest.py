# coding: utf-8
"""
pytest fixtures for Phase B smoke tests.

These tests exercise the FastAPI app via TestClient — no Railway, no
real OpenAI key needed. The app is imported once per session; each
test gets a fresh TestClient so middleware state doesn't leak between
tests.
"""
from __future__ import annotations

import os
import sys

# Ensure project root is on sys.path so `from backend.api import app`
# resolves the same way it does on Railway.
_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

import pytest
from fastapi.testclient import TestClient


@pytest.fixture(scope="session")
def app():
    """The real Layer-1 production app, built once per test session."""
    from backend.api import app as _app
    return _app


@pytest.fixture()
def client(app):
    """Fresh TestClient per test. raise_server_exceptions=False matches
    production behaviour — uvicorn catches unhandled exceptions and the
    global_exception_handler returns a 500 envelope rather than crashing."""
    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture()
def tmp_auth_db(tmp_path, monkeypatch):
    """Phase 3a — isolate auth.db per test.

    Resets the storage module's lazy-init flag so each test gets a
    fresh schema in its own temp file. Without this, tests would share
    the production auth.db (and leave guest rows behind on every run).
    """
    db_file = tmp_path / "auth-test.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(db_file))
    monkeypatch.setenv("JWT_SECRET_KEY", "test-secret-key-32-chars-minimum-aaaa")
    from backend.services.auth import storage as auth_storage
    monkeypatch.setattr(auth_storage, "_INITIALIZED", False, raising=False)
    yield db_file


@pytest.fixture()
def tmp_sessions_db(tmp_path, monkeypatch):
    """Phase 5 — isolate sessions.db per test.

    Points SESSIONS_DB_PATH at a tmp file, enables ENABLE_SESSIONS,
    rewrites the store module's cached DB_PATH, and re-runs init() so
    the workspaces/threads/messages schema exists in the test file
    (client.init() at import time built the schema against the
    production file, not this one).
    """
    db_file = tmp_path / "sessions-test.db"
    monkeypatch.setenv("SESSIONS_DB_PATH", str(db_file))
    monkeypatch.setenv("ENABLE_SESSIONS", "true")
    from backend.services.sessions import store as sessions_store
    # The store reads DB_PATH at import; force-rewrite so subsequent
    # _conn() calls hit the test file.
    monkeypatch.setattr(sessions_store, "DB_PATH", str(db_file), raising=False)
    # Build schema in the test file.
    sessions_store.init()
    yield db_file


@pytest.fixture()
def tmp_jobs_db(tmp_path, monkeypatch):
    """Phase 7 — isolate jobs.db per test.

    Points JOBS_DB_PATH at a tmp file, enables ENABLE_JOB_QUEUE,
    resets the store's lazy-init flag so the schema is created in
    the tmp file, and re-runs init(). Also resets the manager
    singleton so each test gets a fresh InlineJobRunner with no
    leftover in-flight tasks.
    """
    db_file = tmp_path / "jobs-test.db"
    monkeypatch.setenv("JOBS_DB_PATH", str(db_file))
    monkeypatch.setenv("ENABLE_JOB_QUEUE", "true")
    monkeypatch.setenv("JOB_QUEUE_MODE", "inline")
    # IMPORTANT: import the MODULE objects via importlib so we get
    # `_reset_for_tests` (module-level), not the same-named singleton
    # instance exported via `from .manager import manager`.
    import importlib
    jobs_store = importlib.import_module("backend.services.jobs.store")
    jobs_manager = importlib.import_module("backend.services.jobs.manager")
    jobs_events = importlib.import_module("backend.services.jobs.events")
    jobs_registry = importlib.import_module("backend.services.jobs.registry")
    jobs_kinds = importlib.import_module("backend.services.jobs.kinds")
    monkeypatch.setattr(jobs_store, "_INITIALIZED", False, raising=False)
    jobs_store.init()
    jobs_manager._reset_for_tests()
    jobs_events._reset_for_tests()
    # Defensive registry restore: prior tests may have called
    # `_registry_reset()` (e.g. test_sync_handler_rejected). Ensure
    # built-in kinds are present so every tmp_jobs_db test starts
    # from a known-good state. Reloading re-runs the @korvix_task
    # decorators in kinds.py.
    if not jobs_registry.is_registered("echo"):
        importlib.reload(jobs_kinds)
    yield db_file


@pytest.fixture()
def tmp_assets_db(tmp_path, monkeypatch):
    """Phase 8 — isolate assets.db + the local storage root per test."""
    db_file = tmp_path / "assets-test.db"
    storage_root = tmp_path / "uploads"
    monkeypatch.setenv("ASSETS_DB_PATH", str(db_file))
    monkeypatch.setenv("ASSETS_STORAGE_LOCAL_ROOT", str(storage_root))
    monkeypatch.setenv("ENABLE_ASSET_SYSTEM", "true")
    import importlib
    assets_store = importlib.import_module("backend.services.assets.store")
    assets_manager = importlib.import_module("backend.services.assets.manager")
    monkeypatch.setattr(assets_store, "_INITIALIZED", False, raising=False)
    assets_store.init()
    assets_manager._reset_for_tests()
    yield db_file


@pytest.fixture()
def tmp_vision_db(tmp_path, monkeypatch):
    """Phase 8 — isolate vision.db per test."""
    db_file = tmp_path / "vision-test.db"
    monkeypatch.setenv("VISION_DB_PATH", str(db_file))
    monkeypatch.setenv("ENABLE_VISION_PIPELINE", "true")
    import importlib
    vs = importlib.import_module("backend.services.vision.store")
    monkeypatch.setattr(vs, "_INITIALIZED", False, raising=False)
    vs.init()
    yield db_file


@pytest.fixture()
def tmp_workflows_db(tmp_path, monkeypatch):
    """Phase 8 — isolate workflows.db per test."""
    db_file = tmp_path / "workflows-test.db"
    monkeypatch.setenv("WORKFLOWS_DB_PATH", str(db_file))
    monkeypatch.setenv("ENABLE_WORKFLOWS", "true")
    import importlib
    ws = importlib.import_module("backend.services.workflows.store")
    monkeypatch.setattr(ws, "_INITIALIZED", False, raising=False)
    ws.init()
    yield db_file


@pytest.fixture()
def tmp_agent_tasks_db(tmp_path, monkeypatch):
    """Phase 8 — isolate agent_tasks.db per test."""
    db_file = tmp_path / "agent-tasks-test.db"
    monkeypatch.setenv("AGENT_TASKS_DB_PATH", str(db_file))
    monkeypatch.setenv("ENABLE_AGENT_ORCHESTRATION", "true")
    import importlib
    ats = importlib.import_module("backend.services.agent_tasks.store")
    monkeypatch.setattr(ats, "_INITIALIZED", False, raising=False)
    ats.init()
    yield db_file


@pytest.fixture()
def tmp_scratchpad_db(tmp_path, monkeypatch):
    """Phase 9 — isolate scratchpad.db per test."""
    db_file = tmp_path / "scratchpad-test.db"
    monkeypatch.setenv("SCRATCHPAD_DB_PATH", str(db_file))
    monkeypatch.setenv("ENABLE_SCRATCHPAD", "true")
    import importlib
    sp = importlib.import_module("backend.services.scratchpad.store")
    monkeypatch.setattr(sp, "_INITIALIZED", False, raising=False)
    sp.init()
    yield db_file


@pytest.fixture()
def tmp_panels_db(tmp_path, monkeypatch):
    """Phase 9 part 2 — isolate panels.db per test."""
    db_file = tmp_path / "panels-test.db"
    monkeypatch.setenv("PANELS_DB_PATH", str(db_file))
    monkeypatch.setenv("ENABLE_REAL_COORDINATION", "true")
    import importlib
    pn = importlib.import_module("backend.services.panels.store")
    monkeypatch.setattr(pn, "_INITIALIZED", False, raising=False)
    pn.init()
    yield db_file


@pytest.fixture()
def tmp_agent_messages_db(tmp_path, monkeypatch):
    """Phase 9 part 2 — isolate agent_messages.db per test."""
    db_file = tmp_path / "agent-messages-test.db"
    monkeypatch.setenv("AGENT_MESSAGES_DB_PATH", str(db_file))
    monkeypatch.setenv("ENABLE_REAL_COORDINATION", "true")
    import importlib
    am = importlib.import_module("backend.services.agent_messenger.store")
    monkeypatch.setattr(am, "_INITIALIZED", False, raising=False)
    am.init()
    yield db_file


@pytest.fixture()
def tmp_tool_executions_db(tmp_path, monkeypatch):
    """Phase 10 — isolate tool_executions.db per test."""
    db_file = tmp_path / "tool-executions-test.db"
    monkeypatch.setenv("TOOL_EXECUTIONS_DB_PATH", str(db_file))
    monkeypatch.setenv("ENABLE_TOOLS_RUNTIME", "true")
    import importlib
    te = importlib.import_module("backend.services.tool_executions.store")
    monkeypatch.setattr(te, "_INITIALIZED", False, raising=False)
    te.init()
    yield db_file


@pytest.fixture()
def agent_presence_enabled(monkeypatch):
    """Phase 9 part 2 — turn on presence + reset the singleton snapshot
    so cross-test bleed-over can't happen."""
    monkeypatch.setenv("ENABLE_AGENT_PRESENCE", "true")
    import importlib
    pc = importlib.import_module("backend.services.agent_presence.client")
    # Reset the singleton's in-memory snapshot per test.
    pc.client._snapshot.clear()
    yield
    pc.client._snapshot.clear()


@pytest.fixture()
def tmp_memory_plane_db(tmp_path, monkeypatch):
    """Phase 6 — isolate memory_plane.db per test.

    Points MEMORY_PLANE_DB_PATH at a tmp file, enables
    ENABLE_MEMORY_PLANE, resets the store's lazy-init flag so the
    schema is created in the tmp file (not the production file), and
    re-runs init().
    """
    db_file = tmp_path / "memory-plane-test.db"
    monkeypatch.setenv("MEMORY_PLANE_DB_PATH", str(db_file))
    monkeypatch.setenv("ENABLE_MEMORY_PLANE", "true")
    # Phase 6 slice 2 — `store` is now a dispatcher that delegates to
    # store_sqlite or store_pg per call. The lazy-init flag lives on
    # the active backend module, not on the dispatcher. Use the
    # dispatcher's `_reset_for_tests()` so the right backend's flag
    # is cleared and the next init() recreates the schema against the
    # new tmp path.
    from backend.services.memory_plane import store as mp_store
    mp_store._reset_for_tests()
    mp_store.init()
    yield db_file
