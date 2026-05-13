# coding: utf-8
"""
Phase 8 — personality / conversational-memory helpers.

Two pure-logic helpers (no I/O, no LLM calls):

  - vibe_detector.detect_vibe(recent_user_messages)
      → light heuristics on tone / length / emoji-use / language.

  - context_builder.build_short_context_block(...)
      → assembles a compact `[KISA BAGLAM]` block that the chat
        orchestrator can prepend to the system prompt. Empty when
        there's nothing useful to add, so the prompt stays clean.

The chat orchestrator (legacy `ai_service.process_chat` or any future
agent-side caller) is the place that decides when to invoke these — by
design this package has zero coupling to memory storage, the agent
runtime, or any route. That keeps it cheap to test and rollback-safe.
"""
from backend.services.personality.vibe_detector import detect_vibe
from backend.services.personality.context_builder import build_short_context_block

__all__ = ["detect_vibe", "build_short_context_block"]
