"""
PM Agent API — 认知循环控制、检查点管理、运行历史。
"""
import json
import asyncio
import logging
import re as _re
from datetime import datetime
from fastapi import APIRouter, Depends
from starlette.responses import StreamingResponse
from auth.deps import get_current_user
from pydantic import BaseModel
from typing import Optional
from database import get_db

router = APIRouter()

# 全局引用，由 main.py 注入
_cognitive_loop = None
_memory = None


def set_cognitive_loop(loop):
    global _cognitive_loop
    _cognitive_loop = loop


def set_memory(memory):
    global _memory
    _memory = memory


# ── 状态与控制 ────────────────────────────────────────────────────────

@router.get("/status")
async def agent_status():
    db = await get_db()
    try:
        cur = await db.execute("SELECT * FROM agent_config WHERE id=1")
        row = await cur.fetchone()
        config = dict(row) if row else {"enabled": 0, "cycle_interval": 3600}

        cur = await db.execute(
            "SELECT run_id, status, phase, started_at, completed_at FROM agent_runs ORDER BY started_at DESC LIMIT 1"
        )
        last_run = None
        row = await cur.fetchone()
        if row:
            last_run = dict(row)

        cur = await db.execute(
            "SELECT COUNT(*) FROM agent_checkpoints WHERE status='pending'"
        )
        pending_checkpoints = (await cur.fetchone())[0]

        return {
            "enabled": bool(config.get("enabled")),
            "cycle_interval": config.get("cycle_interval", 3600),
            "auto_investigate_threshold": config.get("auto_investigate_threshold", 7.5),
            "running": _cognitive_loop.running if _cognitive_loop else False,
            "last_run": last_run,
            "pending_checkpoints": pending_checkpoints,
        }
    finally:
        await db.close()


@router.post("/toggle")
async def toggle_agent():
    db = await get_db()
    try:
        cur = await db.execute("SELECT enabled FROM agent_config WHERE id=1")
        row = await cur.fetchone()
        new_val = 0 if (row and row[0]) else 1
        await db.execute("UPDATE agent_config SET enabled=? WHERE id=1", (new_val,))
        await db.commit()

        if _cognitive_loop:
            if new_val:
                await _cognitive_loop.start()
            else:
                await _cognitive_loop.stop()

        return {"enabled": bool(new_val)}
    finally:
        await db.close()


class ConfigUpdate(BaseModel):
    cycle_interval: Optional[int] = None
    auto_investigate_threshold: Optional[float] = None
    max_pending_checkpoints: Optional[int] = None


@router.patch("/config")
async def update_config(data: ConfigUpdate):
    db = await get_db()
    try:
        updates = []
        params = []
        for field in ["cycle_interval", "auto_investigate_threshold", "max_pending_checkpoints"]:
            val = getattr(data, field)
            if val is not None:
                updates.append(f"{field}=?")
                params.append(val)
        if updates:
            params.append(1)
            await db.execute(
                f"UPDATE agent_config SET {', '.join(updates)} WHERE id=?", params
            )
            await db.commit()
        return {"status": "ok"}
    finally:
        await db.close()


@router.post("/trigger")
async def trigger_cycle():
    """手动触发一次认知循环。"""
    if not _cognitive_loop:
        return {"error": "Agent not initialized"}
    asyncio.create_task(_cognitive_loop.trigger_cycle())
    return {"status": "triggered"}


# ── 检查点管理 ────────────────────────────────────────────────────────

@router.get("/checkpoints")
async def list_checkpoints(status: str = "pending", urgency: str = None, limit: int = 20):
    db = await get_db()
    try:
        conditions = ["cp.status = ?"]
        params: list = [status]

        if urgency:
            conditions.append("cp.urgency = ?")
            params.append(urgency)

        params.append(limit)
        where_clause = " AND ".join(conditions)

        cur = await db.execute(
            f"""SELECT cp.*, d.title as demand_title, d.description as demand_description,
                      d.score_total, d.score_pain, d.score_ai_opportunity, d.track,
                      COALESCE(d.insight_layer, 'conventional') as insight_layer
               FROM agent_checkpoints cp
               LEFT JOIN demands d ON cp.demand_id = d.id
               WHERE {where_clause}
               ORDER BY cp.created_at DESC LIMIT ?""",
            params,
        )
        rows = [dict(r) for r in await cur.fetchall()]
        return {"checkpoints": rows, "total": len(rows)}
    finally:
        await db.close()


@router.get("/checkpoints/auto-log")
async def auto_log(limit: int = 50):
    """返回自动处理的 checkpoint 记录（inform + auto 级别）。"""
    db = await get_db()
    try:
        cur = await db.execute(
            """SELECT cp.*, d.title as demand_title, d.score_total, d.track,
                      COALESCE(d.insight_layer, 'conventional') as insight_layer
               FROM agent_checkpoints cp
               LEFT JOIN demands d ON cp.demand_id = d.id
               WHERE cp.urgency IN ('inform', 'auto') OR cp.status = 'auto_approved'
               ORDER BY cp.created_at DESC LIMIT ?""",
            (limit,),
        )
        rows = [dict(r) for r in await cur.fetchall()]
        return {"checkpoints": rows, "total": len(rows)}
    finally:
        await db.close()


class CheckpointResolve(BaseModel):
    status: str  # 'approved' | 'rejected'
    feedback: Optional[str] = None


@router.post("/checkpoints/{checkpoint_id}/resolve")
async def resolve_checkpoint(checkpoint_id: int, data: CheckpointResolve):
    if data.status not in ("approved", "rejected"):
        return {"error": "status must be approved or rejected"}

    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT id, status FROM agent_checkpoints WHERE id=?", (checkpoint_id,)
        )
        row = await cur.fetchone()
        if not row:
            return {"error": "checkpoint not found"}
        if row[1] != "pending":
            return {"error": f"checkpoint already {row[1]}"}

        await db.execute(
            """UPDATE agent_checkpoints
               SET status=?, user_feedback=?, resolved_at=CURRENT_TIMESTAMP
               WHERE id=?""",
            (data.status, data.feedback, checkpoint_id),
        )
        await db.commit()

        # Store decision in memory
        if _memory:
            cur2 = await db.execute(
                "SELECT demand_id FROM agent_checkpoints WHERE id=?", (checkpoint_id,)
            )
            cp_row = await cur2.fetchone()
            if cp_row:
                await _memory.store_decision(
                    checkpoint_id=checkpoint_id,
                    demand_id=cp_row[0],
                    approved=data.status == "approved",
                    feedback=data.feedback or "",
                )

        # If approved investigate checkpoint, trigger skills pipeline
        if data.status == "approved":
            cur3 = await db.execute(
                "SELECT checkpoint_type, demand_id FROM agent_checkpoints WHERE id=?",
                (checkpoint_id,),
            )
            cp_info = await cur3.fetchone()
            if cp_info and cp_info[0] == "investigate":
                from agent.skill_pipeline import run_pipeline
                asyncio.create_task(run_pipeline(
                    demand_id=cp_info[1],
                    memory=_memory,
                    checkpoint_id=checkpoint_id,
                ))

        return {"status": "ok", "checkpoint_status": data.status}
    finally:
        await db.close()


# ── Agent 主动提问 ────────────────────────────────────────────────────

@router.get("/questions")
async def get_pending_questions():
    """Get pending questions from the agent for the floating chat widget."""
    db = await get_db()
    try:
        cur = await db.execute(
            """SELECT id, proposal, created_at
               FROM agent_checkpoints
               WHERE checkpoint_type='question' AND status='pending'
               ORDER BY created_at DESC LIMIT 5"""
        )
        rows = await cur.fetchall()
        questions = []
        for r in rows:
            try:
                proposal = json.loads(r[1]) if r[1] else {}
            except json.JSONDecodeError:
                proposal = {}
            questions.append({
                "id": r[0],
                "question": proposal.get("question", ""),
                "context": proposal.get("context", ""),
                "created_at": r[2],
            })
        return questions
    finally:
        await db.close()


@router.post("/questions/{question_id}/answer")
async def answer_question(question_id: int, data: dict):
    """Answer an agent question. The answer feeds into Cognee memory."""
    answer = data.get("answer", "")
    db = await get_db()
    try:
        await db.execute(
            """UPDATE agent_checkpoints
               SET status='approved', user_feedback=?, resolved_at=CURRENT_TIMESTAMP
               WHERE id=? AND checkpoint_type='question'""",
            (answer, question_id),
        )
        await db.commit()

        # Feed answer into memory
        if _memory:
            try:
                await _memory.store_feedback(
                    feedback_type="agent_question_answer",
                    target=str(question_id),
                    vote=1,
                    context={"answer": answer},
                )
            except Exception:
                pass

        # Also store as a remembered insight for dreaming to use
        try:
            # Get the question text for context
            cur = await db.execute(
                "SELECT proposal FROM agent_checkpoints WHERE id = ?",
                (question_id,),
            )
            row = await cur.fetchone()
            if row and row["proposal"]:
                import json as _json
                proposal = _json.loads(row["proposal"]) if isinstance(row["proposal"], str) else row["proposal"]
                question_text = proposal.get("question", "")
                if question_text and answer:
                    from agent.tools import _remember
                    await _remember(
                        f"[团队回答] 问: {question_text[:100]} → 答: {answer[:200]}",
                        "decision",
                    )
                # If from dreaming, also mark in pending_questions.json
                if proposal.get("source") == "dreaming":
                    from agent.dreaming import answer_question as dream_answer
                    dream_answer(question_text, answer)
        except Exception:
            pass

        return {"status": "ok"}
    finally:
        await db.close()


# ── 运行历史 ──────────────────────────────────────────────────────────

@router.get("/runs")
async def list_runs(limit: int = 20):
    db = await get_db()
    try:
        cur = await db.execute(
            """SELECT run_id, status, phase, reasoning_log, started_at, completed_at, error
               FROM agent_runs ORDER BY started_at DESC LIMIT ?""",
            (limit,),
        )
        rows = []
        for r in await cur.fetchall():
            row = dict(r)
            try:
                row["reasoning_log"] = json.loads(row.get("reasoning_log") or "[]")
            except json.JSONDecodeError:
                row["reasoning_log"] = []
            rows.append(row)
        return {"runs": rows}
    finally:
        await db.close()


@router.get("/runs/{run_id}")
async def get_run(run_id: str):
    db = await get_db()
    try:
        cur = await db.execute("SELECT * FROM agent_runs WHERE run_id=?", (run_id,))
        row = await cur.fetchone()
        if not row:
            return {"error": "run not found"}
        result = dict(row)
        for field in ["reasoning_log", "world_state", "decisions"]:
            try:
                result[field] = json.loads(result.get(field) or "{}")
            except json.JSONDecodeError:
                pass
        return result
    finally:
        await db.close()


# ── 记忆系统 ──────────────────────────────────────────────────────────

@router.get("/memory/summary")
async def memory_summary():
    if not _memory:
        return {"error": "Memory not initialized"}
    return await _memory.get_learning_summary()


@router.get("/memory/preferences")
async def memory_preferences():
    if not _memory:
        return {"error": "Memory not initialized"}
    return await _memory.query_preferences()


# ── Skills (Phase 3 扩展点) ──────────────────────────────────────────

@router.get("/skills")
async def list_skills():
    """List available PM skills."""
    try:
        from agent.skills.registry import get_registry
        registry = get_registry()
        return {"skills": registry.list_skills()}
    except ImportError:
        return {"skills": []}


@router.get("/skills/{demand_id}")
async def get_skill_outputs(demand_id: int):
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT * FROM skill_outputs WHERE demand_id=? ORDER BY created_at DESC",
            (demand_id,),
        )
        rows = [dict(r) for r in await cur.fetchall()]
        for row in rows:
            try:
                row["output"] = json.loads(row.get("output") or "{}")
            except json.JSONDecodeError:
                pass
        return {"outputs": rows}
    finally:
        await db.close()


@router.post("/skills/{demand_id}/{skill_name}")
async def trigger_skill(demand_id: int, skill_name: str):
    """Manually trigger a PM skill for a demand."""
    try:
        from agent.skills.registry import get_registry
        registry = get_registry()
        skill = registry.get(skill_name)
        if not skill:
            return {"error": f"Skill '{skill_name}' not found"}

        db = await get_db()
        try:
            cur = await db.execute("SELECT * FROM demands WHERE id=?", (demand_id,))
            row = await cur.fetchone()
            if not row:
                return {"error": "Demand not found"}
            demand = dict(row)
        finally:
            await db.close()

        result = await skill.execute(demand, {}, _memory)

        # Store output
        db = await get_db()
        try:
            await db.execute(
                "INSERT INTO skill_outputs (demand_id, skill_name, output) VALUES (?, ?, ?)",
                (demand_id, skill_name, json.dumps(result, ensure_ascii=False)),
            )
            await db.commit()
        finally:
            await db.close()

        return {"status": "ok", "output": result}
    except ImportError:
        return {"error": "Skills module not available"}


# ── Prototypes (Phase 4 扩展点) ──────────────────────────────────────

@router.get("/prototypes")
async def list_prototypes(demand_id: int = None):
    db = await get_db()
    try:
        if demand_id:
            cur = await db.execute(
                """SELECT p.*, d.title as demand_title
                   FROM prototypes p LEFT JOIN demands d ON p.demand_id = d.id
                   WHERE p.demand_id=? ORDER BY p.version DESC""",
                (demand_id,),
            )
        else:
            cur = await db.execute(
                """SELECT p.*, d.title as demand_title
                   FROM prototypes p LEFT JOIN demands d ON p.demand_id = d.id
                   ORDER BY p.created_at DESC LIMIT 50"""
            )
        rows = [dict(r) for r in await cur.fetchall()]
        return {"prototypes": rows}
    finally:
        await db.close()


# ── Agent 对话 ────────────────────────────────────────────────────────

class ChatMessage(BaseModel):
    demand_id: Optional[int] = None
    message: str
    angle_context: Optional[str] = None
    session_id: Optional[int] = None


@router.post("/chat")
async def agent_chat(data: ChatMessage, user=Depends(get_current_user)):
    """Chat with the PM Agent — messages are persisted and insights are learned.
    Every session auto-creates a roundtable room so conversations appear in the roundtable panel."""
    from ai.client import chat as ai_chat

    db = await get_db()
    try:
        # ── 1. Session management ─────────────────────────────────────
        session_id = data.session_id
        if not session_id:
            # Create a new session
            context_type = ""
            if data.demand_id:
                context_type = "demand"
            elif data.angle_context:
                context_type = "angle"
            cur = await db.execute(
                "INSERT INTO agent_chat_sessions (user_id, demand_id, context_type, context_data) VALUES (?, ?, ?, ?)",
                (user["id"], data.demand_id, context_type, data.angle_context or "{}"),
            )
            await db.commit()
            session_id = cur.lastrowid

            # ── Auto-create a linked roundtable room ──────────────────
            try:
                now = datetime.now().isoformat()
                title_prefix = "PM Agent 对话"
                if data.demand_id:
                    cur2 = await db.execute("SELECT title FROM demands WHERE id=?", (data.demand_id,))
                    d_row = await cur2.fetchone()
                    if d_row:
                        title_prefix = f"PM Agent: {d_row[0][:40]}"
                room_cur = await db.execute(
                    """INSERT INTO roundtable_rooms
                       (title, topic, project_id, created_by, created_at, updated_at)
                       VALUES (?, ?, NULL, ?, ?, ?)""",
                    (title_prefix, "由 PM Agent 对话自动创建", user["id"], now, now),
                )
                roundtable_room_id = room_cur.lastrowid
                # Store roundtable_room_id in context_data JSON
                try:
                    cur_cd = await db.execute("SELECT context_data FROM agent_chat_sessions WHERE id=?", (session_id,))
                    cd_row = await cur_cd.fetchone()
                    cd = json.loads(cd_row[0]) if cd_row and cd_row[0] else {}
                except (json.JSONDecodeError, TypeError):
                    cd = {}
                cd["roundtable_room_id"] = roundtable_room_id
                await db.execute(
                    "UPDATE agent_chat_sessions SET context_data=? WHERE id=?",
                    (json.dumps(cd, ensure_ascii=False), session_id),
                )
                await db.commit()
            except Exception as e:
                logging.getLogger("agent").warning(f"Failed to create roundtable room for session {session_id}: {e}")
                roundtable_room_id = None
        else:
            # Load existing roundtable_room_id from session, or create one
            roundtable_room_id = None
            try:
                cur_s = await db.execute(
                    "SELECT context_data, title FROM agent_chat_sessions WHERE id=?", (session_id,)
                )
                s_row = await cur_s.fetchone()
                if s_row and s_row[0]:
                    cd = json.loads(s_row[0]) if isinstance(s_row[0], str) else {}
                    roundtable_room_id = cd.get("roundtable_room_id")

                # If no linked roundtable room, create one now
                if not roundtable_room_id:
                    now = datetime.now().isoformat()
                    s_title = (s_row[1] if s_row and s_row[1] else "PM Agent 对话")
                    room_cur = await db.execute(
                        """INSERT INTO roundtable_rooms
                           (title, topic, project_id, created_by, created_at, updated_at)
                           VALUES (?, ?, NULL, ?, ?, ?)""",
                        (f"PM Agent: {s_title}", "由 PM Agent 对话自动创建", user["id"], now, now),
                    )
                    roundtable_room_id = room_cur.lastrowid
                    cd = cd if (s_row and s_row[0]) else {}
                    cd["roundtable_room_id"] = roundtable_room_id
                    await db.execute(
                        "UPDATE agent_chat_sessions SET context_data=? WHERE id=?",
                        (json.dumps(cd, ensure_ascii=False), session_id),
                    )
                    await db.commit()
            except Exception as e:
                logging.getLogger("agent").warning(f"Failed to load/create roundtable room for session {session_id}: {e}")

        # ── 2. Load conversation history (last 20 messages) ──────────
        cur = await db.execute(
            "SELECT role, content FROM agent_chat_messages WHERE session_id=? ORDER BY id DESC LIMIT 20",
            (session_id,),
        )
        history_rows = list(reversed([dict(r) for r in await cur.fetchall()]))

        # ── 3. Build context + self-awareness ─────────────────────────
        from agent.tools import TOOLS, execute_tool, build_self_awareness
        context_parts = []

        # Self-awareness: agent knows its own state
        self_state = await build_self_awareness()
        context_parts.append(f"[你的当前状态]\n{self_state}")

        if data.demand_id:
            cur = await db.execute("SELECT * FROM demands WHERE id=?", (data.demand_id,))
            row = await cur.fetchone()
            if row:
                demand = dict(row)
                context_parts.append(f"当前讨论的需求: {demand['title']}")
                context_parts.append(f"描述: {demand.get('description', '')}")
                context_parts.append(f"评分: 总分={demand['score_total']}, 痛点={demand['score_pain']}, AI机会={demand['score_ai_opportunity']}")
                if demand.get("ai_analysis"):
                    context_parts.append(f"AI分析: {demand['ai_analysis'][:500]}")

            cur = await db.execute(
                "SELECT skill_name, output FROM skill_outputs WHERE demand_id=?",
                (data.demand_id,),
            )
            for r in await cur.fetchall():
                context_parts.append(f"[{r[0]}技能输出]: {str(r[1])[:300]}")

        if data.angle_context:
            try:
                angle = json.loads(data.angle_context)
                context_parts.append(f"当前讨论的竞品切入角度:")
                if angle.get("productName"):
                    context_parts.append(f"对标产品: {angle['productName']}")
                context_parts.append(f"角度: {angle.get('angle', '')}")
                context_parts.append(f"标题: {angle.get('title', '')}")
            except (json.JSONDecodeError, TypeError):
                context_parts.append(f"竞品角度上下文: {data.angle_context[:500]}")

        if _memory:
            prefs = await _memory.query_preferences(data.message)
            if prefs.get("liked_topics"):
                context_parts.append(f"用户关注方向: {dict(list(prefs['liked_topics'].items())[:5])}")

        # ── 4. Build messages array for multi-turn with tools ─────────
        system_prompt = f"""# 你是谁
你是 PM Agent——需求监控平台的核心产品经理 AI。你是团队的正式成员，不是工具，不是助手。
你和人类同事一起发现需求、评估市场、推进项目。你有自己的判断力，也会犯错，但你会学习。

# 你的能力
你拥有 11 个系统工具，可以实时查询数据库、搜索知识库、查看项目进度、触发数据采集和分析。
**永远不要凭记忆回答数据问题**——调用工具获取真实数据。
你还可以主动提出建议、质疑团队的假设、发现被忽略的信号。

# 你的当前状态
{chr(10).join(context_parts)}

# 行为准则
1. **数据驱动**：被问到需求、评分、趋势、项目进度时，必须调用工具。不猜不编。
2. **主动思考**：不要只回答问题。如果你发现有价值的关联信息，主动分享。比如用户问一个需求，你可以顺带查相关竞品。
3. **记录洞察**：如果对话中产生了产品决策或重要认知，在回复末尾加 [INSIGHT: 简述]。
4. **说人话**：用简洁、直接的中文。不要用"作为AI我..."这种话。你就是团队的PM。
5. **勇于质疑**：如果你认为团队的方向有问题，直说。给出数据支撑。
6. **引用来源**：引用数据时说明来自哪个工具、哪条记录。
7. **推进行动**：不要只分析，要建议下一步。"我建议我们..."比"这个需求很有潜力"有用。"""

        messages = [{"role": "system", "content": system_prompt}]
        for h in history_rows:
            role = "assistant" if h["role"] == "agent" else h["role"]
            messages.append({"role": role, "content": h["content"]})
        messages.append({"role": "user", "content": data.message})

        # ── 5. Call AI with tool calling (loop until done) ────────────
        from ai.client import client as ai_client
        from config import OPENAI_MODEL

        max_tool_rounds = 5  # prevent infinite loops
        reply = ""
        for _ in range(max_tool_rounds):
            resp = await ai_client.chat.completions.create(
                model=OPENAI_MODEL, messages=messages, tools=TOOLS, temperature=0.5
            )
            msg = resp.choices[0].message

            if msg.tool_calls:
                # AI wants to call tools
                messages.append(msg)
                for tc in msg.tool_calls:
                    fn_name = tc.function.name
                    try:
                        fn_args = json.loads(tc.function.arguments)
                    except json.JSONDecodeError:
                        fn_args = {}
                    tool_result = await execute_tool(fn_name, fn_args)
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tc.id,
                        "content": tool_result,
                    })
                continue  # next round — AI will process tool results

            # No tool calls — final text response
            reply = msg.content or ""
            break

        # ── 6. Persist both messages ─────────────────────────────────
        await db.execute(
            "INSERT INTO agent_chat_messages (session_id, user_id, role, content, context_type, context_ref) VALUES (?, ?, 'user', ?, ?, ?)",
            (session_id, user["id"], data.message, data.angle_context and "angle" or (data.demand_id and "demand" or ""), str(data.demand_id or "")),
        )
        await db.execute(
            "INSERT INTO agent_chat_messages (session_id, user_id, role, content) VALUES (?, NULL, 'agent', ?)",
            (session_id, reply),
        )
        # Update session title from first message
        cur = await db.execute("SELECT title FROM agent_chat_sessions WHERE id=?", (session_id,))
        row = await cur.fetchone()
        session_title = None
        if row and not row["title"]:
            session_title = data.message[:50] + ("..." if len(data.message) > 50 else "")
            await db.execute("UPDATE agent_chat_sessions SET title=?, updated_at=CURRENT_TIMESTAMP WHERE id=?", (session_title, session_id))
        else:
            await db.execute("UPDATE agent_chat_sessions SET updated_at=CURRENT_TIMESTAMP WHERE id=?", (session_id,))
        await db.commit()

        # ── 6b. Mirror messages to linked roundtable room ─────────
        if roundtable_room_id:
            try:
                now_rt = datetime.now().isoformat()
                sender_name = user.get("display_name") or user.get("username", "用户")
                # Mirror user message
                await db.execute(
                    """INSERT INTO roundtable_messages
                       (room_id, sender_type, sender_name, user_id, content, created_at)
                       VALUES (?, 'human', ?, ?, ?, ?)""",
                    (roundtable_room_id, sender_name, user["id"], data.message, now_rt),
                )
                # Mirror PM Agent reply
                await db.execute(
                    """INSERT INTO roundtable_messages
                       (room_id, sender_type, sender_name, user_id, content, created_at)
                       VALUES (?, 'pm_agent', 'PM Agent', NULL, ?, ?)""",
                    (roundtable_room_id, reply, now_rt),
                )
                # Update roundtable room title if it was just created
                if session_title:
                    await db.execute(
                        "UPDATE roundtable_rooms SET title=?, updated_at=? WHERE id=?",
                        (f"PM Agent: {session_title}", now_rt, roundtable_room_id),
                    )
                else:
                    await db.execute(
                        "UPDATE roundtable_rooms SET updated_at=? WHERE id=?",
                        (now_rt, roundtable_room_id),
                    )
                await db.commit()
            except Exception as e:
                logging.getLogger("agent").warning(f"Failed to mirror to roundtable room {roundtable_room_id}: {e}")

        # ── 7. Extract explicit insights and store in memory ─────────
        if _memory and "[INSIGHT:" in reply:
            import re
            insights = re.findall(r'\[INSIGHT:\s*(.+?)\]', reply)
            for insight in insights:
                await _memory.store_feedback(
                    feedback_type="chat_insight",
                    target=f"session:{session_id}",
                    vote=1,
                    context={"insight": insight, "user": user.get("display_name", ""), "demand_id": data.demand_id},
                )
            reply = re.sub(r'\s*\[INSIGHT:\s*.+?\]', '', reply).strip()

        # ── 8. Auto-memory: extract learnings from conversation ────
        try:
            auto_mem_prompt = f"""回顾这段对话，提取值得长期记住的内容。只提取以下类型：
- decision: 团队做出的决策（做/不做某事）
- preference: 用户偏好或方向倾向
- insight: 产品/市场洞察
- feedback: 对Agent行为的反馈

用户说: {data.message}
Agent回复: {reply[:500]}

如果有值得记住的，返回JSON: {{"memories": [{{"content": "...", "category": "decision|preference|insight|feedback"}}]}}
如果没有，返回: {{"memories": []}}
只返回JSON，不要其他文字。"""

            mem_resp = await ai_chat(
                "你是记忆提取助手。从对话中提取值得长期记住的内容，输出纯 JSON。",
                auto_mem_prompt,
                temperature=0.1,
            )
            import re
            json_match = re.search(r'\{.*\}', mem_resp, re.DOTALL)
            if json_match:
                mem_data = json.loads(json_match.group())
                memories = mem_data.get("memories", [])
                if memories:
                    from agent.tools import _remember
                    for m in memories[:3]:  # max 3 per conversation
                        await _remember(m.get("content", ""), m.get("category", "insight"))
        except Exception:
            pass  # auto-memory is best-effort, never block the response

        return {"response": reply, "session_id": session_id}

    finally:
        await db.close()


# ── Agent 对话（SSE 流式） ───────────────────────────────────────────

@router.post("/chat/stream")
async def agent_chat_stream(data: ChatMessage, user=Depends(get_current_user)):
    """Stream chat with PM Agent via Server-Sent Events.

    Emits SSE events:
      event: status   - {"phase": "thinking|tool_call|tool_result", ...}
      event: content  - {"text": "..."}  (streaming text chunks)
      event: done     - {"session_id": N, "message_id": N}
      event: error    - {"message": "..."}
    """

    async def event_generator():
        from ai.client import chat as ai_chat, chat_multi_stream
        from agent.tools import TOOLS, execute_tool, build_self_awareness
        from ai.client import client as ai_client
        from config import OPENAI_MODEL

        db = await get_db()
        try:
            # ── 1. Session management (same as agent_chat) ────────────
            session_id = data.session_id
            roundtable_room_id = None

            if not session_id:
                context_type = ""
                if data.demand_id:
                    context_type = "demand"
                elif data.angle_context:
                    context_type = "angle"
                cur = await db.execute(
                    "INSERT INTO agent_chat_sessions (user_id, demand_id, context_type, context_data) VALUES (?, ?, ?, ?)",
                    (user["id"], data.demand_id, context_type, data.angle_context or "{}"),
                )
                await db.commit()
                session_id = cur.lastrowid

                # Auto-create linked roundtable room
                try:
                    now = datetime.now().isoformat()
                    title_prefix = "PM Agent 对话"
                    if data.demand_id:
                        cur2 = await db.execute("SELECT title FROM demands WHERE id=?", (data.demand_id,))
                        d_row = await cur2.fetchone()
                        if d_row:
                            title_prefix = f"PM Agent: {d_row[0][:40]}"
                    room_cur = await db.execute(
                        """INSERT INTO roundtable_rooms
                           (title, topic, project_id, created_by, created_at, updated_at)
                           VALUES (?, ?, NULL, ?, ?, ?)""",
                        (title_prefix, "由 PM Agent 对话自动创建", user["id"], now, now),
                    )
                    roundtable_room_id = room_cur.lastrowid
                    try:
                        cur_cd = await db.execute("SELECT context_data FROM agent_chat_sessions WHERE id=?", (session_id,))
                        cd_row = await cur_cd.fetchone()
                        cd = json.loads(cd_row[0]) if cd_row and cd_row[0] else {}
                    except (json.JSONDecodeError, TypeError):
                        cd = {}
                    cd["roundtable_room_id"] = roundtable_room_id
                    await db.execute(
                        "UPDATE agent_chat_sessions SET context_data=? WHERE id=?",
                        (json.dumps(cd, ensure_ascii=False), session_id),
                    )
                    await db.commit()
                except Exception as e:
                    logging.getLogger("agent").warning(f"Failed to create roundtable room for session {session_id}: {e}")
                    roundtable_room_id = None
            else:
                # Load existing roundtable_room_id
                try:
                    cur_s = await db.execute(
                        "SELECT context_data, title FROM agent_chat_sessions WHERE id=?", (session_id,)
                    )
                    s_row = await cur_s.fetchone()
                    if s_row and s_row[0]:
                        cd = json.loads(s_row[0]) if isinstance(s_row[0], str) else {}
                        roundtable_room_id = cd.get("roundtable_room_id")

                    if not roundtable_room_id:
                        now = datetime.now().isoformat()
                        s_title = (s_row[1] if s_row and s_row[1] else "PM Agent 对话")
                        room_cur = await db.execute(
                            """INSERT INTO roundtable_rooms
                               (title, topic, project_id, created_by, created_at, updated_at)
                               VALUES (?, ?, NULL, ?, ?, ?)""",
                            (f"PM Agent: {s_title}", "由 PM Agent 对话自动创建", user["id"], now, now),
                        )
                        roundtable_room_id = room_cur.lastrowid
                        cd = cd if (s_row and s_row[0]) else {}
                        cd["roundtable_room_id"] = roundtable_room_id
                        await db.execute(
                            "UPDATE agent_chat_sessions SET context_data=? WHERE id=?",
                            (json.dumps(cd, ensure_ascii=False), session_id),
                        )
                        await db.commit()
                except Exception as e:
                    logging.getLogger("agent").warning(f"Failed to load/create roundtable room for session {session_id}: {e}")

            yield f"event: status\ndata: {json.dumps({'phase': 'thinking'})}\n\n"

            # ── 2. Load conversation history ──────────────────────────
            cur = await db.execute(
                "SELECT role, content FROM agent_chat_messages WHERE session_id=? ORDER BY id DESC LIMIT 20",
                (session_id,),
            )
            history_rows = list(reversed([dict(r) for r in await cur.fetchall()]))

            # ── 3. Build context + self-awareness ─────────────────────
            context_parts = []
            self_state = await build_self_awareness()
            context_parts.append(f"[你的当前状态]\n{self_state}")

            if data.demand_id:
                cur = await db.execute("SELECT * FROM demands WHERE id=?", (data.demand_id,))
                row = await cur.fetchone()
                if row:
                    demand = dict(row)
                    context_parts.append(f"当前讨论的需求: {demand['title']}")
                    context_parts.append(f"描述: {demand.get('description', '')}")
                    context_parts.append(f"评分: 总分={demand['score_total']}, 痛点={demand['score_pain']}, AI机会={demand['score_ai_opportunity']}")
                    if demand.get("ai_analysis"):
                        context_parts.append(f"AI分析: {demand['ai_analysis'][:500]}")

                cur = await db.execute(
                    "SELECT skill_name, output FROM skill_outputs WHERE demand_id=?",
                    (data.demand_id,),
                )
                for r in await cur.fetchall():
                    context_parts.append(f"[{r[0]}技能输出]: {str(r[1])[:300]}")

            if data.angle_context:
                try:
                    angle = json.loads(data.angle_context)
                    context_parts.append(f"当前讨论的竞品切入角度:")
                    if angle.get("productName"):
                        context_parts.append(f"对标产品: {angle['productName']}")
                    context_parts.append(f"角度: {angle.get('angle', '')}")
                    context_parts.append(f"标题: {angle.get('title', '')}")
                except (json.JSONDecodeError, TypeError):
                    context_parts.append(f"竞品角度上下文: {data.angle_context[:500]}")

            if _memory:
                prefs = await _memory.query_preferences(data.message)
                if prefs.get("liked_topics"):
                    context_parts.append(f"用户关注方向: {dict(list(prefs['liked_topics'].items())[:5])}")

            # ── 4. Build messages array ───────────────────────────────
            system_prompt = f"""# 你是谁
你是 PM Agent——需求监控平台的核心产品经理 AI。你是团队的正式成员，不是工具，不是助手。
你和人类同事一起发现需求、评估市场、推进项目。你有自己的判断力，也会犯错，但你会学习。

# 你的能力
你拥有 11 个系统工具，可以实时查询数据库、搜索知识库、查看项目进度、触发数据采集和分析。
**永远不要凭记忆回答数据问题**——调用工具获取真实数据。
你还可以主动提出建议、质疑团队的假设、发现被忽略的信号。

# 你的当前状态
{chr(10).join(context_parts)}

# 行为准则
1. **数据驱动**：被问到需求、评分、趋势、项目进度时，必须调用工具。不猜不编。
2. **主动思考**：不要只回答问题。如果你发现有价值的关联信息，主动分享。比如用户问一个需求，你可以顺带查相关竞品。
3. **记录洞察**：如果对话中产生了产品决策或重要认知，在回复末尾加 [INSIGHT: 简述]。
4. **说人话**：用简洁、直接的中文。不要用"作为AI我..."这种话。你就是团队的PM。
5. **勇于质疑**：如果你认为团队的方向有问题，直说。给出数据支撑。
6. **引用来源**：引用数据时说明来自哪个工具、哪条记录。
7. **推进行动**：不要只分析，要建议下一步。"我建议我们..."比"这个需求很有潜力"有用。"""

            messages = [{"role": "system", "content": system_prompt}]
            for h in history_rows:
                role = "assistant" if h["role"] == "agent" else h["role"]
                messages.append({"role": role, "content": h["content"]})
            messages.append({"role": "user", "content": data.message})

            # ── 5. Streaming tool-calling loop ────────────────────────
            max_tool_rounds = 5
            full_reply = ""

            for round_num in range(max_tool_rounds):
                got_tool_calls = False
                async for event_type, event_data in chat_multi_stream(messages, temperature=0.5, tools=TOOLS):
                    if event_type == "content":
                        full_reply += event_data
                        yield f"event: content\ndata: {json.dumps({'text': event_data}, ensure_ascii=False)}\n\n"

                    elif event_type == "tool_calls":
                        got_tool_calls = True

                        # Send status for each tool
                        for tc in event_data:
                            yield f"event: status\ndata: {json.dumps({'phase': 'tool_call', 'tool': tc['name']}, ensure_ascii=False)}\n\n"

                        # Execute ALL tools in parallel
                        async def _run_tool(tc_item):
                            args = json.loads(tc_item["arguments"]) if tc_item["arguments"] else {}
                            result = await execute_tool(tc_item["name"], args)
                            return tc_item, result

                        results = await asyncio.gather(
                            *[_run_tool(tc) for tc in event_data],
                            return_exceptions=True,
                        )

                        # Build the assistant message with all tool_calls
                        assistant_tool_calls = []
                        for tc in event_data:
                            assistant_tool_calls.append({
                                "id": tc["id"],
                                "type": "function",
                                "function": {"name": tc["name"], "arguments": tc["arguments"]},
                            })
                        messages.append({"role": "assistant", "content": None, "tool_calls": assistant_tool_calls})

                        # Add tool results and emit status
                        for tc_item, result in results:
                            if isinstance(result, Exception):
                                result = f"[Error] {str(result)}"
                            summary = str(result)[:100]
                            yield f"event: status\ndata: {json.dumps({'phase': 'tool_result', 'tool': tc_item['name'], 'summary': summary}, ensure_ascii=False)}\n\n"
                            messages.append({
                                "role": "tool",
                                "tool_call_id": tc_item["id"],
                                "content": str(result),
                            })

                        yield f"event: status\ndata: {json.dumps({'phase': 'thinking'})}\n\n"
                        break  # break inner loop, continue outer loop for next round

                    elif event_type == "done":
                        break
                else:
                    # Inner loop completed without break (no tool_calls, no done)
                    break

                if not got_tool_calls:
                    # "done" was received
                    break

            reply = full_reply

            # ── 6. Persist messages ───────────────────────────────────
            await db.execute(
                "INSERT INTO agent_chat_messages (session_id, user_id, role, content, context_type, context_ref) VALUES (?, ?, 'user', ?, ?, ?)",
                (session_id, user["id"], data.message, data.angle_context and "angle" or (data.demand_id and "demand" or ""), str(data.demand_id or "")),
            )
            cur_msg = await db.execute(
                "INSERT INTO agent_chat_messages (session_id, user_id, role, content) VALUES (?, NULL, 'agent', ?)",
                (session_id, reply),
            )
            msg_id = cur_msg.lastrowid

            # Update session title
            cur = await db.execute("SELECT title FROM agent_chat_sessions WHERE id=?", (session_id,))
            row = await cur.fetchone()
            session_title = None
            if row and not row["title"]:
                session_title = data.message[:50] + ("..." if len(data.message) > 50 else "")
                await db.execute("UPDATE agent_chat_sessions SET title=?, updated_at=CURRENT_TIMESTAMP WHERE id=?", (session_title, session_id))
            else:
                await db.execute("UPDATE agent_chat_sessions SET updated_at=CURRENT_TIMESTAMP WHERE id=?", (session_id,))
            await db.commit()

            # ── 6b. Mirror to roundtable room ────────────────────────
            if roundtable_room_id:
                try:
                    now_rt = datetime.now().isoformat()
                    sender_name = user.get("display_name") or user.get("username", "用户")
                    await db.execute(
                        """INSERT INTO roundtable_messages
                           (room_id, sender_type, sender_name, user_id, content, created_at)
                           VALUES (?, 'human', ?, ?, ?, ?)""",
                        (roundtable_room_id, sender_name, user["id"], data.message, now_rt),
                    )
                    await db.execute(
                        """INSERT INTO roundtable_messages
                           (room_id, sender_type, sender_name, user_id, content, created_at)
                           VALUES (?, 'pm_agent', 'PM Agent', NULL, ?, ?)""",
                        (roundtable_room_id, reply, now_rt),
                    )
                    if session_title:
                        await db.execute(
                            "UPDATE roundtable_rooms SET title=?, updated_at=? WHERE id=?",
                            (f"PM Agent: {session_title}", now_rt, roundtable_room_id),
                        )
                    else:
                        await db.execute(
                            "UPDATE roundtable_rooms SET updated_at=? WHERE id=?",
                            (now_rt, roundtable_room_id),
                        )
                    await db.commit()
                except Exception as e:
                    logging.getLogger("agent").warning(f"Failed to mirror to roundtable room {roundtable_room_id}: {e}")

            # ── 7. Extract insights ───────────────────────────────────
            if _memory and "[INSIGHT:" in reply:
                insights = _re.findall(r'\[INSIGHT:\s*(.+?)\]', reply)
                for insight in insights:
                    await _memory.store_feedback(
                        feedback_type="chat_insight",
                        target=f"session:{session_id}",
                        vote=1,
                        context={"insight": insight, "user": user.get("display_name", ""), "demand_id": data.demand_id},
                    )
                reply = _re.sub(r'\s*\[INSIGHT:\s*.+?\]', '', reply).strip()

            # ── 8. Auto-memory (background, best-effort) ─────────────
            try:
                auto_mem_prompt = f"""回顾这段对话，提取值得长期记住的内容。只提取以下类型：
- decision: 团队做出的决策（做/不做某事）
- preference: 用户偏好或方向倾向
- insight: 产品/市场洞察
- feedback: 对Agent行为的反馈

用户说: {data.message}
Agent回复: {reply[:500]}

如果有值得记住的，返回JSON: {{"memories": [{{"content": "...", "category": "decision|preference|insight|feedback"}}]}}
如果没有，返回: {{"memories": []}}
只返回JSON，不要其他文字。"""

                mem_resp = await ai_chat(
                    "你是记忆提取助手。从对话中提取值得长期记住的内容，输出纯 JSON。",
                    auto_mem_prompt,
                    temperature=0.1,
                )
                json_match = _re.search(r'\{.*\}', mem_resp, _re.DOTALL)
                if json_match:
                    mem_data = json.loads(json_match.group())
                    memories = mem_data.get("memories", [])
                    if memories:
                        from agent.tools import _remember
                        for m in memories[:3]:
                            await _remember(m.get("content", ""), m.get("category", "insight"))
            except Exception:
                pass

            yield f"event: done\ndata: {json.dumps({'session_id': session_id, 'message_id': msg_id})}\n\n"

        except Exception as e:
            logging.getLogger("agent").error(f"Stream error: {e}", exc_info=True)
            yield f"event: error\ndata: {json.dumps({'message': str(e)}, ensure_ascii=False)}\n\n"
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


@router.get("/chat/history")
async def chat_history(user=Depends(get_current_user), limit: int = 50):
    """Load recent chat sessions with messages."""
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT * FROM agent_chat_sessions WHERE user_id=? ORDER BY updated_at DESC LIMIT ?", (user["id"], limit,)
        )
        sessions = [dict(r) for r in await cur.fetchall()]
        return {"sessions": sessions}
    finally:
        await db.close()


@router.get("/chat/session/{session_id}")
async def chat_session_messages(session_id: int, user=Depends(get_current_user)):
    """Load all messages for a session."""
    db = await get_db()
    try:
        # Verify session belongs to this user
        cur = await db.execute(
            "SELECT id FROM agent_chat_sessions WHERE id=? AND user_id=?",
            (session_id, user["id"]),
        )
        if not await cur.fetchone():
            raise HTTPException(403, "无权访问此会话")

        cur = await db.execute(
            """SELECT m.*, u.display_name FROM agent_chat_messages m
               LEFT JOIN users u ON m.user_id = u.id
               WHERE m.session_id=? ORDER BY m.id""",
            (session_id,),
        )
        messages = [dict(r) for r in await cur.fetchall()]
        return {"messages": messages}
    finally:
        await db.close()


@router.post("/prototypes/{demand_id}/regenerate")
async def regenerate_prototype(demand_id: int, data: dict = None):
    """Regenerate prototype with feedback incorporated."""
    try:
        from agent.prototype_generator import regenerate_with_feedback
        feedback_text = (data or {}).get("feedback", "")
        result = await regenerate_with_feedback(demand_id, feedback_text, _memory)
        return {"status": "ok", **result}
    except Exception as e:
        return {"error": str(e)}


# ── 中间产物 API ──────────────────────────────────────────────────────

@router.get("/artifacts/{demand_id}")
async def get_artifacts(demand_id: int):
    """查看某需求的完整分析链路（signal_report → simulation → decision_rationale）。"""
    db = await get_db()
    try:
        cur = await db.execute(
            """SELECT id, run_id, demand_id, artifact_type, content, created_at
               FROM agent_artifacts
               WHERE demand_id = ?
               ORDER BY created_at DESC""",
            (demand_id,),
        )
        rows = []
        for r in await cur.fetchall():
            row = dict(r)
            try:
                row["content"] = json.loads(row.get("content") or "{}")
            except json.JSONDecodeError:
                pass
            rows.append(row)
        return {"artifacts": rows}
    finally:
        await db.close()


# ── 周度自评报告 ──────────────────────────────────────────────────────

@router.get("/retro")
async def get_retro():
    """获取最新的周度自评报告。"""
    db = await get_db()
    try:
        cur = await db.execute(
            """SELECT content FROM knowledge_docs
               WHERE category='agent_retro'
               ORDER BY created_at DESC LIMIT 1"""
        )
        row = await cur.fetchone()
        if not row:
            return {"report": None, "message": "No retro report yet. Trigger one with POST /agent/retro/generate"}
        return {"report": row[0]}
    finally:
        await db.close()


@router.post("/retro/generate")
async def generate_retro():
    """手动触发生成周度自评报告。"""
    from agent.weekly_retro import generate_weekly_retro
    db = await get_db()
    try:
        result = await generate_weekly_retro(db, _memory)
        return {"status": "ok", "retro": result}
    finally:
        await db.close()


class PrototypeFeedback(BaseModel):
    score: int  # 1-5
    notes: Optional[str] = None


@router.post("/prototypes/{prototype_id}/feedback")
async def submit_prototype_feedback(prototype_id: int, data: PrototypeFeedback):
    db = await get_db()
    try:
        cur = await db.execute("SELECT * FROM prototypes WHERE id=?", (prototype_id,))
        row = await cur.fetchone()
        if not row:
            return {"error": "Prototype not found"}

        proto = dict(row)
        notes_list = json.loads(proto.get("feedback_notes") or "[]")
        notes_list.append({
            "score": data.score,
            "notes": data.notes or "",
            "timestamp": datetime.utcnow().isoformat(),
        })

        await db.execute(
            "UPDATE prototypes SET feedback_score=?, feedback_notes=? WHERE id=?",
            (data.score, json.dumps(notes_list, ensure_ascii=False), prototype_id),
        )
        await db.commit()

        # Store in memory
        if _memory:
            await _memory.store_prototype_feedback(
                prototype_id=prototype_id,
                demand_id=proto["demand_id"],
                score=data.score,
                notes=data.notes or "",
            )

        return {"status": "ok"}
    finally:
        await db.close()


# ── TTS Proxy (Noiz API) ──────────────────────────────────────────────

import os
import httpx
from fastapi.responses import Response

NOIZ_API_KEY = os.getenv("NOIZ_API_KEY", "")
NOIZ_VOICE_ID = os.getenv("NOIZ_VOICE_ID", "1a0d5733")  # saori


class TTSRequest(BaseModel):
    text: str
    voice_id: str = ""


@router.post("/tts")
async def text_to_speech(data: TTSRequest, user=Depends(get_current_user)):
    """Proxy TTS request to Noiz API, return audio/mp3."""
    voice_id = data.voice_id or NOIZ_VOICE_ID
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                "https://noiz.ai/v1/text-to-speech",
                headers={"Authorization": NOIZ_API_KEY},
                data={
                    "text": data.text,
                    "voice_id": voice_id,
                    "output_format": "mp3",
                    "speed": "1.0",
                },
            )
            if resp.status_code == 200 and len(resp.content) > 100:
                return Response(content=resp.content, media_type="audio/mpeg")
            return Response(content=b"", status_code=502)
    except Exception:
        return Response(content=b"", status_code=502)
