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

------------------------------------------------------------------------

# Protected Billing and Payment Surface

The production billing, payment-provider, webhook, subscription,
entitlement and billing-environment configuration surface is
SAFETY-CRITICAL. It has already required Polar sandbox verification, and
any future behavioral change to it may require sandbox verification again.

Therefore any AI coding agent (and any human) must **STOP before modifying
a protected billing file and ask the user for explicit approval.** Do not
edit these files silently.

The machine-readable list of protected paths lives in
`.github/protected-billing-paths.txt`. Read it first. The high-risk groups
it covers are:

-   billing provider selection (`backend/services/billing/provider.py`)
-   Polar checkout (`backend/services/billing/polar/checkout.py`)
-   Lemon Squeezy checkout (`backend/services/billing/checkout/client.py`)
-   Polar webhook verification (`backend/services/billing/polar/signature.py`,
    `backend/routes/v2_billing_polar.py`)
-   Lemon webhook verification (`backend/services/billing/signature.py`,
    `backend/routes/v2_billing.py`)
-   normalized billing events + subscription projection
    (`backend/services/billing/subscriptions/**`,
    `backend/services/billing/processor/**`,
    `backend/services/billing/inbox.py`)
-   plan / product mapping + entitlement resolution
    (`backend/services/billing/entitlements/**`)
-   billing configuration parsing + provider validation
    (`backend/services/billing/config.py`, the billing/provider blocks in
    `backend/core/config.py`)
-   checkout / customer-portal / readiness routes
    (`backend/routes/v2_billing_checkout.py`,
    `backend/routes/v2_billing_account.py`,
    `backend/routes/v2_admin_billing.py`,
    `backend/services/billing/portal.py`,
    `backend/services/billing/readiness.py`)
-   billing frontend API client + checkout return
    (`src/lib/billingApi.ts`, `src/hooks/useCheckout.ts`,
    `src/pages/BillingReturn.tsx`)
-   billing environment examples + migration documentation
    (`docs/billing/**`)

## Required agent behavior

1.  Read the protected-file list in
    `.github/protected-billing-paths.txt`.
2.  Perform a **read-only inspection first**.
3.  Do **not** edit any protected file during the inspection phase.
4.  Present a proposed-change report (see the required contents below).
5.  Wait for the user to reply with the **exact** approval token:
    `APPROVE BILLING SURFACE CHANGE`
6.  Without that exact approval, do **not** modify any protected file.
7.  Approval applies **only** to the exact files and scope listed in the
    report.
8.  Any expansion of scope (more files, or a different behavioral change)
    requires a fresh approval.
9.  Never expose, request, print or commit secret values.
10. Never alter Railway or Vercel production variables automatically.
11. Never switch `BILLING_PROVIDER`.
12. Never remove Lemon Squeezy.
13. Never change Polar product mappings.
14. Never modify webhook verification semantics.
15. Never modify entitlement-granting semantics without explicit approval.
16. After an approved behavioral change, clearly state whether Polar
    sandbox verification must be repeated.

## The approval request (proposed-change report) must contain

-   exact files proposed for modification
-   current behavior
-   intended behavior
-   reason the modification is required
-   checkout impact
-   webhook impact
-   subscription impact
-   entitlement impact
-   environment-variable impact
-   database / migration impact
-   whether Polar sandbox retesting is required
-   rollback plan

## Documentation-only edits

Edits limited to documentation that do **not** change any operational
instruction (for example, fixing a typo in a migration note) MAY be
allowed, but must still be reported in the PR body and still flow through
the protected-surface PR declaration and owner review.

## Secret and environment-variable invariants

-   Actual `POLAR_ACCESS_TOKEN` values never belong in Git.
-   Actual `POLAR_WEBHOOK_SECRET` values never belong in Git.
-   Lemon Squeezy secrets (`LEMON_SQUEEZY_API_KEY`,
    `LEMON_SQUEEZY_WEBHOOK_SECRET`, …) never belong in Git.
-   Railway / Vercel values must never be copied into files, tests,
    fixtures, logs or PR descriptions.
-   `.env.example` files contain variable **names and safe placeholders
    only** — never real values.
-   Backend secrets must never become `VITE_*` variables (a `VITE_` var is
    shipped to the browser).
-   Product IDs may be operationally sensitive even when they are not
    credentials; do not copy live provider product/price mappings into
    source unless the architecture explicitly requires it.
-   Environment-variable removal requires repository-wide proof that no
    consumer remains.
-   Lemon Squeezy variables are removed only after the Lemon runtime code
    is removed **and** the Polar cutover is verified.
-   Provider changes require explicit deployment instructions and rollback
    instructions.

## Enforcement

`.github/CODEOWNERS` routes protected billing paths to the repository
owner for required review, and the
`.github/workflows/protected-billing-surface.yml` check fails any PR that
touches a protected path without the required declaration in its body.
These are guard rails, not a substitute for the human judgement above. See
`docs/engineering/PROTECTED_BILLING_SURFACE.md` for the manual repository
settings that make them binding.
