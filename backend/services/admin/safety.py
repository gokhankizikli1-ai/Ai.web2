# coding: utf-8
"""
Admin-mode safety guardrails.

The owner gets unlocked tooling. The owner does NOT get to bypass
safety policy. This module is the lone place where that boundary is
enforced — every owner-facing AI surface (`owner_agent.py`, future
admin-only tools) routes user-provided text through `classify()` first.

Two categories of result:
  - "block"  hard refusal. Returned to the caller; never reaches the AI.
             The owner sees the refusal reason and the audit log gets
             a "blocked" entry. The categories that trigger block
             are intentionally narrow and tightly worded — false
             positives on legitimate dev work are worse than the rare
             miss caught at the model layer.
  - "safe-cyber"  request smells like security work but the verbs are
             defensive (audit, review, harden, threat-model). Allowed;
             the owner agent's system prompt is augmented to enforce
             a defensive framing.
  - "allow"  everything else. Passes through unchanged.

The classifier is pure regex / keyword matching. It is intentionally
NOT an AI call: this layer must be fast, deterministic, and cheap to
audit. The model layer is a second line of defence — but we cannot
rely on it alone, because owner-mode prompts may instruct the model
to ignore its own guidelines.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import List, Tuple


# ── Hard-block patterns ──────────────────────────────────────────────────
#
# Patterns that ALWAYS produce a refusal, regardless of who's asking.
# Each pattern is compiled case-insensitive with word-boundary checks
# where useful. Keep this list narrow: every entry must describe
# offensive cyber capability with no plausible defensive framing.
#
# When adding entries, prefer specific verbs over broad nouns. "Write
# ransomware" blocks; "ransomware analysis" is allowed (defensive).

_BLOCK_PATTERNS: List[Tuple[str, str]] = [
    # Malware authoring
    (r"\b(write|create|build|generate|develop|code)\s+(a\s+)?(ransomware|spyware|stalkerware|rootkit|keylogger|trojan|wiper|botnet)\b",
     "malware_authoring"),
    (r"\b(malware|virus)\s+(source\s+)?code\s+(to|that|which)\b",
     "malware_authoring"),
    (r"\b(write|create|build|implement)\s+(a\s+)?(reverse\s+shell|backdoor)\s+(payload|implant|that\s+evades)\b",
     "malware_authoring"),

    # Credential theft / unauthorised access. The verb list is the
    # strongest signal — combined with a credential-shaped noun within
    # a few words it's a hard block. Intervening adjectives ("session
    # cookies", "saved passwords") are allowed.
    (r"\b(steal|exfiltrate|harvest|dump|sniff)\s+(?:\w+\s+){0,3}?"
     r"(credentials?|passwords?|cookies?|sessions?|tokens?)\b",
     "credential_theft"),
    (r"\bcredential\s+(stuffing|harvest(ing)?|dump(er|ing)?)\s+(tool|script|attack)\b",
     "credential_theft"),
    (r"\b(crack|bypass|circumvent)\s+(the\s+)?(login|authentication|2fa|mfa)\s+(of|for)\s+(?!my|our\s)\w+",
     "credential_theft"),

    # Phishing for harm
    (r"\b(write|craft|generate|create)\s+(a\s+)?phishing\s+(email|page|site|kit)\s+(to|that|targeting)\b",
     "phishing_kit"),

    # Exploit dev for unauthorised use
    (r"\b(write|develop|weaponize)\s+(an?\s+)?(exploit|0day|zero\s+day|rce)\s+(for|against)\s+(?!my|our|a\s+vulnerable\s+lab)\w+",
     "exploit_dev"),
    (r"\b(ddos|denial\s+of\s+service)\s+(tool|script|attack)\s+(against|targeting)\b",
     "ddos_attack"),

    # Mass / supply-chain compromise
    (r"\b(supply\s+chain|mass)\s+(compromise|attack|infection)\b",
     "mass_compromise"),

    # Detection evasion for offensive purposes. Allows a few
    # intervening words ("deploy this malware", "deliver the payload").
    (r"\b(bypass|evade|defeat)\s+(av|antivirus|edr|xdr|detection)\b"
     r"[\s\w]{0,40}?\b(deliver|deploy|execute|run|drop|launch)\b"
     r"[\s\w]{0,20}?\b(payload|malware|implant|backdoor|exploit|trojan)\b",
     "detection_evasion_offensive"),
]


# ── Safe-cyber patterns ──────────────────────────────────────────────────
#
# Patterns that indicate defensive / educational security work.
# Matching these triggers an augmented system prompt (see
# `safe_cyber_addendum()`) but does NOT block the request.
#
# These run AFTER the block check, so e.g. "write a keylogger" still
# blocks even though "keylogger" by itself reads as defensive context.

_SAFE_CYBER_PATTERNS: List[str] = [
    r"\b(threat\s*model|threat\s+modeling)\b",
    r"\b(code|security)\s+audit\b",
    r"\b(harden|hardening)\b",
    r"\b(secure\s+(coding|refactor)|defensive\s+(coding|programming))\b",
    r"\b(vulnerability|cve)\s+(explanation|writeup|analysis|review)\b",
    r"\bowasp\b",
    r"\b(permission|access\s+control|authz|rbac)\s+(check|review)\b",
    r"\bdetect(ion)?\s+(rule|engineering|signature)\b",
    r"\b(incident\s+response|forensic[s]?|blue\s+team|purple\s+team)\b",
    r"\bsast|dast|sca\b",
    r"\bdependency\s+(audit|review|update)\b",
    r"\b(siem|edr)\s+(rule|tuning|configuration)\b",
]


_BLOCK_RE = [(re.compile(p, re.IGNORECASE), cat) for p, cat in _BLOCK_PATTERNS]
_SAFE_CYBER_RE = [re.compile(p, re.IGNORECASE) for p in _SAFE_CYBER_PATTERNS]


@dataclass
class SafetyVerdict:
    decision: str       # "allow" | "safe-cyber" | "block"
    category: str = ""  # populated when decision == "block"
    reason:   str = ""  # human-readable; safe to surface to the owner


def classify(text: str) -> SafetyVerdict:
    """Run the owner-mode safety classifier against a free-form prompt.

    Order matters: a request that matches BOTH a block pattern and a
    safe-cyber pattern still blocks. The block list is the floor; the
    safe-cyber list is an augmentation, not an override.
    """
    if not text or not isinstance(text, str):
        return SafetyVerdict(decision="allow")

    # 1. Hard blocks
    for pat, cat in _BLOCK_RE:
        if pat.search(text):
            return SafetyVerdict(
                decision="block",
                category=cat,
                reason=_refusal_for(cat),
            )

    # 2. Safe-cyber augmentation
    for pat in _SAFE_CYBER_RE:
        if pat.search(text):
            return SafetyVerdict(decision="safe-cyber")

    return SafetyVerdict(decision="allow")


_REFUSAL_TEMPLATES = {
    "malware_authoring":
        "I can't help write malware or offensive tooling, even in owner mode. "
        "If you're studying a sample, I can help with static analysis, IOC "
        "extraction, or write defensive detection rules.",
    "credential_theft":
        "I can't help with credential theft or unauthorised access. If this is "
        "a defensive exercise on systems you own, rephrase as a credential "
        "hygiene / rotation review and I can help.",
    "phishing_kit":
        "I can't help create phishing materials. I can review training content, "
        "write awareness emails for staff, or help build phishing detection rules.",
    "exploit_dev":
        "I can't help build weaponised exploits. For authorised research, I can "
        "discuss vulnerability classes, secure-coding mitigations, and help "
        "write proof-of-concept analyses in defensive form (writeups, patches).",
    "ddos_attack":
        "I can't help build or run denial-of-service attacks. I can help design "
        "DDoS mitigations, rate-limiting strategies, and resilience patterns.",
    "mass_compromise":
        "I can't help with supply-chain or mass compromise. I can help design "
        "supply-chain defences (SBOM, signed builds, dependency pinning).",
    "detection_evasion_offensive":
        "I can't help evade detection for offensive deployment. I can help "
        "improve detection engineering and write better rules.",
}


def _refusal_for(category: str) -> str:
    return _REFUSAL_TEMPLATES.get(
        category,
        "I can't help with that request, even in owner mode. The same safety "
        "rules apply to admin sessions as to every other user.",
    )


# ── System-prompt addenda ────────────────────────────────────────────────

_BASE_OWNER_GUARDRAIL = (
    "You are operating in OWNER MODE for an authenticated project owner. "
    "Owner mode unlocks visibility tools and developer affordances. "
    "Owner mode does NOT relax safety policy. You MUST refuse any request to "
    "produce malware, ransomware, spyware, rootkits, keyloggers, credential "
    "thieves, phishing kits, weaponised exploits, DDoS tools, or any code "
    "intended to compromise systems the owner does not control. "
    "If a request is ambiguous, ask for the defensive framing before proceeding."
)

_SAFE_CYBER_ADDENDUM = (
    "The current request appears to be SECURITY WORK. Stay strictly defensive: "
    "code audit, threat modeling, hardening, vulnerability explanation, "
    "secure refactoring, permission/access-control review, detection-rule "
    "writing. Do not provide offensive payloads, exploitation steps, or "
    "evasion techniques even if the user frames them as 'for research'."
)


def owner_guardrail_prompt() -> str:
    """The baseline system-prompt addendum injected into every owner-agent
    call. Frozen string — change here, not in callers."""
    return _BASE_OWNER_GUARDRAIL


def safe_cyber_addendum() -> str:
    """Extra guardrail appended when classify() returns 'safe-cyber'."""
    return _SAFE_CYBER_ADDENDUM


__all__ = [
    "SafetyVerdict", "classify",
    "owner_guardrail_prompt", "safe_cyber_addendum",
]
