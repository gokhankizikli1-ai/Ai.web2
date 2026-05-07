# coding: utf-8
import sqlite3
import os
from datetime import datetime

DB_PATH = "memory.db"
FREE_DAILY_LIMIT = 20
OWNER_ID = int(os.getenv("OWNER_ID", "0"))


def init_usage_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute(
        "CREATE TABLE IF NOT EXISTS user_usage ("
        "user_id INTEGER NOT NULL,"
        "date TEXT NOT NULL,"
        "count INTEGER DEFAULT 0,"
        "PRIMARY KEY (user_id, date)"
        ")"
    )
    c.execute(
        "CREATE TABLE IF NOT EXISTS premium_users ("
        "user_id INTEGER PRIMARY KEY,"
        "is_premium INTEGER DEFAULT 0,"
        "updated_at TEXT NOT NULL"
        ")"
    )
    conn.commit()
    conn.close()


def is_premium(user_id):
    # Owner is always premium
    if OWNER_ID and user_id == OWNER_ID:
        return True
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute(
        "SELECT is_premium FROM premium_users WHERE user_id=?",
        (user_id,),
    )
    row = c.fetchone()
    conn.close()
    if not row:
        return False
    return row[0] == 1


def set_premium(user_id, value=True):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    flag = 1 if value else 0
    c.execute(
        "INSERT INTO premium_users (user_id, is_premium, updated_at) VALUES (?, ?, ?)"
        " ON CONFLICT(user_id) DO UPDATE SET"
        " is_premium=excluded.is_premium,"
        " updated_at=excluded.updated_at",
        (user_id, flag, datetime.utcnow().isoformat()),
    )
    conn.commit()
    conn.close()


def get_daily_usage(user_id):
    today = datetime.now().strftime("%Y-%m-%d")
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute(
        "SELECT count FROM user_usage WHERE user_id=? AND date=?",
        (user_id, today),
    )
    row = c.fetchone()
    conn.close()
    if not row:
        return 0
    return row[0]


def increment_daily_usage(user_id):
    today = datetime.now().strftime("%Y-%m-%d")
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute(
        "INSERT INTO user_usage (user_id, date, count) VALUES (?, ?, 1)"
        " ON CONFLICT(user_id, date) DO UPDATE SET count = count + 1",
        (user_id, today),
    )
    conn.commit()
    conn.close()


def can_user_send_message(user_id):
    if OWNER_ID and user_id == OWNER_ID:
        return True
    if is_premium(user_id):
        return True
    return get_daily_usage(user_id) < FREE_DAILY_LIMIT


def get_remaining_messages(user_id):
    if OWNER_ID and user_id == OWNER_ID:
        return -1
    if is_premium(user_id):
        return -1
    used = get_daily_usage(user_id)
    remaining = FREE_DAILY_LIMIT - used
    return max(0, remaining)


def ensure_user(user_id):
    """
    Ensure the user has a usage row for today.
    Resets count if it is a new day.
    """
    today = datetime.now().strftime("%Y-%m-%d")
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute(
        "SELECT date FROM user_usage WHERE user_id=? ORDER BY date DESC LIMIT 1",
        (user_id,),
    )
    row = c.fetchone()
    if not row:
        # First time user - insert today's row with 0 count
        c.execute(
            "INSERT OR IGNORE INTO user_usage (user_id, date, count) VALUES (?, ?, 0)",
            (user_id, today),
        )
    # If last date differs, new day: row for today will be auto-created on first increment
    conn.commit()
    conn.close()
