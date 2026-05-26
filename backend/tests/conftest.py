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
    from backend.services.memory_plane import store as mp_store
    monkeypatch.setattr(mp_store, "_INITIALIZED", False, raising=False)
    mp_store.init()
    yield db_file
