# coding: utf-8
"""
Phase 7 — Worker entry points (per PROJECT_ROADMAP.md spec).

The roadmap calls for:
    backend/jobs/celery_app.py
    backend/jobs/tasks.py
    backend/jobs/decorators.py

These files exist as thin RE-EXPORTS of the real implementation in
`backend.services.jobs`. The split is structural: `backend/services/jobs/`
holds the business logic; `backend/jobs/` is the canonical worker entry
point a future `celery -A backend.jobs.celery_app worker` command will
import.

Importing this package does NOT require Celery to be installed — the
`celery_app` module imports celery lazily inside a function so the
API process boots fine without it.
"""
from backend.services.jobs.decorators import korvix_task
from backend.services.jobs.registry import JobContext, register_job


__all__ = ["korvix_task", "register_job", "JobContext"]
