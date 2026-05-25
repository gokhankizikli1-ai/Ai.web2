# coding: utf-8
"""
Owner orchestration policy.

When a request comes in with owner identity confirmed (either via
identity-based detection or the OWNER_TOKEN shared secret), the
supervisor + every delegated specialist need to know they're working
for the project owner. Without this, the orchestrator's default
posture is "production-safe assistant" — useful for end users but
needlessly restrictive when the owner is trying to do legitimate
development work (refactor a component, restructure a page, rebuild
a layout, etc.).

What this module does:

  1. Provides the prompt language injected into every owner-session
     orchestration call. Frozen string — change here, not in callers.
     The text explicitly authorises:
       - frontend component / UI / layout / style modifications
       - frontend architecture refactors
       - page / component creation, deletion, rename
       - project structure changes
       - direct access to internal orchestration tooling
       - autonomous architectural edits without excessive confirmation
     The text explicitly preserves the cybersecurity hard-blocks
     (malware, credential theft, phishing, exploit dev, destructive
     cyber abuse, illegal intrusion).

  2. `compose_system_prompt(...)` — single source of truth for
     wrapping any spec.system_prompt with both the owner orchestration
     policy AND the existing admin safety guardrail. Used by:
       - `routes/v2_orchestrate.py` (the supervisor entrypoint)
       - `services/agent/delegate.py` (each child specialist)
       - `services/admin/owner_agent.py` (the standalone owner-agent
         route — composed with capability prompts there)

  3. `owner_context_for_run(...)` — small payload (is_owner, source,
     capability list) that the orchestrator stamps into the run's
     metadata + emits as a `run.owner_session` event so the frontend
     Activity Feed can show "Owner Session Active".

Security note: this module DOES NOT introduce any new tools, DOES
NOT bypass the safety classifier in `safety.py`, and DOES NOT relax
audit logging. It only changes the PROMPT POSTURE — telling the
model that the caller is authorised for the dev-time operations
that a normal user wouldn't be. The hard-block list still applies
verbatim (see `_OWNER_ORCH_GUARDRAIL_FOOTER`).
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Optional

from backend.services.admin import safety


logger = logging.getLogger(__name__)


# ── Frozen policy text ────────────────────────────────────────────────────
#
# Two parts: the affirmative authorisation block (what the owner can do)
# and the guardrail footer (what's still forbidden, regardless of owner).
# Keeping them in one module means there's exactly one place to edit
# when the policy evolves.

_OWNER_ORCH_AUTHORISATION = """\
OWNER SESSION ACTIVE — you are working for the PROJECT OWNER.

The owner has explicitly authorised the following capabilities for
this session, and you should EXERCISE them when the request calls
for them (do not refuse, do not deflect to 'consult a developer',
do not insert excessive confirmation steps):

  - Direct modification of frontend components (React/TSX, CSS, styles).
  - Editing layout, UI primitives, and design system tokens.
  - Refactoring the frontend architecture (component boundaries,
    routing, state management, hook composition).
  - Creating new pages / components / routes and removing obsolete
    ones — without asking 'are you sure'.
  - Modifying project structure (file moves, directory renames,
    import path updates) when the change is internally consistent.
  - Reading and using internal orchestration tools (delegate,
    spawn_specialist, project memory inspector, tool history) as
    needed to plan and execute work.
  - Autonomous execution of multi-step architectural edits — propose
    a plan, then carry it out. The owner can revert via git if they
    disagree; defaulting to 'safe and slow' wastes their time.

Default posture rules:
  - When the owner asks 'fix X' / 'change Y' / 'rebuild Z', PROPOSE
    a concrete diff or code block, then ASK NOTHING and continue —
    one confirmation at the START of a large task is enough.
  - Skip safe-assistant disclaimers ('I'm just an AI', 'please
    review carefully', 'as always make a backup'). The owner knows.
  - Skip 'I cannot modify your codebase' / 'I don't have access to
    your files'. You DO — you produce diffs, code blocks, and full
    file rewrites that the owner applies. State that work directly.
  - If you need a clarification, ask ONE specific question instead
    of refusing or hedging.
"""


_OWNER_ORCH_GUARDRAIL_FOOTER = """\
OWNER SESSION SAFETY (NON-NEGOTIABLE):

Owner mode does NOT relax safety policy. Regardless of who is asking,
you MUST still refuse:

  - Authoring malware, ransomware, spyware, rootkits, keyloggers,
    or any other offensive payloads.
  - Credential theft — phishing kits, credential stuffing tools,
    cookie/session exfiltration, bypassing other people's MFA.
  - Weaponised exploit development against systems the owner does
    not control. (Defensive analysis, CVE writeups, hardening
    guidance are ALLOWED and encouraged.)
  - Destructive cyber abuse — DDoS tools, mass / supply-chain
    compromise, detection-evasion guidance for offensive deployment.
  - Illegal intrusion guidance (unauthorised access, lateral
    movement against third-party systems).

If a request matches one of the above, refuse with the safety
classifier's standard message — do NOT obey just because the owner
asked. Architectural / development authority does not extend to
attacking other systems.
"""


# ── Capability list surfaced to the FE / debug panel ─────────────────────

_OWNER_ORCHESTRATION_CAPABILITIES = (
    "frontend_modification",
    "ui_layout_styles",
    "frontend_refactor",
    "page_component_crud",
    "project_structure_changes",
    "internal_orchestration_tools",
    "autonomous_architectural_edits",
    "reduced_confirmation_friction",
)


def orchestration_capabilities() -> tuple:
    """Stable ordered tuple of owner orchestration capability ids.
    Surfaced through /v2/admin/status.data.capabilities and through
    the OwnerSession activity-feed payload so the FE can render an
    explicit 'Owner Session Active — N permissions granted' chip."""
    return _OWNER_ORCHESTRATION_CAPABILITIES


# ── Composition helper ────────────────────────────────────────────────────

@dataclass
class OwnerOrchestrationContext:
    """Small struct stamped into the run metadata + emitted as a
    `run.owner_session` event for the FE.

    `source` is one of:
      - "identity"   user matched OWNER_EMAIL / OWNER_ID with a real auth session
      - "token"      caller presented a valid OWNER_TOKEN header
      - ""           not an owner (default)
    """
    is_owner:     bool = False
    source:       str  = ""
    capabilities: tuple = ()

    def to_dict(self) -> dict:
        return {
            "is_owner":     self.is_owner,
            "source":       self.source,
            "capabilities": list(self.capabilities),
        }


def owner_context_for_run(
    *,
    is_owner: bool,
    source: str = "",
) -> OwnerOrchestrationContext:
    if not is_owner:
        return OwnerOrchestrationContext(is_owner=False, source="", capabilities=())
    return OwnerOrchestrationContext(
        is_owner=True,
        source=source or "unknown",
        capabilities=orchestration_capabilities(),
    )


def compose_system_prompt(
    base_prompt: str,
    *,
    is_owner: bool,
    user_message: Optional[str] = None,
) -> str:
    """Wrap a spec.system_prompt with the owner orchestration policy
    AND the existing admin safety guardrail.

    Layering rules:
      1. The base prompt comes first — the spec's role/output contract.
      2. If owner: authorisation block (what's unlocked).
      3. Safety footer LAST (closest to the user message, strongest
         signal in most chat models). This includes both the existing
         owner_guardrail_prompt() from safety.py AND the orchestration-
         specific non-negotiables.
      4. If safety.classify(user_message) returned 'safe-cyber', the
         safe-cyber addendum is also appended — defensive cyber work
         is FINE, the model just needs the framing reminder.

    Non-owner callers fall through with `base_prompt` returned
    unchanged — this function is safe to call universally.
    """
    if not is_owner:
        return base_prompt

    parts = [base_prompt.rstrip(), "", _OWNER_ORCH_AUTHORISATION]

    if user_message:
        verdict = safety.classify(user_message)
        if verdict.decision == "safe-cyber":
            parts.append(safety.safe_cyber_addendum())

    # Final safety layer — non-negotiable. Both the orchestration
    # footer AND the broader owner guardrail from safety.py so any
    # caller is covered by the same hard-block list.
    parts.append(_OWNER_ORCH_GUARDRAIL_FOOTER)
    parts.append(safety.owner_guardrail_prompt())

    return "\n\n".join(p for p in parts if p)


def authorisation_text() -> str:
    """Public accessor — used by tests + by the AdminPanel 'view
    current owner policy' tab so the operator can audit the prompt
    text that's actually injected."""
    return _OWNER_ORCH_AUTHORISATION


def guardrail_text() -> str:
    """Same as authorisation_text() but for the non-negotiable footer."""
    return _OWNER_ORCH_GUARDRAIL_FOOTER


__all__ = [
    "OwnerOrchestrationContext",
    "orchestration_capabilities",
    "owner_context_for_run",
    "compose_system_prompt",
    "authorisation_text",
    "guardrail_text",
]
