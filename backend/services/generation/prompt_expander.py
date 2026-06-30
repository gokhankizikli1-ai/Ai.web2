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
from typing import Any, Callable, Dict, List, Optional, Tuple

from backend.services.generation.intent import ProductIntent, classify
from backend.services.generation.renderer_selector import select_renderer
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


# ── Sprint 1.9 — mobile-native vertical presets ────────────────────────
# These three use the new `mobile` layout (phone-width shell + bottom tab
# bar) instead of the sidebar dashboard shell — genuinely mobile-native
# product categories (personal wellness, media playback, recipes) that
# previously fell into the generic SaaS-dashboard fallback regardless of
# how little a sidebar suits them.

def _habit_tracker() -> ProductSpec:
    return ProductSpec(
        product_type="wellness", name="Calm Streak", tagline="Small habits. Real momentum.",
        description="A focused habit and mindfulness tracker — build streaks, log how you feel, and see your consistency add up.",
        audience="People building consistent habits who want gentle, motivating daily check-ins.",
        primary_goals=["Build daily streaks", "Track mood & mindfulness minutes", "See consistency over time"],
        ux_goals=["Glanceable streak", "One-tap logging", "Calm, non-judgmental tone"],
        navigation=["Today", "Habits", "Insights", "Profile"],
        is_dashboard=True, layout="mobile", intent="application_ui",
        metrics=[
            {"label": "Current streak", "value": "12 days", "delta": "Personal best"},
            {"label": "Mindful minutes", "value": "140", "delta": "+18 this week"},
            {"label": "Mood avg", "value": "78%", "delta": "+5% this week"},
            {"label": "Habits on track", "value": "5/6", "delta": "83%"},
        ],
        sections=[
            _S("panel", "Today's habits", subtitle="Morning meditation · Hydration · Wind-down"),
            _S("features", "Built to keep you consistent", items=[
                _card("Streaks", "Visual streaks that make consistency satisfying.", "🔥"),
                _card("Mood log", "A ten-second daily check-in.", "🌤"),
                _card("Mindful timer", "Guided sessions, no account needed.", "🧘"),
                _card("Insights", "See which habits actually stick.", "📈"),
            ]),
        ],
        cta_primary="Log today", cta_secondary="Start session",
        theme={"accent": "#14b8a6", "accent2": "#a855f7", "mode": "dark"},
        components=["Sidebar", "Dashboard Cards", "Statistics", "Notifications", "Settings", "Footer"],
    )


def _music_player() -> ProductSpec:
    return ProductSpec(
        product_type="media", name="Reverb", tagline="Your sound, everywhere.",
        description="A focused music player — pick up where you left off, browse your library, and queue up what's next.",
        audience="Listeners who want a fast, clean way to play and organise their music.",
        primary_goals=["Resume playback instantly", "Browse library & playlists", "Queue up what's next"],
        ux_goals=["One-tap resume", "Fast browsing", "Distraction-free now-playing"],
        navigation=["Library", "Discover", "Playlists", "Profile"],
        is_dashboard=True, layout="mobile", intent="application_ui",
        metrics=[
            {"label": "Listened this week", "value": "18h 40m", "delta": "+3h vs last week"},
            {"label": "Top genre", "value": "Indie Pop", "delta": "42% of plays"},
            {"label": "Playlists", "value": "23", "delta": "3 new"},
            {"label": "Downloaded", "value": "9.2 GB", "delta": "offline ready"},
        ],
        sections=[
            _S("panel", "Up next", subtitle="Queued from your Evening Wind-down playlist"),
            _S("features", "Built for listening", items=[
                _card("Smart queue", "Keeps the vibe going automatically.", "▶"),
                _card("Offline mode", "Download playlists for anywhere.", "⬇"),
                _card("Lyrics sync", "Follow along, line by line.", "🎤"),
                _card("Crossfade", "Seamless transitions between tracks.", "🔊"),
            ]),
        ],
        cta_primary="Resume playback", cta_secondary="Shuffle library",
        theme={"accent": "#a855f7", "accent2": "#ec4899", "mode": "dark"},
        components=["Sidebar", "Dashboard Cards", "Statistics", "Notifications", "Settings", "Footer"],
    )


def _recipe_app() -> ProductSpec:
    return ProductSpec(
        product_type="food", name="Thyme", tagline="Cook something good tonight.",
        description="A recipe companion — save what you love, plan the week, and follow along with clear, step-by-step cooking.",
        audience="Home cooks who want fast meal ideas and a tidy place to save recipes.",
        primary_goals=["Find a recipe fast", "Save favourites", "Plan the week's meals"],
        ux_goals=["Appetising browsing", "One-tap save", "Clear step-by-step cooking"],
        navigation=["Today", "Recipes", "Saved", "Profile"],
        is_dashboard=True, layout="mobile", intent="application_ui",
        metrics=[
            {"label": "Cooked this week", "value": "4", "delta": "+1 vs last week"},
            {"label": "Saved recipes", "value": "62", "delta": "8 new"},
            {"label": "Avg prep time", "value": "28 min", "delta": "Weeknight friendly"},
            {"label": "Meal plan", "value": "5/7 days", "delta": "2 to fill"},
        ],
        sections=[
            _S("panel", "Tonight's pick", subtitle="Lemon herb chicken · 30 min · Easy"),
            _S("features", "Built for weeknight cooking", items=[
                _card("Smart search", "Find recipes by what's in your fridge.", "🔎"),
                _card("Step-by-step", "Clear instructions, no scrolling back.", "📋"),
                _card("Meal planner", "Drag recipes onto your week.", "🗓"),
                _card("Shopping list", "Auto-built from your plan.", "🛒"),
            ]),
        ],
        cta_primary="Start cooking", cta_secondary="Browse recipes",
        theme={"accent": "#f59e0b", "accent2": "#ef4444", "mode": "dark"},
        components=["Sidebar", "Dashboard Cards", "Statistics", "Notifications", "Settings", "Footer"],
    )


# ── NEW layout-specific builders (the critical-fix additions) ─────────

def _notes(user_request: str, style: Dict) -> ProductSpec:
    """A real note-taking / editor application (sidebar + list + editor),
    NOT a marketing page. The headline regression: "Apple Notes style app"."""
    name = _title_from_request(user_request) or "Notes"
    folders = [
        {"name": "All Notes", "key": "all", "count": 6, "icon": "🗒"},
        {"name": "Personal", "key": "personal", "count": 2, "icon": "👤"},
        {"name": "Work", "key": "work", "count": 2, "icon": "💼"},
        {"name": "Ideas", "key": "ideas", "count": 1, "icon": "💡"},
        {"name": "Archive", "key": "archive", "count": 1, "icon": "🗄"},
    ]
    tags = ["Important", "Follow-up", "Reading", "Draft"]
    notes = [
        {"title": "Welcome to your notes", "folder": "personal", "date": "Today, 9:14 AM", "time": "9:14 AM",
         "snippet": "Everything in one calm, fast place. Pin what matters.",
         "body": "Everything in one calm, fast place.\n\nUse the folders on the left to organise, the search field to find anything instantly, and the New Note button (⌘N) to start writing. Your notes autosave as you type.\n\nTry it:\n• Click a note to open it here\n• Switch folders to filter the list\n• Search to narrow things down"},
        {"title": "Q3 product roadmap", "folder": "work", "date": "Yesterday, 4:32 PM", "time": "Yesterday",
         "snippet": "Editor polish, sync, offline mode, sharing.",
         "body": "Q3 roadmap\n\n1. Editor polish — typography, slash commands, checklists.\n2. Real-time sync across every device.\n3. Offline mode with conflict resolution.\n4. Shareable note links with permissions.\n\nOwner: Maya · Review: end of month."},
        {"title": "Reading list", "folder": "personal", "date": "Mon, 8:02 AM", "time": "Mon",
         "snippet": "Books and essays to get through this season.",
         "body": "Reading list\n\n• Thinking in Systems — Donella Meadows\n• The Timeless Way of Building — Christopher Alexander\n• A handful of essays on craft, focus and taste.\n\nStarted: The Timeless Way of Building."},
        {"title": "Meeting — design sync", "folder": "work", "date": "Mon, 11:20 AM", "time": "Mon",
         "snippet": "Decisions, owners and next steps from today.",
         "body": "Design sync\n\nDecisions\n- Ship the three-pane layout.\n- Keep the command palette.\n- Native feel over web chrome.\n\nNext steps\n- Spec the sharing flow (Daniel)\n- Prototype the search filter (Ana)"},
        {"title": "App idea — quiet focus", "folder": "ideas", "date": "Sun, 7:48 PM", "time": "Sun",
         "snippet": "A note app that disappears while you write.",
         "body": "Quiet focus\n\nA note app that gets out of the way: no chrome, instant search, native feel, keyboard-first. Everything one keystroke away.\n\nThe goal: open, write, done."},
        {"title": "Trip planning", "folder": "archive", "date": "Last week", "time": "Last week",
         "snippet": "Lisbon itinerary — kept for reference.",
         "body": "Lisbon\n\nDay 1 — Alfama, viewpoints, late dinner.\nDay 2 — Belém, pastéis, river walk.\nDay 3 — day trip to Sintra.\n\nArchived for next time."},
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
        data={"folders": folders, "notes": notes, "tags": tags},
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
    t = re.sub(r"^\s*(build|create|make|design|generate|develop)\s+(me\s+)?(?:an|a|the)\s+",
               "", (user_request or "").strip(), flags=re.IGNORECASE)
    t = re.sub(r"^\s*(build|create|make|design|generate|develop)\s+",
               "", t, flags=re.IGNORECASE)
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
    # Sprint 1.9 — mobile-native verticals (genuinely phone-shaped products,
    # not a sidebar SaaS dashboard).
    (re.compile(r"\b(habit\s*tracker|habit[\s-]*building|meditation|mindfulness|"
                r"sleep\s*tracker|mood\s*tracker)\b", re.I), _habit_tracker),
    (re.compile(r"\b(music\s*(?:player|app)|podcast\s*app|audio\s*player|"
                r"playlist\s*app)\b", re.I), _music_player),
    (re.compile(r"\b(recipe(?:\s*app|\s*box)?|cooking\s*app|meal\s*plan(?:ner)?)\b", re.I), _recipe_app),
]


def _route(text: str, match_text: str, intent: ProductIntent, style: Dict) -> ProductSpec:
    """Pick the spec builder. Known verticals win; otherwise route by the
    classified interface layout — defaulting to a real application UI.

    `text` is the ORIGINAL user prompt (used for naming via
    `_title_from_request`); `match_text` is `text` optionally widened with
    ProductBlueprint signal (see `expand`). They're the same string when no
    blueprint is supplied — fully backward compatible.

    An explicit keyword already in the user's OWN prompt always wins over a
    (possibly stale or contradictory) blueprint hint: vertical rules are
    checked against `text` FIRST; the blueprint-widened `match_text` is only
    consulted when the prompt alone matched nothing — i.e. blueprint data
    HELPS classify an ambiguous prompt, it never overrides an explicit one."""
    for pattern, builder in _VERTICAL_RULES:
        if pattern.search(text):
            return builder()
    if match_text != text:
        for pattern, builder in _VERTICAL_RULES:
            if pattern.search(match_text):
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


def _apply_blueprint(spec: ProductSpec, blueprint: Dict[str, Any]) -> None:
    """Sprint 1.9 — let the already-computed ProductBlueprint (Sprint 1.3)
    refine a spec's tone/data instead of being silently discarded. Additive
    only: it overrides text fields when the blueprint actually supplied
    something non-empty, and appends (never replaces) feature items — it
    never changes which renderer/layout was already chosen."""
    audience = str(blueprint.get("audience") or "").strip()
    if audience:
        spec.audience = audience
    features = [f.strip() for f in (blueprint.get("core_features") or [])
               if isinstance(f, str) and f.strip()]
    if features:
        # Primary goals: blueprint's own language, capped to keep it tight.
        spec.primary_goals = features[:4]
        # Feature cards: append up to 2 blueprint-derived items beyond the
        # preset's own curated set (capped so a section never balloons).
        for s in spec.sections:
            if s.kind == "features":
                existing = {str(it.get("title", "")).lower() for it in s.items}
                added = 0
                for f in features:
                    if added >= 2:
                        break
                    if f.lower() in existing:
                        continue
                    s.items.append({"title": f, "body": f"Built for {spec.product_type}.", "icon": "✓"})
                    added += 1
                break


def expand(user_request: str, blueprint: Optional[Dict[str, Any]] = None) -> ProductSpec:
    """Expand a one-line prompt into a context-aware ProductSpec. Never
    raises. Runs intent classification → style resolution → layout-specific
    spec, so an app request renders the actual product (not a landing).

    `blueprint` is the OPTIONAL Sprint 1.3 ProductBlueprint summary attached
    to the orchestrator run (workspace/product_category/audience/complexity/
    recommended_renderer/core_features — see blueprint_bridge.orchestrator_
    metadata()). When present it (a) widens the text used for vertical/
    layout classification with the blueprint's own category/feature words,
    so a terse prompt that Product Intelligence already classified routes
    correctly even if its raw wording is ambiguous, and (b) refines the
    chosen spec's audience/feature copy. When absent (the common direct-
    orchestrator-run path), behaviour is IDENTICAL to before this sprint."""
    text = user_request or ""
    match_text = text
    if blueprint:
        extra_terms = " ".join(str(t) for t in [
            blueprint.get("workspace"), blueprint.get("product_category"),
            blueprint.get("recommended_renderer"),
            *(blueprint.get("core_features") or []),
        ] if t)
        if extra_terms:
            match_text = f"{text} {extra_terms}".strip()

    intent = classify(match_text)
    style = resolve_style(intent.style_mode)
    spec = _route(text, match_text, intent, style)

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

    if blueprint:
        _apply_blueprint(spec, blueprint)

    # Sprint 2.0 — Universal Renderer Selector: label the already-chosen
    # layout with one of the 7 named renderer categories + an optional
    # content variant. Additive only — never changes `spec.layout`.
    selection = select_renderer(text=match_text, layout=spec.layout,
                                product_type=spec.product_type, blueprint=blueprint)
    spec.renderer = selection["category"]
    if selection.get("variant"):
        spec.data = dict(spec.data or {})
        spec.data["variant"] = selection["variant"]

    return spec


__all__ = ["expand"]
