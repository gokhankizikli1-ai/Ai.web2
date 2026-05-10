# coding: utf-8
"""
Centralized logging configuration for KorvixAI v3.
Call setup_logging() once at application startup.
"""
import logging
import sys


def setup_logging(level: str = "INFO") -> None:
    """Configure production-safe structured logging for Railway."""
    fmt = "%(asctime)s [%(levelname)s] %(name)s: %(message)s"
    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format=fmt,
        stream=sys.stdout,
        force=True,
    )
    # Quiet noisy third-party loggers
    for noisy in ("httpx", "httpcore", "openai._base_client", "urllib3"):
        logging.getLogger(noisy).setLevel(logging.WARNING)

    logging.getLogger("korvix").info("Logging initialized | level=%s", level)
