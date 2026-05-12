# coding: utf-8
"""
Phase 3 auth package.

Five concerns, kept strictly separate:

  - tokens.py    pure stdlib HS256 JWT issue/verify. No external deps.
  - storage.py   SQLite-backed users + refresh-tokens tables, separate
                 from memory.db / sessions.db so this phase has a clean
                 rollback (delete auth.db; no other subsystem reads it).
  - identity.py  User dataclass + accessors. Plain data, no Pydantic.
  - service.py   High-level operations (create_guest, refresh, get_me).
  - errors.py    Auth exception hierarchy subclassing ApiError so 401/403
                 responses flow through the v2 envelope when enabled.

Routes live in `backend/routes/v2_auth.py` (POST /v2/auth/guest, refresh,
me, logout). Middleware lives in `backend/middleware/auth.py` and is
opt-in via ENABLE_AUTH_V2=true.

Phase-3a slice (this PR): JWT infrastructure, guest sessions, user
identity, middleware, /v2/auth/* routes. NOT in this PR: email/password
login, OAuth (Google/GitHub/Apple), password hashing — those are
Phase-3b. Legacy /chat contract is preserved; the chat route ignores
auth state entirely.
"""
