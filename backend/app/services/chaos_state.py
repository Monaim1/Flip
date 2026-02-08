from __future__ import annotations

import json
from typing import Any, Dict, Optional

from app.services.db import db_service


CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS ui_preferences (
    user_id VARCHAR PRIMARY KEY,
    chaos_json VARCHAR,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
""".strip()


def ensure_chaos_table() -> None:
    db_service.execute(CREATE_TABLE_SQL)


def get_chaos_state(user_id: str) -> Optional[Dict[str, Any]]:
    if not user_id:
        return None
    ensure_chaos_table()
    rows = db_service.query(
        "SELECT chaos_json FROM ui_preferences WHERE user_id = ?",
        [user_id],
    )
    if not rows:
        return None
    chaos_json = rows[0].get("chaos_json")
    if not chaos_json:
        return None
    try:
        parsed = json.loads(chaos_json)
        if isinstance(parsed, dict):
            return parsed
    except Exception:
        return None
    return None


def set_chaos_state(user_id: str, chaos: Dict[str, Any]) -> None:
    if not user_id or chaos is None:
        return
    ensure_chaos_table()
    chaos_json = json.dumps(chaos)
    db_service.execute("DELETE FROM ui_preferences WHERE user_id = ?", [user_id])
    db_service.execute(
        "INSERT INTO ui_preferences (user_id, chaos_json, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)",
        [user_id, chaos_json],
    )
