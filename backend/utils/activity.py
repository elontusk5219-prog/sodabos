"""Shared activity logging."""

import json
from datetime import datetime, timezone


async def log_activity(
    db,
    project_id: int | None,
    user_id: int | None,
    action: str,
    target_type: str = "",
    target_id: int = 0,
    detail: dict | str = "",
):
    """Log an activity event to activity_log table."""
    detail_str = json.dumps(detail, ensure_ascii=False) if isinstance(detail, dict) else str(detail)
    await db.execute(
        """INSERT INTO activity_log (project_id, user_id, action, target_type, target_id, detail, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (project_id, user_id, action, target_type, target_id, detail_str,
         datetime.now(timezone.utc).isoformat()),
    )
