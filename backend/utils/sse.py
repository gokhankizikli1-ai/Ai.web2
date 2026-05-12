# coding: utf-8
"""
Server-Sent Events (SSE) framing helpers.

Used by /v2/chat/stream (and any future streaming route). Pure-stdlib —
no new dependencies. Returns a FastAPI `StreamingResponse` configured
with the right Content-Type and proxy-buffer-disabling headers so the
client sees frames as they're produced, not in a single buffered chunk.

Frame format (per https://html.spec.whatwg.org/multipage/server-sent-events.html):

  event: <event-name>\\n
  data: <single-line-payload>\\n
  \\n

Multi-line `data` is supported by repeating the `data:` prefix per line.
We always emit a JSON-encoded payload so the client doesn't need to
parse loose strings.

Routes use it like:

    async def stream():
        yield sse_event("ready", {"provider": "openai"})
        async for chunk in upstream_iter:
            yield sse_event("token", {"delta": chunk})
        yield sse_event("done", {"finish_reason": "stop"})

    return sse_response(stream())
"""
from __future__ import annotations

import json
from typing import Any, AsyncIterator, Dict

from starlette.responses import StreamingResponse


def sse_event(event_name: str, data: Dict[str, Any]) -> str:
    """Format a single SSE frame. JSON-encodes the data payload."""
    # JSON with no newlines so single-line data: works; the SSE spec
    # requires that any literal newline in data be prefixed by another
    # data: line, and we'd rather not split frames on payload contents.
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    return f"event: {event_name}\ndata: {payload}\n\n"


def sse_response(generator: AsyncIterator[str], *, status_code: int = 200) -> StreamingResponse:
    """Wrap an async generator of pre-formatted SSE frames in a
    StreamingResponse with the right headers.

    Headers:
      - Content-Type: text/event-stream                required by the SSE spec
      - Cache-Control: no-cache, no-transform          intermediaries must not cache
      - X-Accel-Buffering: no                          disables nginx buffering
      - Connection: keep-alive                         long-lived connection
    """
    return StreamingResponse(
        generator,
        media_type="text/event-stream",
        status_code=status_code,
        headers={
            "Cache-Control":    "no-cache, no-transform",
            "X-Accel-Buffering": "no",
            "Connection":       "keep-alive",
        },
    )


__all__ = ["sse_event", "sse_response"]
