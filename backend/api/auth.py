"""
用户认证 API
POST /api/auth/register   注册
POST /api/auth/login      登录
POST /api/auth/refresh    刷新令牌
GET  /api/auth/me         当前用户信息
PATCH /api/auth/me        更新资料
GET  /api/auth/users      用户列表（admin）
PATCH /api/auth/users/{id} 修改用户角色/状态（admin）
"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from database import get_db
from auth.password import hash_password, verify_password
from auth.jwt import create_access_token, create_refresh_token, verify_token
from auth.deps import get_current_user, require_admin

router = APIRouter()


# ── Pydantic models ──────────────────────────────────────────────────────

class RegisterRequest(BaseModel):
    username: str
    password: str
    display_name: str = ""
    email: str | None = None


class LoginRequest(BaseModel):
    username: str
    password: str


class RefreshRequest(BaseModel):
    refresh_token: str


class UpdateProfileRequest(BaseModel):
    display_name: str | None = None
    avatar_url: str | None = None
    email: str | None = None


class UpdateUserRequest(BaseModel):
    role: str | None = None
    is_active: bool | None = None


# ── Routes ────────────────────────────────────────────────────────────────

@router.post("/register")
async def register(req: RegisterRequest):
    if len(req.username) < 2:
        raise HTTPException(400, "用户名至少2个字符")
    if len(req.password) < 4:
        raise HTTPException(400, "密码至少4个字符")

    db = await get_db()
    try:
        # First user becomes admin
        cur = await db.execute("SELECT COUNT(*) as cnt FROM users")
        row = await cur.fetchone()
        is_first = row["cnt"] == 0
        role = "admin" if is_first else "member"

        display_name = req.display_name or req.username
        pwd_hash = hash_password(req.password)

        try:
            await db.execute(
                "INSERT INTO users (username, display_name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)",
                (req.username, display_name, req.email, pwd_hash, role),
            )
            await db.commit()
        except Exception as e:
            import traceback
            traceback.print_exc()
            raise HTTPException(400, f"注册失败: {str(e)}")

        cur = await db.execute("SELECT id FROM users WHERE username = ?", (req.username,))
        user = await cur.fetchone()

        access = create_access_token(user["id"], role)
        refresh = create_refresh_token(user["id"])
        return {
            "access_token": access,
            "refresh_token": refresh,
            "user": {
                "id": user["id"],
                "username": req.username,
                "display_name": display_name,
                "role": role,
            },
        }
    finally:
        await db.close()


@router.post("/login")
async def login(req: LoginRequest):
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT id, username, display_name, email, avatar_url, role, is_active, password_hash FROM users WHERE username = ?",
            (req.username,),
        )
        user = await cur.fetchone()
        if not user:
            raise HTTPException(401, "用户名或密码错误")
        if not user["is_active"]:
            raise HTTPException(403, "账号已被禁用")
        if not verify_password(req.password, user["password_hash"]):
            raise HTTPException(401, "用户名或密码错误")

        await db.execute(
            "UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?",
            (user["id"],),
        )
        await db.commit()

        access = create_access_token(user["id"], user["role"])
        refresh = create_refresh_token(user["id"])
        return {
            "access_token": access,
            "refresh_token": refresh,
            "user": {
                "id": user["id"],
                "username": user["username"],
                "display_name": user["display_name"],
                "email": user["email"],
                "avatar_url": user["avatar_url"],
                "role": user["role"],
            },
        }
    finally:
        await db.close()


@router.post("/refresh")
async def refresh(req: RefreshRequest):
    payload = verify_token(req.refresh_token)
    if not payload or payload.get("type") != "refresh":
        raise HTTPException(401, "无效的刷新令牌")

    user_id = int(payload["sub"])
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT id, role, is_active FROM users WHERE id = ?", (user_id,)
        )
        user = await cur.fetchone()
        if not user or not user["is_active"]:
            raise HTTPException(401, "用户不存在或已禁用")

        access = create_access_token(user["id"], user["role"])
        return {"access_token": access}
    finally:
        await db.close()


@router.get("/me")
async def me(user: dict = Depends(get_current_user)):
    return user


@router.patch("/me")
async def update_me(req: UpdateProfileRequest, user: dict = Depends(get_current_user)):
    updates = []
    values = []
    if req.display_name is not None:
        updates.append("display_name = ?")
        values.append(req.display_name)
    if req.avatar_url is not None:
        updates.append("avatar_url = ?")
        values.append(req.avatar_url)
    if req.email is not None:
        updates.append("email = ?")
        values.append(req.email)

    if not updates:
        return user

    values.append(user["id"])
    db = await get_db()
    try:
        await db.execute(
            f"UPDATE users SET {', '.join(updates)} WHERE id = ?", values
        )
        await db.commit()
        cur = await db.execute(
            "SELECT id, username, display_name, email, avatar_url, role FROM users WHERE id = ?",
            (user["id"],),
        )
        return dict(await cur.fetchone())
    finally:
        await db.close()


@router.get("/users")
async def list_users(_: dict = Depends(require_admin)):
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT id, username, display_name, email, avatar_url, role, is_active, last_login_at, created_at FROM users ORDER BY created_at"
        )
        return [dict(r) for r in await cur.fetchall()]
    finally:
        await db.close()


@router.patch("/users/{user_id}")
async def update_user(user_id: int, req: UpdateUserRequest, _: dict = Depends(require_admin)):
    updates = []
    values = []
    if req.role is not None:
        if req.role not in ("admin", "member"):
            raise HTTPException(400, "角色只能是 admin 或 member")
        updates.append("role = ?")
        values.append(req.role)
    if req.is_active is not None:
        updates.append("is_active = ?")
        values.append(1 if req.is_active else 0)

    if not updates:
        return {"ok": True}

    values.append(user_id)
    db = await get_db()
    try:
        await db.execute(f"UPDATE users SET {', '.join(updates)} WHERE id = ?", values)
        await db.commit()
        return {"ok": True}
    finally:
        await db.close()
