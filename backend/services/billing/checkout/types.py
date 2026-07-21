# coding: utf-8
"""
Billing checkout — types (PR 7). Pure data.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Optional


@dataclass(frozen=True)
class CheckoutVariant:
    """A purchasable variant from the centralized checkout config. Maps a public
    `selector` (e.g. "pro_monthly") to a concrete Lemon Squeezy `variant_id` and
    our internal `plan` key. NO price or credit quantity lives here (out of
    scope) — this only identifies WHAT is being purchased, not its terms."""
    selector: str
    variant_id: str
    plan: str
    label: str = ""

    def to_public_dict(self) -> Dict[str, Any]:
        return {
            "selector": self.selector,
            "variant_id": self.variant_id,
            "plan": self.plan,
            "label": self.label or self.selector,
        }


@dataclass(frozen=True)
class CheckoutResult:
    """Result of a checkout creation. `url` is the only field the frontend
    needs; the rest are safe echoes for the caller/diagnostics. Carries NO Lemon
    API secrets or raw response."""
    url: str
    selector: str
    variant_id: str
    plan: str
    checkout_id: Optional[str] = None
    idempotent: bool = False

    def to_public_dict(self) -> Dict[str, Any]:
        return {
            "url": self.url,
            "selector": self.selector,
            "plan": self.plan,
            "idempotent": self.idempotent,
        }


@dataclass
class CheckoutRecord:
    """A persisted checkout attempt (idempotency + owner diagnostics). Stores
    the checkout URL for idempotent replay but NEVER any secret."""
    user_id: str
    selector: str
    variant_id: str
    plan: str
    checkout_id: Optional[str] = None
    checkout_url: str = ""
    idempotency_key: Optional[str] = None
    id: Optional[str] = None
    created_at: Optional[str] = None

    def to_public_dict(self, *, include_url: bool = False) -> Dict[str, Any]:
        out: Dict[str, Any] = {
            "id": self.id,
            "user_id": self.user_id,
            "selector": self.selector,
            "variant_id": self.variant_id,
            "plan": self.plan,
            "checkout_id": self.checkout_id,
            "has_idempotency_key": bool(self.idempotency_key),
            "created_at": self.created_at,
        }
        if include_url:
            out["checkout_url"] = self.checkout_url
        return out


__all__ = ["CheckoutVariant", "CheckoutResult", "CheckoutRecord"]
