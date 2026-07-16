# coding: utf-8
"""
Phase 14L.1 — Founder-Beta AI protection HTTP surface.

Thin routes over backend.services.ai_guard. The heavy enforcement (preflight)
happens inside /chat and the image route BEFORE the model call; this module
exposes only the lifecycle + visibility endpoints:

  POST /v2/ai/operations/finalize   — release a user's own operation lock + reservation
  GET  /v2/ai/usage                 — honest per-user founder-beta usage/limits/reset
  GET  /v2/admin/ai-operations      — owner-only status (policy + spend + active ops)
  POST /v2/admin/ai-operations      — owner-only runtime overrides (audited, bounded)

User endpoints are auth-scoped to the caller's own identity (same authoritative
uid derivation as /chat). Owner endpoints require `Depends(require_owner)`.
Nothing here calls a model, a provider or a payment system.
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from backend.core.deps import resolve_authoritative_uid, require_owner
from backend.services.ai_guard import service as ai_guard
from backend.services.ai_guard import store as ai_store

router = APIRouter(tags=["ai-guard"])
logger = logging.getLogger(__name__)


def _uid(raw: str) -> int:
    """Match /chat's authoritative uid normalization so the guard keys line up."""
    return int(raw) if str(raw).isdigit() else hash(raw) % 2 ** 31


def _caller_uid(request: Request, body_user_id: str = "") -> int:
    return _uid(resolve_authoritative_uid(request, body_user_id or "", log_prefix="AI_GUARD"))


# ── User: finalize an operation ───────────────────────────────────────────────
class FinalizeBody(BaseModel):
    operationId: Optional[str] = Field(default=None, max_length=80)
    idempotencyKey: Optional[str] = Field(default=None, max_length=80)
    status: str = Field(default="succeeded", max_length=32)
    errorCode: Optional[str] = Field(default=None, max_length=64)
    user_id: Optional[str] = Field(default=None, max_length=128)


@router.post("/v2/ai/operations/finalize")
def finalize_operation(body: FinalizeBody, request: Request):
    """Terminal transition for the caller's own operation (release lock +
    outstanding reservation). Targeted by the server operationId when known, else
    by the client idempotency key. Idempotent; only the owning user may finalize."""
    uid = _caller_uid(request, body.user_id or "")
    ok = ai_guard.finalize(
        user_id=str(uid),
        operation_id=(body.operationId or "").strip() or None,
        idempotency_key=(body.idempotencyKey or "").strip() or None,
        status=(body.status or "succeeded").strip().lower(), error_code=body.errorCode,
    )
    return {"ok": bool(ok), "operationId": body.operationId}


# ── User: honest founder-beta usage snapshot ──────────────────────────────────
@router.get("/v2/ai/usage")
def ai_usage(request: Request, user_id: str = ""):
    uid = _caller_uid(request, user_id or "")
    try:
        return ai_guard.usage_snapshot(str(uid))
    except Exception as e:
        logger.warning("ai_usage snapshot failed: %s", e)
        return {"mode": "founder_beta", "aiOperationsEnabled": True, "operations": {}}


# ── Owner: status ─────────────────────────────────────────────────────────────
@router.get("/v2/admin/ai-operations")
def admin_ai_operations_status(request: Request):
    require_owner(request)
    try:
        return ai_guard.owner_snapshot()
    except Exception as e:
        logger.warning("owner ai-operations snapshot failed: %s", e)
        return JSONResponse(status_code=200, content={"error": "snapshot_unavailable"})


@router.get("/v2/admin/ai-operations/storage")
def admin_ai_operations_storage(request: Request):
    """Owner-only persistence proof. Runs the startup-safe verification (write+read
    a harmless metadata marker) so an operator can confirm WHICH database is live and
    that it is writable on the durable volume. No user quota consumed, no model call.
    The absolute path is owner-only."""
    require_owner(request)
    try:
        return {"storage": ai_guard.verify_storage()}
    except Exception as e:
        logger.warning("owner ai-operations storage check failed: %s", e)
        return JSONResponse(status_code=200, content={"storage": {"backend": "sqlite", "error": "unavailable"}})


# ── Owner: bounded, audited runtime overrides ─────────────────────────────────
# Only these keys are writable, each with safe min/max bounds. Anything else is
# rejected. Setting a key to null clears it (reverts to the env/config default).
_BOOL_KEYS = {
    "ai_operations_enabled", "founder_beta_enabled",
    "major_redesign.enabled", "image_generation.enabled", "global_spend_enabled",
}
_INT_KEYS = {
    "full.daily": (0, 50), "small_edit.daily": (0, 200),
    "major_redesign.daily": (0, 50), "image_generation.daily": (0, 100),
}
_FLOAT_KEYS = {"global_spend_limit_usd": (0.0, 100_000.0)}


class OverrideBody(BaseModel):
    key: str = Field(..., max_length=64)
    value: Optional[str] = Field(default=None, max_length=32)


@router.post("/v2/admin/ai-operations")
def admin_ai_operations_update(body: OverrideBody, request: Request):
    owner = require_owner(request)
    key = (body.key or "").strip()
    raw = None if body.value is None else str(body.value).strip()

    # Validate against the allow-list + bounds. Reject silently-wrong input.
    if key in _BOOL_KEYS:
        if raw is not None and raw.lower() not in ("true", "false"):
            return JSONResponse(status_code=400, content={"error": "invalid_bool", "key": key})
        norm = raw.lower() if raw is not None else None
    elif key in _INT_KEYS:
        lo, hi = _INT_KEYS[key]
        try:
            iv = int(raw) if raw is not None else None
        except Exception:
            return JSONResponse(status_code=400, content={"error": "invalid_int", "key": key})
        if iv is not None and not (lo <= iv <= hi):
            return JSONResponse(status_code=400, content={"error": "out_of_range", "key": key, "min": lo, "max": hi})
        norm = str(iv) if iv is not None else None
    elif key in _FLOAT_KEYS:
        lo, hi = _FLOAT_KEYS[key]
        try:
            fv = float(raw) if raw is not None else None
        except Exception:
            return JSONResponse(status_code=400, content={"error": "invalid_float", "key": key})
        if fv is not None and not (lo <= fv <= hi):
            return JSONResponse(status_code=400, content={"error": "out_of_range", "key": key, "min": lo, "max": hi})
        norm = str(fv) if fv is not None else None
    else:
        return JSONResponse(status_code=400, content={"error": "unknown_key", "key": key})

    try:
        if norm is None:
            ai_store.clear_override(key)
        else:
            ai_store.set_override(key, norm, updated_by=str(getattr(owner, "id", "owner")))
    except Exception as e:
        logger.warning("ai-operations override write failed: %s", e)
        return JSONResponse(status_code=500, content={"error": "write_failed"})

    # Best-effort audit using the existing admin audit ledger (never fatal).
    try:
        from backend.services.admin import audit as _audit
        _audit.record(
            user_id=str(getattr(owner, "id", "owner")),
            action="ai_operations_override",
            path="/v2/admin/ai-operations",
            metadata={"key": key, "value": norm},
        )
    except Exception:
        pass

    logger.info("AI_GUARD | owner=%s | override %s=%s", getattr(owner, "id", "?"), key, norm)
    return {"ok": True, "key": key, "value": norm, "policy": ai_guard.owner_snapshot().get("policy")}
