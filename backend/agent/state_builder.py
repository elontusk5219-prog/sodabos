"""
状态建模层：从全部数据构建 world_state JSON。
"""
import json


async def build_world_state(db) -> dict:
    """
    Aggregate all data into a structured world state snapshot.
    This is the agent's understanding of the current market landscape.
    """
    # Top demands by score
    cur = await db.execute(
        """SELECT id, title, description, score_total, score_pain,
                  score_competition, score_cold_start, score_cost,
                  score_virality, score_ltv, score_ai_opportunity,
                  stage, track, ai_analysis,
                  COALESCE(insight_layer, 'conventional') as insight_layer
           FROM demands ORDER BY score_total DESC LIMIT 20"""
    )
    top_demands = [dict(r) for r in await cur.fetchall()]

    # Trending keywords
    cur = await db.execute(
        """SELECT keyword, platform, value, change_percent
           FROM trends ORDER BY recorded_at DESC LIMIT 30"""
    )
    trending = [dict(r) for r in await cur.fetchall()]

    # User preference signals from feedback
    cur = await db.execute(
        """SELECT f.type, f.target_id, f.vote, d.title
           FROM feedback f
           LEFT JOIN demands d ON f.type='demand' AND CAST(f.target_id AS INTEGER) = d.id
           ORDER BY f.created_at DESC LIMIT 50"""
    )
    feedback_signals = [dict(r) for r in await cur.fetchall()]

    # Aggregate user preference: what they like vs dislike
    liked_demands = [f for f in feedback_signals if f["type"] == "demand" and f["vote"] == 1]
    disliked_demands = [f for f in feedback_signals if f["type"] == "demand" and f["vote"] == -1]
    liked_words = [f["target_id"] for f in feedback_signals if f["type"] == "wordcloud" and f["vote"] == 1]
    disliked_words = [f["target_id"] for f in feedback_signals if f["type"] == "wordcloud" and f["vote"] == -1]

    # Stage distribution
    cur = await db.execute(
        "SELECT stage, COUNT(*) FROM demands GROUP BY stage"
    )
    stage_dist = {r[0]: r[1] for r in await cur.fetchall()}

    # Recent high-engagement items
    cur = await db.execute(
        """SELECT id, title, platform, metrics
           FROM raw_items ORDER BY created_at DESC LIMIT 30"""
    )
    recent_signals = [dict(r) for r in await cur.fetchall()]

    # Demands already investigated (has checkpoints)
    cur = await db.execute(
        """SELECT DISTINCT demand_id FROM agent_checkpoints
           WHERE checkpoint_type='investigate'"""
    )
    investigated_ids = {r[0] for r in await cur.fetchall()}

    # 改造五：加速趋势（跨轮次累积）
    try:
        cur = await db.execute("""
            SELECT keyword,
                   COUNT(*) as appearances,
                   AVG(change_percent) as avg_momentum
            FROM trends
            WHERE recorded_at > datetime('now', '-21 days')
            GROUP BY keyword
            HAVING COUNT(*) >= 3 AND AVG(change_percent) > 0
            ORDER BY AVG(change_percent) DESC
            LIMIT 10
        """)
        accelerating_trends = [dict(r) for r in await cur.fetchall()]
    except Exception:
        accelerating_trends = []

    # Phase 6: 活跃项目及进度
    try:
        cur = await db.execute("""
            SELECT p.id, p.title, p.current_stage, p.status, p.demand_id,
                   p.created_at, p.updated_at,
                   (SELECT COUNT(*) FROM project_documents pd WHERE pd.project_id = p.id AND pd.status = 'approved') as approved_docs,
                   (SELECT COUNT(*) FROM stage_deliverables sd WHERE sd.stage = p.current_stage AND sd.is_required = 1) as required_docs,
                   (SELECT COUNT(*) FROM project_members pm WHERE pm.project_id = p.id) as member_count
            FROM projects p WHERE p.status = 'active'
            ORDER BY p.updated_at DESC LIMIT 20
        """)
        active_projects = []
        for r in await cur.fetchall():
            row = dict(r)
            total_req = row.pop("required_docs", 0)
            approved = row.pop("approved_docs", 0)
            row["stage_progress_pct"] = round(approved / total_req * 100) if total_req > 0 else 0
            active_projects.append(row)
    except Exception:
        active_projects = []

    # 停滞项目（超过7天无更新）
    try:
        cur = await db.execute("""
            SELECT p.id, p.title, p.current_stage, p.updated_at
            FROM projects p
            WHERE p.status = 'active'
            AND p.updated_at < datetime('now', '-7 days')
        """)
        stalled_projects = [dict(r) for r in await cur.fetchall()]
    except Exception:
        stalled_projects = []

    # 已关联项目的需求ID（避免重复处理）
    try:
        cur = await db.execute("SELECT COALESCE(demand_id, 0) FROM projects WHERE demand_id IS NOT NULL")
        project_demand_ids = [r[0] for r in await cur.fetchall()]
    except Exception:
        project_demand_ids = []

    return {
        "top_demands": top_demands,
        "trending_keywords": trending,
        "user_preferences": {
            "liked_demands": [{"id": f["target_id"], "title": f.get("title")} for f in liked_demands],
            "disliked_demands": [{"id": f["target_id"], "title": f.get("title")} for f in disliked_demands],
            "liked_topics": liked_words,
            "disliked_topics": disliked_words,
        },
        "stage_distribution": stage_dist,
        "recent_signals": recent_signals[:15],
        "already_investigated": list(investigated_ids),
        "accelerating_trends": accelerating_trends,
        "active_projects": active_projects,
        "stalled_projects": stalled_projects,
        "project_demand_ids": project_demand_ids,
    }
