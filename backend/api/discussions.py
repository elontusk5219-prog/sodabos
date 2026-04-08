"""
讨论系统 API
GET    /projects/{pid}/discussions                  列出讨论主题
POST   /projects/{pid}/discussions                  新建讨论主题
GET    /projects/{pid}/discussions/{tid}             获取主题及消息
POST   /projects/{pid}/discussions/{tid}/messages    发送消息
POST   /projects/{pid}/discussions/{tid}/ai          发送消息并获取 AI 回复
"""

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends
from starlette.responses import StreamingResponse
from pydantic import BaseModel

import json as _json
import logging
import re

from auth.deps import get_current_user
from database import get_db
from ai.client import client, OPENAI_MODEL
from project_knowledge import retrieve_combined_context

logger = logging.getLogger("discussions")

router = APIRouter()


# ── Pydantic 模型 ────────────────────────────────────────────────────────────

class ThreadCreate(BaseModel):
    title: str
    document_id: Optional[int] = None
    thread_type: str = "general"


class MessageCreate(BaseModel):
    content: str


# ── AI 多轮对话 ──────────────────────────────────────────────────────────────

async def _ai_chat(messages: list[dict], temperature: float = 0.7) -> str:
    try:
        resp = await client.chat.completions.create(
            model=OPENAI_MODEL,
            messages=messages,
            temperature=temperature,
        )
        return resp.choices[0].message.content or ""
    except Exception as e:
        return f"[AI Error] {str(e)}"


# ── GET /projects/{pid}/discussions ───────────────────────────────────────────

@router.get("/projects/{pid}/discussions")
async def list_threads(
    pid: int,
    user: dict = Depends(get_current_user),
):
    db = await get_db()
    try:
        cur = await db.execute(
            """SELECT
                 t.id, t.title, t.thread_type, t.document_id,
                 t.is_archived, t.created_at, t.updated_at,
                 t.created_by,
                 u.display_name AS creator_name,
                 (SELECT COUNT(*) FROM discussion_messages m WHERE m.thread_id = t.id) AS message_count,
                 (SELECT m2.content FROM discussion_messages m2
                  WHERE m2.thread_id = t.id ORDER BY m2.created_at DESC LIMIT 1) AS last_message,
                 (SELECT m3.created_at FROM discussion_messages m3
                  WHERE m3.thread_id = t.id ORDER BY m3.created_at DESC LIMIT 1) AS last_message_at
               FROM discussion_threads t
               LEFT JOIN users u ON u.id = t.created_by
               WHERE t.project_id = ?
               ORDER BY COALESCE(
                   (SELECT m4.created_at FROM discussion_messages m4
                    WHERE m4.thread_id = t.id ORDER BY m4.created_at DESC LIMIT 1),
                   t.created_at
               ) DESC""",
            (pid,),
        )
        rows = await cur.fetchall()
        return [dict(r) for r in rows]
    finally:
        await db.close()


# ── POST /projects/{pid}/discussions ──────────────────────────────────────────

@router.post("/projects/{pid}/discussions")
async def create_thread(
    pid: int,
    body: ThreadCreate,
    user: dict = Depends(get_current_user),
):
    db = await get_db()
    try:
        # 确认项目存在
        cur = await db.execute("SELECT id FROM projects WHERE id = ?", (pid,))
        if not await cur.fetchone():
            raise HTTPException(status_code=404, detail="项目不存在")

        now = datetime.now().isoformat()
        cur = await db.execute(
            """INSERT INTO discussion_threads
               (project_id, title, document_id, thread_type, created_by, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (pid, body.title, body.document_id, body.thread_type, user["id"], now, now),
        )
        thread_id = cur.lastrowid
        await db.commit()

        return {
            "id": thread_id,
            "project_id": pid,
            "title": body.title,
            "document_id": body.document_id,
            "thread_type": body.thread_type,
            "created_by": user["id"],
            "created_at": now,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"创建失败: {str(e)}")
    finally:
        await db.close()


# ── GET /projects/{pid}/discussions/{tid} ─────────────────────────────────────

@router.get("/projects/{pid}/discussions/{tid}")
async def get_thread(
    pid: int,
    tid: int,
    user: dict = Depends(get_current_user),
):
    db = await get_db()
    try:
        # 获取主题
        cur = await db.execute(
            """SELECT t.*, u.display_name AS creator_name
               FROM discussion_threads t
               LEFT JOIN users u ON u.id = t.created_by
               WHERE t.id = ? AND t.project_id = ?""",
            (tid, pid),
        )
        thread = await cur.fetchone()
        if not thread:
            raise HTTPException(status_code=404, detail="讨论主题不存在")

        # 获取消息列表
        cur = await db.execute(
            """SELECT m.id, m.thread_id, m.user_id, m.role, m.content,
                      m.metadata, m.created_at,
                      u.display_name
               FROM discussion_messages m
               LEFT JOIN users u ON u.id = m.user_id
               WHERE m.thread_id = ?
               ORDER BY m.created_at ASC""",
            (tid,),
        )
        messages = await cur.fetchall()

        result = dict(thread)
        result["messages"] = [dict(m) for m in messages]
        return result
    finally:
        await db.close()


# ── POST /projects/{pid}/discussions/{tid}/messages ───────────────────────────

@router.post("/projects/{pid}/discussions/{tid}/messages")
async def post_message(
    pid: int,
    tid: int,
    body: MessageCreate,
    user: dict = Depends(get_current_user),
):
    db = await get_db()
    try:
        # 确认主题存在
        cur = await db.execute(
            "SELECT id FROM discussion_threads WHERE id = ? AND project_id = ?",
            (tid, pid),
        )
        if not await cur.fetchone():
            raise HTTPException(status_code=404, detail="讨论主题不存在")

        now = datetime.now().isoformat()
        cur = await db.execute(
            """INSERT INTO discussion_messages
               (thread_id, user_id, role, content, created_at)
               VALUES (?, ?, 'user', ?, ?)""",
            (tid, user["id"], body.content, now),
        )
        msg_id = cur.lastrowid

        # 更新主题的 updated_at
        await db.execute(
            "UPDATE discussion_threads SET updated_at = ? WHERE id = ?",
            (now, tid),
        )
        await db.commit()

        return {
            "id": msg_id,
            "thread_id": tid,
            "user_id": user["id"],
            "role": "user",
            "content": body.content,
            "created_at": now,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"发送失败: {str(e)}")
    finally:
        await db.close()


# ── POST /projects/{pid}/discussions/{tid}/ai ─────────────────────────────────

@router.post("/projects/{pid}/discussions/{tid}/ai")
async def post_message_with_ai(
    pid: int,
    tid: int,
    body: MessageCreate,
    user: dict = Depends(get_current_user),
):
    db = await get_db()
    try:
        # 确认主题存在
        cur = await db.execute(
            "SELECT * FROM discussion_threads WHERE id = ? AND project_id = ?",
            (tid, pid),
        )
        thread = await cur.fetchone()
        if not thread:
            raise HTTPException(status_code=404, detail="讨论主题不存在")

        now = datetime.now().isoformat()

        # 1. 插入用户消息
        cur = await db.execute(
            """INSERT INTO discussion_messages
               (thread_id, user_id, role, content, created_at)
               VALUES (?, ?, 'user', ?, ?)""",
            (tid, user["id"], body.content, now),
        )
        user_msg_id = cur.lastrowid
        await db.commit()

        # 2. 加载最近 20 条消息
        cur = await db.execute(
            """SELECT role, content FROM discussion_messages
               WHERE thread_id = ?
               ORDER BY created_at DESC LIMIT 20""",
            (tid,),
        )
        recent = await cur.fetchall()
        recent = list(reversed(recent))  # 按时间正序

        # 3. 获取项目信息
        cur = await db.execute(
            "SELECT title, current_stage FROM projects WHERE id = ?", (pid,)
        )
        project = await cur.fetchone()
        project_title = project["title"] if project else "未知项目"
        current_stage = project["current_stage"] if project else "unknown"

        # 4. 如果主题关联了文档，获取文档标题
        document_id = thread["document_id"]
        doc_title = ""
        if document_id:
            cur = await db.execute(
                "SELECT title FROM project_documents WHERE id = ?",
                (document_id,),
            )
            doc_row = await cur.fetchone()
            if doc_row:
                doc_title = doc_row["title"]

        # 5. RAG 检索相关上下文
        rag_context = await retrieve_combined_context(db, pid, body.content)

        # 5b. 获取项目数据指标
        analytics_context = ""
        try:
            acur = await db.execute(
                "SELECT * FROM project_analytics WHERE project_id = ? ORDER BY recorded_date DESC LIMIT 2",
                (pid,),
            )
            arows = [dict(r) for r in await acur.fetchall()]
            if arows:
                a = arows[0]
                analytics_context = (
                    f"\n## 项目数据指标 (截至 {a['recorded_date']})\n"
                    f"- 访问量: {a['visits']}\n- 注册数: {a['signups']}\n"
                    f"- 活跃用户: {a['active_users']}\n- 收入: {a['revenue']}\n"
                )
                # 动态展示扩展指标
                custom_raw = a.get("custom_metrics", "{}")
                if isinstance(custom_raw, str):
                    import json as _json
                    try: custom_dict = _json.loads(custom_raw)
                    except Exception: custom_dict = {}
                else:
                    custom_dict = custom_raw if isinstance(custom_raw, dict) else {}
                for ck, cv in custom_dict.items():
                    analytics_context += f"- {ck}: {cv}\n"
                if a.get("notes"):
                    analytics_context += f"- 备注: {a['notes']}\n"
                if len(arows) > 1:
                    prev = arows[1]
                    analytics_context += f"- 上期对比 ({prev['recorded_date']}): 访问{prev['visits']}→{a['visits']}, 注册{prev['signups']}→{a['signups']}\n"
        except Exception:
            pass

        # 5c. 获取部署链接
        deploy_context = ""
        try:
            pcur = await db.execute(
                "SELECT landing_page_url, mvp_url, analytics_dashboard_url FROM projects WHERE id = ?",
                (pid,),
            )
            prow = await pcur.fetchone()
            if prow:
                urls = []
                if prow["landing_page_url"]: urls.append(f"Landing Page: {prow['landing_page_url']}")
                if prow["mvp_url"]: urls.append(f"MVP: {prow['mvp_url']}")
                if prow["analytics_dashboard_url"]: urls.append(f"数据看板: {prow['analytics_dashboard_url']}")
                if urls:
                    deploy_context = "\n## 部署链接\n" + "\n".join(f"- {u}" for u in urls) + "\n"
        except Exception:
            pass

        # 6. 构建 system prompt
        doc_line = f"讨论文档：{doc_title}\n\n" if document_id else "\n\n"
        system_prompt = (
            f"你是一位资深产品经理AI助手，正在参与项目「{project_title}」的讨论。\n"
            f"当前阶段：{current_stage}\n"
            + doc_line
            + deploy_context
            + analytics_context +
            f"\n## 参考资料\n{rag_context}\n\n"
            f"请基于项目背景和参考资料提供专业的产品分析和建议。如果有数据指标，请结合数据分析。回答要简洁、有洞察力。"
        )

        # 7. 构建多轮消息数组
        ai_messages: list[dict] = [{"role": "system", "content": system_prompt}]
        for msg in recent:
            ai_messages.append({
                "role": msg["role"] if msg["role"] in ("user", "assistant") else "user",
                "content": msg["content"],
            })

        # 8. 调用 AI
        ai_reply = await _ai_chat(ai_messages)

        # 9. 插入 AI 回复
        ai_now = datetime.now().isoformat()
        cur = await db.execute(
            """INSERT INTO discussion_messages
               (thread_id, user_id, role, content, created_at)
               VALUES (?, NULL, 'assistant', ?, ?)""",
            (tid, ai_reply, ai_now),
        )
        ai_msg_id = cur.lastrowid

        # 更新主题 updated_at
        await db.execute(
            "UPDATE discussion_threads SET updated_at = ? WHERE id = ?",
            (ai_now, tid),
        )
        await db.commit()

        # 9b. Auto-memory: extract learnings in BACKGROUND (don't block response)
        import asyncio as _asyncio

        async def _extract_memories_bg():
            try:
                auto_mem_prompt = f"""回顾这段项目讨论，提取值得长期记住的内容。只提取以下类型：
- decision: 团队做出的决策（做/不做某事）
- preference: 用户偏好或方向倾向
- insight: 产品/市场洞察
- feedback: 对AI行为的反馈

项目: {project_title} (阶段: {current_stage})
讨论主题: {thread['title']}
用户说: {body.content}
AI回复: {ai_reply[:500]}

如果有值得记住的，返回JSON: {{"memories": [{{"content": "...", "category": "decision|preference|insight|feedback"}}]}}
如果没有，返回: {{"memories": []}}
只返回JSON，不要其他文字。"""

                mem_resp = await _ai_chat(
                    [
                        {"role": "system", "content": "你是记忆提取助手。从对话中提取值得长期记住的内容，输出纯 JSON。"},
                        {"role": "user", "content": auto_mem_prompt},
                    ],
                    temperature=0.1,
                )
                json_match = re.search(r'\{.*\}', mem_resp, re.DOTALL)
                if json_match:
                    mem_data = _json.loads(json_match.group())
                    memories = mem_data.get("memories", [])
                    if memories:
                        from agent.tools import _remember
                        for m in memories[:3]:
                            await _remember(m.get("content", ""), m.get("category", "insight"))
                        logger.info(f"Extracted {len(memories[:3])} memories from discussion thread {tid}")
            except Exception as e:
                logger.debug(f"Auto-memory extraction failed for thread {tid}: {e}")

        _asyncio.get_event_loop().create_task(_extract_memories_bg())

        # 10. 返回用户消息和 AI 回复
        return {
            "user_message": {
                "id": user_msg_id,
                "thread_id": tid,
                "user_id": user["id"],
                "role": "user",
                "content": body.content,
                "created_at": now,
            },
            "ai_message": {
                "id": ai_msg_id,
                "thread_id": tid,
                "user_id": None,
                "role": "assistant",
                "content": ai_reply,
                "created_at": ai_now,
            },
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI 对话失败: {str(e)}")
    finally:
        await db.close()


# ── POST /projects/{pid}/discussions/{tid}/ai/stream ─────────────────

@router.post("/projects/{pid}/discussions/{tid}/ai/stream")
async def post_message_with_ai_stream(
    pid: int,
    tid: int,
    body: MessageCreate,
    user: dict = Depends(get_current_user),
):
    """Stream AI reply for a discussion thread via Server-Sent Events.

    Emits SSE events:
      event: status  - {"phase": "thinking"}
      event: content - {"text": "..."}  (streaming text chunks)
      event: done    - {"user_message_id": N, "ai_message_id": N}
      event: error   - {"message": "..."}
    """
    from ai.client import chat_stream_simple

    async def event_generator():
        db = await get_db()
        try:
            # Verify thread exists
            cur = await db.execute(
                "SELECT * FROM discussion_threads WHERE id = ? AND project_id = ?",
                (tid, pid),
            )
            thread = await cur.fetchone()
            if not thread:
                yield f"event: error\ndata: {_json.dumps({'message': '讨论主题不存在'})}\n\n"
                return

            now = datetime.now().isoformat()

            # 1. Insert user message
            cur = await db.execute(
                """INSERT INTO discussion_messages
                   (thread_id, user_id, role, content, created_at)
                   VALUES (?, ?, 'user', ?, ?)""",
                (tid, user["id"], body.content, now),
            )
            user_msg_id = cur.lastrowid
            await db.commit()

            yield f"event: status\ndata: {_json.dumps({'phase': 'thinking'})}\n\n"

            # 2. Load recent 20 messages
            cur = await db.execute(
                """SELECT role, content FROM discussion_messages
                   WHERE thread_id = ?
                   ORDER BY created_at DESC LIMIT 20""",
                (tid,),
            )
            recent = await cur.fetchall()
            recent = list(reversed(recent))

            # 3. Project info
            cur = await db.execute(
                "SELECT title, current_stage FROM projects WHERE id = ?", (pid,)
            )
            project = await cur.fetchone()
            project_title = project["title"] if project else "未知项目"
            current_stage = project["current_stage"] if project else "unknown"

            # 4. Document title if linked
            document_id = thread["document_id"]
            doc_title = ""
            if document_id:
                cur = await db.execute(
                    "SELECT title FROM project_documents WHERE id = ?",
                    (document_id,),
                )
                doc_row = await cur.fetchone()
                if doc_row:
                    doc_title = doc_row["title"]

            # 5. RAG context
            rag_context = await retrieve_combined_context(db, pid, body.content)

            # 5b. Analytics
            analytics_context = ""
            try:
                acur = await db.execute(
                    "SELECT * FROM project_analytics WHERE project_id = ? ORDER BY recorded_date DESC LIMIT 2",
                    (pid,),
                )
                arows = [dict(r) for r in await acur.fetchall()]
                if arows:
                    a = arows[0]
                    analytics_context = (
                        f"\n## 项目数据指标 (截至 {a['recorded_date']})\n"
                        f"- 访问量: {a['visits']}\n- 注册数: {a['signups']}\n"
                        f"- 活跃用户: {a['active_users']}\n- 收入: {a['revenue']}\n"
                    )
                    custom_raw = a.get("custom_metrics", "{}")
                    if isinstance(custom_raw, str):
                        try:
                            custom_dict = _json.loads(custom_raw)
                        except Exception:
                            custom_dict = {}
                    else:
                        custom_dict = custom_raw if isinstance(custom_raw, dict) else {}
                    for ck, cv in custom_dict.items():
                        analytics_context += f"- {ck}: {cv}\n"
                    if a.get("notes"):
                        analytics_context += f"- 备注: {a['notes']}\n"
                    if len(arows) > 1:
                        prev = arows[1]
                        analytics_context += f"- 上期对比 ({prev['recorded_date']}): 访问{prev['visits']}→{a['visits']}, 注册{prev['signups']}→{a['signups']}\n"
            except Exception:
                pass

            # 5c. Deploy links
            deploy_context = ""
            try:
                pcur = await db.execute(
                    "SELECT landing_page_url, mvp_url, analytics_dashboard_url FROM projects WHERE id = ?",
                    (pid,),
                )
                prow = await pcur.fetchone()
                if prow:
                    urls = []
                    if prow["landing_page_url"]:
                        urls.append(f"Landing Page: {prow['landing_page_url']}")
                    if prow["mvp_url"]:
                        urls.append(f"MVP: {prow['mvp_url']}")
                    if prow["analytics_dashboard_url"]:
                        urls.append(f"数据看板: {prow['analytics_dashboard_url']}")
                    if urls:
                        deploy_context = "\n## 部署链接\n" + "\n".join(f"- {u}" for u in urls) + "\n"
            except Exception:
                pass

            # 6. System prompt
            doc_line = f"讨论文档：{doc_title}\n\n" if document_id else "\n\n"
            system_prompt = (
                f"你是一位资深产品经理AI助手，正在参与项目「{project_title}」的讨论。\n"
                f"当前阶段：{current_stage}\n"
                + doc_line
                + deploy_context
                + analytics_context
                + f"\n## 参考资料\n{rag_context}\n\n"
                f"请基于项目背景和参考资料提供专业的产品分析和建议。如果有数据指标，请结合数据分析。回答要简洁、有洞察力。"
            )

            # 7. Build messages
            ai_messages: list[dict] = [{"role": "system", "content": system_prompt}]
            for msg in recent:
                ai_messages.append({
                    "role": msg["role"] if msg["role"] in ("user", "assistant") else "user",
                    "content": msg["content"],
                })

            # 8. Stream AI response
            ai_reply = ""
            async for chunk_text in chat_stream_simple(ai_messages):
                ai_reply += chunk_text
                yield f"event: content\ndata: {_json.dumps({'text': chunk_text}, ensure_ascii=False)}\n\n"

            # 9. Persist AI reply
            ai_now = datetime.now().isoformat()
            cur = await db.execute(
                """INSERT INTO discussion_messages
                   (thread_id, user_id, role, content, created_at)
                   VALUES (?, NULL, 'assistant', ?, ?)""",
                (tid, ai_reply, ai_now),
            )
            ai_msg_id = cur.lastrowid

            await db.execute(
                "UPDATE discussion_threads SET updated_at = ? WHERE id = ?",
                (ai_now, tid),
            )
            await db.commit()

            # 9b. Auto-memory in background
            import asyncio as _asyncio

            async def _extract_memories_bg():
                try:
                    auto_mem_prompt = f"""回顾这段项目讨论，提取值得长期记住的内容。只提取以下类型：
- decision: 团队做出的决策（做/不做某事）
- preference: 用户偏好或方向倾向
- insight: 产品/市场洞察
- feedback: 对AI行为的反馈

项目: {project_title} (阶段: {current_stage})
讨论主题: {thread['title']}
用户说: {body.content}
AI回复: {ai_reply[:500]}

如果有值得记住的，返回JSON: {{"memories": [{{"content": "...", "category": "decision|preference|insight|feedback"}}]}}
如果没有，返回: {{"memories": []}}
只返回JSON，不要其他文字。"""

                    mem_resp = await _ai_chat(
                        [
                            {"role": "system", "content": "你是记忆提取助手。从对话中提取值得长期记住的内容，输出纯 JSON。"},
                            {"role": "user", "content": auto_mem_prompt},
                        ],
                        temperature=0.1,
                    )
                    json_match = re.search(r'\{.*\}', mem_resp, re.DOTALL)
                    if json_match:
                        mem_data = _json.loads(json_match.group())
                        memories = mem_data.get("memories", [])
                        if memories:
                            from agent.tools import _remember
                            for m in memories[:3]:
                                await _remember(m.get("content", ""), m.get("category", "insight"))
                            logger.info(f"Extracted {len(memories[:3])} memories from discussion thread {tid}")
                except Exception as e:
                    logger.debug(f"Auto-memory extraction failed for thread {tid}: {e}")

            _asyncio.get_event_loop().create_task(_extract_memories_bg())

            yield f"event: done\ndata: {_json.dumps({'user_message_id': user_msg_id, 'ai_message_id': ai_msg_id})}\n\n"

        except Exception as e:
            logger.error(f"Discussion stream error: {e}", exc_info=True)
            yield f"event: error\ndata: {_json.dumps({'message': str(e)}, ensure_ascii=False)}\n\n"
        finally:
            await db.close()

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
