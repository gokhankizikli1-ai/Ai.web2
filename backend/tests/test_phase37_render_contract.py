# coding: utf-8
"""Phase 3.7 — render contract tests.

The Phase 3.7 frontend introduces a structured agent-response
renderer that parses supervisor / specialist output on `## ` headers
and renders each as its own card with markdown bodies (code blocks,
lists, tables). The renderer assumes the backend produces:

  - Supervisor: ## Plan / ## <Specialist> / ## Recommendation
  - Frontend specialist: 7 sections (Intent, Design direction,
    Component architecture, File structure, Implementation plan,
    Code skeleton, Next actions)
  - Code blocks are emitted as fenced triple-backticks
  - File structures are emitted inside fenced blocks

This file pins those PROMPT-LEVEL guarantees so a quiet drift in the
spec text wouldn't silently degrade the rendered UI back to a
markdown paragraph dump.

Backend-side rendering is otherwise pure presentation — the frontend
owns the render — so these are the only assertions that matter on
the backend for Phase 3.7.
"""


# ══════════════════════════════════════════════════════════════════════
# Supervisor: structured 3-section output the renderer splits into cards

def test_supervisor_emits_only_h2_headers_no_h1_or_h3():
    """The renderer splits on `## ` (h2) only. If the supervisor's
    prompt drifts to using `# ` or `### ` for top-level sections, the
    renderer would fail to split and the user would see a single
    monolithic markdown block. Pin h2 as the canonical header level."""
    from backend.services.agent.specs import get_spec
    p = get_spec("supervisor").system_prompt
    # All top-level section markers should be `## `, never `# ` or `### `
    assert "## Plan" in p
    assert "## Recommendation" in p
    # h1 (`# `) and h3 (`### `) MUST NOT appear as section markers in
    # the example output the LLM mimics.
    # (We allow `# ` inside code blocks like Python comments — only
    # check at start-of-line for the section example portion.)
    for bad in ("\n# Plan", "\n### Plan", "\n# Recommendation"):
        assert bad not in p, f"Supervisor prompt accidentally uses {bad!r} — would break the h2 splitter"


def test_supervisor_specialist_section_uses_h2():
    """The middle section (one per delegated specialist) must also be
    h2 — otherwise the renderer skips it. The prompt's example uses
    `## <Specialist Name>` — pin that."""
    from backend.services.agent.specs import get_spec
    p = get_spec("supervisor").system_prompt
    assert "## <Specialist Name>" in p or "## <Specialist>" in p


# ══════════════════════════════════════════════════════════════════════
# Frontend specialist: ALL seven section headers are h2 — renderer
# relies on this for the 7-card layout

REQUIRED_FRONTEND_H2_HEADERS = (
    "## Intent",
    "## Design direction",
    "## Component architecture",
    "## File structure",
    "## Implementation plan",
    "## Code skeleton",
    "## Next actions",
)


def test_frontend_prompt_emits_all_seven_sections_as_h2():
    """All seven canonical headers must appear. The prompt's example
    block indents them for readability; the LLM still emits them as
    top-level h2 in its actual replies. We only need to confirm each
    header NAME appears — the renderer's split regex tolerates leading
    whitespace too."""
    from backend.services.agent.specs.role_templates import ROLE_SYSTEM_PROMPTS
    p = ROLE_SYSTEM_PROMPTS["frontend"]
    for h in REQUIRED_FRONTEND_H2_HEADERS:
        assert h in p, f"Frontend prompt missing required h2 header {h!r}"


def test_frontend_prompt_demands_fenced_code_blocks():
    """The Code skeleton + File structure sections must use triple-
    backtick fenced blocks. The renderer styles fenced blocks as
    full-width code cards; inline backticks become subtle pills.
    If the prompt asked for inline backticks instead, large multi-
    line code would render as one long inline pill — unusable."""
    from backend.services.agent.specs.role_templates import ROLE_SYSTEM_PROMPTS
    p = ROLE_SYSTEM_PROMPTS["frontend"]
    # The code skeleton requirement explicitly mentions ```tsx fence
    assert "```tsx" in p, (
        "Frontend prompt must require ```tsx fenced code blocks so the "
        "renderer treats them as block code, not inline pills"
    )
    # At least 3 occurrences of the ``` fence: one in the file-structure
    # example pair (open+close) + the ```tsx mention in the skeleton
    # requirement = 3. Catches a regression where the file-structure
    # example loses its fence and the LLM stops using one.
    assert p.count("```") >= 3, (
        f"Frontend prompt should contain ≥3 fence markers (file-structure "
        f"open + close + ```tsx mention); got {p.count('```')}"
    )


def test_frontend_component_tree_must_use_arrow_or_bullet_format():
    """The component architecture section must use a tree-renderable
    format (nested bullets with `<PascalCase>` syntax). This is what
    the renderer's `iconFor('component architecture')` matches."""
    from backend.services.agent.specs.role_templates import ROLE_SYSTEM_PROMPTS
    p = ROLE_SYSTEM_PROMPTS["frontend"]
    # The example shape uses `<LandingShell>` / `<Hero>` etc.
    assert "<LandingShell>" in p or "<Hero>" in p
    # The example uses nested bullets (lines starting with `  - `)
    assert "  - <" in p or "    - <" in p


def test_code_skeleton_demands_real_imports_not_placeholders():
    """The renderer faithfully shows code as written. A skeleton with
    placeholder comments would look terrible inside the styled fence."""
    import re
    from backend.services.agent.specs.role_templates import ROLE_SYSTEM_PROMPTS
    p = ROLE_SYSTEM_PROMPTS["frontend"]
    # The "no placeholder comments" rule must be explicit
    lower = p.lower()
    assert "no placeholder comments" in lower or "add your logic here" in p
    # Real imports must be required (whitespace-tolerant — the prompt
    # source wraps "Imports must be real" across lines with extra
    # indentation, so a literal substring search would miss it).
    assert re.search(r"imports\s+must\s+be\s+real", lower) \
        or "real imports" in lower


# ══════════════════════════════════════════════════════════════════════
# Supervisor preserves specialist's structured output verbatim

def test_supervisor_must_not_summarise_away_specialist_output():
    """The renderer relies on the specialist's 7 h2 sections being
    PRESERVED inside the supervisor's `## <Specialist>` block. If
    the supervisor distilled them into a one-line summary, the cards
    would collapse and the user would lose the structured deliverable."""
    from backend.services.agent.specs import get_spec
    p = get_spec("supervisor").system_prompt
    # The Phase 3.6.1 rule we depend on
    assert ("preserved FAITHFULLY" in p or "VERBATIM" in p or
            "do not summarise" in p.lower() or "summarise away" in p.lower()), (
        "Supervisor prompt must explicitly require preserving specialist "
        "output verbatim — otherwise structured 7-section content collapses"
    )


# ══════════════════════════════════════════════════════════════════════
# All role templates remain markdown-parseable

def test_all_role_templates_use_only_h2_for_sections():
    """Every role template must use h2 (`## `) as its top-level
    section marker. Pinning the level across all roles means the
    renderer's split logic works for the Backend Engineer / Research
    Analyst / etc. cards too if they're ever delegated to."""
    from backend.services.agent.specs.role_templates import ROLE_SYSTEM_PROMPTS
    for role, p in ROLE_SYSTEM_PROMPTS.items():
        # h2 must be the only section marker. If h1 (`\n# `) appears
        # outside a code block, that's a drift bug.
        # We allow `# ` inside code fences (Python/shell comments).
        chunks = p.split("```")  # even indices are non-code, odd are code
        for i, chunk in enumerate(chunks):
            if i % 2 == 1:
                continue  # inside a code fence — skip
            for bad in ("\n# ", "\n### "):
                assert bad not in chunk, (
                    f"{role} template uses h1/h3 ({bad!r}) outside a code fence — "
                    f"renderer splits on h2 only; would render as one block"
                )


def test_all_role_templates_reference_h2_section_headers():
    """Every role template must reference ## section markers — either
    as standalone example lines (most templates) or as inline format
    hints like '## Top 3 candidates + ## Competition' (the ecommerce
    template). Either way ≥2 references means the LLM has a clear
    structural pattern to follow."""
    from backend.services.agent.specs.role_templates import ROLE_SYSTEM_PROMPTS
    for role, p in ROLE_SYSTEM_PROMPTS.items():
        # Skip the `custom` template — by design it's a strict-but-
        # generic fallback for roles we haven't profiled, and uses
        # softer language about "headed sections" without naming
        # concrete examples.
        if role == "custom":
            continue
        # Count `## ` substring occurrences anywhere (not just SOL).
        # Each role template SHOULD reference at least 2 distinct
        # section headers as guidance to the LLM.
        count = p.count("## ")
        assert count >= 2, (
            f"{role} template references only {count} ## section markers — "
            f"need ≥2 so the LLM has clear structural guidance"
        )


# ══════════════════════════════════════════════════════════════════════
# Regression — normal /chat unchanged

def test_chat_request_without_spec_still_clean():
    from backend.services.agent.types import AgentRequest
    req = AgentRequest(user_message="hi", mode="fast", user_id="u-1")
    assert getattr(req, "spec", "MISSING") is None


def test_phase_36_1_and_37_invariants_compose():
    """Cross-check: the senior persona claim (3.6.1) AND the h2 section
    contract (3.7) both hold on the frontend template at the same
    time. Catches a drift where one fix silently undid the other."""
    from backend.services.agent.specs.role_templates import ROLE_SYSTEM_PROMPTS
    p = ROLE_SYSTEM_PROMPTS["frontend"]
    # 3.6.1 invariants
    assert "Principal" in p or "Senior" in p
    assert "Wix" in p
    # 3.7 invariants
    for h in REQUIRED_FRONTEND_H2_HEADERS:
        assert h in p
    assert "```tsx" in p
