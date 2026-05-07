# coding: utf-8
import logging
import os
import sys
import time
import traceback
from logging.handlers import RotatingFileHandler

LOG_DIR  = "logs"
LOG_FILE = os.path.join(LOG_DIR, "bot.log")


class FlushStreamHandler(logging.StreamHandler):
    def emit(self, record):
        super().emit(record)
        self.flush()


def setup_logger():
    os.makedirs(LOG_DIR, exist_ok=True)

    root = logging.getLogger()
    if root.handlers:
        root.handlers.clear()

    root.setLevel(logging.INFO)

    fmt = logging.Formatter(
        "%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    console_handler = FlushStreamHandler(sys.stdout)
    console_handler.setFormatter(fmt)
    console_handler.setLevel(logging.INFO)
    root.addHandler(console_handler)

    file_handler = RotatingFileHandler(
        LOG_FILE,
        maxBytes=5 * 1024 * 1024,
        backupCount=3,
        encoding="utf-8",
    )
    file_handler.setFormatter(fmt)
    file_handler.setLevel(logging.INFO)
    root.addHandler(file_handler)


def log_user_message(user_id, username, message):
    logging.getLogger("bot.user").info(
        "MSG | user_id=%s | username=%s | text=%s",
        user_id, username or "unknown", message[:200],
    )


def log_intent(user_id, intent, symbol, model, mode):
    logging.getLogger("bot.intent").info(
        "INTENT | user_id=%s | intent=%s | symbol=%s | model=%s | mode=%s",
        user_id, intent, symbol or "-", model, mode,
    )


def log_ai_response(user_id, intent, response, elapsed=None):
    extra = (" | time=" + str(elapsed) + "s") if elapsed is not None else ""
    logging.getLogger("bot.ai").info(
        "AI | user_id=%s | intent=%s | chars=%s%s | preview=%s",
        user_id, intent, len(response), extra, response[:150],
    )


def log_error(user_id, error, tb=True):
    logger = logging.getLogger("bot.error")
    if tb:
        logger.error(
            "ERR | user_id=%s | error=%s\n%s",
            user_id, str(error), traceback.format_exc(),
        )
    else:
        logger.error("ERR | user_id=%s | error=%s", user_id, str(error))


def log_tool_error(tool_name, error):
    logging.getLogger("bot.tool").warning(
        "TOOL_ERR | tool=%s | error=%s", tool_name, str(error),
    )


class Timer:
    def __enter__(self):
        self._t = time.monotonic()
        return self

    def __exit__(self, *_):
        self.elapsed = round(time.monotonic() - self._t, 2)
