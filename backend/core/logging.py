# coding: utf-8
import logging
import os
import sys
import time
import uuid
import traceback
from logging.handlers import RotatingFileHandler

LOG_DIR  = "logs"
LOG_FILE = os.path.join(LOG_DIR, "velora.log")


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
    ch = FlushStreamHandler(sys.stdout)
    ch.setFormatter(fmt)
    ch.setLevel(logging.INFO)
    root.addHandler(ch)

    fh = RotatingFileHandler(LOG_FILE, maxBytes=5*1024*1024, backupCount=3, encoding="utf-8")
    fh.setFormatter(fmt)
    fh.setLevel(logging.INFO)
    root.addHandler(fh)


def new_request_id():
    return str(uuid.uuid4())[:8]


def log_request(request_id, user_id, platform, intent, model, mode):
    logging.getLogger("velora.request").info(
        "REQ | id=%s | user=%s | platform=%s | intent=%s | model=%s | mode=%s",
        request_id, user_id, platform, intent, model, mode,
    )


def log_response(request_id, user_id, elapsed_ms, chars):
    logging.getLogger("velora.response").info(
        "RES | id=%s | user=%s | elapsed_ms=%s | chars=%s",
        request_id, user_id, elapsed_ms, chars,
    )


def log_error(request_id, user_id, error):
    logging.getLogger("velora.error").error(
        "ERR | id=%s | user=%s | error=%s\n%s",
        request_id, user_id, str(error), traceback.format_exc(),
    )


def log_tool(tool_name, success, elapsed_ms=None):
    logging.getLogger("velora.tool").info(
        "TOOL | name=%s | ok=%s | ms=%s",
        tool_name, success, elapsed_ms or "-",
    )


class Timer:
    def __enter__(self):
        self._t = time.monotonic()
        return self

    def __exit__(self, *_):
        self.elapsed_ms = int((time.monotonic() - self._t) * 1000)
