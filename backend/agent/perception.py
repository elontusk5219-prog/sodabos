"""
感知层：检测自上次循环以来的新信号。
"""
import json


async def _detect_accumulating_trends(db) -> list:
    """检测连续多轮出现且热度递增的痛点话题（改造五：趋势累积感知）。"""
    try:
        cur = await db.execute("""
            SELECT keyword,
                   COUNT(*) as appearances,
                   AVG(change_percent) as avg_momentum,
                   MAX(value) - MIN(value) as value_range
            FROM trends
            WHERE recorded_at > datetime('now', '-21 days')
            GROUP BY keyword
            HAVING COUNT(*) >= 3 AND AVG(change_percent) > 0
            ORDER BY AVG(change_percent) DESC
            LIMIT 10
        """)
        rows = await cur.fetchall()
        return [{"keyword": r["keyword"],
                 "appearances": r["appearances"],
                 "momentum": r["avg_momentum"],
                 "signal": "accelerating" if r["avg_momentum"] > 20 else "steady_growth"}
                for r in rows]
    except Exception:
        return []


async def detect_new_signals(db, since: str | None) -> dict:
    """
    Find new items, feedback, and trend changes since a given timestamp.
    Returns a structured signal summary.
    """
    condition = "WHERE fetched_at > ?" if since else ""
    params = (since,) if since else ()

    # New raw items
    cur = await db.execute(
        f"SELECT COUNT(*) FROM raw_items {condition}", params
    )
    new_items_count = (await cur.fetchone())[0]

    # Top new items by engagement
    if since:
        cur = await db.execute(
            """SELECT id, title, platform, content, metrics
               FROM raw_items WHERE fetched_at > ?
               ORDER BY created_at DESC LIMIT 50""",
            (since,),
        )
    else:
        cur = await db.execute(
            """SELECT id, title, platform, content, metrics
               FROM raw_items ORDER BY created_at DESC LIMIT 50"""
        )
    new_items = [dict(r) for r in await cur.fetchall()]

    # Recent feedback
    fb_condition = "WHERE created_at > ?" if since else ""
    cur = await db.execute(
        f"SELECT type, target_id, vote, note FROM feedback {fb_condition}",
        params,
    )
    feedback_rows = [dict(r) for r in await cur.fetchall()]

    # Trend shifts
    cur = await db.execute(
        f"""SELECT keyword, platform, value, previous_value, change_percent
            FROM trends {fb_condition.replace('created_at', 'recorded_at')}
            ORDER BY ABS(change_percent) DESC LIMIT 20""",
        params,
    )
    trend_shifts = [dict(r) for r in await cur.fetchall()]

    # New demands (recently extracted)
    cur = await db.execute(
        f"""SELECT id, title, score_total, track
            FROM demands {fb_condition.replace('created_at', 'created_at')}
            ORDER BY score_total DESC LIMIT 20""",
        params,
    )
    new_demands = [dict(r) for r in await cur.fetchall()]

    # 改造五：跨轮次趋势累积
    trend_accumulation = await _detect_accumulating_trends(db)

    # Phase 6: 项目活动信号
    try:
        cur = await db.execute("""
            SELECT p.id, p.title, p.current_stage,
                   (SELECT COUNT(*) FROM project_documents pd
                    WHERE pd.project_id = p.id AND pd.updated_at > ?) as docs_updated,
                   (SELECT COUNT(*) FROM discussion_messages dm
                    JOIN discussion_threads dt ON dm.thread_id = dt.id
                    WHERE dt.project_id = p.id AND dm.created_at > ?) as new_messages,
                   (SELECT COUNT(*) FROM stage_gates sg
                    WHERE sg.project_id = p.id AND sg.status = 'open') as open_gates
            FROM projects p WHERE p.status = 'active'
            HAVING docs_updated > 0 OR new_messages > 0 OR open_gates > 0
        """, (since or '2000-01-01', since or '2000-01-01'))
        project_activity = [dict(r) for r in await cur.fetchall()]
    except Exception:
        project_activity = []

    return {
        "new_items_count": new_items_count,
        "new_items": new_items[:30],
        "feedback_changes": feedback_rows,
        "trend_shifts": trend_shifts,
        "new_demands": new_demands,
        "trend_accumulation": trend_accumulation,
        "project_activity": project_activity,
    }
