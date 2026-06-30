# coding: utf-8
"""General Productivity workspace profile — automations, tools, internal apps."""
from backend.services.product_intelligence.registry import WorkspaceProfile, register_workspace
from backend.services.product_intelligence.types import (
    WorkspaceKind, ProductCategory, GenerationMode, InteractionStyle,
)

PROFILE = WorkspaceProfile(
    kind=WorkspaceKind.PRODUCTIVITY,
    title="General Productivity",
    keywords={
        "automation": 1.2, "automate": 1.1, "workflow": 1.0, "tool": 0.7,
        "internal tool": 1.1, "crm": 1.0, "tracker": 0.9, "todo": 0.9,
        "task manager": 1.1, "notes": 0.7, "spreadsheet": 0.8,
        "scheduler": 0.9, "calendar": 0.8, "admin panel": 1.0,
        "productivity": 1.1, "organize": 0.6,
    },
    patterns=[
        (r"\b(automate|streamline)\s+(my|our|the)?\b", 1.1),
        (r"\b(internal|admin)\s+(tool|app|panel|dashboard)", 1.1),
    ],
    default_category=ProductCategory.AUTOMATION,
    default_renderer="dashboard",
    default_generation_mode=GenerationMode.INTERACTIVE_APP,
    default_interaction=InteractionStyle.DATA_DRIVEN,
    typical_industry="general",
    typical_audience="internal teams",
    typical_goal="reduce manual effort and organise work",
    base_agents=["product_strategist", "frontend_engineer", "backend_engineer"],
    feature_hints=[
        "Record management (CRUD)", "Lists & filters", "Status workflow",
        "Bulk actions", "Notifications",
    ],
    screen_hints=["Dashboard", "List", "Detail", "Settings"],
    information_architecture=[
        "Dashboard → list → detail; settings + automations",
    ],
    interaction_model="Data-driven CRUD with filters and status transitions.",
    data_entities=["Record", "Status", "User", "Action log"],
    ux_direction="Efficient, keyboard-friendly, information-dense.",
    visual_direction="Utilitarian, neutral palette, clear table/list affordances.",
    risks=[
        "Reinventing an existing off-the-shelf tool",
        "Unclear single source of truth for data",
    ],
    success_metrics=["Time saved", "Task throughput", "Adoption"],
    deliverables=["Tool blueprint", "Data & workflow model", "Screen list"],
    future_expansion=["Integrations/webhooks", "Roles & permissions", "Reporting"],
)

register_workspace(PROFILE)
