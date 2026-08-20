# Project Intelligence — the correlation layer

```
Gmail / GitHub / Slack / Calendar / Vercel     unchanged connectors
        ↓
observations_store                             the ONE ingestion authority
        ↓
PROJECT INTELLIGENCE                           ← this layer
  entity resolution · event understanding · cross-source correlation
  evidence aggregation · state inference · confidence
        ↓
Business Brain / candidate / priority authorities   unchanged deciders
        ↓
Project Workspace · Project chat
```

## The gap it closes

Every authority already answered its own question well:

| authority | question |
|---|---|
| `observations_store` | what came in |
| `project_brain.attention` | what should I look at now |
| `candidate_synthesis` → `action_prioritizer` | what should we do about it |

Nobody answered the one in between: **are these five observations five things,
or one thing seen five times?**

Concretely, `attention` classifies each observation under a *source-scoped*
subject — `github:pr:acme/site:712`, `vercel:deploy:prj_1:production` — and
excludes Slack and Gmail entirely. So a Slack sentence about the payment
webhook, the PR that fixes it, and the deployment that ships it were three
unrelated rows. Nothing in the system could hold the thought "these are the
same problem".

## What it owns — and what it must never own

**Owns:** facts and relationships. Whether two observations are about the same
real-world thing, what the accumulated evidence says about that thing's state,
and how much that reading can be trusted.

**Does not own:** priority, action, execution, approval, durable memory.
`attention` still decides what a human sees first, `candidate_synthesis` still
decides what could be worth doing, `action_prioritizer` still ranks it,
`execution_policy` still gates it. **This layer writes nothing, anywhere.**

> Not to be confused with `orchestrator/project_intelligence.py`, which is a
> *run-scoped, capability-aware prompt packet builder* and is untouched. It
> shares a word with this package and nothing else.

## Entity resolution — three classes of key

| class | examples | merges with |
|---|---|---|
| **LINK** | commit sha, repo-scoped branch, PR / issue number | each other, and corroborated topics |
| **GROUP** | deploy target, CI check, calendar event | only an identical key |
| **TOPIC** | a normalized two-word phrase from bounded text | LINK keys, once corroborated |

GROUP keys are deliberately unmergeable: every production deploy for the life of
a project shares one target key, so letting a target join a topic would drag
months of unrelated deploys into it.

TOPIC keys are the only way a Slack sentence can ever reach a GitHub PR, and
therefore the only place false correlation can be manufactured. Three guards:

1. a topic is a **bigram**, never a single word — `payment` alone cannot merge
   "payment button colour" into "payment webhook failure";
2. at least one word must be **distinctive** — `production deployment` is two
   words that describe half of any project, so it forms no key at all;
3. the bigram must appear from **two different sources** before it merges
   anything — one person's wording is not evidence.

Text is casefolded, stripped of combining marks (Turkish `ı ş ğ ç ö ü` fold to
ASCII, so `webhook'a bakıyor` tokenizes correctly), and passed through a small
**explicit** synonym table rather than a real stemmer — over-stemming
manufactures false matches, which is the one failure mode this layer cannot
have.

Resolution is a union-find over a bounded key set. There is no pairwise pass:
cost is `O(events × keys-per-event)`, and keys-per-event is capped.

## State inference

Only **decisive** evidence (code / CI / deploy / issue, positive or negative)
settles anything. Within a facet the latest event **per target** wins, and any
red target makes the facet red — a green preview is not a counter-argument to a
broken production deploy.

| evidence | state |
|---|---|
| some facet negative **and** some positive | `conflicting` |
| only negative | `unresolved` |
| only positive | `likely_resolved` |
| nothing decisive, something pending | `in_progress` |
| nothing decisive at all | `observed` |

A merged PR plus a failed deploy is therefore **`conflicting`, never
"resolved"** — and the failed deploy stays visible in `contradicting`.

Deliberately **not** inferred: `awaiting_response`. Mail ingestion is
inbound-only, so the system cannot prove a reply is outstanding, and saying so
would be a claim we cannot back.

## Confidence is derived, not invented

The score is a sum of documented coarse components, every one of which is
reported in `breakdown` so the number is reproducible by hand:

| component | weight |
|---|---|
| base (we saw something real) | 0.10 |
| corroboration — 1 / 2 / 3+ distinct sources | 0.00 / 0.15 / 0.25 |
| anchor — structural / topical only | 0.25 / 0.10 |
| decisive facets — 0 / 1 / 2+ | 0.00 / 0.10 / 0.20 |
| agreement — nothing contradicts | 0.10 |
| freshness — recent / aging / stale-or-unknown | 0.10 / 0.05 / 0.00 |

Maximum 1.00. Levels: `high` ≥ 0.70, `medium` ≥ 0.45, else `low`.

Corroboration counts **distinct sources over deduplicated evidence units**
(`source`, `semantic_type`, `target`), so a webhook retry, a re-sync, or one
chatty channel can never manufacture agreement.

## Operational vs durable — the boundary

Everything here is **operational and perishable**: "as of now, the evidence
suggests the payment webhook is fixed." It is recomputed on every read from
observations still inside the 14-day correlation window and is **never
persisted**, precisely so it cannot outlive the evidence it came from.

**Durable** facts and lessons belong to the existing authorities —
`decisions_store` for choices, `business_knowledge` on the Memory Plane for
learnings. Crossing that boundary is a deliberate act by a user or by an
authority that already owns it, never a side effect of a correlation looking
confident. Pinned by
`test_operational_state_is_never_persisted_as_durable_knowledge`.

## Isolation

Correlation is the one place that deliberately looks for connections *between*
observations, so it is the one place a scoping mistake would weave another
account's rows into your project's story and present the result as an
understanding.

`correlate()` is pure and has no store access — it cannot widen a scope because
it contains no query that could express one. `for_project()` reads through the
canonical `observations_store` filtered by **both** `project_id` and `user_id`.
A foreign project id returns `[]`, identical to a project that does not exist.

Pinned adversarially with two accounts, two projects and word-for-word
identical stories: the evidence sets must be disjoint.

Output carries display-safe provenance only — internal observation ids, source
names, and the connector's own human-written summaries. Never a token, a
credential, a raw payload, or an opaque provider id (a Vercel project id, a
Slack channel id).

## Bounds

| bound | value |
|---|---|
| observations per projection | 120 |
| correlation window | 14 days (matches `attention.MAX_AGE_DAYS`) |
| states returned | 8 (workspace shows 5, brain 4) |
| evidence rows per list | 4 |
| evidence ids per state | 12 |
| text scanned per observation | 400 chars |
| topic keys per observation | 4 |

Measured: 180 stored observations → one understood subject and an 825-char
prompt block against a 4000-char budget. The workspace pays **zero** extra
queries — it correlates rows the page had already read.

## Integration points

- **`ProjectBrainClient`** — surfaces a bounded digest, synthesized truth
  first, raw activity beneath it. Also fixes an audited gap: the brain read
  goals, decisions, products, chats and connector signals but had **never**
  read `business_knowledge`, so a recorded learning reached an agent run and
  never reached project chat.
- **`candidate_synthesis`** — a correlated state produces one evidence-backed
  candidate ("Investigate payment webhook — conflicting evidence") whose
  confidence is the correlation's own score rather than a hardcoded `0.5`, and
  every raw observation already evidencing it is suppressed so dedup converges
  on the subject. Promotion still requires `unresolved`/`conflicting` **and**
  corroboration — noise stays noise, and a lone signal falls through to the
  unchanged path.
- **Workspace** — adds `project_state` and lets each Needs-Attention row name
  the story it belongs to. It is **not** a second ranking system: order,
  membership and severity are untouched.

## Deployment

No new environment variables required.
No deployment or configuration changes required.
No new dependencies, tables, storage systems or provider calls.
