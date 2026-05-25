# coding: utf-8
"""
Owner / Admin Mode package.

Four concerns, kept strictly separate:

  - owner.py        Owner detection. `is_owner(user)` is the single
                    source of truth — every other module asks this
                    instead of comparing emails inline.
  - audit.py        Admin action audit log (SQLite, separate file).
                    Append-only; the owner cannot delete entries.
  - safety.py       Refusal patterns + safe-cyber classifier. Even the
                    owner cannot use the admin endpoints for malware,
                    credential theft, exploit dev, or destructive cyber.
  - owner_agent.py  The private "Shadow Agent". Composes a system
                    prompt with the safety guardrails and routes to
                    the existing AI service.

Routes live in `backend/routes/v2_admin.py`. The dependency
`require_owner` lives in `backend/core/deps.py` and reads the user
from request.state (populated by AuthMiddleware).

This whole subsystem is gated by `ENABLE_ADMIN_MODE=true`. When the
flag is off, the routes refuse with 404, and the audit log is never
written to. Owner detection itself is always available (cheap) so
that other subsystems can branch on `is_owner()` without paying for
the route layer.

SECURITY NOTE: Admin mode does NOT relax safety boundaries. The
guardrails in safety.py apply to the owner just like every other
user. The owner gets visibility and developer tools, not the ability
to bypass legal / safety policy.
"""
