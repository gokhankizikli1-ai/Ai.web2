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
        "created_at TEXT,"
        "user_id INTEGER DEFAULT 0,"
        "chat_id TEXT DEFAULT '',"
        "title TEXT DEFAULT ''"
        ")"
    )
    # Additive migration: older deployments started with a (role, content,
    # created_at) schema. Add the new persistence columns in place so
    # legacy rows keep working (user_id=0, chat_id='') and new rows can
    # be filtered per user + per conversation.
    c.execute("PRAGMA table_info(chat_history)")
    _cols = {row[1] for row in c.fetchall()}
    if "user_id" not in _cols:
        c.execute("ALTER TABLE chat_history ADD COLUMN user_id INTEGER DEFAULT 0")
    if "chat_id" not in _cols:
        c.execute("ALTER TABLE chat_history ADD COLUMN chat_id TEXT DEFAULT ''")
    if "title" not in _cols:
        c.execute("ALTER TABLE chat_history ADD COLUMN title TEXT DEFAULT ''")
    c.execute(
        "CREATE INDEX IF NOT EXISTS idx_chat_history_user_chat "
        "ON chat_history(user_id, chat_id, id)"
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

def save_chat(role, content, user_id=0, chat_id="", title=""):
    """Persist a chat turn.

    user_id=0 / chat_id="" preserves the legacy anonymous bucket and its
    rolling 30-row cap. For an authenticated user we keep a per-user
    rolling window (500 rows) so chat history can be restored across
    devices without unbounded growth.
    """
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    uid = int(user_id or 0)
    cid = str(chat_id or "")
    ttl = str(title or "")
    c.execute(
        "INSERT INTO chat_history (role, content, created_at, user_id, chat_id, title)"
        " VALUES (?, ?, ?, ?, ?, ?)",
        (role, content, datetime.now().isoformat(), uid, cid, ttl),
    )
    if uid == 0:
        c.execute(
            "DELETE FROM chat_history WHERE user_id=0 AND id NOT IN "
            "(SELECT id FROM chat_history WHERE user_id=0 ORDER BY id DESC LIMIT 30)"
        )
    else:
        c.execute(
            "DELETE FROM chat_history WHERE user_id=? AND id NOT IN "
            "(SELECT id FROM chat_history WHERE user_id=? ORDER BY id DESC LIMIT 500)",
            (uid, uid),
        )
    conn.commit()
    conn.close()


def get_chat_history(limit=8, user_id=None):
    """Return (role, content) tuples in chronological order.

    When user_id is provided (> 0), restricts to that user's rows so
    cross-user context never leaks into prompt construction. When unset
    / 0, returns the legacy global tail used by anonymous flows.
    """
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    uid = int(user_id or 0) if user_id is not None else 0
    if uid > 0:
        c.execute(
            "SELECT role, content FROM chat_history WHERE user_id=? "
            "ORDER BY id DESC LIMIT ?",
            (uid, int(limit)),
        )
    else:
        c.execute(
            "SELECT role, content FROM chat_history "
            "WHERE user_id=0 OR user_id IS NULL "
            "ORDER BY id DESC LIMIT ?",
            (int(limit),),
        )
    rows = c.fetchall()
    conn.close()
    return list(reversed(rows))


def get_user_chats(user_id, limit=30):
    """Summary list of a user's chat sessions, newest first.

    Returns rows of (chat_id, title, last_user_msg, last_at, msg_count)
    where title falls back to the most recent stored title and
    last_user_msg is the most recent user-authored content (used by
    the sidebar when no explicit title was ever stored).
    """
    uid = int(user_id or 0)
    if uid <= 0:
        return []
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute(
        "SELECT chat_id, "
        "       COALESCE(MAX(NULLIF(title, '')), '') AS title, "
        "       (SELECT content FROM chat_history h2 "
        "          WHERE h2.user_id=h.user_id AND h2.chat_id=h.chat_id "
        "            AND h2.role='user' "
        "          ORDER BY h2.id ASC LIMIT 1) AS first_user_msg, "
        "       MAX(created_at) AS last_at, "
        "       COUNT(*) AS msg_count, "
        "       MAX(id) AS last_id "
        "FROM chat_history h "
        "WHERE user_id=? AND chat_id IS NOT NULL AND chat_id != '' "
        "GROUP BY chat_id "
        "ORDER BY last_id DESC "
        "LIMIT ?",
        (uid, int(limit)),
    )
    rows = c.fetchall()
    conn.close()
    return rows


def get_chat_messages(user_id, chat_id, limit=200):
    """Full message log for one chat, oldest first."""
    uid = int(user_id or 0)
    cid = str(chat_id or "")
    if uid <= 0 or not cid:
        return []
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute(
        "SELECT role, content, created_at FROM chat_history "
        "WHERE user_id=? AND chat_id=? "
        "ORDER BY id ASC LIMIT ?",
        (uid, cid, int(limit)),
    )
    rows = c.fetchall()
    conn.close()
    return rows


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
