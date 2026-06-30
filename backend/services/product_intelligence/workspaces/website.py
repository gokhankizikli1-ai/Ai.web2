# coding: utf-8
"""Website / App workspace profile."""
from backend.services.product_intelligence.registry import WorkspaceProfile, register_workspace
from backend.services.product_intelligence.types import (
    WorkspaceKind, ProductCategory, GenerationMode, InteractionStyle,
)

PROFILE = WorkspaceProfile(
    kind=WorkspaceKind.WEBSITE_APP,
    title="Website / App",
    keywords={
        "website": 1.0, "web site": 1.0, "landing": 1.0, "landing page": 1.2,
        "webpage": 0.9, "homepage": 0.9, "site": 0.5, "web app": 1.2,
        "webapp": 1.2, "app": 0.6, "application": 0.6, "dashboard": 0.8,
        "portfolio": 1.0, "blog": 0.8, "saas": 0.9, "frontend": 0.7,
        "ui": 0.5, "page": 0.5, "build me a site": 1.4,
    },
    patterns=[
        (r"\b(build|create|make|design)\s+(a|an|me)?\s*(website|web app|landing)", 1.4),
        (r"\bnext\.?js|react|tailwind|vue\b", 0.6),
    ],
    default_category=ProductCategory.WEB_APP,
    default_renderer="html",
    default_generation_mode=GenerationMode.INTERACTIVE_APP,
    default_interaction=InteractionStyle.INTERACTIVE,
    typical_industry="technology",
    typical_audience="end users / visitors",
    typical_goal="present a product and convert visitors",
    base_agents=["researcher", "ux_designer", "frontend_engineer", "qa_engineer"],
    feature_hints=[
        "Responsive layout", "Navigation", "Hero / value proposition",
        "Call-to-action", "Content sections", "Contact / capture form",
    ],
    screen_hints=["Home", "Features", "Pricing", "About", "Contact"],
    information_architecture=[
        "Top navigation → primary sections",
        "Hero → features → social proof → pricing → CTA → footer",
    ],
    interaction_model="Click-through navigation with smooth scroll and form submission.",
    data_entities=["Page", "Section", "Lead/Contact"],
    ux_direction="Clear hierarchy, fast scan, single primary CTA per screen.",
    visual_direction="Modern, clean, brand-consistent; tasteful motion.",
    risks=[
        "Scope creep into full app when a static site suffices",
        "Unclear primary conversion goal",
    ],
    success_metrics=["Conversion rate", "Bounce rate", "Time to first paint"],
    deliverables=["Page blueprint", "Component/screen list", "Single-file HTML prototype"],
    future_expansion=["CMS integration", "Auth + accounts", "Analytics", "Multi-page app"],
)

register_workspace(PROFILE)
