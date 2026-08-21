# Protected Billing & Payment Surface

This document explains the repository-level controls that protect the
production billing, payment-provider, webhook, subscription, entitlement and
billing-environment configuration surface — and the **manual GitHub settings**
the repository owner must enable to make those controls binding.

The goal: **no automated coding agent (and no accidental human change) can
modify billing behavior silently.** These areas have already required Polar
sandbox verification and may require it again on any behavioral change.

## What is protected

The authoritative, machine-readable list is
[`.github/protected-billing-paths.txt`](../../.github/protected-billing-paths.txt).
It covers billing provider selection; Polar and Lemon Squeezy checkout; Polar
and Lemon webhook verification; normalized billing events; subscription
projection; plan/product mapping; entitlement resolution; billing configuration
parsing; billing routes (checkout, account/portal, readiness, webhooks); the
billing frontend API client and checkout return page; billing behavior tests;
and the billing environment examples + migration docs.

Only the high-risk billing surface is protected — not the whole repository, and
not general UI pages that merely render a billing CTA.

## The three controls in this repo

1. **Policy — `CLAUDE.md` → "Protected Billing and Payment Surface".**
   Instructs any AI agent to STOP, do a read-only inspection, present a
   proposed-change report, and wait for the exact user approval token
   `APPROVE BILLING SURFACE CHANGE` before editing a protected file. Also
   documents the secret/variable invariants.

2. **Ownership — `.github/CODEOWNERS`.**
   Routes every protected path to `@gokhankizikli1-ai` so GitHub requests owner
   review on any PR that touches the billing surface.

3. **CI guard — `.github/workflows/protected-billing-surface.yml`.**
   On every pull request, detects whether a protected path changed. If so, it
   requires a complete declaration in the PR body and fails otherwise:

   ```
   BILLING-SURFACE-APPROVED: yes
   Sandbox retest required: yes|no
   Environment variables changed: yes|no
   Webhook behavior changed: yes|no
   Entitlement behavior changed: yes|no
   Rollback documented: yes
   ```

   The guard reads no secrets, calls no external service, and uses minimal
   permissions (`contents: read`, `pull-requests: read`). It grants **no**
   approval by itself — it only blocks accidental/undocumented changes. Human
   owner review is still required.

## Manual repository settings the owner must enable

The CI guard and CODEOWNERS only become *binding* when branch protection is
configured. GitHub does not let a workflow change these settings, so the owner
must set them by hand:

**Settings → Branches → Branch protection rules → add rule for `main`:**

- **Require a pull request before merging.**
  - Enable **Require review from Code Owners** (so the billing CODEOWNERS rules
    must be satisfied). Set required approvals ≥ 1.
- **Require status checks to pass before merging.**
  - Add **`Require declaration for protected billing changes`** (the job from
    `protected-billing-surface.yml`) as a **required** status check.
  - Enable **Require branches to be up to date before merging**.
- **Do not allow bypassing the above settings** (leave "Allow specified actors
  to bypass required pull requests" **off**). Do not permit routine bypassing of
  the billing checks.
- **Restrict who can push to matching branches** — prevent direct pushes to
  `main` so all changes flow through a reviewed PR.
- Keep **Include administrators** enabled so the rules also apply to admins.

**Optional hardening:**

- Require linear history and/or signed commits per repository convention.
- Require conversation resolution before merging.

## Interaction with `auto-merge-backend-only.yml`

The repository has an `auto-merge-backend-only` workflow that squash-merges
green, backend-only PRs without a human click. Its path allow-list matches
`backend/`, which would otherwise include `backend/services/billing/**`. To
keep billing changes from being merged silently, that workflow now **disqualifies
any PR that touches a protected billing path** (it skips auto-merge and leaves
the PR for owner review). This is a governance change only — it does not alter
any billing runtime behavior.

Once `protected-billing-surface` is a required status check (above), a billing
PR without the declaration also fails that check, so it cannot be merged by any
path until the declaration is present and the owner has reviewed.

## Validation commands (run later; nothing was executed in this PR)

```bash
# YAML lint the guard workflow (if yamllint is available):
yamllint .github/workflows/protected-billing-surface.yml

# Sanity-check the fnmatch matcher against the current tree:
python3 - <<'PY'
import fnmatch, subprocess
pats = [l.strip() for l in open('.github/protected-billing-paths.txt')
        if l.strip() and not l.startswith('#')]
files = subprocess.check_output(['git','ls-files']).decode().splitlines()
hits = sorted({f for f in files for p in pats
               if fnmatch.fnmatch(f, p) or (p.endswith('/**') and fnmatch.fnmatch(f, p[:-3]+'/*'))})
print('\n'.join(hits))
PY

# Verify CODEOWNERS parses (GitHub UI shows errors under Settings → CODEOWNERS,
# or use a linter such as `codeowners-validator` in CI).
```
