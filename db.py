# coding: utf-8
import sqlite3
import os
from datetime import datetime

DB_PATH = "memory.db"
FREE_DAILY_LIMIT = 3
OWNER_ID = int(os.getenv("OWNER_ID", "0"))


def init_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute(
        "CREATE TABLE IF NOT EXISTS memory ("
        "id INTEGER PRIMARY KEY AUTOINCREMENT,"
        "category TEXT,"
        "content TEXT,"
        "created_at TEXT"
        ")"
    )
    c.execute(
        "CREATE TABLE IF NOT EXISTS tasks ("
        "id INTEGER PRIMARY KEY AUTOINCREMENT,"
        "task TEXT,"
        "remind_at TEXT,"
        "done INTEGER DEFAULT 0,"
        "created_at TEXT"
        ")"
    )
    c.execute(
        "CREATE TABLE IF NOT EXISTS chat_history ("
        "id INTEGER PRIMARY KEY AUTOINCREMENT,"
        "role TEXT,"
        "content TEXT,"
        "created_at TEXT"
        ")"
    )
    c.execute(
        "CREATE TABLE IF NOT EXISTS portfolio ("
        "id INTEGER PRIMARY KEY AUTOINCREMENT,"
        "symbol TEXT,"
        "asset_type TEXT,"
        "amount REAL,"
        "buy_price REAL,"
        "created_at TEXT"
        ")"
    )
    c.execute(
        "CREATE TABLE IF NOT EXISTS users ("
        "user_id INTEGER PRIMARY KEY,"
        "is_premium INTEGER DEFAULT 0,"
        "message_count INTEGER DEFAULT 0,"
        "last_reset TEXT"
        ")"
    )
    conn.commit()
    conn.close()


# --- memory table ---

def save_memory(category, content):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute(
        "INSERT INTO memory (category, content, created_at) VALUES (?, ?, ?)",
        (category, content, datetime.now().isoformat()),
    )
    conn.commit()
    conn.close()


def get_memories(limit=15):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute(
        "SELECT id, category, content, created_at FROM memory ORDER BY id DESC LIMIT ?",
        (limit,),
    )
    rows = c.fetchall()
    conn.close()
    return rows


def forget_memory(keyword):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("DELETE FROM memory WHERE content LIKE ?", ("%" + keyword + "%",))
    deleted = c.rowcount
    conn.commit()
    conn.close()
    return deleted


def get_user_profile():
    mems = get_memories(20)
    if not mems:
        return "No user info yet."
    lines = ["- [" + cat + "] " + content for _, cat, content, _ in mems]
    return "Known about user:\n" + "\n".join(lines)


# --- chat history ---

def save_chat(role, content):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute(
        "INSERT INTO chat_history (role, content, created_at) VALUES (?, ?, ?)",
        (role, content, datetime.now().isoformat()),
    )
    c.execute(
        "DELETE FROM chat_history WHERE id NOT IN "
        "(SELECT id FROM chat_history ORDER BY id DESC LIMIT 30)"
    )
    conn.commit()
    conn.close()


def get_chat_history(limit=8):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute(
        "SELECT role, content FROM chat_history ORDER BY id DESC LIMIT ?",
        (limit,),
    )
    rows = c.fetchall()
    conn.close()
    return list(reversed(rows))


# --- tasks ---

def add_task(task, remind_at=None):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute(
        "INSERT INTO tasks (task, remind_at, created_at) VALUES (?, ?, ?)",
        (task, remind_at, datetime.now().isoformat()),
    )
    conn.commit()
    conn.close()


def get_tasks(done=0):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute(
        "SELECT id, task, remind_at FROM tasks WHERE done=? ORDER BY id DESC",
        (done,),
    )
    rows = c.fetchall()
    conn.close()
    return rows


def complete_task(task_id):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("UPDATE tasks SET done=1 WHERE id=?", (task_id,))
    conn.commit()
    conn.close()


# --- portfolio ---

def add_portfolio(symbol, asset_type, amount, buy_price):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute(
        "INSERT INTO portfolio (symbol, asset_type, amount, buy_price, created_at)"
        " VALUES (?, ?, ?, ?, ?)",
        (symbol.upper(), asset_type, amount, buy_price, datetime.now().isoformat()),
    )
    conn.commit()
    conn.close()


def get_portfolio():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT id, symbol, asset_type, amount, buy_price FROM portfolio ORDER BY id")
    rows = c.fetchall()
    conn.close()
    return rows


def remove_portfolio(item_id):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("DELETE FROM portfolio WHERE id=?", (item_id,))
    conn.commit()
    conn.close()


# --- premium / users ---

def get_user_row(user_id):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute(
        "SELECT user_id, is_premium, message_count, last_reset FROM users WHERE user_id=?",
        (user_id,),
    )
    row = c.fetchone()
    conn.close()
    return row


def ensure_user(user_id):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    today = datetime.now().strftime("%Y-%m-%d")
    c.execute("SELECT user_id, last_reset FROM users WHERE user_id=?", (user_id,))
    row = c.fetchone()
    if not row:
        c.execute(
            "INSERT INTO users (user_id, is_premium, message_count, last_reset) VALUES (?, 0, 0, ?)",
            (user_id, today),
        )
    elif row[1] != today:
        c.execute(
            "UPDATE users SET message_count=0, last_reset=? WHERE user_id=?",
            (today, user_id),
        )
    conn.commit()
    conn.close()


def is_premium_user(user_id):
    row = get_user_row(user_id)
    if not row:
        return False
    return row[1] == 1


def set_premium(user_id, value=1):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    today = datetime.now().strftime("%Y-%m-%d")
    c.execute(
        "INSERT INTO users (user_id, is_premium, message_count, last_reset) VALUES (?, ?, 0, ?)"
        " ON CONFLICT(user_id) DO UPDATE SET is_premium=excluded.is_premium",
        (user_id, value, today),
    )
    conn.commit()
    conn.close()


def increment_message_count(user_id):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("UPDATE users SET message_count = message_count + 1 WHERE user_id=?", (user_id,))
    conn.commit()
    conn.close()


def get_message_count(user_id):
    row = get_user_row(user_id)
    if not row:
        return 0
    return row[2]


def reset_user_count(user_id):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    today = datetime.now().strftime("%Y-%m-%d")
    c.execute(
        "UPDATE users SET message_count=0, last_reset=? WHERE user_id=?",
        (today, user_id),
    )
    conn.commit()
    conn.close()


def check_limit(user_id):
    ensure_user(user_id)
    if OWNER_ID and user_id == OWNER_ID:
        return True
    if is_premium_user(user_id):
        return True
    return get_message_count(user_id) < FREE_DAILY_LIMIT
