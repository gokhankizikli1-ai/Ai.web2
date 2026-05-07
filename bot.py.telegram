# coding: utf-8
import os
import re
import asyncio
import logging
from datetime import datetime
from logger_config import setup_logger, log_user_message, log_ai_response, log_error, log_intent, Timer
from stats import format_stats
from dotenv import load_dotenv
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    Application, CommandHandler, MessageHandler,
    filters, ContextTypes, CallbackQueryHandler,
)
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from db import (
    init_db,
    save_memory, get_memories, forget_memory, get_user_profile,
    save_chat, get_chat_history,
    add_task, get_tasks, complete_task,
    add_portfolio, get_portfolio, remove_portfolio,
    ensure_user, is_premium_user, set_premium,
    increment_message_count, get_message_count,
    reset_user_count, check_limit,
    FREE_DAILY_LIMIT,
)
from usage_limits import (
    init_usage_db,
    is_premium,
    set_premium as ul_set_premium,
    get_daily_usage,
    increment_daily_usage,
    can_user_send_message,
    get_remaining_messages,
    FREE_DAILY_LIMIT as UL_FREE_LIMIT,
)
from memory import (
    init_memory_db,
    get_style_prompt, get_memory_summary,
    update_user_style, remember_fact, forget_fact,
    auto_learn, detect_style_preference, remember_with_category,
)
from ai_client import ask_openai, ask_gemini, ask_ai, detect_intent
from ai_router import get_model_config
from agent import run_tools, build_context_for_ai, detect_research_depth, DEPTH_CONFIG, RESEARCH_INTENTS
from finance import run_finance_analysis, FINANCE_SYSTEM
from prompts import (
    CHAT_SYSTEM, CHAT_RULES, ADVICE_RULES,
    EDUCATION_SYSTEM, EDUCATION_TEMPLATE,
    ADVICE_SYSTEM, ADVICE_TEMPLATE,
    EMOTIONAL_SYSTEM, PERSONAL_SYSTEM,
)
from ecommerce import run_ecommerce_analysis
from data_sources import get_crypto_data, get_stock_data, get_news, format_news, CRYPTO_SYMBOLS
from utils import send_long

load_dotenv()
TELEGRAM_TOKEN = os.getenv("TELEGRAM_TOKEN")
OWNER_ID = int(os.getenv("OWNER_ID", "0"))

setup_logger()
logger = logging.getLogger(__name__)



# ---------------------------------------------------------------
# MAIN MESSAGE HANDLER
# ---------------------------------------------------------------

async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_message = update.message.text
    if not user_message or not user_message.strip():
        return

    user_id = update.effective_user.id
    username = update.effective_user.username
    text = user_message
    text_lower = text.lower().strip()
    msg = None

    log_user_message(user_id, username, user_message)

    # step 0: memory / style shortcuts before AI call

    # Memory list commands - show only, never save
    _mem_list_triggers = [
        "ne hatirliyorsun", "ne hatÄ±rlÄ±yorsun", "ne kaydettin",
        "ne biliyorsun", "hafizanda ne var",
    ]
    if any(t in text_lower for t in _mem_list_triggers):
        summary = get_memory_summary(user_id)
        reply = ("Hafizamda bunlar var:\n\n" + summary) if summary else "Henuz bir sey kaydetmedim."
        await update.message.reply_text(reply)
        return

    # Explicit memory save triggers only
    _mem_save_triggers = [
        "bunu hatirla:", "bunu hatÄ±rla:", "hatirla:",
        "hafizana kaydet:", "aklinda tut:", "not al:",
    ]
    for trigger in _mem_save_triggers:
        if text_lower.startswith(trigger):
            fact = text[len(trigger):].strip()
            if fact and len(fact) >= 3:
                remember_with_category(user_id, fact, category="general")
                await update.message.reply_text("Kaydettim.")
            return

    if text_lower.startswith("unut:") or text_lower.startswith("forget:"):
        keyword = text.split(":", 1)[1].strip()
        if keyword:
            forget_fact(user_id, keyword)
            await update.message.reply_text("Silindi.")
        return

    style_match = detect_style_preference(text)
    if style_match:
        update_user_style(user_id, text)
        await update.message.reply_text("Style updated: " + style_match["label"])
        return

    # step 1: usage limit check (usage_limits.py)

    if not can_user_send_message(user_id):
        used = get_daily_usage(user_id)
        await update.message.reply_text(
            "Gunluk ucretsiz limitin doldu. Premium ile sinirsiz kullanabilirsin.\n\n"
            "Bugun kullandin: " + str(used) + " / " + str(UL_FREE_LIMIT) + " mesaj\n"
            "/premium yazarak detay alabilirsin."
        )
        return

    if any(k in text_lower for k in ["i am", "i work", "my goal", "my project"]):
        auto_learn(user_id, text)

    with Timer() as _timer:
      try:
        increment_daily_usage(user_id)

        depth = detect_research_depth(user_message)
        depth_label = DEPTH_CONFIG[depth]["label"]

        intent = await detect_intent(user_message)
        category = intent.get("intent", "normal_chat")
        symbol = intent.get("symbol")
        log_ai_response(user_id, category, user_message)

        # Safety: prevent ecommerce mode for buyer/consumer questions
        _ecom_keywords = [
            "satmak", "dropshipping", "shopify", "ecommerce", "e-ticaret",
            "magaza", "urun sat", "kar marji", "supplier", "tedarik",
            "reklam ver", "facebook ads", "tiktok ads", "kampanya ac",
        ]
        _buyer_keywords = [
            "almak istiyorum", "alayim mi", "almaliyim", "alabilir miyim",
            "oner", "tavsiye et", "hangisi iyi", "hangisini alayim",
            "satin al", "nereden alirim",
        ]
        if category in ("ecommerce", "ads", "product_research"):
            has_ecom = any(k in text_lower for k in _ecom_keywords)
            has_buyer = any(k in text_lower for k in _buyer_keywords)
            if has_buyer and not has_ecom:
                category = "consumer_advice"
        if category not in (
            "finance", "crypto", "stock", "ecommerce", "ads",
            "product_research", "news", "task", "memory", "portfolio",
            "normal_chat", "personal_advice", "coding", "education",
            "general_question", "consumer_advice", "emotional_support",
        ):
            category = "normal_chat"

        model_cfg = get_model_config(category, depth, user_message)
        use_gpt4  = model_cfg["use_gpt4"]
        ai_model  = model_cfg["model"]
        ai_mode   = model_cfg.get("mode", "chat")

        log_intent(user_id, category, intent.get("symbol"), ai_model, ai_mode)

        # Follow-up context detection: check if user is answering a previous question
        _followup_triggers = [
            "devam", "az onceki", "cevap bu mu", "mi cevap", "dogru mu",
            "yanlis mi", "mi oluyor", "oyle mi", "bu mu", "mi bu",
            "mi", "mÄ±", "mu", "mu?", "mi?",
        ]
        _is_followup = (
            len(user_message.split()) <= 6 and
            any(user_message.lower().strip().endswith(t) for t in ["mi", "mi?", "mu", "mu?", "mÄ±", "mi cevap", "cevap"])
        )
        if _is_followup:
            # Force use of conversation history - do not ask for clarification
            intent["needs_clarification"] = False
            if category == "normal_chat":
                category = "education"  # likely answering a teacher-mode question
                ai_mode = "education"

        # Clarification: if intent is ambiguous, very short, AND not a follow-up
        if intent.get("needs_clarification") and category == "normal_chat" and not _is_followup:
            await update.message.reply_text(
                "Sana daha iyi yardim edebilmem icin biraz daha detay verir misin?"
            )
            return

        # Explicit Turkish memory save triggers (handled above, this is fallback)
        _inline_save_triggers = ["hafizana kaydet", "aklinda tut", "not al"]
        if any(t in text_lower for t in _inline_save_triggers):
            save_memory("onemli", user_message)
            category = "memory"

        profile = get_user_profile()
        history = get_chat_history(10)
        mem_summary = get_memory_summary(user_id)
        style_prompt = get_style_prompt(user_id)

        if category in RESEARCH_INTENTS:
            msg = await update.message.reply_text("Researching... (" + depth_label + ")")
            tool_results = await run_tools(user_message, intent, depth)
        else:
            tool_results = {
                "tools_used": [], "price": None,
                "news": None, "macro": None, "web": None, "errors": [],
            }

        tool_context = build_context_for_ai(user_message, tool_results, profile)

        if category in ("finance", "crypto", "stock") and symbol:
            if msg:
                await msg.edit_text(symbol + " " + depth_label + " analyzing...")
            result = await run_finance_analysis(
                user_message, symbol, depth_label, tool_context,
                mem_summary, style_prompt, use_gpt4, model=ai_model,
            )
            save_chat("user", user_message)
            save_chat("assistant", symbol + " analysis done")
            if msg:
                await send_long(msg, result)
            else:
                await update.message.reply_text(result[:4000])

        elif category == "consumer_advice":
            if msg:
                await msg.edit_text("Urun bilgisi arastiriliyor...")
            adv_sys = ADVICE_SYSTEM
            if mem_summary:
                adv_sys += "\n\nKullanici hafizasi:\n" + mem_summary
            if style_prompt:
                adv_sys += "\n\n" + style_prompt
            # Use web search results if available, else note data may not be current
            has_web_data = bool(tool_results.get("web"))
            if not has_web_data:
                ctx = "[Web verisi alinamadi. Guncel fiyatlar icin kullaniciya Trendyol/Amazon kontrol etmesini oner.]"
            else:
                ctx = tool_context
            adv_prompt = ADVICE_TEMPLATE.format(
                question=user_message,
                context=ctx,
            )
            result = await ask_ai(adv_prompt, adv_sys, history, model=ai_model)
            save_chat("user", user_message)
            save_chat("assistant", result)
            if msg:
                await send_long(msg, result)
            else:
                await update.message.reply_text(result[:4000])

        elif category in ("ecommerce", "ads", "product_research"):
            if msg:
                await msg.edit_text(depth_label + " urun arastirmasi...")
            result = await run_ecommerce_analysis(
                user_message, tool_context, mem_summary, style_prompt, use_gpt4, model=ai_model,
            )
            save_chat("user", user_message)
            save_chat("assistant", "urun analizi yapildi")
            if msg:
                await send_long(msg, result)
            else:
                await update.message.reply_text(result[:4000])

        elif category == "news":
            if msg:
                await msg.edit_text("Loading news...")
            news_prompt = (
                "User question: " + user_message + "\n\n" +
                tool_context + "\n\n" +
                "Summarize the 5 most important items with brief comments."
            )
            summary = await ask_ai(news_prompt, "You are a news editor. Be clear and concise.", model=ai_model)
            text_out = "Latest News " + datetime.now().strftime("%d.%m.%Y %H:%M") + "\n\n" + summary
            if msg:
                await send_long(msg, text_out)
            else:
                await update.message.reply_text(text_out[:4000])

        elif category == "portfolio":
            add_match = re.search(
                r"([A-Z]{2,10})\s+(\d+\.?\d*)\s+.*?(\d+\.?\d*)",
                user_message.upper(),
            )
            buy_keywords = ["bought", "buy", "purchased", "aldim", "satin aldim"]
            if add_match and any(k in text_lower for k in buy_keywords):
                sym = add_match.group(1)
                amount = float(add_match.group(2))
                price = float(add_match.group(3))
                atype = "crypto" if sym in CRYPTO_SYMBOLS else "stock"
                add_portfolio(sym, atype, amount, price)
                await update.message.reply_text(
                    "Added to portfolio!\n" + sym + " x " + str(amount) + " | Buy: $" + str(price)
                )
            else:
                msg = await update.message.reply_text("Calculating...")
                await show_portfolio(msg)

        elif category == "memory":
            mem_content = intent.get("memory_content") or user_message
            forget_kw = intent.get("forget_keyword")
            if forget_kw:
                deleted = forget_memory(forget_kw)
                await update.message.reply_text(str(deleted) + " record(s) deleted for: " + forget_kw)
            else:
                save_memory("user", mem_content)
                await update.message.reply_text("Saved: " + mem_content[:100])

        elif category == "task":
            task_text = intent.get("task_text") or user_message
            add_task(task_text)
            save_memory("task", task_text)
            await update.message.reply_text(
                "Task saved!\n" + task_text + "\n\nType /tasks to list them."
            )

        elif category in ("general_question", "coding", "education"):
            if category == "education" or ai_mode == "education":
                edu_sys = EDUCATION_SYSTEM
                if mem_summary:
                    edu_sys += "\n\nKullanici hafizasi:\n" + mem_summary
                if style_prompt:
                    edu_sys += "\n\n" + style_prompt
                # For follow-up answers, do not use EDUCATION_TEMPLATE
                # Just pass the message with history so AI can evaluate the answer
                if _is_followup:
                    # Build context from recent history for follow-up evaluation
                    recent = ""
                    if history:
                        last_pairs = history[-4:]
                        recent = "\n".join(
                            ("Asistan: " if r == "assistant" else "Kullanici: ") + c
                            for r, c in last_pairs
                        )
                    general_prompt = (
                        "Son konusma:\n" + recent + "\n\n"
                        "Kullanicinin yeni mesaji: " + user_message + "\n\n"
                        "Eger kullanici bir soruya cevap verdiyse:\n"
                        "- Dogru mu yanlis mi net soyle\n"
                        "- Kisaca neden soyle\n"
                        "- Dogru cevap neyse yaz\n"
                        "Eger devam veya baska bir sey yaziyorsa, konusmayi surdur."
                    )
                else:
                    general_prompt = EDUCATION_TEMPLATE.format(
                        question=user_message,
                        context=tool_context,
                    )
                chat_sys = edu_sys
            else:
                general_prompt = (
                    "Kullanici sorusu: " + user_message + "\n\n" +
                    tool_context + "\n\n" +
                    "Net, anlasilir Turkce cevap ver. Kendi gorusunu de ekle."
                )
                chat_sys = CHAT_SYSTEM
                if mem_summary:
                    chat_sys += "\n\nKullanici hafizasi:\n" + mem_summary
                if style_prompt:
                    chat_sys += "\n\n" + style_prompt
            result = await ask_ai(general_prompt, chat_sys, history, model=ai_model)
            save_chat("user", user_message)
            save_chat("assistant", result)
            if msg:
                await send_long(msg, result)
            else:
                await update.message.reply_text(result[:4000])

        else:
            if ai_mode == "emotional_support" or category == "emotional_support":
                system = EMOTIONAL_SYSTEM
                if mem_summary:
                    system += "\n\nKullanici hafizasi:\n" + mem_summary
                result = await ask_ai(user_message, system, history, model=ai_model)

            elif ai_mode == "personal_advice" or category == "personal_advice":
                system = PERSONAL_SYSTEM
                if profile and "No user info" not in profile:
                    system += "\n\n" + profile
                if mem_summary:
                    system += "\n\nKullanici hafizasi:\n" + mem_summary
                result = await ask_ai(user_message, system, history, model=ai_model)

            else:
                system = CHAT_SYSTEM
                if profile and "No user info" not in profile:
                    system += "\n\n" + profile
                if mem_summary:
                    system += "\n\nKullanici hafizasi:\n" + mem_summary
                if style_prompt:
                    system += "\n\n" + style_prompt
                system += CHAT_RULES
                result = await ask_ai(user_message, system, history, model=ai_model)

            save_chat("user", user_message)
            save_chat("assistant", result)
            if any(k in text_lower for k in ["isim", "calisiyorum", "dropshipping", "trade", "hedefim"]):
                save_memory("profil", user_message[:120])
            await update.message.reply_text(result[:4000])

      except Exception as e:
        log_error(user_id, e)
        err = "Bir hata olustu, lutfen tekrar dene."
        try:
            if msg:
                await msg.edit_text(err)
            else:
                await update.message.reply_text(err)
        except Exception:
            pass


# ---------------------------------------------------------------
# PORTFOLIO DISPLAY
# ---------------------------------------------------------------

async def show_portfolio(msg):
    items = get_portfolio()
    if not items:
        await msg.edit_text("Portfolio is empty!\nWrite 'BTC 0.5 bought at 42000' to add.")
        return
    lines = ["My Portfolio:\n"]
    total_inv = 0.0
    total_cur = 0.0
    keyboard = []
    for item_id, sym, atype, amount, buy_price in items:
        cur = buy_price
        try:
            if atype == "crypto":
                d = get_crypto_data(sym)
            else:
                d = get_stock_data(sym)
            cur = d.get("current", buy_price)
        except Exception:
            pass
        inv = amount * buy_price
        cur_val = amount * cur
        total_inv += inv
        total_cur += cur_val
        pnl = cur_val - inv
        pct = (pnl / inv * 100) if inv > 0 else 0.0
        sign = "+" if pnl >= 0 else "-"
        lines.append(
            sign + " " + sym + " x" + str(amount) + "\n"
            "  $" + "{:.4f}".format(buy_price) + " -> $" + "{:.4f}".format(cur) +
            " | $" + "{:+.2f}".format(pnl) + " (" + "{:+.1f}".format(pct) + "%)\n"
        )
        keyboard.append([
            InlineKeyboardButton("Delete: " + sym, callback_data="port_del_" + str(item_id))
        ])
    pnl = total_cur - total_inv
    pct = (pnl / total_inv * 100) if total_inv > 0 else 0.0
    lines.append(
        "\nInvested: $" + "{:.2f}".format(total_inv) +
        " -> $" + "{:.2f}".format(total_cur) +
        "\nP/L: $" + "{:+.2f}".format(pnl) + " (" + "{:+.1f}".format(pct) + "%)"
    )
    try:
        await msg.edit_text("\n".join(lines), reply_markup=InlineKeyboardMarkup(keyboard))
    except Exception:
        await msg.edit_text("\n".join(lines))


# ---------------------------------------------------------------
# BACKGROUND JOBS
# ---------------------------------------------------------------

async def job_portfolio_alert(app):
    try:
        items = get_portfolio()
        if not items or not OWNER_ID:
            return
        alerts = []
        for _, sym, atype, amount, buy_price in items:
            try:
                if atype == "crypto":
                    d = get_crypto_data(sym)
                else:
                    d = get_stock_data(sym)
                cur = d.get("current")
                change = d.get("change_1d")
                if cur and change is not None:
                    pnl = (cur - buy_price) * amount
                    if change <= -5:
                        alerts.append(
                            sym + " dropped " + "{:.1f}".format(change) + "%\n"
                            "Price: $" + "{:.4f}".format(cur) +
                            " | P/L: $" + "{:+.2f}".format(pnl)
                        )
                    elif change >= 8:
                        alerts.append(
                            sym + " rose +" + "{:.1f}".format(change) + "%\n"
                            "Price: $" + "{:.4f}".format(cur) +
                            " | P/L: $" + "{:+.2f}".format(pnl)
                        )
            except Exception as e:
                logger.error("portfolio alert (" + sym + "): " + str(e))
        if alerts:
            await app.bot.send_message(
                chat_id=OWNER_ID,
                text="Portfolio Alert!\n\n" + "\n\n".join(alerts),
            )
    except Exception as e:
        logger.error("job_portfolio_alert: " + str(e))


async def job_news_alert(app):
    try:
        if not OWNER_ID:
            return
        keywords = ["bitcoin crash", "crypto ban", "fed rate decision", "market crash"]
        for kw in keywords:
            news = get_news(kw, 3)
            if news:
                check = await ask_gemini(
                    "Is this news very important and urgent? Reply only yes or no:\n" +
                    news[0]["title"] + ": " + news[0]["body"]
                )
                if "yes" in check.lower():
                    summary = await ask_gemini(
                        "Summarize in 2 sentences:\n" +
                        news[0]["title"] + ": " + news[0]["body"]
                    )
                    await app.bot.send_message(
                        chat_id=OWNER_ID,
                        text="Critical News!\n\n" + summary,
                    )
                    break
    except Exception as e:
        logger.error("job_news_alert: " + str(e))


async def job_daily_brief(app):
    try:
        if not OWNER_ID:
            return
        btc = get_crypto_data("BTC")
        eth = get_crypto_data("ETH")
        news = get_news("crypto markets bitcoin nasdaq economy latest", 8)
        news_text = format_news(news, "NEWS")
        tasks = get_tasks(done=0)
        task_str = "\n".join("- " + t for _, t, _ in tasks[:5]) if tasks else "No tasks"
        prompt = (
            "Prepare a daily morning briefing (" + datetime.now().strftime("%d.%m.%Y") + "):\n\n"
            "BTC: $" + str(btc.get("current", "?")) + " (" + str(btc.get("change_1d", "?")) + "% 24h)\n"
            "ETH: $" + str(eth.get("current", "?")) + " (" + str(eth.get("change_1d", "?")) + "% 24h)\n"
            "Tasks: " + task_str + "\n" +
            news_text + "\n\n"
            "Short morning summary:\n"
            "Markets:\n"
            "Top 3 highlights:\n"
            "Today tasks:\n"
            "Opportunity/Risk:"
        )
        summary = await ask_gemini(prompt)
        await app.bot.send_message(
            chat_id=OWNER_ID,
            text="Daily Briefing - " + datetime.now().strftime("%d.%m.%Y") + "\n\n" + summary,
        )
    except Exception as e:
        logger.error("job_daily_brief: " + str(e))


async def job_task_reminder(app):
    try:
        if not OWNER_ID:
            return
        for task_id, task, remind_at in get_tasks(done=0):
            if remind_at:
                try:
                    if datetime.now() >= datetime.fromisoformat(remind_at):
                        await app.bot.send_message(
                            chat_id=OWNER_ID,
                            text="Reminder!\n\n" + task,
                            reply_markup=InlineKeyboardMarkup([[
                                InlineKeyboardButton("Done", callback_data="done_" + str(task_id))
                            ]]),
                        )
                        complete_task(task_id)
                except Exception:
                    pass
    except Exception as e:
        logger.error("job_task_reminder: " + str(e))


# ---------------------------------------------------------------
# COMMANDS
# ---------------------------------------------------------------

async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    keyboard = [
        [
            InlineKeyboardButton("Analysis", callback_data="m_analysis"),
            InlineKeyboardButton("Portfolio", callback_data="m_portfolio"),
            InlineKeyboardButton("News", callback_data="m_news"),
        ],
        [
            InlineKeyboardButton("Tasks", callback_data="m_tasks"),
            InlineKeyboardButton("Profile", callback_data="m_profile"),
            InlineKeyboardButton("Help", callback_data="m_help"),
        ],
    ]
    await update.message.reply_text(
        "Hello! I am your personal AI assistant.\n\n"
        "Just write to me directly:\n\n"
        "- 'What will BTC do?' -> Deep analysis\n"
        "- 'Is NVDA a buy?' -> Stock analysis\n"
        "- 'Is LED light dropshipping good?' -> Product analysis\n"
        "- 'How is my portfolio?' -> Live P/L\n"
        "- 'I feel bad today' -> Let's talk\n\n"
        "Normal -> gpt-4o-mini (fast)\n"
        "'very detailed' or 'deep analysis' -> gpt-4o (powerful)",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )


async def cmd_button(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    data = query.data

    if data == "m_analysis":
        await query.message.reply_text(
            "Which asset should I analyze?\n\n"
            "Example: 'analyze BTC' or 'very detailed NVDA'"
        )
    elif data == "m_portfolio":
        msg = await query.message.reply_text("Calculating...")
        await show_portfolio(msg)
    elif data == "m_news":
        msg = await query.message.reply_text("Loading...")
        news = get_news("crypto markets bitcoin economy latest", 8)
        summary = await ask_ai(
            format_news(news, "NEWS") + "\n\nSummarize the top 5.",
            "You are a news editor."
        )
        await send_long(msg, "News\n\n" + summary)
    elif data == "m_tasks":
        tasks = get_tasks(done=0)
        if not tasks:
            await query.message.reply_text("No tasks!\nWrite 'remind me to call John tomorrow'.")
        else:
            keyboard = []
            txt = "My Tasks:\n\n"
            for tid, task, _ in tasks:
                txt += "- " + task + "\n"
                keyboard.append([
                    InlineKeyboardButton("Done: " + task[:35], callback_data="done_" + str(tid))
                ])
            await query.message.reply_text(txt, reply_markup=InlineKeyboardMarkup(keyboard))
    elif data == "m_profile":
        await query.message.reply_text("Your Profile:\n\n" + get_user_profile())
    elif data == "m_help":
        await query.message.reply_text(
            "How it works:\n\n"
            "For each message:\n"
            "1. I understand what you want\n"
            "2. I pick the right tools\n"
            "3. I fetch live data\n"
            "4. I analyze with AI\n\n"
            "Data sources:\n"
            "- CoinGecko -> crypto price\n"
            "- Yahoo Finance -> stock data\n"
            "- DuckDuckGo -> news and web\n\n"
            "Models:\n"
            "- Normal -> gpt-4o-mini\n"
            "- 'very detailed' -> gpt-4o"
        )
    elif data.startswith("done_"):
        complete_task(int(data.split("_")[1]))
        await query.message.reply_text("Marked as done!")
    elif data.startswith("port_del_"):
        remove_portfolio(int(data.split("_")[2]))
        await query.message.reply_text("Removed from portfolio!")


async def cmd_analiz(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not context.args:
        await update.message.reply_text("Usage: /analiz BTC  or  /analiz deep NVDA")
        return
    depth = "high" if context.args[0].lower() in ["deep", "derin", "detailed"] else "medium"
    symbol = context.args[-1].upper()
    use_gpt4 = (depth == "high")
    msg = await update.message.reply_text(symbol + " " + DEPTH_CONFIG[depth]["label"] + " analyzing...")
    intent = {
        "intent": "finance",
        "symbol": symbol,
        "asset_type": "crypto" if symbol in CRYPTO_SYMBOLS else "stock",
    }
    tool_results = await run_tools(symbol + " analyze", intent, depth)
    tool_context = build_context_for_ai(symbol + " analyze", tool_results, get_user_profile())
    result = await run_finance_analysis(
        symbol + " analyze", symbol, DEPTH_CONFIG[depth]["label"],
        tool_context, use_gpt4=use_gpt4,
    )
    await send_long(msg, result)


async def cmd_fiyat(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not context.args:
        await update.message.reply_text("Usage: /fiyat BTC")
        return
    symbol = context.args[0].upper()
    msg = await update.message.reply_text(symbol + " price loading...")
    if symbol in CRYPTO_SYMBOLS:
        d = get_crypto_data(symbol)
    else:
        d = get_stock_data(symbol)
    if d.get("error"):
        await msg.edit_text("Error: " + d["error"])
        return
    cur = d.get("current", "N/A")
    c1d = d.get("change_1d", "N/A")
    sign = "+" if isinstance(c1d, (int, float)) and c1d >= 0 else "-"
    await send_long(
        msg,
        symbol + "\n$" + str(cur) + "\n" + sign + " " + str(c1d) + "% (24h)\n\n"
        "For deep analysis write: " + symbol + " analyze",
    )


async def cmd_haber(update: Update, context: ContextTypes.DEFAULT_TYPE):
    topic = " ".join(context.args) if context.args else "crypto markets bitcoin economy latest"
    msg = await update.message.reply_text("Loading news...")
    news = get_news(topic, 10)
    summary = await ask_ai(
        format_news(news, "NEWS") + "\n\nSummarize top 5 with comments.",
        "You are a news editor."
    )
    await send_long(msg, "News " + datetime.now().strftime("%d.%m.%Y %H:%M") + "\n\n" + summary)


async def cmd_premium(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    prem = is_premium(user_id)
    if prem:
        await update.message.reply_text(
            "Premium ozellikler:\n"
            "- Sinirsiz mesaj\n"
            "- Detayli analiz\n"
            "- Daha hizli destek\n\n"
            "Premium hesabiniz aktif."
        )
    else:
        used = get_daily_usage(user_id)
        remaining = get_remaining_messages(user_id)
        remaining_display = "Sinirsiz" if remaining == -1 else str(max(0, remaining))
        await update.message.reply_text(
            "Premium ozellikler:\n"
            "- Sinirsiz mesaj\n"
            "- Detayli analiz\n"
            "- Daha hizli destek\n\n"
            "Premium aktif etmek icin yoneticiyle iletisime gec.\n\n"
            "Bugun kullandin: " + str(used) + " / " + str(UL_FREE_LIMIT) + "\n"
            "Kalan: " + remaining_display + " mesaj"
        )


async def cmd_reset(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    if user_id != OWNER_ID:
        await update.message.reply_text("You do not have permission to use this command.")
        return
    if context.args:
        try:
            target_id = int(context.args[0])
            reset_user_count(target_id)
            await update.message.reply_text("User " + str(target_id) + " reset.")
        except Exception:
            await update.message.reply_text("Invalid user ID.")
    else:
        reset_user_count(user_id)
        await update.message.reply_text("Your usage count has been reset.")


async def cmd_makepremium(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    if user_id != OWNER_ID:
        await update.message.reply_text("Bu komutu kullanma yetkiniz yok.")
        return
    if not context.args:
        await update.message.reply_text("Kullanim: /makepremium USER_ID")
        return
    try:
        target_id = int(context.args[0])
        ul_set_premium(target_id, True)
        await update.message.reply_text(str(target_id) + " kullanicisi premium yapildi.")
    except Exception:
        await update.message.reply_text("Gecersiz kullanici ID.")


async def cmd_removepremium(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    if user_id != OWNER_ID:
        await update.message.reply_text("Bu komutu kullanma yetkiniz yok.")
        return
    if not context.args:
        await update.message.reply_text("Kullanim: /removepremium USER_ID")
        return
    try:
        target_id = int(context.args[0])
        ul_set_premium(target_id, False)
        await update.message.reply_text(str(target_id) + " kullanicisinin premiumu kaldirildi.")
    except Exception:
        await update.message.reply_text("Gecersiz kullanici ID.")


async def cmd_hatirla(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not context.args:
        await update.message.reply_text("Usage: /hatirla info")
        return
    info = " ".join(context.args)
    save_memory("user", info)
    await update.message.reply_text("Saved: " + info)


async def cmd_hafiza(update: Update, context: ContextTypes.DEFAULT_TYPE):
    mems = get_memories(20)
    if not mems:
        await update.message.reply_text("Memory is empty.")
        return
    lines = ["- [" + cat + "] " + content for _, cat, content, _ in mems]
    await send_long(update.message, "Your Profile:\n\n" + "\n".join(lines))


async def cmd_unut(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not context.args:
        await update.message.reply_text("Usage: /unut keyword")
        return
    deleted = forget_memory(" ".join(context.args))
    await update.message.reply_text(str(deleted) + " record(s) deleted.")


async def cmd_gpt(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not context.args:
        await update.message.reply_text("Usage: /gpt question")
        return
    question = " ".join(context.args)
    msg = await update.message.reply_text("Thinking...")
    answer = await ask_openai(
        question,
        CHAT_SYSTEM + "\n\n" + get_user_profile(),
        get_chat_history(6),
        "gpt-4o",
    )
    save_chat("user", question)
    save_chat("assistant", answer)
    await send_long(msg, answer)


async def cmd_tasks(update: Update, context: ContextTypes.DEFAULT_TYPE):
    tasks = get_tasks(done=0)
    if not tasks:
        await update.message.reply_text("No tasks!")
        return
    keyboard = []
    txt = "My Tasks:\n\n"
    for tid, task, _ in tasks:
        txt += "- " + task + "\n"
        keyboard.append([
            InlineKeyboardButton("Done: " + task[:35], callback_data="done_" + str(tid))
        ])
    await update.message.reply_text(txt, reply_markup=InlineKeyboardMarkup(keyboard))


async def cmd_profile(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    username = update.effective_user.username or "unknown"
    first_name = update.effective_user.first_name or ""

    prem = is_premium(user_id)
    used = get_daily_usage(user_id)
    remaining = get_remaining_messages(user_id)
    remaining_display = "Unlimited" if remaining == -1 else str(max(0, remaining))
    status = "Premium" if prem else "Free"

    mem_parts = []
    user_mem = get_memory_summary(user_id)
    if user_mem:
        mem_parts.append(user_mem)
    global_mems = get_memories(10)
    if global_mems:
        lines_mem = ["- [" + cat + "] " + content for _, cat, content, _ in global_mems]
        mem_parts.append("\n".join(lines_mem))
    mem_display = "\n".join(mem_parts) if mem_parts else "No saved memory."

    lines = [
        "Profile: " + first_name,
        "",
        "User ID  : " + str(user_id),
        "Username : @" + username,
        "Status   : " + status,
        "",
        "Messages today : " + str(used) + " / " + str(UL_FREE_LIMIT),
        "Remaining      : " + remaining_display,
        "",
        "Memory:",
        mem_display,
    ]
    await update.message.reply_text("\n".join(lines))


async def cmd_stats(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    if user_id != OWNER_ID:
        await update.message.reply_text("Unauthorized")
        return
    text = format_stats()
    await update.message.reply_text(text)


async def cmd_help(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "Commands:\n\n"
        "/analiz BTC -- Technical analysis\n"
        "/analiz deep NVDA -- Deep analysis (gpt-4o)\n"
        "/fiyat ETH -- Live price\n"
        "/haber topic -- News\n"
        "/gpt question -- GPT-4o direct\n"
        "/hatirla info -- Save to memory\n"
        "/hafiza -- Show profile\n"
        "/unut keyword -- Delete from memory\n"
        "/tasks -- List tasks\n"
        "/premium -- Show premium status\n"
        "/reset -- Reset daily usage (owner only)\n"
        "/addpremium USER_ID -- Give premium (owner only)\n"
        "/removepremium USER_ID -- Remove premium (owner only)\n\n"
        "Or just write directly, I understand!"
    )


# ---------------------------------------------------------------
# MAIN
# ---------------------------------------------------------------

def main():
    setup_logger()
    init_db()
    init_memory_db()
    init_usage_db()

    app = Application.builder().token(TELEGRAM_TOKEN).build()

    handlers = [
        ("start", cmd_start),
        ("help", cmd_help),
        ("analiz", cmd_analiz),
        ("fiyat", cmd_fiyat),
        ("haber", cmd_haber),
        ("gpt", cmd_gpt),
        ("hatirla", cmd_hatirla),
        ("hafiza", cmd_hafiza),
        ("unut", cmd_unut),
        ("tasks", cmd_tasks),
        ("premium", cmd_premium),
        ("reset", cmd_reset),
        ("makepremium", cmd_makepremium),
        ("removepremium", cmd_removepremium),
        ("profile", cmd_profile),
        ("stats", cmd_stats),
    ]
    for cmd, handler in handlers:
        app.add_handler(CommandHandler(cmd, handler))

    app.add_handler(CallbackQueryHandler(cmd_button))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))

    scheduler = AsyncIOScheduler(timezone="Europe/Istanbul")
    scheduler.add_job(
        lambda: asyncio.ensure_future(job_daily_brief(app)),
        "cron", hour=8, minute=0,
    )
    scheduler.add_job(
        lambda: asyncio.ensure_future(job_portfolio_alert(app)),
        "interval", minutes=15,
    )
    scheduler.add_job(
        lambda: asyncio.ensure_future(job_news_alert(app)),
        "interval", hours=1,
    )
    scheduler.add_job(
        lambda: asyncio.ensure_future(job_task_reminder(app)),
        "interval", minutes=5,
    )
    scheduler.start()

    logger.info("Bot started.")
    app.run_polling(drop_pending_updates=True)


if __name__ == "__main__":
    main()
