# coding: utf-8
"""Phase 3.6.1 — specialist intelligence regression tests.

After Phase 3.6 shipped, the Frontend Agent was still producing
beginner-tutorial output ('navbar, hero, footer') instead of
senior-engineer architecture. This phase rewrites the Frontend
role template + Supervisor routing prompt to make that quality
floor enforceable.

These tests assert PROMPT-level guarantees — the only contract we
can verify deterministically without burning real LLM calls. If
the prompts pass these checks, the LLM's compliance follows from
its instruction-following ability; failures here would be silent
quality drift.

Each test names the user-visible behaviour it protects.
"""
import pytest


# ══════════════════════════════════════════════════════════════════════
# Frontend prompt — senior-level demands

def test_frontend_prompt_claims_principal_or_senior_seniority():
    """The persona must claim seniority explicitly — LLMs match the
    register they're asked to write at. 'Principal Frontend Engineer
    with 8+ years' produces different output than 'Frontend Agent'."""
    from backend.services.agent.specs.role_templates import ROLE_SYSTEM_PROMPTS
    p = ROLE_SYSTEM_PROMPTS["frontend"]
    lower = p.lower()
    assert "principal" in lower or "senior" in lower, (
        "Frontend prompt must claim senior or principal level seniority"
    )
    # And NOT identify as an assistant / generalist / tutor
    assert "NOT an assistant" in p or "not an assistant" in lower
    assert "NOT a beginner" in p or "not a beginner" in lower


def test_frontend_prompt_forbids_generic_three_bullet_navbar_hero_footer():
    """The literal regression Phase 3.6.1 fixes — the LLM was reaching
    for 'you'll need a navbar, hero, and footer' as a default answer.
    The prompt now explicitly forbids this anti-pattern by name."""
    from backend.services.agent.specs.role_templates import ROLE_SYSTEM_PROMPTS
    p = ROLE_SYSTEM_PROMPTS["frontend"]
    assert "navbar, hero, and footer" in p or "navbar / hero / footer" in p, (
        "Frontend prompt must explicitly forbid the navbar/hero/footer "
        "anti-pattern so the LLM sees a negative example"
    )
    assert "forbidden" in p.lower() or "beginner-tutorial" in p.lower()


def test_frontend_prompt_forbids_tutorial_output():
    """Senior engineers don't tell users to 'first, create a new React
    app with npx create-react-app'. The prompt forbids tutorial-shaped
    introductory steps."""
    from backend.services.agent.specs.role_templates import ROLE_SYSTEM_PROMPTS
    p = ROLE_SYSTEM_PROMPTS["frontend"]
    assert "create-react-app" in p.lower() or "tutorial" in p.lower()


def test_frontend_prompt_forbids_placeholder_comments_in_code():
    """Code blocks must be real code, not '// add your logic here'."""
    from backend.services.agent.specs.role_templates import ROLE_SYSTEM_PROMPTS
    p = ROLE_SYSTEM_PROMPTS["frontend"]
    assert "add your logic here" in p or "placeholder comments" in p.lower()


def test_frontend_prompt_extends_nocode_forbidden_list():
    """Phase 3.6 forbade Wix/WordPress/Squarespace/Webflow. Phase 3.6.1
    extends to Carrd/GoDaddy/Strikingly/Weebly + adds the explicit
    'only mention if user asks' clause."""
    from backend.services.agent.specs.role_templates import ROLE_SYSTEM_PROMPTS
    p = ROLE_SYSTEM_PROMPTS["frontend"]
    for tool in ("Wix", "WordPress", "Squarespace", "Webflow", "Carrd"):
        assert tool in p, f"Frontend prompt must forbid {tool}"
    # The "only if explicitly asked" escape clause
    assert "EXPLICITLY" in p
    assert "should I use Wix" in p or "should i use wix" in p.lower()


# ══════════════════════════════════════════════════════════════════════
# Frontend prompt — required 7-section output format

REQUIRED_FRONTEND_SECTIONS = (
    "## Intent",
    "## Design direction",
    "## Component architecture",
    "## File structure",
    "## Implementation plan",
    "## Code skeleton",
    "## Next actions",
)


def test_frontend_prompt_demands_all_seven_required_sections():
    """The 7-section format IS the contract: each section is a
    deliverable the user can verify. Missing any one of them in the
    prompt would let the LLM regress to free-form answers."""
    from backend.services.agent.specs.role_templates import ROLE_SYSTEM_PROMPTS
    p = ROLE_SYSTEM_PROMPTS["frontend"]
    for header in REQUIRED_FRONTEND_SECTIONS:
        assert header in p, f"Frontend prompt missing required section: {header!r}"
    # And the order must be the canonical one — assert positional ordering
    positions = [p.find(h) for h in REQUIRED_FRONTEND_SECTIONS]
    assert positions == sorted(positions), (
        f"Frontend sections must appear in canonical order, got "
        f"{list(zip(REQUIRED_FRONTEND_SECTIONS, positions))}"
    )


def test_frontend_prompt_demands_component_tree_with_typescript_props():
    """The Component architecture section must call for PascalCase
    component names + TypeScript props — not vague 'list your
    components'."""
    from backend.services.agent.specs.role_templates import ROLE_SYSTEM_PROMPTS
    p = ROLE_SYSTEM_PROMPTS["frontend"]
    assert "PascalCase" in p
    assert "TypeScript" in p or "props" in p.lower()
    # Concrete example shape (the <LandingShell> tree)
    assert "<LandingShell>" in p or "<Hero>" in p


def test_frontend_prompt_demands_file_structure_with_real_paths():
    from backend.services.agent.specs.role_templates import ROLE_SYSTEM_PROMPTS
    p = ROLE_SYSTEM_PROMPTS["frontend"]
    # Example file paths to anchor the LLM on the right shape
    assert "src/pages/" in p or "src/components/" in p
    assert "tsx" in p   # the extension that confirms it's TS frontend


def test_frontend_prompt_demands_responsive_strategy():
    """Responsive strategy is mandatory in the implementation plan —
    Tailwind breakpoints by name."""
    from backend.services.agent.specs.role_templates import ROLE_SYSTEM_PROMPTS
    p = ROLE_SYSTEM_PROMPTS["frontend"]
    assert "Responsive strategy" in p or "responsive strategy" in p.lower()
    # Breakpoint names should appear so the LLM knows the level of detail
    assert "sm/md/lg" in p or "sm/md" in p or "breakpoint" in p.lower()
    # mobile-first vs desktop-first decision
    assert "mobile-first" in p.lower() or "desktop-first" in p.lower()


def test_frontend_prompt_demands_animation_strategy():
    from backend.services.agent.specs.role_templates import ROLE_SYSTEM_PROMPTS
    p = ROLE_SYSTEM_PROMPTS["frontend"]
    assert "Animation strategy" in p or "animation strategy" in p.lower()
    # Specific library named so the LLM doesn't waffle
    assert "framer-motion" in p.lower()
    # Concrete motion pattern vocabulary
    assert "stagger" in p.lower() or "fade-in" in p.lower() or "viewport" in p.lower()


def test_frontend_prompt_demands_code_skeleton_with_real_imports():
    """The Code skeleton section requires real TSX with real imports —
    not pseudo-code, not '// add your logic here'."""
    import re
    from backend.services.agent.specs.role_templates import ROLE_SYSTEM_PROMPTS
    p = ROLE_SYSTEM_PROMPTS["frontend"]
    # Mentions tsx fence + import requirements (whitespace-tolerant —
    # the prompt source wraps across lines with extra indentation)
    assert "```tsx" in p
    assert re.search(r"imports\s+must\s+be\s+real", p, re.IGNORECASE), (
        "Frontend prompt must demand real imports in the Code skeleton section"
    )
    # Length range that produces real-looking code, not toy snippets
    assert "30-80" in p or "30 to 80" in p.lower() or "50 lines" in p.lower()


def test_frontend_prompt_names_default_stack_explicitly():
    """When the user doesn't specify a stack, the prompt must name
    the default explicitly — otherwise the LLM picks something
    different every call and the deliverable isn't reproducible."""
    from backend.services.agent.specs.role_templates import ROLE_SYSTEM_PROMPTS
    p = ROLE_SYSTEM_PROMPTS["frontend"]
    # The chosen default stack components
    assert "Next.js" in p
    assert "Tailwind" in p
    assert "shadcn" in p.lower()
    assert "framer-motion" in p.lower()


def test_frontend_prompt_is_substantially_longer_than_phase36():
    """Sanity check on prompt depth — the rewrite should be a real
    upgrade in specificity. A regression that accidentally truncates
    the prompt would silently degrade quality."""
    from backend.services.agent.specs.role_templates import ROLE_SYSTEM_PROMPTS
    p = ROLE_SYSTEM_PROMPTS["frontend"]
    # Phase 3.6 was ~1600 chars. Phase 3.6.1 should be 3000+.
    assert len(p) >= 2500, (
        f"Frontend prompt is only {len(p)} chars — likely truncated. "
        f"Phase 3.6.1 should be ≥2500 chars to carry the 7-section "
        f"format + prohibitions + stack default."
    )


# ══════════════════════════════════════════════════════════════════════
# Supervisor — explicit routing rules

def test_supervisor_prompt_has_explicit_routing_rules_section():
    from backend.services.agent.specs import get_spec
    sv = get_spec("supervisor")
    assert sv is not None
    p = sv.system_prompt
    assert "ROUTING RULES" in p, (
        "Supervisor must have an explicit ROUTING RULES section so the "
        "LLM has rule-based delegation guidance, not vibes-based picks."
    )


def test_supervisor_routes_website_intent_to_frontend_engineer():
    """The most common user intent on KorvixAI is 'build me a website'.
    The supervisor must auto-route this to Frontend Engineer or coder
    with a frontend-only framing — never answer it itself with generic
    advice."""
    from backend.services.agent.specs import get_spec
    sv = get_spec("supervisor")
    p = sv.system_prompt
    # Routing keywords for UI/website work
    assert "build a website" in p.lower() or "landing page" in p.lower()
    assert "Frontend Engineer" in p
    # The "when in doubt prefer Frontend" tiebreaker
    assert "when in doubt" in p.lower() or "prefer the Frontend Engineer" in p


def test_supervisor_explicitly_forbids_summarising_specialist_output():
    """The supervisor must NOT condense a frontend specialist's
    7-section deliverable into 'they suggested some components' —
    that would erase the value of the specialist's structured output."""
    from backend.services.agent.specs import get_spec
    sv = get_spec("supervisor")
    p = sv.system_prompt
    assert "summarise away" in p.lower() or "preserved FAITHFULLY" in p or "VERBATIM" in p


def test_supervisor_routes_backend_intent_to_backend_engineer():
    """Phase 4.1 reworded the routing rules into terser intent lists.
    Verify the intent vocabulary (API + backend + database + auth) is
    still present, regardless of the exact glue words."""
    from backend.services.agent.specs import get_spec
    sv = get_spec("supervisor")
    p = sv.system_prompt
    # The Phase 4.1 line: "API / backend / database / auth → Backend Engineer..."
    assert "API" in p and "backend" in p.lower() and "database" in p.lower()
    assert "Backend Engineer" in p or "coder" in p.lower()


def test_supervisor_routes_marketing_research_strategy_trading():
    """Spot-check the other routing buckets so the LLM has full
    coverage and doesn't fall back to the generalist `coder` for
    market or strategy questions."""
    from backend.services.agent.specs import get_spec
    p = get_spec("supervisor").system_prompt
    assert "researcher" in p.lower()
    assert "marketer" in p.lower()
    assert "strategist" in p.lower()
    assert "trader" in p.lower()


# ══════════════════════════════════════════════════════════════════════
# spec_from_project_agent still uses the strengthened Frontend template

def test_legacy_frontend_project_agent_picks_up_new_template():
    """A project_agents row created in Phase 2.5 (empty system_prompt,
    role='Frontend Engineer') must now resolve to the Phase 3.6.1
    senior-level template — the regression fix automatically applies
    to existing users."""
    from backend.services.agent.specs.types import spec_from_project_agent
    spec = spec_from_project_agent({
        "id":            "legacy-frontend-agent",
        "project_id":    "p-1",
        "name":          "Frontend Agent",
        "role":          "Frontend Engineer",
        "system_prompt": "",
        "model_hint":    "",
        "metadata":      {},
    })
    p = spec.system_prompt
    # Senior claim + 7-section format
    assert ("Principal" in p or "Senior" in p)
    for header in REQUIRED_FRONTEND_SECTIONS:
        assert header in p, f"legacy frontend agent missing {header}"
    # And the anti-Wix / anti-navbar-hero-footer guards
    assert "Wix" in p
    assert "navbar, hero, and footer" in p or "navbar / hero / footer" in p


# ══════════════════════════════════════════════════════════════════════
# Regression — normal /chat is unchanged

def test_chat_request_without_spec_still_defaults_cleanly():
    """The Phase 3.6.1 prompt rewrites do not change AgentRequest's
    shape. Legacy /chat callers (no spec attached) keep working."""
    from backend.services.agent.types import AgentRequest
    req = AgentRequest(user_message="hi", mode="fast", user_id="u-1")
    assert getattr(req, "spec", "MISSING") is None
    assert req.system_prompt == ""


def test_all_role_templates_still_load_and_route():
    """Sanity check — adding/rewriting one template must not corrupt
    the others' load path."""
    from backend.services.agent.specs.role_templates import (
        ROLE_SYSTEM_PROMPTS, default_system_prompt_for_role,
    )
    for role in ("frontend", "backend", "research", "startup",
                  "ecommerce", "trading", "design", "custom"):
        assert role in ROLE_SYSTEM_PROMPTS
        assert default_system_prompt_for_role(role) == ROLE_SYSTEM_PROMPTS[role]
        assert len(ROLE_SYSTEM_PROMPTS[role]) >= 300
