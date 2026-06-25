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
    # Phase 7b — per-tool wall-clock ceiling honoured by
    # backend.services.agent.tool_bridge.dispatch_one. When unset
    # the bridge falls back to its caller-supplied default (12s).
    # Tools that hit fast read-only APIs should set this lower so
    # the agent fails over to another tool quickly.
    timeout_seconds: float = 12.0

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
            result = await self.run(query, context)
        except Exception as exc:
            logger.warning("tool '%s' raised in safe_run: %s", self.name, exc)
            result = self._error(str(exc))
        try:
            from backend.services.tools.tool_registry import record_call
            record_call(self.name, result)
        except Exception:
            pass
        return result

    # ── Normalized response helpers ────────────────────────────────────────
    #
    # Phase 8d — every result envelope carries `is_live` so any consumer
    # (trading service, frontend, agent trace renderer) can refuse to
    # display prices/signals when the source wasn't real. Defaults:
    #   _ok           → is_live=True   (the tool got real data)
    #   _unavailable  → is_live=False  (provider down / not configured)
    #   _error        → is_live=False  (validation or crash; never real data)
    # Tools that intentionally return cached / simulated data must
    # override to is_live=False explicitly.

    def _ok(self, data: dict, provider: str = None, *, is_live: bool = True) -> dict:
        return {
            "tool":      self.name,
            "status":    "available",
            "data":      data,
            "message":   None,
            "provider":  provider,
            "source":    provider,        # alias — every consumer expects ONE of these
            "timestamp": _now(),
            "is_live":   bool(is_live),
        }

    def _unavailable(self, reason: str = "") -> dict:
        return {
            "tool":      self.name,
            "status":    "unavailable",
            "data":      None,
            "message":   reason or f"{self.name} not configured",
            "provider":  None,
            "source":    None,
            "timestamp": _now(),
            "is_live":   False,
        }

    def _error(self, reason: str = "") -> dict:
        return {
            "tool":      self.name,
            "status":    "error",
            "data":      None,
            "message":   reason,
            "provider":  None,
            "source":    None,
            "timestamp": _now(),
            "is_live":   False,
        }


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()
