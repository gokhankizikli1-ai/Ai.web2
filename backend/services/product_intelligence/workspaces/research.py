# coding: utf-8
"""Research Workspace profile (planning only)."""
from backend.services.product_intelligence.registry import WorkspaceProfile, register_workspace
from backend.services.product_intelligence.types import (
    WorkspaceKind, ProductCategory, GenerationMode, InteractionStyle,
)

PROFILE = WorkspaceProfile(
    kind=WorkspaceKind.RESEARCH,
    title="Research Workspace",
    keywords={
        "research": 1.3, "report": 0.9, "analysis": 0.8, "analyze": 0.8,
        "literature": 1.0, "survey": 0.8, "compare": 0.6, "study": 0.9,
        "deep dive": 1.1, "investigate": 0.9, "summarize": 0.8,
        "white paper": 1.1, "citations": 1.0, "sources": 0.7,
        "find out": 0.6, "explain": 0.5,
    },
    patterns=[
        (r"\b(research|investigate|analyze)\s+(the|about|on)?\b", 1.1),
        (r"\b(literature|market)\s+review\b", 1.1),
    ],
    default_category=ProductCategory.RESEARCH_REPORT,
    default_renderer="document",
    default_generation_mode=GenerationMode.DOCUMENT,
    default_interaction=InteractionStyle.STATIC,
    typical_industry="general",
    typical_audience="analysts / decision makers",
    typical_goal="produce a grounded, cited synthesis",
    base_agents=["researcher", "analyst", "reporter"],
    feature_hints=[
        "Question framing", "Source gathering", "Synthesis", "Citations",
        "Key findings", "Recommendations",
    ],
    screen_hints=["Question", "Findings", "Evidence", "Recommendations"],
    information_architecture=[
        "Question → method → findings (cited) → analysis → recommendations",
    ],
    interaction_model="Structured read-through with traceable citations.",
    data_entities=["Question", "Source", "Claim", "Citation"],
    ux_direction="Evidence-first; every claim traceable to a source.",
    visual_direction="Clean document layout, readable typography.",
    risks=[
        "Unsourced claims / hallucinated facts",
        "Over-broad scope without a crisp question",
    ],
    success_metrics=["Source quality", "Claim coverage", "Answer specificity"],
    deliverables=["Research blueprint", "Source plan", "Cited report outline"],
    future_expansion=["Live web research providers", "Embeddings/RAG", "Export to doc"],
)

register_workspace(PROFILE)
