# coding: utf-8
"""
Web Build Path Audit — the static capability map (source of truth).

Every value here is derived from the actual call graph (call sites, request bodies,
returned artifacts), NOT from comments. References are given as ``file:symbol`` so a
reviewer can verify each claim. It contains no prompts, code, secrets, or user data.

Key established facts (evidence in each entry):
  • The user-facing WebsiteBuilder is FRONTEND-DRIVEN: it calls POST /chat with
    mode=website_builder (planning) and mode=frontend_builder (source generation), and
    POST /v2/web-build/images/stock/source (image sourcing). It does NOT use the backend
    orchestrator (agent.run) path.
  • The recent design-intelligence integrations (personality/visual/motion/quality/
    adaptation) are composed ONLY in web_build_context.build_web_build_design_context,
    whose sole non-test caller is orchestrator/agent_run_kind.py. The /chat route,
    mode_manager and prompt_manager import none of those packages — so that intelligence
    never reaches the frontend_builder model that writes the website source files.
  • Image intelligence (Smart Image + Visual Image Context) DOES reach the real path,
    via the stock-source endpoint the frontend calls.
  • Quality evaluation is STATIC ONLY (renderedScreenshotReviewed=false).
"""
from __future__ import annotations

from backend.services.web_build_path_audit.models import (
    Capability, CapabilityStatus as S, Gap, GapSeverity as Sev, Stage, WebBuildPathAudit,
)

VERSION = "web-build-path-audit-v1"


def _backend_intelligence_missing(stage_note: str) -> list:
    """The five backend design-intelligence packages, all MISSING on the frontend path."""
    ev = "web_build_context/__init__.py:build_web_build_design_context (sole caller: orchestrator/agent_run_kind.py)"
    return [
        Capability("design_personality", S.MISSING, "backend/services/design_personality", note=stage_note),
        Capability("visual_intelligence", S.MISSING, "backend/services/visual_intelligence", note=stage_note),
        Capability("motion_intelligence", S.MISSING, "backend/services/motion_intelligence", note=stage_note),
        Capability("quality_guard", S.MISSING, "backend/services/web_quality_guard", note=stage_note),
        Capability("generation_adaptation", S.MISSING, "backend/services/generation_adaptation", note=ev),
    ]


def build_audit() -> WebBuildPathAudit:
    """Return the static production-path audit. Pure — no I/O, no runtime state."""
    _chat_note = "frontend posts to /chat; routes/chat.py imports no intelligence package"

    planning = Stage(
        name="planning",
        mode="website_builder (LLM prompt via prompt_manager)",
        entry="src/lib/webBuildApi.ts:generateWebBuild → POST /chat",
        capabilities=_backend_intelligence_missing(_chat_note),
        facts={"prose_only": True},
    )

    frontend_generation = Stage(
        name="frontend_generation",
        mode="frontend_builder (LLM, generates frontend-files-v1)",
        entry="src/lib/webBuildFrontendQuality.ts → src/lib/webBuildAgents.ts:generateFrontendBuilderRaw → POST /chat",
        capabilities=_backend_intelligence_missing(
            "consumes the frontendBuildSpec only; backend intelligence packages not on this path"
        ) + [
            Capability("visual_strategy_frontend", S.INDIRECT,
                       "src/lib/webBuildVisualIntelligence.ts", "runVisualIntelligence",
                       note="a SEPARATE frontend visual_intelligence /chat mode; influences image slots + designSystem, not the backend package"),
            Capability("sourced_assets", S.APPLIED,
                       "src/lib/webBuildImageSourcing.ts", "sourceStockImagesForPayload",
                       note="spec.assets.imageSlots enriched with real URLs BEFORE the frontend_builder call"),
        ],
        facts={"spec_sent": "identity + designSystem + architecture + assets.imageSlots + research"},
    )

    visual_planning = Stage(
        name="visual_planning",
        mode="visual_intelligence (LLM /chat mode — distinct from backend visual_intelligence package)",
        entry="src/lib/webBuildVisualIntelligence.ts:runVisualIntelligence → POST /chat",
        capabilities=[
            Capability("uses_backend_visual_intelligence_package", S.NOT_APPLICABLE,
                       "backend/services/visual_intelligence",
                       note="the frontend visual planner is a separate LLM implementation"),
            Capability("may_create_image_slots", S.MISSING,
                       "src/lib/webBuildImageSourcing.ts", "deriveImageNeeds",
                       note="only classifies EXISTING spec.assets.imageSlots; cannot add a slot"),
        ],
        facts={
            "candidate_source": "existing-image-slots-only",
            "may_create_slots": False,
            "maximum_photo_slots": 8,
        },
    )

    image_sourcing = Stage(
        name="image_sourcing",
        mode="POST /v2/web-build/images/stock/source",
        entry="src/lib/webBuildImageSourcing.ts:sourceStockImagesForPayload",
        capabilities=[
            Capability("smart_image_intelligence", S.DISABLED,
                       "backend/services/image_intelligence", "select_assets",
                       note="wired to the real endpoint; gated by ENABLE_SMART_IMAGES (default off)"),
            Capability("visual_image_context", S.DISABLED,
                       "backend/services/image_intelligence/visual_image_context.py", "enrich_design_context",
                       note="wired to the real endpoint; gated by ENABLE_VISUAL_IMAGE_CONTEXT (default off)"),
        ],
        facts={
            "frontend_limit": 8,           # src/lib/webBuildImageSourcing.ts:MAX_SOURCED_IMAGES
            "backend_limit": 16,           # backend/services/web_build_images/sourcing.py:MAX_IMAGES
            "endpoint_max": 16,            # routes/v2_web_build_images.py:StockSourceBody.maxImages le=16
            "limits_consistent": False,
            "requires_preexisting_slot": True,
        },
    )

    rendered_evaluation = Stage(
        name="rendered_evaluation",
        mode="static-only (parse + design review)",
        entry="src/lib/webBuildFrontendValidation.ts + src/lib/webBuildFrontendReview.ts",
        capabilities=[
            Capability("static_file_validation", S.APPLIED,
                       "src/lib/webBuildFrontendValidation.ts", "parseAndValidateFrontendBuilderRaw",
                       note="parses frontend-files-v1 + validates structure/copy — STATIC ONLY"),
            Capability("static_design_review", S.APPLIED,
                       "src/lib/webBuildFrontendReview.ts", note="LLM/heuristic review of source text"),
        ],
        facts={
            "screenshot_reviewed": False,   # webBuildFrontendQuality.ts:renderedScreenshotReviewed=false
            "dom_reviewed": False,
            "runtime_compilation_reviewed": False,
            "semantically_empty_skeleton_can_pass": True,
        },
    )

    revision = Stage(
        name="revision",
        mode="frontend_builder (single edit call)",
        entry="src/lib/webBuildFrontendRevision.ts:runFrontendBuilderRevision",
        capabilities=[
            Capability("reruns_visual_intelligence", S.MISSING,
                       "src/lib/webBuildFrontendRevision.ts",
                       note="no runVisualIntelligence call in the revision path"),
            Capability("reruns_image_sourcing", S.MISSING,
                       "src/lib/webBuildFrontendRevision.ts",
                       note="no sourceStockImagesForPayload call in the revision path"),
            Capability("receives_backend_intelligence", S.MISSING,
                       "src/lib/webBuildFrontendRevision.ts"),
        ],
        facts={"single_frontend_builder_edit": True},
    )

    orchestrator_path = Stage(
        name="orchestrator_path_reference",
        mode="agent.run (generation.build_prompt + web_build_context)",
        entry="backend/services/orchestrator/agent_run_kind.py:_agent_run_handler",
        capabilities=[
            Capability("design_personality", S.DISABLED, "backend/services/web_build_context", note="gated ENABLE_DESIGN_PERSONALITY"),
            Capability("visual_motion_quality_adaptation", S.DISABLED, "backend/services/web_build_context", note="gated by their own flags"),
            Capability("used_by_websitebuilder", S.MISSING,
                       "backend/services/orchestrator/agent_run_kind.py",
                       note="the frontend WebsiteBuilder never invokes the agent.run path"),
        ],
        facts={"is_production_websitebuilder_path": False},
    )

    flags = [
        {"name": "ENABLE_DESIGN_PERSONALITY", "default": False, "gates": "design_personality (orchestrator path only)"},
        {"name": "ENABLE_VISUAL_CONTEXT_INJECTION", "default": False, "gates": "visual+motion design intelligence (orchestrator path only)"},
        {"name": "ENABLE_WEB_QUALITY_GUARD", "default": False, "gates": "quality guard (orchestrator path only)"},
        {"name": "ENABLE_GENERATION_ADAPTATION", "default": False, "gates": "generation adaptation (orchestrator path only)"},
        {"name": "ENABLE_DESIGN_OBSERVABILITY", "default": False, "gates": "decision trace recording"},
        {"name": "ENABLE_DESIGN_DEBUG", "default": False, "gates": "design-trace debug endpoint"},
        {"name": "ENABLE_SMART_IMAGES", "default": False, "gates": "smart image selection (real image endpoint)"},
        {"name": "ENABLE_VISUAL_IMAGE_CONTEXT", "default": False, "gates": "visual→image query enrichment (real image endpoint)"},
        {"name": "ENABLE_WEB_BUILD_PATH_AUDIT", "default": False, "gates": "this audit endpoint"},
    ]

    gaps = [
        Gap("generation-context-disconnected", Sev.CRITICAL,
            "The design intelligence (personality/visual/motion/quality/adaptation) is composed only in "
            "build_web_build_design_context, whose sole caller is the orchestrator agent.run path; the "
            "frontend_builder model that writes the website source files never receives it.",
            "web_build_context/__init__.py:build_web_build_design_context ↔ orchestrator/agent_run_kind.py"),
        Gap("production-path-divergence", Sev.CRITICAL,
            "The user-facing WebsiteBuilder uses the frontend-driven /chat path (website_builder + "
            "frontend_builder modes), not the backend orchestrator path where the intelligence was added.",
            "src/lib/webBuildApi.ts:generateWebBuild + webBuildAgents.ts:generateFrontendBuilderRaw"),
        Gap("no-rendered-evaluation", Sev.CRITICAL,
            "Generated output is evaluated STATIC-ONLY (no screenshot/DOM/runtime); a semantically empty "
            "animated skeleton can pass validation.",
            "src/lib/webBuildFrontendQuality.ts:renderedScreenshotReviewed=false"),
        Gap("visual-strategy-slot-bound", Sev.HIGH,
            "The visual planner can only classify existing spec.assets.imageSlots; it cannot create a new "
            "slot, so sections with no candidate slot receive no real image.",
            "src/lib/webBuildImageSourcing.ts:deriveImageNeeds"),
        Gap("layout-contract-unenforced", Sev.HIGH,
            "Layout/art-direction fields (selectedVisualDirection, heroComposition, sectionRhythm, "
            "visualSignature, architecture.sections) are prose guidance with no acceptance check that the "
            "generated files complied.",
            "src/lib/webBuildAgents.ts (FrontendSpecDesignSystem) + webBuildFrontendValidation.ts"),
        Gap("image-limit-inconsistency", Sev.MEDIUM,
            "Frontend requests at most 8 images while the backend/endpoint allow 16.",
            "webBuildImageSourcing.ts:MAX_SOURCED_IMAGES=8 vs web_build_images/sourcing.py:MAX_IMAGES=16"),
        Gap("revision-intelligence-missing", Sev.MEDIUM,
            "Revisions do not rerun visual intelligence or image sourcing and receive no design intelligence, "
            "so they can regress toward generic output.",
            "src/lib/webBuildFrontendRevision.ts:runFrontendBuilderRevision"),
        Gap("duplicated-visual-systems", Sev.MEDIUM,
            "Two parallel visual/design-intelligence implementations exist: the frontend art-direction + "
            "visual_intelligence LLM system (reaches production) and the backend design packages "
            "(orchestrator path only).",
            "src/lib/webBuildVisualIntelligence.ts vs backend/services/visual_intelligence"),
    ]

    return WebBuildPathAudit(
        version=VERSION,
        entry_path="frontend-driven",
        generated_from="static-call-graph",
        stages=[planning, frontend_generation, visual_planning, image_sourcing,
                rendered_evaluation, revision, orchestrator_path],
        flags=flags,
        gaps=gaps,
    )


__all__ = ["VERSION", "build_audit"]
