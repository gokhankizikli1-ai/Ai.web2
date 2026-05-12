# coding: utf-8
"""
Centralized logging configuration for KorvixAI v3.

Default behaviour (preserved): text format on stdout — the same shape
Railway has been ingesting since v3.0 launched. `setup_logging()` is
called at most once during app boot.

Phase-1 addition: opt-in JSON formatter + request-id correlation.

  - `request_id_ctx` is a ContextVar set by `RequestIdMiddleware`. Any
    `logger.info(...)` call running inside a request automatically
    enriches the log line with the same `X-Request-Id` the client sees.
  - `setup_logging(structured=True)` swaps the text formatter for the
    JSON one. Off by default; flip via `LOG_FORMAT=json` env var (read
    only at startup) so production stays text-stable until we explicitly
    cut over.
"""
import contextvars
import json
import logging
import os
import sys
from datetime import datetime, timezone


# ── Request-scoped correlation (set by RequestIdMiddleware) ──────────────
# Default "-" means "no request in progress" (startup, background tasks).
request_id_ctx: contextvars.ContextVar[str] = contextvars.ContextVar(
    "request_id", default="-"
)


# ── Default text formatter — preserves the v3.0 log shape ────────────────
_TEXT_FORMAT = "%(asctime)s [%(levelname)s] %(name)s: %(message)s"


# ── Opt-in JSON formatter — one line per record, request_id included ─────
class _JsonFormatter(logging.Formatter):
    # logging.LogRecord attributes that should never appear in the JSON
    # payload (they're either internal noise or already promoted to
    # first-class keys).
    _SKIP = {
        "args", "msg", "levelname", "levelno", "pathname", "filename",
        "module", "exc_info", "exc_text", "stack_info", "lineno",
        "funcName", "created", "msecs", "relativeCreated", "thread",
        "threadName", "processName", "process", "name", "message",
        "taskName",
    }

    def format(self, record: logging.LogRecord) -> str:
        payload: dict = {
            "ts":         datetime.now(timezone.utc).isoformat(),
            "level":      record.levelname,
            "logger":     record.name,
            "msg":        record.getMessage(),
            "request_id": request_id_ctx.get(),
        }
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        # Forward any structured `extra={...}` fields. Stringify non-JSON-
        # serialisable values so a logger.info(extra={"obj": some_obj})
        # call can never crash the log writer.
        for key, value in record.__dict__.items():
            if key in self._SKIP or key in payload:
                continue
            payload[key] = value
        return json.dumps(payload, ensure_ascii=False, default=str)


def setup_logging(level: str = "INFO", *, structured: bool | None = None) -> None:
    """Configure production-safe logging for Railway.

    Args:
      level:      log level name. Anything `logging.getLevelName` accepts.
      structured: if True, emit JSON lines (one per record) with a
                  request_id field. If None (default), reads `LOG_FORMAT`
                  env var — "json" enables JSON, anything else stays
                  text. Allows turning structured logs on without a code
                  change.

    Idempotent — calling twice replaces handlers (uses `force=True`).
    """
    if structured is None:
        structured = os.getenv("LOG_FORMAT", "").strip().lower() == "json"

    handler = logging.StreamHandler(stream=sys.stdout)
    if structured:
        handler.setFormatter(_JsonFormatter())
    else:
        handler.setFormatter(logging.Formatter(_TEXT_FORMAT))

    root = logging.getLogger()
    # Clear existing handlers exactly once so re-init is safe.
    for h in list(root.handlers):
        root.removeHandler(h)
    root.addHandler(handler)
    root.setLevel(getattr(logging, level.upper(), logging.INFO))

    # Quiet noisy third-party loggers — same list as before.
    for noisy in ("httpx", "httpcore", "openai._base_client", "urllib3"):
        logging.getLogger(noisy).setLevel(logging.WARNING)

    logging.getLogger("korvix").info(
        "Logging initialized | level=%s | format=%s",
        level, "json" if structured else "text",
    )


__all__ = ["setup_logging", "request_id_ctx"]
