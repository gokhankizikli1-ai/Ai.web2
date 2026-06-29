# coding: utf-8
# Phase A.2 — Built-in project templates.
#
# Per the AI_OS_ROADMAP PR #2 scope: ship exactly TWO starter templates
# (generic-research, generic-creation). The Phase-C landing-page
# template ships in PR #3 on top of this scaffold — it is intentionally
# NOT here. Hard cap of 5 templates until usage data justifies more.
#
# Every agent_id below resolves via specs.get_spec (the 10 built-in
# specs from Phase 3.x): researcher, product_strategist, copywriter,
# brand_designer, etc. No new specs are invented here.

from __future__ import annotations

from backend.services.orchestrator.templates.base import (
    ProjectTemplate, TemplateNode,
)


# ── generic_research ─────────────────────────────────────────────────
#
# Linear 3-stage research pipeline: scope → gather → synthesise. The
# clearest demonstration of serial dependency execution.

GENERIC_RESEARCH = ProjectTemplate(
    id="generic_research",
    name="Generic Research",
    description=(
        "Scope a question, gather evidence, and synthesise a structured "
        "report. Three specialists run in series."
    ),
    workflow_type="research",
    nodes=[
        TemplateNode(
            key="scope",
            agent_id="researcher",
            title="Scope & plan the research",
            deliverable_kind="research_scope",
            task_instructions=(
                "Break the user's request into concrete research questions "
                "and a short plan for answering them. Be specific about what "
                "evidence would resolve each question."
            ),
            depends_on=[],
        ),
        TemplateNode(
            key="gather",
            agent_id="researcher",
            title="Gather & summarise sources",
            deliverable_kind="research_findings",
            task_instructions=(
                "Using the scope from the previous step, gather the most "
                "relevant evidence and summarise the key findings with "
                "citations where possible."
            ),
            depends_on=["scope"],
        ),
        TemplateNode(
            key="synthesize",
            agent_id="product_strategist",
            title="Synthesise the report",
            deliverable_kind="research_report",
            task_instructions=(
                "Synthesise the gathered findings into a clear, decision-ready "
                "report: what we now know, what remains uncertain, and the "
                "recommended next action."
            ),
            depends_on=["gather"],
        ),
    ],
)


# ── generic_creation ─────────────────────────────────────────────────
#
# Brief → [copy ∥ design] → assemble. Exercises a parallel fan-out (two
# specialists run concurrently after the brief) and a join (assemble
# waits for both). This is the shape the landing-page template (PR #3)
# generalises.

GENERIC_CREATION = ProjectTemplate(
    id="generic_creation",
    name="Generic Creation",
    description=(
        "Turn a creative request into a finished package: a brief, then "
        "copy and design produced in parallel, then an assembled result."
    ),
    workflow_type="research",
    nodes=[
        TemplateNode(
            key="brief",
            agent_id="product_strategist",
            title="Write the creative brief",
            deliverable_kind="creative_brief",
            task_instructions=(
                "Turn the user's request into a tight creative brief: "
                "audience, goal, tone, and the single key message."
            ),
            depends_on=[],
        ),
        TemplateNode(
            key="copy",
            agent_id="copywriter",
            title="Draft the copy",
            deliverable_kind="copy_draft",
            task_instructions=(
                "Using the brief, draft the headline, subheading, and primary "
                "body copy. Offer two variants of the headline."
            ),
            depends_on=["brief"],
        ),
        TemplateNode(
            key="design",
            agent_id="brand_designer",
            title="Propose the visual direction",
            deliverable_kind="design_concept",
            task_instructions=(
                "Using the brief, propose a visual direction: colour palette, "
                "typography, and layout notes that fit the audience and tone."
            ),
            depends_on=["brief"],
        ),
        TemplateNode(
            key="assemble",
            agent_id="product_strategist",
            title="Assemble the final package",
            deliverable_kind="final_package",
            task_instructions=(
                "Combine the copy and the visual direction into one coherent, "
                "ready-to-hand-off package. Note any gaps that still need a "
                "human decision."
            ),
            depends_on=["copy", "design"],
        ),
    ],
)


BUILTIN_TEMPLATES = (GENERIC_RESEARCH, GENERIC_CREATION)


__all__ = ["GENERIC_RESEARCH", "GENERIC_CREATION", "BUILTIN_TEMPLATES"]
