# coding: utf-8
# EPIC 2 — Premium design system.
#
# ONE cohesive, reusable design language embedded into every generated
# HTML artifact, so the baseline visual quality (typography, spacing,
# colour, elevation, dark mode, motion, responsiveness) is GUARANTEED
# regardless of how good the LLM body is. Inspired by Linear / Vercel /
# Stripe / Raycast: dark-by-default, soft shadows, rounded corners,
# subtle gradients, glass surfaces, micro-animations.
#
# Pure data (a CSS string + token metadata) — no I/O, fully testable.

from __future__ import annotations

from typing import Dict

# Design tokens surfaced in artifact metadata + used by the renderer.
DESIGN_TOKENS: Dict[str, object] = {
    "typography": {
        "font_sans": "'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
        "scale": ["0.75rem", "0.875rem", "1rem", "1.125rem", "1.25rem",
                  "1.5rem", "1.875rem", "2.5rem", "3.5rem"],
    },
    "spacing_scale": [4, 8, 12, 16, 24, 32, 48, 64, 96],
    "radius": {"sm": "8px", "md": "14px", "lg": "20px", "xl": "28px", "full": "9999px"},
    "shadow_scale": ["0 1px 2px rgba(0,0,0,.4)",
                     "0 4px 16px -4px rgba(0,0,0,.5)",
                     "0 12px 40px -8px rgba(0,0,0,.6)"],
    "breakpoints": {"sm": "640px", "md": "768px", "lg": "1024px", "xl": "1280px"},
    "transition": {"fast": "120ms", "base": "200ms", "slow": "360ms",
                   "ease": "cubic-bezier(.4,0,.2,1)"},
    "modes": ["dark", "light"],
}


def design_system_css(accent: str = "#6366f1", accent2: str = "#22d3ee") -> str:
    """Return the full premium design-system stylesheet, themed by a
    pair of accent colours. Dark-by-default with a `.light` override,
    a fluid type scale, spacing/radius/shadow tokens, glass surfaces,
    focus-visible states, reduced-motion support, and reusable
    component classes (.ds-btn, .ds-card, .ds-nav, .ds-hero, .ds-grid,
    .ds-stat, .ds-badge, .ds-footer)."""
    return f"""
:root {{
  --accent: {accent};
  --accent-2: {accent2};
  --grad: linear-gradient(135deg, {accent} 0%, {accent2} 100%);
  --bg: #0a0b0f; --surface: #121420; --surface-2: #171a28;
  --border: rgba(255,255,255,.08); --border-strong: rgba(255,255,255,.14);
  --text: #f3f4f8; --text-muted: #9aa3b2; --text-dim: #6b7280;
  --radius-sm: 8px; --radius: 14px; --radius-lg: 20px; --radius-xl: 28px;
  --shadow-sm: 0 1px 2px rgba(0,0,0,.4);
  --shadow: 0 4px 16px -4px rgba(0,0,0,.5);
  --shadow-lg: 0 12px 40px -8px rgba(0,0,0,.6);
  --ease: cubic-bezier(.4,0,.2,1); --t-fast: 120ms; --t: 200ms; --t-slow: 360ms;
  --font: 'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
}}
.light {{
  --bg: #f7f8fb; --surface: #ffffff; --surface-2: #f1f3f9;
  --border: rgba(15,23,42,.08); --border-strong: rgba(15,23,42,.14);
  --text: #0f172a; --text-muted: #475569; --text-dim: #94a3b8;
  --shadow-sm: 0 1px 2px rgba(15,23,42,.06);
  --shadow: 0 4px 16px -6px rgba(15,23,42,.12);
  --shadow-lg: 0 16px 48px -12px rgba(15,23,42,.18);
}}
* {{ margin: 0; padding: 0; box-sizing: border-box; }}
html {{ scroll-behavior: smooth; }}
body {{
  font-family: var(--font); background: var(--bg); color: var(--text);
  line-height: 1.6; -webkit-font-smoothing: antialiased;
  letter-spacing: -0.011em;
}}
a {{ color: inherit; text-decoration: none; }}
img {{ max-width: 100%; display: block; }}
.ds-container {{ width: 100%; max-width: 1200px; margin: 0 auto; padding: 0 24px; }}
.ds-section {{ padding: clamp(48px, 8vw, 96px) 0; }}
.ds-eyebrow {{ color: var(--accent-2); font-size: .8rem; font-weight: 600;
  text-transform: uppercase; letter-spacing: .08em; }}
h1, h2, h3 {{ line-height: 1.12; letter-spacing: -0.025em; font-weight: 700; }}
h1 {{ font-size: clamp(2.25rem, 5vw, 3.5rem); }}
h2 {{ font-size: clamp(1.75rem, 3.5vw, 2.5rem); }}
h3 {{ font-size: 1.25rem; }}
p {{ color: var(--text-muted); }}

/* Buttons */
.ds-btn {{ display: inline-flex; align-items: center; gap: 8px; cursor: pointer;
  font: inherit; font-weight: 600; font-size: .95rem; padding: 12px 22px;
  border-radius: var(--radius); border: 1px solid transparent;
  transition: transform var(--t) var(--ease), box-shadow var(--t) var(--ease),
    background var(--t) var(--ease); }}
.ds-btn-primary {{ background: var(--grad); color: #fff; box-shadow: var(--shadow); }}
.ds-btn-primary:hover {{ transform: translateY(-2px); box-shadow: var(--shadow-lg); }}
.ds-btn-ghost {{ background: transparent; color: var(--text);
  border-color: var(--border-strong); }}
.ds-btn-ghost:hover {{ background: var(--surface-2); transform: translateY(-1px); }}

/* Surfaces / cards */
.ds-card {{ background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius-lg); padding: 24px; box-shadow: var(--shadow-sm);
  transition: transform var(--t) var(--ease), border-color var(--t) var(--ease),
    box-shadow var(--t) var(--ease); }}
.ds-card:hover {{ transform: translateY(-4px); border-color: var(--border-strong);
  box-shadow: var(--shadow); }}
.ds-glass {{ background: rgba(255,255,255,.04); backdrop-filter: blur(14px);
  border: 1px solid var(--border); }}
.ds-badge {{ display: inline-flex; align-items: center; gap: 6px;
  padding: 5px 12px; border-radius: var(--radius-full, 9999px);
  background: var(--surface-2); border: 1px solid var(--border);
  font-size: .78rem; color: var(--text-muted); }}

/* Nav */
.ds-nav {{ position: sticky; top: 0; z-index: 50; display: flex; align-items: center;
  justify-content: space-between; padding: 16px 24px;
  background: rgba(10,11,15,.7); backdrop-filter: blur(16px);
  border-bottom: 1px solid var(--border); }}
.light .ds-nav {{ background: rgba(247,248,251,.8); }}
.ds-nav-brand {{ display: flex; align-items: center; gap: 10px; font-weight: 700;
  font-size: 1.05rem; }}
.ds-nav-logo {{ width: 30px; height: 30px; border-radius: 9px; background: var(--grad);
  box-shadow: var(--shadow); }}
.ds-nav-links {{ display: flex; gap: 28px; }}
.ds-nav-links a {{ color: var(--text-muted); font-size: .92rem; font-weight: 500;
  transition: color var(--t) var(--ease); }}
.ds-nav-links a:hover {{ color: var(--text); }}

/* Hero */
.ds-hero {{ position: relative; text-align: center; padding: clamp(64px,10vw,128px) 0;
  overflow: hidden; }}
.ds-hero::before {{ content: ''; position: absolute; inset: -40% 0 auto 0; height: 480px;
  background: radial-gradient(60% 60% at 50% 0%, color-mix(in srgb, var(--accent) 28%, transparent), transparent 70%);
  filter: blur(20px); z-index: -1; }}
.ds-hero h1 {{ max-width: 18ch; margin: 0 auto 20px; }}
.ds-hero p {{ max-width: 52ch; margin: 0 auto 32px; font-size: 1.15rem; }}
.ds-hero-actions {{ display: flex; gap: 14px; justify-content: center; flex-wrap: wrap; }}

/* Grids */
.ds-grid {{ display: grid; gap: 20px;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr)); }}
.ds-stat {{ display: flex; flex-direction: column; gap: 6px; }}
.ds-stat-value {{ font-size: 2rem; font-weight: 700; letter-spacing: -.03em; }}
.ds-stat-delta {{ font-size: .82rem; color: #34d399; }}
.ds-icon {{ width: 44px; height: 44px; border-radius: 12px; display: grid;
  place-items: center; background: color-mix(in srgb, var(--accent) 16%, transparent);
  color: var(--accent-2); margin-bottom: 14px; font-size: 1.25rem; }}

/* Footer */
.ds-footer {{ border-top: 1px solid var(--border); padding: 40px 0; color: var(--text-dim);
  font-size: .88rem; }}

/* Motion + a11y */
@keyframes ds-rise {{ from {{ opacity: 0; transform: translateY(16px); }}
  to {{ opacity: 1; transform: none; }} }}
.ds-rise {{ animation: ds-rise var(--t-slow) var(--ease) both; }}
.ds-rise:nth-child(2) {{ animation-delay: 60ms; }}
.ds-rise:nth-child(3) {{ animation-delay: 120ms; }}
.ds-rise:nth-child(4) {{ animation-delay: 180ms; }}
:focus-visible {{ outline: 2px solid var(--accent-2); outline-offset: 3px;
  border-radius: 6px; }}
@media (prefers-reduced-motion: reduce) {{
  *, *::before, *::after {{ animation: none !important; transition: none !important; }}
}}
@media (max-width: 768px) {{
  .ds-nav-links {{ display: none; }}
  .ds-section {{ padding: 56px 0; }}
}}
""".strip()


__all__ = ["DESIGN_TOKENS", "design_system_css"]
