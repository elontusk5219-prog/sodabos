"""Shared database helper functions."""

from fastapi import HTTPException


async def get_or_404(db, table: str, id_val: int, *, id_col: str = "id", message: str = ""):
    """Fetch a row by ID or raise 404."""
    cur = await db.execute(f"SELECT * FROM {table} WHERE {id_col} = ?", (id_val,))
    row = await cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail=message or f"{table} #{id_val} not found")
    return dict(row)
