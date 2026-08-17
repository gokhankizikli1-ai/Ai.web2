# coding: utf-8
"""The Project WORKSPACE read model — one bounded, deterministic snapshot of
everything the Project page shows.

WHAT THIS IS
------------
`GET /v2/projects/{id}/workspace` renders from exactly this function. It is a
PROJECTION over authorities that already exist, assembled once per page load:

    projects store          the project record + ownership (the gate)
    observations store      connector activity            (read-only)
    goals store             durable active goals          (read-only)
    memory plane            user-stated goals + summary   (via ProjectBrainClient)
    project_products        generated Web/App products    (read-only)
    projects↔thread links   the project's chats           (read-only)
    connectors store        which tools this project uses (read-only)
    attention               the deterministic ranking     (pure)

WHAT IT IS NOT
--------------
  * NOT a second Project Brain. The prompt-injection aggregate
    (`ProjectBrainClient.get`) is untouched and still owns what the model sees;
    this owns what the PAGE sees. They share the summary rule and the product
    projection rather than each answering the same question differently.
  * NOT a second observation store, and NOT a connector sync. Nothing here calls
    Gmail / GitHub / Vercel / Slack / Calendar. Opening the Project page performs
    ZERO provider API calls — it reads what a previous explicit sync ingested.
  * NOT a writer. No task, run, candidate action, decision, memory or
    observation is created by reading this. "Observation ≠ execution" holds.
  * NOT a model call. Nothing here spends a token.

ISOLATION
---------
`build()` resolves the project through the canonical `projects` store and
returns None unless the record exists AND belongs to the caller — the route
turns that into a 404 so a project's existence is never revealed. Every
project-keyed slice is read only after that gate, and the slices that DO carry
an owner column (observations, connector bindings, chat threads via their
workspace) are additionally owner-filtered as defense in depth. No credential,
token, or opaque provider resource id is ever included in the output.

BOUNDS
------
Every list is capped (see the `_MAX_*` constants) and every list has a stable,
documented ordering, so the payload size is a constant regardless of how much
history a project accumulates.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from backend.services.project_brain import attention as attention_mod

logger = logging.getLogger(__name__)

# ── Bounds (all deliberate; the page is meant to be scannable) ───────────────
_MAX_OBSERVATIONS_READ = 60   # the slice attention + activity are derived from
_MAX_ACTIVITY = 12
_MAX_ATTENTION = attention_mod.MAX_ATTENTION
_MAX_GOALS = 5
_MAX_PRODUCTS = 8
_MAX_CHATS = 8
_MAX_CONNECTOR_RESOURCES = 4  # resource labels named per provider before "+N"

#: Activity rows carry these non-connector sources so the frontend can label
#: them without inventing a provider.
ACTIVITY_SOURCE_CHAT = "chat"
ACTIVITY_SOURCE_BUILD = "build"


def _now_iso(now: datetime) -> str:
    return now.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _s(value: Any, limit: int = 200) -> str:
    out = "" if value is None else str(value)
    return out[:limit]


def _max_iso(*values: Any) -> str:
    """The newest of several ISO timestamps, comparing real instants (not raw
    strings — connectors write both `...Z` and explicit offsets). Returns ""
    when nothing parseable was supplied."""
    best_raw = ""
    best_dt: Optional[datetime] = None
    for value in values:
        raw = _s(value, 64).strip()
        if not raw:
            continue
        parsed = attention_mod.parse_iso(raw)   # tolerant shared parser
        if parsed is None:
            continue
        if best_dt is None or parsed > best_dt:
            best_dt, best_raw = parsed, raw
    return best_raw


def _owned_project(user_id: str, project_id: str):
    """The canonical ownership gate. None ⇒ the caller may not see this
    project (missing, or someone else's). Fail-closed on any store error."""
    if not (user_id and project_id):
        return None
    try:
        from backend.services.projects import store as projects_store
        project = projects_store.get_project(str(project_id))
    except Exception as exc:  # pragma: no cover — defensive
        logger.debug("project_workspace: projects store unavailable: %s", exc)
        return None
    if project is None or str(project.owner_user_id) != str(user_id):
        return None
    return project


# ── slices ───────────────────────────────────────────────────────────────────

def _read_observations(user_id: str, project_id: str) -> List[dict]:
    """Recent CONNECTOR observations for this (user, project), newest-first.
    Read through the single canonical observation authority, owner-scoped."""
    try:
        from backend.services.orchestrator import observations_store as obs
        return obs.recent_observations(
            project_id, user_id=str(user_id),
            sources=list(obs.CONNECTOR_SOURCES), limit=_MAX_OBSERVATIONS_READ)
    except Exception as exc:
        logger.debug("project_workspace: observations unavailable: %s", exc)
        return []


def _read_goals(user_id: str, project_id: str) -> List[dict]:
    """Current goals, read-only.

    Two authorities, in one deterministic order:
      1. `goals_store` ACTIVE goals — the structured Business Brain hierarchy
         (id, title, priority). Ordered priority DESC, then created_at ASC.
      2. Memory Plane `goal` memories — goals the user stated in chat. They have
         no id and no priority, so they follow, newest-first.

    Deduplicated case-insensitively by title, bounded to `_MAX_GOALS`. There is
    no goal WRITE route in the product API surface, so this is presented
    read-only: the page never offers an edit affordance it cannot honour."""
    out: List[dict] = []
    seen: set = set()

    try:
        from backend.services.orchestrator import goals_store
        structured = goals_store.active_goals(str(project_id), limit=_MAX_GOALS * 2)
        structured.sort(key=lambda g: (-int(g.get("priority") or 2),
                                       str(g.get("created_at") or "")))
        for g in structured:
            title = _s(g.get("title"), 200).strip()
            key = title.lower()
            if not title or key in seen:
                continue
            seen.add(key)
            out.append({
                "id":       _s(g.get("id"), 64),
                "title":    title,
                "priority": int(g.get("priority") or 2),
                "source":   "goals",
            })
            if len(out) >= _MAX_GOALS:
                return out
    except Exception as exc:
        logger.debug("project_workspace: goals_store unavailable: %s", exc)

    try:
        from backend.services.project_brain.client import is_enabled as brain_enabled
        if brain_enabled():
            from backend.services.memory_plane import client as mp
            for m in mp.list_user(user_id, project_id=project_id, limit=50):
                if getattr(m, "kind", None) != "goal":
                    continue
                title = _s(getattr(m, "content", ""), 200).strip()
                key = title.lower()
                if not title or key in seen:
                    continue
                seen.add(key)
                out.append({"id": "", "title": title, "priority": None,
                            "source": "memory"})
                if len(out) >= _MAX_GOALS:
                    break
    except Exception as exc:
        logger.debug("project_workspace: memory goals unavailable: %s", exc)

    return out[:_MAX_GOALS]


def _read_chats(user_id: str, project_id: str) -> List[dict]:
    """The project's chats, through the canonical project↔thread binding and the
    sessions authority. Each thread is re-checked against its workspace owner —
    a stale or foreign binding contributes nothing. Newest-first."""
    rows: List[dict] = []
    try:
        from backend.services.projects import store as projects_store
        from backend.services.sessions import client as sc
        for link in projects_store.list_project_threads(project_id):
            th = sc.get_thread(link.thread_id)
            if th is None:
                continue
            ws = sc.get_workspace(th.workspace_id)
            if ws is None or str(ws.user_id) != str(user_id):
                continue   # defense in depth: never surface a foreign thread
            rows.append({
                "thread_id":  _s(th.id, 64),
                "title":      _s(th.title, 200) or "Chat",
                "mode":       _s(th.mode, 40),
                "updated_at": _s(th.updated_at, 64),
            })
    except Exception as exc:
        logger.debug("project_workspace: chats unavailable: %s", exc)
    rows.sort(key=lambda c: str(c.get("updated_at") or ""), reverse=True)
    return rows[:_MAX_CHATS]


def _read_connectors(user_id: str, project_id: str) -> List[dict]:
    """Which tools THIS project uses, from the shared connector authority.

    Returns display-safe fields only: the provider's registry label, the human
    resource labels (repository full name, Slack channel names, Vercel project
    name), a count, the binding status and the last sync time. Never a
    credential, never an authorization id, never an opaque provider resource id.
    Bindings whose recorded owner is not the caller are dropped outright."""
    out: List[dict] = []
    try:
        from backend.services.connectors import registry
        from backend.services.connectors import store as shared
        by_provider: Dict[str, List[Any]] = {}
        for b in shared.list_project_bindings(project_id):
            if str(getattr(b, "owner_user_id", "")) != str(user_id):
                continue   # defense in depth — a binding is never cross-owner
            by_provider.setdefault(str(b.provider), []).append(b)

        for spec in registry.all_specs():
            bindings = by_provider.get(spec.provider) or []
            if not bindings:
                continue
            labels = [
                _s(b.resource_label, 120) for b in bindings
                if _s(b.resource_label, 120).strip()
            ]
            statuses = {str(b.status) for b in bindings}
            # One status for the row: pending selection is the state the user
            # can act on, revoked next, else connected.
            if shared.BIND_PENDING in statuses:
                status = shared.BIND_PENDING
            elif shared.BIND_REVOKED in statuses and len(statuses) == 1:
                status = shared.BIND_REVOKED
            else:
                status = shared.BIND_CONNECTED
            out.append({
                "provider":       spec.provider,
                "label":          spec.label,
                "resource_kind":  spec.resource_kind,
                "resource_noun":  spec.resource_noun,
                "resources":      sorted(labels)[:_MAX_CONNECTOR_RESOURCES],
                "resource_count": len(labels),
                "status":         status,
                "last_sync_at":   _max_iso(*[b.last_sync_at for b in bindings]),
            })
    except Exception as exc:
        logger.debug("project_workspace: connector bindings unavailable: %s", exc)
    return out


def _build_activity(observations: List[dict], chats: List[dict],
                    products: List[dict]) -> List[dict]:
    """ONE unified "what changed around this project" stream.

    Presentation is normalized here; STORAGE is not — every row still lives in
    its own authority and is simply projected onto a common shape. Connector
    rows carry the observation's own bounded `summary` (which the normalizers
    already produced for humans), never the raw payload object.

    Ordering: timestamp DESC, then source ASC, then id ASC (stable)."""
    rows: List[dict] = []
    for o in observations or []:
        rows.append({
            "id":          _s(o.get("id"), 64),
            "source":      _s(o.get("source"), 40),
            "kind":        _s(o.get("kind"), 120),
            "title":       _s(o.get("summary"), 240) or _s(o.get("kind"), 120),
            "occurred_at": _s(o.get("observed_at"), 64),
            "ref":         "",
        })
    for c in chats or []:
        rows.append({
            "id":          _s(c.get("thread_id"), 64),
            "source":      ACTIVITY_SOURCE_CHAT,
            "kind":        "chat.updated",
            "title":       _s(c.get("title"), 240),
            "occurred_at": _s(c.get("updated_at"), 64),
            "ref":         _s(c.get("thread_id"), 64),
        })
    for p in products or []:
        build_type = "app" if _s(p.get("build_type"), 16).lower() == "app" else "web"
        rows.append({
            "id":          _s(p.get("deliverable_id"), 200),
            "source":      ACTIVITY_SOURCE_BUILD,
            "kind":        f"product.{build_type}_build",
            "title":       _s(p.get("title"), 240),
            "occurred_at": _s(p.get("updated_at"), 64),
            "ref":         _s(p.get("deliverable_id"), 200),
        })

    def _key(row: dict):
        parsed = attention_mod.parse_iso(row.get("occurred_at"))
        stamp = parsed.timestamp() if parsed is not None else float("-inf")
        return (-stamp, str(row.get("source") or ""), str(row.get("id") or ""))

    rows.sort(key=_key)
    return rows[:_MAX_ACTIVITY]


# ── the read model ───────────────────────────────────────────────────────────

def build(user_id: str, project_id: str, *,
          now: Optional[datetime] = None) -> Optional[Dict[str, Any]]:
    """The bounded Project Workspace snapshot, or None when the caller does not
    own the project (route ⇒ 404, existence hidden). Never raises: every slice
    fails soft to empty so one unavailable subsystem degrades a section instead
    of breaking the page."""
    project = _owned_project(str(user_id or ""), str(project_id or ""))
    if project is None:
        return None
    when = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)

    observations = _read_observations(user_id, project_id)
    products = []
    try:
        from backend.services.orchestrator import project_products
        products = project_products.list_products(project_id, limit=_MAX_PRODUCTS)
    except Exception as exc:
        logger.debug("project_workspace: products unavailable: %s", exc)
    chats = _read_chats(user_id, project_id)
    goals = _read_goals(user_id, project_id)
    connectors = _read_connectors(user_id, project_id)

    # Summary — the Project Brain's OWN rule (a stashed summary memory, else the
    # sessions workspace). When the brain is disabled it returns "" and the
    # project's own description is the truthful fallback; when neither exists we
    # say nothing rather than inventing a description.
    summary_text, summary_source = "", ""
    try:
        from backend.services.project_brain import client as brain_client
        summary_text = _s(brain_client.client.summary_for(str(user_id), str(project_id)), 400)
        if summary_text:
            summary_source = "brain"
    except Exception as exc:
        logger.debug("project_workspace: brain summary unavailable: %s", exc)
    if not summary_text:
        summary_text = _s(getattr(project, "description", ""), 400).strip()
        summary_source = "project" if summary_text else ""

    attention = attention_mod.rank_attention(
        observations, products=products, now=when, limit=_MAX_ATTENTION)
    activity = _build_activity(observations, chats, products)

    last_observation_at = _max_iso(*[o.get("observed_at") for o in observations])
    last_chat_at = _max_iso(*[c.get("updated_at") for c in chats])
    last_product_at = _max_iso(*[p.get("updated_at") for p in products])
    last_sync_at = _max_iso(*[c.get("last_sync_at") for c in connectors])

    return {
        "project": {
            "id":          _s(project.id, 64),
            "name":        _s(project.name, 200),
            "description": _s(getattr(project, "description", ""), 400),
            "created_at":  _s(getattr(project, "created_at", ""), 64),
            "updated_at":  _s(getattr(project, "updated_at", ""), 64),
        },
        "summary":    {"text": summary_text, "source": summary_source},
        "goals":      goals,
        "attention":  attention,
        "activity":   activity,
        "products":   products,
        "chats":      chats,
        "connectors": connectors,
        "freshness": {
            "generated_at":            _now_iso(when),
            "last_activity_at":        _max_iso(last_observation_at, last_chat_at,
                                                last_product_at),
            "last_connector_sync_at":  last_sync_at,
            "last_observation_at":     last_observation_at,
            "last_chat_at":            last_chat_at,
            "last_product_at":         last_product_at,
        },
        "counts": {
            "attention":  len(attention),
            "activity":   len(activity),
            "goals":      len(goals),
            "products":   len(products),
            "chats":      len(chats),
            "connectors": len(connectors),
        },
    }


__all__ = ["build", "ACTIVITY_SOURCE_CHAT", "ACTIVITY_SOURCE_BUILD"]
