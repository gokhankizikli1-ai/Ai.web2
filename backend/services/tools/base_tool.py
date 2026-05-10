# coding: utf-8
# Phase 4A — Tool Architecture Foundation
# BaseTool: abstract contract every tool must implement.
# safe_run() wraps run() so a tool crash never propagates to the AI response.
from abc import ABC, abstractmethod
from datetime import datetime, timezone
import logging

logger = logging.getLogger(__name__)


class BaseTool(ABC):
    # Subclasses must set these as class attributes.
    name: str = "base_tool"
    description: str = ""

    @abstractmethod
    async def run(self, query: str, context: dict = None) -> dict:
        """
        Execute the tool and return a normalized result dict.
        Always return _ok() or _unavailable() — never raise.
        """
        ...

    async def safe_run(self, query: str, context: dict = None) -> dict:
        """Calls run() and catches any exception so callers never crash."""
        try:
            return await self.run(query, context)
        except Exception as exc:
            logger.warning("tool '%s' raised in safe_run: %s", self.name, exc)
            return self._error(str(exc))

    # ── Normalized response helpers ────────────────────────────────────────

    def _ok(self, data: dict, provider: str = None) -> dict:
        return {
            "tool":      self.name,
            "status":    "available",
            "data":      data,
            "message":   None,
            "provider":  provider,
            "timestamp": _now(),
        }

    def _unavailable(self, reason: str = "") -> dict:
        return {
            "tool":      self.name,
            "status":    "unavailable",
            "data":      None,
            "message":   reason or f"{self.name} not configured",
            "provider":  None,
            "timestamp": _now(),
        }

    def _error(self, reason: str = "") -> dict:
        return {
            "tool":      self.name,
            "status":    "error",
            "data":      None,
            "message":   reason,
            "provider":  None,
            "timestamp": _now(),
        }


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()
