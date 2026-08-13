# coding: utf-8
"""Business Brain — Phase 5: MEASURE. Generic timestamped metrics + change.

A small, truthful measurement foundation — NOT an analytics warehouse, OLAP
engine, or a GA4/PostHog/Stripe connector. It stores generic, timestamped,
(user, project)-scoped metric observations and offers DETERMINISTIC change
detection so Korvix can answer "what changed?" without pretending to know why.

SEPARATION OF CONCERNS (mandatory)
----------------------------------
This module records OBSERVATIONS only. An observation ("signup conversion fell
7.2% → 4.8%") is not a HYPOTHESIS ("pricing CTA may be related") and not a
DECISION ("investigate pricing CTA"). Those live in Phase-2 candidate actions /
`decisions_store`. A metric row never carries a cause.

COST REUSE (no duplicate ledger)
--------------------------------
Real cost/usage truth already lives in `backend.services.cost_tracking`. This
module does NOT re-record cost. A Business Brain cost metric (e.g. "average App
Build cost increased") must be DERIVED by reading that existing authority and
submitting the derived number here as a normal metric observation.

STORAGE / SCALE
---------------
One typed table in `projects.db`. Append-only, indexed by (project, key,
observed_at). We keep enough history to compare periods and measure
experiments — not an unbounded cube. `prune_metric` bounds per-(project,key)
growth when a caller wants to cap retention.
"""
from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

from backend.core.paths import resolve_db_path
from backend.services.orchestrator import _sqlite

logger = logging.getLogger(__name__)

DB_PATH = resolve_db_path("projects.db", "PROJECTS_DB_PATH")

# Direction labels for change detection.
DIR_UP = "up"
DIR_DOWN = "down"
DIR_FLAT = "flat"

# Conservative default significance thresholds (noise control). A change must
# clear EITHER the absolute floor (when given) OR the percentage floor to be
# flagged "significant". Callers may override per metric type.
DEFAULT_MIN_PCT = 0.10          # 10% relative change
DEFAULT_MIN_SAMPLES_FOR_TREND = 3

_SCHEMA = """
CREATE TABLE IF NOT EXISTS metric_observations (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL,
    project_id    TEXT NOT NULL,
    metric_key    TEXT NOT NULL,
    value         REAL NOT NULL,
    unit          TEXT NOT NULL DEFAULT '',
    window        TEXT NOT NULL DEFAULT '',    -- e.g. "daily", "7d", "cumulative"
    source        TEXT NOT NULL DEFAULT 'SYSTEM',
    dimensions    TEXT NOT NULL DEFAULT '{}',  -- JSON bounded dimensions
    evidence_ref  TEXT,
    observed_at   TEXT NOT NULL,
    created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_metrics_key ON metric_observations(project_id, metric_key, observed_at);
CREATE INDEX IF NOT EXISTS ix_metrics_user ON metric_observations(user_id);
"""


def _now() -> str:
    return datetime.utcnow().isoformat() + "Z"


def init_metrics_table() -> None:
    try:
        with _sqlite.connection(DB_PATH) as c:
            c.executescript(_SCHEMA)
    except Exception as exc:  # pragma: no cover — defensive
        logger.warning("orchestrator.metrics_store.init failed: %s", exc)


def _dump(v: Any) -> str:
    try:
        return json.dumps(v, ensure_ascii=False, default=str)
    except Exception:
        return "{}"


def _load(raw: Optional[str], default: Any) -> Any:
    if not raw:
        return default
    try:
        return json.loads(raw)
    except Exception:
        return default


def _row_to_dict(row) -> dict:
    d = dict(row)
    d["dimensions"] = _load(d.get("dimensions"), {})
    return d


def _bounded_dimensions(raw: Any) -> dict:
    """Keep dimensions small + flat so a metric row can't carry an unbounded
    blob. Max 12 keys; scalar values only (coerced to str)."""
    if not isinstance(raw, dict):
        return {}
    out: Dict[str, str] = {}
    for k, v in list(raw.items())[:12]:
        if isinstance(v, (str, int, float, bool)):
            out[str(k)[:40]] = str(v)[:120]
    return out


def record_metric(
    *,
    user_id: str,
    project_id: str,
    metric_key: str,
    value: float,
    unit: str = "",
    window: str = "",
    source: str = "SYSTEM",
    dimensions: Optional[dict] = None,
    evidence_ref: Optional[str] = None,
    observed_at: Optional[str] = None,
) -> str:
    """Record one metric observation. Returns its id ("" on invalid input).
    `value` must be numeric. Append-only; never mutates prior rows (so an
    out-of-order/late value is stored at its own observed_at and does not
    overwrite the current reading)."""
    if not (user_id and project_id and (metric_key or "").strip()):
        return ""
    try:
        val = float(value)
        if val != val:  # NaN
            return ""
    except (TypeError, ValueError):
        return ""
    init_metrics_table()
    now = _now()
    mid = uuid.uuid4().hex[:12]
    try:
        with _sqlite.connection(DB_PATH) as c:
            c.execute(
                """INSERT INTO metric_observations
                   (id, user_id, project_id, metric_key, value, unit, window,
                    source, dimensions, evidence_ref, observed_at, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (mid, str(user_id), str(project_id), str(metric_key)[:120], val,
                 str(unit or "")[:40], str(window or "")[:40],
                 str(source or "SYSTEM")[:40], _dump(_bounded_dimensions(dimensions)),
                 (str(evidence_ref)[:200] if evidence_ref else None),
                 str(observed_at) if observed_at else now, now),
            )
        return mid
    except Exception as exc:
        logger.warning("orchestrator.metrics_store.record failed: %s", exc)
        return ""


def history(
    project_id: str, metric_key: str, *, limit: int = 50,
) -> List[dict]:
    """Recent observations for one metric_key, most-recent OBSERVED first."""
    if not (project_id and metric_key):
        return []
    try:
        with _sqlite.connection(DB_PATH) as c:
            rows = c.execute(
                """SELECT * FROM metric_observations
                   WHERE project_id=? AND metric_key=?
                   ORDER BY observed_at DESC, created_at DESC LIMIT ?""",
                (str(project_id), str(metric_key), max(1, min(int(limit or 50), 500))),
            ).fetchall()
        return [_row_to_dict(r) for r in rows]
    except Exception:
        return []


def latest(project_id: str, metric_key: str) -> Optional[dict]:
    rows = history(project_id, metric_key, limit=1)
    return rows[0] if rows else None


def metric_keys(project_id: str) -> List[str]:
    if not project_id:
        return []
    try:
        with _sqlite.connection(DB_PATH) as c:
            rows = c.execute(
                """SELECT DISTINCT metric_key FROM metric_observations
                   WHERE project_id=? ORDER BY metric_key""",
                (str(project_id),),
            ).fetchall()
        return [str(r["metric_key"]) for r in rows]
    except Exception:
        return []


def prune_metric(project_id: str, metric_key: str, *, keep: int = 500) -> int:
    """Bound retention for one (project, metric_key) to the newest `keep`
    rows. Returns rows deleted. Opt-in — callers with high-frequency metrics
    call this to keep storage bounded."""
    if not (project_id and metric_key):
        return 0
    keep = max(1, int(keep or 500))
    try:
        with _sqlite.writer_tx(DB_PATH) as c:
            ids = [r["id"] for r in c.execute(
                """SELECT id FROM metric_observations
                   WHERE project_id=? AND metric_key=?
                   ORDER BY observed_at DESC, created_at DESC LIMIT -1 OFFSET ?""",
                (str(project_id), str(metric_key), keep),
            ).fetchall()]
            if not ids:
                return 0
            c.executemany("DELETE FROM metric_observations WHERE id=?",
                          [(i,) for i in ids])
        return len(ids)
    except Exception as exc:  # pragma: no cover
        logger.warning("metrics_store.prune failed: %s", exc)
        return 0


# ── Deterministic change detection (pure functions) ──────────────────────

def absolute_delta(previous: float, current: float) -> float:
    return float(current) - float(previous)


def percentage_change(previous: float, current: float) -> Optional[float]:
    """Relative change as a fraction (0.10 == +10%). None when the baseline
    is zero (percentage change is undefined; callers use absolute delta)."""
    try:
        p = float(previous)
        if p == 0.0:
            return None
        return (float(current) - p) / abs(p)
    except (TypeError, ValueError):
        return None


def crosses_threshold(
    previous: float, current: float, threshold: float, *, direction: str = "either",
) -> bool:
    """True when the value crossed `threshold` between the two readings.
    `direction`: "up" (below→at/above), "down" (above→at/below), or "either"."""
    try:
        p, c, t = float(previous), float(current), float(threshold)
    except (TypeError, ValueError):
        return False
    up = p < t <= c
    down = p > t >= c
    if direction == "up":
        return up
    if direction == "down":
        return down
    return up or down


def trend(values: List[float], *, min_samples: int = DEFAULT_MIN_SAMPLES_FOR_TREND) -> str:
    """Coarse short-trend over an ORDERED (oldest→newest) value list. Returns
    "up"/"down"/"flat"/"insufficient". Deterministic sign of (last - first);
    requires `min_samples` points so noise on 1–2 readings isn't a trend."""
    nums: List[float] = []
    for v in values or []:
        try:
            f = float(v)
            if f == f:
                nums.append(f)
        except (TypeError, ValueError):
            continue
    if len(nums) < max(2, int(min_samples)):
        return "insufficient"
    diff = nums[-1] - nums[0]
    if diff > 0:
        return DIR_UP
    if diff < 0:
        return DIR_DOWN
    return DIR_FLAT


def detect_change(
    project_id: str, metric_key: str, *,
    min_pct: float = DEFAULT_MIN_PCT,
    min_abs: Optional[float] = None,
) -> Optional[Dict[str, Any]]:
    """Compare the two most-recent observations of a metric and return a
    structured, cause-free change report, or None when there is < 2 history.

    `significant` is True when the change clears the noise floor: the absolute
    delta ≥ `min_abs` (when provided) OR |pct change| ≥ `min_pct`. Defaults are
    conservative so trivial movement is ignored. This never proposes a reason —
    it only reports magnitude + direction."""
    rows = history(project_id, metric_key, limit=2)
    if len(rows) < 2:
        return None
    current, previous = rows[0], rows[1]   # history is DESC → [newest, prev]
    cur_v, prev_v = float(current["value"]), float(previous["value"])
    delta = absolute_delta(prev_v, cur_v)
    pct = percentage_change(prev_v, cur_v)
    direction = DIR_UP if delta > 0 else (DIR_DOWN if delta < 0 else DIR_FLAT)

    sig = False
    if min_abs is not None and abs(delta) >= abs(float(min_abs)):
        sig = True
    if pct is not None and abs(pct) >= abs(float(min_pct)):
        sig = True
    if min_abs is None and pct is None and delta != 0.0:
        # Baseline was zero and no absolute floor given → any move off zero is
        # notable (can't compute a percentage).
        sig = True

    return {
        "metric_key": metric_key,
        "previous": prev_v,
        "current": cur_v,
        "unit": current.get("unit") or "",
        "absolute_delta": round(delta, 6),
        "percentage_change": (round(pct, 6) if pct is not None else None),
        "direction": direction,
        "significant": sig,
        "previous_observed_at": previous.get("observed_at"),
        "current_observed_at": current.get("observed_at"),
        "evidence_ref": current.get("evidence_ref"),
    }


__all__ = [
    "DIR_UP", "DIR_DOWN", "DIR_FLAT", "DEFAULT_MIN_PCT",
    "init_metrics_table", "record_metric", "history", "latest",
    "metric_keys", "prune_metric",
    "absolute_delta", "percentage_change", "crosses_threshold", "trend",
    "detect_change",
]
