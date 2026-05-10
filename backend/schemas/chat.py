# coding: utf-8
"""
Pydantic schemas for the /chat endpoint — KorvixAI v3.

ChatRequest is unchanged so the frontend payload structure is preserved.

ChatResponse extends the legacy model with v3 fields (success, message,
conversation_id, usage, metadata) while keeping every old field so the
current frontend never breaks.
"""
from __future__ import annotations
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    user_id: str
    message: str
    chat_id: Optional[str] = None
    platform: Optional[str] = "web"
    session_id: Optional[str] = None


class UsageInfo(BaseModel):
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0


class ChatResponse(BaseModel):
    # ── Legacy fields — do NOT remove; frontend reads these ───────────────
    reply: str
    intent: str
    model: str
    provider: str
    mode: str
    memory_used: bool
    remaining_messages: int
    premium: bool
    response_time_ms: int
    request_id: str
    suggested_followups: Optional[List[str]] = None

    # ── v3 fields ─────────────────────────────────────────────────────────
    success: bool = True
    message: str = ""              # mirrors `reply` for v3 consumers
    conversation_id: str = ""      # mirrors `request_id`
    usage: UsageInfo = Field(default_factory=UsageInfo)
    metadata: Dict[str, Any] = Field(default_factory=dict)

    def model_post_init(self, __context: Any) -> None:
        """Keep v3 aliases in sync so callers don't have to set them manually."""
        if not self.message:
            self.message = self.reply
        if not self.conversation_id:
            self.conversation_id = self.request_id
