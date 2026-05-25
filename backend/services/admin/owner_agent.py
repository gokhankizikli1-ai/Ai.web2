# coding: utf-8
"""
Owner Agent ("Shadow Agent") — the private agent the project owner
uses for internal work.

Capabilities the owner agent is designed to help with:
  - architecture                   (system design, trade-offs)
  - code generation                (small/medium scaffolds)
  - debugging                      (root-cause walking)
  - refactoring                    (incremental safety)
  - deployment                     (config, env, ops)
  - product strategy               (positioning, roadmap)
  - automation                     (cron, workflows, scripts)
  - security review (defensive)    (code audit, threat model, harden)
  - internal project operations    (data plumbing, internal tools)

Capabilities the owner agent will NOT do, regardless of owner status:
  - write malware, ransomware, spyware, keyloggers, rootkits
  - help steal credentials or bypass others' authentication
  - build phishing kits
  - develop weaponised exploits
  - help with DDoS, mass / supply-chain compromise
  - help evade detection for offensive deployment

This module composes three layers:
  1. The safety classifier (safety.classify) — rejects requests in
     the hard-block categories BEFORE the model is invoked.
  2. A frozen system prompt — `safety.owner_guardrail_prompt()` plus
     the safe-cyber addendum when relevant.
  3. The existing `ask_ai` plumbing from the root project module.

The agent is intentionally a thin wrapper. It does not own a chat
history of its own (the caller passes one in), it does not tee to
SSE, and it does not retry. The /v2/admin/owner-agent route owns
the request lifecycle; this layer owns the safety contract.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from backend.core.config import settings
from backend.services.admin import safety


logger = logging.getLogger(__name__)


# ── Public dataclasses ──────────────────────────────────────────────────

@dataclass
class OwnerAgentRequest:
    message: str
    capability: str = "general"                  # "architecture" | "debug" | ...
    history: List[Dict[str, str]] = field(default_factory=list)
    model: Optional[str] = None                  # override; defaults to MODEL_STRONG


@dataclass
class OwnerAgentResponse:
    reply: str
    blocked: bool = False
    block_category: str = ""
    safe_cyber: bool = False                     # True if classify() said "safe-cyber"
    model: str = ""
    provider: str = ""
    capability: str = "general"
    metadata: Dict[str, Any] = field(default_factory=dict)


# ── Capability → system-prompt templates ────────────────────────────────
#
# Each capability gets a short, specific role line. The owner guardrail
# from safety.owner_guardrail_prompt() is ALWAYS appended on top — the
# capability prompts cannot override it because the guardrail comes
# last (closer to the user message is stronger in most chat models).

_CAPABILITY_PROMPTS: Dict[str, str] = {
    "general":
        "You are the project owner's private assistant. Be direct, technical, "
        "and concise. Skip preamble. When in doubt, ask one clarifying question "
        "instead of guessing.",
    "architecture":
        "You are a senior architect advising the project owner. Identify the "
        "smallest change that solves the problem. Surface trade-offs explicitly. "
        "Prefer boring, well-understood tech over novel choices. Diagram in text "
        "when it clarifies.",
    "code_generation":
        "You generate production-grade code for the project owner. Match the "
        "existing codebase's idioms. Default to no comments unless they explain "
        "WHY non-obvious. Never invent APIs you haven't seen — say so if unsure.",
    "debugging":
        "You debug for the project owner. Walk the root cause; don't suggest "
        "fixes until you understand the failure. Ask for log lines / repro "
        "before guessing. Treat the simplest hypothesis as most likely.",
    "refactoring":
        "You refactor for the project owner. Move in small, reversible steps. "
        "Preserve behaviour exactly unless the user asks for a change. Call out "
        "test coverage gaps that would make a refactor unsafe.",
    "deployment":
        "You advise on deployment / ops for the project owner. Be specific about "
        "env vars, secrets handling, and rollback. Surface anything that could "
        "cause production downtime BEFORE recommending it.",
    "product_strategy":
        "You advise on product strategy for the project owner. Focus on user "
        "value, distribution, and second-order effects. Push back when an idea "
        "is locally clever but globally weak.",
    "automation":
        "You design automations for the project owner. Default to idempotent, "
        "auditable workflows. Surface failure modes and how the automation "
        "would behave on partial failure.",
    "security_review":
        "You perform DEFENSIVE security review for the project owner. Identify "
        "weaknesses, propose mitigations, write detection rules, and harden "
        "code. Do not produce offensive payloads, exploitation steps, or "
        "evasion guidance — even framed as 'research'.",
    "internal_ops":
        "You help the project owner run internal operations: data plumbing, "
        "admin scripts, one-shot maintenance jobs. Be conservative with "
        "destructive actions — always show the dry-run / read-only form first.",
}


_VALID_CAPABILITIES = set(_CAPABILITY_PROMPTS.keys())


def valid_capabilities() -> List[str]:
    """Stable ordered list of capability ids — surfaced by /v2/admin/status."""
    return sorted(_VALID_CAPABILITIES)


def _build_system_prompt(capability: str, verdict: safety.SafetyVerdict) -> str:
    base = _CAPABILITY_PROMPTS.get(capability, _CAPABILITY_PROMPTS["general"])
    parts = [base]
    if verdict.decision == "safe-cyber" or capability == "security_review":
        parts.append(safety.safe_cyber_addendum())
    # Guardrail LAST — closest to the user message; carries the most
    # weight in most chat models. If the caller's capability prompt ever
    # contradicts the guardrail, the guardrail wins.
    parts.append(safety.owner_guardrail_prompt())
    return "\n\n".join(parts)


# ── Entry point ─────────────────────────────────────────────────────────

async def run(req: OwnerAgentRequest) -> OwnerAgentResponse:
    """Execute one owner-agent turn.

    The flow is:
      1. Validate capability (unknown → 'general').
      2. classify(message). If "block" → return refusal; no model call.
      3. Build the layered system prompt.
      4. Call ask_ai. On any failure return a soft error reply (the
         route layer will wrap it in an envelope).
    """
    capability = req.capability if req.capability in _VALID_CAPABILITIES else "general"

    verdict = safety.classify(req.message)
    if verdict.decision == "block":
        logger.warning(
            "owner_agent.block | category=%s | capability=%s",
            verdict.category, capability,
        )
        return OwnerAgentResponse(
            reply=verdict.reason,
            blocked=True,
            block_category=verdict.category,
            capability=capability,
            metadata={"safety": {"decision": "block", "category": verdict.category}},
        )

    system_prompt = _build_system_prompt(capability, verdict)
    model = req.model or settings.MODEL_STRONG
    provider = "openai"   # ask_ai today routes via the OpenAI client; the
                          # provider router rewrites this when available.

    try:
        # Lazy import — owner-agent runs in-process but keeps the
        # subsystem isolated when ask_ai fails to import (e.g. no
        # OPENAI_API_KEY at boot).
        from ai_client import ask_ai
        reply = await ask_ai(
            req.message, system_prompt, list(req.history or []),
            model=model,
        )
    except Exception as exc:
        logger.warning("owner_agent.ask_ai failed: %s", exc)
        return OwnerAgentResponse(
            reply=(
                "Owner agent could not reach the AI provider. "
                "Check OPENAI_API_KEY and try again."
            ),
            blocked=False,
            capability=capability,
            model=model,
            provider=provider,
            metadata={"error": str(exc)[:200]},
        )

    return OwnerAgentResponse(
        reply=reply or "",
        blocked=False,
        safe_cyber=(verdict.decision == "safe-cyber"),
        model=model,
        provider=provider,
        capability=capability,
        metadata={
            "safety": {"decision": verdict.decision},
        },
    )


__all__ = [
    "OwnerAgentRequest", "OwnerAgentResponse",
    "valid_capabilities", "run",
]
