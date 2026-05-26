# coding: utf-8
"""
Phase 7 — Re-export of @korvix_task at the worker-entry-point path.

The roadmap spec lists `backend/jobs/decorators.py` as the canonical
location for `@korvix_task`. The actual implementation lives in
`backend.services.jobs.decorators`; this module is a thin re-export
so both paths work and authors can import from whichever feels
natural:

    from backend.jobs.decorators        import korvix_task     # roadmap path
    from backend.services.jobs.decorators import korvix_task   # internal path
    from backend.services.jobs           import register_job   # low-level

All three forms register against the same global registry.
"""
from backend.services.jobs.decorators import korvix_task

__all__ = ["korvix_task"]
