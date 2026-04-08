"""
圆桌讨论 — 多方参与的持久化讨论面板。
参与者: 人类用户(human), Claude Code(claude_code), PM Agent(pm_agent), 系统(system)
所有消息持久化到 SQLite，支持关联项目上下文。
"""

import secrets
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks, Query, Request
from pydantic import BaseModel

import json
import re
import asyncio
import logging

from database import get_db
from auth.deps import get_current_user
from ai.client import client, OPENAI_MODEL

logger = logging.getLogger("roundtable")
router = APIRouter()
# Public router — no auth required, token-based access
open_router = APIRouter()


def _generate_token() -> str:
    """Generate a URL-safe invite token (24 chars)."""
    return secrets.token_urlsafe(18)  # 24 chars


# ── Pydantic Models ─────────────────────────────────────────────────────────


class CreateRoom(BaseModel):
    title: str
    topic: str = ""
    project_id: Optional[int] = None


class PostMessage(BaseModel):
    content: str
    sender_type: str = "human"  # human / claude_code / pm_agent / system
    sender_name: str = ""
    reply_to_id: Optional[int] = None  # ID of message being replied to


class OpenPostMessage(BaseModel):
    """Token-based message posting — no user auth needed."""
    content: str
    sender_type: str = "agent"  # agent / claude_code / system / custom
    sender_name: str = ""
    reply_to_id: Optional[int] = None


# ── Table bootstrap ─────────────────────────────────────────────────────────

ROUNDTABLE_SCHEMA = """
CREATE TABLE IF NOT EXISTS roundtable_rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    topic TEXT DEFAULT '',
    project_id INTEGER,
    status TEXT DEFAULT 'active',
    created_by INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS roundtable_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER NOT NULL REFERENCES roundtable_rooms(id),
    sender_type TEXT NOT NULL DEFAULT 'human',
    sender_name TEXT DEFAULT '',
    user_id INTEGER,
    content TEXT NOT NULL,
    metadata TEXT DEFAULT '{}',
    reply_to_id INTEGER DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
"""


async def ensure_tables():
    """确保圆桌讨论表已创建。"""
    db = await get_db()
    try:
        for stmt in ROUNDTABLE_SCHEMA.strip().split(";"):
            stmt = stmt.strip()
            if stmt:
                await db.execute(stmt)
        # Migration: add reply_to_id if missing
        try:
            await db.execute("SELECT reply_to_id FROM roundtable_messages LIMIT 1")
        except Exception:
            await db.execute("ALTER TABLE roundtable_messages ADD COLUMN reply_to_id INTEGER DEFAULT NULL")
        await db.commit()
    finally:
        await db.close()


# ── AI multi-turn helper ────────────────────────────────────────────────────

async def _ai_chat(messages: list[dict], temperature: float = 0.7) -> str:
    """Multi-turn AI chat, mirrors discussions.py pattern."""
    try:
        resp = await client.chat.completions.create(
            model=OPENAI_MODEL,
            messages=messages,
            temperature=temperature,
        )
        return resp.choices[0].message.content or ""
    except Exception as e:
        logger.error(f"Roundtable AI call failed: {e}", exc_info=True)
        return f"[AI Error] {str(e)}"


# ── PM Agent background response ────────────────────────────────────────────

async def _trigger_pm_response(room_id: int):
    """Load context, call AI, insert PM Agent reply into the room."""
    db = await get_db()
    try:
        # Load last 30 messages
        cur = await db.execute(
            """SELECT sender_type, sender_name, content
               FROM roundtable_messages
               WHERE room_id = ?
               ORDER BY created_at DESC LIMIT 30""",
            (room_id,),
        )
        rows = await cur.fetchall()
        recent = list(reversed([dict(r) for r in rows]))

        # Load room info
        cur = await db.execute(
            "SELECT * FROM roundtable_rooms WHERE id = ?", (room_id,)
        )
        room = await cur.fetchone()
        if not room:
            return
        room = dict(room)

        # If room has project_id, load project info
        project_context = ""
        if room.get("project_id"):
            cur = await db.execute(
                "SELECT id, title, description, current_stage FROM projects WHERE id = ?",
                (room["project_id"],),
            )
            proj = await cur.fetchone()
            if proj:
                proj = dict(proj)
                project_context = (
                    f"\n## 关联项目\n"
                    f"- 项目名称: {proj['title']}\n"
                    f"- 当前阶段: {proj.get('current_stage', '未知')}\n"
                    f"- 描述: {proj.get('description', '无')}\n"
                )

        # Load methodologies for context
        methodology_context = ""
        try:
            from agent.dreaming import get_methodologies
            meths = get_methodologies()
            if meths:
                meth_lines = [f"- {m['title']}: {m['content']}" for m in meths[:10]]
                methodology_context = "\n## 你积累的方法论（用这些指导你的回答）\n" + "\n".join(meth_lines) + "\n"
        except Exception:
            pass

        # Build system prompt
        system_prompt = (
            "你是PM Agent，一位产品经理AI助手，正在参与圆桌讨论。"
            "讨论中有多位参与者：人类用户(human)、Claude Code(claude_code)、PM Agent(pm_agent)和系统(system)。\n"
            f"讨论主题: {room.get('title', '无主题')}\n"
            f"话题描述: {room.get('topic', '')}\n"
            f"{project_context}"
            f"{methodology_context}\n"
            "请基于讨论上下文和你积累的方法论提供专业的产品分析和建议。回答要简洁、有洞察力。"
            "如果被@提及，请直接回应提问者的问题。"
        )

        # Build message history — map sender_types to OpenAI roles
        ai_messages: list[dict] = [{"role": "system", "content": system_prompt}]
        for msg in recent:
            if msg["sender_type"] == "pm_agent":
                role = "assistant"
            else:
                # human, claude_code, system all become user messages with name prefix
                name_tag = msg.get("sender_name") or msg["sender_type"]
                role = "user"
                content = f"[{name_tag}]: {msg['content']}"
                ai_messages.append({"role": role, "content": content})
                continue
            ai_messages.append({"role": role, "content": msg["content"]})

        # Call AI
        ai_reply = await _ai_chat(ai_messages)

        # Insert response
        now = datetime.now().isoformat()
        await db.execute(
            """INSERT INTO roundtable_messages
               (room_id, sender_type, sender_name, user_id, content, created_at)
               VALUES (?, 'pm_agent', 'PM Agent', NULL, ?, ?)""",
            (room_id, ai_reply, now),
        )
        await db.execute(
            "UPDATE roundtable_rooms SET updated_at = ? WHERE id = ?",
            (now, room_id),
        )
        await db.commit()
        logger.info(f"PM Agent responded in room {room_id}")

        # ── Auto-memory: extract learnings from roundtable discussion ──
        try:
            # Build conversation snippet for memory extraction (last few messages)
            convo_lines = []
            for msg in recent[-6:]:
                name_tag = msg.get("sender_name") or msg["sender_type"]
                convo_lines.append(f"[{name_tag}]: {msg['content'][:300]}")
            convo_lines.append(f"[PM Agent]: {ai_reply[:500]}")
            convo_text = "\n".join(convo_lines)

            room_title = room.get("title", "圆桌讨论")
            mem_prompt = f"""回顾这段圆桌讨论，提取值得长期记住的内容。只提取以下类型：
- decision: 团队做出的决策（做/不做某事）
- preference: 用户偏好或方向倾向
- insight: 产品/市场洞察
- feedback: 对AI行为的反馈
- context: 重要的项目背景信息

圆桌主题: {room_title}
{project_context}
最近对话:
{convo_text}

如果有值得记住的，返回JSON: {{"memories": [{{"content": "...", "category": "decision|preference|insight|feedback|context"}}]}}
如果没有，返回: {{"memories": []}}
只返回JSON，不要其他文字。"""

            mem_resp = await _ai_chat(
                [
                    {"role": "system", "content": "你是记忆提取助手。从圆桌讨论中提取值得长期记住的内容，输出纯 JSON。"},
                    {"role": "user", "content": mem_prompt},
                ],
                temperature=0.1,
            )
            json_match = re.search(r'\{.*\}', mem_resp, re.DOTALL)
            if json_match:
                mem_data = json.loads(json_match.group())
                memories = mem_data.get("memories", [])
                if memories:
                    from agent.tools import _remember
                    for m in memories[:3]:
                        content = f"[圆桌:{room_title}] {m.get('content', '')}"
                        await _remember(content, m.get("category", "insight"))
                    logger.info(f"Extracted {len(memories[:3])} memories from roundtable room {room_id}")
        except Exception as e:
            logger.debug(f"Auto-memory extraction failed for roundtable room {room_id}: {e}")

    except Exception as e:
        logger.error(f"PM Agent response failed for room {room_id}: {e}", exc_info=True)
    finally:
        await db.close()


# ── POST /roundtable/rooms — create room ────────────────────────────────────

@router.post("/rooms")
async def create_room(
    body: CreateRoom,
    user: dict = Depends(get_current_user),
):
    await ensure_tables()
    db = await get_db()
    try:
        now = datetime.now().isoformat()
        token = _generate_token()
        cur = await db.execute(
            """INSERT INTO roundtable_rooms
               (title, topic, project_id, created_by, invite_token, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (body.title, body.topic, body.project_id, user["id"], token, now, now),
        )
        room_id = cur.lastrowid
        await db.commit()

        return {
            "id": room_id,
            "title": body.title,
            "topic": body.topic,
            "project_id": body.project_id,
            "created_by": user["id"],
            "status": "active",
            "invite_token": token,
            "created_at": now,
            "updated_at": now,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"创建房间失败: {str(e)}")
    finally:
        await db.close()


# ── GET /roundtable/rooms — list rooms ───────────────────────────────────────

@router.get("/rooms")
async def list_rooms(
    project_id: Optional[int] = Query(None),
    include_archived: bool = Query(False),
    user: dict = Depends(get_current_user),
):
    await ensure_tables()
    db = await get_db()
    try:
        conditions = []
        params = []

        if not include_archived:
            conditions.append("r.status = 'active'")
        if project_id is not None:
            conditions.append("r.project_id = ?")
            params.append(project_id)

        where_clause = ""
        if conditions:
            where_clause = "WHERE " + " AND ".join(conditions)

        cur = await db.execute(
            f"""SELECT
                  r.id, r.title, r.topic, r.project_id,
                  r.status, r.created_by, r.created_at, r.updated_at,
                  (SELECT COUNT(*) FROM roundtable_messages m WHERE m.room_id = r.id)
                      AS message_count,
                  (SELECT m2.content FROM roundtable_messages m2
                   WHERE m2.room_id = r.id ORDER BY m2.created_at DESC LIMIT 1)
                      AS last_message,
                  (SELECT m3.created_at FROM roundtable_messages m3
                   WHERE m3.room_id = r.id ORDER BY m3.created_at DESC LIMIT 1)
                      AS last_message_at,
                  (SELECT GROUP_CONCAT(DISTINCT m4.sender_type)
                   FROM roundtable_messages m4 WHERE m4.room_id = r.id)
                      AS participants
                FROM roundtable_rooms r
                {where_clause}
                ORDER BY COALESCE(
                    (SELECT m5.created_at FROM roundtable_messages m5
                     WHERE m5.room_id = r.id ORDER BY m5.created_at DESC LIMIT 1),
                    r.created_at
                ) DESC""",
            tuple(params),
        )
        rows = await cur.fetchall()
        return [dict(r) for r in rows]
    finally:
        await db.close()


# ── GET /roundtable/rooms/{room_id} — get room + messages ───────────────────

@router.get("/rooms/{room_id}")
async def get_room(
    room_id: int,
    limit: int = Query(100, ge=1, le=500),
    before_id: Optional[int] = Query(None),
    user: dict = Depends(get_current_user),
):
    await ensure_tables()
    db = await get_db()
    try:
        # Get room
        cur = await db.execute(
            "SELECT * FROM roundtable_rooms WHERE id = ?", (room_id,)
        )
        room = await cur.fetchone()
        if not room:
            raise HTTPException(status_code=404, detail="圆桌房间不存在")

        # Get messages with pagination
        if before_id is not None:
            cur = await db.execute(
                """SELECT m.id, m.room_id, m.sender_type, m.sender_name, m.user_id,
                          m.content, m.metadata, m.reply_to_id, m.created_at,
                          r.sender_name AS reply_to_name, r.content AS reply_to_content,
                          r.sender_type AS reply_to_sender_type
                   FROM roundtable_messages m
                   LEFT JOIN roundtable_messages r ON m.reply_to_id = r.id
                   WHERE m.room_id = ? AND m.id < ?
                   ORDER BY m.created_at DESC
                   LIMIT ?""",
                (room_id, before_id, limit),
            )
        else:
            cur = await db.execute(
                """SELECT m.id, m.room_id, m.sender_type, m.sender_name, m.user_id,
                          m.content, m.metadata, m.reply_to_id, m.created_at,
                          r.sender_name AS reply_to_name, r.content AS reply_to_content,
                          r.sender_type AS reply_to_sender_type
                   FROM roundtable_messages m
                   LEFT JOIN roundtable_messages r ON m.reply_to_id = r.id
                   WHERE m.room_id = ?
                   ORDER BY m.created_at DESC
                   LIMIT ?""",
                (room_id, limit),
            )
        messages = await cur.fetchall()
        messages_list = []
        for m in reversed(list(messages)):
            d = dict(m)
            # Build reply_to object if present
            if d.get("reply_to_id"):
                d["reply_to"] = {
                    "id": d["reply_to_id"],
                    "sender_name": d.pop("reply_to_name", ""),
                    "content": (d.pop("reply_to_content", "") or "")[:100],
                    "sender_type": d.pop("reply_to_sender_type", ""),
                }
            else:
                d.pop("reply_to_name", None)
                d.pop("reply_to_content", None)
                d.pop("reply_to_sender_type", None)
                d["reply_to"] = None
            messages_list.append(d)
        messages = messages_list  # 按时间正序返回

        result = dict(room)
        result["messages"] = messages
        # Ensure invite_token is present (generate for legacy rooms)
        if not result.get("invite_token"):
            token = _generate_token()
            await db.execute(
                "UPDATE roundtable_rooms SET invite_token = ? WHERE id = ? AND invite_token IS NULL",
                (token, room_id),
            )
            await db.commit()
            result["invite_token"] = token
        return result
    finally:
        await db.close()


# ── POST /roundtable/rooms/{room_id}/messages — post message ────────────────

@router.post("/rooms/{room_id}/messages")
async def post_message(
    room_id: int,
    body: PostMessage,
    background_tasks: BackgroundTasks,
    user: dict = Depends(get_current_user),
):
    await ensure_tables()
    db = await get_db()
    try:
        # Verify room exists
        cur = await db.execute(
            "SELECT id, status FROM roundtable_rooms WHERE id = ?", (room_id,)
        )
        room = await cur.fetchone()
        if not room:
            raise HTTPException(status_code=404, detail="圆桌房间不存在")
        if room["status"] == "archived":
            raise HTTPException(status_code=400, detail="房间已归档，无法发送消息")

        now = datetime.now().isoformat()

        # Determine sender info
        sender_type = body.sender_type
        sender_name = body.sender_name
        user_id = None

        if sender_type == "human":
            sender_name = user.get("display_name") or user.get("username", "用户")
            user_id = user["id"]
        elif sender_type == "claude_code":
            sender_name = sender_name or "Claude Code"
        elif sender_type == "pm_agent":
            sender_name = sender_name or "PM Agent"
        elif sender_type == "system":
            sender_name = sender_name or "系统"

        # Insert message
        cur = await db.execute(
            """INSERT INTO roundtable_messages
               (room_id, sender_type, sender_name, user_id, content, reply_to_id, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (room_id, sender_type, sender_name, user_id, body.content, body.reply_to_id, now),
        )
        msg_id = cur.lastrowid

        # Update room updated_at
        await db.execute(
            "UPDATE roundtable_rooms SET updated_at = ? WHERE id = ?",
            (now, room_id),
        )
        await db.commit()

        # Check for @pm_agent / @PM / @pm mention → trigger PM Agent background response
        if re.search(r"@(pm_agent|PM|pm)\b", body.content):
            background_tasks.add_task(_trigger_pm_response, room_id)

        return {
            "id": msg_id,
            "room_id": room_id,
            "sender_type": sender_type,
            "sender_name": sender_name,
            "user_id": user_id,
            "content": body.content,
            "reply_to_id": body.reply_to_id,
            "created_at": now,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"发送消息失败: {str(e)}")
    finally:
        await db.close()


# ── POST /roundtable/rooms/{room_id}/archive — archive room ─────────────────

@router.post("/rooms/{room_id}/archive")
async def archive_room(
    room_id: int,
    user: dict = Depends(get_current_user),
):
    await ensure_tables()
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT id FROM roundtable_rooms WHERE id = ?", (room_id,)
        )
        if not await cur.fetchone():
            raise HTTPException(status_code=404, detail="圆桌房间不存在")

        now = datetime.now().isoformat()
        await db.execute(
            "UPDATE roundtable_rooms SET status = 'archived', updated_at = ? WHERE id = ?",
            (now, room_id),
        )
        await db.commit()
        return {"ok": True, "room_id": room_id, "status": "archived"}
    finally:
        await db.close()


# ── GET /roundtable/rooms/{room_id}/summary — AI-generated summary ──────────

@router.get("/rooms/{room_id}/summary")
async def get_room_summary(
    room_id: int,
    user: dict = Depends(get_current_user),
):
    await ensure_tables()
    db = await get_db()
    try:
        # Verify room exists
        cur = await db.execute(
            "SELECT * FROM roundtable_rooms WHERE id = ?", (room_id,)
        )
        room = await cur.fetchone()
        if not room:
            raise HTTPException(status_code=404, detail="圆桌房间不存在")
        room = dict(room)

        # Load all messages
        cur = await db.execute(
            """SELECT sender_type, sender_name, content, created_at
               FROM roundtable_messages
               WHERE room_id = ?
               ORDER BY created_at ASC""",
            (room_id,),
        )
        messages = [dict(r) for r in await cur.fetchall()]

        if not messages:
            return {"room_id": room_id, "summary": "暂无消息，无法生成摘要。"}

        # Build transcript for AI
        transcript_lines = []
        for msg in messages:
            name = msg.get("sender_name") or msg["sender_type"]
            transcript_lines.append(f"[{name}]: {msg['content']}")
        transcript = "\n".join(transcript_lines)

        system_prompt = (
            "你是一位专业的会议纪要助手。请根据以下圆桌讨论记录，生成结构化的讨论摘要。\n"
            "输出格式:\n"
            "## 讨论摘要\n"
            "（一句话概述讨论主题和结论）\n\n"
            "## 关键决策\n"
            "- （列出讨论中做出的决策）\n\n"
            "## 行动项\n"
            "- （列出需要跟进的行动项，标注负责人）\n\n"
            "## 待解决问题\n"
            "- （列出尚未解决的开放性问题）\n"
        )

        user_prompt = (
            f"讨论主题: {room.get('title', '无主题')}\n"
            f"话题描述: {room.get('topic', '')}\n\n"
            f"讨论记录:\n{transcript}"
        )

        summary = await _ai_chat([
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ])

        # Persist summary as a system message
        now = datetime.now().isoformat()
        await db.execute(
            """INSERT INTO roundtable_messages
               (room_id, sender_type, sender_name, user_id, content, metadata, created_at)
               VALUES (?, 'system', '系统', NULL, ?, '{"type":"summary"}', ?)""",
            (room_id, summary, now),
        )
        await db.execute(
            "UPDATE roundtable_rooms SET updated_at = ? WHERE id = ?",
            (now, room_id),
        )
        await db.commit()

        # ── Auto-memory: extract from summary ──
        try:
            mem_prompt = f"""从以下圆桌讨论摘要中，提取值得长期记住的关键决策和洞察。

圆桌主题: {room.get('title', '')}
摘要:
{summary[:1500]}

返回JSON: {{"memories": [{{"content": "...", "category": "decision|insight|context"}}]}}
如果没有值得记住的，返回: {{"memories": []}}
只返回JSON。"""

            mem_resp = await _ai_chat(
                [
                    {"role": "system", "content": "你是记忆提取助手。从讨论摘要中提取关键决策和洞察，输出纯 JSON。"},
                    {"role": "user", "content": mem_prompt},
                ],
                temperature=0.1,
            )
            json_match = re.search(r'\{.*\}', mem_resp, re.DOTALL)
            if json_match:
                mem_data = json.loads(json_match.group())
                memories = mem_data.get("memories", [])
                if memories:
                    from agent.tools import _remember
                    room_title = room.get("title", "圆桌讨论")
                    for m in memories[:5]:
                        content = f"[圆桌摘要:{room_title}] {m.get('content', '')}"
                        await _remember(content, m.get("category", "insight"))
                    logger.info(f"Extracted {len(memories[:5])} memories from roundtable summary, room {room_id}")
        except Exception as e:
            logger.debug(f"Auto-memory from summary failed for room {room_id}: {e}")

        return {
            "room_id": room_id,
            "title": room.get("title"),
            "summary": summary,
            "message_count": len(messages),
            "generated_at": now,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"生成摘要失败: {str(e)}")
    finally:
        await db.close()


# ═══════════════════════════════════════════════════════════════════════════════
# OPEN API — Token-based access, no user auth required
# External agents use: /api/roundtable/open/{token}/...
# ═══════════════════════════════════════════════════════════════════════════════


async def _get_room_by_token(token: str):
    """Lookup room by invite_token. Returns room dict or raises 404/403."""
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT * FROM roundtable_rooms WHERE invite_token = ?", (token,)
        )
        room = await cur.fetchone()
        if not room:
            raise HTTPException(status_code=404, detail="无效的邀请链接")
        room = dict(room)
        if room["status"] == "archived":
            raise HTTPException(status_code=403, detail="房间已归档")
        return room
    finally:
        await db.close()


@open_router.get("/{token}/info")
async def open_room_info(token: str):
    """获取圆桌房间基本信息（无需登录）。"""
    room = await _get_room_by_token(token)
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT COUNT(*) as cnt FROM roundtable_messages WHERE room_id = ?",
            (room["id"],),
        )
        row = await cur.fetchone()
        return {
            "room_id": room["id"],
            "title": room["title"],
            "topic": room["topic"],
            "project_id": room["project_id"],
            "status": room["status"],
            "message_count": row["cnt"] if row else 0,
            "created_at": room["created_at"],
        }
    finally:
        await db.close()


@open_router.get("/{token}/messages")
async def open_room_messages(
    token: str,
    limit: int = Query(50, ge=1, le=200),
    after_id: int = Query(0, ge=0),
):
    """读取圆桌消息（无需登录）。支持 after_id 用于增量拉取。"""
    room = await _get_room_by_token(token)
    db = await get_db()
    try:
        if after_id > 0:
            cur = await db.execute(
                """SELECT id, room_id, sender_type, sender_name, content, metadata, created_at
                   FROM roundtable_messages
                   WHERE room_id = ? AND id > ?
                   ORDER BY created_at ASC
                   LIMIT ?""",
                (room["id"], after_id, limit),
            )
        else:
            cur = await db.execute(
                """SELECT id, room_id, sender_type, sender_name, content, metadata, created_at
                   FROM roundtable_messages
                   WHERE room_id = ?
                   ORDER BY created_at DESC
                   LIMIT ?""",
                (room["id"], limit),
            )
        messages = [dict(r) for r in await cur.fetchall()]
        if after_id == 0:
            messages.reverse()  # 无 after_id 时返回最新 N 条，按时间正序
        return {
            "room_id": room["id"],
            "title": room["title"],
            "messages": messages,
        }
    finally:
        await db.close()


@open_router.post("/{token}/messages")
async def open_post_message(
    token: str,
    body: OpenPostMessage,
    background_tasks: BackgroundTasks,
):
    """向圆桌发送消息（无需登录，token 鉴权）。"""
    room = await _get_room_by_token(token)
    db = await get_db()
    try:
        now = datetime.now().isoformat()

        sender_type = body.sender_type or "agent"
        sender_name = body.sender_name or sender_type

        cur = await db.execute(
            """INSERT INTO roundtable_messages
               (room_id, sender_type, sender_name, user_id, content, reply_to_id, created_at)
               VALUES (?, ?, ?, NULL, ?, ?, ?)""",
            (room["id"], sender_type, sender_name, body.content, body.reply_to_id, now),
        )
        msg_id = cur.lastrowid

        await db.execute(
            "UPDATE roundtable_rooms SET updated_at = ? WHERE id = ?",
            (now, room["id"]),
        )
        await db.commit()

        # @pm_agent mention triggers PM Agent
        if re.search(r"@(pm_agent|PM|pm)\b", body.content):
            background_tasks.add_task(_trigger_pm_response, room["id"])

        return {
            "id": msg_id,
            "room_id": room["id"],
            "sender_type": sender_type,
            "sender_name": sender_name,
            "content": body.content,
            "reply_to_id": body.reply_to_id,
            "created_at": now,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"发送消息失败: {str(e)}")
    finally:
        await db.close()


@open_router.post("/{token}/pm")
async def open_ask_pm(
    token: str,
    body: OpenPostMessage,
    background_tasks: BackgroundTasks,
):
    """发送消息并自动 @PM Agent 获取回复（无需登录）。
    方便外部 agent 一步到位：发消息 + 触发 PM Agent 回复。"""
    room = await _get_room_by_token(token)
    db = await get_db()
    try:
        now = datetime.now().isoformat()
        sender_type = body.sender_type or "agent"
        sender_name = body.sender_name or sender_type

        # Insert the message
        cur = await db.execute(
            """INSERT INTO roundtable_messages
               (room_id, sender_type, sender_name, user_id, content, created_at)
               VALUES (?, ?, ?, NULL, ?, ?)""",
            (room["id"], sender_type, sender_name, body.content, now),
        )
        msg_id = cur.lastrowid

        await db.execute(
            "UPDATE roundtable_rooms SET updated_at = ? WHERE id = ?",
            (now, room["id"]),
        )
        await db.commit()

        # Always trigger PM Agent response
        background_tasks.add_task(_trigger_pm_response, room["id"])

        return {
            "id": msg_id,
            "room_id": room["id"],
            "sender_type": sender_type,
            "sender_name": sender_name,
            "content": body.content,
            "pm_agent_triggered": True,
            "created_at": now,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"发送消息失败: {str(e)}")
    finally:
        await db.close()
