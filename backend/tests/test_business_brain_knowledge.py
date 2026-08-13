# coding: utf-8
"""Business Brain — Phase 3: typed BUSINESS KNOWLEDGE on the Memory Plane.

Proves business knowledge reuses the EXISTING Memory Plane (no parallel memory
DB): typed domains, temporal/staleness semantics for external facts, capability
projection, semantic recall scope, and cross-user/project isolation. Decisions
stay owned by decisions_store (there is no `decision` knowledge domain).
"""
from __future__ import annotations

import pytest

from backend.services.orchestrator import business_knowledge as bk


@pytest.fixture()
def mp(tmp_memory_plane_db):
    # tmp_memory_plane_db isolates MEMORY_PLANE_DB_PATH + inits the schema.
    return bk


def test_business_and_customer_facts_persist(mp):
    a = mp.record_knowledge(user_id="u1", project_id="p1", domain=mp.DOMAIN_BUSINESS,
                            summary="We are a B2B SaaS for small agencies", source="USER")
    b = mp.record_knowledge(user_id="u1", project_id="p1", domain=mp.DOMAIN_CUSTOMER,
                            summary="Target customer: independent restaurants", source="RESEARCH")
    assert a and b
    rows = mp.list_knowledge(user_id="u1", project_id="p1")
    summaries = {r["summary"] for r in rows}
    assert "We are a B2B SaaS for small agencies" in summaries
    assert "Target customer: independent restaurants" in summaries
    domains = {r["domain"] for r in rows}
    assert {mp.DOMAIN_BUSINESS, mp.DOMAIN_CUSTOMER} <= domains


def test_competitor_fact_is_external_and_timestamped(mp):
    mp.record_knowledge(user_id="u1", project_id="p1", domain=mp.DOMAIN_COMPETITOR,
                        summary="Competitor charges $19/mo", source="RESEARCH")
    rows = mp.list_knowledge(user_id="u1", project_id="p1", domains=[mp.DOMAIN_COMPETITOR])
    assert len(rows) == 1
    r = rows[0]
    assert r["external"] is True
    assert r["observed_at"]                 # time-stamped
    assert r["expires_at"]                  # staleness enabled (TTL applied)


def test_stale_external_knowledge_is_evicted(mp):
    # A short-TTL external fact ages out via the Memory Plane's OWN eviction —
    # we don't re-implement time math. Force the eviction clock into the
    # future and assert the stale fact no longer resurfaces as current, while
    # a no-TTL internal fact survives.
    mp.record_knowledge(user_id="u1", project_id="p1", domain=mp.DOMAIN_COMPETITOR,
                        summary="OLD competitor price $9", source="RESEARCH",
                        ttl_seconds=1)
    mp.record_knowledge(user_id="u1", project_id="p1", domain=mp.DOMAIN_BUSINESS,
                        summary="DURABLE company fact", source="USER")
    from backend.services.memory_plane import store as mp_store
    mp_store.expire_due(now="2999-01-01T00:00:00Z")   # deterministic future clock
    rows = {r["summary"] for r in mp.list_knowledge(user_id="u1", project_id="p1")}
    assert "OLD competitor price $9" not in rows      # stale fact evicted
    assert "DURABLE company fact" in rows             # durable fact survives


def test_learning_persists_and_defaults_high_importance(mp):
    lid = mp.record_learning(user_id="u1", project_id="p1",
                             summary="Simpler onboarding was followed by higher activation",
                             source="EXPERIMENT", source_ref="exp1")
    assert lid
    rows = mp.list_knowledge(user_id="u1", project_id="p1", domains=[mp.DOMAIN_LEARNING])
    assert rows and rows[0]["domain"] == mp.DOMAIN_LEARNING
    assert rows[0]["importance"] >= 0.7


def test_capability_projection_excludes_irrelevant_domain(mp):
    mp.record_knowledge(user_id="u1", project_id="p1", domain=mp.DOMAIN_COMPETITOR,
                        summary="Competitor launched a theme feature", source="RESEARCH")
    mp.record_knowledge(user_id="u1", project_id="p1", domain=mp.DOMAIN_CUSTOMER,
                        summary="Customers want faster onboarding", source="RESEARCH")
    # research receives competitor + customer.
    research = mp.knowledge_for_capability(user_id="u1", project_id="p1",
                                           capability="research")
    domains = {r["domain"] for r in research}
    assert mp.DOMAIN_CUSTOMER in domains and mp.DOMAIN_COMPETITOR in domains
    # An app_build capability has NO mapped knowledge domains → empty slice
    # (build context never drowns in research/competitor prose).
    assert mp.knowledge_for_capability(user_id="u1", project_id="p1",
                                       capability="app_build") == []


def test_growth_receives_learning(mp):
    mp.record_learning(user_id="u1", project_id="p1",
                       summary="Referral incentive was followed by more signups")
    growth = mp.knowledge_for_capability(user_id="u1", project_id="p1",
                                         capability="growth")
    assert any(r["domain"] == mp.DOMAIN_LEARNING for r in growth)


def test_semantic_recall_scoped(mp):
    mp.record_knowledge(user_id="u1", project_id="p1", domain=mp.DOMAIN_CUSTOMER,
                        summary="restaurants struggle with inventory waste", source="RESEARCH")
    hits = mp.recall_knowledge(user_id="u1", project_id="p1", query="inventory")
    assert any("inventory" in h["summary"] for h in hits)
    # Recall never crosses into another project.
    assert mp.recall_knowledge(user_id="u1", project_id="pX", query="inventory") == []


def test_decision_is_not_a_knowledge_domain(mp):
    # Decisions remain owned by decisions_store — there is no `decision`
    # business-knowledge domain, and an unknown domain coerces to business.
    assert "decision" not in bk.DOMAINS
    assert bk.normalize_domain("decision") == bk.DOMAIN_BUSINESS


def test_cross_user_isolation(mp):
    mp.record_knowledge(user_id="u1", project_id="p1", domain=mp.DOMAIN_BUSINESS,
                        summary="u1 secret", source="USER")
    mp.record_knowledge(user_id="u2", project_id="p1", domain=mp.DOMAIN_BUSINESS,
                        summary="u2 secret", source="USER")
    u1 = {r["summary"] for r in mp.list_knowledge(user_id="u1", project_id="p1")}
    u2 = {r["summary"] for r in mp.list_knowledge(user_id="u2", project_id="p1")}
    assert "u1 secret" in u1 and "u2 secret" not in u1
    assert "u2 secret" in u2 and "u1 secret" not in u2


def test_cross_project_isolation(mp):
    mp.record_knowledge(user_id="u1", project_id="pA", domain=mp.DOMAIN_BUSINESS,
                        summary="A-only", source="USER")
    mp.record_knowledge(user_id="u1", project_id="pB", domain=mp.DOMAIN_BUSINESS,
                        summary="B-only", source="USER")
    a = {r["summary"] for r in mp.list_knowledge(user_id="u1", project_id="pA")}
    assert a == {"A-only"}


def test_knowledge_write_never_forces_embedding(mp, monkeypatch):
    # Even with the Memory Plane embedding service forced ON, a business-
    # knowledge write must incur ZERO model/provider cost (auto_embed=False).
    import backend.services.memory_plane.embedding as emb
    calls = {"n": 0}

    async def _boom(*a, **k):
        calls["n"] += 1
        raise RuntimeError("embedding must not be called")

    monkeypatch.setattr(emb, "is_enabled", lambda: True)
    monkeypatch.setattr(emb, "embed", _boom)
    rid = mp.record_knowledge(user_id="u1", project_id="p1",
                              domain=mp.DOMAIN_CUSTOMER, summary="a durable fact")
    assert rid                      # stored via the deterministic path
    assert calls["n"] == 0          # no embedding attempted


def test_empty_summary_rejected(mp):
    assert mp.record_knowledge(user_id="u1", project_id="p1",
                               domain=mp.DOMAIN_BUSINESS, summary="  ") is None
