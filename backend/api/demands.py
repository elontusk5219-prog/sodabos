from fastapi import APIRouter, HTTPException, Query, Depends
from database import get_db
from models import DemandUpdate
from pydantic import BaseModel
from typing import Optional
from auth.deps import get_current_user

router = APIRouter()

# ── Per-user review table (lazy init) ────────────────────────────────────
_review_table_ready = False

async def _ensure_review_table():
    global _review_table_ready
    if _review_table_ready:
        return
    db = await get_db()
    try:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS user_demand_reviews (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                demand_id INTEGER NOT NULL,
                action TEXT NOT NULL,
                reason TEXT DEFAULT '',
                note TEXT DEFAULT '',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, demand_id)
            )
        """)
        await db.execute("CREATE INDEX IF NOT EXISTS idx_udr_user ON user_demand_reviews(user_id)")
        await db.commit()
        _review_table_ready = True
    finally:
        await db.close()


@router.get("")
async def list_demands(
    stage: str = Query(None),
    track: str = Query(None),
    insight_layer: str = Query(None),
    agent_verdict: str = Query(None),
    min_score: float = Query(None),
    sort: str = Query("score_total"),
    limit: int = Query(50),
    offset: int = Query(0),
    exclude_reviewed: bool = Query(True),
    review_filter: str = Query(None),  # "approved" | "dismissed" | "unreviewed"
    user=Depends(get_current_user),
):
    await _ensure_review_table()
    db = await get_db()
    try:
        conditions = ["d.stage != 'dismissed'"]
        params = []

        # Review filter: show only approved / dismissed / unreviewed demands
        if review_filter and user:
            if review_filter == "approved":
                conditions.append(
                    "d.id IN (SELECT demand_id FROM user_demand_reviews WHERE user_id=? AND action='approved')"
                )
                params.append(user["id"])
            elif review_filter == "dismissed":
                conditions.append(
                    "d.id IN (SELECT demand_id FROM user_demand_reviews WHERE user_id=? AND action='dismissed')"
                )
                params.append(user["id"])
            elif review_filter == "unreviewed":
                conditions.append(
                    "d.id NOT IN (SELECT demand_id FROM user_demand_reviews WHERE user_id=?)"
                )
                params.append(user["id"])
        elif exclude_reviewed and user:
            # Default: exclude dismissed
            conditions.append(
                "d.id NOT IN (SELECT demand_id FROM user_demand_reviews WHERE user_id=? AND action='dismissed')"
            )
            params.append(user["id"])
        if stage:
            conditions.append("d.stage = ?")
            params.append(stage)
        if track:
            conditions.append("d.track = ?")
            params.append(track)
        if insight_layer:
            conditions.append("COALESCE(d.insight_layer, 'conventional') = ?")
            params.append(insight_layer)
        if agent_verdict:
            conditions.append("d.agent_verdict = ?")
            params.append(agent_verdict)
        if min_score is not None:
            conditions.append("d.score_total >= ?")
            params.append(min_score)

        where = " WHERE " + " AND ".join(conditions) if conditions else ""
        allowed_sorts = ["score_total", "score_pain", "score_ai_opportunity", "created_at"]
        order = sort if sort in allowed_sorts else "score_total"

        cur = await db.execute(
            f"SELECT d.* FROM demands d{where} ORDER BY d.{order} DESC LIMIT ? OFFSET ?",
            params + [limit, offset],
        )
        rows = await cur.fetchall()

        cur2 = await db.execute(f"SELECT COUNT(*) FROM demands d{where}", params)
        total = (await cur2.fetchone())[0]

        return {"demands": [dict(r) for r in rows], "total": total}
    finally:
        await db.close()


@router.get("/my-reviewed-ids")
async def my_reviewed_ids(user=Depends(get_current_user)):
    """Get list of demand IDs this user has already reviewed."""
    await _ensure_review_table()
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT demand_id FROM user_demand_reviews WHERE user_id=?",
            (user["id"],),
        )
        rows = await cur.fetchall()
        return {"ids": [r["demand_id"] for r in rows]}
    finally:
        await db.close()


@router.get("/{demand_id}")
async def get_demand(demand_id: int):
    db = await get_db()
    try:
        cur = await db.execute("SELECT * FROM demands WHERE id = ?", (demand_id,))
        row = await cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="需求不存在")
        return dict(row)
    finally:
        await db.close()


@router.patch("/{demand_id}")
async def update_demand(demand_id: int, data: DemandUpdate):
    db = await get_db()
    try:
        updates = []
        params = []
        for field, val in data.model_dump(exclude_none=True).items():
            updates.append(f"{field} = ?")
            params.append(val)
        if not updates:
            raise HTTPException(status_code=400, detail="没有需要更新的字段")
        updates.append("updated_at = CURRENT_TIMESTAMP")
        params.append(demand_id)
        await db.execute(
            f"UPDATE demands SET {', '.join(updates)} WHERE id = ?", params
        )
        await db.commit()

        # Learning signal: stage changes are implicit preference signals
        if data.stage:
            try:
                from api.agent import _memory
                if _memory:
                    vote = 1 if data.stage in ("filtered", "validated") else 0
                    if vote:
                        await _memory.store_feedback(
                            feedback_type="demand_stage",
                            target=str(demand_id),
                            vote=vote,
                            context={"new_stage": data.stage},
                        )
            except Exception:
                pass

        return {"status": "ok"}
    finally:
        await db.close()


class DismissRequest(BaseModel):
    reason: str
    note: Optional[str] = None


@router.post("/{demand_id}/dismiss")
async def dismiss_demand(demand_id: int, data: DismissRequest):
    """Dismiss a demand with a reason. Feeds into Cognee for learning."""
    db = await get_db()
    try:
        # Get demand info before dismissing (for learning context)
        cur = await db.execute("SELECT title, description, track FROM demands WHERE id=?", (demand_id,))
        row = await cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="需求不存在")
        demand_info = dict(row)

        # Record feedback with reason into Cognee
        try:
            from api.agent import _memory
            if _memory:
                await _memory.store_feedback(
                    feedback_type="demand_dismiss",
                    target=str(demand_id),
                    vote=-1,
                    context={
                        "reason": data.reason,
                        "note": data.note,
                        "title": demand_info["title"],
                        "description": demand_info.get("description", "")[:200],
                        "track": demand_info.get("track", ""),
                    },
                )
                # 改造二：分歧检测
                cur2 = await db.execute("SELECT agent_verdict FROM demands WHERE id=?", (demand_id,))
                verdict_row = await cur2.fetchone()
                if verdict_row and verdict_row["agent_verdict"] == "high_confidence":
                    await _memory.store_feedback(
                        feedback_type="agent_overconfidence",
                        target=str(demand_id),
                        vote=-1,
                        context={
                            "demand_id": demand_id,
                            "agent_verdict": "high_confidence",
                            "human_action": "dismissed",
                            "reason": data.reason,
                            "title": demand_info["title"],
                        },
                    )
        except Exception:
            pass

        # Also store in feedback table for persistence
        await db.execute(
            "INSERT INTO feedback (type, target_id, vote, note) VALUES (?, ?, ?, ?)",
            ("demand_dismiss", str(demand_id), -1, f"[{data.reason}] {data.note or ''}"),
        )

        # Mark as dismissed (soft delete via stage)
        await db.execute(
            "UPDATE demands SET stage='dismissed', updated_at=CURRENT_TIMESTAMP WHERE id=?",
            (demand_id,),
        )
        await db.commit()
        return {"status": "ok", "reason": data.reason}
    finally:
        await db.close()


class ReviewRequest(BaseModel):
    action: str  # "approved" | "dismissed"
    reason: Optional[str] = None
    note: Optional[str] = None


@router.post("/{demand_id}/review")
async def review_demand(demand_id: int, data: ReviewRequest, user=Depends(get_current_user)):
    """Per-user review: mark a demand as seen/approved/dismissed for this user only."""
    await _ensure_review_table()
    db = await get_db()
    try:
        await db.execute(
            """INSERT OR REPLACE INTO user_demand_reviews (user_id, demand_id, action, reason, note)
               VALUES (?, ?, ?, ?, ?)""",
            (user["id"], demand_id, data.action, data.reason or "", data.note or ""),
        )
        await db.commit()

        # Feed into memory + 改造二：分歧检测
        try:
            from api.agent import _memory
            if _memory:
                cur = await db.execute(
                    "SELECT title, description, agent_verdict FROM demands WHERE id=?",
                    (demand_id,),
                )
                row = await cur.fetchone()
                if row:
                    await _memory.store_feedback(
                        feedback_type=f"demand_{data.action}",
                        target=str(demand_id),
                        vote=1 if data.action == "approved" else -1,
                        context={
                            "reason": data.reason or "",
                            "title": row["title"],
                            "user_id": user["id"],
                        },
                    )

                    # 改造二：分歧检测 — Agent 自审 vs PM 终审 不一致时记录
                    agent_verdict = row["agent_verdict"] if row["agent_verdict"] else None
                    if agent_verdict:
                        if agent_verdict == "high_confidence" and data.action == "dismissed":
                            await _memory.store_feedback(
                                feedback_type="agent_overconfidence",
                                target=str(demand_id),
                                vote=-1,
                                context={
                                    "demand_id": demand_id,
                                    "agent_verdict": agent_verdict,
                                    "human_action": "dismissed",
                                    "reason": data.reason or "",
                                    "title": row["title"],
                                },
                            )
                        elif agent_verdict in ("low", "auto_reject") and data.action == "approved":
                            await _memory.store_feedback(
                                feedback_type="agent_underconfidence",
                                target=str(demand_id),
                                vote=1,
                                context={
                                    "demand_id": demand_id,
                                    "agent_verdict": agent_verdict,
                                    "human_action": "approved",
                                    "title": row["title"],
                                },
                            )
        except Exception:
            pass

        return {"status": "ok"}
    finally:
        await db.close()


@router.delete("/{demand_id}")
async def delete_demand(demand_id: int):
    # Learning signal: deletion is a rejection signal
    try:
        from api.agent import _memory
        if _memory:
            await _memory.store_feedback(
                feedback_type="demand_delete",
                target=str(demand_id),
                vote=-1,
                context={"action": "deleted"},
            )
    except Exception:
        pass

    db = await get_db()
    try:
        await db.execute("DELETE FROM demands WHERE id = ?", (demand_id,))
        await db.commit()
        return {"status": "ok"}
    finally:
        await db.close()
