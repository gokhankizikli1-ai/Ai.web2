# coding: utf-8
"""
Identity types for Phase 3.

Plain @dataclass — no Pydantic, no SQLAlchemy. Storage layer in
storage.py knows how to read/write these to SQLite; nothing else
depends on the persistence shape.

User.kind values today:
  - "guest"   anonymous browser-bound identity (Phase 3a)
  - "email"   email/password user                  (Phase 3b — reserved)
  - "google"  OAuth Google                         (Phase 3c — reserved)
  - "github"  OAuth GitHub                         (Phase 3c — reserved)
  - "apple"   OAuth Apple                          (Phase 3c — reserved)

The discriminator lets one users table cover every identity source. The
auth middleware and /v2/auth/me both surface `kind` so the frontend can
choose between "Sign in" and "You're signed in as <email>" UX without
extra round-trips.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict


VALID_KINDS = {"guest", "email", "google", "github", "apple"}


@dataclass
class User:
    id:            str                              # uuid4 hex
    kind:          str                              # see VALID_KINDS
    external_id:   str                              # provider-scoped id (e.g. "guest:<nonce>", "email:user@example.com")
    display_name:  str = ""
    created_at:    str = ""                         # ISO 8601
    last_seen_at:  str = ""                         # ISO 8601
    metadata:      Dict[str, Any] = field(default_factory=dict)

    @property
    def is_guest(self) -> bool:
        return self.kind == "guest"

    def public_dict(self) -> Dict[str, Any]:
        """Frontend-safe projection. Never includes raw refresh tokens
        or other secrets — those live in /v2/auth/refresh responses."""
        return {
            "id":           self.id,
            "kind":         self.kind,
            "display_name": self.display_name,
            "is_guest":     self.is_guest,
            "created_at":   self.created_at,
        }


__all__ = ["User", "VALID_KINDS"]
