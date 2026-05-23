# coding: utf-8
# Phase 4.2 — Anti-generic response guard.
#
# Runs over a specialist's reply BEFORE it's threaded back to the
# Supervisor. Catches the failure modes Phase 4.1's prompts try to
# prevent at the prompt level but the LLM sometimes ignores:
#
#   - generic "you can use X" / "depends on your needs" hedging
#   - no-code platform recommendations (Wix / WordPress / Squarespace…)
#   - tutorial-shaped openers ("first, npx create-react-app")
#   - placeholder code ("// add your logic here")
#   - assistant filler ("Great question!", "Happy to help")
#   - role contract violations:
#     * frontend missing ## Component architecture / ## Code skeleton
#     * backend missing ## API contract / ## Schema
#     * technical specs missing any fenced code block
#     * reply too short for the role
#
# Verdict shape:
#   QualityVerdict(ok: bool, reasons: list[str], suggested_fix: str)
#
# When `ok=False` the orchestration layer (delegate._execute_delegation)
# regenerates the specialist's response ONCE with `suggested_fix`
# appended to the task. If the retry also fails the original output
# is kept (better than nothing) — see _execute_delegation for the
# retry policy.

from dataclasses import dataclass, field
from typing import Any, List, Tuple


# ── Universal blocked phrases ────────────────────────────────────────
# These appear in ALL specialist outputs as anti-pattern markers.
# We allow them only when used in counter-example context ("never
# recommend Wix", "instead of WordPress") — see _is_counter_example.

FORBIDDEN_NOCODE_PLATFORMS: Tuple[str, ...] = (
    "wix", "wordpress", "squarespace", "webflow", "carrd",
    "strikingly", "weebly", "godaddy site builder",
    "wordpress.com",
)

# Technical-role-specific anti-patterns. Apply to frontend + backend
# only (where code is the deliverable).
FORBIDDEN_TUTORIAL_PHRASES: Tuple[str, ...] = (
    "create-react-app", "npx create-react-app",
    "first, run", "first, create a new",
    "// add your logic here", "// your logic here",
    "// rest of the code", "// implementation goes here",
)

# Filler phrases — these are the conversational openers/closers that
# make a specialist sound like an assistant rather than a senior
# engineer. The Phase 4.1 prompts forbid them but the LLM sometimes
# falls back to them under uncertainty.
FILLER_PHRASES: Tuple[str, ...] = (
    "great question", "i'd love to help", "i'll do my best",
    "absolutely!", "happy to help", "let me think about this",
    "let me think through this", "let me know if you need",
    "i hope this helps", "feel free to ask",
)

# Hedging phrases that signal the agent isn't committing to an answer.
# These belong in the supervisor's strategy doc, not a specialist's
# deliverable.
HEDGING_PHRASES: Tuple[str, ...] = (
    "depends on your needs", "depends on your design choices",
    "consider hiring", "you might want to consider",
    "it really depends",
)

# ── Required section headers by role ─────────────────────────────────
# A specialist's reply must contain ALL required headers for its role.
# Matches the Phase 3.6.1 / 4.1 output contracts in role_templates.py.
# Roles not listed here (supervisor, custom) skip section validation.

REQUIRED_SECTIONS_BY_ROLE: dict = {
    "frontend": [
        "## Intent", "## Component architecture", "## File structure",
        "## Implementation plan", "## Code skeleton",
    ],
    "backend":  [
        "## API contract", "## Schema", "## Implementation",
    ],
    "research": [
        "## TL;DR", "## Findings",
    ],
    "ux": [
        "## Audience", "## Information hierarchy",
    ],
    "brand": [
        "## Brand direction", "## Colour system", "## Typography",
    ],
    "copywriter": [
        "## Hero", "## Section copy",
    ],
    "product_strategist": [
        "## v1 scope", "## Sitemap",
    ],
}

# Roles where a fenced code block is mandatory.
TECHNICAL_ROLES_NEED_CODE_BLOCK: Tuple[str, ...] = ("frontend", "backend")

# Minimum reply length by role. Shorter than this signals an evasive
# / one-liner answer that breaks the structured-output contract.
MIN_REPLY_CHARS: dict = {
    "frontend":           400,
    "backend":            350,
    "ux":                 280,
    "brand":              280,
    "copywriter":         220,
    "research":           220,
    "product_strategist": 280,
    "default":             80,
}


@dataclass
class QualityVerdict:
    """Result of running the quality guard over a specialist reply."""
    ok: bool
    reasons: List[str]     = field(default_factory=list)
    suggested_fix: str     = ""


def _is_counter_example(text_lower: str, phrase_idx: int) -> bool:
    """When a phrase like 'wix' appears within ~80 chars after a
    counter-example marker ('never', 'instead of', 'avoid', 'do not'),
    treat it as a forbidden-example mention rather than a real
    recommendation. Otherwise specialists who DOCUMENT what they don't
    recommend would always fail the guard."""
    if phrase_idx <= 0:
        return False
    markers = (
        "never", "instead of", "rather than",
        "do not", "don't", "avoid", "no-code",
        "forbidden", "must not", "must never",
    )
    window = text_lower[max(0, phrase_idx - 80): phrase_idx]
    return any(m in window for m in markers)


def check_specialist_output(spec: Any, output: str) -> QualityVerdict:
    """Run the quality guard over a specialist's reply.

    Returns a QualityVerdict. On failure, `suggested_fix` is a stronger
    re-prompt the orchestrator appends to the original task when it
    retries the specialist.

    The guard is intentionally pragmatic over comprehensive:
      - Errors on the side of accepting (returns ok=True) when checks
        are ambiguous. False rejections cost 2x tokens via retry.
      - Reports all failure reasons in a single verdict so the LLM can
        fix everything at once on the retry.
    """
    if spec is None or output is None:
        return QualityVerdict(ok=True)

    text = str(output)
    text_lower = text.lower()
    role = (getattr(spec, "role", "") or "").lower()
    reasons: List[str] = []

    # ── 1. Min length ──────────────────────────────────────────────
    role_key = role if role in MIN_REPLY_CHARS else "default"
    min_chars = MIN_REPLY_CHARS.get(role_key, 80)
    if len(text.strip()) < min_chars:
        reasons.append(
            f"reply is only {len(text.strip())} chars — role {role!r} "
            f"requires ≥{min_chars} to meet its output contract"
        )

    # ── 2. Required sections ──────────────────────────────────────
    required = REQUIRED_SECTIONS_BY_ROLE.get(role, [])
    missing = [s for s in required if s not in text]
    if missing:
        reasons.append(
            f"missing required section headers: {', '.join(missing)}"
        )

    # ── 3. Forbidden no-code platform mentions ────────────────────
    for phrase in FORBIDDEN_NOCODE_PLATFORMS:
        idx = text_lower.find(phrase)
        if idx >= 0 and not _is_counter_example(text_lower, idx):
            reasons.append(
                f"recommends forbidden no-code platform: {phrase!r}"
            )
            break

    # ── 4. Tutorial / placeholder anti-patterns (technical roles) ─
    if role in TECHNICAL_ROLES_NEED_CODE_BLOCK:
        for phrase in FORBIDDEN_TUTORIAL_PHRASES:
            if phrase in text_lower:
                reasons.append(
                    f"contains tutorial/placeholder anti-pattern: {phrase!r}"
                )
                break

    # ── 5. Filler / chatbot phrases ───────────────────────────────
    for phrase in FILLER_PHRASES:
        if phrase in text_lower:
            reasons.append(
                f"opens with assistant filler: {phrase!r} — senior "
                f"specialists skip the niceties"
            )
            break

    # ── 6. Hedging ────────────────────────────────────────────────
    for phrase in HEDGING_PHRASES:
        if phrase in text_lower:
            reasons.append(
                f"hedges with {phrase!r} — pick an opinionated default "
                f"and commit"
            )
            break

    # ── 7. Technical roles need code block ────────────────────────
    if role in TECHNICAL_ROLES_NEED_CODE_BLOCK and "```" not in text:
        reasons.append(
            f"role {role!r} requires at least one fenced code block "
            f"(```language ... ```) — code is the deliverable"
        )

    if not reasons:
        return QualityVerdict(ok=True)

    # Build a strong retry prompt that names every failure mode so the
    # LLM can fix them in one shot.
    fix = (
        "Your previous response failed the quality check:\n"
        + "\n".join(f"  - {r}" for r in reasons)
        + "\n\nRegenerate from scratch. Follow your role contract STRICTLY:\n"
        "  - emit every required section header VERBATIM\n"
        "  - use fenced code blocks (```language) for any code\n"
        "  - no no-code platform recommendations (Wix/WordPress/etc.)\n"
        "  - no tutorial-shaped openers ('first run npx ...')\n"
        "  - no filler phrases ('Great question!')\n"
        "  - no placeholder code comments ('// add your logic here')\n"
        "  - no hedging ('depends on your needs') — commit to a default."
    )
    return QualityVerdict(ok=False, reasons=reasons, suggested_fix=fix)


__all__ = [
    "QualityVerdict",
    "check_specialist_output",
    "FORBIDDEN_NOCODE_PLATFORMS",
    "FORBIDDEN_TUTORIAL_PHRASES",
    "FILLER_PHRASES",
    "HEDGING_PHRASES",
    "REQUIRED_SECTIONS_BY_ROLE",
    "MIN_REPLY_CHARS",
]
