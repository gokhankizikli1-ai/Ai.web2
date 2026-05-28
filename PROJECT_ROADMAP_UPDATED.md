# KorvixAI — Updated Project Roadmap

> Status snapshot as of **2026-05-28**. Inspected against `main @ b46df38`.
> Replaces the original `PROJECT_ROADMAP.md` as the working plan. The
> original stays in the repo as the historical spec.

**Working name:** "v1.0 production milestone"
**Honest current completion:** ~58% of the path to a paid-user-ready
production deploy.

**Legend**
- **Priority:** `P0` blocker for the next milestone · `P1` important · `P2` nice-to-have
- **Risk:** 🟢 low · 🟡 medium · 🔴 high
- **Status:** `READY` · `STABLE` · `EXPERIMENTAL` · `PARTIAL` · `BROKEN` · `PLACEHOLDER`

---

## Where we actually stand

### What is already production-ready

| Subsystem | Status |
|---|---|
| Email + Google auth, JWT lifecycle | READY |
| Owner mode + identity-first precedence | READY |
| SSE chat streaming + watchdogs | READY |
| Multi-provider LLM routing (OpenAI/Anthropic/Gemini) with fallback | READY |
| Tool registry + per-tool feature flags + audit log | STABLE |
| Web research (Tavily → Exa → Brave cascade) | STABLE |
| Structured university rankings tool | STABLE |
| Postgres + pgvector foundation (slice 1-2-3 + INTRANS fix) | READY |
| Semantic memory recall (pgvector cosine on PG, Python on SQLite) | READY |
| Memory consolidation (dedup + decay) + CLI | READY |
| DB observability (metrics, slow-query log, pool stats) | STABLE |
| Memory cross-user safety (fuzz-tested) | READY |
| Vision pipeline (gpt-4o-mini) | STABLE |
| Backend test suite (1386 passing) | STABLE |

### What is partial or experimental

| Subsystem | Status | Why |
|---|---|---|
| Multi-agent coordination (Phase 9) | PARTIAL | Backend complete; FE only has `AgentPresenceList` |
| Background jobs (Phase 7) | EXPERIMENTAL | InlineJobRunner only; Celery + Redis stubbed not wired |
| Asset storage (Phase 8) | PARTIAL | LocalAssetStorage only; works on single-instance Railway, breaks under autoscale |
| Apple Sign-In | EXPERIMENTAL | `/auth/apple` stub returns 503 by design until `cryptography` dep + JWKS verifier ship |
| Chat UX (Phase 3 FE) | PARTIAL | Streaming works; no source cards, no inline citations, no edit/regenerate, no mobile-Safari validation |

### What is missing or broken

| Subsystem | Status |
|---|---|
| Rate limiting on `/v2/*` routes | BROKEN (does not exist) |
| Sentry FE + BE | PLACEHOLDER |
| OpenTelemetry traces | PLACEHOLDER |
| Cloudflare R2 asset storage | PLACEHOLDER |
| Source-card citation rendering FE | PLACEHOLDER |
| Frontend lazy loading / code splitting | BROKEN (2.58 MB monolithic bundle) |
| Per-user usage ledger / budgets | PLACEHOLDER |
| Adaptive model routing by complexity | PLACEHOLDER |
| Anthropic prompt caching | PLACEHOLDER |
| Batch API integration | PLACEHOLDER |
| RBAC beyond owner | PLACEHOLDER |
| Audit log viewer route | PLACEHOLDER |
| Memory inspector owner-only routes | PLACEHOLDER |
| Vertical pipelines backend (Website / Ecommerce / Trading) | PLACEHOLDER (UI shells only) |

---

## Phase status table

| Phase | Title | Roadmap completion | Production readiness | Priority |
|---|---|---|---|---|
| 1 | Auth foundation | 85% | READY | — |
| 2 | Owner mode + admin | 95% | READY | — |
| 3 | Chat workspace + streaming (BE) | 90% | READY | P1 (FE polish) |
| 4 | Agent registry + provider routing | 80% | READY | — |
| 5 | Safety guardrails | 80% | STABLE | P2 (mod layer) |
| 6 | Memory Plane | **85%** | READY | P0 (close inspector) |
| 7 | Job Queue + Async Execution | 30% | EXPERIMENTAL | P0 |
| 8 | File / Vision Pipeline | 50% | PARTIAL | P0 (R2) |
| 9 | Multi-Agent Coordination | 70% (BE only) | PARTIAL | P1 (FE) |
| 10 | Tool Expansion | 40% | STABLE | P2 |
| 11 | Cost Optimization | 0% | PLACEHOLDER | P1 |
| 12 | Vertical Pipelines | 5% (UI shells) | PLACEHOLDER | P2 |
| 13 | Production Hardening | 15% | PLACEHOLDER | P0 |
| 14 | Scale & Real-time UX | 0% | PLACEHOLDER | P2 |
| 15 | Deployment Architecture | 25% | PARTIAL | P1 |

---

## The honest critical path to v1.0

```
P6 closure (memory inspector)
    │
    ▼
P7 Celery + Redis ──────► P8 R2 storage
    │                         │
    │        ┌────────────────┘
    ▼        ▼
P13 hardening essentials (Sentry, rate limit, audit viewer)
    │
    ▼
P8 FE polish (lazy load, source cards) ──► P9 panels FE ──► P11 cost ledger
    │
    ▼
v1.0 milestone — ready for paying users
```

### Recommended implementation order (next ~3 weeks)

| # | PR scope | Days | Phase | Risk |
|---|---|---|---|---|
| 1 | Memory inspector — owner-only `GET /v2/admin/memory/users`, `/recall-debug`, `/{id}/tag` | 1-2 | 6 closure | 🟢 |
| 2 | Celery + Redis worker — Upstash, `korvixai-workers` Railway service, `CeleryJobRunner` swap, SSE bridge `/v2/jobs/:id/stream` | 2-3 | 7 | 🟡 |
| 3 | Cloudflare R2 storage — bucket + presign endpoint + S3-compatible `AssetStorage` adapter + local→R2 migration script | 2-3 | 8 | 🟡 |
| 4 | Phase 13 essentials — Sentry FE+BE, `slowapi` rate limiter on `/v2/chat/stream` + `/v2/orchestrate` + presign, audit log viewer route | 2 | 13 | 🟡 |
| 5 | Frontend lazy loading — `React.lazy` for 31 pages, route-level code splitting, Vite manualChunks | 1-2 | 8 polish | 🟢 |
| 6 | Source cards UI — Perplexity-style cards (favicon, domain, snippet) above chat answer; consumes `tool.completed` events | 2-3 | 8 polish | 🟢 |
| 7 | Cost ledger — `usage_events` table, `UsageLogger` middleware, `/v2/usage` endpoint, FE usage dashboard | 1-2 | 11 | 🟢 |
| 8 | Panels FE — split-pane view + scratchpad timeline (backend exists) | 2-3 | 9 | 🟢 |

**Total:** ~3 weeks focused work to ship a real Phase 13 milestone.

---

## Risk register

| Risk | Severity | Mitigation |
|---|---|---|
| Multi-instance Railway breaks immediately when scaled (local assets, in-process jobs) | 🔴 | Items 2-3 above |
| Production errors invisible (no Sentry) — debugging requires log tail | 🔴 | Item 4 |
| Any user can DoS `/v2/chat/stream` (no rate limit) | 🔴 | Item 4 |
| Frontend bundle (2.58 MB) hurts mobile / TTI | 🟡 | Item 5 |
| Web research answers feel "robotic" without source cards | 🟡 | Item 6 |
| No cost visibility / no budget enforcement → unbounded LLM spend per user | 🟡 | Item 7 |
| pgvector denied on some managed PG offerings | 🟢 | Fallback to Python cosine works |
| Postgres outage → app keeps serving via SQLite fallback (write durability degrades but no app outage) | 🟢 | `MEMORY_PLANE_POSTGRES_REQUIRED=true` opts in to strict mode after migration is stable |

---

## Architecture recommendations

### Infrastructure

| Item | Current | Recommended |
|---|---|---|
| Asset storage | LocalAssetStorage | Cloudflare R2 (S3-compatible, zero egress) |
| Job execution | InlineJobRunner (in-process) | Celery + Redis (Upstash) |
| Error tracking | None | Sentry (FE + BE) |
| Logs | Railway tail | Logflare or Axiom (structured ingestion) |
| Uptime | None | Better Uptime |
| Postgres | Railway managed PG | Keep — works |
| Redis | None | Upstash (broker + cache + presence pub/sub) |
| Sandboxes | None | Modal (preferred) or E2B for `exec_python` |
| Headless browser | None | Browserless or self-hosted Playwright for JS-rendered pages |

### Backend technical debt

| Area | Status | Action |
|---|---|---|
| Root-level SQLite stores (`memory.py`, `db.py`, `usage_limits.py`) | Legacy (Phase M1) | Migrate to Postgres in a future slice (low priority — they work) |
| Multiple memory subsystems (`services/memory`, `services/memory_intelligence`, `services/memory_plane`) | Layered: M1 legacy, v1 in-process, Phase 6 plane | Document the boundary; no rewrite needed. Phase 6 is the canonical one going forward |
| Dispatcher pattern for stores | Adopted in memory_plane | Apply same pattern to jobs/assets when porting to Postgres |

### Frontend technical debt

| Area | Status | Action |
|---|---|---|
| Monolithic bundle (2.58 MB) | 🔴 | `React.lazy` for routes — single highest-leverage change |
| Long-conversation rendering | No virtualization | Add `@tanstack/react-virtual` to chat thread when history > 100 messages |
| Mobile Safari validation | None | Add a tested-on-iPhone gate to PR template after lazy-load lands |
| Vertical page shells (3 pages) | No backend | Either build the verticals or remove the shells until ready |

---

## Scaling recommendations

To go from **single-instance Railway → autoscaled multi-instance**:

1. **R2 for assets** (item 3) — removes per-instance disk dependency.
2. **Celery + Redis for jobs** (item 2) — moves work off the API process.
3. **Postgres for assets metadata + jobs** — already prepped; just port the stores via the same dispatcher pattern as memory_plane.
4. **Sticky SSE sessions or Redis pub/sub for presence** — when Railway has >1 instance, SSE clients need to route to the instance holding their stream OR presence needs to broadcast across instances.
5. **CDN for static FE** (Vercel already does this — keep).

---

## Production-readiness gate (v1.0 checklist)

Items that must be ✅ before opening paid signups:

- [ ] Sentry receives FE + BE errors
- [ ] Rate limiter active on `/v2/chat/stream`, `/v2/orchestrate`, `/v2/files/presign`
- [ ] R2 storage active (no local-disk dependency)
- [ ] Daily Postgres backup automated
- [ ] Restore drill documented + executed once
- [ ] `/v2/db/health` reports `metrics.slow_queries == 0` for 24h
- [ ] Mobile Safari smoke test passes
- [ ] FE bundle gzip < 400 KB initial load
- [ ] Cost visibility per user (basic dashboard)
- [ ] `MEMORY_PLANE_POSTGRES_REQUIRED=true` flipped (no silent fallback in prod)
- [ ] Owner-only memory inspector available for support workflows
- [ ] Documented incident runbook in `docs/runbooks/`

---

## Out-of-scope for v1.0

Phase 9 (multi-agent FE), Phase 10 sandbox tools (`exec_python`), Phase 12 verticals, Phase 14 read replicas, prompt caching, batch API — these are post-launch growth items, not launch blockers. Plan them only after the gate above is passed.

---

## Document lineage

- 2026-05-26 — Original `PROJECT_ROADMAP.md` (Phases 6-15, pre-implementation)
- **2026-05-28 — This document (`PROJECT_ROADMAP_UPDATED.md`)** — post-audit reality check, with Phase 1-5 added and Phase 6 status updated to reflect the slice 1-3 + closure pack work merged

*Living document. Revise after each milestone PR (every 1-2 weeks).*
