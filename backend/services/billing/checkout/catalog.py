# coding: utf-8
"""
Billing checkout — variant catalog (PR 7).

The centralized, config-driven set of PURCHASABLE variants. A client may only
buy a variant that appears here; a request for anything else is rejected
server-side (never trust a raw variant id from the client). DATA, not code —
adding a variant is a config change.

Shape (BILLING_CHECKOUT_VARIANTS_JSON):
    {"pro_monthly": {"variant_id": "123", "plan": "pro", "label": "Pro Monthly"},
     "pro_yearly":  {"variant_id": "456", "plan": "pro", "label": "Pro Yearly"}}

Resolution accepts either the public selector ("pro_monthly") OR the concrete
variant_id ("123"), and always validates it against this allowlist. No prices
or credit quantities are stored here (out of scope).
"""
from __future__ import annotations

import json
import logging
from typing import Dict, List, Optional

from backend.services.billing.checkout import config as checkout_config
from backend.services.billing.checkout.types import CheckoutVariant


logger = logging.getLogger(__name__)


def _parse(raw: str) -> Dict[str, CheckoutVariant]:
    raw = (raw or "").strip()
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        logger.warning("checkout: BILLING_CHECKOUT_VARIANTS_JSON invalid: %s — no variants", exc)
        return {}
    if not isinstance(parsed, dict):
        return {}
    out: Dict[str, CheckoutVariant] = {}
    for selector, entry in parsed.items():
        if not isinstance(entry, dict):
            continue
        variant_id = str(entry.get("variant_id") or "").strip()
        plan = str(entry.get("plan") or "").strip()
        if not variant_id or not plan:
            logger.warning("checkout: variant %r missing variant_id/plan — skipped", selector)
            continue
        sel = str(selector).strip()
        out[sel] = CheckoutVariant(
            selector=sel, variant_id=variant_id, plan=plan,
            label=str(entry.get("label") or "").strip(),
        )
    return out


# Cache keyed by the exact raw config so repeated calls don't re-parse but a
# Railway env change is picked up on the next call.
_CACHE: dict = {"raw": None, "variants": None}


def _variants() -> Dict[str, CheckoutVariant]:
    raw = checkout_config.variants_json()
    if _CACHE["raw"] == raw and _CACHE["variants"] is not None:
        return _CACHE["variants"]
    variants = _parse(raw)
    _CACHE["raw"] = raw
    _CACHE["variants"] = variants
    return variants


def all_variants() -> List[CheckoutVariant]:
    return list(_variants().values())


def resolve(requested: str) -> Optional[CheckoutVariant]:
    """Resolve a requested variant (by selector OR variant_id) to a validated
    CheckoutVariant, or None when it is not an allowed purchasable variant."""
    key = (requested or "").strip()
    if not key:
        return None
    variants = _variants()
    if key in variants:
        return variants[key]
    for v in variants.values():
        if v.variant_id == key:
            return v
    return None


def to_public_dict() -> dict:
    return {"variants": [v.to_public_dict() for v in all_variants()]}


def _reset_for_tests() -> None:
    _CACHE["raw"] = None
    _CACHE["variants"] = None


__all__ = ["all_variants", "resolve", "to_public_dict", "_reset_for_tests"]
