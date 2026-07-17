# coding: utf-8
"""
v2 admin — Web Build cost analytics (Phase 14M).

Owner-only endpoints under /v2/admin/costs/* exposing the AI usage & cost
tracking data collected by backend.services.cost_tracking (tasks #7).

  GET  /v2/admin/costs/analytics       Aggregate analytics across all builds:
                                       average / median / p90 / p95 build cost,
                                       cheapest & most-expensive build, token
                                       usage by model, cost by operation type,
                                       cost caused by retries, and the live
                                       pricing table.

  GET  /v2/admin/costs/builds          Recent builds with per-build cost + token
                                       roll-ups (task #7 "cost per individual
                                       build"). Query: ?limit=&offset=&user_id=.

  GET  /v2/admin/costs/builds/{id}      One build's full aggregate + every call
                                       that made it up.

  GET  /v2/admin/costs/dashboard        Self-contained HTML dashboard (no external
                                       assets) rendering the analytics above.

Mounted only when ENABLE_ADMIN_MODE is on (see backend/api.py), same as the
rest of /v2/admin/*. Per-request owner gating via require_owner — a non-owner
gets a 401/403 envelope, never a 404.
"""
from __future__ import annotations

import html
import json
import logging
import re
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, JSONResponse

from backend.core.deps import current_user, _extract_owner_token
from backend.core.responses import ok as envelope_ok
from backend.middleware.auth import User
from backend.services.admin import audit
from backend.services.admin.owner import is_owner_request
from backend.services.cost_tracking import tracker

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v2/admin/costs", tags=["admin-costs"])

# No-store: cost data must never be cached by a shared proxy/browser.
_NO_STORE = {"Cache-Control": "no-store, no-cache, must-revalidate, private"}

# Safe build-id charset (the tracker mints hex/underscore/hyphen ids). Anything
# else is a malformed request → 400 (never reaches the store).
_BUILD_ID_RE = re.compile(r"^[A-Za-z0-9_\-]{1,128}$")


def owner_gate(request: Request) -> User:
    """Backend-authoritative owner gate for the cost endpoints with CORRECT
    HTTP semantics (the app-wide ApiError→envelope handler is opt-in and off in
    prod, so `require_owner`'s exception would otherwise collapse into the
    generic chat-style 500). Reuses the EXISTING owner predicate — no second
    owner-auth system.

      • unauthenticated (guest, no owner token)      → 401
      • authenticated / tokened but NOT the owner     → 403
      • verified owner                                → the User

    Raises fastapi.HTTPException, which the built-in handler renders as a clean
    JSON body with the right status. Never trusts a client-sent owner flag.
    """
    try:
        user = current_user(request)
    except Exception:
        raise HTTPException(status_code=401, detail="authentication required")
    token = _extract_owner_token(request)
    if is_owner_request(user, owner_token=token):
        return user
    # Distinguish "not signed in at all" (401) from "signed in / presented a
    # credential but not the owner" (403).
    presented_credential = bool(token) or (user is not None and not user.is_guest)
    if presented_credential:
        raise HTTPException(status_code=403, detail="owner privileges required")
    raise HTTPException(status_code=401, detail="authentication required")


def _audit(user: User, action: str, request: Request) -> None:
    """Best-effort audit emission — never raises into the route path."""
    try:
        audit.record(
            user_id=getattr(user, "id", None),
            action=action,
            status="ok",
            path=str(request.url.path) if request.url else None,
        )
    except Exception:
        pass


@router.get("/analytics")
async def costs_analytics(
    request: Request,
    user_id: Optional[str] = Query(default=None, max_length=120),
    user: User = Depends(owner_gate),
) -> JSONResponse:
    """Aggregate cost analytics. Owner-only. 401 unauth / 403 non-owner."""
    _audit(user, "admin.costs.analytics.view", request)
    return JSONResponse(content=envelope_ok(tracker.analytics(user_id=user_id)), headers=_NO_STORE)


@router.get("/builds")
async def costs_builds(
    request: Request,
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    user_id: Optional[str] = Query(default=None, max_length=120),
    user: User = Depends(owner_gate),
) -> JSONResponse:
    """Recent builds with per-build cost roll-ups. Owner-only."""
    _audit(user, "admin.costs.builds.view", request)
    builds = tracker.list_builds(limit=limit, offset=offset, user_id=user_id)
    return JSONResponse(content=envelope_ok({"builds": builds, "count": len(builds)}), headers=_NO_STORE)


@router.get("/builds/{build_id}")
async def costs_build_detail(
    build_id: str,
    request: Request,
    user: User = Depends(owner_gate),
) -> JSONResponse:
    """One build's full aggregate + its individual calls. Owner-only.
    400 malformed id / 404 unknown build."""
    if not _BUILD_ID_RE.match(build_id or ""):
        raise HTTPException(status_code=400, detail="malformed build id")
    if not tracker.build_exists(build_id):
        raise HTTPException(status_code=404, detail="build not found")
    _audit(user, "admin.costs.build.view", request)
    return JSONResponse(content=envelope_ok(tracker.get_build(build_id)), headers=_NO_STORE)


@router.get("/dashboard", response_class=HTMLResponse)
async def costs_dashboard(
    request: Request,
    user: User = Depends(owner_gate),
) -> HTMLResponse:
    """Self-contained HTML cost dashboard (legacy owner view). Owner-only."""
    _audit(user, "admin.costs.dashboard.view", request)
    a = tracker.analytics()
    builds = tracker.list_builds(limit=50)
    return HTMLResponse(_render_dashboard(a, builds), headers=_NO_STORE)


# ── HTML rendering (no external assets — CSP-safe, self-contained) ───────────
def _usd(v: Any) -> str:
    try:
        return "$" + format(float(v or 0.0), ",.4f")
    except Exception:
        return "$0.0000"


def _int(v: Any) -> str:
    try:
        return format(int(v or 0), ",")
    except Exception:
        return "0"


def _render_dashboard(a: Dict[str, Any], builds: list) -> str:
    def esc(x: Any) -> str:
        return html.escape(str(x if x is not None else ""))

    cards = [
        ("Total builds", _int(a.get("build_count"))),
        ("Total cost", _usd(a.get("total_cost_usd"))),
        ("Average build", _usd(a.get("average_build_cost_usd"))),
        ("Median build", _usd(a.get("median_build_cost_usd"))),
        ("p90 build", _usd(a.get("p90_build_cost_usd"))),
        ("p95 build", _usd(a.get("p95_build_cost_usd"))),
    ]
    card_html = "".join(
        f'<div class="card"><div class="k">{esc(k)}</div><div class="v">{esc(v)}</div></div>'
        for k, v in cards
    )

    ext = ""
    ch = a.get("cheapest_build") or {}
    mx = a.get("most_expensive_build") or {}
    if ch or mx:
        ext = (
            f'<p class="muted">Cheapest build: <b>{esc((ch or {}).get("build_id","-"))}</b> '
            f'({_usd((ch or {}).get("total_build_cost_usd"))}) &nbsp;·&nbsp; '
            f'Most expensive: <b>{esc((mx or {}).get("build_id","-"))}</b> '
            f'({_usd((mx or {}).get("total_build_cost_usd"))})</p>'
        )

    retry = a.get("retry_costs") or {}
    retry_html = (
        f'<p class="muted">Retry calls: <b>{_int(retry.get("retry_calls"))}</b> · '
        f'Cost caused by retries: <b>{_usd(retry.get("retry_cost_usd"))}</b> '
        f'of {_usd(retry.get("total_cost_usd"))} total</p>'
    )

    def rows(items, cols):
        out = []
        for it in items:
            tds = "".join(f"<td>{esc(fmt(it.get(c)))}</td>" for c, fmt in cols)
            out.append(f"<tr>{tds}</tr>")
        return "".join(out) or '<tr><td colspan="9" class="muted">No data yet.</td></tr>'

    model_rows = rows(a.get("token_usage_by_model") or [], [
        ("model", esc), ("calls", _int), ("input_tokens", _int),
        ("output_tokens", _int), ("cached_tokens", _int),
        ("reasoning_tokens", _int), ("cost_usd", _usd),
    ])
    op_rows = rows(a.get("cost_by_operation_type") or [], [
        ("operation_type", esc), ("calls", _int), ("cost_usd", _usd),
    ])
    build_rows = rows(builds, [
        ("build_id", esc), ("user_id", esc), ("status", esc),
        ("total_ai_calls", _int), ("failed_calls", _int), ("retry_calls", _int),
        ("total_input_tokens", _int), ("total_output_tokens", _int),
        ("total_build_cost_usd", _usd),
    ])

    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Web Build Cost Analytics</title>
<style>
  :root {{ color-scheme: light dark; }}
  * {{ box-sizing: border-box; }}
  body {{ font: 14px/1.5 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
         margin: 0; padding: 24px; background: #0b0d12; color: #e6e9ef; }}
  h1 {{ font-size: 20px; margin: 0 0 4px; }}
  h2 {{ font-size: 15px; margin: 28px 0 10px; color: #9aa4b2; text-transform: uppercase; letter-spacing: .04em; }}
  .muted {{ color: #8b93a1; font-size: 13px; }}
  .cards {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(150px,1fr)); gap: 12px; margin-top: 16px; }}
  .card {{ background: #151922; border: 1px solid #232936; border-radius: 12px; padding: 14px 16px; }}
  .card .k {{ color: #8b93a1; font-size: 12px; }}
  .card .v {{ font-size: 22px; font-weight: 650; margin-top: 4px; }}
  table {{ width: 100%; border-collapse: collapse; margin-top: 6px; font-size: 13px; }}
  th, td {{ text-align: left; padding: 8px 10px; border-bottom: 1px solid #232936; white-space: nowrap; }}
  th {{ color: #9aa4b2; font-weight: 600; }}
  .wrap {{ overflow-x: auto; border: 1px solid #232936; border-radius: 12px; }}
  code {{ background: #151922; padding: 2px 6px; border-radius: 6px; }}
</style></head>
<body>
  <h1>Web Build — AI Usage &amp; Cost Analytics</h1>
  <p class="muted">Server-side truth. Token values are sourced from provider
  responses only, never from the client. Pricing comes from the centralized
  table. Endpoint: <code>/v2/admin/costs/analytics</code></p>
  <div class="cards">{card_html}</div>
  {ext}
  {retry_html}

  <h2>Token usage by model</h2>
  <div class="wrap"><table>
    <tr><th>Model</th><th>Calls</th><th>Input</th><th>Output</th><th>Cached</th><th>Reasoning</th><th>Cost</th></tr>
    {model_rows}
  </table></div>

  <h2>Cost by operation type</h2>
  <div class="wrap"><table>
    <tr><th>Operation</th><th>Calls</th><th>Cost</th></tr>
    {op_rows}
  </table></div>

  <h2>Recent builds</h2>
  <div class="wrap"><table>
    <tr><th>Build</th><th>User</th><th>Status</th><th>Calls</th><th>Failed</th><th>Retries</th><th>Input tok</th><th>Output tok</th><th>Cost</th></tr>
    {build_rows}
  </table></div>
</body></html>"""


__all__ = ["router"]
