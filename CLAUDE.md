# CLAUDE.md

# KorvixAI - Claude Working Agreement

Read these documents BEFORE doing any work:

1.  KORVIX_AI_PHILOSOPHY.md
2.  AI_DEVELOPMENT_RULES.md
3.  PRODUCT_VISION.md
4.  ROADMAP.md

If any instruction conflicts with those documents, those documents take
priority.

------------------------------------------------------------------------

# Your Role

You are NOT building demo applications.

You are improving KorvixAI itself.

KorvixAI is an AI Operating System that generates products.

Always improve the generation engine.

Never improve only one example.

------------------------------------------------------------------------

# Benchmark Prompts

Examples like:

-   Build a fitness app
-   Build a CRM
-   Build a music player
-   Build a landing page
-   Build a dashboard

are BENCHMARK PROMPTS ONLY.

They exist only to evaluate generation quality.

Never implement those products inside Korvix.

Never create demo routes.

Never create product-specific business logic.

Always improve reusable systems.

------------------------------------------------------------------------

# Sprint Priorities

Priority order:

1.  Improve generated output quality.
2.  Preserve architecture.
3.  Preserve visual quality.
4.  Preserve backwards compatibility.
5.  Improve maintainability.

Never sacrifice visual quality for cleaner abstractions.

------------------------------------------------------------------------

# Before Writing Code

Audit the existing implementation.

Understand:

-   current renderer
-   current generator
-   current component system
-   current preview
-   current architecture

Do not assume.

Inspect first.

------------------------------------------------------------------------

# During Development

Prefer:

-   meaningful refactors
-   reusable improvements
-   renderer improvements
-   component quality
-   layout quality

Avoid:

-   tiny cosmetic patches
-   hardcoded demos
-   duplicated logic

------------------------------------------------------------------------

# Visual Quality

Success is measured by generated output.

Not by:

-   number of tests
-   number of files
-   number of commits

Every sprint should visibly improve generated products.

If Preview still looks generic, continue improving.

------------------------------------------------------------------------

# Package Rule

Never spend significant time:

-   installing packages
-   fixing npm registry
-   fixing proxy
-   fixing cache
-   fixing lockfiles

If tooling is unavailable:

-   document it
-   skip execution
-   continue improving Korvix source code

------------------------------------------------------------------------

# Deployment

At the end of every sprint always report:

-   New environment variables
-   Updated environment variables
-   Railway changes
-   Vercel changes
-   Docker changes
-   Dependencies
-   Breaking changes
-   Rollback plan

If none:

"No new environment variables required."

"No deployment or configuration changes required."

------------------------------------------------------------------------

# Final Rule

Do not optimize for passing tests.

Do not optimize for architecture alone.

Optimize for this outcome:

A user opens Preview and immediately feels they are looking at a real,
premium product.

If that is not true, the sprint is not finished.
