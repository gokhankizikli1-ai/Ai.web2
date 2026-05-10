# PROJECT_CONTEXT.md

# KorvixAI — Project Context

## Overview

KorvixAI is a modern AI chat platform inspired by ChatGPT/Perplexity/Claude style interfaces.

Frontend:
- React + Vite
- TailwindCSS
- Framer Motion
- Hosted on Vercel
- Domain: https://korvixai.com

Backend:
- FastAPI
- Hosted on Railway
- OpenAI API integration
- Current production endpoint:
  POST /chat/chat

Goal:
Build a premium AI platform with modern UI, smooth UX, stable backend architecture, streaming responses, AI modes, memory system, and advanced productivity features.

---

# Current Frontend State

Frontend is visually ahead of backend.

Main frontend systems already implemented or partially implemented:

## UI / UX
- Modern dark theme
- Premium glassmorphism styling
- Animated sidebar
- Smooth chat layout
- Modern input area
- Responsive mobile layout
- Premium chat bubbles
- Conversation history sidebar
- Search conversations UI
- Example prompts section
- Suggestion chips under responses
- Topbar with:
  - Fast mode button
  - Bookmark icon
  - Export icon
  - Pro badge
  - Settings button

## Chat Experience
- AI/user bubble separation
- Smooth animations
- Message history rendering
- Multi-chat system
- Chat persistence UI
- Auto-scroll behavior
- Example starter prompts
- Empty-state onboarding feeling

## Branding
- Domain connected:
  https://korvixai.com
- Transitioning away from old “Velora AI” branding
- Current active brand:
  KorvixAI

---

# Current Backend State

Backend currently works but is fragile and partially based on older Velora architecture.

Backend stack:
- FastAPI
- Railway deployment
- OpenAI chat completions API

Known active route:
POST /chat/chat

Swagger docs currently available.

---

# Backend Issues Previously Encountered

## ai_router.py
Issues encountered:
- Duplicate get_model_config()
- Missing _ROUTE_TABLE
- SyntaxError from broken try blocks
- Old mode routing logic

## ai_service.py
Issues encountered:
- Missing _get_followups()
- Fragile response formatting
- Missing fallback safety

## General Issues
- Some prompts work while others crash
- Backend helper functions missing
- Legacy Velora architecture mixed with new KorvixAI frontend
- Error responses occasionally reach frontend

---

# Backend Refactor Goals

The backend should be rewritten/refactored cleanly for KorvixAI.

## Required Principles
- Never crash frontend
- Always return valid JSON
- Stable error handling
- Modular architecture
- Railway-safe deployment
- Preserve existing frontend compatibility

---

# Required API Structure

## Core Routes

### Health
GET /health/health

### Chat
POST /chat/chat

Must remain compatible with frontend.

### Memory
- GET /memory/memory/{user_id}
- POST /memory/memory
- DELETE /memory/memory

### Profile
Profile endpoints planned.

### Stats
Usage/statistics endpoints planned.

### Auth
Authentication endpoints planned.

---

# Expected Chat Request Format

Frontend currently sends JSON similar to:

json {   "user_id": "string",   "message": "string",   "chat_id": "string",   "session_id": "string",   "platform": "web" } 

---

# Expected Chat Response Format

Backend responses should ALWAYS follow stable schema:

json {   "response": "AI response text",   "followups": [],   "mode": "fast",   "provider": "openai" } 

Frontend should NEVER receive raw backend errors.

---

# AI Routing Goals

Future AI modes planned:

- Fast
- Deep Think
- Research
- Creative
- Coding
- Study

Backend should support centralized routing logic.

Recommended structure:

python MODELS = {     "fast": "...",     "deep": "...",     "creative": "...",     "coding": "...",     "study": "..." } 

---

# Stability Requirements

Backend MUST:
- Never throw raw exceptions to frontend
- Always return fallback response
- Use centralized logging
- Handle OpenAI failures gracefully
- Support Railway deployment safely

Recommended global fallback:

python {     "response": "Şu anda bir sorun oluştu. Lütfen tekrar deneyin.",     "followups": [],     "mode": "fallback",     "provider": "system" } 

---

# Logging Requirements

Logs should include:
- request timing
- selected AI model
- route usage
- token usage
- provider info
- fallback activation
- exception traces

---

# CORS Requirements

Allowed origins:

- https://korvixai.com
- https://www.korvixai.com
- Vercel preview domains
- Railway domains
- localhost development ports

---

# Future Features Planned

## Frontend
- Streaming response effect
- AI typing HUD
- Animated AI avatar
- Expandable response actions
- Chat folders
- Pinned chats
- Export chats
- Enhanced markdown rendering
- Floating command palette
- Prompt library
- Voice input
- File uploads
- Mobile polish
- Dynamic backgrounds

## Backend
- Streaming responses
- SSE/WebSocket support
- Memory engine
- Conversation summarization
- AI mode routing
- Tool calling
- Analytics system
- User profiles
- Authentication
- Rate limiting
- Usage tracking
- Multi-provider support

---

# Important Development Rules

- Do NOT break POST /chat/chat
- Do NOT break Railway deployment
- Do NOT modify frontend unless explicitly requested
- Preserve KorvixAI branding
- Keep frontend-backend compatibility stable
- Prioritize stability over complexity
- Avoid duplicate helper functions
- Use centralized configuration
- Never return raw Python errors to frontend

---

# Deployment

Frontend:
- Vercel

Backend:
- Railway

Production domain:
- https://korvixai.com

---

# Current Project Phase

Current priority:
Stabilize backend architecture before major frontend expansion.

Frontend is already visually advanced.
Backend now needs production-grade refactor and stabilization.
