# coding: utf-8
import sqlite3
from datetime import datetime, timedelta

DB_PATH = "memory.db"


def get_stats():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    today = datetime.now().strftime("%Y-%m-%d")
    since_24h = (datetime.now() - timedelta(hours=24)).isoformat()

    c.execute("SELECT COUNT(DISTINCT user_id) FROM user_usage")
    row = c.fetchone()
    total_users = row[0] if row else 0

    c.execute("SELECT COALESCE(SUM(count), 0) FROM user_usage")
    row = c.fetchone()
    total_messages = row[0] if row else 0

    c.execute("SELECT COALESCE(SUM(count), 0) FROM user_usage WHERE date=?", (today,))
    row = c.fetchone()
    messages_today = row[0] if row else 0

    c.execute("SELECT COUNT(*) FROM premium_users WHERE is_premium=1")
    row = c.fetchone()
    premium_users = row[0] if row else 0

    c.execute(
        "SELECT COUNT(DISTINCT user_id) FROM user_usage WHERE date=?",
        (today,)
    )
    row = c.fetchone()
    active_today = row[0] if row else 0

    conn.close()

    return {
        "total_users": total_users,
        "total_messages": total_messages,
        "messages_today": messages_today,
        "premium_users": premium_users,
        "active_today": active_today,
    }


def format_stats():
    s = get_stats()
    now = datetime.now().strftime("%d.%m.%Y %H:%M")
    return (
        "Admin Stats - " + now + "\n\n"
        "Total users     : " + str(s["total_users"]) + "\n"
        "Total messages  : " + str(s["total_messages"]) + "\n"
        "Messages today  : " + str(s["messages_today"]) + "\n"
        "Premium users   : " + str(s["premium_users"]) + "\n"
        "Active today    : " + str(s["active_today"]) + "\n"
    )
