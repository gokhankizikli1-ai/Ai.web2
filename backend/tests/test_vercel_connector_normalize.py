# coding: utf-8
"""Vercel normalization — pure, deterministic, bounded, timestamp-truthful.

The properties the Business Brain depends on:
  * kinds + importance follow the EXISTING three-level vocabulary (a production
    failure is the strongest signal this connector can raise);
  * `external_id` is deterministic AND state-transition aware, so a re-sync
    dedups while a real transition records;
  * `observed_at` is Vercel's own timestamp, so a historical backfill stays
    historical and never masquerades as fresh activity;
  * in-flight builds are NOT observed;
  * payloads are bounded and picked field-by-field — env var metadata/values and
    build logs can never leak into an observation;
  * git commit metadata survives as STRUCTURE (so Project Brain can correlate a
    failed production deploy with a GitHub commit later).

Pure functions: no network, no DB, no model calls.
"""
from __future__ import annotations

from backend.services.orchestrator.observations_store import (
    IMPORTANCE_HIGH, IMPORTANCE_LOW, IMPORTANCE_NORMAL,
)
from backend.services.vercel import normalize as vn

# 2023-11-14T22:13:20Z
READY_MS = 1700000000000
CREATED_MS = 1699999000000


def _deployment(**kw):
    base = {
        "uid": "dpl_1",
        "name": "korvix-site",
        "url": "korvix-site-abc.vercel.app",
        "state": "READY",
        "target": "production",
        "created": CREATED_MS,
        "ready": READY_MS,
        "buildingAt": CREATED_MS,
        "inspectorUrl": "https://vercel.com/acme/korvix-site/dpl_1",
        "creator": {"username": "gokhan"},
        "meta": {
            "githubCommitSha": "abc123def456",
            "githubCommitRef": "main",
            "githubCommitMessage": "Ship pricing page\nsecond line",
            "githubCommitAuthorName": "Gokhan",
            "githubRepo": "ai.web2",
            "githubOrg": "gokhankizikli1-ai",
        },
    }
    base.update(kw)
    return base


# ── kinds + importance ───────────────────────────────────────────────────────

def test_production_ready_is_a_normal_signal():
    o = vn.normalize_deployment(_deployment(), vercel_project_id="prj_1")
    assert o["source"] == "vercel"
    assert o["kind"] == vn.KIND_DEPLOYMENT_READY
    assert o["importance"] == IMPORTANCE_NORMAL
    assert o["payload"]["target"] == "production"


def test_production_error_is_high_importance():
    o = vn.normalize_deployment(_deployment(state="ERROR"), vercel_project_id="prj_1")
    assert o["kind"] == vn.KIND_DEPLOYMENT_ERROR
    assert o["importance"] == IMPORTANCE_HIGH
    assert "FAILED" in o["summary"]


def test_preview_success_is_low_and_preview_failure_is_normal():
    ok = vn.normalize_deployment(_deployment(target=None), vercel_project_id="prj_1")
    bad = vn.normalize_deployment(_deployment(target=None, state="ERROR"),
                                  vercel_project_id="prj_1")
    assert ok["importance"] == IMPORTANCE_LOW
    assert ok["payload"]["target"] == "preview"
    assert bad["importance"] == IMPORTANCE_NORMAL


def test_canceled_is_low_importance_whatever_the_target():
    for target in ("production", None):
        o = vn.normalize_deployment(_deployment(target=target, state="CANCELED"),
                                    vercel_project_id="prj_1")
        assert o["kind"] == vn.KIND_DEPLOYMENT_CANCELED
        assert o["importance"] == IMPORTANCE_LOW


def test_in_flight_deployments_are_not_observed():
    for state in ("BUILDING", "QUEUED", "INITIALIZING", ""):
        assert vn.normalize_deployment(_deployment(state=state),
                                       vercel_project_id="prj_1") is None


def test_ready_state_falls_back_to_readystate_field():
    d = _deployment()
    d.pop("state")
    d["readyState"] = "ERROR"
    o = vn.normalize_deployment(d, vercel_project_id="prj_1")
    assert o["kind"] == vn.KIND_DEPLOYMENT_ERROR


def test_malformed_input_is_rejected():
    assert vn.normalize_deployment({}, vercel_project_id="prj_1") is None
    assert vn.normalize_deployment(None, vercel_project_id="prj_1") is None
    assert vn.normalize_deployment("nope", vercel_project_id="prj_1") is None


# ── idempotency + state transitions ──────────────────────────────────────────

def test_external_id_is_deterministic():
    a = vn.normalize_deployment(_deployment(), vercel_project_id="prj_1")
    b = vn.normalize_deployment(_deployment(), vercel_project_id="prj_1")
    assert a["external_id"] == b["external_id"] == "vercel:deployment:prj_1:dpl_1:ready"


def test_state_transition_produces_a_new_external_id():
    ready = vn.normalize_deployment(_deployment(), vercel_project_id="prj_1")
    err = vn.normalize_deployment(_deployment(state="ERROR"), vercel_project_id="prj_1")
    assert ready["external_id"] != err["external_id"]


def test_external_id_is_scoped_per_vercel_project():
    a = vn.normalize_deployment(_deployment(), vercel_project_id="prj_1")
    b = vn.normalize_deployment(_deployment(), vercel_project_id="prj_2")
    assert a["external_id"] != b["external_id"]


# ── source-time truth ────────────────────────────────────────────────────────

def test_observed_at_is_the_provider_timestamp_not_now():
    o = vn.normalize_deployment(_deployment(), vercel_project_id="prj_1")
    assert o["observed_at"] == "2023-11-14T22:13:20Z"
    assert o["payload"]["created_at"].startswith("2023-11-")


def test_failed_deployment_uses_its_build_start_time():
    o = vn.normalize_deployment(_deployment(state="ERROR", ready=None),
                                vercel_project_id="prj_1")
    assert o["observed_at"] == "2023-11-14T21:56:40Z"


def test_missing_timestamps_yield_empty_not_invented_time():
    d = _deployment(ready=None, buildingAt=None, created=None)
    d.pop("createdAt", None)
    o = vn.normalize_deployment(d, vercel_project_id="prj_1")
    assert o["observed_at"] == ""   # the store falls back to ingest time


def test_unparseable_timestamp_is_ignored():
    o = vn.normalize_deployment(_deployment(ready="not-a-number", buildingAt=None,
                                            created=None), vercel_project_id="prj_1")
    assert o["observed_at"] == ""


# ── bounded payload / no secret leakage ─────────────────────────────────────

def test_payload_carries_only_picked_fields_never_env_or_logs():
    hostile = _deployment()
    # Even if Vercel ever returned these on a list item, normalization must not
    # copy them: fields are picked explicitly, never spread.
    hostile["env"] = [{"key": "STRIPE_SECRET", "value": "sk_live_XXXX"}]
    hostile["logs"] = "a" * 100000
    hostile["build"] = {"env": ["DATABASE_URL"]}
    o = vn.normalize_deployment(hostile, vercel_project_id="prj_1")
    blob = str(o)
    assert "sk_live_XXXX" not in blob
    assert "STRIPE_SECRET" not in blob
    assert "DATABASE_URL" not in blob
    assert len(blob) < 2000


def test_commit_message_is_first_line_and_capped():
    o = vn.normalize_deployment(_deployment(), vercel_project_id="prj_1")
    assert o["payload"]["git"]["commit_message"] == "Ship pricing page"


def test_summary_is_bounded():
    o = vn.normalize_deployment(_deployment(name="x" * 900), vercel_project_id="prj_1")
    assert len(o["summary"]) <= 240


def test_deployment_url_is_absolute():
    o = vn.normalize_deployment(_deployment(), vercel_project_id="prj_1")
    assert o["payload"]["url"] == "https://korvix-site-abc.vercel.app"
    already = vn.normalize_deployment(_deployment(url="https://x.dev"),
                                      vercel_project_id="prj_1")
    assert already["payload"]["url"] == "https://x.dev"


# ── git correlation structure (evidence, not an engine) ─────────────────────

def test_git_metadata_is_preserved_as_structure():
    o = vn.normalize_deployment(_deployment(), vercel_project_id="prj_1")
    git = o["payload"]["git"]
    assert git["commit_sha"] == "abc123def456"
    assert git["ref"] == "main"
    assert git["repo"] == "gokhankizikli1-ai/ai.web2"
    assert git["commit_author"] == "Gokhan"
    # The ref is surfaced in the human summary too.
    assert "(main)" in o["summary"]


def test_cli_deployment_without_git_metadata_is_still_normalized():
    d = _deployment()
    d.pop("meta")
    o = vn.normalize_deployment(d, vercel_project_id="prj_1")
    assert o is not None and "git" not in o["payload"]


def test_non_github_git_provider_metadata_is_read():
    d = _deployment(meta={"gitlabCommitSha": "deadbeef", "gitlabCommitRef": "trunk"})
    o = vn.normalize_deployment(d, vercel_project_id="prj_1")
    assert o["payload"]["git"]["commit_sha"] == "deadbeef"
    assert o["payload"]["git"]["ref"] == "trunk"


# ── project resource ─────────────────────────────────────────────────────────

def _project(**kw):
    base = {
        "id": "prj_1", "name": "korvix-site", "framework": "nextjs",
        "createdAt": CREATED_MS, "updatedAt": READY_MS,
        "targets": {"production": {"alias": ["korvixai.com", "x.vercel.app"]}},
        "link": {"type": "github", "repo": "ai.web2", "org": "gokhankizikli1-ai"},
        # Present on some Vercel project payloads — must NEVER be copied.
        "env": [{"key": "STRIPE_SECRET", "value": "sk_live_XXXX", "type": "encrypted"}],
    }
    base.update(kw)
    return base


def test_project_observation_is_low_importance_identity_evidence():
    o = vn.normalize_project(_project())
    assert o["kind"] == vn.KIND_PROJECT_UPDATED
    assert o["importance"] == IMPORTANCE_LOW
    assert o["payload"]["production_url"] == "https://korvixai.com"
    assert o["payload"]["framework"] == "nextjs"
    assert o["payload"]["git_repo"] == "gokhankizikli1-ai/ai.web2"
    assert o["observed_at"] == "2023-11-14T22:13:20Z"


def test_project_observation_never_carries_env_values():
    blob = str(vn.normalize_project(_project()))
    assert "sk_live_XXXX" not in blob and "STRIPE_SECRET" not in blob


def test_project_external_id_dedups_unchanged_and_records_a_change():
    same = vn.normalize_project(_project())["external_id"]
    again = vn.normalize_project(_project())["external_id"]
    changed = vn.normalize_project(_project(updatedAt=READY_MS + 1))["external_id"]
    assert same == again != changed


def test_project_without_id_is_rejected():
    assert vn.normalize_project({"name": "x"}) is None
    assert vn.normalize_project(None) is None


def test_project_identity_reads_only_display_fields():
    ident = vn.project_identity(_project())
    assert set(ident) == {"id", "name", "framework", "production_url"}


def test_production_url_falls_back_to_alias_list():
    assert vn.production_url({"alias": ["a.vercel.app"]}) == "https://a.vercel.app"
    assert vn.production_url({"alias": [{"domain": "b.dev"}]}) == "https://b.dev"
    assert vn.production_url({"targets": {"production": {"url": "c.dev"}}}) == "https://c.dev"
    assert vn.production_url({}) == ""


def test_normalize_deployments_skips_unusable_items():
    out = vn.normalize_deployments(
        [_deployment(), {"uid": "x", "state": "BUILDING"}, {}, None],
        vercel_project_id="prj_1")
    assert len(out) == 1
