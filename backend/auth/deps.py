from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from auth.jwt import verify_token
from database import get_db

_security = HTTPBearer(auto_error=False)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_security),
):
    if credentials is None:
        raise HTTPException(status_code=401, detail="未提供认证令牌")

    payload = verify_token(credentials.credentials)
    if not payload or payload.get("type") != "access":
        raise HTTPException(status_code=401, detail="无效或过期的令牌")

    user_id = int(payload["sub"])
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT id, username, display_name, email, avatar_url, role, is_active FROM users WHERE id = ?",
            (user_id,),
        )
        user = await cur.fetchone()
    finally:
        await db.close()

    if not user or not user["is_active"]:
        raise HTTPException(status_code=401, detail="用户不存在或已禁用")

    return dict(user)


async def get_current_user_optional(
    credentials: HTTPAuthorizationCredentials | None = Depends(_security),
):
    """Same as get_current_user but returns None instead of 401."""
    if credentials is None:
        return None
    try:
        return await get_current_user(credentials)
    except HTTPException:
        return None


async def require_admin(user: dict = Depends(get_current_user)):
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="需要管理员权限")
    return user
