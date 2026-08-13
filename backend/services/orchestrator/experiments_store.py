# coding: utf-8
"""Business Brain — Phase 6: EXPERIMENTS + LEARNING loop.

Lets Korvix remember "we tried X", "what happened?", and "what should we learn
from that?" — so it stops rediscovering the same lessons. It REUSES the other
authorities rather than building an experimentation platform:

  * durable learnings  → Memory Plane, via `business_knowledge.record_learning`
  * goal linkage       → `goals_store`
  * measurements       → `metrics_store` (Phase 5)
  * durable decisions  → `decisions_store` (never written from here)

The experiment record itself is one small typed table in `projects.db`.

CAUSALITY SAFETY (mandatory)
----------------------------
Unless there is strong controlled evidence, Korvix must NOT say "X caused Y".
This module never emits causal language. Assessed outcomes and generated
learnings use association wording only — "X was followed by Y", "Y improved
during the measured window after X". Insufficient / missing / short-window
evidence yields `inconclusive`, never a forced winner.

NO AUTONOMOUS OPTIMIZATION LOOP
-------------------------------
Assessment is a ONE-SHOT deterministic computation. There is no
change→measure→change loop here. Learnings inform Phase-2 prioritization as
evidence; the execution policy remains the authority on what actually runs.
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

# ── Lifecycle status ─────────────────────────────────────────────────────
STATUS_RUNNING = "running"        # change applied, measurement window open
STATUS_MEASURING = "measuring"    # window elapsing, gathering results
STATUS_ASSESSED = "assessed"      # outcome computed
STATUS_ABANDONED = "abandoned"
VALID_STATUSES = (STATUS_RUNNING, STATUS_MEASURING, STATUS_ASSESSED, STATUS_ABANDONED)

# ── Outcomes (never a forced winner) ─────────────────────────────────────
OUTCOME_IMPROVED = "improved"
OUTCOME_WORSENED = "worsened"
OUTCOME_NEUTRAL = "neutral"
OUTCOME_INCONCLUSIVE = "inconclusive"
VALID_OUTCOMES = (OUTCOME_IMPROVED, OUTCOME_WORSENED, OUTCOME_NEUTRAL,
                  OUTCOME_INCONCLUSIVE)

# Default minimum relative movement to call an outcome non-neutral.
DEFAULT_MIN_EFFECT_PCT = 0.05

_SCHEMA = """
CREATE TABLE IF NOT EXISTS experiments (
    id             TEXT PRIMARY KEY,
    project_id     TEXT NOT NULL,
    user_id        TEXT NOT NULL,
    goal_id        TEXT,
    hypothesis     TEXT NOT NULL DEFAULT '',
    change_ref     TEXT,                        -- what was changed (plan/task/decision ref)
    metric_key     TEXT,                        -- primary metric measured
    higher_is_better INTEGER NOT NULL DEFAULT 1,
    baseline_refs  TEXT NOT NULL DEFAULT '[]',  -- JSON metric-observation refs
    result_refs    TEXT NOT NULL DEFAULT '[]',
    started_at     TEXT,
    ended_at       TEXT,
    status         TEXT NOT NULL DEFAULT 'running',
    outcome        TEXT,
    confidence     REAL,
    learning_ref   TEXT,
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_experiments_project ON experiments(project_id, status);
CREATE INDEX IF NOT EXISTS ix_experiments_goal    ON experiments(goal_id);
"""


def _now() -> str:
    return datetime.utcnow().isoformat() + "Z"


def init_experiments_table() -> None:
    try:
        with _sqlite.connection(DB_PATH) as c:
            c.executescript(_SCHEMA)
    except Exception as exc:  # pragma: no cover — defensive
        logger.warning("orchestrator.experiments_store.init failed: %s", exc)


def _dump(v: Any) -> str:
    try:
        return json.dumps(v, ensure_ascii=False, default=str)
    except Exception:
        return "[]"


def _load(raw: Optional[str], default: Any) -> Any:
    if not raw:
        return default
    try:
        return json.loads(raw)
    except Exception:
        return default


def _refs(raw: Any) -> List[str]:
    if not isinstance(raw, list):
        return []
    return [str(x)[:200] for x in raw[:50] if x]


def _row_to_dict(row) -> dict:
    d = dict(row)
    d["baseline_refs"] = _load(d.get("baseline_refs"), [])
    d["result_refs"] = _load(d.get("result_refs"), [])
    d["higher_is_better"] = bool(d.get("higher_is_better"))
    return d


def create_experiment(
    *,
    project_id: str,
    user_id: str,
    hypothesis: str,
    goal_id: Optional[str] = None,
    change_ref: Optional[str] = None,
    metric_key: Optional[str] = None,
    higher_is_better: bool = True,
    baseline_refs: Optional[List[str]] = None,
    started_at: Optional[str] = None,
) -> str:
    """Register an experiment (status='running'). Returns its id.

    A hypothesis is a QUESTION/expectation, never a conclusion. Recording one
    asserts nothing about causality."""
    if not (project_id and user_id and (hypothesis or "").strip()):
        return ""
    init_experiments_table()
    now = _now()
    eid = uuid.uuid4().hex[:12]
    try:
        with _sqlite.connection(DB_PATH) as c:
            c.execute(
                """INSERT INTO experiments
                   (id, project_id, user_id, goal_id, hypothesis, change_ref,
                    metric_key, higher_is_better, baseline_refs, result_refs,
                    started_at, ended_at, status, outcome, confidence,
                    learning_ref, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, NULL,
                           'running', NULL, NULL, NULL, ?, ?)""",
                (eid, str(project_id), str(user_id), (goal_id or None),
                 str(hypothesis)[:1000], (str(change_ref)[:200] if change_ref else None),
                 (str(metric_key)[:120] if metric_key else None),
                 1 if higher_is_better else 0, _dump(_refs(baseline_refs)),
                 (str(started_at) if started_at else now), now, now),
            )
        return eid
    except Exception as exc:
        logger.warning("orchestrator.experiments_store.create failed: %s", exc)
        return ""


def get_experiment(experiment_id: str) -> Optional[dict]:
    if not experiment_id:
        return None
    try:
        with _sqlite.connection(DB_PATH) as c:
            row = c.execute(
                "SELECT * FROM experiments WHERE id=?", (str(experiment_id),),
            ).fetchone()
        return _row_to_dict(row) if row else None
    except Exception:
        return None


def list_experiments(
    project_id: str, *, status: Optional[str] = None, limit: int = 100,
) -> List[dict]:
    if not project_id:
        return []
    try:
        with _sqlite.connection(DB_PATH) as c:
            if status:
                rows = c.execute(
                    """SELECT * FROM experiments WHERE project_id=? AND status=?
                       ORDER BY created_at DESC LIMIT ?""",
                    (str(project_id), str(status), max(1, min(int(limit or 100), 500))),
                ).fetchall()
            else:
                rows = c.execute(
                    """SELECT * FROM experiments WHERE project_id=?
                       ORDER BY created_at DESC LIMIT ?""",
                    (str(project_id), max(1, min(int(limit or 100), 500))),
                ).fetchall()
        return [_row_to_dict(r) for r in rows]
    except Exception:
        return []


def _update(experiment_id: str, fields: Dict[str, Any]) -> bool:
    if not fields:
        return False
    cols = ", ".join(f"{k}=?" for k in fields)
    params = list(fields.values()) + [_now(), str(experiment_id)]
    try:
        with _sqlite.connection(DB_PATH) as c:
            cur = c.execute(
                f"UPDATE experiments SET {cols}, updated_at=? WHERE id=?", params,
            )
        return cur.rowcount > 0
    except Exception as exc:
        logger.warning("orchestrator.experiments_store.update failed: %s", exc)
        return False


def set_status(experiment_id: str, status: str) -> bool:
    if get_experiment(experiment_id) is None:
        return False
    s = status if status in VALID_STATUSES else STATUS_RUNNING
    return _update(experiment_id, {"status": s})


# ── Deterministic outcome classification (no causal claims) ───────────────

def classify_outcome(
    baseline_value: Optional[float],
    result_value: Optional[float],
    *,
    higher_is_better: bool = True,
    min_effect_pct: float = DEFAULT_MIN_EFFECT_PCT,
    sufficient_samples: bool = True,
) -> Dict[str, Any]:
    """Pure classifier → {"outcome", "confidence", "relative_change"}.

    Rules (conservative):
      * baseline or result missing        → inconclusive (conf 0.0)
      * insufficient samples/short window  → inconclusive
      * |relative change| < min_effect_pct → neutral
      * else improved/worsened per `higher_is_better`
    `confidence` is a bounded heuristic on effect size — NOT a probability of
    causation. It never implies X caused Y."""
    if baseline_value is None or result_value is None:
        return {"outcome": OUTCOME_INCONCLUSIVE, "confidence": 0.0,
                "relative_change": None, "reason": "missing baseline or result"}
    if not sufficient_samples:
        return {"outcome": OUTCOME_INCONCLUSIVE, "confidence": 0.0,
                "relative_change": None, "reason": "insufficient samples / short window"}
    try:
        b, r = float(baseline_value), float(result_value)
    except (TypeError, ValueError):
        return {"outcome": OUTCOME_INCONCLUSIVE, "confidence": 0.0,
                "relative_change": None, "reason": "non-numeric values"}

    if b == 0.0:
        rel = None
        moved = r != 0.0
    else:
        rel = (r - b) / abs(b)
        moved = abs(rel) >= abs(float(min_effect_pct))

    if rel is not None and not moved:
        return {"outcome": OUTCOME_NEUTRAL, "confidence": 0.2,
                "relative_change": round(rel, 6), "reason": "change below effect floor"}

    delta = r - b
    better = (delta > 0) if higher_is_better else (delta < 0)
    outcome = OUTCOME_IMPROVED if better else OUTCOME_WORSENED
    # Effect-size heuristic confidence, capped — larger movement → higher, but
    # never presented as causal certainty.
    conf = 0.5
    if rel is not None:
        conf = min(0.9, 0.5 + min(abs(rel), 1.0) * 0.4)
    return {"outcome": outcome, "confidence": round(conf, 4),
            "relative_change": (round(rel, 6) if rel is not None else None),
            "reason": "effect measured during window"}


def association_phrase(
    change_label: str, metric_key: str, direction: str,
) -> str:
    """Association-only wording (never causal). `direction` in
    up/down/flat/neutral."""
    change_label = (change_label or "a change").strip()
    metric_key = (metric_key or "the metric").strip()
    if direction in ("up", "improved"):
        return f"{metric_key} improved during the measured window after {change_label}"
    if direction in ("down", "worsened"):
        return f"{metric_key} declined during the measured window after {change_label}"
    return f"{change_label} was followed by no material change in {metric_key} during the measured window"


def assess_experiment(
    experiment_id: str, *,
    baseline_value: Optional[float] = None,
    result_value: Optional[float] = None,
    result_refs: Optional[List[str]] = None,
    min_effect_pct: float = DEFAULT_MIN_EFFECT_PCT,
    sufficient_samples: bool = True,
    ended_at: Optional[str] = None,
    persist_learning: bool = True,
    change_label: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """One-shot deterministic assessment. Computes the outcome, marks the
    experiment assessed, and (for a non-inconclusive result, when
    `persist_learning`) records a durable, association-worded LEARNING in the
    Memory Plane linked back to this experiment. Failed experiments are
    retained (status=assessed, outcome=worsened) so they aren't blindly
    repeated. Returns the assessment dict, or None when the experiment is
    unknown."""
    exp = get_experiment(experiment_id)
    if exp is None:
        return None

    cls = classify_outcome(
        baseline_value, result_value,
        higher_is_better=bool(exp.get("higher_is_better", True)),
        min_effect_pct=min_effect_pct, sufficient_samples=sufficient_samples)
    outcome = cls["outcome"]
    confidence = cls["confidence"]

    learning_ref: Optional[str] = None
    if persist_learning and outcome in (OUTCOME_IMPROVED, OUTCOME_WORSENED):
        direction = outcome
        phrase = association_phrase(
            change_label or exp.get("change_ref") or exp.get("hypothesis") or "the change",
            exp.get("metric_key") or "the metric", direction)
        try:
            from backend.services.orchestrator import business_knowledge as bk
            learning_ref = bk.record_learning(
                user_id=str(exp.get("user_id")), project_id=str(exp.get("project_id")),
                summary=phrase, source="EXPERIMENT", source_ref=str(experiment_id),
                confidence=confidence,
                extra_metadata={"experiment_id": experiment_id,
                                "outcome": outcome,
                                "metric_key": exp.get("metric_key")})
        except Exception as exc:  # pragma: no cover — learning is best-effort
            logger.debug("assess_experiment learning persist soft-failed: %s", exc)

    # Keep existing result_refs unless the caller supplied new ones.
    result_refs_json = (_dump(_refs(result_refs)) if result_refs is not None
                        else _dump(exp.get("result_refs") or []))
    _update(experiment_id, {
        "status": STATUS_ASSESSED,
        "outcome": outcome,
        "confidence": confidence,
        "result_refs": result_refs_json,
        "ended_at": str(ended_at) if ended_at else _now(),
        "learning_ref": learning_ref,
    })

    return {
        "experiment_id": experiment_id,
        "outcome": outcome,
        "confidence": confidence,
        "relative_change": cls.get("relative_change"),
        "reason": cls.get("reason"),
        "learning_ref": learning_ref,
    }


__all__ = [
    "STATUS_RUNNING", "STATUS_MEASURING", "STATUS_ASSESSED", "STATUS_ABANDONED",
    "VALID_STATUSES",
    "OUTCOME_IMPROVED", "OUTCOME_WORSENED", "OUTCOME_NEUTRAL", "OUTCOME_INCONCLUSIVE",
    "VALID_OUTCOMES", "DEFAULT_MIN_EFFECT_PCT",
    "init_experiments_table", "create_experiment", "get_experiment",
    "list_experiments", "set_status", "classify_outcome", "association_phrase",
    "assess_experiment",
]
