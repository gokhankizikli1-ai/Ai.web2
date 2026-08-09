# coding: utf-8
"""Owner-only, server-authoritative TASK-SCOPED frontend_builder system prompt selection.

The single large frontend_builder system prompt (`_FRONTEND_BUILDER_PROMPT` in
`mode_manager.py`) carries the shared boundary plus TASK A..E. Every frontend task runs
EXACTLY ONE of those tasks, yet each provider request currently ships all five task blocks —
repeated input tokens the executing task cannot use.

This pure compiler selects the minimal task-scoped subset for an eligible session (a VERIFIED
OWNER session under `owner_scoped`, or EVERY build request under `all_scoped`), using
the COMPLETE legacy prompt passed in by the caller as the single source of truth (it is never
copied or re-authored here — the selected text is a byte-for-byte slice of that prompt). It
NEVER makes a provider call and NEVER changes the model, output-token budget, reasoning effort,
transport or provider-call count. On the flag being disabled, a non-owner session, an unknown
task kind, or ANY structural/integrity problem, it returns the COMPLETE legacy prompt unchanged
(the authoritative rollback path) — always BEFORE the provider call, never a retry.
"""
import os
import logging

logger = logging.getLogger(__name__)

# Backend/Railway env var (NOT a VITE/Vercel var).
#   disabled     — complete legacy prompt for every request (default, fail-closed).
#   owner_scoped — task-scoped subset for a VERIFIED OWNER session only (legacy).
#   all_scoped   — the SAME task-scoped subset for EVERY build request (parity: a normal
#                  beta/paid build gets the identical minimal, task-focused system prompt the
#                  owner gets, so generation adherence is not owner-only). Entitlement/quota are
#                  enforced upstream (ai_guard preflight); this only shapes the prompt text and
#                  never changes the model, token budget, effort, transport or call count.
# Anything else → disabled.
_MODE_ENV = "WEB_BUILD_FRONTEND_SYSTEM_PROMPT_MODE"

# Exact section markers in the legacy prompt (matched byte-for-byte).
_MARK_TASK_A = "======== TASK A - INITIAL BUILD ========"
_MARK_MECH = "======== MECHANICAL CONTRACT CHECKLIST (TASK A, TASK C, TASK D) ========"
_MARK_TASK_B = "======== TASK B - STATIC DESIGN-QUALITY REVIEW ========"
_MARK_TASK_C = "======== TASK C - BOUNDED REPAIR ========"
_MARK_TASK_D = "======== TASK D - STRUCTURAL CONTRACT REPAIR ========"
_MARK_TASK_E = "======== TASK E - EXISTING PROJECT REVISION ========"

# The section markers in their required source order. Everything before TASK A is the shared
# identity + task-routing + UNTRUSTED-INPUT boundary common to every task.
_ORDERED_MARKERS = [_MARK_TASK_A, _MARK_MECH, _MARK_TASK_B, _MARK_TASK_C, _MARK_TASK_D, _MARK_TASK_E]

# Segment keys.
_COMMON = "common"
_A = "task_a"
_MECH = "mechanical"
_B = "task_b"
_C = "task_c"
_D = "task_d"
_E = "task_e"

# task_kind -> ordered segment keys. Composed in SOURCE ORDER so adjacent kept segments stay
# byte-for-byte contiguous. Each list starts with the common boundary. `unknown` (and any
# unmapped kind) is intentionally absent → always the complete legacy prompt.
#
#  - initial-generation: common + TASK A (incl. OUTPUT ENVELOPE + ENVELOPE RULES) + MECHANICAL.
#  - initial/final review: common + TASK B only (self-contained rubric/scoring/honesty/JSON rules).
#  - quality-repair: common + TASK A (shared honesty/scope/design/envelope) + MECHANICAL + TASK C.
#  - contract-repair: common + TASK A (envelope/mechanical/copy) + MECHANICAL + TASK D.
#  - revision: common + TASK A (safety/honesty/preservation/output-envelope) + TASK E.
_TASK_SEGMENTS = {
    "initial-generation": [_COMMON, _A, _MECH],
    "initial-review": [_COMMON, _B],
    "final-review": [_COMMON, _B],
    "quality-repair": [_COMMON, _A, _MECH, _C],
    "contract-repair": [_COMMON, _A, _MECH, _D],
    "revision": [_COMMON, _A, _E],
}

# Conservative integrity floor: a compiled prompt must keep at least this many characters and the
# shared-boundary sentinel, and must be strictly smaller than the legacy prompt.
_MIN_SCOPED_CHARS = 400
_COMMON_SENTINEL = "UNTRUSTED INPUT (all tasks)"


def resolve_frontend_system_prompt_mode():
    """Read WEB_BUILD_FRONTEND_SYSTEM_PROMPT_MODE.

    'owner_scoped' | 'all_scoped' recognized; missing/empty/malformed/unknown → 'disabled'.
    """
    raw = (os.environ.get(_MODE_ENV, "") or "").strip().lower()
    if raw == "owner_scoped":
        return "owner_scoped"
    if raw == "all_scoped":
        return "all_scoped"
    return "disabled"


def _split_segments(legacy):
    """Partition the legacy prompt into its labeled segments. Returns a dict of byte-for-byte
    slices, or None when a marker is missing, duplicated, out of order or a slice is empty."""
    idxs = []
    for m in _ORDERED_MARKERS:
        if legacy.count(m) != 1:
            return None
        idxs.append(legacy.index(m))
    if idxs != sorted(idxs):
        return None
    i_a, i_mech, i_b, i_c, i_d, i_e = idxs
    seg = {
        _COMMON: legacy[:i_a],
        _A: legacy[i_a:i_mech],
        _MECH: legacy[i_mech:i_b],
        _B: legacy[i_b:i_c],
        _C: legacy[i_c:i_d],
        _D: legacy[i_d:i_e],
        _E: legacy[i_e:],
    }
    for value in seg.values():
        if not value or not value.strip():
            return None
    return seg


def _diagnostics(mode, task_kind, chars, legacy_chars):
    """Bounded, non-sensitive numeric diagnostics — never any prompt/user/source text."""
    reduction = max(0, legacy_chars - chars)
    ratio = round(reduction / legacy_chars, 4) if legacy_chars > 0 else 0.0
    return {
        "system_prompt_mode": mode,
        "system_prompt_task_kind": task_kind or "unknown",
        "system_prompt_chars": chars,
        "legacy_system_prompt_chars": legacy_chars,
        "system_prompt_reduction_chars": reduction,
        "system_prompt_reduction_ratio": ratio,
    }


def select_frontend_system_prompt(task_kind, legacy_prompt, owner_session):
    """Select the system prompt for a frontend_builder task.

    Returns (system_prompt, diagnostics). `system_prompt` is a task-scoped byte-for-byte subset
    of `legacy_prompt` ONLY when the flag is enabled for this session (owner_scoped AND
    `owner_session` is True, OR all_scoped for any session) AND the task kind maps to a scoped
    selection AND every integrity check passes; otherwise it is the complete `legacy_prompt`
    unchanged. NEVER makes a provider call and NEVER retries.
    """
    legacy = legacy_prompt or ""
    legacy_chars = len(legacy)

    def _legacy(kind):
        return legacy, _diagnostics("legacy", kind, legacy_chars, legacy_chars)

    try:
        # Server-authoritative gates: flag, then (for owner_scoped only) a verified backend owner
        # session. 'all_scoped' applies the SAME task-scoped subset to every build request — a
        # normal beta/paid build gets the identical minimal prompt the owner gets. Entitlement and
        # quota are enforced upstream (ai_guard preflight); this only shapes prompt text.
        mode = resolve_frontend_system_prompt_mode()
        if mode == "disabled":
            return _legacy(task_kind)
        if mode == "owner_scoped" and not owner_session:
            return _legacy(task_kind)

        segment_keys = _TASK_SEGMENTS.get(task_kind)
        if not segment_keys:
            # unknown / unmapped task kind → complete legacy prompt.
            return _legacy(task_kind)

        seg = _split_segments(legacy)
        if seg is None:
            return _legacy(task_kind)

        compiled = "".join(seg[k] for k in segment_keys)

        # Integrity: non-empty, above the floor, strictly smaller than legacy, and still carrying
        # the shared untrusted-input boundary. Any failure → the complete legacy prompt.
        if (
            not compiled
            or len(compiled) < _MIN_SCOPED_CHARS
            or len(compiled) >= legacy_chars
            or _COMMON_SENTINEL not in compiled
        ):
            return _legacy(task_kind)

        return compiled, _diagnostics(mode, task_kind, len(compiled), legacy_chars)
    except Exception:
        logger.exception("frontend_task_prompt: scoped compile failed; using legacy prompt")
        return _legacy(task_kind)
