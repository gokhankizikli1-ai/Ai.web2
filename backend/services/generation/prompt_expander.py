# coding: utf-8
# EPIC 2 — Intelligent prompt expansion.
#
# Turns a one-line user prompt ("Build a fitness app") into a rich,
# context-aware ProductSpec. Deterministic + rule-based (no LLM, no
# network) so it's fast, free, testable, and produces DISTINCT premium
# specs per product type — which is what makes the six success-criteria
# prompts render as completely different interfaces.
#
# The expansion is INTERNAL — the user never sees it.

from __future__ import annotations

import re
from typing import Callable, Dict, List, Tuple

from backend.services.generation.spec import ProductSpec, Section


def _S(kind, title="", subtitle="", items=None) -> Section:
    return Section(kind=kind, title=title, subtitle=subtitle, items=items or [])


def _card(title, body, icon="●"):
    return {"title": title, "body": body, "icon": icon}


# ── Per-type spec builders ───────────────────────────────────────────

def _fitness() -> ProductSpec:
    return ProductSpec(
        product_type="fitness", name="Vital", tagline="Train smarter. Track everything.",
        description="Your personalised fitness companion — plan workouts, track calories and progress, and hit every goal with adaptive coaching.",
        audience="Health-conscious people who want a structured, data-driven training routine.",
        primary_goals=["Plan and follow workouts", "Track calories & nutrition", "Visualise progress over time"],
        ux_goals=["Glanceable daily dashboard", "Effortless logging", "Motivating progress feedback"],
        navigation=["Dashboard", "Workouts", "Nutrition", "Progress", "Profile"],
        is_dashboard=True,
        metrics=[
            {"label": "Calories today", "value": "1,840", "delta": "+12% vs goal"},
            {"label": "Workouts this week", "value": "4", "delta": "On track"},
            {"label": "BMI", "value": "22.4", "delta": "Healthy"},
            {"label": "Daily goal", "value": "78%", "delta": "+8% today"},
        ],
        sections=[
            _S("metrics", "Today at a glance"),
            _S("features", "Everything to reach your goals", items=[
                _card("Workout Planner", "Adaptive routines that scale with your strength.", "🏋"),
                _card("Calorie Tracker", "Log meals in seconds with smart suggestions.", "🍎"),
                _card("Progress Graphs", "See weight, volume and PRs trend up.", "📈"),
                _card("Achievements", "Streaks and badges that keep you coming back.", "🏆"),
            ]),
            _S("panel", "This week's plan", subtitle="Push · Pull · Legs · Conditioning"),
            _S("cta", "Ready to start your streak?"),
        ],
        cta_primary="Start training", cta_secondary="View workouts",
        theme={"accent": "#22c55e", "accent2": "#84cc16", "mode": "dark"},
        components=["Navbar", "Dashboard Cards", "Statistics", "Charts", "Feature Grid", "CTA", "Footer"],
    )


def _ai_chat() -> ProductSpec:
    return ProductSpec(
        product_type="ai_chat", name="Lumen", tagline="Think out loud. Ship faster.",
        description="A focused AI workspace — multi-model conversations, prompt history, and attachments in one clean interface.",
        audience="Builders and writers who live in an AI chat all day.",
        primary_goals=["Converse with multiple models", "Revisit prompt history", "Attach files & context"],
        ux_goals=["Distraction-free conversation", "Fast model switching", "Searchable history"],
        navigation=["Chats", "Models", "Library", "Settings"],
        is_dashboard=True,
        metrics=[],
        sections=[
            _S("panel", "Conversation", subtitle="Sidebar · thread · composer with attachments"),
            _S("features", "Built for serious thinking", items=[
                _card("Multi-model", "Switch between frontier models mid-thread.", "🧠"),
                _card("Prompt history", "Every conversation, instantly searchable.", "🕑"),
                _card("Attachments", "Drop in files, images and code.", "📎"),
                _card("Workspaces", "Keep projects and contexts separate.", "🗂"),
            ]),
            _S("cta", "Start a conversation"),
        ],
        cta_primary="New chat", cta_secondary="Browse models",
        theme={"accent": "#a855f7", "accent2": "#6366f1", "mode": "dark"},
        components=["Sidebar", "Conversation UI", "Search Bar", "Notifications", "Settings", "Footer"],
    )


def _banking() -> ProductSpec:
    return ProductSpec(
        product_type="banking", name="Northbank", tagline="Your money, beautifully clear.",
        description="A modern banking dashboard — balances, transactions, investments and insights in one calm view.",
        audience="People who want a clear, trustworthy view of their finances.",
        primary_goals=["See balances at a glance", "Review transactions", "Track investments"],
        ux_goals=["Trust through clarity", "Fast scanning", "Confident actions"],
        navigation=["Overview", "Accounts", "Transactions", "Investments", "Cards"],
        is_dashboard=True,
        metrics=[
            {"label": "Total balance", "value": "$48,920", "delta": "+2.4% this month"},
            {"label": "Income", "value": "$8,400", "delta": "+5% MoM"},
            {"label": "Spending", "value": "$3,210", "delta": "-8% MoM"},
            {"label": "Portfolio", "value": "$132k", "delta": "+11.2% YTD"},
        ],
        sections=[
            _S("metrics", "Overview"),
            _S("panel", "Recent transactions", subtitle="Merchant · category · amount"),
            _S("features", "Tools that keep you ahead", items=[
                _card("Smart insights", "Spending patterns surfaced automatically.", "📊"),
                _card("Investments", "Track holdings and performance.", "📈"),
                _card("Balance cards", "Every account, one tap away.", "💳"),
                _card("Goals", "Save toward what matters.", "🎯"),
            ]),
        ],
        cta_primary="Open account", cta_secondary="See investments",
        theme={"accent": "#3b82f6", "accent2": "#06b6d4", "mode": "dark"},
        components=["Sidebar", "Dashboard Cards", "Statistics", "Charts", "Notifications", "Footer"],
    )


def _crypto() -> ProductSpec:
    return ProductSpec(
        product_type="crypto", name="Ledgerly", tagline="Every coin. One portfolio.",
        description="Track your crypto portfolio in real time — allocations, P&L, and market moves at a glance.",
        audience="Active crypto investors tracking a multi-asset portfolio.",
        primary_goals=["Track portfolio value", "Monitor allocations & P&L", "Watch market moves"],
        ux_goals=["Real-time clarity", "Risk at a glance", "Fast asset drill-down"],
        navigation=["Portfolio", "Markets", "Assets", "Alerts"],
        is_dashboard=True,
        metrics=[
            {"label": "Portfolio value", "value": "$84,210", "delta": "+6.8% 24h"},
            {"label": "24h P&L", "value": "+$5,360", "delta": "+6.8%"},
            {"label": "Best performer", "value": "SOL", "delta": "+14.2%"},
            {"label": "Assets", "value": "12", "delta": "3 chains"},
        ],
        sections=[
            _S("metrics", "Portfolio"),
            _S("panel", "Holdings", subtitle="Asset · allocation · 24h · value"),
            _S("features", "Stay on top of the market", items=[
                _card("Allocation", "See your mix across assets and chains.", "🪙"),
                _card("Live charts", "Candles and trends, updated live.", "📉"),
                _card("Price alerts", "Get notified on the moves that matter.", "🔔"),
                _card("P&L", "Realised and unrealised, clearly split.", "💹"),
            ]),
        ],
        cta_primary="Connect wallet", cta_secondary="View markets",
        theme={"accent": "#f59e0b", "accent2": "#f97316", "mode": "dark"},
        components=["Sidebar", "Dashboard Cards", "Statistics", "Charts", "Notifications", "Footer"],
    )


def _restaurant() -> ProductSpec:
    return ProductSpec(
        product_type="restaurant", name="Olive & Ember", tagline="Fire-cooked, seasonally sourced.",
        description="A neighbourhood kitchen serving wood-fired plates and natural wine. Book a table and explore the menu.",
        audience="Diners looking for a warm, design-forward restaurant experience.",
        primary_goals=["Showcase the menu", "Take reservations", "Tell the story"],
        ux_goals=["Appetising first impression", "Effortless booking", "Mobile-friendly menu"],
        navigation=["Menu", "Reservations", "Gallery", "Contact"],
        is_dashboard=False,
        metrics=[],
        sections=[
            _S("features", "On the menu", items=[
                _card("Wood-fired mains", "Seasonal plates from the open hearth.", "🔥"),
                _card("Small plates", "Made for sharing, built for the table.", "🍽"),
                _card("Natural wine", "A short, thoughtful, low-intervention list.", "🍷"),
                _card("Desserts", "House-made, just sweet enough.", "🍮"),
            ]),
            _S("gallery", "From the kitchen"),
            _S("panel", "Reserve a table", subtitle="Date · time · party size"),
            _S("cta", "Join us this week"),
        ],
        cta_primary="Reserve a table", cta_secondary="View menu",
        theme={"accent": "#ef4444", "accent2": "#f59e0b", "mode": "dark"},
        components=["Navbar", "Hero", "Feature Grid", "Gallery", "Forms", "Footer"],
    )


def _saas() -> ProductSpec:
    return ProductSpec(
        product_type="saas", name="Cadence", tagline="Ship work that moves in sync.",
        description="The project OS for fast teams — plans, automations and insights that keep everyone in cadence.",
        audience="Modern product and engineering teams.",
        primary_goals=["Communicate the value", "Show pricing", "Convert to signup"],
        ux_goals=["Crisp value prop", "Credible social proof", "Frictionless CTA"],
        navigation=["Product", "Features", "Pricing", "Customers", "Docs"],
        is_dashboard=False,
        metrics=[],
        sections=[
            _S("features", "Everything your team needs", items=[
                _card("Plans & roadmaps", "Plan in views your team actually uses.", "🗺"),
                _card("Automations", "Kill busywork with one-click rules.", "⚡"),
                _card("Insights", "Real-time velocity and health metrics.", "📊"),
                _card("Integrations", "Connect the tools you already love.", "🔌"),
            ]),
            _S("pricing", "Simple, scalable pricing", items=[
                {"title": "Starter", "body": "$0", "icon": "Free for small teams"},
                {"title": "Pro", "body": "$12", "icon": "per user / month"},
                {"title": "Scale", "body": "Custom", "icon": "for large orgs"},
            ]),
            _S("testimonials", "Loved by teams that ship", items=[
                _card("“Cadence replaced three tools for us.”", "Maya R., Head of Product", "★"),
                _card("“Our velocity is up 40% since switching.”", "Daniel K., Eng Lead", "★"),
            ]),
            _S("faq", "Frequently asked", items=[
                _card("Is there a free plan?", "Yes — Starter is free forever for small teams."),
                _card("Can I self-host?", "Scale customers can deploy in their own cloud."),
                _card("Do you offer migrations?", "We import from Jira, Linear and Asana."),
            ]),
            _S("cta", "Start shipping in cadence"),
        ],
        cta_primary="Start free", cta_secondary="Book a demo",
        theme={"accent": "#6366f1", "accent2": "#22d3ee", "mode": "dark"},
        components=["Navbar", "Hero", "Feature Grid", "Pricing Tables", "Testimonials", "FAQ", "CTA", "Footer"],
    )


def _generic(user_request: str, ptype: str = "app") -> ProductSpec:
    name = _title_from_request(user_request)
    is_dash = ptype == "dashboard"
    return ProductSpec(
        product_type=ptype, name=name,
        tagline="Built for what you do best.",
        description=f"A polished, responsive product crafted around: {user_request.strip()[:140]}.",
        audience="People who expect a fast, modern, well-designed product.",
        primary_goals=["Deliver the core experience", "Make it effortless", "Look credible"],
        ux_goals=["Clarity", "Speed", "Delight"],
        navigation=["Overview", "Features", "Pricing", "About"] if not is_dash
                   else ["Dashboard", "Activity", "Reports", "Settings"],
        is_dashboard=is_dash,
        metrics=[
            {"label": "Active users", "value": "12.4k", "delta": "+9% MoM"},
            {"label": "Engagement", "value": "87%", "delta": "+4%"},
            {"label": "Sessions", "value": "48k", "delta": "+12%"},
            {"label": "Health", "value": "Good", "delta": "Stable"},
        ] if is_dash else [],
        sections=([_S("metrics", "Overview")] if is_dash else []) + [
            _S("features", "What makes it great", items=[
                _card("Thoughtful design", "Every detail considered.", "✨"),
                _card("Fast by default", "Instant, responsive, smooth.", "⚡"),
                _card("Works everywhere", "Beautiful on every screen.", "📱"),
                _card("Built to scale", "Ready for what's next.", "🚀"),
            ]),
            _S("cta", "Get started today"),
        ],
        cta_primary="Get started", cta_secondary="Learn more",
        theme={"accent": "#6366f1", "accent2": "#22d3ee", "mode": "dark"},
        components=["Navbar", "Hero", "Feature Grid", "CTA", "Footer"]
                   + (["Dashboard Cards", "Statistics"] if is_dash else []),
    )


def _title_from_request(user_request: str) -> str:
    t = re.sub(r"^\s*(build|create|make|design|generate|develop)\s+(me\s+)?(a|an|the)?\s*",
               "", (user_request or "").strip(), flags=re.IGNORECASE)
    t = re.sub(r"\b(app|application|website|site|dashboard|landing\s*page|page)\b.*$", "", t,
               flags=re.IGNORECASE).strip(" .-")
    words = [w for w in re.split(r"\s+", t) if w][:3]
    return (" ".join(w.capitalize() for w in words) or "Northwind") + ""


# ── Classifier ────────────────────────────────────────────────────────

_RULES: List[Tuple[re.Pattern, Callable[[], ProductSpec]]] = [
    (re.compile(r"\b(fitness|workout|gym|exercise|health\s*app|calorie|nutrition)\b", re.I), _fitness),
    (re.compile(r"\b(ai\s*chat|chatbot|chat\s*app|assistant|llm|conversation)\b", re.I), _ai_chat),
    (re.compile(r"\b(crypto|portfolio|coin|token|web3|defi|wallet)\b", re.I), _crypto),
    (re.compile(r"\b(bank|banking|finance|fintech|account|transactions?)\b", re.I), _banking),
    (re.compile(r"\b(restaurant|cafe|café|menu|dining|food\s*(?:place|website)|bistro|kitchen)\b", re.I), _restaurant),
    (re.compile(r"\b(saas|landing\s*page|marketing\s*site|startup\s*(?:site|landing)|product\s*page)\b", re.I), _saas),
]


def expand(user_request: str) -> ProductSpec:
    """Expand a one-line prompt into a context-aware ProductSpec. Never
    raises; falls back to a generic (app or dashboard) spec."""
    text = user_request or ""
    for pattern, builder in _RULES:
        if pattern.search(text):
            return builder()
    if re.search(r"\bdashboard\b", text, re.I):
        return _generic(text, "dashboard")
    if re.search(r"\b(landing|website|site|web\s*page)\b", text, re.I):
        return _saas()  # a bare "website" → premium SaaS-style marketing page
    return _generic(text, "app")


__all__ = ["expand"]
