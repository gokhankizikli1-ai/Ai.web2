# coding: utf-8
"""Gmail message normalization — PURE, zero I/O.

Turns a Gmail `users.messages.get` (format=metadata) resource into a
`NormalizedObservation` dict shaped to `observations_store.record_observation`'s
existing contract — no new storage schema. Mirrors `github.normalize`.

The returned dict is connector-neutral EVIDENCE only. It never says "create a
task", "reply", or "act". Whether it matters is the deterministic Business
Brain's decision, downstream.

DETERMINISTIC external_id (idempotency key)
-------------------------------------------
`external_id` is the Gmail message id, which is stable for the life of the
message. The observation store's UNIQUE(user, project, source, external_id)
index means re-running a sync (or overlapping syncs) writes NO duplicate.

BOUNDED PAYLOAD
---------------
Only small structured metadata is copied: message/thread ids, From/Subject/Date
headers, a bounded snippet, and label ids. NEVER the full body, NEVER
attachments. The snippet is truncated to `config.snippet_max_chars`.

COST: pure functions. ZERO model tokens, ZERO embeddings, ZERO network.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from backend.services.gmail import config as gm_config
from backend.services.orchestrator.observations_store import (
    IMPORTANCE_LOW, IMPORTANCE_NORMAL,
)

SOURCE = "gmail"
KIND_MESSAGE = "gmail.message.received"

_SUMMARY_MAX = 240
_SUBJECT_MAX = 200
_ADDR_MAX = 200


def _s(v: Any, limit: int = 0) -> str:
    out = "" if v is None else str(v)
    return out[:limit] if limit else out


def _headers_map(message: Dict[str, Any]) -> Dict[str, str]:
    """Lower-cased header name → value, from the metadata payload."""
    out: Dict[str, str] = {}
    payload = message.get("payload") if isinstance(message, dict) else None
    headers = (payload or {}).get("headers") if isinstance(payload, dict) else None
    if isinstance(headers, list):
        for h in headers:
            if isinstance(h, dict) and h.get("name"):
                out[str(h["name"]).strip().lower()] = str(h.get("value") or "")
    return out


def _observed_at(message: Dict[str, Any], headers: Dict[str, str]) -> str:
    """Prefer Gmail's `internalDate` (epoch ms) as the source time; fall back to
    the Date header string, else empty (the store defaults to ingest time)."""
    internal = message.get("internalDate")
    if internal not in (None, ""):
        try:
            ms = int(internal)
            dt = datetime.fromtimestamp(ms / 1000.0, tz=timezone.utc)
            return dt.isoformat().replace("+00:00", "Z")
        except (TypeError, ValueError, OverflowError, OSError):
            pass
    return _s(headers.get("date"), 80)


def normalize_message(message: Dict[str, Any], *,
                      connection_email: str = "") -> Optional[Dict[str, Any]]:
    """Normalize one Gmail metadata message into an observation dict, or None
    when the input is malformed (no id)."""
    if not isinstance(message, dict) or not message.get("id"):
        return None
    msg_id = _s(message.get("id"))
    thread_id = _s(message.get("threadId"))
    headers = _headers_map(message)
    subject = _s(headers.get("subject"), _SUBJECT_MAX)
    sender = _s(headers.get("from"), _ADDR_MAX)
    snippet_cap = gm_config.snippet_max_chars()
    snippet = _s(message.get("snippet"), snippet_cap) if snippet_cap else ""
    label_ids = [str(x) for x in (message.get("labelIds") or []) if isinstance(x, (str, int))]
    observed_at = _observed_at(message, headers)

    # Unread mail is slightly more salient as fresh activity; read/archived is
    # low-importance evidence. This is an advisory hint only.
    importance = IMPORTANCE_NORMAL if "UNREAD" in label_ids else IMPORTANCE_LOW

    summary = f"Email: {subject or '(no subject)'}"
    if sender:
        summary = f"{summary} — from {sender}"

    payload: Dict[str, Any] = {
        "provider": SOURCE,
        "message_id": msg_id,
        "thread_id": thread_id,
        "from": sender,
        "subject": subject,
        "snippet": snippet,
        "label_ids": label_ids,
        "connection_email": _s(connection_email, _ADDR_MAX),
    }
    return {
        "source": SOURCE,
        "kind": KIND_MESSAGE,
        "external_id": msg_id,  # stable Gmail message id → dedup key
        "summary": _s(summary, _SUMMARY_MAX),
        "observed_at": observed_at,
        "importance": importance,
        "payload": payload,
    }


def normalize_messages(messages: List[Dict[str, Any]], *,
                       connection_email: str = "") -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for m in messages or []:
        o = normalize_message(m, connection_email=connection_email)
        if o:
            out.append(o)
    return out


__all__ = ["SOURCE", "KIND_MESSAGE", "normalize_message", "normalize_messages"]
