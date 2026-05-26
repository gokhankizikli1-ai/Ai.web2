# coding: utf-8
"""
Phase 7 — Worker-side task module.

Importing this module triggers handler registration via the side-effect
import of `backend.services.jobs.kinds`. A worker process started with
`celery -A backend.jobs.celery_app worker` would `--include` this
module to ensure all built-in kinds are registered.

For Phase 7 (inline runner), the API process imports
`backend.services.jobs` directly, which imports `kinds` for the same
side effect. This file exists as the documented worker entry point.
"""
from backend.services.jobs import kinds   # noqa: F401 — side-effect registration

# Add additional internal-only handlers here in future phases.
# Authoring pattern:
#
#     from backend.services.jobs.decorators import korvix_task
#     from backend.services.jobs.registry import JobContext
#
#     @korvix_task("internal.my_kind")
#     async def my_handler(ctx: JobContext) -> dict:
#         ...
#
# Public-API kinds also need to be added to
# `backend.services.jobs.kinds._PUBLIC_KINDS` for the route allowlist.

__all__: list[str] = []
