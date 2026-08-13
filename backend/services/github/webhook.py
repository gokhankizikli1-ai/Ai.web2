# coding: utf-8
"""GitHub connector — webhook ingestion (incremental event path).

SECURITY — FAIL CLOSED (mirrors the billing webhook contract)
-------------------------------------------------------------
GitHub signs each delivery with HMAC-SHA256 over the RAW request body using the
App's webhook secret, sent as `X-Hub-Signature-256: sha256=<hexdigest>`.
Verification runs against the EXACT bytes received (never a re-serialized copy),
uses `hmac.compare_digest` (constant-time), and rejects:
  * a missing/empty configured secret (endpoint cannot authenticate → 503 upstream)
  * a missing / malformed / wrong-scheme signature header
  * a digest mismatch

NOTHING in the payload — repository name, installation id, sender, event type —
is trusted until the signature verifies. Only after authentication do we parse
JSON, dedup the delivery id, resolve the owning project, and record.

WEBHOOK → normalize → record_observation, FULL STOP
---------------------------------------------------
A verified webhook creates NO task, decision, plan, run, or model call. It maps
the event to normalized observations (via `normalize`) and records them under
the resolved connection's (user, project) scope. Idempotency is double-layered:
the delivery-id dedup drops a redelivered webhook, and the store's
`external_id` uniqueness drops a duplicate observation even across sync overlap.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from backend.services.github import config as gh_config
from backend.services.github import normalize, store
from backend.services.github.ingest import ingest_many

logger = logging.getLogger(__name__)

_SIG_HEADER = "x-hub-signature-256"
_EVENT_HEADER = "x-github-event"
_DELIVERY_HEADER = "x-github-delivery"


# ── signature verification ───────────────────────────────────────────────────

def compute_signature(raw_body: bytes, secret: str) -> str:
    """`sha256=<hexdigest>` — the exact form GitHub sends."""
    digest = hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()
    return f"sha256={digest}"


def verify_signature(raw_body: bytes, signature_header: str, secret: str) -> bool:
    """Constant-time verify. Any defect ⇒ False (never raises); the secret is
    never logged."""
    if not secret or not signature_header:
        return False
    provided = signature_header.strip()
    if not provided.lower().startswith("sha256="):
        return False
    try:
        expected = compute_signature(raw_body, secret)
        # Compare the full "sha256=<hex>" strings, both ASCII, constant-time.
        return hmac.compare_digest(expected, provided.lower())
    except Exception as exc:  # pragma: no cover — defensive, no secret leak
        logger.warning("github.webhook.verify failed: %s", type(exc).__name__)
        return False


# ── result type ──────────────────────────────────────────────────────────────

@dataclass
class WebhookResult:
    status: str                       # "recorded" | "duplicate" | "ignored" | "rejected"
    event: str = ""
    delivery_id: str = ""
    recorded: int = 0
    deduplicated: int = 0
    projects: List[str] = field(default_factory=list)
    reason: str = ""

    def as_dict(self) -> Dict[str, Any]:
        return {
            "status": self.status,
            "event": self.event,
            "delivery_id": self.delivery_id,
            "recorded": self.recorded,
            "deduplicated": self.deduplicated,
            "projects": list(self.projects),
            "reason": self.reason,
        }


# ── the handler (pure w.r.t. HTTP: takes bytes + headers) ────────────────────

def handle_delivery(*, raw_body: bytes, event: str, delivery_id: str) -> WebhookResult:
    """Process a SIGNATURE-VERIFIED delivery. The route verifies the signature
    (and enforces the body cap) BEFORE calling this — this function assumes the
    bytes are authenticated and focuses on dedup → route → normalize → record.

    Returns a WebhookResult; never raises."""
    event = (event or "").strip().lower()

    # Parse (already-authenticated) JSON.
    try:
        payload = json.loads(raw_body.decode("utf-8", errors="replace")) if raw_body else {}
    except (json.JSONDecodeError, UnicodeDecodeError):
        return WebhookResult(status="rejected", event=event, delivery_id=delivery_id,
                             reason="malformed JSON")
    if not isinstance(payload, dict):
        return WebhookResult(status="rejected", event=event, delivery_id=delivery_id,
                             reason="payload not an object")

    # A `ping` (or any unsupported event) is acknowledged and ignored — never
    # an error, so GitHub does not retry it.
    if event == "ping" or event not in normalize.SUPPORTED_WEBHOOK_EVENTS:
        return WebhookResult(status="ignored", event=event, delivery_id=delivery_id,
                             reason="unsupported event")

    # Delivery-id dedup — a redelivered webhook is acknowledged as a duplicate
    # and NOT reprocessed.
    if not store.mark_delivery(delivery_id):
        return WebhookResult(status="duplicate", event=event, delivery_id=delivery_id,
                             reason="delivery already processed")

    # Resolve which project owns this repo under this installation. Untrusted
    # fields are used ONLY as lookup keys against our own connection table — an
    # unknown repo/installation resolves to nothing and is safely ignored.
    installation = payload.get("installation") if isinstance(payload.get("installation"), dict) else {}
    repo = payload.get("repository") if isinstance(payload.get("repository"), dict) else {}
    installation_id = str(installation.get("id") or "").strip()
    repo_full = str(repo.get("full_name") or "").strip()
    repo_id = str(repo.get("id") or "").strip()

    if not installation_id or not (repo_full or repo_id):
        return WebhookResult(status="ignored", event=event, delivery_id=delivery_id,
                             reason="missing installation/repository")

    connections = store.find_connections_for_repo(
        installation_id=installation_id, repo_full_name=repo_full, repo_id=repo_id)
    if not connections:
        return WebhookResult(status="ignored", event=event, delivery_id=delivery_id,
                             reason="no project connected to this repo/installation")

    normalized = normalize.normalize_webhook_event(event, payload)
    if not normalized:
        return WebhookResult(status="ignored", event=event, delivery_id=delivery_id,
                             reason="event produced no observation")

    total_recorded = 0
    total_dedup = 0
    touched: List[str] = []
    for conn in connections:
        res = ingest_many(conn, normalized)
        total_recorded += res.recorded
        total_dedup += res.deduplicated
        touched.append(conn.project_id)

    status = "recorded" if total_recorded else ("duplicate" if total_dedup else "ignored")
    return WebhookResult(
        status=status, event=event, delivery_id=delivery_id,
        recorded=total_recorded, deduplicated=total_dedup, projects=touched,
        reason="" if total_recorded else "all observations already present",
    )


__all__ = [
    "compute_signature", "verify_signature", "handle_delivery", "WebhookResult",
]
