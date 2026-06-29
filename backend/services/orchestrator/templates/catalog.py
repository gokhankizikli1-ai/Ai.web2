# coding: utf-8
# Phase A.2 — Project template catalog + selection.
#
# The catalog is the read-only registry of built-in templates plus the
# logic that decides which template a free-form user request maps to.
# Two selection paths:
#
#   1. Explicit  — caller passes a known template_id.
#   2. Implicit  — caller passes only a user_request; we ask the
#                  Coordinator (Phase 9) for its rule-based plan and
#                  either map the intent to a built-in template or build
#                  an AD-HOC template from the plan's agent list.
#
# The ad-hoc path is what makes the orchestrator work for ANY request
# without a hand-authored template: the coordinator already resolves a
# message to a small DAG of real specialists; we turn that DAG into a
# one-off ProjectTemplate.

from __future__ import annotations

import logging
import re
from typing import Dict, List, Optional

from backend.services.orchestrator.templates.base import (
    ProjectTemplate, TemplateNode, TemplateError,
)
from backend.services.orchestrator.templates.builtins import BUILTIN_TEMPLATES
from backend.services.orchestrator.templates.app import APP_TEMPLATES
from backend.services.orchestrator.templates import landing_page as _landing

logger = logging.getLogger(__name__)


# Validate every built-in once at import — a malformed built-in is a
# programming error we want to surface immediately, not at run time.
# APP_TEMPLATES (M2) are always-on built-ins (no feature flag).
_REGISTRY: Dict[str, ProjectTemplate] = {}
for _t in (*BUILTIN_TEMPLATES, *APP_TEMPLATES):
    _t.validate()
    _REGISTRY[_t.id] = _t


# Phase C — flag-gated vertical templates. These are validated at import
# (correctness is flag-independent) but only become VISIBLE in the
# catalog when their feature flag is on, so the template surface is
# byte-identical to the always-on built-ins until a flag is flipped.
# Map: template_id -> (template, enabled_predicate).
_GATED_TEMPLATES: Dict[str, tuple] = {
    _landing.LANDING_PAGE_TEMPLATE_ID: (_landing.LANDING_PAGE, _landing.is_enabled),
}


def _enabled_gated() -> List[ProjectTemplate]:
    return [tpl for (tpl, enabled) in _GATED_TEMPLATES.values() if enabled()]


def get_template(template_id: str) -> Optional[ProjectTemplate]:
    tid = (template_id or "").strip()
    hit = _REGISTRY.get(tid)
    if hit is not None:
        return hit
    gated = _GATED_TEMPLATES.get(tid)
    if gated is not None and gated[1]():
        return gated[0]
    return None


def list_templates() -> List[ProjectTemplate]:
    return list(_REGISTRY.values()) + _enabled_gated()


# ── Ad-hoc template from a coordinator Plan ──────────────────────────

def _slug(text: str, fallback: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "_", (text or "").lower()).strip("_")
    return s or fallback


def build_adhoc_template(plan, user_request: str) -> ProjectTemplate:
    """Convert a coordinator `Plan` into a one-off ProjectTemplate.

    Each `AgentInvocation` becomes a node keyed by its agent_id;
    `depends_on` (agent_ids in the plan) maps straight onto node-key
    dependencies because the coordinator already keys its DAG by
    agent_id. Duplicate agent_ids are de-duplicated (the coordinator
    can list an agent once as primary and again as a follower — we keep
    the first).
    """
    from backend.services.orchestrator.templates.base import ProjectTemplate

    nodes: List[TemplateNode] = []
    seen: set[str] = set()
    for inv in getattr(plan, "agents", []) or []:
        aid = getattr(inv, "agent_id", None)
        if not aid or aid in seen:
            continue
        seen.add(aid)
        reason = getattr(inv, "reason", "") or ""
        deps = [d for d in (getattr(inv, "depends_on", []) or []) if d]
        nodes.append(TemplateNode(
            key=aid,
            agent_id=aid,
            title=f"{aid.replace('_', ' ').title()}",
            deliverable_kind=f"{aid}_output",
            task_instructions=(
                f"{reason}\n\nUser request:\n{user_request}".strip()
            ),
            depends_on=deps,
        ))

    # Drop dependencies that reference agents the plan didn't include
    # (defensive — keeps the ad-hoc DAG self-consistent).
    known = {n.key for n in nodes}
    nodes = [
        TemplateNode(
            key=n.key, agent_id=n.agent_id, title=n.title,
            deliverable_kind=n.deliverable_kind,
            task_instructions=n.task_instructions,
            depends_on=[d for d in n.depends_on if d in known],
        )
        for n in nodes
    ]

    if not nodes:
        # Empty plan — fall back to a single supervisor node so the run
        # always has at least one deliverable.
        nodes = [TemplateNode(
            key="supervisor",
            agent_id="supervisor",
            title="Handle the request",
            deliverable_kind="response",
            task_instructions=user_request or "Assist the user.",
            depends_on=[],
        )]

    intent = getattr(plan, "intent", "adhoc") or "adhoc"
    template = ProjectTemplate(
        id=f"adhoc_{_slug(intent, 'plan')}",
        name=f"Ad-hoc: {intent}",
        description="Generated from the coordinator's rule-based plan.",
        workflow_type="research",
        nodes=nodes,
    )
    # Validate; if the coordinator somehow produced a cyclic plan, fall
    # back to a flat (no-dependency) version so the run still proceeds.
    try:
        template.validate()
    except TemplateError as exc:
        logger.warning("catalog.build_adhoc_template: %s — flattening deps", exc)
        flat = [
            TemplateNode(
                key=n.key, agent_id=n.agent_id, title=n.title,
                deliverable_kind=n.deliverable_kind,
                task_instructions=n.task_instructions, depends_on=[],
            )
            for n in nodes
        ]
        template = ProjectTemplate(
            id=template.id, name=template.name, description=template.description,
            workflow_type="research", nodes=flat,
        )
        template.validate()
    return template


# ── Implicit selection ───────────────────────────────────────────────

_CREATION_HINT = re.compile(
    r"\b(build|create|design|write|draft|generate|produce|make|"
    r"landing\s+page|copy|logo|brand|kur|tasarla|oluştur|yaz)\b",
    re.IGNORECASE,
)
_RESEARCH_HINT = re.compile(
    r"\b(research|investigate|compare|analy[sz]e|find\s+out|look\s+up|"
    r"market|competitor|araştır|incele|karşılaştır|report)\b",
    re.IGNORECASE,
)
# M2 — specialized-intent routing. A WEB request → an HTML page
# (landing_page when its flag is on, else the always-on app prototype
# which also emits HTML). An APP/dashboard/game request → the app
# prototype. These take precedence so app/website asks stop landing on
# the text-only generic_creation template (requirement #5).
_WEB_HINT = re.compile(
    r"\b(website|web\s*site|web\s*page|landing\s*page|home\s*page|"
    r"store\s*page|shopify|site)\b",
    re.IGNORECASE,
)
_APP_HINT = re.compile(
    r"\b(app|application|dashboard|saas|crm|game|prototype|mobile|"
    r"android|ios|discord\s*bot|bot|web\s*app|admin\s*panel|ui)\b",
    re.IGNORECASE,
)


def choose_template(user_request: str, plan=None) -> ProjectTemplate:
    """Pick a template for a free-form request.

    Order (most specific first):
      1. Specialized intents — WEB → landing_page (or app prototype), and
         APP/dashboard/game → app prototype. These emit real previewable
         artifacts and take precedence over the generic templates.
      2. Research intent → generic_research.
      3. A multi-agent coordinator plan (>1 distinct agent) → ad-hoc.
      4. Creation intent → generic_creation. Research is the safe default.
    """
    text = user_request or ""

    # 1. Specialized intents → artifact-producing templates.
    if _WEB_HINT.search(text):
        return get_template("landing_page") or _REGISTRY["app_prototype"]
    if _APP_HINT.search(text):
        return _REGISTRY["app_prototype"]

    # 2. Research intent.
    if _RESEARCH_HINT.search(text):
        return _REGISTRY["generic_research"]

    distinct_agents = 0
    if plan is not None:
        distinct_agents = len({
            getattr(a, "agent_id", None) for a in (getattr(plan, "agents", []) or [])
            if getattr(a, "agent_id", None)
        })

    # 3. Multi-agent plan → ad-hoc.
    if distinct_agents > 1:
        return build_adhoc_template(plan, user_request)

    # 4. Creation intent / default.
    if _CREATION_HINT.search(text):
        return _REGISTRY["generic_creation"]
    # No strong signal — default to research (lowest-risk multi-step
    # plan; never fabricates creative output for a vague request).
    return _REGISTRY["generic_research"]


__all__ = [
    "get_template", "list_templates",
    "build_adhoc_template", "choose_template",
]
