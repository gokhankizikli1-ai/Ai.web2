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
    projects.tasks_store    the user's own project tasks  (read-only)
    projects.knowledge      decisions + durable knowledge (read-only projection)
    projects.views_store    this user's last-visit marker (read-only)
    attention               the deterministic ranking     (pure)
    today                   the deterministic Today block (pure)
    recent_changes          "since your last visit"       (pure)
    project_intelligence    correlated + INTERPRETED
                            project state, and the
                            project-level synthesis       (pure)

WHAT IT IS NOT
--------------
  * NOT a second Project Brain. The prompt-injection aggregate
    (`ProjectBrainClient.get`) is untouched and still owns what the model sees;
    this owns what the PAGE sees. They share the summary rule and the product
    projection rather than each answering the same question differently.
  * NOT a second observation store, and NOT a connector sync. Nothing here calls
    Gmail / GitHub / Vercel / Slack / Calendar. Opening the Project page performs
    ZERO provider API calls — it reads what a previous explicit sync ingested.
  * NOT a writer. No task, run, candidate action, decision, memory,
    observation — and NOT even the last-visit marker — is created by reading
    this. "Observation ≠ execution" holds, and so does "reading is not
    visiting": the marker only moves on the page's EXPLICIT
    `POST /workspace/seen` acknowledgement, which is why the change list is not
    emptied by the very read that computed it.
  * NOT a model call. Nothing here spends a token.
  * NOT a second task, decision or memory system. Tasks come from the one
    canonical project-task authority; knowledge is a projection over the
    EXISTING decision and project-memory authorities.
  * NOT a second RANKING system. `project_state` is a correlation of the SAME
    observations `attention` already ranks — what they add up to, not a rival
    opinion about what is urgent. It never reorders Needs Attention and never
    feeds Today's ladder; it only lets a row say which story it belongs to.
    `project_understanding` is the project-level reading of those same
    subjects, in the same order: no health score, no percentage, no second
    opinion about urgency.

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
from backend.services.project_brain import recent_changes as changes_mod
from backend.services.project_brain import today as today_mod

logger = logging.getLogger(__name__)

# ── Bounds (all deliberate; the page is meant to be scannable) ───────────────
_MAX_OBSERVATIONS_READ = 60   # the slice attention + activity are derived from
_MAX_ACTIVITY = 12
_MAX_ATTENTION = attention_mod.MAX_ATTENTION
_MAX_GOALS = 5
_MAX_PRODUCTS = 8
_MAX_CHATS = 8
_MAX_CONNECTOR_RESOURCES = 4  # resource labels named per provider before "+N"
_MAX_TASKS_READ = 40          # the slice Today + the change list are derived from
_MAX_TASKS = 6                # rows in the Overview's compact task block
# The knowledge ROWS are read at the projection's hard cap; the knowledge
# COUNTS come from a separate exact aggregate (`knowledge.count_by_kind`), not
# from `len()` over this list. Deriving them from the capped read would report
# "100 recorded" for a project holding 120 — the same invariant the task
# authority follows: the list is bounded, the counts are the truth.
_MAX_KNOWLEDGE_READ = 100
_MAX_KNOWLEDGE = 4            # rows in the Overview's compact knowledge block
_MAX_CHANGES = changes_mod.MAX_CHANGES
_MAX_PROJECT_STATE = 5        # correlated subjects shown in the Project State block

#: Activity rows carry these non-connector sources so the frontend can label
#: them without inventing a provider.
ACTIVITY_SOURCE_CHAT = "chat"
ACTIVITY_SOURCE_BUILD = "build"
ACTIVITY_SOURCE_TASK = "task"
ACTIVITY_SOURCE_KNOWLEDGE = "knowledge"


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


#: The SAME gate, exported. Every route that touches a project's tasks,
#: knowledge or view marker goes through this one function rather than
#: re-deriving "does this person own this project?" — one implementation means
#: one place to get it right, and one place a test can attack.
owned_project = _owned_project


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


def _read_tasks(user_id: str, project_id: str) -> List[dict]:
    """This user's project tasks, in the task authority's own canonical order
    (doing → todo → waiting → done, then priority DESC, created_at ASC).

    Read-only: the workspace NEVER creates, moves or completes a task. Both
    scopes are enforced in the store — the row must belong to this project AND
    this owner — on top of the project ownership gate above."""
    try:
        from backend.services.projects import tasks_store
        return tasks_store.list_tasks(str(project_id), owner_user_id=str(user_id),
                                      limit=_MAX_TASKS_READ)
    except Exception as exc:
        logger.debug("project_workspace: tasks unavailable: %s", exc)
        return []


def _task_counts(user_id: str, project_id: str) -> Dict[str, int]:
    try:
        from backend.services.projects import tasks_store
        return tasks_store.count_by_status(str(project_id),
                                           owner_user_id=str(user_id))
    except Exception as exc:
        logger.debug("project_workspace: task counts unavailable: %s", exc)
        return {}


def _read_knowledge(project_id: str) -> List[dict]:
    """Durable project knowledge — a PROJECTION over the existing decision and
    project-memory authorities (see `projects.knowledge`). No new store, and
    nothing here promotes a chat message into knowledge."""
    try:
        from backend.services.projects import knowledge as knowledge_mod
        return knowledge_mod.list_knowledge(str(project_id),
                                            limit=_MAX_KNOWLEDGE_READ)
    except Exception as exc:
        logger.debug("project_workspace: knowledge unavailable: %s", exc)
        return []


def _knowledge_counts(project_id: str) -> Dict[str, int]:
    """EXACT knowledge counts — two indexed aggregates, never `len()` over the
    bounded row read above."""
    try:
        from backend.services.projects import knowledge as knowledge_mod
        return knowledge_mod.count_by_kind(str(project_id))
    except Exception as exc:
        logger.debug("project_workspace: knowledge counts unavailable: %s", exc)
        return {}


def _headline_knowledge(items: List[dict]) -> List[dict]:
    """The few knowledge rows the Overview shows: decisions, requirements and
    constraints only. Notes and loose facts are real knowledge but they are not
    what someone scanning a project needs first, so they live in the Knowledge
    view. Already newest-first from the projection."""
    try:
        from backend.services.projects import knowledge as knowledge_mod
        headline = set(knowledge_mod.HEADLINE_KINDS)
    except Exception:   # pragma: no cover — defensive
        return []
    return [i for i in items if i.get("kind") in headline][:_MAX_KNOWLEDGE]


def _read_view_marker(user_id: str, project_id: str) -> str:
    """When this user last ACKNOWLEDGED a visit to this project, or "" when they
    never have. Purely a read — see the module docstring on why the marker never
    moves here."""
    try:
        from backend.services.projects import views_store
        return _s(views_store.get_last_viewed_at(str(user_id), str(project_id)), 64)
    except Exception as exc:
        logger.debug("project_workspace: view marker unavailable: %s", exc)
        return ""


def _change_rows(observations: List[dict], chats: List[dict],
                 products: List[dict], tasks: List[dict],
                 knowledge: List[dict], *, now: datetime) -> List[dict]:
    """Every candidate change, normalized and given a DEDUP KEY naming the
    real-world thing it is about. `recent_changes.build_changes` then keeps the
    newest row per key inside the window, so five deploy attempts on one target
    read as one change and a task moved twice reads as one line.

    A connector row borrows its key from `attention`'s subject when the
    observation is one of the classified concepts — that is the same identity
    the supersession rules already use, so "deploy failed" and the later "deploy
    recovered" collapse onto each other rather than both being reported.

    AUDIT FINDING, fixed here: that subject is `vercel:deploy:<vercel project
    id>:production` — it EMBEDS an opaque provider resource id, and this key
    travels in the payload. `attention` digests exactly these before shipping
    them (`stable_id`) precisely because they are not something a client asked
    to see; the change list was shipping them raw, against this module's own
    stated invariant. Connector keys are now digested through the SAME
    function, so the identity still dedups exactly as before and the provider
    id stays on the server. Korvix's own ids (a thread, a deliverable, a task)
    are unaffected: those are already in the payload by name."""
    rows: List[dict] = []
    for o in observations or []:
        signal = attention_mod.classify_observation(o, now=now)
        subject = _s(signal.get("subject"), 200) if signal else ""
        source = _s(o.get("source"), 40)
        title = _s(o.get("summary"), 240) or _s(o.get("kind"), 120)
        identity = subject or f"{source}:{_s(o.get('kind'), 120)}:{title[:80]}"
        rows.append(changes_mod.change_row(
            key=f"connector:{attention_mod.stable_id(identity)}",
            change=changes_mod.CHANGE_CONNECTOR, source=source, title=title,
            occurred_at=o.get("observed_at")))
    for c in chats or []:
        thread_id = _s(c.get("thread_id"), 64)
        rows.append(changes_mod.change_row(
            key=f"chat:{thread_id}", change=changes_mod.CHANGE_CHAT,
            source=ACTIVITY_SOURCE_CHAT, title=_s(c.get("title"), 240),
            occurred_at=c.get("updated_at"), ref=thread_id))
    for p in products or []:
        ref = _s(p.get("deliverable_id"), 200)
        rows.append(changes_mod.change_row(
            key=f"build:{ref}", change=changes_mod.CHANGE_BUILD,
            source=ACTIVITY_SOURCE_BUILD, title=_s(p.get("title"), 240),
            detail=_s(p.get("status"), 60), occurred_at=p.get("updated_at"),
            ref=ref))
    for t in tasks or []:
        tid = _s(t.get("id"), 64)
        rows.append(changes_mod.change_row(
            key=f"task:{tid}", change=changes_mod.CHANGE_TASK,
            source=ACTIVITY_SOURCE_TASK, title=_s(t.get("title"), 240),
            detail=_s(t.get("status"), 40), occurred_at=t.get("updated_at"),
            ref=tid))
    for k in knowledge or []:
        kid = _s(k.get("id"), 64)
        rows.append(changes_mod.change_row(
            key=f"knowledge:{kid}", change=changes_mod.CHANGE_KNOWLEDGE,
            source=ACTIVITY_SOURCE_KNOWLEDGE, title=_s(k.get("text"), 240),
            detail=_s(k.get("kind"), 40), occurred_at=k.get("created_at"),
            ref=kid))
    return rows


def _build_activity(observations: List[dict], chats: List[dict],
                    products: List[dict], tasks: List[dict] = (),
                    knowledge: List[dict] = ()) -> List[dict]:
    """ONE unified "what changed around this project" stream.

    Presentation is normalized here; STORAGE is not — every row still lives in
    its own authority and is simply projected onto a common shape. Connector
    rows carry the observation's own bounded `summary` (which the normalizers
    already produced for humans), never the raw payload object.

    Ordering: timestamp DESC, then source ASC, then id ASC (stable), then ONE
    global bound. Deliberately no per-kind or per-source quota.

    A quota was tried and removed. It cannot promote anything — it can only
    drop the Nth row of a kind — so it never surfaces an important event; it
    only hides real ones, and it hides them even when nothing is competing for
    the space (five CI failures and nothing else would still show three). It
    also makes the rendered count silently smaller than the bound with nothing
    saying so. Importance is not this function's job: `attention.py` owns
    "which few things deserve a look now" and Today reads from that. Activity
    answers a different question — "what happened, newest first" — and a
    chronology that quietly drops events to look balanced is not a chronology.
    If a push burst fills the timeline, that burst genuinely is the newest
    thing that happened, and the deploy that failed this morning is still
    sitting in Needs Attention where it belongs."""
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

    for t in tasks or []:
        rows.append({
            "id":          _s(t.get("id"), 64),
            "source":      ACTIVITY_SOURCE_TASK,
            "kind":        f"task.{_s(t.get('status'), 40) or 'todo'}",
            "title":       _s(t.get("title"), 240),
            "occurred_at": _s(t.get("updated_at"), 64),
            "ref":         _s(t.get("id"), 64),
        })
    for k in knowledge or []:
        rows.append({
            "id":          _s(k.get("id"), 64),
            "source":      ACTIVITY_SOURCE_KNOWLEDGE,
            "kind":        f"knowledge.{_s(k.get('kind'), 40) or 'note'}",
            "title":       _s(k.get("text"), 240),
            "occurred_at": _s(k.get("created_at"), 64),
            "ref":         _s(k.get("id"), 64),
        })

    def _key(row: dict):
        parsed = attention_mod.parse_iso(row.get("occurred_at"))
        stamp = parsed.timestamp() if parsed is not None else float("-inf")
        return (-stamp, str(row.get("source") or ""), str(row.get("id") or ""))

    rows.sort(key=_key)
    return rows[:_MAX_ACTIVITY]


#: Fields on a correlated state that exist for BACKEND consumers and have no
#: renderer on the page. `facets` is the structural per-target reading
#: `interpretation`, `synthesis` and `candidate_synthesis` reason over; the page
#: shows what that reasoning CONCLUDED (`understanding`) plus the evidence
#: lists, never the raw per-target rows. Shipping it anyway would roughly
#: double the size of every subject in the payload to no one's benefit.
_INTERNAL_STATE_FIELDS = ("facets",)


def _page_state_rows(states: List[dict]) -> List[dict]:
    """The subject rows as the PAGE sees them.

    A shallow copy per row, deliberately: the originals are the same objects
    the membership index points at, and `_link_attention_to_state` must keep
    matching against those rather than against a payload projection."""
    return [{k: v for k, v in state.items() if k not in _INTERNAL_STATE_FIELDS}
            for state in states or [] if isinstance(state, dict)]


def _link_attention_to_state(attention: List[dict],
                             membership: Dict[str, dict]) -> None:
    """Tell each Needs-Attention row which correlated story it belongs to.

    ENRICHMENT ONLY — in place, and deliberately nothing else. The list keeps
    `attention`'s order, its membership and its severity: a correlated state
    can neither promote a row, demote one, nor add one. All this does is let
    the page render "Deployment failed — part of: payment webhook (conflicting
    evidence, 3 sources)" instead of an alarm with no story around it.

    Matching is by the observation id each side already carries, so it is exact
    and costs no re-classification.

    `membership` is the correlation authority's COMPLETE member index, not a
    state's public `evidence_observation_ids` — that list is capped for payload
    size, so an alarm whose row happened to sort past the cap would silently
    render with no story attached even though the layer had understood it."""
    if not (attention and membership):
        return
    for item in attention:
        state = membership.get(_s(item.get("observation_id"), 64))
        if not state:
            continue
        item["state_id"] = _s(state.get("id"), 64)
        item["state"] = _s(state.get("state"), 40)
        item["state_subject"] = _s(state.get("subject"), 200)
        item["state_evidence_count"] = int(state.get("evidence_count") or 0)
        # The CONFIDENCE LEVEL is deliberately NOT copied here. Today renders
        # the top attention row verbatim, and Today is contractually free of
        # score/confidence/health vocabulary — a rule worth keeping for its own
        # sake: a bare "high" floating on an alarm, separated from the
        # breakdown that justifies it, is exactly the unearned precision this
        # codebase refuses to ship. Confidence travels in `project_state`,
        # where its full component breakdown travels with it.


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
    tasks = _read_tasks(user_id, project_id)
    knowledge = _read_knowledge(project_id)

    # Summary — the Project Brain's OWN rule (a stashed summary memory, else the
    # sessions workspace). When the brain is disabled it returns "" and the
    # project's own description is the truthful fallback; when neither exists we
    # say nothing rather than inventing a description.
    summary_text, summary_source = "", ""
    try:
        # Import the SINGLETON by name, not the module. `project_brain/__init__`
        # re-exports `client` (the ProjectBrainClient instance), which shadows
        # the submodule of the same name on the package — so
        # `from backend.services.project_brain import client` yields the
        # INSTANCE. This used to read `brain_client.client.summary_for(...)`,
        # which raised AttributeError on every call; the except below swallowed
        # it, so the workspace silently fell back to the project description and
        # the shared summary rule this module documents was never actually in
        # effect. Importing the instance directly is unambiguous either way.
        from backend.services.project_brain.client import client as brain_client
        summary_text = _s(brain_client.summary_for(str(user_id), str(project_id)), 400)
        if summary_text:
            summary_source = "brain"
    except Exception as exc:
        logger.debug("project_workspace: brain summary unavailable: %s", exc)
    if not summary_text:
        summary_text = _s(getattr(project, "description", ""), 400).strip()
        summary_source = "project" if summary_text else ""

    attention = attention_mod.rank_attention(
        observations, products=products, now=when, limit=_MAX_ATTENTION)

    # PROJECT STATE — what the connector observations ADD UP TO, correlated
    # across sources. Computed from the rows ALREADY read above, so the page
    # understands the project without issuing a single extra query, calling a
    # provider, or spending a token. Pure and fail-soft like every other slice.
    project_state: List[dict] = []
    project_understanding: Dict[str, Any] = {}
    state_membership: Dict[str, dict] = {}
    try:
        from backend.services import project_intelligence as pi
        # ONE call for both halves, so the subject list and the project-level
        # reading are guaranteed to describe the same rows at the same instant.
        # Each subject arrives already INTERPRETED (affected areas, what the
        # evidence implies, what is still unknown) — the page renders that; it
        # derives none of it.
        project_state, project_understanding, state_membership = (
            pi.understand_with_membership(
                observations, now=when, limit=_MAX_PROJECT_STATE))
    except Exception as exc:
        logger.debug("project_workspace: project intelligence unavailable: %s", exc)
    _link_attention_to_state(attention, state_membership)

    activity = _build_activity(observations, chats, products, tasks, knowledge)

    # TODAY — pure choice over the ranking + the project's own tasks and goals.
    # Chooses, never re-ranks; creates nothing.
    today = today_mod.build_today(attention=attention, tasks=tasks, goals=goals)

    # SINCE YOUR LAST VISIT — or, when this user has never acknowledged a visit
    # here, a truthfully-labelled "recent" window. The marker is READ, never
    # written: see the module docstring.
    last_viewed_at = _read_view_marker(user_id, project_id)
    changes = changes_mod.build_changes(
        _change_rows(observations, chats, products, tasks, knowledge, now=when),
        last_viewed_at=last_viewed_at, now=when, limit=_MAX_CHANGES)
    changes["last_viewed_at"] = last_viewed_at

    last_observation_at = _max_iso(*[o.get("observed_at") for o in observations])
    last_chat_at = _max_iso(*[c.get("updated_at") for c in chats])
    last_product_at = _max_iso(*[p.get("updated_at") for p in products])
    last_task_at = _max_iso(*[t.get("updated_at") for t in tasks])
    last_knowledge_at = _max_iso(*[k.get("created_at") for k in knowledge])
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
        "today":      today,
        "goals":      goals,
        "attention":  attention,
        "project_state": _page_state_rows(project_state),
        # WHAT IT ALL ADDS UP TO — the project-level reading of the subjects
        # above. Not a health score and not a second ranking: a state code
        # from the SAME vocabulary the subjects use, honest coverage, and the
        # bounded open / uncertain / resolved / blocked / not-known slices of
        # the order `project_state` is already in. `{}` is never returned —
        # an empty project gets an honest empty reading instead.
        "project_understanding": project_understanding,
        "activity":   activity,
        "changes":    changes,
        "tasks": {
            "items":  tasks[:_MAX_TASKS],
            "counts": _task_counts(user_id, project_id),
        },
        "knowledge": {
            "items":  _headline_knowledge(knowledge),
            "counts": _knowledge_counts(project_id),
        },
        "products":   products,
        "chats":      chats,
        "connectors": connectors,
        "freshness": {
            "generated_at":            _now_iso(when),
            "last_activity_at":        _max_iso(last_observation_at, last_chat_at,
                                                last_product_at, last_task_at,
                                                last_knowledge_at),
            "last_connector_sync_at":  last_sync_at,
            "last_observation_at":     last_observation_at,
            "last_chat_at":            last_chat_at,
            "last_product_at":         last_product_at,
            "last_task_at":            last_task_at,
            "last_knowledge_at":       last_knowledge_at,
        },
        "counts": {
            "attention":  len(attention),
            "project_state": len(project_state),
            "project_state_open": len((project_understanding or {}).get("open") or []),
            "activity":   len(activity),
            "goals":      len(goals),
            "products":   len(products),
            "chats":      len(chats),
            "connectors": len(connectors),
            "tasks":      len(tasks),
            "knowledge":  len(knowledge),
            "changes":    int(changes.get("count") or 0),
        },
    }


__all__ = ["build", "owned_project",
           "ACTIVITY_SOURCE_CHAT", "ACTIVITY_SOURCE_BUILD",
           "ACTIVITY_SOURCE_TASK", "ACTIVITY_SOURCE_KNOWLEDGE"]
