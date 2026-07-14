# coding: utf-8
import os
import json
import logging
import re
import asyncio
import time
import openai
import httpx
import google.generativeai as genai
from dataclasses import dataclass
from typing import Optional
from data_sources import CRYPTO_SYMBOLS, KNOWN_STOCKS

logger = logging.getLogger(__name__)

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
AI_TIMEOUT     = 30
FALLBACK_MSG   = "Simdi yanit veremiyorum, biraz sonra tekrar dene."

# ── Phase 13C.1 — dedicated, truthful Frontend Builder transport (OpenAI Responses
# API). This is ISOLATED from the generic ask_ai/ask_openai path used by every other
# mode: it never falls back to Gemini, never retries, and never launders a provider
# failure into a "completed" frontend project. Only the frontend_builder mode uses it. ──
OPENAI_RESPONSES_URL       = "https://api.openai.com/v1/responses"
FRONTEND_CONNECT_TIMEOUT_S = 15    # dedicated: connect no more than 15s
FRONTEND_READ_TIMEOUT_S    = 180   # dedicated: large multi-file frontend responses
# Phase 13E — dedicated website PLANNING timeouts (same Responses transport as the
# frontend builder). Connect stays ≤15s; the read budget is large so a full plan +
# design + copy contract can complete.
WEBSITE_CONNECT_TIMEOUT_S  = 15
WEBSITE_READ_TIMEOUT_S     = 180
# Phase 13F.1 — OpenAI Background Responses timeouts. The CREATE call only enqueues the
# task (it returns quickly with queued/in_progress), and each RETRIEVE poll fetches the
# stored Response object — so both use SHORT read timeouts. No single request stays open
# for the full multi-minute generation.
BACKGROUND_CONNECT_TIMEOUT_S      = 15
BACKGROUND_CREATE_READ_TIMEOUT_S  = 30
BACKGROUND_POLL_READ_TIMEOUT_S    = 30
BACKGROUND_CANCEL_READ_TIMEOUT_S  = 15
_MAX_ERR_KIND_CHARS        = 80
_MAX_ERR_MSG_CHARS         = 300

try:
    genai.configure(api_key=GEMINI_API_KEY)
except Exception:
    pass

_SAFETY_RESPONSE = (
    "Bu konuda kesin bir yonlendirme yapamam.\n\n"
    "Bir uzmana danışmanı oneririm:\n"
    "- Saglik: doktor veya psikolog\n"
    "- Hukuk: avukat\n"
    "- Kriz: 182 (Turkiye kriz hatti)\n\n"
    "Baska bir konuda yardimci olabilir miyim?"
)

_SAFETY_KW = [
    "intihar", "kendine zarar", "ilac dozu", "overdose",
    "silah yap", "patlayici", "nasil oldurebilirim",
]


def _is_safety_sensitive(message: str) -> bool:
    t = message.lower()
    return any(k in t for k in _SAFETY_KW)


def _needs_completion_tokens_param(model: str) -> bool:
    """Phase 13C — model-family compatibility. The modern reasoning-family models
    (gpt-5.x and the o-series) reject the legacy Chat Completions `max_tokens`
    parameter and only accept the default temperature; they require
    `max_completion_tokens` instead. This is keyed on the model ID ONLY, so every
    gpt-4o / gpt-4o-mini mode keeps the exact legacy request shape and is unaffected.
    """
    m = (model or "").lower()
    return (
        m.startswith("gpt-5")
        or m.startswith("o1")
        or m.startswith("o3")
        or m.startswith("o4")
    )


async def ask_openai(
    prompt: str,
    system: str = "",
    history: list = None,
    model: str = "gpt-4o-mini",
    temperature: float = 0.80,
    max_tokens: int = 1000,
) -> str:
    try:
        client = openai.AsyncOpenAI(api_key=OPENAI_API_KEY)
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        if history:
            for role, content in history:
                messages.append({"role": role, "content": content})
        messages.append({"role": "user", "content": prompt})
        # Narrow, model-aware request shape. Legacy models keep max_tokens + custom
        # temperature exactly as before; the modern frontend model family uses
        # max_completion_tokens and the default temperature. No extra call, no retry.
        create_kwargs = {"model": model, "messages": messages}
        if _needs_completion_tokens_param(model):
            create_kwargs["max_completion_tokens"] = max_tokens
        else:
            create_kwargs["max_tokens"] = max_tokens
            create_kwargs["temperature"] = temperature
        resp = await asyncio.wait_for(
            client.chat.completions.create(**create_kwargs),
            timeout=AI_TIMEOUT,
        )
        result = resp.choices[0].message.content
        if not result or not result.strip():
            logger.warning("OpenAI empty response, Gemini fallback")
            return await ask_gemini(prompt, system)
        return result
    except asyncio.TimeoutError:
        logger.warning("OpenAI timeout, Gemini fallback")
        return await ask_gemini(prompt, system)
    except Exception as e:
        logger.warning("OpenAI error (" + model + "): " + str(e))
        return await ask_gemini(prompt, system)


async def ask_gemini(prompt: str, system: str = "") -> str:
    try:
        model = genai.GenerativeModel("gemini-2.0-flash-exp")
        full  = (system + "\n\n" + prompt) if system else prompt
        response = await asyncio.wait_for(
            asyncio.get_event_loop().run_in_executor(None, model.generate_content, full),
            timeout=AI_TIMEOUT,
        )
        result = response.text
        return result if result and result.strip() else FALLBACK_MSG
    except asyncio.TimeoutError:
        logger.error("Gemini timeout")
        return FALLBACK_MSG
    except Exception as e:
        logger.error("Gemini error: " + str(e))
        return FALLBACK_MSG


async def ask_ai(
    prompt: str,
    system: str = "",
    history: list = None,
    use_gpt4: bool = False,
    model: str = None,
    temperature: float = 0.80,
    max_tokens: int = 1000,
) -> str:
    # Safety check before any AI call
    if _is_safety_sensitive(prompt):
        return _SAFETY_RESPONSE

    # Phase 2 — project context injection. When /chat received a
    # project_id, the request handler pushed a Project Context block
    # into a ContextVar (no signature change anywhere in the chain).
    # We prepend it here so the LLM sees project memory before any
    # mode-specific system text. Silently no-op when ENABLE_PROJECTS
    # is off or no block was set — chat must never break because of
    # a missing/broken projects table.
    try:
        from backend.services.projects.context import get_current_project_context
        _project_block = get_current_project_context()
    except Exception:
        _project_block = ""
    if _project_block:
        system = (
            _project_block + "\n\n" + system if (system or "").strip()
            else _project_block
        )

    if model is None:
        model = "gpt-4o" if use_gpt4 else "gpt-4o-mini"
    t0 = time.monotonic()
    result = await ask_openai(prompt, system, history, model, temperature, max_tokens)
    elapsed = round(time.monotonic() - t0, 2)
    logger.info("ask_ai | model=%s | time=%ss | chars=%s", model, elapsed, len(result))
    return result


async def detect_intent(message: str) -> dict:
    if _is_safety_sensitive(message):
        return {"intent": "safety_sensitive", "symbol": None, "needs_clarification": False}

    prompt = (
        "Analyze the user message and return only JSON.\n\n"
        "Message: \"" + message + "\"\n\n"
        "INTENT CATEGORIES:\n"
        "consumer_advice: User wants to BUY something for personal use.\n"
        "  Examples: 'tablet almak istiyorum', 'hangi telefon', 'laptop oner'\n\n"
        "ecommerce: User wants to SELL/dropship. Keywords: satmak, dropshipping, shopify.\n\n"
        "ads: Advertising, Facebook/TikTok/Instagram ads, marketing.\n\n"
        "product_research: Seller perspective market research, profit margin, supplier.\n\n"
        "finance: Financial analysis.\n"
        "crypto: Crypto currency.\n"
        "stock: Stocks.\n"
        "news: News/events.\n"
        "task: Reminder or task.\n"
        "memory: Save or recall something.\n"
        "portfolio: Investment portfolio.\n"
        "normal_chat: Casual.\n"
        "personal_advice: Life/decision advice.\n"
        "emotional_support: Stress, sadness, motivation, anxiety.\n"
        "coding: Programming, code, error, deploy.\n"
        "education: Explain/teach/learn/understand.\n"
        "general_question: Factual/general.\n"
        "safety_sensitive: Self-harm, dangerous instructions.\n\n"
        "RULES:\n"
        "- Personal buying = consumer_advice ALWAYS\n"
        "- Selling/dropship = ecommerce ALWAYS\n"
        "- Stress/sad = emotional_support ALWAYS\n"
        "- Explain/teach = education ALWAYS\n"
        "- Uncertain = normal_chat\n\n"
        "JSON:\n"
        "{\n"
        "  \"intent\": \"category\",\n"
        "  \"symbol\": \"symbol or null\",\n"
        "  \"asset_type\": \"crypto or stock or null\",\n"
        "  \"task_text\": \"task text or null\",\n"
        "  \"memory_action\": \"save or forget or list or null\",\n"
        "  \"memory_content\": \"content or null\",\n"
        "  \"forget_keyword\": \"keyword or null\",\n"
        "  \"needs_clarification\": false\n"
        "}\n\nReturn only JSON."
    )
    try:
        client = openai.AsyncOpenAI(api_key=OPENAI_API_KEY)
        resp = await asyncio.wait_for(
            client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[{"role": "user", "content": prompt}],
                max_tokens=300,
                temperature=0.1,
                response_format={"type": "json_object"},
            ),
            timeout=15,
        )
        result = json.loads(resp.choices[0].message.content)
        # Symbol detection fallback
        if not result.get("symbol"):
            for word in message.upper().split():
                clean = re.sub(r"[^A-Z]", "", word)
                if not clean or len(clean) < 2:
                    continue
                if clean in CRYPTO_SYMBOLS:
                    result["symbol"] = clean
                    result["asset_type"] = "crypto"
                    if result.get("intent") not in ["finance", "crypto", "stock"]:
                        result["intent"] = "crypto"
                    break
                elif clean in KNOWN_STOCKS:
                    result["symbol"] = clean
                    result["asset_type"] = "stock"
                    if result.get("intent") not in ["finance", "crypto", "stock"]:
                        result["intent"] = "stock"
                    break
        return result
    except asyncio.TimeoutError:
        logger.warning("detect_intent timeout")
        return {"intent": "normal_chat", "symbol": None, "needs_clarification": False}
    except Exception as e:
        logger.error("detect_intent error: " + str(e))
        return {"intent": "normal_chat", "symbol": None, "needs_clarification": False}


# ── Phase 13C.1 — dedicated Frontend Builder Responses API transport ─────────────
@dataclass
class StructuredAIResult:
    """Truthful, bounded execution result for the dedicated frontend_builder transport.

    `ok` is unambiguous: True ONLY when the Responses API returned a completed result
    with non-empty output text. `fallback_used` is ALWAYS False here (this transport
    never calls Gemini). No API key, authorization header, raw exception repr or full
    provider payload is ever stored — only bounded, sanitized diagnostics.
    """
    ok: bool
    text: str
    model: str
    provider: str
    endpoint: str
    request_id: Optional[str]
    execution_status: str          # succeeded | failed | timeout | incomplete
    latency_ms: int
    fallback_used: bool
    error_kind: Optional[str] = None
    error_code: Optional[str] = None
    error_message: Optional[str] = None


def _sanitize_error_text(msg, limit: int = _MAX_ERR_MSG_CHARS) -> Optional[str]:
    """Bounded, single-line, key-free error string. Never a raw exception repr."""
    if msg is None:
        return None
    s = str(msg).replace("\n", " ").replace("\r", " ").strip()
    if not s:
        return None
    # Defensive: never leak an authorization header / bearer token if a provider ever
    # echoed one back inside an error message.
    s = re.sub(r"(?i)bearer\s+[A-Za-z0-9._\-]+", "Bearer [redacted]", s)
    s = re.sub(r"sk-[A-Za-z0-9._\-]{6,}", "[redacted]", s)
    return s[:limit]


def _frontend_reasoning_effort(prompt: str) -> str:
    """Deterministic reasoning effort from the leading task marker. The static review
    is cheaper (low); every build/repair task uses medium. Bounded to documented values."""
    return "low" if "[FRONTEND REVIEW REQUEST]" in (prompt or "") else "medium"


def _extract_responses_output_text(data: dict) -> str:
    """Concatenate ONLY documented message output_text parts from a Responses API result.

    Reasoning items, tool items and any non-message output are ignored. The text is
    preserved byte-for-byte (only concatenated) — no envelope markers, no repair, no
    Markdown stripping."""
    parts = []
    output = data.get("output")
    if isinstance(output, list):
        for item in output:
            if not isinstance(item, dict) or item.get("type") != "message":
                continue
            content = item.get("content")
            if not isinstance(content, list):
                continue
            for c in content:
                if isinstance(c, dict) and c.get("type") == "output_text":
                    t = c.get("text")
                    if isinstance(t, str):
                        parts.append(t)
    return "".join(parts)


async def ask_openai_responses_structured(
    prompt: str,
    system: str,
    model: str,
    max_output_tokens: int,
    reasoning_effort: str,
    connect_timeout_s: int,
    read_timeout_s: int,
    operation: str,
) -> StructuredAIResult:
    """Reusable, isolated OpenAI Responses API call for a STRUCTURED builder task
    (website planning or frontend generation). Exactly one request. No streaming, tools,
    web search, conversation persistence or previous-response state. No Gemini fallback
    and no retry. Returns a truthful StructuredAIResult; a provider failure is NEVER
    reported as success and the generic chat fallback sentence is never produced here.
    `operation` only labels internal diagnostics (never a secret)."""
    started = time.monotonic()

    def _elapsed_ms() -> int:
        return int((time.monotonic() - started) * 1000)

    def _fail(
        execution_status: str,
        error_kind: str,
        error_code=None,
        error_message=None,
        request_id: Optional[str] = None,
        result_model: Optional[str] = None,
    ) -> StructuredAIResult:
        return StructuredAIResult(
            ok=False,
            text="",
            model=result_model or model,
            provider="openai",
            endpoint="responses",
            request_id=request_id,
            execution_status=execution_status,
            latency_ms=_elapsed_ms(),
            fallback_used=False,
            error_kind=(str(error_kind)[:_MAX_ERR_KIND_CHARS] if error_kind else None),
            error_code=(str(error_code)[:_MAX_ERR_KIND_CHARS] if error_code not in (None, "") else None),
            error_message=_sanitize_error_text(error_message),
        )

    if not OPENAI_API_KEY:
        return _fail("failed", "missing-api-key", error_message="OPENAI_API_KEY is not configured.")

    headers = {
        "Authorization": "Bearer " + OPENAI_API_KEY,
        "Content-Type": "application/json",
    }
    body = {
        "model": model,
        "instructions": system or "",
        "input": prompt,
        "max_output_tokens": max_output_tokens,
        "reasoning": {"effort": reasoning_effort},
        "store": False,
        "stream": False,
    }
    timeout = httpx.Timeout(read_timeout_s, connect=connect_timeout_s)

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(OPENAI_RESPONSES_URL, headers=headers, json=body)
    except (httpx.ConnectTimeout, httpx.ReadTimeout, httpx.WriteTimeout, httpx.PoolTimeout, httpx.TimeoutException):
        return _fail("timeout", "timeout", error_message="The " + operation + " Responses API request timed out.")
    except httpx.HTTPError as e:
        return _fail("failed", "connection-error", error_message=type(e).__name__)
    except Exception as e:
        return _fail("failed", "internal-transport-error", error_message=type(e).__name__)

    # ── HTTP-level failure classification (bounded provider code/message only). ──
    if resp.status_code >= 400:
        code = None
        emsg = None
        try:
            j = resp.json()
            err = j.get("error") if isinstance(j, dict) else None
            if isinstance(err, dict):
                code = err.get("code") or err.get("type")
                emsg = err.get("message")
        except Exception:
            pass
        sc = resp.status_code
        kind = (
            "authentication-error" if sc == 401
            else "permission-or-model-access" if sc in (403, 404)
            else "rate-limit" if sc == 429
            else "invalid-request" if sc == 400
            else "http-error"
        )
        return _fail("failed", kind, error_code=(code or sc), error_message=(emsg or ("HTTP " + str(sc))))

    try:
        data = resp.json()
    except Exception:
        return _fail("failed", "malformed-provider-response", error_message="Response body was not valid JSON.")
    if not isinstance(data, dict):
        return _fail("failed", "malformed-provider-response", error_message="Response body was not a JSON object.")

    request_id = data.get("id") if isinstance(data.get("id"), str) else None
    result_model = data.get("model") if isinstance(data.get("model"), str) else model
    status = data.get("status")

    # Incomplete because of output limits (or other incomplete reason) — NOT success.
    if status == "incomplete":
        reason = None
        det = data.get("incomplete_details")
        if isinstance(det, dict):
            reason = det.get("reason")
        return _fail(
            "incomplete", "incomplete-response",
            error_code=reason,
            error_message="The Responses API returned an incomplete result (output limit or truncation).",
            request_id=request_id, result_model=result_model,
        )

    # A documented terminal failure status.
    if status not in ("completed", None):
        err = data.get("error")
        code = err.get("code") if isinstance(err, dict) else None
        emsg = err.get("message") if isinstance(err, dict) else None
        return _fail(
            "failed", "malformed-provider-response",
            error_code=(code or status),
            error_message=(emsg or ("unexpected response status: " + str(status))),
            request_id=request_id, result_model=result_model,
        )

    text = _extract_responses_output_text(data)
    if not text or not text.strip():
        return _fail(
            "failed", "empty-output",
            error_message="The Responses API returned no message output_text.",
            request_id=request_id, result_model=result_model,
        )

    return StructuredAIResult(
        ok=True,
        text=text,
        model=result_model,
        provider="openai",
        endpoint="responses",
        request_id=request_id,
        execution_status="succeeded",
        latency_ms=_elapsed_ms(),
        fallback_used=False,
    )


async def ask_openai_frontend_structured(
    prompt: str,
    system: str,
    model: str,
    max_output_tokens: int,
) -> StructuredAIResult:
    """Dedicated, isolated OpenAI Responses API call for the frontend_builder mode
    (Phase 13C.1). Thin, byte-equivalent wrapper over the reusable transport: same
    frontend timeouts, same task-marker reasoning selection, same no-fallback rule."""
    return await ask_openai_responses_structured(
        prompt=prompt,
        system=system,
        model=model,
        max_output_tokens=max_output_tokens,
        reasoning_effort=_frontend_reasoning_effort(prompt),
        connect_timeout_s=FRONTEND_CONNECT_TIMEOUT_S,
        read_timeout_s=FRONTEND_READ_TIMEOUT_S,
        operation="frontend",
    )


async def ask_openai_website_structured(
    prompt: str,
    system: str,
    model: str,
    max_output_tokens: int,
) -> StructuredAIResult:
    """Phase 13E — dedicated, isolated OpenAI Responses API call for website_builder
    planning (initial planning + strict planning repair + design-plan repair). One
    request; no Gemini/other-model fallback; no retry.

    Phase 13E.3 — reasoning effort is LOW (was medium): website_builder is now
    PLANNING-ONLY (strategy / architecture / copy contract, no React source). The
    contract is explicit and structured, so it does not need medium hidden reasoning —
    lowering it reduces the work that was pushing GPT-5.6 past the 180s planning window.
    This changes ONLY the website-planning wrapper; the frontend builder / review /
    revision reasoning selection is untouched."""
    return await ask_openai_responses_structured(
        prompt=prompt,
        system=system,
        model=model,
        max_output_tokens=max_output_tokens,
        reasoning_effort="low",
        connect_timeout_s=WEBSITE_CONNECT_TIMEOUT_S,
        read_timeout_s=WEBSITE_READ_TIMEOUT_S,
        operation="website planning",
    )


# ── Phase 13F.1 — OpenAI Background Responses for long-running full-source tasks ─────
# Full-source frontend generation (initial / contract-repair / quality-repair / revision)
# genuinely runs longer than one synchronous 180s Responses request. Instead of holding a
# request open, we CREATE the Response with background=true/store=true (returns quickly),
# then RETRIEVE it via short polls until a terminal status. Static reviews stay synchronous.

# The full-source frontend task kinds that use Background mode. Static reviews stay
# synchronous; an unknown marker is NOT silently promoted to expensive background mode.
_FRONTEND_BACKGROUND_TASK_KINDS = frozenset({
    "initial-generation", "contract-repair", "quality-repair", "revision",
})


def _frontend_task_kind(prompt: str) -> str:
    """Deterministically classify a frontend_builder request by its EXACT task markers
    (never by response length). Returns one of: initial-generation, contract-repair,
    quality-repair, revision, initial-review, final-review, unknown."""
    p = prompt or ""
    if "[FRONTEND BUILDER REQUEST]" not in p:
        return "unknown"
    if "[FRONTEND REVIEW REQUEST]" in p:
        # The review request carries the stage in its `Task:` line.
        return "final-review" if "stage: post-repair" in p else "initial-review"
    if "[FRONTEND CONTRACT REPAIR REQUEST]" in p:
        return "contract-repair"
    if "[FRONTEND REPAIR REQUEST]" in p:
        return "quality-repair"
    if "[FRONTEND REVISION REQUEST]" in p:
        return "revision"
    # A [FRONTEND BUILDER REQUEST] with a build-spec pair and no sub-marker is the
    # initial full-source generation.
    return "initial-generation"


def _frontend_task_is_background(kind: str) -> bool:
    """True only for full-source tasks. Unknown → False (fail safe to synchronous)."""
    return kind in _FRONTEND_BACKGROUND_TASK_KINDS


_BG_NONTERMINAL = ("queued", "in_progress")


def _classify_background_response(data: dict, fallback_model: str, elapsed_ms: int) -> StructuredAIResult:
    """Map a Responses object (from a background CREATE or a RETRIEVE) to a truthful
    StructuredAIResult. queued/in_progress are NOT errors (no error_kind). completed
    requires non-empty output text. incomplete/failed/cancelled are truthful terminals.
    Uses ONLY the documented output-text extractor — never a length heuristic."""
    request_id = data.get("id") if isinstance(data.get("id"), str) else None
    result_model = data.get("model") if isinstance(data.get("model"), str) else fallback_model
    status = data.get("status")

    def mk(ok: bool, execution_status: str, text: str = "",
           error_kind=None, error_code=None, error_message=None) -> StructuredAIResult:
        return StructuredAIResult(
            ok=ok, text=text, model=result_model, provider="openai", endpoint="responses",
            request_id=request_id, execution_status=execution_status, latency_ms=elapsed_ms,
            fallback_used=False,
            error_kind=(str(error_kind)[:_MAX_ERR_KIND_CHARS] if error_kind else None),
            error_code=(str(error_code)[:_MAX_ERR_KIND_CHARS] if error_code not in (None, "") else None),
            error_message=_sanitize_error_text(error_message),
        )

    if status in _BG_NONTERMINAL:
        return mk(False, status)  # not an error — keep polling
    if status == "completed":
        text = _extract_responses_output_text(data)
        if not text or not text.strip():
            return mk(False, "failed", error_kind="empty-output",
                      error_message="Background Responses completed with no message output_text.")
        return mk(True, "succeeded", text=text)
    if status == "incomplete":
        reason = None
        det = data.get("incomplete_details")
        if isinstance(det, dict):
            reason = det.get("reason")
        return mk(False, "incomplete", error_kind="incomplete-response", error_code=reason,
                  error_message="The background Responses result was incomplete (output limit or truncation).")
    if status == "failed":
        err = data.get("error")
        code = err.get("code") if isinstance(err, dict) else None
        emsg = err.get("message") if isinstance(err, dict) else None
        # Preserve provider quota/rate/access classification via the code.
        return mk(False, "failed", error_kind=(code or "provider-failed"), error_code=code,
                  error_message=(emsg or "The background Responses task failed."))
    if status == "cancelled":
        return mk(False, "cancelled", error_kind="cancelled",
                  error_message="The background Responses task was cancelled.")
    return mk(False, "failed", error_kind="malformed-provider-response",
              error_message="Unexpected background Responses status: " + str(status))


def _bg_http_error_kind(sc: int) -> str:
    return (
        "authentication-error" if sc == 401
        else "permission-or-model-access" if sc in (403, 404)
        else "rate-limit" if sc == 429
        else "invalid-request" if sc == 400
        else "http-error"
    )


async def start_openai_background_structured(
    prompt: str,
    system: str,
    model: str,
    max_output_tokens: int,
    reasoning_effort: str,
    operation: str,
) -> StructuredAIResult:
    """Create ONE OpenAI Background Response (background=true, store=true). Returns quickly:
    execution_status is normally queued/in_progress (ok=False, NO error_kind) with
    request_id = the raw OpenAI response id (kept SERVER-SIDE; never sent to the browser).
    A terminal status returned immediately is classified truthfully. No tools, no web
    search, no previous response, no Gemini fallback, no provider retry."""
    started = time.monotonic()

    def _elapsed_ms() -> int:
        return int((time.monotonic() - started) * 1000)

    def _fail(kind: str, msg=None, code=None) -> StructuredAIResult:
        return StructuredAIResult(
            ok=False, text="", model=model, provider="openai", endpoint="responses",
            request_id=None, execution_status="failed", latency_ms=_elapsed_ms(),
            fallback_used=False, error_kind=kind,
            error_code=(str(code)[:_MAX_ERR_KIND_CHARS] if code not in (None, "") else None),
            error_message=_sanitize_error_text(msg),
        )

    if not OPENAI_API_KEY:
        return _fail("missing-api-key", "OPENAI_API_KEY is not configured.")
    headers = {"Authorization": "Bearer " + OPENAI_API_KEY, "Content-Type": "application/json"}
    body = {
        "model": model,
        "instructions": system or "",
        "input": prompt,
        "max_output_tokens": max_output_tokens,
        "reasoning": {"effort": reasoning_effort},
        "background": True,
        "store": True,
        "stream": False,
    }
    timeout = httpx.Timeout(BACKGROUND_CREATE_READ_TIMEOUT_S, connect=BACKGROUND_CONNECT_TIMEOUT_S)
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(OPENAI_RESPONSES_URL, headers=headers, json=body)
    except (httpx.ConnectTimeout, httpx.ReadTimeout, httpx.WriteTimeout, httpx.PoolTimeout, httpx.TimeoutException):
        return _fail("timeout", "The " + operation + " background create request timed out.")
    except httpx.HTTPError as e:
        return _fail("connection-error", type(e).__name__)
    except Exception as e:
        return _fail("internal-transport-error", type(e).__name__)

    if resp.status_code >= 400:
        code = None
        emsg = None
        try:
            j = resp.json()
            err = j.get("error") if isinstance(j, dict) else None
            if isinstance(err, dict):
                code = err.get("code") or err.get("type")
                emsg = err.get("message")
        except Exception:
            pass
        return _fail(_bg_http_error_kind(resp.status_code), (emsg or ("HTTP " + str(resp.status_code))), code=(code or resp.status_code))

    try:
        data = resp.json()
    except Exception:
        return _fail("malformed-provider-response", "Background create body was not valid JSON.")
    if not isinstance(data, dict):
        return _fail("malformed-provider-response", "Background create body was not a JSON object.")
    return _classify_background_response(data, model, _elapsed_ms())


async def retrieve_openai_background_structured(response_id: str, operation: str) -> StructuredAIResult:
    """Retrieve the SAME Response via GET /v1/responses/{id}. Never creates another Response.
    queued/in_progress → keep polling; completed → extract text; terminal failure/incomplete/
    cancelled → truthful. A missing/expired response (404) is a truthful failure."""
    started = time.monotonic()

    def _elapsed_ms() -> int:
        return int((time.monotonic() - started) * 1000)

    def _fail(kind: str, msg=None, code=None) -> StructuredAIResult:
        return StructuredAIResult(
            ok=False, text="", model="", provider="openai", endpoint="responses",
            request_id=response_id if isinstance(response_id, str) else None,
            execution_status="failed", latency_ms=_elapsed_ms(), fallback_used=False,
            error_kind=kind,
            error_code=(str(code)[:_MAX_ERR_KIND_CHARS] if code not in (None, "") else None),
            error_message=_sanitize_error_text(msg),
        )

    if not OPENAI_API_KEY:
        return _fail("missing-api-key", "OPENAI_API_KEY is not configured.")
    if not response_id or not isinstance(response_id, str):
        return _fail("invalid-request", "Missing background response id.")
    headers = {"Authorization": "Bearer " + OPENAI_API_KEY}
    url = OPENAI_RESPONSES_URL + "/" + response_id
    timeout = httpx.Timeout(BACKGROUND_POLL_READ_TIMEOUT_S, connect=BACKGROUND_CONNECT_TIMEOUT_S)
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.get(url, headers=headers)
    except (httpx.ConnectTimeout, httpx.ReadTimeout, httpx.WriteTimeout, httpx.PoolTimeout, httpx.TimeoutException):
        return _fail("timeout", "The " + operation + " background poll timed out.")
    except httpx.HTTPError as e:
        return _fail("connection-error", type(e).__name__)
    except Exception as e:
        return _fail("internal-transport-error", type(e).__name__)

    if resp.status_code == 404:
        return _fail("background-job-missing", "The background response was not found or has expired.", code=404)
    if resp.status_code >= 400:
        code = None
        emsg = None
        try:
            j = resp.json()
            err = j.get("error") if isinstance(j, dict) else None
            if isinstance(err, dict):
                code = err.get("code") or err.get("type")
                emsg = err.get("message")
        except Exception:
            pass
        return _fail(_bg_http_error_kind(resp.status_code), (emsg or ("HTTP " + str(resp.status_code))), code=(code or resp.status_code))

    try:
        data = resp.json()
    except Exception:
        return _fail("malformed-provider-response", "Background poll body was not valid JSON.")
    if not isinstance(data, dict):
        return _fail("malformed-provider-response", "Background poll body was not a JSON object.")
    return _classify_background_response(data, "", _elapsed_ms())


async def cancel_openai_background_response(response_id: str) -> StructuredAIResult:
    """Best-effort, idempotent cancel via POST /v1/responses/{id}/cancel. Cancellation
    failure is NEVER turned into a successful generation. Never raises; never leaks the
    API key or a raw exception. Callers ignore the result."""
    started = time.monotonic()

    def _elapsed_ms() -> int:
        return int((time.monotonic() - started) * 1000)

    def _res(ok: bool, status: str, kind=None, msg=None) -> StructuredAIResult:
        return StructuredAIResult(
            ok=ok, text="", model="", provider="openai", endpoint="responses",
            request_id=response_id if isinstance(response_id, str) else None,
            execution_status=status, latency_ms=_elapsed_ms(), fallback_used=False,
            error_kind=kind, error_message=_sanitize_error_text(msg),
        )

    if not OPENAI_API_KEY or not response_id or not isinstance(response_id, str):
        return _res(False, "cancelled", "invalid-request", "No cancellable background response.")
    headers = {"Authorization": "Bearer " + OPENAI_API_KEY, "Content-Type": "application/json"}
    url = OPENAI_RESPONSES_URL + "/" + response_id + "/cancel"
    timeout = httpx.Timeout(BACKGROUND_CANCEL_READ_TIMEOUT_S, connect=BACKGROUND_CONNECT_TIMEOUT_S)
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(url, headers=headers)
    except Exception as e:
        # Best-effort: a cancel failure is not fatal (the job record still expires).
        return _res(False, "cancelled", "cancel-failed", type(e).__name__)
    # Idempotent: any 2xx (or an already-terminal 4xx) is acceptable.
    return _res(resp.status_code < 400, "cancelled")
