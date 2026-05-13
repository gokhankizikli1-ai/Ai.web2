# coding: utf-8
"""
Memory Intelligence v1 — lightweight, in-process user-scoped memory.

Three pure-logic modules, zero coupling to the chat orchestrator / agent
runtime / route handlers:

  store.py       in-memory user→records dict, thread-safe, capped/LRU.
  extractor.py   heuristic extraction from user messages (KorvixAI
                 mentions, "kendi AI / building X" patterns, language
                 preference). Auto-redacts secrets / emails.
  client.py      public API every caller speaks: is_enabled(),
                 record(), extract_and_record(), fetch_snippets(),
                 clear().

Feature flag
  ENABLE_MEMORY_INTELLIGENCE=true  → all client functions actually act.
  default (off)                    → every public call is a no-op.

Wire-in pattern (when the orchestrator is ready to consume this)
    from backend.services.memory_intelligence import client as mem
    from backend.services.personality import build_short_context_block

    if mem.is_enabled():
        mem.extract_and_record(user_id, user_message)
        snippets = mem.fetch_snippets(user_id)
    else:
        snippets = []

    block = build_short_context_block(
        recent_user_messages=[user_message],
        memory_snippets=snippets,
        already_greeted=<derive>,
    )
    if block:
        system_prompt = block + system_prompt

That's the entire wire-in. The next slice can add those 6 lines to
ai_service.process_chat (or any future v2 chat path). Until then
production is unaffected.

Safety
- ENABLE_MEMORY_INTELLIGENCE defaults to false → no records ever
  written, no fetches return anything but [].
- Extractor strips obvious secrets (passwords / API keys / emails)
  BEFORE storing. The model never sees them.
- Snippets are short (≤120 chars in context_builder) and Turkish-
  phrased; the assistant is told via prompt to mention them naturally,
  never as "records / kayıtlarıma göre".
- Per-user cap prevents unbounded growth.
"""
from backend.services.memory_intelligence.client import (
    is_enabled,
    record,
    extract_and_record,
    fetch_snippets,
    clear,
)
from backend.services.memory_intelligence.store import MemoryRecord

__all__ = [
    "is_enabled",
    "record",
    "extract_and_record",
    "fetch_snippets",
    "clear",
    "MemoryRecord",
]
