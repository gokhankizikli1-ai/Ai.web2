# coding: utf-8
# CRITICAL FIX — Design Diversity Engine.
#
# A library of distinct visual STYLE MODES. The same ProductSpec rendered
# under two different modes must look like two different products: the mode
# changes background treatment, typography, spacing density, card shape
# (radius), accents, light/dark, nav feel and shadow/border weight.
#
# This is what stops every generation from looking like the same dark SaaS
# page. "Apple style" → apple_minimal (light, airy, native). "Linear" →
# linear_dark (compact, indigo). "Stripe" → stripe_gradient. etc.
#
# Pure data + pure functions — no I/O, fully testable.

from __future__ import annotations

import re
from typing import Dict

# Font stacks (all system/web-safe — NO external font fetch, sandbox safe).
_FONTS = {
    "system": "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Roboto, system-ui, sans-serif",
    "inter":  "'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
    "mono":   "ui-monospace, 'SF Mono', 'JetBrains Mono', 'Menlo', 'Cascadia Code', monospace",
    "serif":  "'Iowan Old Style', 'Palatino Linotype', 'Georgia', 'Times New Roman', serif",
    "grotesk":"'Inter', 'Space Grotesk', ui-sans-serif, system-ui, sans-serif",
}

# Spacing density → (section padding, card padding, grid gap).
_DENSITY = {
    "airy":    ("clamp(72px, 11vw, 148px)", "30px", "22px"),
    "normal":  ("clamp(56px, 9vw, 112px)",  "26px", "18px"),
    "compact": ("clamp(40px, 6vw, 80px)",   "20px", "14px"),
}


# ── The 12 style modes (requirement #4) ───────────────────────────────
#
# Each: mode (dark|light), accent pair, radius, density, font, bg treatment.

STYLE_MODES: Dict[str, Dict[str, str]] = {
    "apple_minimal": {
        "label": "Apple Minimal", "mode": "light", "accent": "#0a84ff",
        "accent2": "#5e5ce6", "radius": "14px", "density": "airy",
        "font": "system", "bg": "clean",
    },
    "linear_dark": {
        "label": "Linear Dark", "mode": "dark", "accent": "#5e6ad2",
        "accent2": "#8b5cf6", "radius": "10px", "density": "compact",
        "font": "inter", "bg": "subtle",
    },
    "stripe_gradient": {
        "label": "Stripe Gradient", "mode": "dark", "accent": "#635bff",
        "accent2": "#00d4ff", "radius": "18px", "density": "normal",
        "font": "inter", "bg": "gradient",
    },
    "vercel_mono": {
        "label": "Vercel Mono", "mode": "dark", "accent": "#ededed",
        "accent2": "#888888", "radius": "8px", "density": "compact",
        "font": "mono", "bg": "mono",
    },
    "notion_clean": {
        "label": "Notion Clean", "mode": "light", "accent": "#2f3437",
        "accent2": "#eb5757", "radius": "6px", "density": "normal",
        "font": "system", "bg": "paper",
    },
    "raycast_command": {
        "label": "Raycast Command", "mode": "dark", "accent": "#ff6363",
        "accent2": "#ffb224", "radius": "12px", "density": "compact",
        "font": "inter", "bg": "command",
    },
    "luxury_editorial": {
        "label": "Luxury Editorial", "mode": "dark", "accent": "#c8a96a",
        "accent2": "#e9d8a6", "radius": "4px", "density": "airy",
        "font": "serif", "bg": "editorial",
    },
    "fintech_glass": {
        "label": "Fintech Glass", "mode": "dark", "accent": "#3b82f6",
        "accent2": "#22d3ee", "radius": "18px", "density": "normal",
        "font": "inter", "bg": "glass",
    },
    "gaming_neon": {
        "label": "Gaming Neon", "mode": "dark", "accent": "#a855f7",
        "accent2": "#22d3ee", "radius": "14px", "density": "normal",
        "font": "grotesk", "bg": "neon",
    },
    "ecommerce_editorial": {
        "label": "Ecommerce Editorial", "mode": "light", "accent": "#111111",
        "accent2": "#b88a4a", "radius": "12px", "density": "airy",
        "font": "system", "bg": "editorial-light",
    },
    "healthcare_clean": {
        "label": "Healthcare Clean", "mode": "light", "accent": "#0ea5e9",
        "accent2": "#14b8a6", "radius": "16px", "density": "airy",
        "font": "system", "bg": "clean",
    },
    "productivity_native": {
        "label": "Productivity Native", "mode": "light", "accent": "#4f46e5",
        "accent2": "#0ea5e9", "radius": "10px", "density": "compact",
        "font": "system", "bg": "clean",
    },
    # Sprint 2.0 — "Apple, Linear, Stripe, Notion, Arc Browser, Vercel"
    # reference set: Arc's warm, very-rounded, gradient-glow command feel.
    "arc_browser": {
        "label": "Arc Browser", "mode": "dark", "accent": "#7c5cff",
        "accent2": "#ff7a5c", "radius": "22px", "density": "airy",
        "font": "grotesk", "bg": "gradient",
    },
}

DEFAULT_STYLE = "linear_dark"

# Explicit "look like X" keyword → style mode (highest priority).
_STYLE_KEYWORDS = [
    (re.compile(r"\bapple|ios|macos|cupertino|native\s*app\b", re.I), "apple_minimal"),
    (re.compile(r"\blinear\b", re.I), "linear_dark"),
    (re.compile(r"\bstripe\b", re.I), "stripe_gradient"),
    (re.compile(r"\bvercel|monospace|terminal\s*style\b", re.I), "vercel_mono"),
    (re.compile(r"\bnotion\b", re.I), "notion_clean"),
    (re.compile(r"\braycast|command\s*(?:bar|palette|menu)\b", re.I), "raycast_command"),
    (re.compile(r"\barc\s*browser\b|\bthe\s*browser\s*company\b", re.I), "arc_browser"),
    (re.compile(r"\bluxur|editorial|elegant|premium\s*brand|high[\s-]*end\b", re.I), "luxury_editorial"),
    (re.compile(r"\bgaming|game|neon|cyberpunk|esports|arcade\b", re.I), "gaming_neon"),
    (re.compile(r"\bhealth|medical|clinic|wellness|hospital|patient\b", re.I), "healthcare_clean"),
]

# Fallback by product intent when no explicit style keyword is present.
# (application_ui defaults dark — an explicit "apple"/"native" keyword is
# what flips it to the light apple_minimal mode.)
_STYLE_BY_INTENT = {
    "application_ui":   "linear_dark",
    "productivity_tool":"productivity_native",
    "dashboard":        "linear_dark",
    "admin_panel":      "linear_dark",
    "ai_tool":          "raycast_command",
    "finance_tool":     "fintech_glass",
    "landing_page":     "stripe_gradient",
    "website":          "luxury_editorial",
    "portfolio":        "luxury_editorial",
    "ecommerce":        "ecommerce_editorial",
    "booking":          "healthcare_clean",
    "game_ui":          "gaming_neon",
}


def resolve_style_mode(user_request: str, intent: str) -> str:
    """Pick a style mode: explicit "looks like X" keyword wins; otherwise a
    sensible default for the product intent."""
    text = user_request or ""
    for pattern, mode in _STYLE_KEYWORDS:
        if pattern.search(text):
            return mode
    return _STYLE_BY_INTENT.get(intent, DEFAULT_STYLE)


def resolve_style(mode: str) -> Dict[str, str]:
    """Return the style-mode token dict (copy), defaulting safely."""
    base = STYLE_MODES.get(mode) or STYLE_MODES[DEFAULT_STYLE]
    out = dict(base)
    out["mode_name"] = mode if mode in STYLE_MODES else DEFAULT_STYLE
    return out


def font_stack(key: str) -> str:
    return _FONTS.get(key or "inter", _FONTS["inter"])


def density_values(key: str):
    return _DENSITY.get(key or "normal", _DENSITY["normal"])


__all__ = [
    "STYLE_MODES", "DEFAULT_STYLE", "resolve_style_mode", "resolve_style",
    "font_stack", "density_values",
]
