# DESIGN_PHILOSOPHY.md

# KorvixAI Design Philosophy

> This document defines what "good UI" means for KorvixAI generated
> artifacts.

KorvixAI should not merely generate working previews.

KorvixAI should generate products that feel intentional, premium, and
real.

------------------------------------------------------------------------

# Priority

This document has higher priority than vague requests like:

-   "Improve UI"
-   "Make it better"
-   "Polish the design"
-   "Add visual quality"

When improving visual quality, follow this document.

------------------------------------------------------------------------

# Core Principle

**UI polish is not visual quality.**

Changing icons, spacing tokens, empty states, or small CSS details is
not enough.

Real visual quality comes from:

-   composition
-   hierarchy
-   focal point
-   product personality
-   layout rhythm
-   contrast
-   depth
-   responsive structure
-   premium first impression

------------------------------------------------------------------------

# The First Screen Matters Most

Every generated artifact should make the user think:

> "This looks like a real product."

within the first few seconds.

The first screen must have:

-   a clear focal point
-   strong visual hierarchy
-   meaningful sections
-   balanced spacing
-   premium composition
-   product-specific personality

------------------------------------------------------------------------

# Avoid Generic Templates

Generated products must not feel like:

-   gray boxes
-   equal-weight card grids
-   repeated sections
-   placeholder dashboards
-   copy-paste layouts
-   generic SaaS templates

A generated product should feel designed for its specific use case.

------------------------------------------------------------------------

# Better Hierarchy Beats More Components

Do not solve weak UI by adding many small components.

A single strong hero section is better than ten average cards.

Prefer:

-   dominant hero metric
-   split hero layout
-   product mockup beside headline
-   meaningful primary action
-   clear secondary actions
-   visual storytelling

over:

-   four identical cards
-   flat metric grids
-   repeated generic panels

------------------------------------------------------------------------

# Renderer Expectations

## Landing Pages

Landing pages should feel like modern startup sites.

They should use:

-   premium split hero layouts
-   product mockups near the headline
-   strong CTA hierarchy
-   social proof
-   feature storytelling
-   pricing or conversion sections when useful

Reference quality level:

-   Linear
-   Stripe
-   Vercel
-   Framer
-   Apple product pages

Do not use plain centered text as the default landing hero.

------------------------------------------------------------------------

## Dashboards

Dashboards should feel like premium SaaS products.

They should use:

-   dominant hero metric or insight panel
-   strong information hierarchy
-   clear navigation
-   asymmetric layout when appropriate
-   real product-specific widgets
-   dense but readable sections

Avoid equal-weight bento grids as the main layout.

------------------------------------------------------------------------

## Mobile Apps

Mobile previews should feel like flagship mobile products.

They should use:

-   realistic phone-width composition
-   layered cards
-   strong top section
-   sticky bottom navigation when appropriate
-   premium micro-interactions
-   depth and visual rhythm

Avoid flat phone screens with generic cards.

------------------------------------------------------------------------

## Admin / Productivity Tools

Admin interfaces should feel powerful and efficient.

They should use:

-   dense layouts
-   clear tables
-   filters
-   command actions
-   status indicators
-   sidebars
-   strong scanability

Avoid oversized empty dashboards.

------------------------------------------------------------------------

## Portfolios

Portfolios should feel elegant and personal.

They should use:

-   strong hero identity
-   project showcase sections
-   visual storytelling
-   refined typography
-   tasteful spacing

Avoid generic resume pages.

------------------------------------------------------------------------

# Product Personality

Every generated product should have personality based on its category.

Examples:

-   finance / crypto: analytical, sharp, data-rich
-   wellness: calm, soft, focused
-   fitness: energetic, progress-oriented
-   music: expressive, visual, rhythmic
-   ecommerce: conversion-focused, product-first
-   startup landing: ambitious, polished, high-trust
-   admin dashboard: efficient, structured, operational

Do not use the same mood for every output.

------------------------------------------------------------------------

# Visual Quality Checklist

Before calling a visual sprint complete, check:

-   Does the first screen feel premium?
-   Is there a clear focal point?
-   Is the layout more than equal-card grids?
-   Does the product category affect the design?
-   Are sections visually distinct?
-   Is the spacing intentional?
-   Is typography hierarchical?
-   Does the output avoid generic gray dashboards?
-   Would a user want to screenshot this?
-   Does it look better than the previous sprint?

If not, continue improving.

------------------------------------------------------------------------

# What Does NOT Count As Enough

The following alone are not sufficient:

-   replacing emoji icons with SVG icons
-   adding folder icons
-   adding empty states
-   changing border radius
-   changing one CSS token
-   adding more tests
-   changing routing
-   adding helper functions

These may help, but they are not the sprint goal.

------------------------------------------------------------------------

# What Counts As Real Improvement

Real improvement means generated artifacts visibly change in
composition.

Examples:

-   centered landing hero becomes premium split hero
-   equal dashboard grid becomes hero insight + supporting panels
-   mobile screen gains layered app-like structure
-   generic card list becomes product-specific workflow
-   flat metrics become meaningful visual storytelling

------------------------------------------------------------------------

# Benchmark Rule

Benchmark prompts are only evaluation tools.

Never implement the benchmark product inside Korvix.

Use benchmark prompts only to judge whether the reusable generator
produces better results.

------------------------------------------------------------------------

# Final Rule

Do not optimize for "technically changed."

Optimize for:

> "This feels like a real product designed by a strong frontend/product
> designer."

If the preview does not create that feeling, the visual sprint is not
finished.
