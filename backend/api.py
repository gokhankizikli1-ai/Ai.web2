# coding: utf-8
"""
KorvixAI v2 legacy entry point — kept for backward compatibility only.

The canonical entry point is now backend/main.py.
Railway Procfile has been updated to: uvicorn backend.main:app

If any external tool still references backend.api:app it will still work
because we re-export the same `app` object from main.
"""
from backend.main import app  # noqa: F401 — re-export for legacy compatibility
