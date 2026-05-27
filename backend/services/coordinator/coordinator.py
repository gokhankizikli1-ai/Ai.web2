# coding: utf-8
"""Phase 9 — Coordinator implementation.

Rule-based intent classifier that maps a user message + asset hints to
a Plan over the existing AgentSpec registry. No LLM call here — keeps
the plan preview O(1ms) and free, so the FE can show it before the
user even hits Send.

Phase 9 part 2 — Coordinator also exposes `classify()`, a cheap
complexity probe used to decide whether a panel should auto-activate.
"chat" turns stay on the existing single-LLM path; "complex" turns
spawn a panel, presence updates, and (in the next PR) sub-agent
delegation through the existing delegate.py policy layer.

Design notes:
  * Multilingual signals — KorvixAI's userbase types in EN + TR. The
    rule sets include the most common Turkish trigger words alongside
    the English ones so the classifier doesn't fall back to "chat"
    on a Turkish prompt like "araştır" / "tasarla".
  * Conservative confidence — when more than one specialist matches,
    we lower confidence and add the supervisor as the primary so the
    fan-out is real; when only one matches strongly, the specialist
    leads directly.
  * Honest fallback — when no rule fires, the plan is a single
    supervisor invocation with reason="no specialist signal in
    request". The FE can hide the preview entirely in that case.
"""
from __future__ import annotations

import logging
import os
import re
from typing import Any, Iterable, Optional

from backend.services.coordinator.types import AgentInvocation, Plan


logger = logging.getLogger(__name__)


def is_enabled() -> bool:
    """ENABLE_COORDINATOR — gates both the route and any in-process
    callers (the future auto-invocation path). Default off so this PR
    ships dark and ops can roll it out one cohort at a time."""
    return os.getenv("ENABLE_COORDINATOR", "false").strip().lower() == "true"


# ── Intent rules ───────────────────────────────────────────────────────────
#
# Each rule maps a regex (case-insensitive, multilingual) → (agent_id,
# reason, weight). Higher weight = stronger signal. When multiple rules
# fire, the primary specialist is the highest-weighted match, and any
# other specialists with weight ≥ 0.5 become follow-up nodes.
#
# Intentionally narrow — these are the rules I have confidence in.
# Adding rules is easy; removing them after they ship is hard. Better
# to surface "no plan" than a wrong one.

_Rule = tuple[str, str, str, float]   # (pattern, agent_id, reason, weight)


_RULES: tuple[_Rule, ...] = (
    # ── Research signals ──────────────────────────────────────────────
    (
        r"\b(research|investigate|find\s+out|look\s+up|compare|analy[sz]e\s+market|competitors?|"
        r"araştır|incele|karşılaştır|rakip)\b",
        "researcher",
        "Request mentions research / competitor / market analysis — Researcher agent gathers sources.",
        0.85,
    ),
    (
        r"\b(?:tesla|stock|earnings|sentiment|trend|forecast|piyasa|analiz|raporu)\b",
        "researcher",
        "Mentions a market / financial topic — Researcher pulls evidence.",
        0.6,
    ),

    # ── Coding signals ────────────────────────────────────────────────
    (
        r"\b(code|debug|refactor|fix\s+(?:the\s+)?bug|implement|function|api|"
        r"kod(?:la|u)?|hata|düzelt|fonksiyon)\b",
        "coder",
        "Mentions code / debug / refactor — Coder agent writes and reviews.",
        0.85,
    ),
    (
        r"```",                                  # triple-backtick code fence
        "coder",
        "Contains a code block — Coder agent will treat it as the working artefact.",
        0.7,
    ),

    # ── UI / front-end signals ────────────────────────────────────────
    (
        r"\b(landing\s+page|hero\s+section|navbar|component|tailwind|button|layout|"
        r"website|website[ -]design|tasarla|sayfa\s+yap|arayüz)\b",
        "ux_designer",
        "Mentions UI / page layout / component — UX Designer produces the structure.",
        0.8,
    ),

    # ── Brand / copy signals ──────────────────────────────────────────
    (
        r"\b(brand|logo|color\s+palette|typography|marka|renk\s+palet)\b",
        "brand_designer",
        "Mentions brand / palette / typography — Brand Designer chooses the visual system.",
        0.75,
    ),
    (
        r"\b(headline|tagline|copy|microcopy|landing\s+text|slogan)\b",
        "copywriter",
        "Mentions copy / headline / slogan — Copywriter drafts the language.",
        0.75,
    ),

    # ── Trading signals ───────────────────────────────────────────────
    (
        r"\b(trade|signal|entry|stop\s+loss|long|short|btc|eth|alım|satım|fiyat|"
        r"piyasa|forex)\b",
        "trader",
        "Mentions a trading concept — Trader agent evaluates the setup.",
        0.7,
    ),

    # ── Marketing / ads signals ───────────────────────────────────────
    (
        r"\b(ad\s+copy|google\s+ads?|meta\s+ads?|facebook\s+ads?|tiktok\s+ads?|"
        r"campaign|reklam|kampanya)\b",
        "marketer",
        "Mentions an ad / campaign — Marketer drafts targeting + messaging.",
        0.75,
    ),

    # ── Strategy / product signals ────────────────────────────────────
    (
        r"\b(strategy|roadmap|pricing|positioning|go\s*to\s*market|product[ -]market\s+fit|"
        r"strateji|yol\s+haritası)\b",
        "product_strategist",
        "Mentions strategy / pricing / positioning — Product Strategist scopes the play.",
        0.75,
    ),
)


# ── Asset-driven rules ────────────────────────────────────────────────────
#
# Run independently of the text rules so an image attachment fires a
# UX Designer review even if the user's prompt is just "what about
# this?"

def _asset_rules(asset_mime_types: Iterable[str]) -> list[tuple[str, str, float]]:
    mimes = [(m or "").lower() for m in asset_mime_types or ()]
    fired: list[tuple[str, str, float]] = []
    if any(m.startswith("image/") for m in mimes):
        fired.append((
            "ux_designer",
            "Image attached — UX Designer interprets the screenshot / mockup.",
            0.7,
        ))
    if any(m == "application/pdf" or m.startswith("text/") for m in mimes):
        fired.append((
            "researcher",
            "Document attached — Researcher extracts the structured findings.",
            0.65,
        ))
    return fired


# ── Coordinator class ──────────────────────────────────────────────────────

class Coordinator:
    """Stateless planner — every analyze() call is independent. Safe to
    share a single instance across requests."""

    def analyze(
        self,
        *,
        user_message:     str,
        project_id:       Optional[str] = None,        # reserved for future memory-aware planning
        asset_mime_types: Optional[Iterable[str]] = None,
    ) -> Plan:
        """Produce a Plan for the given input. Never raises — returns a
        single-supervisor fallback plan when nothing matches so the
        caller can always rely on a well-formed Plan object.

        `project_id` is accepted today and reserved for the follow-up PR
        that will pull recent scratchpad notes into the rule context.
        """
        text = (user_message or "").strip()
        if not text and not asset_mime_types:
            return self._fallback_plan(intent="empty", reason=(
                "No user message and no attachments — supervisor will "
                "open a clarification dialogue."
            ))

        matches: list[tuple[str, str, float]] = []
        for pattern, agent_id, reason, weight in _RULES:
            try:
                if re.search(pattern, text, flags=re.IGNORECASE):
                    matches.append((agent_id, reason, weight))
            except re.error as exc:
                # Defensive — a malformed rule shouldn't kill the
                # whole classifier.
                logger.warning("coordinator.rule error: pattern=%r err=%s", pattern, exc)

        matches.extend(_asset_rules(asset_mime_types or ()))

        if not matches:
            return self._fallback_plan(intent="chat", reason=(
                "No specialist signal in the request — supervisor handles "
                "as a general chat turn."
            ))

        # Dedupe by agent_id, keeping the highest-weighted reason for each.
        by_agent: dict[str, tuple[str, float]] = {}
        for agent_id, reason, weight in matches:
            prev = by_agent.get(agent_id)
            if prev is None or weight > prev[1]:
                by_agent[agent_id] = (reason, weight)

        # Sort highest weight first; the leader becomes primary.
        ordered = sorted(by_agent.items(), key=lambda kv: kv[1][1], reverse=True)
        primary_id, (primary_reason, primary_weight) = ordered[0]
        followers = [
            (a, r) for a, (r, w) in ordered[1:] if w >= 0.5
        ]

        # When multiple specialists fire AND any of them is a designer/
        # researcher/copywriter combo, route through the supervisor so
        # the existing delegate.py policy enforces depth + budget caps.
        # Single-specialist plans skip the supervisor — no need to pay
        # the extra round-trip for a one-agent task.
        if followers:
            agents = [
                AgentInvocation(
                    agent_id="supervisor",
                    reason="Multiple specialists matched — supervisor orchestrates and merges.",
                    depends_on=[],
                ),
                AgentInvocation(
                    agent_id=primary_id, reason=primary_reason,
                    depends_on=["supervisor"],
                ),
                *[
                    AgentInvocation(
                        agent_id=aid, reason=reason, depends_on=["supervisor"],
                    )
                    for aid, reason in followers
                ],
            ]
            confidence = min(0.95, 0.6 + 0.1 * len(followers))
            intent = "multi_agent"
        else:
            agents = [
                AgentInvocation(
                    agent_id=primary_id, reason=primary_reason, depends_on=[],
                ),
            ]
            confidence = primary_weight
            intent = primary_id

        notes = self._notes_for(asset_mime_types or ())

        return Plan(
            intent=         intent,
            routing_method= "rule_based",
            confidence=     round(confidence, 2),
            agents=         agents,
            notes=          notes,
        )

    # ── Helpers ────────────────────────────────────────────────────────────

    def _fallback_plan(self, *, intent: str, reason: str) -> Plan:
        return Plan(
            intent=         intent,
            routing_method= "rule_based",
            confidence=     0.0,
            agents=[
                AgentInvocation(
                    agent_id="supervisor", reason=reason, depends_on=[],
                ),
            ],
            notes=[],
        )

    # ── Complexity classification ──────────────────────────────────────────
    #
    # A separate, even faster probe than analyze(). Used by the FE
    # (and by the future auto-invoker in the chat route) to decide
    # whether the request is "simple chat — let the LLM handle it
    # directly" vs "complex multi-step — spawn a panel."
    #
    # The classifier deliberately ignores the AgentSpec table. It's
    # purely about INSTRUCTION SHAPE, not about which specialist
    # would handle it. That keeps it stable when new specialists
    # ship.

    # Trigger keywords that strongly suggest a multi-step task.
    _COMPLEX_TRIGGERS: tuple[str, ...] = (
        # English
        "build", "design", "create a", "compare", "analyze",
        "automation", "workflow", "research deeply", "competitor",
        "implement", "refactor", "generate a", "draft a", "produce a",
        "step by step", "step-by-step", "end to end", "end-to-end",
        # Turkish
        "kur", "tasarla", "kıyasla", "karşılaştır", "araştır",
        "implementasyon", "iş akışı", "otomasyon", "uçtan uca",
    )

    # Phrases that disqualify the request from being "complex" even if
    # a trigger keyword fires — usually casual or short.
    _SIMPLE_OVERRIDES: tuple[str, ...] = (
        "hi", "hello", "hey", "thanks", "thank you", "merhaba", "selam",
        "ok", "okay", "tamam",
    )

    def classify(
        self,
        *,
        user_message:     str,
        asset_mime_types: Optional[Iterable[str]] = None,
    ) -> dict[str, Any]:
        """Return a small dict describing how complex the request is.

        Keys:
          complexity   "low" | "medium" | "high"
          triggers     list of matched trigger keywords (for the FE
                       to render "Detected: build, compare")
          should_spawn_panel  bool — true when complexity >= medium
                              AND no simple-override fires
          reason       short human-readable summary

        Deliberately conservative — false negatives (rating something
        simpler than it is) are cheaper than false positives (spawning
        a panel for "hi"). When in doubt, returns "low" / False.
        """
        text = (user_message or "").strip()
        if not text:
            return {
                "complexity":        "low",
                "triggers":          [],
                "should_spawn_panel": False,
                "reason":            "empty message",
            }
        lower = text.lower()

        # Simple overrides win — short greetings never spawn panels.
        if any(o in lower for o in self._SIMPLE_OVERRIDES) and len(text) < 40:
            return {
                "complexity":        "low",
                "triggers":          [],
                "should_spawn_panel": False,
                "reason":            "short greeting / acknowledgement",
            }

        triggers = [t for t in self._COMPLEX_TRIGGERS if t in lower]
        # Length is a secondary signal — a 30-word prompt is almost
        # always doing more than chitchat.
        word_count = len(re.findall(r"\S+", text))
        has_assets = bool(list(asset_mime_types or ()))

        score = 0
        if triggers:        score += 2
        if word_count >= 25: score += 1
        if has_assets:      score += 1
        if word_count >= 60: score += 1

        if score >= 3:
            return {
                "complexity":        "high",
                "triggers":          triggers,
                "should_spawn_panel": True,
                "reason":            (
                    f"score={score} (triggers={len(triggers)}, words={word_count}, "
                    f"assets={int(has_assets)})"
                ),
            }
        if score >= 2:
            return {
                "complexity":        "medium",
                "triggers":          triggers,
                "should_spawn_panel": True,
                "reason":            f"score={score} — multi-signal request",
            }
        return {
            "complexity":        "low",
            "triggers":          triggers,
            "should_spawn_panel": False,
            "reason":            f"score={score} — single-signal request",
        }

    def _notes_for(self, asset_mime_types: Iterable[str]) -> list[str]:
        out: list[str] = []
        mimes = [(m or "").lower() for m in asset_mime_types or ()]
        if any(m.startswith("image/") for m in mimes):
            out.append(
                "Image attachments will be folded into the user turn as "
                "multimodal content when the selected model supports vision."
            )
        if any(m == "application/pdf" or m.startswith("text/") for m in mimes):
            out.append(
                "Document attachments will be summarised into the project "
                "scratchpad before the specialist agents run."
            )
        return out


# Module-level singleton — Coordinator is stateless so it's safe to share.
coordinator = Coordinator()


__all__ = ["Coordinator", "coordinator", "is_enabled"]
