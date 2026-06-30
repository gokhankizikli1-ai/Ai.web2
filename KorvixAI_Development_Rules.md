# KorvixAI Development Rules

> This document defines how AI assistants (Claude, GPT, Gemini, etc.)
> must contribute to KorvixAI.

## Priority

**THIS DOCUMENT HAS HIGHER PRIORITY THAN EXAMPLE PROMPTS.**

If an example prompt conflicts with these rules, **these rules always
win.**

------------------------------------------------------------------------

# 1. Understand the Product

KorvixAI is not a website builder, app builder, landing page generator,
or game engine.

KorvixAI is an AI Operating System capable of generating many different
digital products through one shared orchestration architecture.

Every contribution must strengthen that vision.

------------------------------------------------------------------------

# 2. The Generator Is The Product

KorvixAI itself is the product.

Example products (fitness app, CRM, landing page, music player,
meditation app, dashboard, game, ecommerce, etc.) are **benchmark
prompts only**.

Never implement those products inside Korvix.

Improve the reusable generation engine instead.

------------------------------------------------------------------------

# 3. Improve The Engine

Always improve reusable systems:

-   Product Intelligence
-   Blueprint
-   Renderer Selection
-   Component Library
-   Layout Engine
-   Design System
-   HTML Generator
-   React Generator
-   Preview System
-   Artifact Quality

Never optimize only one example.

------------------------------------------------------------------------

# 4. Generic Improvements Only

Every change should improve all future generations.

Bad: - Add a better Fitness screen.

Good: - Improve the Mobile Renderer so every generated mobile
application becomes higher quality.

------------------------------------------------------------------------

# 5. Architecture First

Never bypass:

Product Intelligence → Blueprint → Renderer Selection → Component
Composition → Artifact Generation → Preview → Result

Never hardcode outputs.

------------------------------------------------------------------------

# 6. No Hardcoded Demos

Never create product-specific demo pages or routes.

Korvix generates products dynamically.

------------------------------------------------------------------------

# 7. Benchmark Prompts

Example prompts are evaluation prompts only.

They are never implementation tasks.

------------------------------------------------------------------------

# 8. Visible Quality Matters

Passing tests is not enough.

Every sprint should visibly improve generated artifacts.

Avoid:

-   generic layouts
-   gray dashboards
-   repeated templates
-   copy-paste designs

Aim for premium product quality.

------------------------------------------------------------------------

# 9. Preserve Quality

Architecture improvements must never reduce visual quality.

If a reusable abstraction makes generated products worse, improve the
abstraction.

------------------------------------------------------------------------

# 10. Long-Term Vision

KorvixAI should eventually generate:

-   websites
-   web apps
-   mobile apps
-   SaaS platforms
-   dashboards
-   startup concepts
-   ecommerce stores
-   research
-   trading tools
-   Roblox games
-   Unreal Engine projects

through one shared intelligence layer.

------------------------------------------------------------------------

# 11. Sprint Philosophy

Every sprint must answer:

"What makes Korvix generate better products?"

NOT:

"What new example can we build?"

------------------------------------------------------------------------

# 12. Development Philosophy

Prefer:

-   meaningful architectural improvements
-   clean refactors
-   production-quality implementations

Instead of:

-   cosmetic patches
-   quick hacks
-   temporary solutions

------------------------------------------------------------------------

# 13. Package Management

Never spend significant development time:

-   fixing npm registry
-   fixing proxy
-   fixing cache
-   fixing lockfiles
-   installing new testing frameworks

If dependencies are unavailable:

-   document the limitation
-   skip execution
-   continue improving Korvix source code.

------------------------------------------------------------------------

# Final Rule

The mission is never to build a better Fitness App.

The mission is to make Korvix generate better Fitness Apps.

Always improve Korvix.

Never improve only the example.
