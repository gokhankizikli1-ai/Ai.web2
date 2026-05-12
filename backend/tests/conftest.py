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
