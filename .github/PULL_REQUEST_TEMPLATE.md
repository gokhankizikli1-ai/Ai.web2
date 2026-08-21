<!--
  Pull request template. Fill in the summary, then complete the Protected
  Billing Surface section below. Do NOT put secrets, tokens, or real
  environment-variable values anywhere in this description.
-->

## Summary

<!-- What does this PR do, and why? -->

## Changes

<!-- Bullet the notable changes. -->

## Verification

<!-- How was this validated? Commands run, tests, manual checks. -->

## Deployment Notes

<!-- New/updated env vars, Railway/Vercel/Docker/dependency changes, or
     "No deployment or configuration changes required." -->

---

## Protected Billing Surface

<!--
  The billing / payment / webhook / subscription / entitlement / billing-config
  surface is safety-critical. See CLAUDE.md → "Protected Billing and Payment
  Surface" and .github/protected-billing-paths.txt.

  If this PR does NOT change any protected billing path, leave the block below
  as-is (the CI guard will pass automatically).

  If it DOES change a protected path, the `protected-billing-surface` check
  requires the declaration lines below to be completed exactly, and owner review
  via CODEOWNERS is required. Set BILLING-SURFACE-APPROVED to "yes" only with the
  owner's explicit approval, and fill in every field. Do NOT include secrets.
-->

- [ ] No protected billing files changed
- [ ] Protected billing files changed with explicit owner approval

BILLING-SURFACE-APPROVED: no
Sandbox retest required: no
Environment variables changed: no
Webhook behavior changed: no
Entitlement behavior changed: no
Rollback documented: no

Changed protected files:

Reason:

Approved scope:

Sandbox verification plan:

Variable additions/removals:
