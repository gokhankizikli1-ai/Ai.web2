# coding: utf-8
"""
Phase 8 — ProjectBrainClient.

One method does the real work: `get(user_id, project_id)` assembles
a ProjectBrain by reading from memory_plane, sessions, assets, jobs,
workflows, and agent_tasks. Every source is wrapped in try/except so
a missing/disabled subsystem can never break the aggregator.

`build_context(...)` returns a ProjectContextBlock — a small string
suitable for direct system-prompt injection by the chat layer.
"""
from __future__ import annotations

import logging
import os
from typing import Optional

from backend.services.project_brain.types import ProjectBrain, ProjectContextBlock


logger = logging.getLogger(__name__)

_MAX_GOALS              = 4
_MAX_DECISIONS          = 4
_MAX_NOTES              = 4
_MAX_ASSETS             = 6
_MAX_WORKFLOWS          = 4
_MAX_CONNECTOR_SIGNALS  = 6         # recent Gmail/GitHub observations surfaced
# The correlation projection needs a wider slice of the SAME observations than
# the six raw signals we surface. Both come from ONE read: we ask the store for
# this many rows once and take the newest `_MAX_CONNECTOR_SIGNALS` of them for
# the raw list, so understanding the project costs no additional query.
_MAX_OBSERVATIONS_READ  = 60
_MAX_INTELLIGENCE       = 4         # correlated project states surfaced
_MAX_INTELLIGENCE_EVIDENCE = 2      # evidence lines rendered per state
_MAX_BUSINESS_KNOWLEDGE = 6         # durable typed knowledge entries surfaced
_MAX_PRODUCTS           = 6         # generated Web/App products surfaced
_MAX_CHATS              = 5         # project-linked chats whose CONTENT is surfaced
_MAX_CHAT_PREVIEW_CHARS = 160      # last-message preview per chat (bounded)
_MAX_CHAT_TURNS         = 6         # recent user/assistant turns per chat (bounded)
_MAX_CHAT_TURN_CHARS    = 240      # per-turn content cap (bounded)
_ORDINARY_CHAT_MODES    = ("", "chat")  # build/tool modes are excluded from content
_MAX_MEMORIES_AS_CTX    = 8
_CTX_BLOCK_CHAR_BUDGET  = 4000      # cap the prompt-injected block (raised for chat evidence)

# Generated Web/App products are read through the ONE project-product
# projection (`orchestrator.project_products`), which owns the deliverable-kind
# filter and the `content` unpacking for every surface. The canonical
# build/artifact authority still owns the payload; the brain surfaces only
# bounded references, never the source tree.


def is_enabled() -> bool:
    return os.getenv("ENABLE_PROJECT_BRAIN", "false").strip().lower() == "true"


def _owns_project(user_id: str, project_id: str) -> bool:
    """Ownership gate for project-scoped authorities that are keyed by
    `project_id` ONLY (goals/decisions/deliverables/threads) and therefore
    have no per-row user column to defend with.

    The canonical ownership authority is the `projects` store (the same record
    the Gmail/GitHub connector routes check on connect). A brain fetch pulls
    project-scoped data ONLY when that record exists AND belongs to the caller,
    so user B can never surface user A's products/chats/goals/decisions by
    guessing a project_id. Returns False (fail-closed) on any error or when the
    project is not in the canonical store — user-scoped slices (memory,
    connector signals, assets…) are unaffected and still surface."""
    if not (user_id and project_id):
        return False
    try:
        from backend.services.projects import store as projects_store
        p = projects_store.get_project(str(project_id))
        return bool(p) and str(p.owner_user_id) == str(user_id)
    except Exception as e:  # pragma: no cover — defensive; never break aggregation
        logger.debug("project_brain: ownership check unavailable: %s", e)
        return False


#: Inferred-state code → the English phrase used in the PROMPT. The backend
#: still never ships prose to the FRONTEND for these — the workspace payload
#: carries the stable codes and React renders them from its locale
#: dictionaries. This table exists only because a system prompt is English by
#: nature, and a model reading "state=likely_resolved" reasons worse than one
#: reading "looks resolved".
_STATE_PHRASE = {
    "unresolved":      "still unresolved",
    "conflicting":     "CONFLICTING evidence",
    "in_progress":     "in progress",
    "likely_resolved": "likely resolved",
    "observed":        "being discussed",
}


def _intelligence_lines(states: list) -> list:
    """The synthesized PROJECT STATE block.

    Deliberately not a dump of observations: each line is one correlated
    subject, what the evidence says it is, how confident that reading is and
    which tools agree — followed by at most a couple of concrete evidence
    references so the model can cite rather than guess. The raw connector list
    still appears further down, bounded, as recent activity."""
    lines: list[str] = []
    for state in states[:_MAX_INTELLIGENCE]:
        if not isinstance(state, dict):
            continue
        subject = str(state.get("subject") or "").strip()
        if not subject:
            continue
        confidence = state.get("confidence") or {}
        sources = [str(s) for s in (state.get("sources") or [])]
        phrase = _STATE_PHRASE.get(str(state.get("state")), str(state.get("state")))
        detail = [f"confidence {confidence.get('level', 'low')}"]
        if sources:
            detail.append(f"{len(sources)} source{'s' if len(sources) != 1 else ''}: "
                          + ", ".join(sources))
        evidence_count = state.get("evidence_count")
        if evidence_count:
            detail.append(f"{evidence_count} pieces of evidence")
        last_seen = str(state.get("last_seen") or "")[:10]
        if last_seen:
            detail.append(f"latest {last_seen}")
        lines.append(f"- {subject} — {phrase} ({'; '.join(detail)})")
        for label, key in (("supported by", "supporting"),
                           ("but contradicted by", "contradicting")):
            for item in (state.get(key) or [])[:_MAX_INTELLIGENCE_EVIDENCE]:
                if not isinstance(item, dict):
                    continue
                title = str(item.get("title") or item.get("kind") or "").strip()
                if title:
                    lines.append(f"    {label}: [{item.get('source', '?')}] {title}")
    return lines


class ProjectBrainClient:

    def is_enabled(self) -> bool:
        return is_enabled()

    # ── Project summary (the ONE resolution rule) ──────────────────────────

    def summary_for(
        self, user_id: str, project_id: str, *, memories: Optional[list] = None,
    ) -> str:
        """The project's deterministic one-paragraph summary, or "".

        Resolution order (unchanged from the original inline logic):
          1. a stashed `summary`-kind memory for this (user, project),
          2. the sessions workspace's own name/kind.

        Extracted so the Project Workspace read model can reuse the SAME rule
        instead of growing a second, subtly different "what is this project"
        answer. `memories` is injectable so `get()` — which already lists them —
        does not pay for a second Memory Plane read. Never raises."""
        if not is_enabled() or not user_id or not project_id:
            return ""
        recents = memories
        if recents is None:
            try:
                from backend.services.memory_plane import client as mp
                recents = mp.list_user(user_id, project_id=project_id, limit=50)
            except Exception as e:
                logger.debug("project_brain: memory_plane unavailable: %s", e)
                recents = []
        for m in recents or []:
            if getattr(m, "kind", None) == "summary" and getattr(m, "content", ""):
                return str(m.content)[:400]
        try:
            from backend.services.sessions import client as sc
            ws = sc.get_workspace(project_id)
            if ws is not None:
                return f"Project: {ws.name} ({ws.kind})."
        except Exception as e:
            logger.debug("project_brain: sessions unavailable: %s", e)
        return ""

    # ── Aggregator ─────────────────────────────────────────────────────────

    def get(self, user_id: str, project_id: str) -> Optional[ProjectBrain]:
        """Build a fresh ProjectBrain snapshot. Returns None when the
        flag is off OR when basic identity is missing."""
        if not is_enabled() or not user_id or not project_id:
            return None
        brain = ProjectBrain(project_id=project_id, user_id=str(user_id))

        # ── Memories: prefer goal / decision / preference / project_context.
        #    Bound OUTSIDE the try so a Memory Plane failure leaves an empty
        #    list (not an unbound name) for the summary resolution below.
        recents: list = []
        try:
            from backend.services.memory_plane import client as mp
            recents = mp.list_user(user_id, project_id=project_id, limit=50)
            # Bucket by kind so we can surface them under the right field.
            for m in recents:
                txt = (m.content or "").strip()
                if not txt:
                    continue
                if m.kind == "goal" and len(brain.current_goals) < _MAX_GOALS:
                    brain.current_goals.append(txt)
                elif m.kind == "decision" and len(brain.recent_decisions) < _MAX_DECISIONS:
                    brain.recent_decisions.append(txt)
                elif m.kind in {"project_context", "fact"} and \
                        len(brain.important_context) < _MAX_NOTES:
                    brain.important_context.append(txt)
        except Exception as e:
            logger.debug("project_brain: memory_plane unavailable: %s", e)

        # ── Project summary — the SINGLE resolution rule (stashed summary
        #    memory, else the sessions workspace), shared with the Project
        #    Workspace read model. `recents` is handed over so the Memory Plane
        #    is read exactly once per aggregation.
        brain.project_summary = self.summary_for(
            user_id, project_id, memories=recents)

        # ── Assets: link summaries from the analyses cache.
        try:
            from backend.services.assets import client as ac
            from backend.services.vision import client as vc
            assets = ac.list_user(user_id, project_id=project_id, limit=_MAX_ASSETS)
            for a in assets:
                entry = {
                    "id":       a.id,
                    "filename": a.filename,
                    "type":     a.asset_type,
                    "status":   a.status,
                }
                cached = vc.get_cached(a.id or "") if a.id else None
                if cached and cached.get("summary"):
                    entry["summary"] = cached["summary"][:200]
                brain.linked_assets.append(entry)
        except Exception as e:
            logger.debug("project_brain: assets unavailable: %s", e)

        # ── Workflows: in-flight workflow snapshots.
        try:
            from backend.services.workflows import client as wfc
            for wf in wfc.list_user(user_id, project_id=project_id, limit=_MAX_WORKFLOWS):
                brain.workflow_state.append({
                    "id":       wf.id,
                    "type":     wf.type,
                    "status":   wf.status,
                    "progress": wf.progress,
                })
        except Exception as e:
            logger.debug("project_brain: workflows unavailable: %s", e)

        # ── Agent tasks: most-recent task summaries.
        try:
            from backend.services.agent_tasks import client as atc
            for t in atc.list_user(user_id, project_id=project_id, limit=4):
                if t.summary:
                    brain.agent_notes.append(t.summary[:160])
        except Exception as e:
            logger.debug("project_brain: agent_tasks unavailable: %s", e)

        # ── Connector signals: recent Gmail/GitHub observations for THIS project.
        #    Read through the canonical observation authority (no new store, no
        #    connector-specific engine), owner-scoped defensively so a brain
        #    fetch can never surface another user's connector activity. These are
        #    INPUTS ONLY — read here for context/reasoning; they never create a
        #    task/decision/run (the Business Brain remains the sole prioritizer).
        observations: list = []
        try:
            from backend.services.orchestrator import observations_store as obs
            observations = obs.recent_observations(
                project_id, user_id=str(user_id),
                sources=list(obs.CONNECTOR_SOURCES),
                limit=_MAX_OBSERVATIONS_READ)
            for o in observations[:_MAX_CONNECTOR_SIGNALS]:
                brain.connector_signals.append({
                    "source":      o.get("source"),
                    "kind":        o.get("kind"),
                    "summary":     (o.get("summary") or "")[:200],
                    "observed_at": o.get("observed_at"),
                    "importance":  o.get("importance"),
                    "external_id": o.get("external_id"),
                })
        except Exception as e:
            logger.debug("project_brain: observations unavailable: %s", e)

        # ── Correlated project state — what those signals ADD UP TO.
        #    A pure projection over the rows just read (no second query, no
        #    provider call, no model call, no write). This is the synthesized
        #    truth the prompt leads with; the raw signals above stay as bounded
        #    evidence beneath it rather than being the whole story.
        try:
            from backend.services import project_intelligence as pi
            brain.intelligence = pi.project_states(
                observations, limit=_MAX_INTELLIGENCE)
        except Exception as e:
            logger.debug("project_brain: project intelligence unavailable: %s", e)

        # ── Durable typed BUSINESS KNOWLEDGE (Business Brain Phase 3).
        #    AUDIT FINDING: the brain collected goals, decisions, products,
        #    chats and connector signals but never read the business-knowledge
        #    authority at all, so a competitor price or a recorded learning
        #    reached an agent run (through `orchestrator.project_intelligence`)
        #    yet never reached project CHAT. Same adapter, same Memory Plane,
        #    no new store — it just needed consuming. The Memory Plane scopes
        #    every read by user_id AND project_id, so this is structurally
        #    owner-isolated exactly like the memory slice above.
        try:
            from backend.services.orchestrator import business_knowledge as bk
            brain.business_knowledge = bk.list_knowledge(
                user_id=str(user_id), project_id=str(project_id),
                limit=_MAX_BUSINESS_KNOWLEDGE)
        except Exception as e:
            logger.debug("project_brain: business knowledge unavailable: %s", e)

        # ── Project-scoped authorities (goals / decisions / products / chats).
        #    These stores are keyed by project_id ONLY, so they are pulled behind
        #    a fail-closed ownership gate (see `_owns_project`). Everything above
        #    is already user-scoped; only this block needs the gate.
        if _owns_project(str(user_id), project_id):
            # Structured active goals — the authoritative Business Brain goals
            # (hierarchy, success criteria), distinct from memory-plane goal
            # notes. Merge titles into current_goals, deduped, staying bounded.
            try:
                from backend.services.orchestrator import goals_store
                have = {g.strip().lower() for g in brain.current_goals}
                for g in goals_store.active_goals(project_id, limit=_MAX_GOALS):
                    title = (g.get("title") or "").strip()
                    if title and title.lower() not in have and \
                            len(brain.current_goals) < _MAX_GOALS:
                        brain.current_goals.append(title)
                        have.add(title.lower())
            except Exception as e:
                logger.debug("project_brain: goals_store unavailable: %s", e)

            # Authoritative active decisions (topic → value), superseded-aware.
            try:
                from backend.services.orchestrator import decisions_store
                have_d = {d.strip().lower() for d in brain.recent_decisions}
                for d in decisions_store.active_decisions(project_id, limit=_MAX_DECISIONS):
                    topic = (d.get("topic") or "").strip()
                    value = (d.get("value") or "").strip()
                    if not value:
                        continue
                    line = f"{topic}: {value}" if topic else value
                    if line.lower() not in have_d and \
                            len(brain.recent_decisions) < _MAX_DECISIONS:
                        brain.recent_decisions.append(line)
                        have_d.add(line.lower())
            except Exception as e:
                logger.debug("project_brain: decisions_store unavailable: %s", e)

            # Generated Web/App products — bounded references from the canonical
            # deliverables authority. The build payload/source tree stays in the
            # artifact authority; the brain carries only refs + status + type.
            try:
                from backend.services.orchestrator import project_products
                for p in project_products.list_products(project_id, limit=_MAX_PRODUCTS):
                    entry = dict(p)
                    entry["title"] = str(entry.get("title") or "")[:160]
                    brain.products.append(entry)
            except Exception as e:
                logger.debug("project_brain: product projection unavailable: %s", e)

            # Project-linked chats — the durable workspace's conversations. Reads
            # the canonical project↔thread binding, then the sessions authority
            # (server messages are canonical; localStorage is never consulted).
            # For each ORDINARY chat bound to THIS project we surface a bounded
            # excerpt of the most-recent substantive user/assistant turns so the
            # brain can actually reason over what was discussed — not just the
            # title. Build/tool sessions are excluded from content (their payloads
            # live in the artifact authority and are represented as products).
            # Threads are owner-scoped defensively via their workspace, so a
            # removed/moved binding immediately changes what is surfaced (this is
            # recomputed every call — no cache).
            try:
                from backend.services.projects import store as projects_store
                from backend.services.sessions import client as sc
                links = projects_store.list_project_threads(project_id)
                for link in links:
                    if len(brain.linked_chats) >= _MAX_CHATS:
                        break
                    th = sc.get_thread(link.thread_id)
                    if th is None:
                        continue
                    ws = sc.get_workspace(th.workspace_id)
                    if ws is None or str(ws.user_id) != str(user_id):
                        continue   # defense-in-depth owner check
                    is_ordinary = str(th.mode or "") in _ORDINARY_CHAT_MODES
                    recent: list[dict] = []
                    last_msg = ""
                    if is_ordinary:
                        try:
                            for m in sc.list_recent_messages(th.id, limit=_MAX_CHAT_TURNS):
                                if m.role not in ("user", "assistant"):
                                    continue   # omit system/tool turns
                                content = (m.content or "").strip()
                                if not content:
                                    continue
                                recent.append({
                                    "role":       m.role,
                                    "content":    content[:_MAX_CHAT_TURN_CHARS],
                                    "created_at": m.created_at,
                                })
                            if recent:
                                last_msg = recent[-1]["content"][:_MAX_CHAT_PREVIEW_CHARS]
                        except Exception:
                            pass
                    brain.linked_chats.append({
                        "thread_id":    th.id,
                        "title":        th.title,
                        "mode":         th.mode,
                        "updated_at":   th.updated_at,
                        "last_message": last_msg,
                        "recent":       recent,   # bounded substantive turns (ordinary chats)
                    })
            except Exception as e:
                logger.debug("project_brain: project chats unavailable: %s", e)

        # ── Counts: cheap health snapshot.
        brain.counts = {
            "goals":           len(brain.current_goals),
            "decisions":       len(brain.recent_decisions),
            "context_notes":   len(brain.important_context),
            "linked_assets":   len(brain.linked_assets),
            "active_workflows":len(brain.workflow_state),
            "agent_notes":     len(brain.agent_notes),
            "connector_signals": len(brain.connector_signals),
            "intelligence":    len(brain.intelligence),
            "business_knowledge": len(brain.business_knowledge),
            "products":        len(brain.products),
            "linked_chats":    len(brain.linked_chats),
        }
        return brain

    # ── Prompt-injection helper ────────────────────────────────────────────

    def build_context(
        self, user_id: str, project_id: str,
    ) -> Optional[ProjectContextBlock]:
        """Compose the system-prompt fragment. Returns None when the
        brain is empty OR the subsystem is disabled — the chat layer
        treats None as 'nothing to inject'."""
        brain = self.get(user_id, project_id)
        if brain is None:
            return None
        lines: list[str] = []
        if brain.project_summary:
            lines.append(f"Project context:\n{brain.project_summary}")
        if brain.current_goals:
            lines.append("Current goals:")
            lines.extend(f"- {g}" for g in brain.current_goals)
        if brain.recent_decisions:
            lines.append("Recent decisions:")
            lines.extend(f"- {d}" for d in brain.recent_decisions)
        if brain.important_context:
            lines.append("Important context:")
            lines.extend(f"- {c}" for c in brain.important_context)
        if brain.linked_assets:
            lines.append("Attached assets:")
            for a in brain.linked_assets[:_MAX_ASSETS]:
                line = f"- [{a.get('type','?')}] {a.get('filename','?')}"
                if a.get("summary"):
                    line += f" — {a['summary']}"
                lines.append(line)
        if brain.workflow_state:
            lines.append("Active workflows:")
            for w in brain.workflow_state:
                lines.append(
                    f"- {w.get('type','?')} ({w.get('status','?')}, "
                    f"{w.get('progress',0)}%)"
                )
        if brain.agent_notes:
            lines.append("Agent notes:")
            lines.extend(f"- {n}" for n in brain.agent_notes)
        if brain.products:
            lines.append("Generated products:")
            for p in brain.products[:_MAX_PRODUCTS]:
                title = p.get("title") or "(untitled)"
                bt = (p.get("build_type") or "web").upper()
                status = p.get("status") or "?"
                lines.append(f"- [{bt}] {title} ({status})")
        if brain.linked_chats:
            # Each project chat is rendered as a clearly-separated block with a
            # bounded excerpt of its recent user/assistant turns, so the model can
            # reason over what was actually discussed/decided in this project.
            lines.append("Project chat excerpts (most recent turns per chat):")
            for ch in brain.linked_chats[:_MAX_CHATS]:
                title = ch.get("title") or "(untitled chat)"
                lines.append(f"— Chat: {title}")
                recent = ch.get("recent") or []
                if recent:
                    for turn in recent:
                        role = turn.get("role", "user")
                        content = (turn.get("content") or "").strip()
                        if content:
                            lines.append(f"  {role}: {content}")
                else:
                    preview = ch.get("last_message")
                    if preview:
                        lines.append(f"  {preview}")
        if brain.business_knowledge:
            lines.append("Business knowledge & learnings (durable, provenance-tagged; "
                         "external facts may be stale — weigh by recency):")
            for entry in brain.business_knowledge[:_MAX_BUSINESS_KNOWLEDGE]:
                domain = str(entry.get("domain") or "knowledge").upper()
                source = str(entry.get("source") or "SYSTEM").upper()
                observed = str(entry.get("observed_at") or "")[:10]
                when = f" (observed {observed})" if observed else ""
                lines.append(f"- [{domain} · {source}] "
                             f"{str(entry.get('summary') or '')[:220]}{when}")
        if brain.intelligence:
            # The synthesized truth leads. It is placed ABOVE the raw activity
            # deliberately: a model handed twenty loose events reasons about
            # events, and a model handed "the payment webhook looks resolved,
            # here is why" reasons about the project.
            lines.append("Project state — what the evidence across the connected "
                         "tools adds up to (correlated, not raw events):")
            lines.extend(_intelligence_lines(brain.intelligence))
        if brain.connector_signals:
            # Header text is pinned by tests and by the frontend's expectations;
            # the "prefer the synthesis" instruction lives on the PROJECT STATE
            # header above, which is where a model reading top-down meets it
            # first anyway.
            lines.append("Recent connector activity:")
            for s in brain.connector_signals[:_MAX_CONNECTOR_SIGNALS]:
                label = s.get("summary") or s.get("kind") or "activity"
                lines.append(f"- [{s.get('source','?')}] {label}")

        if not lines:
            return None
        text = "\n".join(lines)
        if len(text) > _CTX_BLOCK_CHAR_BUDGET:
            text = text[:_CTX_BLOCK_CHAR_BUDGET] + "\n…"
        return ProjectContextBlock(text=text, metadata=brain.counts)

    def stats(self) -> dict:
        return {"enabled": is_enabled()}


client: ProjectBrainClient = ProjectBrainClient()


__all__ = ["ProjectBrainClient", "client", "is_enabled"]
