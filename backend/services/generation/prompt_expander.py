# coding: utf-8
# EPIC 2 / CRITICAL FIX — Intelligent prompt expansion.
#
# Turns a one-line user prompt ("Build an Apple Notes style app") into a
# rich, context-aware ProductSpec. Deterministic + rule-based (no LLM, no
# network) so it's fast, free, testable, and produces DISTINCT premium
# specs per product type.
#
# CRITICAL FIX: expansion now runs through the Product Intent Classifier
# first. The classifier decides the INTERFACE LAYOUT (app / editor /
# ecommerce / booking / landing / portfolio) and the capability flags, so
# an "app" request renders the ACTUAL PRODUCT UI — not a marketing landing
# page (the root-cause regression). A Design Diversity style mode is then
# resolved so different prompts produce visually different products.
#
# The expansion is INTERNAL — the user never sees it.

from __future__ import annotations

import re
from typing import Callable, Dict, List, Tuple

from backend.services.generation.intent import ProductIntent, classify
from backend.services.generation.spec import ProductSpec, Section
from backend.services.generation.styles import resolve_style


def _S(kind, title="", subtitle="", items=None) -> Section:
    return Section(kind=kind, title=title, subtitle=subtitle, items=items or [])


def _card(title, body, icon="●"):
    return {"title": title, "body": body, "icon": icon}


# ── Known-vertical spec builders (the six showcase products) ──────────

def _fitness() -> ProductSpec:
    return ProductSpec(
        product_type="fitness", name="Vital", tagline="Train smarter. Track everything.",
        description="Your personalised fitness companion — plan workouts, track calories and progress, and hit every goal with adaptive coaching.",
        audience="Health-conscious people who want a structured, data-driven training routine.",
        primary_goals=["Plan and follow workouts", "Track calories & nutrition", "Visualise progress over time"],
        ux_goals=["Glanceable daily dashboard", "Effortless logging", "Motivating progress feedback"],
        navigation=["Dashboard", "Workouts", "Nutrition", "Progress", "Profile"],
        is_dashboard=True, layout="app", intent="application_ui",
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
        is_dashboard=True, layout="app", intent="ai_tool",
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
        is_dashboard=True, layout="app", intent="finance_tool",
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
        is_dashboard=True, layout="app", intent="finance_tool",
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
        is_dashboard=False, layout="landing", intent="website",
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
        is_dashboard=False, layout="landing", intent="landing_page",
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


# ── NEW layout-specific builders (the critical-fix additions) ─────────

def _notes(user_request: str, style: Dict) -> ProductSpec:
    """A real note-taking / editor application (sidebar + list + editor),
    NOT a marketing page. The headline regression: "Apple Notes style app"."""
    name = _title_from_request(user_request) or "Notes"
    folders = [
        {"name": "All Notes", "key": "all", "count": 6},
        {"name": "Personal", "key": "personal", "count": 2},
        {"name": "Work", "key": "work", "count": 2},
        {"name": "Ideas", "key": "ideas", "count": 1},
        {"name": "Archive", "key": "archive", "count": 1},
    ]
    notes = [
        {"title": "Welcome to your notes", "folder": "personal",
         "snippet": "Everything in one calm, fast place. Pin what matters.",
         "body": "Everything in one calm, fast place.\n\nUse folders on the left to organise, search to find anything instantly, and ⌘N to start a new note. Your writing autosaves as you go."},
        {"title": "Q3 product roadmap", "folder": "work",
         "snippet": "Editor polish, sync, offline mode, sharing.",
         "body": "Q3 roadmap\n\n1. Editor polish — typography, slash commands.\n2. Real-time sync across devices.\n3. Offline mode with conflict resolution.\n4. Shareable note links."},
        {"title": "Reading list", "folder": "personal",
         "snippet": "Books and essays to get through this season.",
         "body": "Reading list\n\n• Thinking in Systems\n• The Timeless Way of Building\n• A handful of essays on craft and focus."},
        {"title": "Meeting — design sync", "folder": "work",
         "snippet": "Decisions, owners and next steps from today.",
         "body": "Design sync\n\nDecisions:\n- Ship the three-pane layout.\n- Keep the command palette.\n\nNext steps:\n- Spec the sharing flow.\n- Prototype the search filter."},
        {"title": "App idea — quiet focus", "folder": "ideas",
         "snippet": "A note app that disappears while you write.",
         "body": "Quiet focus\n\nA note app that gets out of the way: no chrome, instant search, native feel, keyboard-first. Everything one keystroke away."},
        {"title": "Old draft", "folder": "archive",
         "snippet": "Kept for reference. Archived last month.",
         "body": "Archived draft\n\nKept for reference. Nothing to do here."},
    ]
    return ProductSpec(
        product_type="notes", name=name, tagline="Every thought, instantly at hand.",
        description="A fast, focused note-taking app — folders, instant search and a distraction-free editor. Capture, organise and find anything.",
        audience="People who want a quiet, keyboard-first place to think and write.",
        primary_goals=["Capture notes instantly", "Organise with folders", "Find anything by search"],
        ux_goals=["Distraction-free writing", "Instant search", "Native, calm feel"],
        navigation=["All Notes", "Search", "New Note", "Settings"],
        is_dashboard=False, layout="editor", intent="application_ui",
        metrics=[],
        sections=[
            _S("features", "Built for focus", items=[
                _card("Folders", "Organise notes the way your mind works.", "🗂"),
                _card("Instant search", "Find any note as fast as you can type.", "🔎"),
                _card("Clean editor", "Just you and the words. Autosaves always.", "✍"),
                _card("Sync", "Your notes, on every device.", "☁"),
            ]),
        ],
        cta_primary="New Note", cta_secondary="Search",
        theme={"accent": "", "accent2": "", "mode": style.get("mode", "light")},
        components=["Sidebar", "Search Bar", "Editor", "List View", "Settings", "Toolbar"],
        data={"folders": folders, "notes": notes},
    )


def _ecommerce(user_request: str, style: Dict) -> ProductSpec:
    name = _title_from_request(user_request) or "Atelier"
    categories = [
        {"name": "All", "key": "all"}, {"name": "Footwear", "key": "footwear"},
        {"name": "Outerwear", "key": "outerwear"}, {"name": "Accessories", "key": "accessories"},
    ]
    products = [
        {"name": "Runner Low", "price": "$148", "category": "footwear", "blurb": "Everyday sneaker in recycled knit."},
        {"name": "Trail Boot", "price": "$220", "category": "footwear", "blurb": "All-weather boot, grippy sole."},
        {"name": "Shell Jacket", "price": "$320", "category": "outerwear", "blurb": "Three-layer waterproof shell."},
        {"name": "Wool Overcoat", "price": "$410", "category": "outerwear", "blurb": "Tailored Italian wool."},
        {"name": "Leather Tote", "price": "$180", "category": "accessories", "blurb": "Full-grain, ages beautifully."},
        {"name": "Knit Beanie", "price": "$42", "category": "accessories", "blurb": "Merino, double-layered."},
    ]
    return ProductSpec(
        product_type="ecommerce", name=name, tagline="Considered goods, made to last.",
        description="A modern storefront — browse the collection, filter by category, view product details and check out in a calm, editorial shopping experience.",
        audience="Shoppers who value design, durability and a frictionless checkout.",
        primary_goals=["Browse the collection", "Add to cart", "Check out smoothly"],
        ux_goals=["Editorial product presentation", "Fast filtering", "Confident checkout"],
        navigation=["Shop", "Collections", "About", "Cart"],
        is_dashboard=False, layout="ecommerce", intent="ecommerce",
        metrics=[],
        sections=[
            _S("features", "Why shop with us", items=[
                _card("Free shipping", "On every order over $75.", "🚚"),
                _card("30-day returns", "No questions, no fuss.", "↩"),
                _card("Made to last", "Materials chosen to age well.", "♻"),
            ]),
        ],
        cta_primary="Shop the collection", cta_secondary="View cart",
        theme={"accent": "", "accent2": "", "mode": style.get("mode", "light")},
        components=["Navbar", "Product Cards", "Filters", "Cart", "Checkout", "Footer"],
        data={"categories": categories, "products": products},
    )


def _booking(user_request: str, style: Dict) -> ProductSpec:
    name = _title_from_request(user_request) or "Wander"
    rooms = [
        {"name": "Garden Studio", "price": "$180", "per": "night", "blurb": "Cosy studio opening onto the courtyard.", "features": ["1 bed", "Garden view", "28 m²"]},
        {"name": "Deluxe King", "price": "$240", "per": "night", "blurb": "Spacious king room with city views.", "features": ["King bed", "City view", "40 m²"]},
        {"name": "Loft Suite", "price": "$380", "per": "night", "blurb": "Two-floor suite with a private terrace.", "features": ["King + sofa", "Terrace", "72 m²"]},
    ]
    return ProductSpec(
        product_type="booking", name=name, tagline="Stay somewhere you'll remember.",
        description="A booking experience — choose your dates, pick a room, see a live summary and reserve. Calm, clear and fast.",
        audience="Travellers who want a beautiful, low-friction way to book a stay.",
        primary_goals=["Choose dates", "Select a room", "Confirm the booking"],
        ux_goals=["Clear availability", "Confident selection", "Transparent pricing"],
        navigation=["Rooms", "Amenities", "Location", "Book"],
        is_dashboard=False, layout="booking", intent="booking",
        metrics=[],
        sections=[
            _S("features", "What's included", items=[
                _card("Breakfast", "House-made, served till 11.", "🥐"),
                _card("Fast Wi-Fi", "Work-friendly, everywhere.", "📶"),
                _card("Late checkout", "Subject to availability.", "🕛"),
            ]),
        ],
        cta_primary="Book your stay", cta_secondary="See rooms",
        theme={"accent": "", "accent2": "", "mode": style.get("mode", "light")},
        components=["Navbar", "Room Cards", "Date Picker", "Booking Summary", "Footer"],
        data={"rooms": rooms},
    )


def _portfolio(user_request: str, style: Dict) -> ProductSpec:
    name = _title_from_request(user_request) or "Studio"
    projects = [
        _card("Northwind", "Brand & product design for a logistics startup.", "◆"),
        _card("Mercura", "Design system and marketing site.", "◇"),
        _card("Cobalt", "Mobile app UI for a fintech.", "◈"),
        _card("Lumio", "Identity and packaging for a lighting brand.", "❖"),
    ]
    return ProductSpec(
        product_type="portfolio", name=name, tagline="Design that earns attention.",
        description="A portfolio — selected work, a short story, and a clear way to get in touch.",
        audience="Clients and collaborators evaluating recent work.",
        primary_goals=["Showcase selected work", "Tell the story", "Make contact easy"],
        ux_goals=["Striking first impression", "Easy browsing", "Clear contact"],
        navigation=["Work", "About", "Contact"],
        is_dashboard=False, layout="portfolio", intent="portfolio",
        metrics=[],
        sections=[
            _S("gallery", "Selected work", items=projects),
            _S("features", "What I do", items=[
                _card("Product design", "End-to-end, research to ship.", "✶"),
                _card("Brand", "Identity that scales.", "✦"),
                _card("Design systems", "Consistent, fast, documented.", "✧"),
            ]),
            _S("cta", "Have a project in mind?"),
        ],
        cta_primary="Get in touch", cta_secondary="View work",
        theme={"accent": "", "accent2": "", "mode": style.get("mode", "dark")},
        components=["Navbar", "Hero", "Gallery", "Feature Grid", "CTA", "Footer"],
    )


def _website(user_request: str, style: Dict) -> ProductSpec:
    name = _title_from_request(user_request) or "Northwind"
    return ProductSpec(
        product_type="website", name=name, tagline="A clearer way forward.",
        description=f"{name} — a polished, responsive site that explains the offering clearly and earns trust fast.",
        audience="Visitors who need to understand the offering quickly and trust it.",
        primary_goals=["Communicate clearly", "Build trust", "Drive the next step"],
        ux_goals=["Strong first impression", "Skimmable content", "Clear call to action"],
        navigation=["Home", "Features", "About", "Contact"],
        is_dashboard=False, layout="landing", intent="website",
        metrics=[],
        sections=[
            _S("features", "What we offer", items=[
                _card("Thoughtful craft", "Every detail considered.", "✨"),
                _card("Fast by default", "Instant, responsive, smooth.", "⚡"),
                _card("Built to scale", "Ready for what's next.", "🚀"),
                _card("Always on", "Reliable, everywhere.", "🛡"),
            ]),
            _S("gallery", "A closer look"),
            _S("cta", "Ready to get started?"),
        ],
        cta_primary="Get started", cta_secondary="Learn more",
        theme={"accent": "", "accent2": "", "mode": style.get("mode", "dark")},
        components=["Navbar", "Hero", "Feature Grid", "Gallery", "CTA", "Footer"],
    )


def _generic_app(user_request: str, style: Dict, intent: str = "application_ui") -> ProductSpec:
    """A REAL application interface for an otherwise-unmatched app request.
    This is the root-cause fix: ambiguous requests no longer become a
    marketing landing page."""
    name = _title_from_request(user_request) or "Workspace"
    return ProductSpec(
        product_type="app", name=name, tagline=f"{name}, built for what you do.",
        description=f"{name} is a focused, responsive workspace that keeps your day in one fast, well-designed place.",
        audience="People who expect a fast, modern, well-designed product.",
        primary_goals=["Deliver the core workflow", "Make it effortless", "Keep everything in view"],
        ux_goals=["Clarity", "Speed", "Focus"],
        navigation=["Dashboard", "Activity", "Library", "Reports", "Settings"],
        is_dashboard=True, layout="app", intent=intent,
        metrics=[
            {"label": "Active items", "value": "1,248", "delta": "+9% this week"},
            {"label": "Completed", "value": "87%", "delta": "+4%"},
            {"label": "In progress", "value": "23", "delta": "On track"},
            {"label": "This month", "value": "4.8k", "delta": "+12%"},
        ],
        sections=[
            _S("metrics", "Overview"),
            _S("features", "Everything in one place", items=[
                _card("Fast capture", "Add anything in a keystroke.", "⚡"),
                _card("Smart views", "See your work the way you think.", "🧭"),
                _card("Activity", "A clear record of what changed.", "🕑"),
                _card("Settings", "Make it yours.", "⚙"),
            ]),
            _S("panel", "Today", subtitle="What needs your attention"),
        ],
        cta_primary="Quick add", cta_secondary="View activity",
        theme={"accent": "", "accent2": "", "mode": style.get("mode", "dark")},
        components=["Sidebar", "Dashboard Cards", "Statistics", "Charts", "Activity Feed", "Settings", "Footer"],
    )


def _generic_dashboard(user_request: str, style: Dict, intent: str = "dashboard") -> ProductSpec:
    spec = _generic_app(user_request, style, intent=intent)
    spec.product_type = "dashboard"
    spec.tagline = f"{spec.name} — everything at a glance."
    spec.navigation = ["Overview", "Analytics", "Reports", "Activity", "Settings"]
    return spec


def _title_from_request(user_request: str) -> str:
    t = re.sub(r"^\s*(build|create|make|design|generate|develop)\s+(me\s+)?(a|an|the)?\s*",
               "", (user_request or "").strip(), flags=re.IGNORECASE)
    t = re.sub(r"\b(style|like|inspired\s*by)\b.*$", "", t, flags=re.IGNORECASE)
    t = re.sub(r"\b(app|application|website|site|dashboard|landing\s*page|page|tool|"
               r"platform|software|store|shop)\b.*$", "", t, flags=re.IGNORECASE).strip(" .-")
    words = [w for w in re.split(r"\s+", t) if w][:3]
    return " ".join(w.capitalize() for w in words)


# ── Known-vertical keyword rules (preset products win first) ──────────

_VERTICAL_RULES: List[Tuple[re.Pattern, Callable[[], ProductSpec]]] = [
    (re.compile(r"\b(fitness|workout|gym|exercise|calorie|nutrition)\b", re.I), _fitness),
    (re.compile(r"\b(ai\s*chat|chatbot|chat\s*app|llm)\b", re.I), _ai_chat),
    (re.compile(r"\b(crypto|coin|token|web3|defi|wallet)\b", re.I), _crypto),
    (re.compile(r"\b(bank|banking|fintech)\b", re.I), _banking),
    (re.compile(r"\b(restaurant|cafe|café|bistro|kitchen|dining)\b", re.I), _restaurant),
    (re.compile(r"\b(saas|startup\s*(?:site|landing)|product\s*page)\b", re.I), _saas),
]


def _route(text: str, intent: ProductIntent, style: Dict) -> ProductSpec:
    """Pick the spec builder. Known verticals win; otherwise route by the
    classified interface layout — defaulting to a real application UI."""
    for pattern, builder in _VERTICAL_RULES:
        if pattern.search(text):
            return builder()
    layout = intent.layout
    if layout == "editor":     return _notes(text, style)
    if layout == "ecommerce":  return _ecommerce(text, style)
    if layout == "booking":    return _booking(text, style)
    if layout == "portfolio":  return _portfolio(text, style)
    if layout == "landing":    return _website(text, style)
    if intent.intent in ("dashboard", "admin_panel", "finance_tool"):
        return _generic_dashboard(text, style, intent=intent.intent)
    return _generic_app(text, style, intent=intent.intent)   # real app interface


def expand(user_request: str) -> ProductSpec:
    """Expand a one-line prompt into a context-aware ProductSpec. Never
    raises. Runs intent classification → style resolution → layout-specific
    spec, so an app request renders the actual product (not a landing)."""
    text = user_request or ""
    intent = classify(text)
    style = resolve_style(intent.style_mode)
    spec = _route(text, intent, style)

    # Attach product-intent + Design-Diversity metadata. Presets own their
    # product copy + brand accent; the classifier owns intent/capabilities;
    # the style mode owns the visual language (mode/font/radius/density/bg).
    spec.style = style
    spec.intent = spec.intent or intent.intent
    spec.capabilities = spec.capabilities or dict(intent.capabilities)
    spec.dark_mode = style.get("mode", "dark") != "light"
    theme = dict(spec.theme or {})
    theme["mode"] = style.get("mode", "dark")
    if not theme.get("accent"):
        theme["accent"] = style.get("accent", "#6366f1")
    if not theme.get("accent2"):
        theme["accent2"] = style.get("accent2", "#22d3ee")
    spec.theme = theme
    return spec


__all__ = ["expand"]
