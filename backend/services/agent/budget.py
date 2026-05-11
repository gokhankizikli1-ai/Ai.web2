# coding: utf-8
# Phase A1 — Agent budget tracker.
#
# Hard limits enforced on every agent run:
#   * step count (each LLM pass + each tool call counts as one step)
#   * wall-clock seconds
#   * concurrent tool calls per step
#
# All limits are env-overridable. Defaults match the roadmap (§ 8.4):
#   AGENT_MAX_STEPS=6, AGENT_MAX_WALL_SECONDS=25, AGENT_MAX_PARALLEL_TOOLS=3
#
# Budget exhaustion never raises — it sets a flag the runtime checks before
# scheduling the next step. The runtime then asks the model for a final
# summary inside one more (last) llm_pass, marks the response partial=true,
# and returns.
import os
import time


class Budget:
    """Tracks step count + wall-clock + parallelism. Never raises."""

    def __init__(
        self,
        *,
        max_steps:           int = 0,
        max_wall_seconds:    float = 0.0,
        max_parallel_tools:  int = 0,
    ):
        self.max_steps          = max_steps          or int(os.getenv("AGENT_MAX_STEPS", "6"))
        self.max_wall_seconds   = max_wall_seconds   or float(os.getenv("AGENT_MAX_WALL_SECONDS", "25"))
        self.max_parallel_tools = max_parallel_tools or int(os.getenv("AGENT_MAX_PARALLEL_TOOLS", "3"))
        self.started_at  = time.monotonic()
        self.steps_used  = 0
        self.tool_calls  = 0

    def elapsed_seconds(self) -> float:
        return time.monotonic() - self.started_at

    def elapsed_ms(self) -> int:
        return int(self.elapsed_seconds() * 1000)

    def remaining_seconds(self) -> float:
        return max(0.0, self.max_wall_seconds - self.elapsed_seconds())

    def remaining_steps(self) -> int:
        return max(0, self.max_steps - self.steps_used)

    def exhausted(self) -> bool:
        """True when no more steps OR wall-clock left."""
        return self.remaining_steps() <= 0 or self.remaining_seconds() <= 0.0

    def bump_step(self, count: int = 1) -> None:
        self.steps_used += count

    def bump_tool_calls(self, count: int = 1) -> None:
        self.tool_calls += count
        # tool_calls also count as steps so they share the cap
        self.steps_used += count

    def cap_parallel(self, calls: list) -> list:
        """Truncate a list of pending tool calls to the parallelism cap."""
        if self.max_parallel_tools <= 0:
            return calls
        return calls[: self.max_parallel_tools]

    def snapshot(self) -> dict:
        return {
            "steps_used":      self.steps_used,
            "max_steps":       self.max_steps,
            "tool_calls":      self.tool_calls,
            "elapsed_ms":      self.elapsed_ms(),
            "max_wall_seconds": self.max_wall_seconds,
            "exhausted":       self.exhausted(),
        }


__all__ = ["Budget"]
