# coding: utf-8
"""
cost_tracking — production-grade AI usage & cost tracking for Web Build.

Public surface:

    from backend.services.cost_tracking import tracker
    from backend.services.cost_tracking.types import TokenUsage

    bid = tracker.start_build(user_id=uid, build_id=op_id)
    tracker.record_ai_call(build_id=bid, user_id=uid, provider="openai",
                           model="gpt-5.6", operation_type="web_build_planning",
                           usage=TokenUsage(input_tokens=..., output_tokens=...))
    tracker.record_tool_cost(build_id=bid, user_id=uid, tool_key="image.gpt-image-1")
    snapshot = tracker.get_build(bid)         # aggregate (task #6)
    stats    = tracker.analytics()            # admin analytics (task #7)

Pricing is centralized in `pricing.py` (task #5). Nothing here trusts a
client-supplied token value (task #8), and a call with no provider usage
is flagged usage_missing rather than estimated as zero (task #9).
"""
from backend.services.cost_tracking.types import (  # noqa: F401
    TokenUsage, AICallRecord, BuildAggregate,
)

__all__ = ["TokenUsage", "AICallRecord", "BuildAggregate"]
