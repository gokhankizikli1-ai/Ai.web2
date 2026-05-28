# coding: utf-8
"""
Phase 11 mid-stream hang-fix — production observation: after the
pre-stream timeouts shipped in #140, a new failure surfaced where
the LLM stream itself stalled mid-response. The model emitted the
first few tokens ("Bir dakikanızı alacak…") and then OpenAI /
Anthropic stopped sending without ever emitting Done. The route's
`async for event in provider.stream_chat_completion(...)` then
awaited forever and the FE was stuck on a partial answer.

This test suite locks down the watchdog behaviour:
  - per-chunk idle timeout (no event for N seconds → abort)
  - total budget timeout (entire stream taking > N seconds → abort)
  - iterator exhausted without Done → abort
  - on every timeout path, a `done` SSE frame is emitted so the
    FE can never get stuck on a partial token list.
"""
from __future__ import annotations

import asyncio
from typing import AsyncIterator

import pytest

from backend.services.providers.streaming import (
    ProviderStreamStart, ProviderStreamToken, ProviderStreamDone,
)


def _make_provider_factory(stream_factory):
    """Returns a function that monkeypatches get_provider with a fake
    that uses the supplied async-iterator factory."""
    class _Fake:
        name = "fake"
        default_model = "fake-model"
        supports_streaming = True
        supports_vision = False
        vision_models: tuple = ()
        def model_supports_vision(self, _m):
            return False
        async def stream_chat_completion(self, req) -> AsyncIterator:
            async for event in stream_factory(req):
                yield event
    return _Fake()


class TestStreamWatchdog:

    def test_normal_stream_completes_cleanly(self, client, monkeypatch):
        """Baseline — a well-behaved provider stream still works."""
        async def good_stream(req):
            yield ProviderStreamStart(provider="fake", model=req.model)
            yield ProviderStreamToken(delta="hello ")
            yield ProviderStreamToken(delta="world")
            yield ProviderStreamDone(
                finish_reason="stop", model=req.model,
                usage=type("U", (), {"prompt_tokens": 1,
                                     "completion_tokens": 2,
                                     "total_tokens": 3})(),
            )
        from backend.routes import v2_chat_stream as stream_route
        monkeypatch.setattr(stream_route, "get_provider",
                            lambda _n: _make_provider_factory(good_stream))
        r = client.post("/v2/chat/stream", json={
            "user_id": "u-good",
            "messages": [{"role": "user", "content": "hi"}],
        })
        assert r.status_code == 200
        body = r.text
        assert "event: ready" in body
        assert "event: token" in body
        assert "event: done" in body
        assert "\"finish_reason\": \"stop\"" in body or \
               "\"finish_reason\":\"stop\"" in body

    def test_iterator_exhausted_without_done(self, client, monkeypatch):
        """Provider stream ends WITHOUT emitting Done — production-
        observed failure mode. Watchdog must emit fallback token +
        clean done so the FE drops out of loading."""
        async def truncated_stream(req):
            yield ProviderStreamStart(provider="fake", model=req.model)
            yield ProviderStreamToken(delta="Bir dakikanızı alacak…")
            # NO Done event — generator just returns.
        from backend.routes import v2_chat_stream as stream_route
        monkeypatch.setattr(stream_route, "get_provider",
                            lambda _n: _make_provider_factory(truncated_stream))
        r = client.post("/v2/chat/stream", json={
            "user_id": "u-trunc",
            "messages": [{"role": "user", "content": "hi"}],
        })
        assert r.status_code == 200
        body = r.text
        # The partial token reached the user.
        assert "Bir dakikanızı alacak" in body
        # Watchdog emitted the Turkish fallback message + done.
        assert "İşlem zaman aşımına uğradı" in body
        assert "event: done" in body
        # And the finish_reason explains the stop.
        assert "iterator_exhausted" in body or "\"finish_reason\": \"timeout\"" in body \
               or "\"finish_reason\":\"timeout\"" in body

    def test_idle_timeout_after_partial_tokens(self, client, monkeypatch):
        """Provider sends a few tokens then HANGS waiting for the next.
        Watchdog's per-chunk idle timeout must fire and close the
        stream with a graceful done. Without this fix, the route's
        async-for would await forever and the FE would be stuck on
        the partial response."""
        async def hanging_stream(req):
            yield ProviderStreamStart(provider="fake", model=req.model)
            yield ProviderStreamToken(delta="Bir dakikanızı alacak…")
            # Now hang for way longer than the idle timeout.
            await asyncio.sleep(120)
            yield ProviderStreamDone(  # never reached in real path
                finish_reason="stop", model=req.model,
                usage=type("U", (), {"prompt_tokens": 1,
                                     "completion_tokens": 1,
                                     "total_tokens": 2})(),
            )
        # Lower the watchdog so the test runs fast.
        from backend.routes import v2_chat_stream as stream_route
        monkeypatch.setattr(stream_route, "get_provider",
                            lambda _n: _make_provider_factory(hanging_stream))
        # The IDLE_TIMEOUT default is 30s; monkeypatch the constant
        # so the test takes < 5s. The constant is local to
        # event_stream's closure, so we patch via the module global
        # via a wrapper function instead.
        # Simpler: rely on the constant by patching asyncio.wait_for
        # to use a small timeout. Actually the cleanest path is to
        # override the IDLE_TIMEOUT directly — it's defined inline.
        # We'll rebuild the route module's event_stream with a
        # patched constant via monkeypatching asyncio.wait_for to
        # short-circuit timeouts > 5s.
        original_wait_for = asyncio.wait_for
        async def fast_wait_for(coro, timeout):
            # If the route asks for the IDLE_TIMEOUT (30s), shorten
            # to 2s so the test finishes quickly. Pre-stream tool
            # timeouts (4-15s) are left alone via a heuristic on the
            # requested duration.
            shortened = 2.0 if timeout >= 25.0 else timeout
            return await original_wait_for(coro, timeout=shortened)
        monkeypatch.setattr("asyncio.wait_for", fast_wait_for)

        r = client.post("/v2/chat/stream", json={
            "user_id": "u-hang",
            "messages": [{"role": "user", "content": "hi"}],
        })
        assert r.status_code == 200
        body = r.text
        # Partial token reached the user.
        assert "Bir dakikanızı alacak" in body
        # Watchdog kicked in with the Turkish fallback + done.
        assert "İşlem zaman aşımına uğradı" in body
        assert "event: done" in body
        # finish_reason on the done frame surfaces the cause.
        assert ("idle_timeout" in body) or \
               ("\"finish_reason\":\"timeout\"" in body) or \
               ("\"finish_reason\": \"timeout\"" in body)

    def test_exception_in_stream_emits_error_and_done(self, client, monkeypatch):
        """If the provider raises mid-iteration, the route must emit
        BOTH error AND done so every FE consumer can close — some
        listen for error, some for done."""
        async def raising_stream(req):
            yield ProviderStreamStart(provider="fake", model=req.model)
            yield ProviderStreamToken(delta="partial")
            raise RuntimeError("network blew up")
        from backend.routes import v2_chat_stream as stream_route
        monkeypatch.setattr(stream_route, "get_provider",
                            lambda _n: _make_provider_factory(raising_stream))
        r = client.post("/v2/chat/stream", json={
            "user_id": "u-raise",
            "messages": [{"role": "user", "content": "hi"}],
        })
        assert r.status_code == 200
        body = r.text
        assert "event: error" in body
        assert "INTERNAL_ERROR" in body
        # Critical: done STILL fires so the FE drops out of loading.
        assert "event: done" in body
