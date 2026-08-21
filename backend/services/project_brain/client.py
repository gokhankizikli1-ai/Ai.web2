# coding: utf-8
"""
Phase 8 — ProjectBrainClient.

One method does the real work: `get(user_id, project_id)` assembles
a ProjectBrain by reading from memory_plane, sessions, assets, jobs,
workflows, and agent_tasks. Every source is wrapped in try/except so
a missing/disabled subsystem can never break the aggregator.

`build_context(...)` returns a ProjectContextBlock — a small string
suitable for direct system-prompt injection by the chat layer.
"""
from __future__ import annotations

import logging
import os
from typing import Any, Optional

from backend.services.project_brain.types import ProjectBrain, ProjectContextBlock


logger = logging.getLogger(__name__)

_MAX_GOALS              = 4
_MAX_DECISIONS          = 4
_MAX_NOTES              = 4
_MAX_ASSETS             = 6
_MAX_WORKFLOWS          = 4
_MAX_CONNECTOR_SIGNALS  = 6         # recent Gmail/GitHub observations surfaced
# The correlation projection needs a wider slice of the SAME observations than
# the six raw signals we surface. Both come from ONE read: we ask the store for
# this many rows once and take the newest `_MAX_CONNECTOR_SIGNALS` of them for
# the raw list, so understanding the project costs no additional query.
_MAX_OBSERVATIONS_READ  = 60
_MAX_INTELLIGENCE       = 4         # correlated project states surfaced
_MAX_INTELLIGENCE_EVIDENCE = 2      # evidence lines rendered per state
_MAX_ATTENTION          = 3         # ranked Needs-Attention rows surfaced
_MAX_BUSINESS_KNOWLEDGE = 6         # durable typed knowledge entries surfaced
_MAX_PRODUCTS           = 6         # generated Web/App products surfaced
_MAX_CHATS              = 5         # project-linked chats whose CONTENT is surfaced
_MAX_CHAT_PREVIEW_CHARS = 160      # last-message preview per chat (bounded)
_MAX_CHAT_TURNS         = 6         # recent user/assistant turns per chat (bounded)
_MAX_CHAT_TURN_CHARS    = 240      # per-turn content cap (bounded)
_ORDINARY_CHAT_MODES    = ("", "chat")  # build/tool modes are excluded from content
_MAX_MEMORIES_AS_CTX    = 8
_CTX_BLOCK_CHAR_BUDGET  = 4000      # cap the prompt-injected block (raised for chat evidence)

# Generated Web/App products are read through the ONE project-product
# projection (`orchestrator.project_products`), which owns the deliverable-kind
# filter and the `content` unpacking for every surface. The canonical
# build/artifact authority still owns the payload; the brain surfaces only
# bounded references, never the source tree.


def is_enabled() -> bool:
    return os.getenv("ENABLE_PROJECT_BRAIN", "false").strip().lower() == "true"


def _owns_project(user_id: str, project_id: str) -> bool:
    """Ownership gate for project-scoped authorities that are keyed by
    `project_id` ONLY (goals/decisions/deliverables/threads) and therefore
    have no per-row user column to defend with.

    The canonical ownership authority is the `projects` store (the same record
    the Gmail/GitHub connector routes check on connect). A brain fetch pulls
    project-scoped data ONLY when that record exists AND belongs to the caller,
    so user B can never surface user A's products/chats/goals/decisions by
    guessing a project_id. Returns False (fail-closed) on any error or when the
    project is not in the canonical store — user-scoped slices (memory,
    connector signals, assets…) are unaffected and still surface."""
    if not (user_id and project_id):
        return False
    try:
        from backend.services.projects import store as projects_store
        p = projects_store.get_project(str(project_id))
        return bool(p) and str(p.owner_user_id) == str(user_id)
    except Exception as e:  # pragma: no cover — defensive; never break aggregation
        logger.debug("project_brain: ownership check unavailable: %s", e)
        return False


#: Inferred-state code → the English phrase used in the PROMPT.
#:
#: The backend still never ships prose to the FRONTEND for any of these code
#: vocabularies — the workspace payload carries the stable codes and React
#: renders them from its locale dictionaries, so Türkçe and Deutsch stay
#: translations rather than a second backend. These tables exist ONLY because a
#: system prompt is English by nature, and a model reading
#: "state=likely_resolved" reasons worse than one reading "looks resolved".
_STATE_PHRASE = {
    "unresolved":      "still unresolved",
    "conflicting":     "CONFLICTING evidence",
    "in_progress":     "in progress",
    "likely_resolved": "likely resolved",
    #: `observed` means "seen, with nothing decisive recorded". It read "being
    #: discussed", which is a claim about PEOPLE — and it was rendered over two
    #: Vercel deployments, where nobody said anything at all.
    "observed":        "observed, with nothing decisive recorded either way",
    "no_evidence":     "nothing observed yet",
}

#: Affected-area code → the noun a person would use.
_AREA_PHRASE = {
    "frontend": "frontend", "backend": "backend", "deployment": "deployment",
    "auth": "sign-in / auth", "billing": "billing / payments",
    "database": "database", "connector": "a connected tool",
    "product": "the product surface", "infrastructure": "infrastructure",
    "content": "content", "unknown": "an unidentified part of the project",
}

#: Change-kind code → phrase.
_KIND_PHRASE = {
    "feature": "a feature change", "bug": "a bug fix", "regression": "a regression",
    "deployment": "a deployment", "configuration": "a configuration change",
    "dependency": "a dependency change", "security": "a security concern",
    "operational": "an operational event", "communication": "a discussion",
    "unknown": "an unclassified change",
}

#: Implication code → the CONSEQUENCE, stated as a fact about the evidence.
#: Not one of these is an instruction: proposing work is `candidate_synthesis`,
#: and a model that reads "redeploy production" here would start doing the
#: Business Brain's job from a chat turn.
_IMPLICATION_PHRASE = {
    "production_broken":
        "the latest production deployment failed, so production is not running "
        "the intended build",
    "recurrence":
        "this target was green before and is red again — it regressed rather "
        "than simply failing",
    "fix_not_proven_live":
        "the change landed, but nothing proves it is live in production",
    "blocked_by_ci":
        "the latest CI check on this work failed",
    "issue_open":
        "the tracked issue for this is still open",
    "preview_only_verified":
        "the only successful deployment was to a non-production target, which "
        "says nothing about production",
    "work_in_flight":
        "the work is proposed but not yet merged or shipped",
    "reported_but_unconfirmed":
        "this was reported in conversation, and no code, check or deployment "
        "evidence confirms or denies it",
    "verified_live":
        "the change landed and a production deployment of it succeeded",
}

#: Uncertainty code → what we do NOT know. Kept explicit so the model says
#: "unverified" instead of quietly rounding it up to "fixed".
_UNCERTAINTY_PHRASE = {
    "conflicting_evidence": "the sources disagree",
    "production_unverified": "there is no production evidence either way",
    "deploy_outcome_unknown": "a deployment started and never reported an outcome",
    "stale_evidence": "the newest evidence is old",
    "single_source": "only one tool reported this, so it is uncorroborated",
    "topical_link_only": "these were linked by wording, not by a shared "
                         "commit / PR / deployment",
    "thin_evidence": "this rests on very little evidence",
    "no_decisive_evidence": "nothing here settles the question either way",
    "undated_evidence": "the evidence carries no usable timestamp",
    "unknown_affected_scope": "which part of the project this touches is unclear",
}

#: Project-level knowledge-gap code → phrase.
_GAP_PHRASE = {
    "no_evidence": "no connector activity has been observed for this project",
    "no_recent_evidence": "nothing has been observed recently",
    "single_source_project": "only one tool is reporting, so nothing here is "
                             "cross-checked",
    "no_deployment_evidence": "changes are landing and no deployment is being "
                              "reported at all",
    "production_unverified": "at least one landed change has no production proof",
    "unknown_affected_scope": "for some subjects, the affected part of the "
                              "project is unclear",
}

#: Attention severity code → phrase. Read from the attention authority's own
#: vocabulary; nothing here re-ranks or re-weights it.
_SEVERITY_PHRASE = {
    "blocking": "blocking",
    "time_sensitive": "time-sensitive",
    "waiting": "waiting on you",
}

#: Decision-context "why now" code → the phrase used in the PROMPT. Same rule
#: as every table above: the backend ships no prose to the FRONTEND for these
#: codes; a system prompt is English by nature, and a model reading
#: "deadline_imminent" reasons worse than one reading the sentence.
_WHY_NOW_PHRASE = {
    "deadline_imminent":
        "a dated commitment on this project is less than 48 hours away",
    "deadline_approaching": "a dated commitment is inside the next week",
    "customer_impact_corroborated":
        "two independent people reported it — a conversation AND a mail",
    "customer_impact_reported": "a person reported it outside the tooling",
    "goal_aligned": "it touches an active project goal",
    "recurring_failure": "the same target has reported this repeatedly",
}
_WHY_NOW_PHRASE.update({
    k: v for k, v in {
        "production_broken": "production is verifiably red",
        "recurrence": "it regressed rather than simply failing",
        "blocked_by_ci": "the latest CI check failed",
        "issue_open": "the tracked issue is still open",
        "fix_not_proven_live": "nothing proves the landed change is live",
    }.items()
})

#: Decision-context caveat code → phrase. The uncertainty vocabulary is reused
#: verbatim; only what `decision_context` adds needs an entry.
_CAVEAT_PHRASE = dict(_UNCERTAINTY_PHRASE)
_CAVEAT_PHRASE.update({
    "decision_recorded_after_evidence":
        "a project decision was recorded AFTER this evidence, so it may "
        "already be settled",
    "part_of_related_story":
        "it shares evidence with another open subject and may be one problem",
})

#: Who has to act. The distinction this whole layer exists to make honest.
_RESOLUTION_PHRASE = {
    "human_external":
        "Korvix can investigate and explain this; it CANNOT resolve it — that "
        "needs a change in {providers}, which Korvix reads but cannot write",
    "korvix": "Korvix can carry this out itself",
    "unknown": "who has to act on this is not established by the evidence",
}

_TIER_PHRASE = {
    "deadline_risk": "a dated commitment is at risk",
    "production_broken": "production is broken",
    "customer_impact": "people are reporting impact",
    "blocked": "something concrete is blocking it",
    "unverified": "it is open and nothing concrete is proven",
    "time_sensitive": "a commitment is close",
    "routine": "routine",
}

_ATTENTION_REASON_PHRASE = {
    "ci_failed": "a CI check failed",
    "deploy_failed": "a production deployment failed",
    "preview_deploy_failed": "a preview deployment failed",
    "pr_awaiting": "a pull request is waiting",
    "meeting_soon": "a meeting starts soon",
    "meeting_cancelled": "an upcoming meeting was cancelled",
    "build_failed": "a build did not finish",
}


def _date(value: Any) -> str:
    """A date as it appears in the prompt: sanitized FIRST, then sliced.

    AUDIT FINDING, fixed here. These were sliced raw — `str(x or "")[:10]` — on
    the assumption that ten characters of an ISO date are harmless. They are
    not when the value did not come from a clock: the first ten characters of
    `"2026-06-\n- Recent decisions: ship it"` still contain a newline, and a
    newline is a new prompt line. Every other provider string in this module
    already goes through `_clean`; these two did not."""
    return _clean(value, 40)[:10]


def _clean(text: Any, limit: int = 200) -> str:
    """One prompt-safe line of provider/user text.

    Connector text is UNTRUSTED: a Slack message or a PR title can contain
    newlines and anything that looks like a section header. Collapsing
    whitespace means such a string can add words to a line but can never add a
    LINE, so it cannot forge "Recent decisions:" or close the block it sits in.
    """
    out = " ".join(str(text or "").split())
    return out[:limit]


def _phrases(codes: Any, table: dict, limit: int) -> list:
    """Bounded, order-preserving code → phrase mapping. An unknown code (a
    backend half-deployed against an older table) is DROPPED rather than
    rendered as a raw identifier at the model."""
    out: list[str] = []
    for row in (codes or [])[:limit]:
        if not isinstance(row, dict):
            continue
        phrase = table.get(str(row.get("code") or ""))
        if phrase:
            out.append(phrase)
    return out


# ── EVIDENCE GROUNDING vocabulary ────────────────────────────────────────────
#
# `project_intelligence.grounding` decides; these tables only compose the
# English a system prompt needs, exactly like every table above.
#
# Two phrasings per claim, and the difference between them is the whole point:
# what the evidence ESTABLISHES is stated as a fact, and what it merely touches
# is stated as somebody's claim or as an adjacent fact — never as the claim
# itself.

#: Claim code → what a DIRECT hit actually establishes. Note how narrow each
#: one is: a deployment event establishes a deployment event.
_CLAIM_ESTABLISHED = {
    "deployment":       "a deployment was reported, with its stated outcome",
    "code_change":      "a code change was proposed or landed",
    "tests":            "a check / test run reported a result",
    "coordination":     "people are meeting or writing about this project",
    #: No `functionality` entry, and that is the design: nothing a connector can
    #: see ESTABLISHES that software works, so the claim never reaches this
    #: band. It appears below as adjacent evidence, to be quoted.
    "users":            "a recorded customer fact exists — cite it as recorded",
    "feedback":         "someone's feedback is on record — say who, and what",
    "goal_progress":    "goals are recorded, so progress can be discussed "
                        "against them BY NAME",
    "business_outcome": "a recorded business / metric fact exists — cite it as "
                        "recorded, with its date",
}

#: Claim code → the INDIRECT reading. An adjacent fact, stated as adjacent.
_CLAIM_INDIRECT = {
    "functionality":    "checks passed — evidence about the CHECKS, not that "
                        "the product works for a person",
    "users":            "people wrote about this project — that is not USE",
    "feedback":         "people wrote about this project — say who; do not "
                        "generalise it into \u201cuser feedback\u201d",
    "goal_progress":    "goals exist, but nothing links a change to one",
}

#: The same band, when the only reason the claim is in play is the WORDING of a
#: message. A keyword is not a reading, so the instruction is to go and quote
#: the message rather than to repeat the keyword's implication as a finding.
_CLAIM_INDIRECT_TEXTUAL = {
    "functionality":    "a message's wording touches how it behaves — QUOTE it; "
                        "wording is a hint, not proof it works",
    "users":            "a message mentions users or customers — QUOTE it; a "
                        "mention is not use",
    "feedback":         "a message reads like feedback — QUOTE it and say who; "
                        "not \u201cuser feedback\u201d in general",
}

#: Claim code → the sentence naming the claim that must NOT be made. Written as
#: the assertion itself so a model matching on meaning cannot miss it.
_CLAIM_FORBIDDEN = {
    "deployment":       "that anything was deployed",
    "code_change":      "that any code changed",
    "tests":            "that anything was tested or that tests ran",
    "coordination":     "that anyone is discussing or working on it",
    "functionality":    "that it works, is functional, or is ready for use",
    "users":            "that anyone is using it, or that it has users",
    "feedback":         "that user feedback exists or is being reviewed",
    "goal_progress":    "that it is progressing toward or meeting any goal",
    "business_outcome": "that any revenue, growth or business result occurred",
}

#: Evidence code → the thing that WOULD establish it, named concretely enough
#: to act on.
_EVIDENCE_PHRASE = {
    "deployment_event":       "a deployment from Vercel or GitHub",
    "code_change_event":      "a GitHub pull request or commit",
    "ci_or_test_report":      "a CI / test result from GitHub checks",
    "meeting_or_message":     "a Slack message, mail or calendar event",
    "person_stating_it":      "a person stating it in chat, mail or a project note",
    "recorded_customer_fact": "a customer fact in project knowledge",
    "recorded_metric_or_business_fact":
                              "a metric / business fact in project knowledge",
    "recorded_project_goal":  "a goal recorded on the project",
}


#: Claims that must never be read off adjacent evidence — the grounding
#: authority's own set, imported once so this module cannot drift from it.
try:      # pragma: no cover — import shape, not behaviour
    from backend.services.project_intelligence.grounding import (
        INFERRED_CLAIMS as _INFERRED_CLAIMS,
    )
except Exception:      # pragma: no cover — a half-deployed backend
    _INFERRED_CLAIMS = frozenset()


def _unsupported_claims(grounding: Any) -> list:
    """Claim codes this project establishes nothing for. Read through the
    grounding authority so the definition lives in one place."""
    try:
        from backend.services.project_intelligence import grounding as gr
        return gr.unsupported(grounding if isinstance(grounding, dict) else {})
    except Exception:      # pragma: no cover — never break a read
        return []


def _grounding_lines(grounding: dict) -> list:
    """THE EVIDENCE BASE — what is established, and what must not be asserted.

    PRODUCTION FINDING, fixed here. The block told the model everything the
    project HAD and nothing about what it lacked, and a model handed four
    confident facts about deployments answered "what is the state of this
    project?" with testing, readiness, goal progress and user feedback. Not one
    of those words appeared in any evidence; they appeared because a project
    usually has them and nothing said this one does not.

    So the absence is now stated, by name, as instructions rather than as data:
    the claims that cannot be made, and the specific evidence that would make
    them makeable. Composed from `grounding`'s stable codes; this function
    decides nothing."""
    if not isinstance(grounding, dict) or not grounding:
        return []
    rows = [r for r in (grounding.get("claims") or []) if isinstance(r, dict)]
    if not rows:
        return []

    lines = [
        "Evidence base — BINDING. What this project's evidence establishes, and "
        "what it does not:",
    ]

    # (is_inferred, text) — the flag decides emission order below.
    established: list[tuple] = []
    adjacent: list[str] = []
    forbidden: list[str] = []
    missing: list[str] = []
    for row in rows:
        claim = str(row.get("claim") or "")
        support = str(row.get("support") or "")
        sources = [_clean(x, 40) for x in (row.get("sources") or [])[:3] if x]
        where = f" ({', '.join(sources)})" if sources else ""
        # A claim is assertable ONLY when a source recorded its own kind of
        # evidence. Adjacent evidence adds something to quote; it never lifts
        # the prohibition — otherwise a hostile PR title containing the word
        # "customers" would talk the contract out of forbidding a claim about
        # users. So a non-direct claim is emitted in BOTH lists.
        if support != "direct":
            phrase = _CLAIM_FORBIDDEN.get(claim)
            if phrase:
                forbidden.append(phrase)
        if support == "direct":
            phrase = _CLAIM_ESTABLISHED.get(claim)
            if phrase:
                # One source is never corroboration, and it is said HERE rather
                # than as a footnote the model can drop.
                # Short on purpose: this section is capped, the route's
                # discipline rules already carry "ONE SOURCE IS NOT
                # CORROBORATION" in full, and the phrase repeats per claim.
                solo = " — one tool only, uncorroborated" \
                    if row.get("single_source") else ""
                established.append((claim in _INFERRED_CLAIMS,
                                    f"{phrase}{where}{solo}"))
        elif support == "indirect":
            table = (_CLAIM_INDIRECT_TEXTUAL
                     if str(row.get("basis") or "") == "textual"
                     else _CLAIM_INDIRECT)
            phrase = table.get(claim) or _CLAIM_INDIRECT.get(claim)
            if phrase:
                adjacent.append(f"{phrase}{where}")
        for code in (row.get("missing") or []):
            phrase = _EVIDENCE_PHRASE.get(str(code))
            if phrase and phrase not in missing:
                missing.append(phrase)

    # ORDER IS TRUNCATION ORDER. This section has a character cap and is
    # trimmed from the END, so the line whose ABSENCE caused the production
    # failure is emitted first. The established facts are the one part that is
    # also stated elsewhere in this block (understanding, project state, recent
    # activity), so they are the safe thing to lose here.
    if forbidden:
        lines.append("- NOT ESTABLISHED by anything in this project — do NOT "
                     "state, imply or hedge toward: "
                     # The WHOLE closed vocabulary, never a prefix of it: the
                     # two that a "top 6" dropped were "progressing toward its
                     # goals" and "a business result occurred" — two of the four
                     # inventions actually reported from production.
                     + "; ".join(forbidden) + ".")
    if adjacent:
        lines.append("- ADJACENT EVIDENCE — it does NOT lift the prohibition "
                     "above; it is only something you may quote: "
                     + "; ".join(adjacent[:4]) + ".")
    # Inferred-claim lines first. "A deployment was reported" restates what
    # Recent activity and Project state already say; a line telling the model to
    # QUOTE somebody exists nowhere else and carries the instruction, so it must
    # not be the line the cap eats.
    # …then what would settle what is missing, which is also stated nowhere
    # else, and only then the established facts — the one part of this section
    # that Project state and Recent activity already carry.
    if missing:
        lines.append("- Would establish what is missing: "
                     + "; ".join(missing[:4]) + ".")
    for _, item in sorted(established, key=lambda r: not r[0])[:4]:
        lines.append(f"- ESTABLISHED: {item}")
    return lines


def _intelligence_lines(states: list) -> list:
    """The synthesized PROJECT STATE block, one subject at a time.

    Deliberately not a dump of observations: each subject is what the evidence
    says it is, which part of the project it touches, what that IMPLIES, what
    is still unknown, and a couple of citable evidence references. The raw
    connector list still appears further down, bounded, as recent activity.

    Every derived phrase comes from `project_intelligence.interpretation`'s
    stable codes through the tables above — this function composes English, it
    does not decide anything."""
    lines: list[str] = []
    for state in states[:_MAX_INTELLIGENCE]:
        if not isinstance(state, dict):
            continue
        subject = _clean(state.get("subject"), 120)
        if not subject:
            continue
        confidence = state.get("confidence") or {}
        sources = [_clean(s, 40) for s in (state.get("sources") or []) if s]
        phrase = _STATE_PHRASE.get(str(state.get("state")), str(state.get("state")))
        detail = [f"confidence {confidence.get('level', 'low')}"]
        if sources:
            detail.append(f"{len(sources)} source{'s' if len(sources) != 1 else ''}: "
                          + ", ".join(sources))
        evidence_count = state.get("evidence_count")
        if evidence_count:
            detail.append(f"{evidence_count} piece"
                          f"{'s' if evidence_count != 1 else ''} of evidence")
        last_seen = _date(state.get("last_seen"))
        if last_seen:
            detail.append(f"latest {last_seen}")
        lines.append(f"- {subject} — {phrase} ({'; '.join(detail)})")

        understanding = state.get("understanding")
        if isinstance(understanding, dict):
            facts: list[str] = []
            areas = [_AREA_PHRASE.get(str(a.get("area") or ""), "")
                     for a in (understanding.get("areas") or [])
                     if isinstance(a, dict)]
            areas = [a for a in areas if a and a != _AREA_PHRASE["unknown"]]
            if areas:
                facts.append("affects " + ", ".join(areas[:3]))
            kind = _KIND_PHRASE.get(
                str((understanding.get("change_kind") or {}).get("kind") or ""))
            if kind and kind != _KIND_PHRASE["unknown"]:
                facts.append(kind)
            if facts:
                lines.append(f"    {' · '.join(facts)}")
            implications = _phrases(understanding.get("implications"),
                                    _IMPLICATION_PHRASE, 2)
            if implications:
                lines.append("    means: " + "; ".join(implications))
            uncertainty = _phrases(understanding.get("uncertainty"),
                                   _UNCERTAINTY_PHRASE, 2)
            if uncertainty:
                lines.append("    NOT known: " + "; ".join(uncertainty))

        for label, key in (("supported by", "supporting"),
                           ("but contradicted by", "contradicting")):
            for item in (state.get(key) or [])[:_MAX_INTELLIGENCE_EVIDENCE]:
                if not isinstance(item, dict):
                    continue
                title = _clean(item.get("title") or item.get("kind"), 200)
                if title:
                    lines.append(f"    {label}: [{_clean(item.get('source'), 40) or '?'}] "
                                 f"{title}")
    return lines


def _understanding_lines(understanding: dict) -> list:
    """The PROJECT-level reading — the one honest paragraph, as lines.

    It leads the block because a model handed twenty loose events reasons about
    events. It states its own coverage first so the model can weigh it: "one
    tool, three observations" and "four tools, sixty observations" support very
    different answers, and hiding that is how a chat starts sounding certain
    about a project it barely sees."""
    if not isinstance(understanding, dict) or not understanding:
        return []
    coverage = understanding.get("coverage") or {}
    if not isinstance(coverage, dict):
        coverage = {}
    observations = int(coverage.get("observations") or 0)
    source_count = int(coverage.get("source_count") or 0)
    window = int(understanding.get("window_days") or 0)
    state_phrase = _STATE_PHRASE.get(str(understanding.get("state")),
                                     str(understanding.get("state") or ""))
    lines = [
        "Project understanding — the whole picture from the connected tools "
        "(correlated and interpreted, not raw events):",
        f"- overall: {state_phrase} "
        f"(from {observations} observation(s) across {source_count} tool(s) "
        f"in the last {window} days)",
    ]
    if not observations:
        # An empty project says so, and says nothing else. This is the line
        # that stops a chat from inventing a status for a project it cannot see.
        lines.append("- there is no connector evidence for this project yet, so "
                     "any statement about its current state would be a guess")
        return lines

    # A subject named once is enough. `open` and `uncertain` overlap by
    # design (a conflicting subject is both), and repeating it would spend
    # prompt budget saying the same name twice.
    named: set = set()

    def _subjects(key: str, label: str, limit: int) -> None:
        names: list[str] = []
        for row in (understanding.get(key) or []):
            if not isinstance(row, dict):
                continue
            name = _clean(row.get("subject"), 120)
            if not name or name in named:
                continue
            named.add(name)
            names.append(name)
            if len(names) >= limit:
                break
        if names:
            lines.append(f"- {label}: " + "; ".join(names))

    _subjects("open", "open right now", 3)
    _subjects("uncertain", "uncertain / not settled", 3)
    _subjects("resolved_recently", "resolved recently", 2)

    for blocker in (understanding.get("blockers") or [])[:2]:
        if not isinstance(blocker, dict):
            continue
        where = _clean(blocker.get("environment"), 40)
        title = _clean(blocker.get("title"), 160)
        if title:
            lines.append(f"- blocked by: [{_clean(blocker.get('source'), 40) or '?'}] "
                         f"{title}" + (f" ({where})" if where else ""))

    for relation in (understanding.get("relationships") or [])[:1]:
        if not isinstance(relation, dict):
            continue
        a, b = _clean(relation.get("a_subject"), 80), _clean(relation.get("b_subject"), 80)
        if a and b:
            lines.append(f"- related: \"{a}\" and \"{b}\" were built from some of "
                         f"the same evidence")

    gaps = _phrases(understanding.get("gaps"), _GAP_PHRASE, 3)
    if gaps:
        lines.append("- NOT known: " + "; ".join(gaps))
    return lines


def _plain_phrases(codes: Any, table: dict, limit: int) -> list:
    """Bounded, order-preserving mapping for the FLAT code lists
    `decision_context` produces. An unknown code (a backend half-deployed
    against an older table) is DROPPED rather than shown to the model as a raw
    identifier — the rule `_phrases` already follows."""
    out: list[str] = []
    for code in (codes or [])[:limit]:
        phrase = table.get(str(code))
        if phrase:
            out.append(phrase)
    return out


def _focus_lines(focus: dict) -> list:
    """WHAT SHOULD HAPPEN NEXT, AND WHY — the deterministic answer, rendered.

    AUDIT FINDING, fixed here. The prompt could describe the project ("the
    payment webhook is conflicting") and list what needs a look ("a production
    deployment failed"), and then stopped. Nothing told the model which of
    those was the single most important thing, why it was more important than
    the others, or what Korvix could actually DO about it — so a chat answering
    "what should I focus on?" either re-derived an order from a list of
    subjects or hedged.

    Every line here is composed from `decision_context`'s stable codes through
    the tables above. This function decides nothing: the tier, the reasons, the
    caveats and the resolution owner are all read, and the header says so, so
    the model uses this order instead of inventing one."""
    if not isinstance(focus, dict) or not focus:
        return []
    top = focus.get("top")
    if not isinstance(top, dict) or not top:
        return []
    subject = _clean(top.get("subject"), 120)
    if not subject:
        return []

    basis = _TIER_PHRASE.get(str(top.get("priority_basis")), "")
    lines = [
        "What matters most right now (Korvix's deterministic decision layer — "
        "use THIS as the top priority, do not invent a different one):",
        f"- #1: {subject}" + (f" — {basis}" if basis else ""),
    ]
    # Line order IS priority order: this section has its own character cap and
    # is trimmed line-by-line from the END, so what a reader must not miss is
    # emitted first. "Korvix cannot resolve this" outranks the caveats, which
    # outrank the date, which outranks the runners-up.
    why = _plain_phrases(top.get("why_now"), _WHY_NOW_PHRASE, 3)
    if why:
        lines.append("    why now: " + "; ".join(why))

    actionability = top.get("actionability") or {}
    template = _RESOLUTION_PHRASE.get(str(actionability.get("resolution") or ""))
    if template:
        providers = ", ".join(_clean(p, 40) for p in
                              (actionability.get("external_providers") or [])[:3])
        lines.append("    " + template.format(
            providers=providers or "an external system"))

    caveats = _plain_phrases(top.get("caveats"), _CAVEAT_PHRASE, 2)
    if caveats:
        # Stated as a hedge the model must keep, not as a footnote it may drop.
        lines.append("    be careful: " + "; ".join(caveats))

    commitment = focus.get("commitment")
    if isinstance(commitment, dict) and commitment.get("at"):
        # The DATE and the pressure level, never a claim about what the event
        # is for: the title is the user's own words and is quoted, not read.
        lines.append(f"    upcoming commitment: "
                     f"\"{_clean(commitment.get('title'), 80)}\" "
                     f"at {_date(commitment.get('at'))} "
                     f"({_clean(commitment.get('pressure'), 20)})")

    for row in (focus.get("next") or [])[:2]:
        if not isinstance(row, dict):
            continue
        name = _clean(row.get("subject"), 100)
        if not name:
            continue
        tier = _TIER_PHRASE.get(str(row.get("priority_basis")), "")
        lines.append(f"- then: {name}" + (f" — {tier}" if tier else ""))
    return lines


def _attention_lines(attention: list) -> list:
    """What deserves a look now — the EXISTING `attention` ranking, rendered.

    This exists so a project chat can answer "what should I focus on?" without
    the model inventing an order from the state list. Nothing here re-ranks:
    the order, the membership and the severities are `attention`'s, verbatim,
    and the header says so."""
    rows = [a for a in (attention or []) if isinstance(a, dict)]
    if not rows:
        return []
    lines = ["Needs attention now (Korvix's existing deterministic ranking — "
             "use THIS order for \"what should I focus on\", do not invent one):"]
    for index, item in enumerate(rows[:_MAX_ATTENTION], start=1):
        severity = _SEVERITY_PHRASE.get(str(item.get("severity")), "")
        reason = _ATTENTION_REASON_PHRASE.get(str(item.get("reason")), "worth a look")
        title = _clean(item.get("title"), 160)
        context = _clean(item.get("context"), 80)
        tail = " — ".join([t for t in (title, context) if t])
        lines.append(f"{index}. [{severity or 'open'}] {reason}"
                     + (f": {tail}" if tail else ""))
    return lines


class ProjectBrainClient:

    def is_enabled(self) -> bool:
        return is_enabled()

    # ── Project summary (the ONE resolution rule) ──────────────────────────

    def summary_for(
        self, user_id: str, project_id: str, *, memories: Optional[list] = None,
    ) -> str:
        """The project's deterministic one-paragraph summary, or "".

        Resolution order (unchanged from the original inline logic):
          1. a stashed `summary`-kind memory for this (user, project),
          2. the sessions workspace's own name/kind.

        Extracted so the Project Workspace read model can reuse the SAME rule
        instead of growing a second, subtly different "what is this project"
        answer. `memories` is injectable so `get()` — which already lists them —
        does not pay for a second Memory Plane read. Never raises."""
        if not is_enabled() or not user_id or not project_id:
            return ""
        recents = memories
        if recents is None:
            try:
                from backend.services.memory_plane import client as mp
                recents = mp.list_user(user_id, project_id=project_id, limit=50)
            except Exception as e:
                logger.debug("project_brain: memory_plane unavailable: %s", e)
                recents = []
        for m in recents or []:
            if getattr(m, "kind", None) == "summary" and getattr(m, "content", ""):
                return str(m.content)[:400]
        try:
            from backend.services.sessions import client as sc
            ws = sc.get_workspace(project_id)
            if ws is not None:
                return f"Project: {ws.name} ({ws.kind})."
        except Exception as e:
            logger.debug("project_brain: sessions unavailable: %s", e)
        return ""

    # ── Aggregator ─────────────────────────────────────────────────────────

    def get(self, user_id: str, project_id: str) -> Optional[ProjectBrain]:
        """Build a fresh ProjectBrain snapshot. Returns None when the
        flag is off OR when basic identity is missing."""
        if not is_enabled() or not user_id or not project_id:
            return None
        brain = ProjectBrain(project_id=project_id, user_id=str(user_id))

        # ── Memories: prefer goal / decision / preference / project_context.
        #    Bound OUTSIDE the try so a Memory Plane failure leaves an empty
        #    list (not an unbound name) for the summary resolution below.
        recents: list = []
        try:
            from backend.services.memory_plane import client as mp
            recents = mp.list_user(user_id, project_id=project_id, limit=50)
            # Bucket by kind so we can surface them under the right field.
            for m in recents:
                txt = (m.content or "").strip()
                if not txt:
                    continue
                if m.kind == "goal" and len(brain.current_goals) < _MAX_GOALS:
                    brain.current_goals.append(txt)
                elif m.kind == "decision" and len(brain.recent_decisions) < _MAX_DECISIONS:
                    brain.recent_decisions.append(txt)
                elif m.kind in {"project_context", "fact"} and \
                        len(brain.important_context) < _MAX_NOTES:
                    brain.important_context.append(txt)
        except Exception as e:
            logger.debug("project_brain: memory_plane unavailable: %s", e)

        # ── Project summary — the SINGLE resolution rule (stashed summary
        #    memory, else the sessions workspace), shared with the Project
        #    Workspace read model. `recents` is handed over so the Memory Plane
        #    is read exactly once per aggregation.
        brain.project_summary = self.summary_for(
            user_id, project_id, memories=recents)

        # ── Assets: link summaries from the analyses cache.
        try:
            from backend.services.assets import client as ac
            from backend.services.vision import client as vc
            assets = ac.list_user(user_id, project_id=project_id, limit=_MAX_ASSETS)
            for a in assets:
                entry = {
                    "id":       a.id,
                    "filename": a.filename,
                    "type":     a.asset_type,
                    "status":   a.status,
                }
                cached = vc.get_cached(a.id or "") if a.id else None
                if cached and cached.get("summary"):
                    entry["summary"] = cached["summary"][:200]
                brain.linked_assets.append(entry)
        except Exception as e:
            logger.debug("project_brain: assets unavailable: %s", e)

        # ── Workflows: in-flight workflow snapshots.
        try:
            from backend.services.workflows import client as wfc
            for wf in wfc.list_user(user_id, project_id=project_id, limit=_MAX_WORKFLOWS):
                brain.workflow_state.append({
                    "id":       wf.id,
                    "type":     wf.type,
                    "status":   wf.status,
                    "progress": wf.progress,
                })
        except Exception as e:
            logger.debug("project_brain: workflows unavailable: %s", e)

        # ── Agent tasks: most-recent task summaries.
        try:
            from backend.services.agent_tasks import client as atc
            for t in atc.list_user(user_id, project_id=project_id, limit=4):
                if t.summary:
                    brain.agent_notes.append(t.summary[:160])
        except Exception as e:
            logger.debug("project_brain: agent_tasks unavailable: %s", e)

        # ── Connector signals: recent Gmail/GitHub observations for THIS project.
        #    Read through the canonical observation authority (no new store, no
        #    connector-specific engine), owner-scoped defensively so a brain
        #    fetch can never surface another user's connector activity. These are
        #    INPUTS ONLY — read here for context/reasoning; they never create a
        #    task/decision/run (the Business Brain remains the sole prioritizer).
        observations: list = []
        try:
            from backend.services.orchestrator import observations_store as obs
            observations = obs.recent_observations(
                project_id, user_id=str(user_id),
                sources=list(obs.CONNECTOR_SOURCES),
                limit=_MAX_OBSERVATIONS_READ)
            for o in observations[:_MAX_CONNECTOR_SIGNALS]:
                brain.connector_signals.append({
                    "source":      o.get("source"),
                    "kind":        o.get("kind"),
                    "summary":     (o.get("summary") or "")[:200],
                    "observed_at": o.get("observed_at"),
                    "importance":  o.get("importance"),
                    "external_id": o.get("external_id"),
                })
        except Exception as e:
            logger.debug("project_brain: observations unavailable: %s", e)

        # ── Correlated + INTERPRETED project state — what those signals add
        #    up to, and what that MEANS. A pure projection over the rows just
        #    read (no second query, no provider call, no model call, no write).
        #    This is the synthesized truth the prompt leads with; the raw
        #    signals above stay as bounded evidence beneath it rather than
        #    being the whole story.
        #
        #    Both halves come from ONE call so the subject list and the
        #    project-level reading are guaranteed to describe the same instant
        #    — a chat that said "3 open subjects" beside a synthesis computed
        #    from a second read could contradict itself in a single answer.
        try:
            from backend.services import project_intelligence as pi
            understood = pi.understand(observations, limit=_MAX_INTELLIGENCE)
            brain.intelligence = understood.get("subjects") or []
            brain.understanding = understood.get("synthesis") or {}
        except Exception as e:
            logger.debug("project_brain: project intelligence unavailable: %s", e)

        # ── Durable typed BUSINESS KNOWLEDGE (Business Brain Phase 3).
        #    AUDIT FINDING: the brain collected goals, decisions, products,
        #    chats and connector signals but never read the business-knowledge
        #    authority at all, so a competitor price or a recorded learning
        #    reached an agent run (through `orchestrator.project_intelligence`)
        #    yet never reached project CHAT. Same adapter, same Memory Plane,
        #    no new store — it just needed consuming. The Memory Plane scopes
        #    every read by user_id AND project_id, so this is structurally
        #    owner-isolated exactly like the memory slice above.
        try:
            from backend.services.orchestrator import business_knowledge as bk
            brain.business_knowledge = bk.list_knowledge(
                user_id=str(user_id), project_id=str(project_id),
                limit=_MAX_BUSINESS_KNOWLEDGE)
        except Exception as e:
            logger.debug("project_brain: business knowledge unavailable: %s", e)

        # ── Project-scoped authorities (goals / decisions / products / chats).
        #    These stores are keyed by project_id ONLY, so they are pulled behind
        #    a fail-closed ownership gate (see `_owns_project`). Everything above
        #    is already user-scoped; only this block needs the gate.
        # The STRUCTURED rows behind the two title lists below. Kept so the
        # decision reading further down can be computed from the authorities'
        # own records (a goal's id and priority, a decision's timestamp)
        # without reading either store a second time.
        structured_goals: list = []
        active_decisions: list = []

        if _owns_project(str(user_id), project_id):
            # Structured active goals — the authoritative Business Brain goals
            # (hierarchy, success criteria), distinct from memory-plane goal
            # notes. Merge titles into current_goals, deduped, staying bounded.
            try:
                from backend.services.orchestrator import goals_store
                have = {g.strip().lower() for g in brain.current_goals}
                structured_goals = goals_store.active_goals(project_id, limit=_MAX_GOALS)
                for g in structured_goals:
                    title = (g.get("title") or "").strip()
                    if title and title.lower() not in have and \
                            len(brain.current_goals) < _MAX_GOALS:
                        brain.current_goals.append(title)
                        have.add(title.lower())
            except Exception as e:
                logger.debug("project_brain: goals_store unavailable: %s", e)

            # Authoritative active decisions (topic → value), superseded-aware.
            try:
                from backend.services.orchestrator import decisions_store
                have_d = {d.strip().lower() for d in brain.recent_decisions}
                active_decisions = decisions_store.active_decisions(
                    project_id, limit=_MAX_DECISIONS)
                for d in active_decisions:
                    topic = (d.get("topic") or "").strip()
                    value = (d.get("value") or "").strip()
                    if not value:
                        continue
                    line = f"{topic}: {value}" if topic else value
                    if line.lower() not in have_d and \
                            len(brain.recent_decisions) < _MAX_DECISIONS:
                        brain.recent_decisions.append(line)
                        have_d.add(line.lower())
            except Exception as e:
                logger.debug("project_brain: decisions_store unavailable: %s", e)

            # Generated Web/App products — bounded references from the canonical
            # deliverables authority. The build payload/source tree stays in the
            # artifact authority; the brain carries only refs + status + type.
            try:
                from backend.services.orchestrator import project_products
                for p in project_products.list_products(project_id, limit=_MAX_PRODUCTS):
                    entry = dict(p)
                    entry["title"] = str(entry.get("title") or "")[:160]
                    brain.products.append(entry)
            except Exception as e:
                logger.debug("project_brain: product projection unavailable: %s", e)

            # Project-linked chats — the durable workspace's conversations. Reads
            # the canonical project↔thread binding, then the sessions authority
            # (server messages are canonical; localStorage is never consulted).
            # For each ORDINARY chat bound to THIS project we surface a bounded
            # excerpt of the most-recent substantive user/assistant turns so the
            # brain can actually reason over what was discussed — not just the
            # title. Build/tool sessions are excluded from content (their payloads
            # live in the artifact authority and are represented as products).
            # Threads are owner-scoped defensively via their workspace, so a
            # removed/moved binding immediately changes what is surfaced (this is
            # recomputed every call — no cache).
            try:
                from backend.services.projects import store as projects_store
                from backend.services.sessions import client as sc
                links = projects_store.list_project_threads(project_id)
                for link in links:
                    if len(brain.linked_chats) >= _MAX_CHATS:
                        break
                    th = sc.get_thread(link.thread_id)
                    if th is None:
                        continue
                    ws = sc.get_workspace(th.workspace_id)
                    if ws is None or str(ws.user_id) != str(user_id):
                        continue   # defense-in-depth owner check
                    is_ordinary = str(th.mode or "") in _ORDINARY_CHAT_MODES
                    recent: list[dict] = []
                    last_msg = ""
                    if is_ordinary:
                        try:
                            for m in sc.list_recent_messages(th.id, limit=_MAX_CHAT_TURNS):
                                if m.role not in ("user", "assistant"):
                                    continue   # omit system/tool turns
                                content = (m.content or "").strip()
                                if not content:
                                    continue
                                recent.append({
                                    "role":       m.role,
                                    "content":    content[:_MAX_CHAT_TURN_CHARS],
                                    "created_at": m.created_at,
                                })
                            if recent:
                                last_msg = recent[-1]["content"][:_MAX_CHAT_PREVIEW_CHARS]
                        except Exception:
                            pass
                    brain.linked_chats.append({
                        "thread_id":    th.id,
                        "title":        th.title,
                        "mode":         th.mode,
                        "updated_at":   th.updated_at,
                        "last_message": last_msg,
                        "recent":       recent,   # bounded substantive turns (ordinary chats)
                    })
            except Exception as e:
                logger.debug("project_brain: project chats unavailable: %s", e)

        # ── NEEDS ATTENTION — the EXISTING deterministic ranking, surfaced.
        #    AUDIT FINDING: `attention` was computed for the Project page and
        #    never reached project CHAT, so "what should I focus on?" was
        #    answered by the model re-ordering a state list — i.e. by inventing
        #    a ranking next to the one authority that owns it. Same pure
        #    function, same rows already in hand (observations + the products
        #    read under the ownership gate above): ZERO extra queries, ZERO
        #    tokens, and nothing here re-weights what it returns.
        try:
            from backend.services.project_brain import attention as attention_mod
            brain.attention = attention_mod.rank_attention(
                observations, products=brain.products, limit=_MAX_ATTENTION)
        except Exception as e:
            logger.debug("project_brain: attention unavailable: %s", e)

        # ── WHY IT MATTERS NOW — the decision reading over the SAME subjects.
        #    AUDIT FINDING: the prompt could say what the project's state was
        #    and what needed a look, and nothing said which single thing was
        #    most important, why, or whether Korvix could actually do anything
        #    about it — so "what should I focus on?" was answered by the model
        #    re-ordering a list. `decision_context` is the one authority for
        #    that question and `action_prioritizer` applies the identical
        #    ladder to the Business Brain's candidates, so chat and the
        #    Business Brain cannot give two different top priorities.
        #
        #    Pure over rows already in hand (the correlated subjects, the
        #    observations, the structured goals and decisions read above):
        #    ZERO extra queries, ZERO tokens, ZERO writes.
        try:
            from backend.services.orchestrator import decision_context as dc
            brain.focus = dc.project_focus(
                brain.intelligence, observations=observations,
                goals=structured_goals, decisions=active_decisions)
        except Exception as e:
            logger.debug("project_brain: decision context unavailable: %s", e)

        # ── EVIDENCE GROUNDING — the claims this project's evidence does NOT
        #    establish, named explicitly.
        #
        #    PRODUCTION FINDING, fixed here. Everything above describes what the
        #    project HAS: subjects, states, implications, activity. Nothing said
        #    what it has NO evidence for — so a Vercel-only project, whose whole
        #    truth is "two deployments were reported", produced answers about
        #    testing being performed, functionality being ready, goals
        #    progressing and user feedback being evaluated. Absence was never
        #    stated, so absence was never respected.
        #
        #    Computed LAST on purpose: it reads the goals, decisions and durable
        #    knowledge gathered above alongside the same observation rows, so it
        #    speaks for the whole project rather than for the connectors alone.
        #    Pure projection — ZERO extra queries, ZERO tokens, ZERO writes.
        try:
            from backend.services import project_intelligence as pi
            brain.grounding = pi.ground_claims(
                observations,
                goals=brain.current_goals,
                decisions=brain.recent_decisions,
                knowledge=brain.business_knowledge,
            )
        except Exception as e:
            logger.debug("project_brain: grounding unavailable: %s", e)

        # ── Counts: cheap health snapshot.
        brain.counts = {
            "goals":           len(brain.current_goals),
            "decisions":       len(brain.recent_decisions),
            "context_notes":   len(brain.important_context),
            "linked_assets":   len(brain.linked_assets),
            "active_workflows":len(brain.workflow_state),
            "agent_notes":     len(brain.agent_notes),
            "connector_signals": len(brain.connector_signals),
            "intelligence":    len(brain.intelligence),
            "attention":       len(brain.attention),
            "understanding_open": len(((brain.understanding or {}).get("open")) or []),
            "focus_next":      len(((brain.focus or {}).get("next")) or []),
            "business_knowledge": len(brain.business_knowledge),
            "unsupported_claims": len(_unsupported_claims(brain.grounding)),
            "products":        len(brain.products),
            "linked_chats":    len(brain.linked_chats),
        }
        return brain

    # ── Prompt-injection helper ────────────────────────────────────────────

    def build_context(
        self, user_id: str, project_id: str,
    ) -> Optional[ProjectContextBlock]:
        """Compose the system-prompt fragment. Returns None when the brain is
        empty OR the subsystem is disabled — the chat layer treats None as
        'nothing to inject'.

        WHY THIS IS ASSEMBLED IN PRIORITY ORDER WITH PER-SECTION BUDGETS
        ----------------------------------------------------------------
        AUDIT FINDING, fixed here. The block used to be concatenated in field
        order and then truncated from the TAIL at `_CTX_BLOCK_CHAR_BUDGET`.
        Project chat excerpts sit near the middle and can legitimately reach
        several thousand characters on their own, and the synthesized project
        state was emitted AFTER them — so on any project with a few real
        conversations the single most valuable block was the one silently cut
        off. Understanding the project was computed, paid for, and thrown away
        at the last step.

        The fix is a projection, not a bigger budget: sections are emitted
        most-load-bearing first, each with its own cap, and a section that does
        not fit is trimmed line-by-line (or skipped) instead of taking the
        space from everything after it. The total is unchanged at
        `_CTX_BLOCK_CHAR_BUDGET`, so this costs no additional prompt tokens —
        it just spends the same budget on the right things.

        Deterministic, bounded, and free of model/provider calls, as before."""
        brain = self.get(user_id, project_id)
        if brain is None:
            return None

        # (priority, cap, lines). Priority IS the list order.
        sections: list[tuple[int, list[str]]] = []

        def section(cap: int, lines: list[str]) -> None:
            if lines:
                sections.append((cap, lines))

        if brain.project_summary:
            section(500, [f"Project context:\n{_clean(brain.project_summary, 400)}"])
        if brain.current_goals:
            section(400, ["Current goals:"]
                    + [f"- {_clean(g, 200)}" for g in brain.current_goals])
        if brain.recent_decisions:
            section(400, ["Recent decisions:"]
                    + [f"- {_clean(d, 200)}" for d in brain.recent_decisions])
        if brain.important_context:
            section(400, ["Important context:"]
                    + [f"- {_clean(c, 200)}" for c in brain.important_context])

        # The blocks this whole layer exists to deliver, above anything that
        # can grow with conversation volume. FOCUS leads them: a model that
        # meets "what matters most, and why" before the evidence answers the
        # question the user actually asks, and answers it with the one
        # deterministic order rather than an order it invented from a list.
        section(650, _focus_lines(brain.focus))
        section(700, _understanding_lines(brain.understanding))
        # Directly under the project-level reading, and ABOVE the per-subject
        # detail: a model that meets "what this evidence does not establish"
        # before it meets a list of green deployments reads the list as what it
        # is. Below FOCUS and UNDERSTANDING because those answer the question;
        # this one governs HOW the answer may be phrased.
        # 900, and it self-balances: the section is long only when the project
        # has little evidence — exactly when the sections around it are short.
        # A project with rich evidence has few unestablished claims and a short
        # line here.
        section(1100, _grounding_lines(brain.grounding))
        if brain.intelligence:
            section(1100, ["Project state — what the evidence across the connected "
                           "tools adds up to (correlated, not raw events):"]
                    + _intelligence_lines(brain.intelligence))
        section(400, _attention_lines(brain.attention))

        if brain.business_knowledge:
            lines = ["Business knowledge & learnings (durable, provenance-tagged; "
                     "external facts may be stale — weigh by recency):"]
            for entry in brain.business_knowledge[:_MAX_BUSINESS_KNOWLEDGE]:
                domain = _clean(entry.get("domain") or "knowledge", 40).upper()
                source = _clean(entry.get("source") or "SYSTEM", 40).upper()
                observed = _date(entry.get("observed_at"))
                when = f" (observed {observed})" if observed else ""
                lines.append(f"- [{domain} · {source}] "
                             f"{_clean(entry.get('summary'), 220)}{when}")
            section(700, lines)

        if brain.products:
            lines = ["Generated products:"]
            for p in brain.products[:_MAX_PRODUCTS]:
                title = _clean(p.get("title"), 160) or "(untitled)"
                bt = _clean(p.get("build_type") or "web", 16).upper()
                status = _clean(p.get("status") or "?", 40)
                lines.append(f"- [{bt}] {title} ({status})")
            section(400, lines)

        if brain.linked_assets:
            lines = ["Attached assets:"]
            for a in brain.linked_assets[:_MAX_ASSETS]:
                line = f"- [{_clean(a.get('type') or '?', 40)}] " \
                       f"{_clean(a.get('filename') or '?', 120)}"
                if a.get("summary"):
                    line += f" — {_clean(a['summary'], 200)}"
                lines.append(line)
            section(400, lines)

        if brain.workflow_state:
            section(250, ["Active workflows:"] + [
                f"- {_clean(w.get('type') or '?', 60)} "
                f"({_clean(w.get('status') or '?', 40)}, "
                f"{_clean(w.get('progress', 0), 12)}%)"
                for w in brain.workflow_state])
        if brain.agent_notes:
            section(250, ["Agent notes:"]
                    + [f"- {_clean(n, 160)}" for n in brain.agent_notes])

        if brain.linked_chats:
            # Each project chat is a clearly-separated block with a bounded
            # excerpt of its recent user/assistant turns, so the model can
            # reason over what was actually discussed/decided. It sits below
            # the synthesized understanding because it is the section that
            # grows without limit as a project is used — see the docstring.
            lines = ["Project chat excerpts (most recent turns per chat):"]
            for ch in brain.linked_chats[:_MAX_CHATS]:
                lines.append(f"— Chat: {_clean(ch.get('title'), 120) or '(untitled chat)'}")
                recent = ch.get("recent") or []
                if recent:
                    for turn in recent:
                        content = _clean(turn.get("content"), _MAX_CHAT_TURN_CHARS)
                        if content:
                            lines.append(f"  {_clean(turn.get('role') or 'user', 20)}: "
                                         f"{content}")
                else:
                    preview = _clean(ch.get("last_message"), _MAX_CHAT_PREVIEW_CHARS)
                    if preview:
                        lines.append(f"  {preview}")
            section(1400, lines)

        if brain.connector_signals:
            # Header text is pinned by tests and by the frontend's expectations;
            # the "prefer the synthesis" instruction lives on the PROJECT STATE
            # header above, which is where a model reading top-down meets it
            # first anyway.
            lines = ["Recent connector activity:"]
            for sig in brain.connector_signals[:_MAX_CONNECTOR_SIGNALS]:
                label = _clean(sig.get("summary") or sig.get("kind") or "activity", 200)
                lines.append(f"- [{_clean(sig.get('source'), 40) or '?'}] {label}")
            section(500, lines)

        # ── Emit within the SAME total budget, most-load-bearing first ──────
        out: list[str] = []
        used = 0
        for cap, lines in sections:
            room = min(cap, _CTX_BLOCK_CHAR_BUDGET - used)
            if room <= 0:
                break
            taken: list[str] = []
            spent = 0
            for line in lines:
                cost = len(line) + 1
                if spent + cost > room:
                    break
                taken.append(line)
                spent += cost
            # A section reduced to nothing but its own header says nothing and
            # would only mislead ("Recent decisions:" followed by silence), so
            # it is dropped rather than emitted empty.
            if len(taken) >= 2 or (len(taken) == 1 and len(lines) == 1):
                out.extend(taken)
                used += spent

        if not out:
            return None
        text = "\n".join(out)
        if len(text) > _CTX_BLOCK_CHAR_BUDGET:      # belt and braces
            text = text[:_CTX_BLOCK_CHAR_BUDGET] + "\n…"
        return ProjectContextBlock(text=text, metadata=brain.counts)

    def stats(self) -> dict:
        return {"enabled": is_enabled()}


client: ProjectBrainClient = ProjectBrainClient()


__all__ = ["ProjectBrainClient", "client", "is_enabled"]
