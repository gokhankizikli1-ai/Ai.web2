# coding: utf-8
"""
Model Manager — returns model/temperature/token configuration for a given mode.

Output dict format is compatible with ai_router.get_model_config() so both
the old intent-based routing and the new mode-based routing can be consumed
by the same call sites.

Usage:
    from backend.services.ai.model_manager import get_config

    cfg = get_config("trading_analyst", depth="high", user_text="...")
    reply = await ask_ai(prompt, sys_p, history, model=cfg["model"],
                         temperature=cfg["temperature"], max_tokens=cfg["max_tokens"])
"""
from backend.services.ai.mode_manager import get_mode, MODEL_FAST, MODEL_STRONG, PROVIDER

# Keywords that force the strong model regardless of mode default.
_STRONG_KW = [
    "detayli", "derin", "kapsamli", "tam analiz", "profesyonel",
    "deep", "very detailed", "comprehensive", "explain everything",
]

# Token budgets for depth levels.
_DEPTH_TOKENS = {
    "high":   3000,
    "medium": 2000,
    "low":    1000,
}


def get_config(
    mode_name: str,
    depth: str = None,
    user_text: str = "",
) -> dict:
    """
    Return a model configuration dict for the given mode.

    Respects depth overrides: depth='high' or strong keywords in user_text
    force MODEL_STRONG and a larger token budget.

    Falls back to 'fast' mode if mode_name is unknown.

    Returns a dict with keys:
        model, provider, use_gpt4, mode, temperature, max_tokens, style
    """
    mode = get_mode(mode_name)
    if mode is None:
        mode = get_mode("fast")

    model       = mode.model
    temperature = mode.temperature
    max_tokens  = mode.max_tokens
    t           = (user_text or "").lower()

    # Depth / keyword override: escalate to strong model if requested.
    if depth == "high" or any(kw in t for kw in _STRONG_KW):
        model       = MODEL_STRONG
        temperature = min(temperature, 0.40)   # cap at 0.40 for precision
        max_tokens  = max(max_tokens, _DEPTH_TOKENS["high"])

    elif depth == "medium":
        max_tokens = max(max_tokens, _DEPTH_TOKENS["medium"])

    # Fast-mode shortcut: user explicitly wants a brief answer.
    _fast_kw = ["kisa", "ozet", "hizli", "quick", "brief", "sadece sonuc"]
    if any(kw in t for kw in _fast_kw):
        model       = MODEL_FAST
        max_tokens  = min(max_tokens, 600)
        temperature = max(temperature, 0.75)

    return {
        "model":       model,
        "provider":    PROVIDER,
        "use_gpt4":    model == MODEL_STRONG,
        "mode":        mode.name,
        "temperature": temperature,
        "max_tokens":  max_tokens,
        "style":       mode.response_style,
    }
