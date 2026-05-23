# coding: utf-8
"""Google Gemini provider (Phase 4.3 + 5.2 streaming).

Implements the BaseAIProvider interface using the
google-generativeai SDK (already in requirements.txt). Registered
in `registry.py` when GEMINI_API_KEY is set. The Research Agent's
default tier (Phase 4.3) routes here for long-context synthesis.

Phase 5.2 — added stream_chat_completion. The Gemini SDK exposes a
sync streaming iterator via generate_content(stream=True). We pump
chunks off the iterator in a worker thread + push deltas onto an
asyncio.Queue so the async generator can yield them out cleanly.
Falls back to a terminal ProviderStreamError if streaming isn't
available (older SDK or upstream rejection).

Tool use is NOT implemented either — Gemini's function-call format
differs from OpenAI's tools= shape, and the Supervisor's tool-using
path remains on OpenAI for now (Phase 4.3.B will add cross-provider
tool calling). Specialists routed here always have allowed_tools=()
so this limitation is invisible at the runtime level.
"""
import asyncio
import logging
import os
from typing import Any, AsyncIterator, Dict, List, Tuple

from backend.services.providers.base import BaseAIProvider
from backend.services.providers.errors import (
    ProviderAuthError,
    ProviderError,
    ProviderInvalidRequestError,
    ProviderTimeoutError,
    ProviderUnavailableError,
)
from backend.services.providers.streaming import (
    ProviderStreamDone,
    ProviderStreamError,
    ProviderStreamEvent,
    ProviderStreamStart,
    ProviderStreamToken,
)
from backend.services.providers.types import (
    ProviderMessage,
    ProviderRequest,
    ProviderResult,
    ProviderUsage,
)

logger = logging.getLogger(__name__)


# Default Gemini model id. Env overrides via the MODEL_RESEARCH +
# MODEL_REASONING tiers in model_routing.py; this default is only used
# when no spec or env specifies a model and the caller asked for Gemini
# explicitly.
DEFAULT_GEMINI_MODEL = os.getenv("MODEL_GEMINI", "gemini-2.5-pro")


def _split_messages(
    request: ProviderRequest,
) -> Tuple[str | None, List[Dict[str, Any]]]:
    """Translate ProviderMessage[] → (system_instruction, contents[]).

    Gemini's API takes the system text as a top-level argument
    (`system_instruction`) and the rest as `contents` with `role`
    ('user' or 'model'). We map:
      - ProviderMessage role='system'    → system_instruction (joined)
      - ProviderMessage role='user'      → contents role='user'
      - ProviderMessage role='assistant' → contents role='model'
    """
    system_parts: List[str] = []
    contents: List[Dict[str, Any]] = []
    for m in request.messages or []:
        if m.role == "system":
            if (m.content or "").strip():
                system_parts.append(m.content)
            continue
        gemini_role = "model" if m.role == "assistant" else "user"
        contents.append({
            "role":  gemini_role,
            "parts": [{"text": m.content or ""}],
        })
    system_text = "\n\n".join(system_parts) if system_parts else None
    return system_text, contents


class GeminiProvider(BaseAIProvider):
    name = "google"
    default_model = DEFAULT_GEMINI_MODEL
    supports_streaming = True         # Phase 5.2 — streaming added

    def is_available(self) -> bool:
        return bool((os.getenv("GEMINI_API_KEY") or "").strip())

    def describe(self) -> Dict[str, Any]:
        base = super().describe()
        base["model_family"] = "gemini"
        return base

    def _configure(self):
        """Lazy SDK import + configure(api_key=...). Raises
        ProviderUnavailableError when the package is missing — keeps
        registry imports cheap so unit tests that don't touch Gemini
        never need google-generativeai installed."""
        try:
            import google.generativeai as genai  # type: ignore
        except ImportError as exc:
            raise ProviderUnavailableError(
                "google-generativeai SDK not installed in this environment.",
                provider=self.name,
                details={"reason": str(exc)},
            )
        api_key = (os.getenv("GEMINI_API_KEY") or "").strip()
        if not api_key:
            raise ProviderUnavailableError(
                "Gemini is not configured (missing GEMINI_API_KEY).",
                provider=self.name,
            )
        genai.configure(api_key=api_key)
        return genai

    async def chat_completion(self, request: ProviderRequest) -> ProviderResult:
        if not self.is_available():
            raise ProviderUnavailableError(
                "Gemini is not configured (missing GEMINI_API_KEY).",
                provider=self.name,
            )

        genai = self._configure()
        model_id = request.model or self.default_model
        system_text, contents = _split_messages(request)

        generation_config = {
            "temperature": float(request.temperature or 0.7),
        }
        if request.max_tokens:
            generation_config["max_output_tokens"] = int(request.max_tokens)

        try:
            model = genai.GenerativeModel(
                model_name=model_id,
                system_instruction=system_text,
                generation_config=generation_config,
            )
        except Exception as exc:
            # Most often a bad model id — Gemini surfaces this at
            # model-instantiation time, not at generate_content_async.
            raise ProviderInvalidRequestError(
                f"Gemini rejected model {model_id!r}: {exc}",
                provider=self.name,
                details={"model": model_id},
            )

        # SDK is sync; run in a thread + await with timeout so a hung
        # request doesn't block the agent runtime indefinitely.
        loop = asyncio.get_event_loop()
        try:
            response = await asyncio.wait_for(
                loop.run_in_executor(
                    None, lambda: model.generate_content(contents)
                ),
                timeout=float(request.timeout_s or 30.0),
            )
        except asyncio.TimeoutError:
            raise ProviderTimeoutError(
                f"Gemini request timed out after {request.timeout_s}s.",
                provider=self.name,
            )
        except Exception as exc:
            # Map auth errors so the fallback layer can detect + retry.
            msg = str(exc).lower()
            if any(k in msg for k in ("api_key", "permission", "unauthenticated", "403")):
                raise ProviderAuthError(
                    f"Gemini rejected the request (auth): {exc}",
                    provider=self.name,
                )
            raise ProviderInvalidRequestError(
                f"Gemini request failed: {exc}",
                provider=self.name,
                details={"model": model_id},
            )

        # Extract text safely — Gemini SDK shapes vary across versions.
        text = ""
        try:
            text = response.text or ""
        except Exception:
            # Some Gemini responses (safety filtered) don't expose .text.
            try:
                candidates = getattr(response, "candidates", []) or []
                for cand in candidates:
                    content = getattr(cand, "content", None)
                    if content is None:
                        continue
                    parts = getattr(content, "parts", []) or []
                    for part in parts:
                        t = getattr(part, "text", "")
                        if t:
                            text += t
            except Exception:
                pass
        if not text:
            raise ProviderInvalidRequestError(
                "Gemini returned an empty / safety-filtered response.",
                provider=self.name,
                details={"model": model_id},
            )

        # Usage extraction — Gemini exposes usage_metadata on the response.
        usage = ProviderUsage()
        try:
            um = getattr(response, "usage_metadata", None)
            if um is not None:
                usage.prompt_tokens     = int(getattr(um, "prompt_token_count", 0) or 0)
                usage.completion_tokens = int(getattr(um, "candidates_token_count", 0) or 0)
                usage.total_tokens      = int(getattr(um, "total_token_count", 0) or 0)
        except Exception:
            pass

        finish_reason = None
        try:
            candidates = getattr(response, "candidates", []) or []
            if candidates:
                fr = getattr(candidates[0], "finish_reason", None)
                if fr is not None:
                    finish_reason = str(fr)
        except Exception:
            pass

        return ProviderResult(
            content=text,
            model=model_id,
            provider=self.name,
            usage=usage,
            finish_reason=finish_reason,
            raw=None,
        )

    # ── Streaming (Phase 5.2) ─────────────────────────────────────────

    async def stream_chat_completion(
        self, request: ProviderRequest,
    ) -> AsyncIterator[ProviderStreamEvent]:
        """Stream tokens from Gemini's generate_content(stream=True).

        Gemini's SDK is sync — the streaming response is a sync iterator
        that yields chunked GenerateContentResponse objects. We pump it
        in a worker thread + push deltas onto an asyncio.Queue so this
        async generator can yield them out without blocking the event
        loop. Terminal: ProviderStreamDone with cumulative usage when
        the upstream stream completes naturally; ProviderStreamError on
        any auth / invalid-request / timeout / sdk failure.
        """
        if not self.is_available():
            yield ProviderStreamError(
                code="PROVIDER_UNAVAILABLE",
                message="Gemini is not configured (missing GEMINI_API_KEY).",
                provider=self.name,
            )
            return

        try:
            genai = self._configure()
        except ProviderError as exc:
            yield ProviderStreamError(
                code=getattr(exc, "code", "PROVIDER_UNAVAILABLE"),
                message=str(exc)[:300],
                provider=self.name,
            )
            return

        model_id = request.model or self.default_model
        system_text, contents = _split_messages(request)
        generation_config: Dict[str, Any] = {
            "temperature": float(request.temperature or 0.7),
        }
        if request.max_tokens:
            generation_config["max_output_tokens"] = int(request.max_tokens)

        try:
            model = genai.GenerativeModel(
                model_name=model_id,
                system_instruction=system_text,
                generation_config=generation_config,
            )
        except Exception as exc:
            yield ProviderStreamError(
                code="PROVIDER_INVALID_REQUEST",
                message=f"Gemini rejected model {model_id!r}: {exc}",
                provider=self.name,
            )
            return

        yield ProviderStreamStart(provider=self.name, model=model_id)

        # Pump the sync iterator in a worker thread, push onto a queue.
        # Sentinel objects mark stream end / errors so the async loop
        # below can distinguish them from real chunks.
        loop = asyncio.get_event_loop()
        queue: asyncio.Queue = asyncio.Queue(maxsize=64)
        _DONE = object()
        _ERR = object()

        usage_state: Dict[str, int] = {
            "prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0,
        }
        finish_state: Dict[str, Any] = {"reason": None, "error": None}

        def _pump():
            try:
                response = model.generate_content(contents, stream=True)
                for chunk in response:
                    # Best-effort delta extraction. Some chunks carry
                    # ONLY usage_metadata (final chunk on newer SDKs).
                    delta = ""
                    try:
                        # Chunk-level .text may raise if no text part —
                        # iterate parts manually as a fallback.
                        try:
                            delta = chunk.text or ""
                        except Exception:
                            parts = []
                            for cand in getattr(chunk, "candidates", []) or []:
                                content = getattr(cand, "content", None)
                                if content is None:
                                    continue
                                for part in getattr(content, "parts", []) or []:
                                    t = getattr(part, "text", "")
                                    if t:
                                        parts.append(t)
                            delta = "".join(parts)
                    except Exception:
                        delta = ""

                    if delta:
                        # Schedule onto the loop. put_nowait would race
                        # with the consumer; use call_soon_threadsafe.
                        asyncio.run_coroutine_threadsafe(
                            queue.put(("delta", delta)), loop,
                        )

                    # Snapshot usage if this chunk carries it.
                    try:
                        um = getattr(chunk, "usage_metadata", None)
                        if um is not None:
                            usage_state["prompt_tokens"]     = int(getattr(um, "prompt_token_count",     0) or 0)
                            usage_state["completion_tokens"] = int(getattr(um, "candidates_token_count", 0) or 0)
                            usage_state["total_tokens"]      = int(getattr(um, "total_token_count",      0) or 0)
                    except Exception:
                        pass

                    # Snapshot finish reason if this chunk carries it.
                    try:
                        cands = getattr(chunk, "candidates", []) or []
                        if cands:
                            fr = getattr(cands[0], "finish_reason", None)
                            if fr is not None:
                                finish_state["reason"] = str(fr)
                    except Exception:
                        pass

                asyncio.run_coroutine_threadsafe(queue.put(_DONE), loop)
            except Exception as exc:
                finish_state["error"] = exc
                asyncio.run_coroutine_threadsafe(queue.put(_ERR), loop)

        worker = loop.run_in_executor(None, _pump)

        try:
            while True:
                try:
                    item = await asyncio.wait_for(
                        queue.get(),
                        timeout=float(request.timeout_s or 30.0),
                    )
                except asyncio.TimeoutError:
                    yield ProviderStreamError(
                        code="PROVIDER_TIMEOUT",
                        message=f"Gemini stream stalled (no chunk in {request.timeout_s}s).",
                        provider=self.name,
                    )
                    return
                if item is _DONE:
                    break
                if item is _ERR:
                    exc = finish_state["error"]
                    msg = str(exc) if exc else "Gemini stream errored"
                    code = "PROVIDER_INVALID_REQUEST"
                    if exc is not None:
                        m = msg.lower()
                        if any(k in m for k in ("api_key", "permission", "unauthenticated", "403")):
                            code = "PROVIDER_AUTH"
                        elif "timeout" in m:
                            code = "PROVIDER_TIMEOUT"
                    yield ProviderStreamError(
                        code=code, message=msg[:300], provider=self.name,
                    )
                    return
                # Real delta tuple
                kind, payload = item
                if kind == "delta" and payload:
                    yield ProviderStreamToken(delta=payload)
        finally:
            # Ensure the worker thread fully finishes so we don't leak.
            try:
                await worker
            except Exception:
                pass

        usage = ProviderUsage(
            prompt_tokens=     usage_state["prompt_tokens"],
            completion_tokens= usage_state["completion_tokens"],
            total_tokens=      usage_state["total_tokens"] or (
                usage_state["prompt_tokens"] + usage_state["completion_tokens"]
            ),
        )
        yield ProviderStreamDone(
            finish_reason=finish_state["reason"],
            usage=usage,
            model=model_id,
        )


__all__ = ["GeminiProvider", "DEFAULT_GEMINI_MODEL"]
