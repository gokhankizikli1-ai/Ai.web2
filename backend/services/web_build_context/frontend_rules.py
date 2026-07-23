# coding: utf-8
"""
Web Build context — DESIGN GENERATION RULES for the frontend_builder model.

This is the integration seam that finally connects the existing Design Intelligence to the
REAL production path. The frontend WebsiteBuilder generates the actual React source through
the isolated ``frontend_builder`` model, which — until now — received ONLY its own system
prompt plus the ``FrontendBuildSpecification`` JSON. None of the intelligence layers
(design personality, visual, motion, quality guard) reached it (see the Web Build path
audit's ``generation-context-disconnected`` / ``production-path-divergence`` gaps).

This module derives a compact ``DESIGN GENERATION RULES`` block from the SAME intelligence
the orchestrator path uses — via :func:`generation_adaptation.compose_generation_rules` —
and lets the isolated frontend_builder prompt-assembly seam append it. It creates NO new
intelligence and duplicates NO analysis: it only extracts the signal already present in the
spec (the user prompt + business identity) and reuses the existing composer.

Feature flag (default OFF → the frontend_builder prompt is byte-for-byte unchanged):

    ENABLE_FRONTEND_DESIGN_RULES=false

It is fully fail-open: any parsing/derivation/composition failure yields ``""`` so a broken
layer can never break a real website generation.

Public API:
    is_enabled()                         — is the frontend seam turned on?
    build_frontend_builder_rules(message)— the rules block for a frontend_builder message, or ""
"""
from __future__ import annotations

import json
import logging
import os
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

_MAX_REQUEST = 2000
# The transport markers the frontend wraps the spec JSON in (see webBuildApi.ts).
_BEGIN = "BEGIN_FRONTEND_BUILD_SPEC_JSON"
_END = "END_FRONTEND_BUILD_SPEC_JSON"
# The initial-build marker; review/repair/revision messages carry a distinct sub-marker
# and MUST NOT receive generation rules (they do not (re)plan the design).
_BUILD_MARKER = "[FRONTEND BUILDER REQUEST]"
_SUBTASK_MARKERS = (
    "[FRONTEND REVIEW REQUEST]",
    "[FRONTEND CONTRACT REPAIR REQUEST]",
    "[FRONTEND REPAIR REQUEST]",
    "[FRONTEND REVISION REQUEST]",
)
# identity fields → intelligence signal keys. Only business/industry signals — never copy,
# section text, colours or any generated content.
_IDENTITY_SIGNALS = (
    ("sector", "industry"),
    ("subsector", "subsector"),
    ("audienceSector", "audience"),
    ("siteType", "siteType"),
    ("primaryConcept", "brand_style"),
)


def is_enabled() -> bool:
    """True only when ``ENABLE_FRONTEND_DESIGN_RULES`` is explicitly ``"true"``."""
    return (os.getenv("ENABLE_FRONTEND_DESIGN_RULES", "false") or "").strip().lower() == "true"


def _is_initial_build(message: str) -> bool:
    """True only for the initial full-source generation (TASK A). Review / contract-repair /
    quality-repair / revision each carry their own sub-marker and are excluded."""
    if _BUILD_MARKER not in message:
        return False
    return not any(marker in message for marker in _SUBTASK_MARKERS)


def _extract_spec(message: str) -> Optional[Dict[str, Any]]:
    """Parse the FrontendBuildSpecification projection JSON out of the transport envelope.
    Returns the dict, or ``None`` when the markers/JSON are absent or malformed."""
    start = message.find(_BEGIN)
    if start < 0:
        return None
    start += len(_BEGIN)
    end = message.find(_END, start)
    if end < 0:
        return None
    blob = message[start:end].strip()
    if not blob:
        return None
    try:
        data = json.loads(blob)
    except (ValueError, TypeError):
        return None
    return data if isinstance(data, dict) else None


def _signal_from_spec(spec: Dict[str, Any]) -> Optional[Dict[str, str]]:
    """Derive the intelligence signal (user request + business identity) from the spec.
    Returns ``None`` when there is no usable signal (so no generic block is produced)."""
    request = spec.get("prompt")
    request = request.strip()[:_MAX_REQUEST] if isinstance(request, str) else ""

    context: Dict[str, str] = {}
    identity = spec.get("identity")
    if isinstance(identity, dict):
        for src_key, signal_key in _IDENTITY_SIGNALS:
            value = identity.get(src_key)
            if isinstance(value, str) and value.strip():
                context.setdefault(signal_key, value.strip()[:200])

    if not request and not context:
        return None
    return {"prompt": request, **context}


def build_frontend_builder_rules(message: str) -> str:
    """Return the compact ``DESIGN GENERATION RULES`` block for a frontend_builder request,
    or ``""``. Returns ``""`` — leaving the prompt byte-for-byte unchanged — when the flag is
    off, the message is not an initial build, the spec/signal is missing, or anything fails.
    Never raises."""
    try:
        if not is_enabled():
            return ""
        if not message or not _is_initial_build(message):
            return ""
        spec = _extract_spec(message)
        if spec is None:
            return ""
        signal = _signal_from_spec(spec)
        if signal is None:
            return ""
        # Reuse the EXISTING composer (flag-independent variant) — no new intelligence, no
        # duplicated analysis. Governed by THIS module's own flag, checked above.
        from backend.services import generation_adaptation
        rules = generation_adaptation.compose_generation_rules(signal.get("prompt", ""), signal)
        return rules if isinstance(rules, str) else ""
    except Exception as exc:  # noqa: BLE001 — must never break a real website generation
        logger.debug("[WB_CTX] frontend design rules soft-failed: %s", type(exc).__name__)
        return ""


__all__ = ["is_enabled", "build_frontend_builder_rules"]
