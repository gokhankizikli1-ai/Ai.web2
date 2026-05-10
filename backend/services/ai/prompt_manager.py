# coding: utf-8
"""
Prompt Manager — assembles the final system prompt for a given mode.

Usage:
    from backend.services.ai.prompt_manager import build_system_prompt, intent_to_mode

    sys_p = build_system_prompt("trading_analyst", mem_summary=..., profile=...)
"""
from backend.services.ai.mode_manager import get_mode, resolve_mode_name

# Maps existing intent/category strings (from detect_intent) to canonical mode names.
# Used when ai_service routes by intent and wants to pick the best mode automatically.
_INTENT_TO_MODE: dict = {
    # Finance & trading
    "finance":          "trading_analyst",
    "crypto":           "trading_analyst",
    "stock":            "trading_analyst",
    # E-commerce
    "ecommerce":        "marketing_dropshipping",
    "ads":              "marketing_dropshipping",
    "product_research": "marketing_dropshipping",
    # Startup / execution
    "startup":          "startup_advisor",
    "execution":        "startup_advisor",
    # Technical
    "coding":           "coding",
    # Education
    "education":        "study",
    "general_question": "study",
    # Research / news
    "news":             "research",
    "research":         "research",
    # Website / landing pages
    "website":          "website_builder",
    "landing":          "website_builder",
    # Everything else falls back to fast
}


def build_system_prompt(
    mode_name: str,
    mem_summary: str = "",
    style_prompt: str = "",
    profile: str = "",
) -> str:
    """
    Build and return the full system prompt string for the given mode.

    Appends user context (profile, memory, style) when non-empty.
    Falls back to 'fast' mode if mode_name is unknown.
    """
    mode = get_mode(mode_name)
    if mode is None:
        mode = get_mode("fast")  # safe fallback

    parts = [mode.system_prompt]

    if profile and profile.strip() and "No user info" not in profile:
        parts.append("Kullanici profili:\n" + profile.strip())

    if mem_summary and mem_summary.strip():
        parts.append("Kullanici hafizasi:\n" + mem_summary.strip())

    if style_prompt and style_prompt.strip():
        parts.append(style_prompt.strip())

    return "\n\n".join(parts)


def intent_to_mode(intent: str) -> str:
    """
    Map an intent/category string to a canonical mode name.

    Returns 'fast' for unknown intents so the system always has a valid mode.
    """
    return _INTENT_TO_MODE.get(intent, "fast")


def get_safety_rules(mode_name: str) -> list:
    """Return safety rules list for the given mode (for logging / audit)."""
    mode = get_mode(mode_name)
    if mode is None:
        return []
    return list(mode.safety_rules)
