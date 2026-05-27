# coding: utf-8
"""Google Gemini provider (Phase 4.3).

Implements the BaseAIProvider interface using the
google-generativeai SDK (already in requirements.txt). Registered
in `registry.py` when GEMINI_API_KEY is set. The Research Agent's
default tier (Phase 4.3) routes here for long-context synthesis.

Streaming is intentionally NOT implemented in this iteration —
Gemini's stream API differs from OpenAI/Anthropic enough that
correctness across providers needs its own validation. The
chat_completion (non-streaming) path is what the agent runtime
calls for specialists, so streaming-less is sufficient for Phase 4.3.

Tool use is NOT implemented either — Gemini's function-call format
differs from OpenAI's tools= shape, and the Supervisor's tool-using
path remains on OpenAI for now (Phase 4.3.B will add cross-provider
tool calling). Specialists routed here always have allowed_tools=()
so this limitation is invisible at the runtime level.
"""
import asyncio
import logging
import os
from typing import Any, Dict, List, Tuple

from backend.services.providers.base import BaseAIProvider
from backend.services.providers.errors import (
    ProviderAuthError,
    ProviderInvalidRequestError,
    ProviderTimeoutError,
    ProviderUnavailableError,
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
    # Phase 9 vision wiring — Gemini's vision blocks have a different
    # shape and we haven't yet wired raw bytes into the parts list, so
    # the route never sends multimodal content to this provider. If a
    # caller still pushes list content here, we flatten the text blocks
    # and drop the rest with a single info log so the provider doesn't
    # crash. The user-visible "this model doesn't support image
    # analysis" warning is emitted by the route based on
    # `model_supports_vision`, not here.
    def _flatten(c) -> str:
        if isinstance(c, list):
            parts: List[str] = []
            for block in c:
                if isinstance(block, dict) and block.get("type") == "text":
                    parts.append(str(block.get("text") or ""))
            return "\n".join(p for p in parts if p)
        return str(c or "")

    system_parts: List[str] = []
    contents: List[Dict[str, Any]] = []
    for m in request.messages or []:
        flat = _flatten(m.content)
        if m.role == "system":
            if flat.strip():
                system_parts.append(flat)
            continue
        gemini_role = "model" if m.role == "assistant" else "user"
        contents.append({
            "role":  gemini_role,
            "parts": [{"text": flat}],
        })
    system_text = "\n\n".join(system_parts) if system_parts else None
    return system_text, contents


class GeminiProvider(BaseAIProvider):
    name = "google"
    default_model = DEFAULT_GEMINI_MODEL
    supports_streaming = False        # Phase 4.3 — non-streaming only

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


__all__ = ["GeminiProvider", "DEFAULT_GEMINI_MODEL"]
