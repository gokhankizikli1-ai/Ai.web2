# coding: utf-8
"""
Helpers for safe JSON parsing — never raises, always returns a fallback.
Used when parsing AI-generated JSON that may be malformed.
"""
import json
import logging
import re

logger = logging.getLogger(__name__)


def safe_parse(raw: str, fallback: dict | None = None) -> dict:
    """
    Parse a JSON string defensively.
    If parsing fails, attempt to extract a JSON object with a regex, then give up
    and return `fallback`.
    """
    if fallback is None:
        fallback = {}
    if not raw or not raw.strip():
        return fallback
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass
    # Try to extract the first {...} block in case the model added extra text
    match = re.search(r"\{.*\}", raw, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            pass
    logger.warning("safe_parse: could not parse JSON, returning fallback")
    return fallback
