# coding: utf-8
import re
import logging
from telegram.constants import ParseMode

logger = logging.getLogger(__name__)

MAX_MESSAGE_LENGTH = 4000


async def send_long(target, text, parse_mode=ParseMode.MARKDOWN):
    chunks = [text[i:i + MAX_MESSAGE_LENGTH] for i in range(0, len(text), MAX_MESSAGE_LENGTH)]
    for i, chunk in enumerate(chunks):
        try:
            if i == 0 and hasattr(target, "edit_text"):
                await target.edit_text(chunk, parse_mode=parse_mode)
            elif i == 0:
                await target.reply_text(chunk, parse_mode=parse_mode)
            else:
                chat_id = getattr(target, "chat_id", None)
                if chat_id:
                    await target._bot.send_message(chat_id, chunk, parse_mode=parse_mode)
        except Exception:
            clean = re.sub(r"[*_`\[\]()]", "", chunk)
            try:
                if i == 0 and hasattr(target, "edit_text"):
                    await target.edit_text(clean)
                elif i == 0:
                    await target.reply_text(clean)
            except Exception:
                pass


def format_pnl(pnl, pct):
    sign = "+" if pnl >= 0 else "-"
    return (
        sign + " $" + "{:.2f}".format(abs(pnl)) +
        " (" + "{:+.1f}".format(pct) + "%)"
    )


def format_price(value, decimals=4):
    if value is None:
        return "N/A"
    return "$" + "{:.{}f}".format(value, decimals)


def truncate(text, max_len=100):
    return text[:max_len] + "..." if len(text) > max_len else text
