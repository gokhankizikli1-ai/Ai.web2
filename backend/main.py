# coding: utf-8
"""
KorvixAI v3 — main.py
=======================
Re-exports `app` from backend/api.py so that:
  uvicorn backend.main:app   — works
  uvicorn backend.api:app    — works (canonical entry)

Railway Procfile uses backend.api:app.
"""
from backend.api import app  # noqa: F401

__all__ = ["app"]
