# Business Brain — the decision layer

```
Gmail / GitHub / Slack / Calendar / Vercel        unchanged connectors
        ↓
observations_store                                the ONE ingestion authority
        ↓
project_intelligence                              what it IS and what it MEANS
  correlation · interpretation · synthesis
        ↓
DECISION CONTEXT                                  ← this layer
  why it matters NOW · how strong the evidence is
  who can actually resolve it · what would make it wrong
        ↓
candidate_synthesis → action_prioritizer          unchanged deciders
        ↓
execution_policy · approvals                      unchanged gate
        ↓
Project Workspace · Project chat
```

## The gap it closes

`project_intelligence` says *"the production deploy of the merged payment fix
failed"* and stops there, correctly: it owns facts, not priority. Everything
downstream then decided importance from constants.

| decision | who made it | how |
|---|---|---|
| how much does this matter? | `candidate_synthesis` | `impact = "high"` — a two-entry table |
| how urgent is it? | `candidate_synthesis` | `urgency = "high"` — the same table |
| which goal does it serve? | `candidate_synthesis` | the project's top goal, whatever it was about |
| what order? | `action_prioritizer` | a weighted sum over those constants |

So a tracked README issue and a production outage twelve hours before a launch
produced **identical numbers**, and no reweighting could separate them — the
inputs did not differ. "Aligned to a goal" was true of every candidate and
therefore discriminated between nothing. And the launch, already ingested by
the calendar connector and sitting in the same table, took **no part in
anything**.

## What it owns — and what it must never own

**Owns:** the reading of *importance*. Why a subject deserves attention now,
how strong its evidence is, who has to act, and what would make the reading
wrong.

**Does not own:** facts (`project_intelligence`), proposals
(`candidate_synthesis`), order (`action_prioritizer`), the gate
(`execution_policy`), durable memory (`decisions_store` / `business_knowledge`).
**This layer writes nothing, anywhere,** and is recomputed from rows a caller
already read.

## Tier first, score second

Ordering is a small documented ladder; the existing weighted score only breaks
ties *inside* a tier.

| tier | code | when |
|---|---|---|
| 1 | `deadline_risk` | an open blocker **and** an imminent commitment |
| 2 | `production_broken` | production is verifiably red, unresolved |
| 3 | `customer_impact` | unresolved **and** corroborated by independent humans |
| 4 | `blocked` | unresolved with a concrete blocker (CI, issue, deploy) |
| 5 | `unverified` | open, but nothing concrete is broken |
| 6 | `time_sensitive` | an imminent commitment and nothing broken |
| 7 | `routine` | everything else — **and everything with no evidence** |

That last row is the whole design. A weighted sum cannot express *"one verified
outage outranks five informational signals however many there are"*, because
any weight honest enough for a single weak signal is small enough for five of
them to out-sum a real one. The ladder can, **by construction**: a candidate
with no decision context is `routine`, so nothing unevidenced can displace
something evidenced, and **count is never a tier input**.

A subject whose evidence is older than the correlation window steps down one
rung. A subject a durable decision post-dates drops to `routine` — reframed,
never deleted.

## Time is structural. Wording never ranks.

Deadline pressure comes from a calendar event's own `start` against `now`:

| level | window |
|---|---|
| `imminent` | ≤ 48 hours |
| `approaching` | ≤ 7 days |
| `none` | anything further out, or undated |

Nothing else. The `milestone` / `meeting` label **is** derived from the title,
is marked `basis: "textual"`, and is **not readable by `_tier`** — so no
connector text, in any language, can move a subject up the ladder. That is the
defence against prompt-injection-by-wording, and it is structural rather than a
filter. Pinned by
`test_a_launch_title_cannot_move_anything_up_the_ladder` and
`test_hostile_connector_text_cannot_touch_a_single_ranking_field`.

A commitment on its own creates **nothing**: no candidate, no blocker, and no
priority for a project with no open problem.

Supersession applies before the horizon, not after: a launch **cancelled** or
**moved to next month** stops exerting yesterday's pressure, because the row
that moved it must be allowed to supersede the row it replaced.

## Corroboration helps; repetition cannot

`customer_impact` counts **distinct human sources** over `correlation`'s already
deduplicated evidence units — Slack and Gmail collapse to one unit per source
before this layer ever sees them.

| level | evidence |
|---|---|
| `corroborated` | Slack **and** Gmail — two independent people |
| `reported` | one of them |
| `none` | neither |

Twelve messages in one channel are one source, so the score is byte-identical
whether a thing was said once or a dozen times. And a complaint alone never
claims production is broken: with no technical evidence the subject is
`observed`, which proposes no work at all.

## The weights, and what they claim

Every one is keyed on a coarse **level**, never a count:

```
verified production failure   2.00
imminent commitment           1.50
two independent humans        1.00
one human                     0.40
stale evidence               −1.00
contradictory evidence       −0.50
Korvix cannot resolve it     −0.25
```

The ordering is the claim: **corroboration helps and never overwhelms
severity.**

## Actionability is visible, not suppressive

Korvix reads GitHub, Vercel, Slack, Gmail and Calendar. It writes none of them.
So for a connector-observed problem there are two different answers:

* **what Korvix can do** — investigate, through the existing `research`
  capability and the existing `execution_policy` tier;
* **who resolves it** — a person, in `vercel` / `github`.

An outage nobody can automate is still the most important thing in the project,
so actionability does **not** demote it down the ladder — hiding the truth to
flatter the tool would be worse than the tool being limited. It is a tie-break
inside a tier, and above all it is *stated*, on the candidate, in the
assessment's `plan`, on the page and in the chat prompt.

## Stale proposals are reconciled

The audit found the other half of a fix that had only ever been half done.
Suppression governed what was **written**: after a later production deploy went
green the subject became `likely_resolved`, `candidate_synthesis` correctly
proposed nothing further — and the row written yesterday was still `proposed`,
still ranked, still recommended. *"A resolved subject proposes nothing"* was
true only of the future.

`_reconcile` closes it through the store's **existing** lifecycle
(`STATUS_SUPERSEDED`), and only on evidence it can see: a proposal is retired
when every one of its visible observations is now spoken for by a subject that
no longer proposes work, or by a different candidate written in the same pass
(which is what happens when a merged PR joins a deploy target and changes the
correlation's component id).

The guard matters as much as the rule: a candidate **none** of whose evidence
is visible is left strictly alone. The observation read is bounded, so *"I
cannot see it"* and *"it is resolved"* are different sentences, and inferring
the second from the first would close live work the moment a project got busy.

## One answer, three surfaces

| surface | how it gets the answer |
|---|---|
| Business Brain assessment | `decision_context.build` → `action_prioritizer` |
| Project page | `decision_context.project_focus` over subjects it already holds |
| Project chat | the same focus block, first, in the system prompt |

The page must not write, so it cannot go through `candidate_synthesis` — that
is exactly why `decision_context` is pure. All three run the **same function**
with the **same ladder**, so the page and the Brain cannot name two different
top priorities.

## What travels

Stable codes only. The tier **integer**, the score and the confidence number
are deliberately not part of the frontend contract: a number rendered at a
person is the unearned precision this codebase refuses to ship. The page
renders `deadline_risk` through its locale dictionaries in EN / TR / DE, and a
test pins that no ranking number ever appears in the payload.

No provider identifier travels either — a calendar event id is digested through
the same `attention.stable_id` every other subject-derived identity uses.

## Isolation

`decision_context` has **no store access**. Every entry point takes rows the
caller already read, so there is no query here that could widen a scope. The
assessment route reads them filtered by both `project_id` and `user_id`, behind
the canonical ownership gate. Pinned adversarially with two accounts, two
projects and word-for-word identical stories, including a launch tomorrow in
the *other* project: it must not make your failure a deadline risk.

## Bounds

| bound | value |
|---|---|
| observations read per assessment | 60 |
| correlated subjects considered | `MAX_STATES` (8) |
| commitments tracked | 3 |
| why-now reasons per subject | 4 (2 rendered) |
| caveats per subject | 4 (1 rendered) |
| runners-up in `focus.next` | 3 |
| open proposals reconciled per pass | 50 |
| goals / decisions scanned | 10 each |
| prompt contribution | 650 chars of a 4000-char budget |

Measured, 5 connector observations + a launch: the assessment route issues
**43 SQL statements, down from 47**, and the project page issues **80,
unchanged** — the focus block costs the page nothing because it correlates rows
the page had already read. With 300 more observations both numbers are
**identical**: no N+1 growth with project size.

## Deployment

No new environment variables required.
No deployment or configuration changes required.
No new dependencies, tables, storage systems, provider calls or model calls.
