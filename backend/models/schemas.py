# coding: utf-8
from pydantic import BaseModel, Field
from typing import Optional, List


# --- Chat ---

class ChatRequest(BaseModel):
    user_id: str = Field(..., description="Unique user identifier")
    message: str = Field(..., min_length=1, max_length=4000)
    chat_id: Optional[str] = Field(default=None)
    platform: Optional[str] = Field(default="web")
    session_id: Optional[str] = Field(default=None)


class ChatResponse(BaseModel):
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


# --- Memory ---

class MemorySaveRequest(BaseModel):
    user_id: str
    content: str = Field(..., min_length=3, max_length=500)
    category: Optional[str] = Field(default="general")


class MemoryItem(BaseModel):
    category: str
    content: str
    created_at: str


class MemoryListResponse(BaseModel):
    user_id: str
    items: List[MemoryItem]
    style: dict
    total: int


class MemoryDeleteRequest(BaseModel):
    user_id: str
    keyword: str


# --- Profile ---

class ProfileResponse(BaseModel):
    user_id: str
    premium: bool
    messages_used_today: int
    remaining_messages: int
    memory_count: int
    style: dict
    platform: Optional[str] = "web"


# --- Stats ---

class StatsResponse(BaseModel):
    total_users: int
    total_messages: int
    messages_today: int
    premium_users: int
    active_today: int
    generated_at: str


# --- Health ---

class HealthResponse(BaseModel):
    status: str
    version: str
    environment: str


# --- Error ---

class ErrorResponse(BaseModel):
    error: str
    message: str
    request_id: Optional[str] = None
