# coding: utf-8
# EPIC 2 — Premium design system (demo-grade).
#
# ONE cohesive design language embedded into every generated artifact so
# baseline quality is GUARANTEED. Tuned for a live-demo "wow": large hero
# with layered gradient + radial glow + grid pattern, bento grids, glass
# panels, glow accents, soft shadows, modern gradient buttons with hover
# lift, chart-like blocks, activity feed, window-chrome mockups, switches,
# and pseudo-page panels. Dark-by-default with a `.light` override.
#
# Pure data (CSS string + token metadata) — no I/O, fully testable.

from __future__ import annotations

from typing import Dict, Optional

from backend.services.generation.styles import density_values, font_stack

DESIGN_TOKENS: Dict[str, object] = {
    "typography": {
        "font_sans": "'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
        "scale": ["0.75rem", "0.875rem", "1rem", "1.125rem", "1.25rem",
                  "1.5rem", "1.875rem", "2.5rem", "3.5rem", "4.5rem"],
    },
    "spacing_scale": [4, 8, 12, 16, 24, 32, 48, 64, 96, 128],
    "radius": {"sm": "10px", "md": "16px", "lg": "22px", "xl": "32px", "full": "9999px"},
    "shadow_scale": ["0 1px 2px rgba(0,0,0,.4)",
                     "0 8px 30px -8px rgba(0,0,0,.5)",
                     "0 24px 70px -16px rgba(0,0,0,.65)"],
    "breakpoints": {"sm": "640px", "md": "768px", "lg": "1024px", "xl": "1280px"},
    "transition": {"fast": "120ms", "base": "220ms", "slow": "420ms",
                   "ease": "cubic-bezier(.4,0,.2,1)"},
    "modes": ["dark", "light"],
}


def design_system_css(accent: str = "#6366f1", accent2: str = "#22d3ee",
                      style: Optional[Dict] = None) -> str:
    """Full premium design-system stylesheet, themed by an accent pair and
    (optionally) a Design-Diversity style mode. The `style` arg is purely
    additive — called positionally with two accents it behaves exactly as
    before, so all existing callers/tests are unaffected."""
    base = f"""
:root {{
  --accent: {accent}; --accent-2: {accent2};
  --grad: linear-gradient(135deg, {accent} 0%, {accent2} 100%);
  --bg: #07080c; --bg-2: #0b0d14; --surface: #10131d; --surface-2: #161a27;
  --border: rgba(255,255,255,.07); --border-strong: rgba(255,255,255,.14);
  --text: #f4f5f8; --text-muted: #9aa3b4; --text-dim: #646c7d;
  --radius-sm: 10px; --radius: 16px; --radius-lg: 22px; --radius-xl: 32px;
  --shadow-sm: 0 1px 2px rgba(0,0,0,.4);
  --shadow: 0 8px 30px -8px rgba(0,0,0,.5);
  --shadow-lg: 0 24px 70px -16px rgba(0,0,0,.65);
  --glow: 0 0 0 1px color-mix(in srgb, var(--accent) 30%, transparent),
          0 8px 40px -6px color-mix(in srgb, var(--accent) 45%, transparent);
  --ease: cubic-bezier(.4,0,.2,1); --t-fast: 120ms; --t: 220ms; --t-slow: 420ms;
  --font: 'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
}}
.light {{
  --bg: #f6f7fb; --bg-2: #eef1f7; --surface: #ffffff; --surface-2: #f1f4fa;
  --border: rgba(15,23,42,.08); --border-strong: rgba(15,23,42,.16);
  --text: #0b1220; --text-muted: #475569; --text-dim: #94a3b8;
  --shadow-sm: 0 1px 2px rgba(15,23,42,.06);
  --shadow: 0 10px 34px -10px rgba(15,23,42,.16);
  --shadow-lg: 0 28px 70px -18px rgba(15,23,42,.22);
}}
* {{ margin: 0; padding: 0; box-sizing: border-box; }}
html {{ scroll-behavior: smooth; }}
body {{ font-family: var(--font); color: var(--text); line-height: 1.6;
  -webkit-font-smoothing: antialiased; letter-spacing: -0.011em;
  background:
    radial-gradient(900px 520px at 80% -10%, color-mix(in srgb, var(--accent) 14%, transparent), transparent 60%),
    radial-gradient(760px 480px at 0% 0%, color-mix(in srgb, var(--accent-2) 12%, transparent), transparent 55%),
    var(--bg);
}}
a {{ color: inherit; text-decoration: none; }}
img {{ max-width: 100%; display: block; }}
.ds-container {{ width: 100%; max-width: 1180px; margin: 0 auto; padding: 0 24px; }}
.ds-section {{ padding: clamp(56px, 9vw, 112px) 0; }}
.ds-center {{ text-align: center; }}
.ds-eyebrow {{ color: var(--accent-2); font-size: .8rem; font-weight: 600;
  text-transform: uppercase; letter-spacing: .12em; }}
h1,h2,h3 {{ line-height: 1.08; letter-spacing: -0.03em; font-weight: 760; }}
h1 {{ font-size: clamp(2.5rem, 6vw, 4.25rem); }}
h2 {{ font-size: clamp(1.9rem, 4vw, 2.75rem); }}
h3 {{ font-size: 1.2rem; letter-spacing: -0.02em; }}
p {{ color: var(--text-muted); }}
.ds-lead {{ font-size: 1.2rem; color: var(--text-muted); }}

/* Buttons */
.ds-btn {{ display: inline-flex; align-items: center; gap: 8px; cursor: pointer;
  font: inherit; font-weight: 600; font-size: .95rem; padding: 13px 24px;
  border-radius: var(--radius); border: 1px solid transparent; white-space: nowrap;
  transition: transform var(--t) var(--ease), box-shadow var(--t) var(--ease),
    background var(--t) var(--ease), border-color var(--t) var(--ease); }}
.ds-btn-primary {{ background: var(--grad); color: #fff; box-shadow: var(--glow); }}
.ds-btn-primary:hover {{ transform: translateY(-2px);
  box-shadow: var(--glow), var(--shadow-lg); }}
.ds-btn-ghost {{ background: color-mix(in srgb, var(--surface) 60%, transparent);
  color: var(--text); border-color: var(--border-strong); }}
.ds-btn-ghost:hover {{ background: var(--surface-2); transform: translateY(-1px); }}
.ds-btn:active {{ transform: translateY(0) scale(.98); }}
.ds-btn-sm {{ padding: 8px 14px; font-size: .85rem; }}

/* Surfaces */
.ds-card {{ position: relative; background:
    linear-gradient(180deg, color-mix(in srgb, var(--surface) 92%, transparent), var(--surface));
  border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 26px;
  box-shadow: var(--shadow-sm);
  transition: transform var(--t) var(--ease), border-color var(--t) var(--ease),
    box-shadow var(--t) var(--ease); }}
.ds-card:hover {{ transform: translateY(-4px); border-color: var(--border-strong);
  box-shadow: var(--shadow); }}
.ds-glass {{ background: rgba(255,255,255,.045); backdrop-filter: blur(16px);
  border: 1px solid var(--border); }}
.ds-badge {{ display: inline-flex; align-items: center; gap: 7px; padding: 6px 14px;
  border-radius: 9999px; background: color-mix(in srgb, var(--accent) 12%, var(--surface));
  border: 1px solid var(--border-strong); font-size: .78rem; color: var(--text);
  box-shadow: var(--shadow-sm); }}
.ds-badge-dot {{ width: 7px; height: 7px; border-radius: 9999px; background: var(--accent-2);
  box-shadow: 0 0 8px var(--accent-2); }}
.ds-icon {{ width: 46px; height: 46px; border-radius: 13px; display: grid; place-items: center;
  background: var(--grad); color: #fff; margin-bottom: 16px; font-size: 1.3rem;
  box-shadow: var(--glow); }}

/* Nav */
.ds-nav {{ position: sticky; top: 0; z-index: 50; display: flex; align-items: center;
  justify-content: space-between; gap: 18px; padding: 14px 24px;
  background: color-mix(in srgb, var(--bg) 72%, transparent); backdrop-filter: blur(18px);
  border-bottom: 1px solid var(--border); }}
.ds-nav-brand {{ display: flex; align-items: center; gap: 10px; font-weight: 750; font-size: 1.05rem; }}
.ds-nav-logo {{ width: 30px; height: 30px; border-radius: 9px; background: var(--grad);
  box-shadow: var(--glow); }}
.ds-nav-links {{ display: flex; gap: 6px; }}
.ds-nav-links a {{ color: var(--text-muted); font-size: .92rem; font-weight: 500;
  padding: 8px 14px; border-radius: var(--radius); cursor: pointer;
  border: 1px solid transparent; transition: all var(--t) var(--ease); }}
.ds-nav-links a:hover {{ color: var(--text); background: var(--surface-2); }}
.ds-nav-links a.is-active {{ color: var(--text); background: var(--surface-2);
  border-color: var(--border-strong); }}

/* Hero */
.ds-hero {{ position: relative; text-align: center; padding: clamp(72px,12vw,150px) 0 clamp(40px,6vw,72px);
  overflow: hidden; }}
.ds-hero::before {{ content: ''; position: absolute; inset: -30% -20% auto -20%; height: 620px;
  background: radial-gradient(50% 55% at 50% 0%, color-mix(in srgb, var(--accent) 34%, transparent), transparent 72%);
  filter: blur(8px); z-index: -2; }}
.ds-hero::after {{ content: ''; position: absolute; inset: 0; z-index: -1; opacity: .5;
  background-image: linear-gradient(var(--border) 1px, transparent 1px),
    linear-gradient(90deg, var(--border) 1px, transparent 1px);
  background-size: 56px 56px; -webkit-mask-image: radial-gradient(60% 60% at 50% 30%, #000, transparent 75%);
  mask-image: radial-gradient(60% 60% at 50% 30%, #000, transparent 75%); }}
.ds-hero h1 {{ max-width: 20ch; margin: 18px auto; background:
    linear-gradient(180deg, var(--text), color-mix(in srgb, var(--text) 62%, transparent));
  -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }}
.ds-hero .ds-lead {{ max-width: 56ch; margin: 0 auto 34px; }}
.ds-hero-actions {{ display: flex; gap: 14px; justify-content: center; flex-wrap: wrap; }}

/* Grids + bento */
.ds-grid {{ display: grid; gap: 18px;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 270px), 1fr)); }}
.ds-bento {{ display: grid; gap: 18px; grid-template-columns: repeat(6, 1fr); }}
.ds-bento > * {{ grid-column: span 2; }}
.ds-bento > .ds-col-3 {{ grid-column: span 3; }}
.ds-bento > .ds-col-4 {{ grid-column: span 4; }}
.ds-bento > .ds-col-6 {{ grid-column: span 6; }}
.ds-bento > .ds-row-2 {{ grid-row: span 2; }}

/* Stats */
.ds-stat-value {{ font-size: 2.1rem; font-weight: 750; letter-spacing: -.03em; }}
.ds-stat-delta {{ font-size: .82rem; color: #34d399; font-weight: 600; }}

/* Chart-like blocks */
.ds-bars {{ display: flex; align-items: flex-end; gap: 8px; height: 120px; margin-top: 14px; }}
.ds-bars > span {{ flex: 1; border-radius: 7px 7px 0 0; background: var(--grad);
  opacity: .85; transition: height var(--t-slow) var(--ease); }}
.ds-spark {{ height: 64px; border-radius: 12px; margin-top: 12px;
  background: linear-gradient(180deg, color-mix(in srgb, var(--accent) 26%, transparent), transparent);
  border-bottom: 2px solid var(--accent-2); }}
.ds-ring {{ width: 96px; height: 96px; border-radius: 9999px;
  background: conic-gradient(var(--accent) var(--pct,72%), var(--surface-2) 0); display: grid;
  place-items: center; }}
.ds-ring::after {{ content: ''; width: 70px; height: 70px; border-radius: 9999px; background: var(--surface); }}

/* Activity feed */
.ds-feed {{ display: flex; flex-direction: column; }}
.ds-feed-item {{ display: flex; gap: 12px; padding: 13px 0; border-bottom: 1px solid var(--border); }}
.ds-feed-item:last-child {{ border-bottom: 0; }}
.ds-feed-dot {{ width: 34px; height: 34px; border-radius: 10px; flex: 0 0 auto;
  background: color-mix(in srgb, var(--accent) 18%, var(--surface-2)); display: grid; place-items: center; }}

/* Window-chrome mockup */
.ds-mock {{ border: 1px solid var(--border-strong); border-radius: var(--radius-lg);
  overflow: hidden; background: var(--bg-2); box-shadow: var(--shadow-lg); }}
.ds-mock-bar {{ display: flex; gap: 7px; align-items: center; padding: 12px 16px;
  border-bottom: 1px solid var(--border); background: var(--surface); }}
.ds-mock-bar i {{ width: 11px; height: 11px; border-radius: 9999px; background: var(--text-dim); opacity: .5; }}
.ds-mock-body {{ padding: 22px; }}

/* Logos / social proof */
.ds-logos {{ display: flex; flex-wrap: wrap; gap: 14px 40px; align-items: center; justify-content: center;
  opacity: .72; }}
.ds-logo {{ font-weight: 700; font-size: 1.05rem; letter-spacing: -.02em; color: var(--text-muted); }}

/* Pricing */
.ds-plan-featured {{ border-color: color-mix(in srgb, var(--accent) 55%, transparent);
  box-shadow: var(--glow); }}

/* Switch / settings (CSS-only, sandbox safe) */
.ds-row {{ display: flex; align-items: center; justify-content: space-between;
  padding: 15px 0; border-bottom: 1px solid var(--border); }}
.ds-switch {{ width: 44px; height: 26px; border-radius: 9999px; background: var(--surface-2);
  border: 1px solid var(--border-strong); position: relative; cursor: pointer; flex: 0 0 auto; }}
.ds-switch::after {{ content: ''; position: absolute; top: 2px; left: 2px; width: 20px; height: 20px;
  border-radius: 9999px; background: var(--text-muted); transition: all var(--t) var(--ease); }}
.ds-switch.is-on {{ background: var(--grad); border-color: transparent; }}
.ds-switch.is-on::after {{ left: 20px; background: #fff; }}

/* Footer */
.ds-footer {{ border-top: 1px solid var(--border); padding: 44px 0; color: var(--text-dim); font-size: .88rem; }}

/* App shells (editor / ecommerce / booking) */
.ds-toolbar {{ display: flex; align-items: center; gap: 12px; padding: 12px 18px;
  border-bottom: 1px solid var(--border); background: color-mix(in srgb, var(--surface) 60%, transparent); }}
.ds-input {{ flex: 1; min-width: 0; font: inherit; font-size: .9rem; color: var(--text);
  background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius);
  padding: 9px 14px; outline: none; transition: border-color var(--t) var(--ease); }}
.ds-input:focus {{ border-color: var(--accent); }}
.ds-shell {{ display: grid; grid-template-columns: 232px 320px 1fr; min-height: 72vh;
  border: 1px solid var(--border); border-radius: var(--radius-lg); overflow: hidden;
  background: var(--surface); box-shadow: var(--shadow); }}
.ds-pane {{ border-right: 1px solid var(--border); overflow: auto; }}
.ds-pane:last-child {{ border-right: 0; }}
.ds-pane-pad {{ padding: 16px; }}
.ds-folder {{ display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 9px 12px; border-radius: var(--radius); color: var(--text-muted); cursor: pointer;
  font-size: .9rem; font-weight: 550; transition: all var(--t) var(--ease); }}
.ds-folder:hover {{ background: var(--surface-2); color: var(--text); }}
.ds-folder.is-active {{ background: color-mix(in srgb, var(--accent) 16%, var(--surface-2));
  color: var(--text); }}
.ds-folder-count {{ font-size: .75rem; color: var(--text-dim); }}
.ds-note-item {{ padding: 13px 14px; border-bottom: 1px solid var(--border); cursor: pointer;
  transition: background var(--t) var(--ease); }}
.ds-note-item:hover {{ background: var(--surface-2); }}
.ds-note-item.is-selected {{ background: color-mix(in srgb, var(--accent) 14%, var(--surface-2));
  box-shadow: inset 3px 0 0 var(--accent); }}
.ds-note-title {{ color: var(--text); font-weight: 650; font-size: .95rem; }}
.ds-note-snippet {{ color: var(--text-dim); font-size: .82rem; margin-top: 3px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }}
.ds-editor {{ padding: 30px clamp(20px, 4vw, 52px); }}
.ds-editor-title {{ font-size: 1.9rem; font-weight: 720; letter-spacing: -.02em; color: var(--text); }}
.ds-editor-body {{ margin-top: 18px; color: var(--text-muted); white-space: pre-wrap;
  line-height: 1.75; font-size: 1.02rem; }}
.ds-price {{ color: var(--text); font-weight: 700; }}
.ds-cart-count {{ display: inline-grid; place-items: center; min-width: 22px; height: 22px;
  padding: 0 6px; border-radius: 9999px; background: var(--surface-2); color: var(--text);
  font-size: .75rem; font-weight: 700; border: 1px solid var(--border-strong); }}
.ds-cart-count.is-on {{ background: var(--grad); color: #fff; border-color: transparent; }}
.ds-chip {{ display: inline-flex; align-items: center; padding: 7px 14px; border-radius: 9999px;
  font-size: .85rem; font-weight: 600; color: var(--text-muted); cursor: pointer;
  background: var(--surface-2); border: 1px solid var(--border); transition: all var(--t) var(--ease); }}
.ds-chip:hover {{ color: var(--text); }}
.ds-chip.is-active {{ background: var(--grad); color: #fff; border-color: transparent; }}
@media (max-width: 860px) {{
  .ds-shell {{ grid-template-columns: 1fr; min-height: auto; }}
  .ds-shell .ds-pane {{ border-right: 0; border-bottom: 1px solid var(--border); max-height: 320px; }}
}}

/* Pseudo-pages */
.ds-page {{ animation: ds-rise var(--t-slow) var(--ease) both; }}

/* Motion + interactive states */
@keyframes ds-rise {{ from {{ opacity: 0; transform: translateY(18px); }} to {{ opacity: 1; transform: none; }} }}
.ds-rise {{ animation: ds-rise var(--t-slow) var(--ease) both; }}
.ds-rise:nth-child(2) {{ animation-delay: 60ms; }}
.ds-rise:nth-child(3) {{ animation-delay: 120ms; }}
.ds-rise:nth-child(4) {{ animation-delay: 180ms; }}
.ds-rise:nth-child(5) {{ animation-delay: 240ms; }}
.ds-hidden {{ display: none !important; }}
@keyframes ds-reveal {{ from {{ opacity: 0; transform: translateY(10px); }} to {{ opacity: 1; transform: none; }} }}
.ds-revealed {{ animation: ds-reveal var(--t) var(--ease) both; }}
.ds-selectable {{ cursor: pointer; }}
.ds-selectable.is-selected {{ border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent), var(--glow); }}
:focus-visible {{ outline: 2px solid var(--accent-2); outline-offset: 3px; border-radius: 6px; }}
@media (prefers-reduced-motion: reduce) {{
  *, *::before, *::after {{ animation: none !important; transition: none !important; }}
  html {{ scroll-behavior: auto; }}
}}
@media (max-width: 860px) {{
  .ds-bento {{ grid-template-columns: repeat(2, 1fr); }}
  .ds-bento > * {{ grid-column: span 2 !important; grid-row: auto !important; }}
}}
@media (max-width: 680px) {{
  .ds-nav-links {{ display: none; }}
  .ds-section {{ padding: 56px 0; }}
}}
""".strip()
    if not style:
        return base
    return base + "\n\n/* ── Style mode overrides ── */\n" + _style_overrides(style)


def _style_overrides(style: Dict) -> str:
    """Per-style-mode CSS overrides: typography, card radius, spacing
    density and background treatment. This is what makes two products in
    different modes look genuinely different."""
    font = font_stack(style.get("font", "inter"))
    radius = style.get("radius", "16px")
    sec_pad, card_pad, gap = density_values(style.get("density", "normal"))
    bg = style.get("bg", "subtle")
    accent = style.get("accent", "#6366f1")
    accent2 = style.get("accent2", "#22d3ee")

    # Background treatments per style mode.
    treatments = {
        "clean":      "var(--bg)",
        "paper":      "var(--bg)",
        "mono":       "var(--bg)",
        "subtle":     ("radial-gradient(1100px 600px at 88% -12%, "
                       f"color-mix(in srgb, {accent} 9%, transparent), transparent 60%), var(--bg)"),
        "gradient":   ("radial-gradient(900px 520px at 80% -10%, "
                       f"color-mix(in srgb, {accent} 22%, transparent), transparent 60%), "
                       "radial-gradient(760px 480px at 0% 0%, "
                       f"color-mix(in srgb, {accent2} 18%, transparent), transparent 55%), var(--bg)"),
        "glass":      ("radial-gradient(900px 560px at 78% -8%, "
                       f"color-mix(in srgb, {accent} 16%, transparent), transparent 58%), "
                       "radial-gradient(700px 480px at 4% 2%, "
                       f"color-mix(in srgb, {accent2} 14%, transparent), transparent 55%), var(--bg)"),
        "neon":       ("radial-gradient(700px 480px at 14% 4%, "
                       f"color-mix(in srgb, {accent} 28%, transparent), transparent 52%), "
                       "radial-gradient(760px 520px at 86% 10%, "
                       f"color-mix(in srgb, {accent2} 26%, transparent), transparent 55%), var(--bg)"),
        "command":    ("radial-gradient(620px 420px at 50% -6%, "
                       f"color-mix(in srgb, {accent} 16%, transparent), transparent 60%), var(--bg)"),
        "editorial":  ("radial-gradient(120% 80% at 50% 0%, "
                       f"color-mix(in srgb, {accent} 7%, transparent), transparent 60%), var(--bg)"),
        "editorial-light": "var(--bg)",
    }
    body_bg = treatments.get(bg, treatments["subtle"])

    parts = [
        ":root {",
        f"  --font: {font};",
        f"  --radius-sm: calc({radius} - 4px); --radius: {radius};",
        f"  --radius-lg: calc({radius} + 6px); --radius-xl: calc({radius} + 16px);",
        "}",
        f"body {{ background: {body_bg}; }}",
        f".ds-section {{ padding: {sec_pad} 0; }}",
        f".ds-card {{ padding: {card_pad}; }}",
        f".ds-grid, .ds-bento {{ gap: {gap}; }}",
    ]

    # Mode-specific flourishes.
    if bg == "mono":
        # Vercel-style: tighten letter-spacing, square chrome, hairline borders.
        parts += [
            "body { letter-spacing: 0; }",
            ".ds-hero::after { opacity: .28; }",
            ".ds-btn-primary { color: #0a0a0a; }",
            ".ds-nav { backdrop-filter: blur(10px); }",
        ]
    if bg == "neon":
        parts += [
            ".ds-card { box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 22%, transparent); }",
            ".ds-nav-logo, .ds-icon { box-shadow: 0 0 18px color-mix(in srgb, var(--accent) 60%, transparent); }",
        ]
    if style.get("font") == "serif":
        parts += [
            "h1, h2, h3 { font-weight: 600; letter-spacing: -0.01em; }",
            ".ds-eyebrow { letter-spacing: .22em; }",
        ]
    if style.get("mode") == "light":
        # Calmer, flatter chrome for light/native modes (Apple/Notion feel).
        parts += [
            ".ds-hero::before { opacity: .5; }",
            ".ds-card { box-shadow: var(--shadow-sm); }",
        ]
    return "\n".join(parts)


__all__ = ["DESIGN_TOKENS", "design_system_css"]
