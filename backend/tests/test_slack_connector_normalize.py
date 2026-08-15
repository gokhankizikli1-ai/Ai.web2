# coding: utf-8
"""Slack connector — message/thread normalization (pure).

Covers the two observation kinds, the deterministic + state-aware external ids
(so a re-sync deduplicates while a thread that gains replies records once more),
source-time truthfulness, the deliberate absence of a "high" importance, and —
most importantly — everything that is NOT copied into a payload: file data,
attachments, blocks, reactions, member profiles, and unbounded text.
"""
from __future__ import annotations

import json

import pytest

from backend.services.orchestrator.observations_store import (
    IMPORTANCE_LOW, IMPORTANCE_NORMAL,
)
from backend.services.slack import normalize as sl_norm

TS = "1700000000.000100"          # 2023-11-14T22:13:20.000100Z
LATER = "1700000900.000200"


def _message(**kw):
    base = {"type": "message", "ts": TS, "user": "U_HUMAN",
            "text": "Pricing page is broken on mobile"}
    base.update(kw)
    return base


def _norm(message=None, **kw):
    opts = {"team_id": "T1", "channel_id": "C1", "channel_name": "product"}
    opts.update(kw)
    return sl_norm.normalize_message(message or _message(), **opts)


# ── kind, source, registry alignment ─────────────────────────────────────────

def test_source_matches_the_canonical_connector_registry():
    from backend.services.orchestrator import observations_store as obs
    assert sl_norm.SOURCE == "slack"
    assert sl_norm.SOURCE in obs.CONNECTOR_SOURCES


def test_a_channel_message_becomes_slack_message_created():
    o = _norm()
    assert o["kind"] == sl_norm.KIND_MESSAGE_CREATED == "slack.message.created"
    assert o["source"] == "slack"
    assert o["summary"] == "#product: Pricing page is broken on mobile"


def test_only_two_kinds_exist():
    """No invented edit/delete semantics — the provider does not truthfully
    report either with these scopes."""
    kinds = {v for k, v in vars(sl_norm).items() if k.startswith("KIND_")}
    assert kinds == {"slack.message.created", "slack.thread.activity"}


# ── deterministic, idempotent external ids ───────────────────────────────────

def test_message_external_id_is_deterministic_and_channel_scoped():
    assert _norm()["external_id"] == f"slack:message:T1:C1:{TS}"
    # The same message read twice yields the same key → dedup downstream.
    assert _norm()["external_id"] == _norm()["external_id"]
    # ...and the same ts in a different channel is a different observation.
    assert _norm(channel_id="C2")["external_id"] == f"slack:message:T1:C2:{TS}"


def test_external_id_uses_caller_supplied_scope_not_message_content():
    """A crafted message body must never redirect the dedup key or steal channel
    attribution."""
    hostile = _message(team_id="T_EVIL", channel="C_EVIL", channel_id="C_EVIL")
    o = _norm(hostile)
    assert o["external_id"] == f"slack:message:T1:C1:{TS}"
    assert o["payload"]["channel_id"] == "C1"
    assert o["payload"]["team_id"] == "T1"


def test_an_edit_does_not_create_a_second_observation():
    """Slack leaves `ts` unchanged on an edit, so the key is stable — the edit is
    recorded as a flag, never modelled as an event."""
    edited = _message(text="Pricing page is fixed",
                      edited={"user": "U_HUMAN", "ts": LATER})
    assert edited["ts"] == TS
    assert _norm(edited)["external_id"] == _norm()["external_id"]
    assert _norm(edited)["payload"]["was_edited"] is True


# ── source-time truthfulness ────────────────────────────────────────────────

def test_observed_at_is_the_slack_message_time_not_now():
    o = _norm()
    assert o["observed_at"] == "2023-11-14T22:13:20.000100Z"
    assert o["payload"]["message_time"] == o["observed_at"]


def test_an_unparseable_ts_yields_no_invented_time():
    o = _norm(_message(ts="not-a-ts"))
    assert o["observed_at"] == ""   # the store falls back to ingest time


def test_a_message_without_a_ts_is_skipped():
    assert sl_norm.normalize_message({"text": "orphan"}) is None
    assert sl_norm.normalize_message("not a dict") is None


# ── importance policy ────────────────────────────────────────────────────────

def test_human_messages_are_normal_and_bot_messages_are_low():
    assert _norm()["importance"] == IMPORTANCE_NORMAL
    assert _norm(_message(bot_id="B1", user=None))["importance"] == IMPORTANCE_LOW
    assert _norm(_message(subtype="bot_message"))["importance"] == IMPORTANCE_LOW


def test_slack_never_emits_high_importance():
    """Only HIGH observations are promoted into candidate actions by the
    existing Business Brain, so chat must never queue-jump a failed deploy."""
    candidates = [
        _message(), _message(text="URGENT PRODUCTION DOWN!!!"),
        _message(bot_id="B1"), _message(reply_count=99, thread_ts=TS),
    ]
    for m in candidates:
        assert _norm(m)["importance"] in (IMPORTANCE_LOW, IMPORTANCE_NORMAL)
    thread = sl_norm.normalize_thread(
        _message(thread_ts=TS, reply_count=50, latest_reply=LATER), [],
        team_id="T1", channel_id="C1")
    assert thread["importance"] == IMPORTANCE_NORMAL


# ── noise filtering ──────────────────────────────────────────────────────────

@pytest.mark.parametrize("subtype", ["channel_join", "channel_leave",
                                     "channel_topic", "channel_purpose",
                                     "pinned_item", "bot_add"])
def test_membership_and_housekeeping_subtypes_are_dropped(subtype):
    assert _norm(_message(subtype=subtype)) is None


def test_a_meaningful_subtype_survives_and_is_recorded():
    o = _norm(_message(subtype="thread_broadcast", thread_ts="1699999999.000100"))
    assert o is not None
    assert o["payload"]["subtype"] == "thread_broadcast"
    assert o["payload"]["is_thread_reply"] is True


# ── bounded payload / what is NOT ingested ──────────────────────────────────

def test_message_text_is_capped(monkeypatch):
    monkeypatch.setenv("SLACK_MESSAGE_MAX_CHARS", "10")
    o = _norm(_message(text="x" * 500))
    assert o["payload"]["text"] == "x" * 10


def test_text_can_be_dropped_entirely(monkeypatch):
    monkeypatch.setenv("SLACK_MESSAGE_MAX_CHARS", "0")
    o = _norm(_message(text="commercially sensitive"))
    assert "text" not in o["payload"]
    assert "sensitive" not in json.dumps(o)


def test_files_are_never_ingested_only_counted():
    o = _norm(_message(text="", files=[
        {"id": "F1", "name": "salaries.xlsx", "url_private": "https://files.slack/x",
         "mimetype": "application/vnd.ms-excel", "preview": "SECRET"},
        {"id": "F2", "name": "b.png", "url_private_download": "https://files.slack/y"},
    ]))
    body = json.dumps(o)
    assert o["payload"]["file_count"] == 2
    for leaked in ("salaries.xlsx", "files.slack", "url_private", "SECRET",
                   "mimetype", "F1"):
        assert leaked not in body


def test_attachments_blocks_and_reactions_are_never_read():
    o = _norm(_message(
        attachments=[{"text": "third party unfurl", "title_link": "https://x"}],
        blocks=[{"type": "section", "text": {"text": "rich block"}}],
        reactions=[{"name": "fire", "count": 3, "users": ["U1", "U2"]}],
    ))
    body = json.dumps(o)
    for leaked in ("unfurl", "rich block", "reactions", "fire", "title_link"):
        assert leaked not in body


def test_only_an_opaque_author_id_is_kept_never_a_profile():
    o = _norm(_message(user="U_HUMAN", user_profile={
        "real_name": "Ada Lovelace", "email": "ada@example.com",
        "phone": "+15551234", "image_512": "https://avatars/x"}))
    body = json.dumps(o)
    assert o["payload"]["user_id"] == "U_HUMAN"
    for leaked in ("Ada Lovelace", "ada@example.com", "+15551234", "avatars"):
        assert leaked not in body


def test_no_permalink_is_invented():
    """A permalink needs an extra request per message (or a workspace domain we
    do not have), so the payload carries the ids instead of a guessed URL."""
    o = _norm()
    assert "permalink" not in json.dumps(o)
    assert {"team_id", "channel_id", "ts"} <= set(o["payload"])


def test_summary_is_single_line_and_bounded():
    o = _norm(_message(text="line one\nline two\r\nline three " + "y" * 500))
    assert "\n" not in o["summary"]
    assert len(o["summary"]) <= 240


def test_summary_falls_back_when_a_message_has_no_text():
    assert _norm(_message(text=""))["summary"] == "#product: message from U_HUMAN"
    assert _norm(_message(text="", files=[{"id": "F1"}]))["summary"] == \
        "#product: shared 1 file"


def test_channel_label_falls_back_to_the_id():
    assert _norm(channel_name="")["summary"].startswith("C1:")


# ── batch behaviour ──────────────────────────────────────────────────────────

def test_batch_skips_malformed_and_noise_without_aborting():
    out = sl_norm.normalize_messages(
        [_message(ts="1.1"), {"no": "ts"}, _message(ts="2.2", subtype="channel_join"),
         "junk", _message(ts="3.3")],
        team_id="T1", channel_id="C1")
    assert [o["payload"]["ts"] for o in out] == ["1.1", "3.3"]
    assert sl_norm.normalize_messages([], team_id="T1", channel_id="C1") == []


# ── threads ──────────────────────────────────────────────────────────────────

def _parent(**kw):
    base = {"ts": TS, "thread_ts": TS, "user": "U_HUMAN", "text": "Ship the fix?",
            "reply_count": 3, "reply_users_count": 2, "latest_reply": LATER}
    base.update(kw)
    return base


def test_has_thread_only_matches_a_parent_with_replies():
    assert sl_norm.has_thread(_parent()) is True
    assert sl_norm.has_thread(_parent(reply_count=0)) is False
    assert sl_norm.has_thread(_message()) is False                    # unthreaded
    assert sl_norm.has_thread(_message(thread_ts="1699999999.1")) is False  # a reply
    assert sl_norm.has_thread(None) is False


def test_thread_activity_carries_a_bounded_reply_preview(monkeypatch):
    monkeypatch.setenv("SLACK_SYNC_THREAD_MAX_REPLIES", "2")
    replies = [{"ts": f"17000005{i:02d}.0", "user": f"U{i}", "text": f"r{i}"}
               for i in range(6)]
    o = sl_norm.normalize_thread(_parent(), replies, team_id="T1",
                                 channel_id="C1", channel_name="product")
    assert o["kind"] == "slack.thread.activity"
    assert o["payload"]["reply_count"] == 3          # Slack's true total
    assert o["payload"]["replies_sampled"] == 2      # what we actually copied
    assert [r["ts"] for r in o["payload"]["replies"]] == ["1700000500.0", "1700000501.0"]
    assert o["summary"] == "#product: thread with 3 replies — Ship the fix?"


def test_thread_observed_at_is_the_latest_reply_time():
    o = sl_norm.normalize_thread(_parent(), [], team_id="T1", channel_id="C1")
    assert o["observed_at"] == sl_norm.ts_to_iso(LATER)
    assert o["payload"]["latest_reply_ts"] == LATER


def test_thread_external_id_is_state_aware():
    """Unchanged thread → dedup. New reply → a new observation."""
    first = sl_norm.normalize_thread(_parent(), [], team_id="T1", channel_id="C1")
    same = sl_norm.normalize_thread(_parent(), [], team_id="T1", channel_id="C1")
    grew = sl_norm.normalize_thread(_parent(reply_count=4, latest_reply="1700001000.0"),
                                    [], team_id="T1", channel_id="C1")
    assert first["external_id"] == same["external_id"]
    assert first["external_id"] == f"slack:thread:T1:C1:{TS}:{LATER}"
    assert grew["external_id"] != first["external_id"]


def test_thread_falls_back_to_reply_count_when_slack_omits_latest_reply():
    parent = _parent()
    parent.pop("latest_reply")
    o = sl_norm.normalize_thread(parent, [], team_id="T1", channel_id="C1")
    assert o["external_id"].endswith(":3")
    assert o["observed_at"] == sl_norm.ts_to_iso(TS)


def test_thread_replies_respect_the_text_cap(monkeypatch):
    monkeypatch.setenv("SLACK_MESSAGE_MAX_CHARS", "4")
    o = sl_norm.normalize_thread(_parent(text="x" * 50),
                                 [{"ts": "1.0", "user": "U1", "text": "y" * 50}],
                                 team_id="T1", channel_id="C1")
    assert o["payload"]["parent_text"] == "xxxx"
    assert o["payload"]["replies"][0]["text"] == "yyyy"


def test_thread_replies_never_carry_files_or_profiles():
    o = sl_norm.normalize_thread(
        _parent(),
        [{"ts": "1.0", "user": "U1", "text": "see attached",
          "files": [{"name": "secret.pdf", "url_private": "https://f"}],
          "user_profile": {"email": "a@b.c"}}],
        team_id="T1", channel_id="C1")
    body = json.dumps(o)
    for leaked in ("secret.pdf", "url_private", "a@b.c"):
        assert leaked not in body


def test_non_thread_input_yields_no_thread_observation():
    assert sl_norm.normalize_thread(_message(), [], team_id="T1", channel_id="C1") is None
    assert sl_norm.normalize_thread(_parent(reply_count=0), [],
                                    team_id="T1", channel_id="C1") is None


# ── ts helper ────────────────────────────────────────────────────────────────

def test_ts_to_iso_round_trip_and_defensiveness():
    assert sl_norm.ts_to_iso("1700000000.000000") == "2023-11-14T22:13:20Z"
    assert sl_norm.ts_to_iso("") == ""
    assert sl_norm.ts_to_iso(None) == ""
    assert sl_norm.ts_to_iso("abc") == ""
    assert sl_norm.ts_to_iso("99999999999999999999") == ""
