# coding: utf-8
"""
KorvixAI v3 — middleware/ package.

Phase-1 entrypoint for request-scoped middleware (request_id correlation,
future auth, future rate limiting). Existing CORS / global-exception
wiring continues to live in `backend/core/middleware.py` so the legacy
import path keeps working.
"""
