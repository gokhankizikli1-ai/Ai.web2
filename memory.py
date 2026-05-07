# coding: utf-8
import sqlite3
import re
from datetime import datetime

DB_PATH = "memory.db"


def init_memory_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute(
        "CREATE TABLE IF NOT EXISTS user_memory ("
        "id INTEGER PRIMARY KEY AUTOINCREMENT,"
        "user_id INTEGER NOT NULL,"
        "category TEXT DEFAULT 'general',"
        "content TEXT NOT NULL,"
        "created_at TEXT NOT NULL"
        ")"
    )
    c.execute(
        "CREATE TABLE IF NOT EXISTS user_style ("
        "user_id INTEGER PRIMARY KEY,"
        "style_key TEXT DEFAULT 'default',"
        "style_label TEXT DEFAULT 'Standard',"
        "instruction TEXT DEFAULT '',"
        "updated_at TEXT NOT NULL"
        ")"
    )
    conn.commit()
    conn.close()


def remember_fact(user_id, fact, category="general"):
    fact = fact.strip()
    if not fact or len(fact) < 3:
        return False
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute(
        "SELECT id FROM user_memory WHERE user_id=? AND LOWER(content)=LOWER(?)",
        (user_id, fact),
    )
    if c.fetchone():
        conn.close()
        return False
    c.execute(
        "INSERT INTO user_memory (user_id, category, content, created_at) VALUES (?, ?, ?, ?)",
        (user_id, category, fact, datetime.utcnow().isoformat()),
    )
    conn.commit()
    conn.close()
    return True


def forget_fact(user_id, keyword):
    keyword = keyword.strip()
    if not keyword:
        return 0
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute(
        "DELETE FROM user_memory WHERE user_id=? AND LOWER(content) LIKE LOWER(?)",
        (user_id, "%" + keyword + "%"),
    )
    deleted = c.rowcount
    conn.commit()
    conn.close()
    return deleted


def load_user_memory(user_id, limit=15):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute(
        "SELECT category, content, created_at FROM user_memory"
        " WHERE user_id=? ORDER BY id DESC LIMIT ?",
        (user_id, limit),
    )
    rows = c.fetchall()
    conn.close()
    return rows


STYLE_RULES = [
    {
        "key": "short",
        "label": "Short",
        "instruction": "Reply short and clear. Do not exceed 2-4 sentences.",
        "triggers": ["short answer", "keep it short", "brief", "summarize only"],
    },
    {
        "key": "detailed",
        "label": "Detailed",
        "instruction": "Reply in detail, step by step. Do not skip important points.",
        "triggers": ["detailed answer", "explain in detail", "full explanation", "long answer"],
    },
    {
        "key": "bullet",
        "label": "Bullet",
        "instruction": "Reply in bullet points, organized and easy to read.",
        "triggers": ["bullet points", "use bullets", "list format", "list it"],
    },
    {
        "key": "formal",
        "label": "Formal",
        "instruction": "Reply in a formal, professional tone.",
        "triggers": ["be formal", "professional tone", "formal reply"],
    },
    {
        "key": "friendly",
        "label": "Friendly",
        "instruction": "Reply in a friendly, casual and natural tone.",
        "triggers": ["be friendly", "casual tone", "talk like a friend", "relax"],
    },
    {
        "key": "default",
        "label": "Standard",
        "instruction": "Reply naturally, clearly and helpfully.",
        "triggers": ["normal tone", "standard", "reset style", "default"],
    },
]


def detect_style_preference(text):
    msg = text.lower().strip()
    for rule in STYLE_RULES:
        for trigger in rule["triggers"]:
            if trigger in msg:
                return rule
    return None


def update_user_style(user_id, text):
    style = detect_style_preference(text)
    if not style:
        return None
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute(
        "INSERT INTO user_style (user_id, style_key, style_label, instruction, updated_at)"
        " VALUES (?, ?, ?, ?, ?)"
        " ON CONFLICT(user_id) DO UPDATE SET"
        " style_key=excluded.style_key,"
        " style_label=excluded.style_label,"
        " instruction=excluded.instruction,"
        " updated_at=excluded.updated_at",
        (user_id, style["key"], style["label"], style["instruction"], datetime.utcnow().isoformat()),
    )
    conn.commit()
    conn.close()
    return style


def get_user_style(user_id):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute(
        "SELECT style_key, style_label, instruction FROM user_style WHERE user_id=?",
        (user_id,),
    )
    row = c.fetchone()
    conn.close()
    if not row:
        return {
            "key": "default",
            "label": "Standard",
            "instruction": "Reply naturally, clearly and helpfully.",
        }
    return {"key": row[0], "label": row[1], "instruction": row[2]}


def get_style_prompt(user_id):
    style = get_user_style(user_id)
    return "Reply style: " + style["label"] + ". Instruction: " + style["instruction"]


def get_memory_summary(user_id):
    rows = load_user_memory(user_id, 15)
    style = get_user_style(user_id)
    parts = []
    if style["key"] != "default":
        parts.append("Reply style: " + style["label"])
    if rows:
        facts = "\n".join("- " + content for _, content, _ in rows)
        parts.append("Saved facts:\n" + facts)
    return "\n\n".join(parts)


# Memory categories
MEMORY_CATEGORIES = [
    "preference", "finance", "education",
    "ecommerce", "personal_goal", "general", "auto",
]

AUTO_PATTERNS = [
    (r"ben .{0,60} yapiyorum", "personal_goal"),
    (r"ben .{0,60} ile ilgileniyorum", "personal_goal"),
    (r"hedefim .{0,80}", "personal_goal"),
    (r"projem .{0,80}", "personal_goal"),
    (r"isim .{0,60}", "personal_goal"),
    (r"finansla ilgileniyorum", "finance"),
    (r"kripto ile ilgileniyorum", "finance"),
    (r"hisse .{0,60} takip", "finance"),
    (r"dropshipping .{0,60}", "ecommerce"),
    (r"eticaret .{0,60}", "ecommerce"),
    (r"ogreniyorum .{0,60}", "education"),
    (r"ogrenmek istiyorum .{0,60}", "education"),
]

_NOISE_WORDS = [
    "tamam", "anladim", "ok", "iyi", "peki", "devam",
    "tesekkur", "sagol", "oldu", "harika", "super",
]


def _is_noise(text):
    t = text.lower().strip()
    if len(t) < 4:
        return True
    if t in _NOISE_WORDS:
        return True
    return False


def remember_with_category(user_id, text, category="general"):
    if _is_noise(text):
        return False
    if category not in MEMORY_CATEGORIES:
        category = "general"
    return remember_fact(user_id, text.strip(), category=category)


def auto_learn(user_id, text):
    if _is_noise(text):
        return
    msg = text.lower().strip()
    for pattern, category in AUTO_PATTERNS:
        match = re.search(pattern, msg)
        if match:
            fact = match.group(0).strip()
            if len(fact) >= 8:
                remember_fact(user_id, fact, category=category)
                break  # one fact per message max
