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
_MAX_MEMORIES_AS_CTX    = 8
_CTX_BLOCK_CHAR_BUDGET  = 2000      # cap the prompt-injected block


def is_enabled() -> bool:
    return os.getenv("ENABLE_PROJECT_BRAIN", "false").strip().lower() == "true"


class ProjectBrainClient:

    def is_enabled(self) -> bool:
        return is_enabled()

    # ── Aggregator ─────────────────────────────────────────────────────────

    def get(self, user_id: str, project_id: str) -> Optional[ProjectBrain]:
        """Build a fresh ProjectBrain snapshot. Returns None when the
        flag is off OR when basic identity is missing."""
        if not is_enabled() or not user_id or not project_id:
            return None
        brain = ProjectBrain(project_id=project_id, user_id=str(user_id))

        # ── Memories: prefer goal / decision / preference / project_context.
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
            # Project summary — try a stashed "summary" kind first.
            for m in recents:
                if m.kind == "summary" and m.content:
                    brain.project_summary = m.content[:400]
                    break
        except Exception as e:
            logger.debug("project_brain: memory_plane unavailable: %s", e)

        # ── Sessions: lightweight workspace metadata if we have access.
        try:
            from backend.services.sessions import client as sc
            ws = sc.get_workspace(project_id)
            if ws is not None and not brain.project_summary:
                brain.project_summary = f"Project: {ws.name} ({ws.kind})."
        except Exception as e:
            logger.debug("project_brain: sessions unavailable: %s", e)

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

        # ── Counts: cheap health snapshot.
        brain.counts = {
            "goals":           len(brain.current_goals),
            "decisions":       len(brain.recent_decisions),
            "context_notes":   len(brain.important_context),
            "linked_assets":   len(brain.linked_assets),
            "active_workflows":len(brain.workflow_state),
            "agent_notes":     len(brain.agent_notes),
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
