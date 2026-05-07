# coding: utf-8
"""
Velora AI - Telegram Adapter (optional client)
This file is a thin wrapper. All AI logic lives in the backend.
"""
import os
import asyncio
import logging
from datetime import datetime
from dotenv import load_dotenv
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    Application, CommandHandler, MessageHandler,
    filters, ContextTypes, CallbackQueryHandler,
)
from apscheduler.schedulers.asyncio import AsyncIOScheduler

# Backend services
from backend.services.ai_service import process_chat
from backend.services.user_service import (
    check_and_count, record_usage, save_message, get_history,
    get_text_profile, get_profile, make_premium,
)
from backend.services.memory_service import (
    get_summary, get_style, maybe_auto_learn, detect_style, apply_style,
    save_memory, delete_memory,
)
from backend.core.config import TELEGRAM_TOKEN, OWNER_ID, FREE_DAILY_LIMIT
from backend.core.logging import setup_logger, new_request_id, log_error, Timer

from db import init_db, get_tasks, complete_task, add_task, get_news
from memory import init_memory_db, remember_with_category, forget_fact
from usage_limits import init_usage_db
from data_sources import get_crypto_data, get_stock_data, get_news, format_news, CRYPTO_SYMBOLS
from stats import get_stats, format_stats
from utils import send_long

load_dotenv()
setup_logger()
logger = logging.getLogger(__name__)

_MEM_LIST_KW = [
    "ne hatirliyorsun", "ne hatırlıyorsun", "ne kaydettin",
    "ne biliyorsun", "hafizanda ne var",
]
_MEM_SAVE_TRIGGERS = [
    "bunu hatirla:", "bunu hatırla:", "hatirla:",
    "hafizana kaydet:", "aklinda tut:", "not al:",
]


# ---------------------------------------------------------------
# MAIN MESSAGE HANDLER (thin adapter)
# ---------------------------------------------------------------

async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_message = update.message.text
    if not user_message or not user_message.strip():
        return

    user_id    = update.effective_user.id
    username   = update.effective_user.username
    text       = user_message
    text_lower = text.lower().strip()
    msg        = None

    # Memory list shortcut
    if any(kw in text_lower for kw in _MEM_LIST_KW):
        summary = get_summary(user_id)
        reply   = ("Hafizamda bunlar var:\n\n" + summary) if summary else "Henuz bir sey kaydetmedim."
        await update.message.reply_text(reply)
        return

    # Memory save shortcut
    for trigger in _MEM_SAVE_TRIGGERS:
        if text_lower.startswith(trigger):
            fact = text[len(trigger):].strip()
            if fact and len(fact) >= 3:
                save_memory(user_id, fact, "general")
                await update.message.reply_text("Kaydettim.")
            return

    # Memory delete shortcut
    if text_lower.startswith("unut:"):
        keyword = text.split(":", 1)[1].strip()
        if keyword:
            delete_memory(user_id, keyword)
            await update.message.reply_text("Silindi.")
        return

    # Style shortcut
    style_match = detect_style(text)
    if style_match:
        apply_style(user_id, text)
        await update.message.reply_text("Stil guncellendi: " + style_match["label"])
        return

    # Usage limit
    can_send, remaining = check_and_count(user_id)
    if not can_send:
        from usage_limits import get_daily_usage
        used = get_daily_usage(user_id)
        await update.message.reply_text(
            "Gunluk ucretsiz limitin doldu. Premium ile sinirsiz kullanabilirsin.\n\n"
            "Bugun kullandin: " + str(used) + " / " + str(FREE_DAILY_LIMIT) + " mesaj\n"
            "/premium yazarak detay alabilirsin."
        )
        return

    maybe_auto_learn(user_id, text)

    try:
        request_id = new_request_id()
        with Timer() as t:
            profile     = get_text_profile()
            history     = get_history(10)
            mem_summary = get_summary(user_id)
            style_data  = get_style(user_id)
            style_prompt = "Cevap stili: " + style_data["label"] + ". Talimat: " + style_data["instruction"]

            ai_result = await process_chat(
                user_id=str(user_id),
                message=text,
                platform="telegram",
                profile=profile,
                history=history,
                mem_summary=mem_summary,
                style_prompt=style_prompt,
            )

        reply  = ai_result["reply"]
        intent = ai_result["intent"]

        record_usage(user_id)
        save_message("user", text)
        save_message("assistant", reply)

        await update.message.reply_text(reply[:4000])

    except Exception as e:
        log_error(request_id if "request_id" in dir() else "?", user_id, e)
        await update.message.reply_text("Bir hata olustu, lutfen tekrar dene.")


# ---------------------------------------------------------------
# COMMANDS
# ---------------------------------------------------------------

async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    keyboard = [
        [
            InlineKeyboardButton("Analiz", callback_data="m_analysis"),
            InlineKeyboardButton("Profil", callback_data="m_profile"),
            InlineKeyboardButton("Yardim", callback_data="m_help"),
        ],
    ]
    await update.message.reply_text(
        "Velora AI'ya hosgeldin!\n\n"
        "Direkt yazabilirsin:\n"
        "- Finans, kripto, hisse analizi\n"
        "- Urun tavsiyesi\n"
        "- Ogrenme ve egitim\n"
        "- Gunluk sohbet\n\n"
        "/premium - hesap durumu\n"
        "/profile - profilin",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )


async def cmd_button(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    data  = query.data

    if data == "m_analysis":
        await query.message.reply_text("Hangi varligi analiz edeyim? Ornek: 'BTC analiz et'")
    elif data == "m_profile":
        uid  = update.effective_user.id
        prof = get_profile(uid)
        rem  = "Sinirsiz" if prof["remaining_messages"] == -1 else str(prof["remaining_messages"])
        await query.message.reply_text(
            "Profilin:\n\n"
            "Durum   : " + ("Premium" if prof["premium"] else "Ucretsiz") + "\n"
            "Bugun   : " + str(prof["messages_used_today"]) + " mesaj\n"
            "Kalan   : " + rem + "\n"
            "Hafiza  : " + str(prof["memory_count"]) + " kayit"
        )
    elif data == "m_help":
        await query.message.reply_text(
            "Nasil kullanilir:\n\n"
            "Direkt yaz, anliyorum!\n\n"
            "Komutlar:\n"
            "/premium - durum\n"
            "/profile - profil\n"
            "/stats - istatistik (admin)\n"
            "/help - yardim"
        )
    elif data.startswith("done_"):
        complete_task(int(data.split("_")[1]))
        await query.message.reply_text("Tamamlandi!")


async def cmd_premium(update: Update, context: ContextTypes.DEFAULT_TYPE):
    uid  = update.effective_user.id
    prof = get_profile(uid)
    rem  = "Sinirsiz" if prof["remaining_messages"] == -1 else str(max(0, prof["remaining_messages"]))
    if prof["premium"]:
        await update.message.reply_text(
            "Premium ozellikler:\n"
            "- Sinirsiz mesaj\n"
            "- Detayli analiz\n"
            "- Daha hizli destek\n\n"
            "Premium hesabiniz aktif."
        )
    else:
        await update.message.reply_text(
            "Premium ozellikler:\n"
            "- Sinirsiz mesaj\n"
            "- Detayli analiz\n"
            "- Daha hizli destek\n\n"
            "Premium almak icin yoneticiyle iletisime gec.\n\n"
            "Bugun: " + str(prof["messages_used_today"]) + " / " + str(FREE_DAILY_LIMIT) + "\n"
            "Kalan: " + rem + " mesaj"
        )


async def cmd_profile(update: Update, context: ContextTypes.DEFAULT_TYPE):
    uid  = update.effective_user.id
    prof = get_profile(uid)
    mem  = get_summary(uid)
    rem  = "Sinirsiz" if prof["remaining_messages"] == -1 else str(max(0, prof["remaining_messages"]))
    mem_display = mem if mem else "Kayitli hafiza yok."
    lines = [
        "Profil:",
        "",
        "ID      : " + str(uid),
        "Durum   : " + ("Premium" if prof["premium"] else "Ucretsiz"),
        "Bugun   : " + str(prof["messages_used_today"]) + " / " + str(FREE_DAILY_LIMIT),
        "Kalan   : " + rem,
        "",
        "Hafiza:",
        mem_display,
    ]
    await update.message.reply_text("\n".join(lines))


async def cmd_stats(update: Update, context: ContextTypes.DEFAULT_TYPE):
    uid = update.effective_user.id
    if uid != OWNER_ID:
        await update.message.reply_text("Unauthorized")
        return
    await update.message.reply_text(format_stats())


async def cmd_makepremium(update: Update, context: ContextTypes.DEFAULT_TYPE):
    uid = update.effective_user.id
    if uid != OWNER_ID:
        await update.message.reply_text("Unauthorized")
        return
    if not context.args:
        await update.message.reply_text("Kullanim: /makepremium USER_ID")
        return
    try:
        target = int(context.args[0])
        make_premium(target, True)
        await update.message.reply_text(str(target) + " kullanicisi premium yapildi.")
    except Exception:
        await update.message.reply_text("Gecersiz kullanici ID.")


async def cmd_removepremium(update: Update, context: ContextTypes.DEFAULT_TYPE):
    uid = update.effective_user.id
    if uid != OWNER_ID:
        await update.message.reply_text("Unauthorized")
        return
    if not context.args:
        await update.message.reply_text("Kullanim: /removepremium USER_ID")
        return
    try:
        target = int(context.args[0])
        make_premium(target, False)
        await update.message.reply_text(str(target) + " kullanicisinin premiumu kaldirildi.")
    except Exception:
        await update.message.reply_text("Gecersiz kullanici ID.")


async def cmd_help(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "Velora AI Komutlar:\n\n"
        "/start - baslangic\n"
        "/premium - hesap durumu\n"
        "/profile - profil ve hafiza\n"
        "/stats - istatistik (admin)\n"
        "/makepremium ID - premium ver (admin)\n"
        "/removepremium ID - premium kaldir (admin)\n"
        "/help - yardim\n\n"
        "Ya da direkt yaz, anliyorum!"
    )


# ---------------------------------------------------------------
# BACKGROUND JOBS
# ---------------------------------------------------------------

async def job_portfolio_alert(app):
    pass  # implement if needed


async def job_news_alert(app):
    pass  # implement if needed


async def job_daily_brief(app):
    try:
        if not OWNER_ID:
            return
        from ai_client import ask_gemini
        btc  = get_crypto_data("BTC")
        eth  = get_crypto_data("ETH")
        news = get_news("crypto markets bitcoin economy latest", 6)
        ntext = format_news(news, "NEWS")
        summary = await ask_gemini(
            "Sabah brifingini hazirla " + datetime.now().strftime("%d.%m.%Y") + ":\n"
            "BTC: $" + str(btc.get("current", "?")) + "\n"
            "ETH: $" + str(eth.get("current", "?")) + "\n\n"
            + ntext + "\n\nKisa ozet:"
        )
        await app.bot.send_message(chat_id=OWNER_ID, text="Gunluk Brifing\n\n" + summary)
    except Exception as e:
        logger.error("job_daily_brief: " + str(e))


# ---------------------------------------------------------------
# MAIN
# ---------------------------------------------------------------

def main():
    init_db()
    init_memory_db()
    init_usage_db()

    application = Application.builder().token(TELEGRAM_TOKEN).build()

    handlers = [
        ("start",         cmd_start),
        ("help",          cmd_help),
        ("premium",       cmd_premium),
        ("profile",       cmd_profile),
        ("stats",         cmd_stats),
        ("makepremium",   cmd_makepremium),
        ("removepremium", cmd_removepremium),
    ]
    for cmd, handler in handlers:
        application.add_handler(CommandHandler(cmd, handler))

    application.add_handler(CallbackQueryHandler(cmd_button))
    application.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))

    scheduler = AsyncIOScheduler(timezone="Europe/Istanbul")
    scheduler.add_job(
        lambda: asyncio.ensure_future(job_daily_brief(application)),
        "cron", hour=8, minute=0,
    )
    scheduler.start()

    logger.info("Velora Telegram adapter started.")
    application.run_polling(drop_pending_updates=True)


if __name__ == "__main__":
    main()
