# coding: utf-8
# EPIC 1 / M2 — App / dashboard / game prototype template.
#
# Produces a REAL, previewable frontend prototype (not just a plan):
#   concept ──► screens ─┐
#                        ▼
#                     prototype  (single-file, self-contained HTML → iframe)
#                        │
#                        ▼
#                      files     (component / file list)
#
# Always-on built-in (no feature flag): it only adds a choice to the
# catalog and is gated by the orchestrator's own master flag. Used by
# the coordinator for app / dashboard / game / website-fallback requests
# ("Build a fitness app", "Design a dashboard", "Build a simple game").

from __future__ import annotations

from backend.services.orchestrator.templates.base import (
    ProjectTemplate, TemplateNode,
)

APP_PROTOTYPE = ProjectTemplate(
    id="app_prototype",
    name="App Prototype",
    description=(
        "Turn an app / dashboard / game idea into a real, previewable "
        "frontend prototype: concept → screens → a single-file HTML "
        "prototype you can preview and download → a component/file list."
    ),
    workflow_type="website_recreation",
    nodes=[
        TemplateNode(
            key="concept",
            agent_id="product_strategist",
            title="App concept",
            deliverable_kind="app_concept",
            task_instructions=(
                "From the user's request, define the app concept: the core "
                "value, the target user, and the top 3-5 features for an MVP. "
                "Keep it tight and concrete."
            ),
            depends_on=[],
        ),
        TemplateNode(
            key="screens",
            agent_id="ux_designer",
            title="Screen structure",
            deliverable_kind="screen_structure",
            task_instructions=(
                "Define the screen/navigation structure for the MVP: list the "
                "primary screens, what each contains, and how the user moves "
                "between them. Note the single most important screen to "
                "prototype first."
            ),
            depends_on=["concept"],
        ),
        TemplateNode(
            key="prototype",
            agent_id="coder",
            title="Interactive prototype",
            deliverable_kind="app_prototype_html",
            task_instructions=(
                "Build a REAL, previewable prototype of the app's primary "
                "screen(s) as ONE complete, self-contained HTML document: all "
                "CSS inline in a <style> tag, no external assets or network "
                "calls, mobile-first and responsive, with a realistic header / "
                "navigation and representative content. Use the concept and "
                "screen structure above. Output ONLY the HTML document "
                "(starting with <!DOCTYPE html>), ready to open in a browser."
            ),
            depends_on=["concept", "screens"],
        ),
        TemplateNode(
            key="files",
            agent_id="coder",
            title="Component & file list",
            deliverable_kind="file_list",
            task_instructions=(
                "List the components and files a production implementation of "
                "this app would have (e.g. src/components/*, src/pages/*, "
                "state, API layer). For each, one line on its responsibility. "
                "Present it as a clear file tree."
            ),
            depends_on=["prototype"],
        ),
    ],
)

APP_TEMPLATES = (APP_PROTOTYPE,)

__all__ = ["APP_PROTOTYPE", "APP_TEMPLATES"]
