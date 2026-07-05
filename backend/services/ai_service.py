# coding: utf-8
import sys
import os
import re
import json
import logging

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", ".."))

from ai_client import ask_ai, detect_intent
from ai_router import get_model_config, detect_mode
from agent import run_tools, build_context_for_ai, detect_research_depth, DEPTH_CONFIG, RESEARCH_INTENTS
from prompts import (
    CHAT_SYSTEM, CHAT_RULES,
    FINANCE_SYSTEM, FINANCE_TEMPLATE,
    DROP_SYSTEM, DROP_TEMPLATE,
    EDUCATION_SYSTEM, EDUCATION_TEMPLATE,
    ADVICE_SYSTEM, ADVICE_TEMPLATE,
    EMOTIONAL_SYSTEM, PERSONAL_SYSTEM,
    EXECUTION_SYSTEM, PRODUCTIVITY_SYSTEM,
    CREATIVE_SYSTEM, STARTUP_SYSTEM,
)
from finance import run_finance_analysis
from ecommerce import run_ecommerce_analysis

try:
    from tools.registry import select_tools_for_intent, run_tool
    _TOOLS_AVAILABLE = True
except Exception:
    _TOOLS_AVAILABLE = False

logger = logging.getLogger(__name__)


# ── Structured trading_signal extractor ────────────────────────────────────
_TRADING_SIGNAL_RE = re.compile(
    r"```json\s*(\{[\s\S]*?\})\s*```",
    re.IGNORECASE,
)


def _extract_trading_signal(reply: str) -> tuple[dict | None, str]:
    """
    Pull the last ```json {...}``` block from `reply` if it parses and looks
    like a trading_signal. Returns (signal_dict_or_None, reply_without_block).
    """
    if not reply:
        return None, reply
    matches = list(_TRADING_SIGNAL_RE.finditer(reply))
    if not matches:
        return None, reply

    for m in reversed(matches):
        try:
            obj = json.loads(m.group(1))
        except (json.JSONDecodeError, ValueError):
            continue
        if not isinstance(obj, dict):
            continue
        # Must look like a trading signal — require at least 2 of these fields.
        markers = {"symbol", "side", "action", "setup_grade", "thesis", "invalidation"}
        if len(markers & set(obj.keys())) < 2:
            continue
        cleaned = (reply[: m.start()] + reply[m.end():]).rstrip()
        return obj, cleaned

    return None, reply


def _market_data_summary(tool_results: dict) -> dict | None:
    """Compact summary of market_data + macro_data for response metadata."""
    if not isinstance(tool_results, dict):
        return None
    md = tool_results.get("market_data") or {}
    mc = tool_results.get("macro_data")  or {}
    md_data = md.get("data") if md.get("status") == "available" else None
    mc_data = mc.get("data") if mc.get("status") == "available" else None
    if not md_data and not mc_data:
        return None
    out: dict = {}
    if md_data:
        plan_d = md_data.get("plan") or {}
        fut_d  = md_data.get("futures") or {}
        dq     = md_data.get("data_quality") or {}
        out["market_data"] = {
            "symbol":            md_data.get("symbol"),
            "timeframe":         md_data.get("timeframe"),
            "last_price":        md_data.get("last_price"),
            "rsi_14":            md_data.get("rsi_14"),
            "trend":             md_data.get("trend"),
            "regime":            md_data.get("regime"),
            "bb_squeeze":        md_data.get("bb_squeeze"),
            "mtf_alignment":     (md_data.get("mtf_alignment") or {}).get("alignment"),
            "directional_bias":  plan_d.get("directional_bias"),
            "setup_grade":       plan_d.get("setup_grade"),
            "side_bias":         plan_d.get("side_bias"),
            "fakeout_risk":      plan_d.get("fakeout_risk"),
            "liquidity_risk":    plan_d.get("liquidity_risk"),
            "funding_regime":    fut_d.get("funding_regime"),
            "trapped_traders":   fut_d.get("trapped_traders"),
            "positioning_signal": fut_d.get("positioning_signal"),
            "provider":          md.get("provider"),
            "data_quality":      dq.get("level") if isinstance(dq, dict) else None,
            "data_quality_missing": dq.get("missing") if isinstance(dq, dict) else None,
        }
    if mc_data:
        out["macro_data"] = {
            "regime":            mc_data.get("regime"),
            "btc_dominance_pct": mc_data.get("btc_dominance_pct"),
            "dxy":               mc_data.get("dxy"),
            "dxy_change_1d_pct": mc_data.get("dxy_change_1d_pct"),
            "total_market_cap_change_24h_pct": mc_data.get("total_market_cap_change_24h_pct"),
        }
    return out or None


# Phase 8n — quick-quote snapshot detector lives in its own import-light
# module so it stays unit-testable without the OpenAI SDK.
from backend.services.ai.snapshot import (   # noqa: E402
    is_quick_quote_ask as _is_quick_quote_ask,
    SNAPSHOT_DIRECTIVE as _SNAPSHOT_DIRECTIVE,
)


_ECOM_KW = [
    "satmak", "dropshipping", "shopify", "ecommerce", "e-ticaret",
    "magaza", "urun sat", "kar marji", "supplier", "tedarik",
    "reklam ver", "facebook ads", "tiktok ads",
]
_BUYER_KW = [
    "almak istiyorum", "alayim mi", "almaliyim", "oner",
    "tavsiye et", "hangisi iyi", "hangisini alayim", "satin al",
]
_EXECUTION_KW = [
    "ne yapayim", "nereden baslayayim", "plan yap", "takildim",
    "devam edemiyorum", "para kazanmak istiyorum", "nereye gitsem",
    "nasil baslayabilirim",
]
_PRODUCTIVITY_KW = [
    "dagiliyorum", "odaklanamiyorum", "zamanimi yonetemiyorum",
    "hedefim var ama yapamiyorum", "erteliyorum", "procrastination",
    "konsantre olamiyorum",
]
_CREATIVE_KW = [
    "fikir ver", "isim bul", "hikaye yaz", "reklam metni",
    "hook yaz", "yaratici olsun", "marka ismi", "icerik fikri",
    "slogan", "kopya yaz", "tagline",
]


def _has(text, kw_list):
    t = text.lower()
    return any(k in t for k in kw_list)


def _build_system(base, mem_summary="", style_prompt="", profile=""):
    # PREPEND the current-date directive (production fix 2026-06-28).
    # PR #178 added this to build_system_prompt() but missed
    # _build_system() — the legacy intent-routed path used by 11 of the
    # 13 system constants (CHAT_SYSTEM, EXECUTION_SYSTEM, FINANCE_SYSTEM,
    # etc). Without this line, "şu an hangi yıldayız?" returns the
    # LLM's training-cutoff year. Lazy import keeps the cyclic-import
    # risk at zero: prompt_manager imports from mode_manager but never
    # from ai_service.
    from backend.services.ai.prompt_manager import current_date_directive
    sys_p = current_date_directive() + "\n\n" + base
    if profile and "No user info" not in profile and profile.strip():
        sys_p += "\n\nKullanici profili:\n" + profile
    if mem_summary and mem_summary.strip():
        sys_p += "\n\nKullanici hafizasi:\n" + mem_summary
    if style_prompt and style_prompt.strip():
        sys_p += "\n\n" + style_prompt
    return sys_p


_LANG_NAMES = {
    "en": "English", "tr": "Turkish", "de": "German", "fr": "French",
    "it": "Italian", "es": "Spanish", "ru": "Russian",
}


def _build_language_directive(
    locale: str = None, language_mode: str = None, message_language: str = None
) -> str:
    """Build the answer-language directive for the non-stream chat path.

    Mirrors the streaming route's policy: a concrete mode pins the reply
    language; Auto follows the language of the user's latest message.
    Returns "" when no locale signal is present (byte-identical legacy
    behaviour). Never translates brand names, tickers, URLs, or code.
    """
    mode = (language_mode or "").strip().lower()
    loc = (locale or "").strip().lower()
    msg = (message_language or "").strip().lower()

    if mode and mode != "auto":
        resolved, source = mode, "user_setting"
    elif msg:
        resolved, source = msg, "message_detect"
    elif loc:
        resolved, source = loc, "browser"
    else:
        return ""  # no signal → leave prompt untouched

    name = _LANG_NAMES.get(resolved, resolved or "English")
    logger.info(
        "[I18N] surface=chat | resolved_locale=%s | language_source=%s | "
        "language_mode=%s | user_message_language=%s",
        resolved, source, mode or "auto", msg or "-",
    )
    if mode == "auto" or not mode:
        return (
            "ANSWER LANGUAGE POLICY (NON-NEGOTIABLE): Respond in the user's "
            "selected language. The selected language is Auto, so respond in the "
            f"SAME language as the user's latest message (detected: {name}). Do "
            "not switch to English unless the user asks in English or asks for "
            "English. Write ALL prose in that language, but do NOT translate "
            "brand names, product names, URLs, tickers, code, file names, or "
            "technical identifiers; keep source titles as-is and explain them in "
            "the user's language."
        )
    return (
        f"ANSWER LANGUAGE POLICY (NON-NEGOTIABLE): Respond in {name}. Do not "
        "switch to English unless the user explicitly asks in English or asks "
        f"for English. Write ALL prose in {name}, but do NOT translate brand "
        "names, product names, URLs, tickers, code, file names, or technical "
        "identifiers; keep source titles as-is and explain them in " + name + "."
    )


async def process_chat(
    user_id: str,
    message: str,
    platform: str,
    profile: str,
    history: list,
    mem_summary: str,
    style_prompt: str,
    mode: str = None,           # optional: explicit mode from frontend (e.g. "trading_analyst")
    locale: str = None,             # i18n — resolved UI locale ("en"/"tr"/…)
    language_mode: str = None,      # i18n — raw choice ("auto"|"en"|"tr"|…)
    message_language: str = None,   # i18n — detected language of this message (Auto hint)
) -> dict:
    text_lower = message.lower().strip()

    # ── i18n — fold an answer-language directive into style_prompt so it
    # flows into EVERY branch's system prompt (both build_system_prompt and
    # _build_system append style_prompt). The user reported English replies
    # to Turkish users; this enforces the selected/detected language.
    try:
        _lang_directive = _build_language_directive(locale, language_mode, message_language)
        if _lang_directive:
            style_prompt = (style_prompt + "\n\n" + _lang_directive) if style_prompt else _lang_directive
    except Exception:
        logger.debug("process_chat | language directive skipped", exc_info=True)

    depth       = detect_research_depth(message)
    depth_label = DEPTH_CONFIG[depth]["label"]

    # ── New mode system: if caller supplied an explicit mode, use it directly ──
    # This bypasses intent-based routing so behaviour is fully predictable.
    # Falls back to legacy routing below if mode is None or unrecognised.
    if mode:
        try:
            from backend.services.ai.mode_manager  import resolve_mode_name
            from backend.services.ai.prompt_manager import build_system_prompt
            from backend.services.ai.model_manager  import get_config as mode_get_config

            canonical = resolve_mode_name(mode)
            if canonical:
                cfg   = mode_get_config(canonical, depth_label, message)
                sys_p = build_system_prompt(canonical, mem_summary, style_prompt, profile)

                # Game Builder — adaptive output budget. The build size varies
                # a lot (a Fast Prototype vs a Production-Style Roblox tycoon
                # with economy + DataStore + shop + quests), so we infer a
                # safe max_tokens from Build Quality + prompt complexity rather
                # than using the mode's fixed value. Clamped to a provider-safe
                # ceiling inside the estimator; the user never sees or controls
                # this. Best-effort — falls back to cfg's value on any error.
                if canonical == "game_developer":
                    try:
                        from backend.services.ai.game_dev_modules import (
                            estimate_game_dev_token_budget,
                        )
                        _gd_budget = estimate_game_dev_token_budget(message)
                        cfg["max_tokens"] = _gd_budget
                        logger.info(
                            "process_chat | game_dev adaptive max_tokens=%d", _gd_budget
                        )
                    except Exception as _gd_err:
                        logger.warning(
                            "process_chat | game_dev budget estimate failed (%s) — using cfg default",
                            _gd_err,
                        )

                # Phase 8n — concise snapshot for a bare price ask.
                if canonical == "trading_analyst" and _is_quick_quote_ask(message):
                    sys_p += _SNAPSHOT_DIRECTIVE
                    logger.info("process_chat | trading_analyst quick-quote snapshot mode")

                # ─────────────────────────────────────────────────────────
                # Phase A1 — Agent runtime path (research mode only, flag-gated).
                # If ENABLE_AGENT=true and canonical == "research", route the
                # request through the agent loop instead of the single-shot
                # ask_ai. On ANY failure (import, openai, runtime), fall
                # through to the legacy path below — zero blast radius.
                # ─────────────────────────────────────────────────────────
                if canonical == "research":
                    try:
                        from backend.services.agent import (
                            run_agent, is_enabled as _agent_enabled, AgentRequest,
                        )
                        if _agent_enabled():
                            _agent_req = AgentRequest(
                                user_message=message,
                                mode=canonical,
                                user_id=str(user_id),
                                model=cfg["model"],
                                temperature=cfg["temperature"],
                                max_tokens=cfg["max_tokens"],
                                history=list(history or []),
                                system_prompt=sys_p,
                            )
                            _agent_resp = await run_agent(_agent_req)
                            if not _agent_resp.fallback and _agent_resp.reply:
                                logger.info(
                                    "process_chat | agent_path | mode=%s | steps=%d | tools=%d | partial=%s | ms=%d",
                                    canonical, _agent_resp.steps_used,
                                    _agent_resp.tool_calls, _agent_resp.partial,
                                    _agent_resp.elapsed_ms,
                                )
                                return {
                                    "reply":    _agent_resp.reply,
                                    "intent":   canonical,
                                    "model":    _agent_resp.model,
                                    "provider": _agent_resp.provider,
                                    "mode":     canonical,
                                    "metadata": {
                                        "agent": {
                                            "steps":      _agent_resp.steps_used,
                                            "tool_calls": _agent_resp.tool_calls,
                                            "elapsed_ms": _agent_resp.elapsed_ms,
                                            "partial":    _agent_resp.partial,
                                            "trace":      _agent_resp.to_dict()["trace"],
                                        },
                                    },
                                }
                            logger.warning(
                                "process_chat | agent_path fell back | reason=%s",
                                (_agent_resp.metadata or {}).get("fallback_reason"),
                            )
                            # fall through to the regular mode-system path below
                    except Exception as _aerr:
                        logger.warning("process_chat | agent runtime error: %s — using legacy path", _aerr)

                # Phase 5.1 — Inject prior thesis block for trading_analyst
                # (lets the AI compare today's read against yesterday's call).
                _prior_symbol = None
                _prior_block  = ""
                if canonical == "trading_analyst":
                    try:
                        from backend.services.tools.market_data_tool import MarketDataTool
                        _prior_symbol = MarketDataTool.parse_symbol(message)
                        if _prior_symbol:
                            from backend.services.trading.thesis_memory import build_previous_thesis_block
                            _prior_block = build_previous_thesis_block(user_id, _prior_symbol)
                            if _prior_block:
                                sys_p += "\n\n" + _prior_block
                    except Exception as _pterr:
                        logger.debug("process_chat | prior-thesis lookup failed: %s", _pterr)

                # Run tools for this mode and inject live data into system prompt
                try:
                    from backend.services.tools.tool_orchestrator import (
                        run_tools_for_mode, build_tool_context_block,
                    )
                    _tf_ctx = {}
                    for _tf in ["4h","2h","1h","30m","15m","5m","1d","4H","2H","1H","30M","15M","1D"]:
                        if _tf in message:
                            _tf_ctx["timeframe"] = _tf.lower()
                            break
                    _mode_tool_res = await run_tools_for_mode(canonical, message, _tf_ctx)
                    _tool_block    = build_tool_context_block(_mode_tool_res)
                    if _tool_block:
                        sys_p += "\n\n" + _tool_block
                        _md = _mode_tool_res.get("market_data", {})
                        logger.info(
                            "MARKET_DATA_TOOL called | symbol=%s | timeframe=%s | provider=%s",
                            (_md.get("data") or {}).get("symbol"),
                            (_md.get("data") or {}).get("timeframe"),
                            _md.get("provider"),
                        )
                    else:
                        for _tn, _tr in _mode_tool_res.items():
                            logger.info(
                                "TOOL %s | status=%s | msg=%s",
                                _tn, _tr.get("status"), _tr.get("message"),
                            )
                except Exception as _terr:
                    logger.warning("process_chat | mode tool error: %s — continuing without tools", _terr)

                # Research-in-Chat — the standalone Research tab is gone,
                # so normal chat (mode "fast") detects research intent
                # ("araştır", "internetten bak", "search the web",
                # "latest ...") and auto-invokes web_research exactly like
                # the streaming path does. Runs INSIDE the normal /chat
                # request, so usage/credit counting is unchanged — no free
                # tool bypass. Modes whose tool map already includes
                # web_research (research, deep_think, startup_advisor, ...)
                # are excluded to avoid a double search.
                if canonical == "fast":
                    try:
                        from backend.services.tool_extraction import (
                            detect_web_search_intent,
                            build_web_search_context_block,
                        )
                        _ws = detect_web_search_intent(message)
                        if _ws.triggered:
                            _ws_block, _ws_payload = await build_web_search_context_block(
                                user_id=  str(user_id),
                                query=    _ws.query or message,
                                triggers= _ws.triggers,
                            )
                            if _ws_block:
                                sys_p += "\n\n" + _ws_block
                                logger.info(
                                    "process_chat | fast_mode web_research | uid=%s | "
                                    "confidence=%.2f | fetched=%s",
                                    user_id, _ws.confidence,
                                    _ws_payload.get("fetched", True),
                                )
                            else:
                                # Honest unavailable state: the user asked for
                                # current/web-backed info but no result exists
                                # (tool disabled, provider missing, or search
                                # failed). Tell the model to say so instead of
                                # inventing sources.
                                sys_p += (
                                    "\n\n[WEB_RESEARCH_STATUS]\n"
                                    "The user asked for current / web-sourced information, "
                                    "but live web research is unavailable right now. State this "
                                    "clearly in the reply (e.g. 'Live web research is unavailable "
                                    "right now.' / TR: 'Canli web arastirmasi su an kullanilamiyor.'), "
                                    "answer from general knowledge with an explicit may-be-outdated "
                                    "caveat, and do NOT invent sources, links, dates, or current figures."
                                )
                                logger.info(
                                    "process_chat | fast_mode web_research unavailable | uid=%s | reason=%s",
                                    user_id,
                                    _ws_payload.get("error") or _ws_payload.get("reason") or "unknown",
                                )
                    except Exception as _ws_err:
                        logger.warning(
                            "process_chat | fast_mode web_research error: %s — continuing without",
                            _ws_err,
                        )

                # ── Web Build research pre-pass ──────────────────────────
                # For a FRESH website build, run a REAL web-research pass and
                # inject the sources into the system prompt so the design
                # strategy is grounded in live data. Reuses the existing
                # credit-counted web_research cascade. Revisions skip it. On
                # unavailable/empty research we inject an honest status and fall
                # back to strategy inference — never fabricated sources.
                _wb_research_meta = None
                if canonical == "website_builder" and "REVISION" not in message:
                    try:
                        from backend.services.website_builder_research import run_web_build_research
                        _wb_block, _wb_research_meta = await run_web_build_research(
                            user_id=str(user_id), idea=message,
                        )
                        if _wb_block:
                            sys_p += "\n\n" + _wb_block
                        elif _wb_research_meta and not _wb_research_meta.get("did_research"):
                            # Honest fallback instruction — reason is included so
                            # the model knows WHY it has no sources, and is told
                            # to label its reasoning "Strategy insight" (never
                            # "Research found") and never invent citations.
                            _why = (_wb_research_meta or {}).get("fallback_reason") or "no live sources available"
                            sys_p += (
                                "\n\n[BUILD INTELLIGENCE — STRATEGY INFERENCE]\n"
                                f"Live web research did not return usable sources ({_why}). Build a "
                                "structured Build Intelligence brief from your own knowledge FIRST, "
                                "then use it to drive the whole build: positioning, audience, user "
                                "intent, emotional tone, visual direction (palette/type/motion/"
                                "metaphor), section architecture, CTA hierarchy, trust signals, "
                                "component ideas and differentiation. Label the insight 'Strategy "
                                "insight' (NOT 'Research found'), and do NOT invent URLs, sources, "
                                "competitors, statistics, or citations."
                            )
                        logger.info(
                            "process_chat | website_builder research | status=%s | did_research=%s | sources=%d | reason=%s",
                            (_wb_research_meta or {}).get("status") or "-",
                            bool((_wb_research_meta or {}).get("did_research")),
                            int((_wb_research_meta or {}).get("source_count") or 0),
                            (_wb_research_meta or {}).get("fallback_reason") or "-",
                        )
                    except Exception as _wberr:
                        logger.warning("process_chat | website_builder research error: %s — continuing", _wberr)
                        _wb_research_meta = {
                            "did_research": False,
                            "status": "failed",
                            "fallback_reason": f"research pre-pass raised: {type(_wberr).__name__}",
                        }

                reply = await ask_ai(
                    message, sys_p, history,
                    model=cfg["model"],
                    temperature=cfg["temperature"],
                    max_tokens=cfg["max_tokens"],
                )
                logger.info(
                    "process_chat | mode_system | mode=%s | model=%s", canonical, cfg["model"]
                )

                _metadata: dict = {}
                # Surface REAL research metadata (sources + did_research) so the
                # frontend can honestly show sources ONLY when tools actually ran.
                if canonical == "website_builder" and _wb_research_meta:
                    # ALWAYS surface the full research status for a fresh build —
                    # so the frontend can honestly distinguish ran / disabled /
                    # failed / no-sources and (owner/admin) show a debug reason.
                    _metadata["research"] = {
                        "did_research":        bool(_wb_research_meta.get("did_research")),
                        "status":              _wb_research_meta.get("status") or (
                            "used_sources" if _wb_research_meta.get("did_research") else "no_sources"
                        ),
                        "provider":            _wb_research_meta.get("provider"),
                        "attempted_providers": _wb_research_meta.get("attempted_providers") or [],
                        "queries":             _wb_research_meta.get("queries") or [],
                        "query_count":         int(_wb_research_meta.get("query_count") or 0),
                        "source_count":        int(_wb_research_meta.get("source_count") or 0),
                        "fallback_reason":     _wb_research_meta.get("fallback_reason"),
                    }
                    _srcs = _wb_research_meta.get("sources") or []
                    if _srcs:
                        _metadata["sources"] = _srcs
                if canonical == "trading_analyst":
                    signal, reply = _extract_trading_signal(reply)
                    if signal is not None:
                        _metadata["trading_signal"] = signal
                        # Persist the signal for next-time comparison.
                        try:
                            from backend.services.trading.thesis_memory import save_thesis
                            sym_for_save = signal.get("symbol") or _prior_symbol
                            if sym_for_save:
                                save_thesis(user_id, sym_for_save, signal)
                        except Exception as _serr:
                            logger.debug("process_chat | save_thesis failed: %s", _serr)
                    _summary = _market_data_summary(_mode_tool_res)
                    if _summary:
                        _metadata["tool_summary"] = _summary
                    if _prior_block:
                        _metadata["prior_thesis_used"] = True
                return {
                    "reply":    reply,
                    "intent":   canonical,
                    "model":    cfg["model"],
                    "provider": cfg["provider"],
                    "mode":     canonical,
                    "metadata": _metadata or None,
                }
        except Exception as _mode_err:
            # Mode system failed — log and fall through to existing routing.
            logger.warning("process_chat | mode_system error (%s) — falling back", _mode_err)
    # ── End new mode system ──────────────────────────────────────────

    intent   = await detect_intent(message)
    category = intent.get("intent", "normal_chat")
    symbol   = intent.get("symbol")

    # Buyer vs seller guard
    if category in ("ecommerce", "ads", "product_research"):
        has_ecom  = _has(text_lower, _ECOM_KW)
        has_buyer = _has(text_lower, _BUYER_KW)
        if has_buyer and not has_ecom:
            category = "consumer_advice"

    # Whitelist guard
    _VALID = {
        "finance", "crypto", "stock", "ecommerce", "ads",
        "product_research", "news", "task", "memory", "portfolio",
        "normal_chat", "personal_advice", "coding", "education",
        "general_question", "consumer_advice", "emotional_support",
        "safety_sensitive",
    }
    if category not in _VALID:
        category = "normal_chat"

    model_cfg = get_model_config(category, depth, message)
    use_gpt4  = model_cfg["use_gpt4"]
    ai_model  = model_cfg["model"]
    ai_mode   = model_cfg.get("mode", "chat")
    provider  = model_cfg.get("provider", "openai")

    # ── Auto-route: finance/crypto/stock → trading_analyst + market_data_tool ──
    # Intercepts before legacy run_finance_analysis / data_sources path fires.
    if category in ("finance", "crypto", "stock"):
        try:
            from backend.services.ai.mode_manager   import resolve_mode_name
            from backend.services.ai.prompt_manager import build_system_prompt
            from backend.services.ai.model_manager  import get_config as mode_get_config
            from backend.services.tools.tool_orchestrator import (
                run_tools_for_mode, build_tool_context_block,
            )

            _ta_cfg   = mode_get_config("trading_analyst", depth_label, message)
            _ta_sys_p = build_system_prompt("trading_analyst", mem_summary, style_prompt, profile)

            # Symbol from intent, timeframe from message text
            _ta_ctx = {}
            if symbol and symbol.lower() not in ("null", "none", ""):
                _ta_ctx["symbol"] = symbol
            for _tf in ["4h","2h","1h","30m","15m","5m","1d","4H","2H","1H","30M","15M","1D"]:
                if _tf in message:
                    _ta_ctx["timeframe"] = _tf.lower()
                    break

            # Phase 5.1 — prior thesis block (compare to last analysis on same symbol)
            _ta_prior_block = ""
            _ta_prior_symbol = symbol if (symbol and symbol.lower() not in ("null", "none", "")) else None
            if _ta_prior_symbol:
                try:
                    from backend.services.trading.thesis_memory import build_previous_thesis_block
                    _ta_prior_block = build_previous_thesis_block(user_id, _ta_prior_symbol)
                    if _ta_prior_block:
                        _ta_sys_p += "\n\n" + _ta_prior_block
                except Exception as _pterr:
                    logger.debug("process_chat | TA prior-thesis lookup failed: %s", _pterr)

            _ta_tool_res = await run_tools_for_mode("trading_analyst", message, _ta_ctx)
            _ta_block    = build_tool_context_block(_ta_tool_res)
            if _ta_block:
                _ta_sys_p += "\n\n" + _ta_block
                _md = _ta_tool_res.get("market_data", {})
                logger.info(
                    "MARKET_DATA_TOOL called | symbol=%s | timeframe=%s | provider=%s",
                    (_md.get("data") or {}).get("symbol"),
                    (_md.get("data") or {}).get("timeframe"),
                    _md.get("provider"),
                )
            else:
                for _tn, _tr in _ta_tool_res.items():
                    logger.info(
                        "TOOL %s | status=%s | msg=%s",
                        _tn, _tr.get("status"), _tr.get("message"),
                    )

            _ta_reply = await ask_ai(
                message, _ta_sys_p, history,
                model=_ta_cfg["model"],
                temperature=_ta_cfg["temperature"],
                max_tokens=_ta_cfg["max_tokens"],
            )
            logger.info(
                "process_chat | route=trading_analyst | symbol=%s | model=%s",
                symbol, _ta_cfg["model"],
            )
            _signal, _ta_reply = _extract_trading_signal(_ta_reply)
            _ta_meta: dict = {}
            if _signal is not None:
                _ta_meta["trading_signal"] = _signal
                try:
                    from backend.services.trading.thesis_memory import save_thesis
                    _sym_for_save = _signal.get("symbol") or _ta_prior_symbol
                    if _sym_for_save:
                        save_thesis(user_id, _sym_for_save, _signal)
                except Exception as _serr:
                    logger.debug("process_chat | TA save_thesis failed: %s", _serr)
            _ta_summary = _market_data_summary(_ta_tool_res)
            if _ta_summary:
                _ta_meta["tool_summary"] = _ta_summary
            if _ta_prior_block:
                _ta_meta["prior_thesis_used"] = True
            return {
                "reply":    _ta_reply,
                "intent":   "trading_analyst",
                "model":    _ta_cfg["model"],
                "provider": _ta_cfg["provider"],
                "mode":     "trading_analyst",
                "metadata": _ta_meta or None,
            }
        except Exception as _ta_err:
            logger.warning(
                "process_chat | trading_analyst route failed (%s) — legacy fallback", _ta_err
            )
    # ── End auto-route ──────────────────────────────────────────────

    # Follow-up detection
    _is_followup = (
        len(message.split()) <= 6 and
        any(message.lower().strip().endswith(t)
            for t in ["mi", "mi?", "mu", "mu?", "mi cevap", "cevap", "dogru mu"])
    )
    if _is_followup and category == "normal_chat":
        category = "education"
        ai_mode  = "education"

    # Tool execution
    if category in RESEARCH_INTENTS or category == "consumer_advice":
        tool_results = await run_tools(message, intent, depth)
    else:
        tool_results = {"tools_used": [], "price": None, "news": None, "macro": None, "web": None, "errors": []}

    tool_context = build_context_for_ai(message, tool_results, profile)

    result = await _route(
        category, ai_mode, ai_model, use_gpt4,
        message, symbol, depth_label,
        tool_context, tool_results,
        history, mem_summary, style_prompt,
        profile, _is_followup, text_lower,
    )

    followups = []
    return {
        "reply":    result,
        "intent":   category,
        "model":    ai_model,
        "provider": provider,
        "mode":     ai_mode,
    }


async def _route(
    category, ai_mode, ai_model, use_gpt4,
    message, symbol, depth_label,
    tool_context, tool_results,
    history, mem_summary, style_prompt,
    profile, is_followup, text_lower,
):
    # --- Execution mode ---
    if ai_mode == "execution" or _has(text_lower, _EXECUTION_KW):
        sys_p = _build_system(EXECUTION_SYSTEM, mem_summary, style_prompt, profile)
        return await ask_ai(message, sys_p, history, model=ai_model)

    # --- Productivity mode ---
    if ai_mode == "productivity" or _has(text_lower, _PRODUCTIVITY_KW):
        sys_p = _build_system(PRODUCTIVITY_SYSTEM, mem_summary, style_prompt, profile)
        return await ask_ai(message, sys_p, history, model=ai_model)

    # --- Creative mode ---
    if ai_mode == "creative" or _has(text_lower, _CREATIVE_KW):
        sys_p = _build_system(CREATIVE_SYSTEM, mem_summary, style_prompt)
        return await ask_ai(message, sys_p, history, model=ai_model)

    # --- Finance / Trading ---
    if category in ("finance", "crypto", "stock"):
        # Fix: never write "null ANALIZI"
        effective_symbol = symbol if (symbol and symbol.lower() != "null") else None
        if not effective_symbol:
            # Ask clarification or do general analysis
            sys_p = _build_system(FINANCE_SYSTEM, mem_summary, style_prompt)
            prompt = (
                "Kullanici sorusu: \"" + message + "\"\n\n"
                + tool_context + "\n\n"
                "Sembol belirtilmemis. Genel bir piyasa/trading yorumu yap "
                "ya da hangi varlik icin analiz yapilmasini istedigini sor."
            )
            return await ask_ai(prompt, sys_p, history, model=ai_model)
        return await run_finance_analysis(
            message, effective_symbol, depth_label, tool_context,
            mem_summary, style_prompt, use_gpt4, model=ai_model,
        )

    # --- Ecommerce / Dropshipping ---
    if category in ("ecommerce", "ads", "product_research"):
        try:
            return await run_ecommerce_analysis(
                message, tool_context, mem_summary, style_prompt, use_gpt4, model=ai_model,
            )
        except Exception as e:
            logger.error("run_ecommerce_analysis error: %s", e)
            sys_p = _build_system(DROP_SYSTEM, mem_summary, style_prompt)
            return await ask_ai(message, sys_p, history, model=ai_model)

    # --- Startup mode ---
    if ai_mode == "startup":
        sys_p = _build_system(STARTUP_SYSTEM, mem_summary, style_prompt, profile)
        return await ask_ai(message, sys_p, history, model=ai_model)

    # --- News ---
    if category == "news":
        news_prompt = (
            "Kullanici sorusu: " + message + "\n\n" +
            tool_context + "\n\n" +
            "En onemli haberleri ozetle, kisa yorum ekle."
        )
        return await ask_ai(news_prompt, "Haber editorusun. Net, Turkce.", history, model=ai_model)

    # --- Consumer advice ---
    if category == "consumer_advice":
        has_web = bool(tool_results.get("web"))
        ctx = tool_context if has_web else "[Web verisi alinamadi. Guncel fiyat icin kullaniciya Trendyol/Amazon kontrol etmesini oner.]"
        sys_p = _build_system(ADVICE_SYSTEM, mem_summary, style_prompt)
        prompt = ADVICE_TEMPLATE.format(question=message, context=ctx)
        return await ask_ai(prompt, sys_p, history, model=ai_model)

    # --- Education / follow-up ---
    if category == "education" or ai_mode == "education":
        sys_p = _build_system(EDUCATION_SYSTEM, mem_summary, style_prompt)
        if is_followup:
            recent = ""
            if history:
                recent = "\n".join(
                    ("Asistan: " if r == "assistant" else "Kullanici: ") + c
                    for r, c in history[-4:]
                )
            prompt = (
                "Son konusma:\n" + recent + "\n\n"
                "Kullanicinin yeni mesaji: " + message + "\n\n"
                "Cevap verdiyse: dogru/yanlis net soyle, kisaca neden.\n"
                "Devam yaziyorsa: konusmaya devam et."
            )
        else:
            prompt = EDUCATION_TEMPLATE.format(question=message, context=tool_context)
        return await ask_ai(prompt, sys_p, history, model=ai_model)

    # --- Emotional support ---
    if ai_mode == "emotional_support" or category == "emotional_support":
        sys_p = _build_system(EMOTIONAL_SYSTEM, mem_summary)
        return await ask_ai(message, sys_p, history, model=ai_model)

    # --- Personal advice ---
    if ai_mode == "personal_advice" or category == "personal_advice":
        sys_p = _build_system(PERSONAL_SYSTEM, mem_summary, style_prompt, profile)
        return await ask_ai(message, sys_p, history, model=ai_model)

    # --- General / Coding ---
    if category in ("general_question", "coding"):
        prompt = (
            "Kullanici sorusu: " + message + "\n\n" +
            tool_context + "\n\n" +
            "Net, anlasilir Turkce cevap ver."
        )
        sys_p = _build_system(CHAT_SYSTEM, mem_summary, style_prompt)
        return await ask_ai(prompt, sys_p, history, model=ai_model)

    # --- Default chat ---
    sys_p = _build_system(CHAT_SYSTEM, mem_summary, style_prompt, profile)
    sys_p += CHAT_RULES
    return await ask_ai(message, sys_p, history, model=ai_model)
