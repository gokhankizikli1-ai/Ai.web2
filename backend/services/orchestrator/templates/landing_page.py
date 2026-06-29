# coding: utf-8
# Phase C — Landing Page Generator vertical.
#
# The first end-to-end vertical of the AI OS, built ENTIRELY on the
# existing Project Orchestrator (PR #182) + DAG runner (PR #181). It is
# just one more `ProjectTemplate` — no new orchestrator, runner, store,
# or job kind. The 5-node DAG matches the roadmap:
#
#     research ──► brand   ─┐
#              └─► copy ────┤
#     brand ───────────────►│  (design consumes the brand direction)
#                           ▼
#                         design ─┐
#     copy ──────────────────────┤  (code consumes copy + wireframe)
#                                 ▼
#                               code  (final single-file HTML page)
#
# i.e. research → [brand ∥ copy] → design(from brand) → code(from copy + design).
# The roadmap's separate "assemble" step is folded into `code`: the
# Coder emits ONE self-contained HTML document as its deliverable, so the
# frontend can preview it in an iframe and offer a client-side download
# WITHOUT any new asset-pipeline backend (reuses the deliverable registry
# as-is).
#
# Gated by ENABLE_LANDING_PAGE_TEMPLATE: the template is only visible in
# the catalog (selection + listing) when the flag is on, so production
# behaviour is byte-identical until it's flipped.

from __future__ import annotations

import os

from backend.services.orchestrator.templates.base import (
    ProjectTemplate, TemplateNode,
)

LANDING_PAGE_TEMPLATE_ID = "landing_page"


def is_enabled() -> bool:
    """ENABLE_LANDING_PAGE_TEMPLATE — read on every call so a Railway
    flag flip is live without a restart. Default OFF."""
    return os.getenv("ENABLE_LANDING_PAGE_TEMPLATE", "false").strip().lower() == "true"


LANDING_PAGE = ProjectTemplate(
    id=LANDING_PAGE_TEMPLATE_ID,
    name="Landing Page",
    description=(
        "Five specialists collaborate to build a complete landing page: "
        "research → brand + copy (in parallel) → design → a single-file "
        "HTML page you can preview and download."
    ),
    workflow_type="website_recreation",
    nodes=[
        TemplateNode(
            key="research",
            agent_id="researcher",
            title="Research the product & audience",
            deliverable_kind="research_brief",
            task_instructions=(
                "Research the product and its target audience from the user's "
                "request. Produce a concise brief: who the audience is, the core "
                "value proposition, key benefits to highlight, and 3 competitor "
                "angles to differentiate against."
            ),
            depends_on=[],
        ),
        TemplateNode(
            key="brand",
            agent_id="brand_designer",
            title="Define the brand direction",
            deliverable_kind="brand_brief",
            task_instructions=(
                "Using the research brief, define the visual brand direction for "
                "the landing page: a colour palette (with hex values), typography "
                "pairing, and the overall tone/mood. Keep it implementable in "
                "plain HTML/CSS."
            ),
            depends_on=["research"],
        ),
        TemplateNode(
            key="copy",
            agent_id="copywriter",
            title="Write the landing-page copy",
            deliverable_kind="copy_variants",
            task_instructions=(
                "Using the research brief, write the landing-page copy: a hero "
                "headline (offer TWO A/B variants), a supporting subheading, three "
                "benefit blurbs, and a primary call-to-action. Label the two "
                "headline variants clearly as A and B."
            ),
            depends_on=["research"],
        ),
        TemplateNode(
            key="design",
            agent_id="ux_designer",
            title="Design the page layout",
            deliverable_kind="wireframe",
            task_instructions=(
                "Using the brand direction, specify the landing-page layout: the "
                "section order (hero, benefits, social proof, CTA, footer), the "
                "structure of each section, and concrete style notes (spacing, "
                "button styles) a developer can implement directly."
            ),
            depends_on=["brand"],
        ),
        TemplateNode(
            key="code",
            agent_id="coder",
            title="Build the HTML landing page",
            deliverable_kind="landing_page_html",
            task_instructions=(
                "Build the final landing page as ONE complete, self-contained "
                "HTML document with all CSS inline in a <style> tag and no "
                "external assets or scripts. Use the approved copy and the layout "
                "+ brand direction from the previous steps. Output ONLY the HTML "
                "document (starting with <!DOCTYPE html>), ready to open directly "
                "in a browser."
            ),
            depends_on=["copy", "design"],
        ),
    ],
)

# Validate the DAG at import — a malformed vertical template is a
# programming error we want surfaced immediately (flag-independent;
# only VISIBILITY is gated, not correctness).
LANDING_PAGE.validate()


__all__ = ["LANDING_PAGE", "LANDING_PAGE_TEMPLATE_ID", "is_enabled"]
