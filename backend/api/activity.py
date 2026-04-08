from fastapi import APIRouter, Depends, Query
from database import get_db
from auth.deps import get_current_user

router = APIRouter()


@router.get("")
async def global_activity(
    limit: int = Query(50, le=200),
    user: dict = Depends(get_current_user),
):
    """Global activity feed - all projects the user can see."""
    db = await get_db()
    try:
        cur = await db.execute("""
            SELECT a.*, u.display_name, u.username, p.title as project_title
            FROM activity_log a
            LEFT JOIN users u ON a.user_id = u.id
            LEFT JOIN projects p ON a.project_id = p.id
            ORDER BY a.created_at DESC
            LIMIT ?
        """, (limit,))
        return [dict(r) for r in await cur.fetchall()]
    finally:
        await db.close()


@router.get("/project/{project_id}")
async def project_activity(
    project_id: int,
    limit: int = Query(50, le=200),
    user: dict = Depends(get_current_user),
):
    """Activity feed for a specific project."""
    db = await get_db()
    try:
        cur = await db.execute("""
            SELECT a.*, u.display_name, u.username
            FROM activity_log a
            LEFT JOIN users u ON a.user_id = u.id
            WHERE a.project_id = ?
            ORDER BY a.created_at DESC
            LIMIT ?
        """, (project_id, limit))
        return [dict(r) for r in await cur.fetchall()]
    finally:
        await db.close()
