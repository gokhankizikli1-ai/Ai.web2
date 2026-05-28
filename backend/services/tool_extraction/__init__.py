# coding: utf-8
"""
Phase 10 fix — automatic URL → tool invocation for the chat path.

Bridges the gap between:
  - the existing tool registry (which has a registered github_repo
    tool that nobody was calling from chat), and
  - the chat stream (which produces the LLM's response).

When a user types "analyze github.com/owner/repo" or just pastes a
GitHub URL, this module:
  1. extracts the GitHub references from the message
  2. invokes the github_repo tool for each (read-only, ownership-safe)
  3. optionally fetches a small set of key files (package.json,
     requirements.txt, Dockerfile, pyproject.toml, vite.config.*,
     etc.) so the LLM can summarise the actual tech stack
  4. logs every call via the ToolExecutionsClient (when enabled)
  5. returns a compact "Repository inspection" context block the
     chat route folds into the system prompt before the LLM streams

NOT a generic URL fetcher — that's the browser_tool, which the chat
route can call separately via a similar extractor in a follow-up PR.
Today's scope is just GitHub (the user's bug report).
"""
from backend.services.tool_extraction.github_urls import (
    extract_github_refs,
    build_github_context_block,
    GitHubRef,
)
from backend.services.tool_extraction.web_urls import (
    extract_web_urls,
    build_web_context_block,
    WebUrl,
)
from backend.services.tool_extraction.web_search_intent import (
    WebSearchIntent,
    detect_web_search_intent,
    build_web_search_context_block,
)
from backend.services.tool_extraction.ranking_intent import (
    RankingIntent,
    detect_ranking_intent,
    build_rankings_context_block,
)

__all__ = [
    "extract_github_refs", "build_github_context_block", "GitHubRef",
    "extract_web_urls", "build_web_context_block", "WebUrl",
    "WebSearchIntent", "detect_web_search_intent",
    "build_web_search_context_block",
    "RankingIntent", "detect_ranking_intent",
    "build_rankings_context_block",
]
