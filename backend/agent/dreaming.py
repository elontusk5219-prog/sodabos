"""
Agent Dreaming — 记忆整理与方法论提炼。

灵感：人类在睡眠时整理白天的记忆，压缩、归纳、形成长期认知。
Agent 在空闲时做同样的事：
1. 记忆压缩 — 合并相似记忆，去除冗余
2. 方法论提炼 — 从多条记忆中归纳出可复用的规则/方法论
3. 矛盾检测 — 发现记忆间的矛盾，生成问题向人类确认
4. 遗忘衰减 — 降低过时记忆的权重

触发方式：
- 定时任务（每天凌晨）
- 记忆条数超过阈值
- 手动触发（API）
"""

import json
import os
import re
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional

from ai.client import chat_multi

logger = logging.getLogger("dreaming")

# ── Unified memory access ────────────────────────────────────────────────────
# Delegates to AgentMemory when wired (via set_dreaming_memory), else falls back
# to tools.py file-based access for standalone scripts.

_agent_memory = None


def set_dreaming_memory(mem):
    """Wire the shared AgentMemory instance. Called from main.py at startup."""
    global _agent_memory
    _agent_memory = mem


def _load_memory() -> dict:
    if _agent_memory:
        return _agent_memory.load_memory_dict()
    from agent.tools import _load_memory as _tools_load
    return _tools_load()


def _save_memory(data: dict):
    if _agent_memory:
        _agent_memory.save_memory_dict(data)
        return
    from agent.tools import _save_memory as _tools_save
    _tools_save(data)


def _get_memory_dir() -> str:
    if _agent_memory:
        return _agent_memory.memory_dir
    from agent.tools import MEMORY_DIR
    return MEMORY_DIR


# ── Constants ─────────────────────────────────────────────────────────────────

def _methodology_file():
    return os.path.join(_get_memory_dir(), "methodologies.json")

def _questions_file():
    return os.path.join(_get_memory_dir(), "pending_questions.json")

def _dream_log_file():
    return os.path.join(_get_memory_dir(), "dream_log.json")

# Thresholds
COMPRESS_THRESHOLD = 30      # Compress when memories exceed this
MAX_METHODOLOGIES = 50       # Cap methodology count
MAX_PENDING_QUESTIONS = 20   # Cap pending questions


# ── File helpers ──────────────────────────────────────────────────────────────

def _load_json(path: str) -> dict:
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            pass
    return {}


def _save_json(path: str, data: dict):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


# ── AI helper ─────────────────────────────────────────────────────────────────

async def _ai(system: str, user: str, temperature: float = 0.3) -> str:
    """Thin AI call wrapper."""
    try:
        return await chat_multi([
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ], temperature=temperature)
    except Exception as e:
        logger.error(f"Dreaming AI call failed: {e}")
        return ""


# ── Phase 1: Memory Compression ──────────────────────────────────────────────

async def compress_memories() -> dict:
    """
    合并相似记忆，去除冗余。
    将 N 条原始记忆压缩为更少的、更精炼的记忆。
    """
    mem = _load_memory()
    memories = mem.get("memories", [])

    if len(memories) < COMPRESS_THRESHOLD:
        return {"status": "skip", "reason": f"memories count ({len(memories)}) below threshold ({COMPRESS_THRESHOLD})"}

    # Group by category
    by_cat: dict[str, list] = {}
    for m in memories:
        cat = m.get("category", "general")
        by_cat.setdefault(cat, []).append(m)

    compressed_all = []
    stats = {"original": len(memories), "compressed": 0, "by_category": {}}

    for cat, items in by_cat.items():
        if len(items) <= 3:
            # Too few to compress, keep as-is
            compressed_all.extend(items)
            stats["by_category"][cat] = {"before": len(items), "after": len(items)}
            continue

        # Feed to AI for compression
        items_text = "\n".join(
            f"- [{i+1}] {m.get('content', '')}" for i, m in enumerate(items)
        )

        result = await _ai(
            system="""你是记忆整理助手。任务：将多条相似或相关的记忆合并压缩。

规则：
1. 合并含义重复或高度相关的记忆为一条更精炼的表述
2. 保留所有独特的信息点，不丢失关键细节
3. 如果某条记忆是独立的、不能与其他合并，保留原文
4. 输出的每条记忆应该是 actionable 的（可执行的洞察或决策）
5. 保留时间上最新的信息，如果有矛盾以最新为准

输出纯 JSON:
{"compressed": [{"content": "压缩后的记忆", "source_count": 合并了几条原始记忆}]}""",

            user=f"""分类: {cat}
共 {len(items)} 条记忆：
{items_text}

请压缩合并这些记忆。""",
        )

        json_match = re.search(r'\{.*\}', result, re.DOTALL)
        if json_match:
            try:
                data = json.loads(json_match.group())
                for c in data.get("compressed", []):
                    compressed_all.append({
                        "content": c["content"],
                        "category": cat,
                        "source_count": c.get("source_count", 1),
                        "compressed_at": datetime.now(timezone.utc).isoformat(),
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                    })
                stats["by_category"][cat] = {
                    "before": len(items),
                    "after": len(data.get("compressed", [])),
                }
            except json.JSONDecodeError:
                compressed_all.extend(items)
                stats["by_category"][cat] = {"before": len(items), "after": len(items)}
        else:
            compressed_all.extend(items)
            stats["by_category"][cat] = {"before": len(items), "after": len(items)}

    # Save compressed memories
    mem["memories"] = compressed_all
    # Archive originals
    mem["_last_compression_archive"] = memories
    mem["_last_compression_at"] = datetime.now(timezone.utc).isoformat()
    _save_memory(mem)

    stats["compressed"] = len(compressed_all)
    logger.info(f"Memory compression: {stats['original']} → {stats['compressed']}")
    return {"status": "ok", **stats}


# ── Phase 2: Methodology Extraction ──────────────────────────────────────────

async def extract_methodologies() -> dict:
    """
    从记忆 + 决策 + 教训中提炼方法论。
    方法论 = 可复用的规则/原则/模式，指导未来决策。
    """
    mem = _load_memory()
    memories = mem.get("memories", [])
    decisions = mem.get("decisions", [])
    lessons = mem.get("learned_lessons", [])

    if not memories and not decisions:
        return {"status": "skip", "reason": "no memories or decisions to analyze"}

    # Load existing methodologies
    meth_store = _load_json(_methodology_file())
    existing = meth_store.get("methodologies", [])
    existing_text = "\n".join(f"- {m['title']}: {m['content']}" for m in existing) if existing else "(暂无)"

    # Build input for AI
    mem_text = "\n".join(f"- [{m.get('category', '')}] {m.get('content', '')}" for m in memories[-30:])
    dec_text = "\n".join(
        f"- {'✅通过' if d.get('approved') else '❌拒绝'}: {d.get('feedback', d.get('decision', ''))}"
        for d in decisions[-20:]
    )
    les_text = "\n".join(f"- {l}" for l in lessons[-10:]) if lessons else "(暂无)"

    result = await _ai(
        system="""你是产品方法论提炼专家。任务：从大量零散的记忆、决策和教训中，归纳出高层次的方法论/原则。

方法论的特征：
1. 可复用 — 不是单一事件的记录，而是可以指导多种决策的规则
2. 具体可执行 — 不是空泛的大道理，而是具体的判断标准
3. 来自实践 — 从真实经验中归纳，不是教科书理论
4. 有边界条件 — 说明在什么情况下适用/不适用

输出纯 JSON:
{
  "new_methodologies": [
    {
      "title": "方法论简称（5-15字）",
      "content": "具体描述（50-150字）",
      "applies_to": "适用场景",
      "derived_from": "从哪些记忆/教训归纳而来（简述）"
    }
  ],
  "updated_methodologies": [
    {
      "title": "已有方法论的标题",
      "content": "更新后的内容",
      "update_reason": "为什么需要更新"
    }
  ]
}

如果没有值得新增或更新的方法论，返回空数组。""",

        user=f"""已有方法论：
{existing_text}

最近记忆（{len(memories)}条，展示最近30条）：
{mem_text}

最近决策（{len(decisions)}条，展示最近20条）：
{dec_text}

教训记录：
{les_text}

请归纳出新的方法论，或更新已有方法论。""",
    )

    json_match = re.search(r'\{.*\}', result, re.DOTALL)
    if not json_match:
        return {"status": "error", "reason": "AI did not return valid JSON"}

    try:
        data = json.loads(json_match.group())
    except json.JSONDecodeError:
        return {"status": "error", "reason": "JSON parse failed"}

    new_meths = data.get("new_methodologies", [])
    updated_meths = data.get("updated_methodologies", [])

    # Apply new methodologies
    for nm in new_meths:
        existing.append({
            "title": nm["title"],
            "content": nm["content"],
            "applies_to": nm.get("applies_to", ""),
            "derived_from": nm.get("derived_from", ""),
            "created_at": datetime.now(timezone.utc).isoformat(),
            "version": 1,
        })

    # Apply updates
    for um in updated_meths:
        for ex in existing:
            if ex["title"] == um.get("title"):
                ex["content"] = um["content"]
                ex["update_reason"] = um.get("update_reason", "")
                ex["updated_at"] = datetime.now(timezone.utc).isoformat()
                ex["version"] = ex.get("version", 1) + 1
                break

    # Cap
    if len(existing) > MAX_METHODOLOGIES:
        existing = existing[-MAX_METHODOLOGIES:]

    meth_store["methodologies"] = existing
    meth_store["last_extracted_at"] = datetime.now(timezone.utc).isoformat()
    _save_json(_methodology_file(), meth_store)

    logger.info(f"Methodology extraction: +{len(new_meths)} new, {len(updated_meths)} updated, total {len(existing)}")
    return {
        "status": "ok",
        "new": len(new_meths),
        "updated": len(updated_meths),
        "total": len(existing),
    }


# ── Phase 3: Contradiction Detection & Question Generation ───────────────────

async def detect_contradictions_and_questions() -> dict:
    """
    检测记忆间的矛盾，发现知识盲区，生成需要向人类确认的问题。
    """
    mem = _load_memory()
    memories = mem.get("memories", [])
    decisions = mem.get("decisions", [])
    meth_store = _load_json(_methodology_file())
    methodologies = meth_store.get("methodologies", [])

    if len(memories) < 5:
        return {"status": "skip", "reason": "not enough memories"}

    # Load existing questions to avoid duplicates
    q_store = _load_json(_questions_file())
    existing_qs = q_store.get("questions", [])
    existing_q_text = "\n".join(f"- {q['question']}" for q in existing_qs) if existing_qs else "(暂无)"

    mem_text = "\n".join(f"- [{m.get('category', '')}] {m.get('content', '')}" for m in memories[-40:])
    meth_text = "\n".join(f"- {m['title']}: {m['content']}" for m in methodologies) if methodologies else "(暂无)"

    result = await _ai(
        system="""你是 PM Agent 的自我审视模块。任务：

1. **矛盾检测** — 找出记忆中相互矛盾的信息（比如对同一问题有不同结论）
2. **知识盲区** — 发现需要但缺乏的信息（比如做了决策但缺少关键数据）
3. **方法论质疑** — 检查方法论是否被新证据推翻
4. **确认需求** — 识别需要向人类确认的模糊点

对每个发现，生成一个具体的问题，可以在圆桌讨论中向团队提出。

输出纯 JSON:
{
  "questions": [
    {
      "question": "具体的问题（中文）",
      "type": "contradiction|blind_spot|methodology_challenge|confirmation",
      "context": "为什么要问这个问题（简述背景）",
      "priority": "high|medium|low",
      "related_memories": "相关的记忆索引或简述"
    }
  ]
}

只生成真正有价值的问题（最多5个），不要问显而易见或无关紧要的问题。
如果没有值得问的，返回空数组。""",

        user=f"""当前记忆（最近40条）：
{mem_text}

已有方法论：
{meth_text}

已经提过的问题（避免重复）：
{existing_q_text}

请检测矛盾、盲区，生成新的问题。""",
    )

    json_match = re.search(r'\{.*\}', result, re.DOTALL)
    if not json_match:
        return {"status": "error", "reason": "AI did not return valid JSON"}

    try:
        data = json.loads(json_match.group())
    except json.JSONDecodeError:
        return {"status": "error", "reason": "JSON parse failed"}

    new_questions = data.get("questions", [])
    for q in new_questions:
        q["created_at"] = datetime.now(timezone.utc).isoformat()
        q["status"] = "pending"  # pending → asked → answered
        existing_qs.append(q)

    # Cap
    if len(existing_qs) > MAX_PENDING_QUESTIONS:
        # Remove oldest answered ones first, then oldest pending
        answered = [q for q in existing_qs if q.get("status") == "answered"]
        pending = [q for q in existing_qs if q.get("status") != "answered"]
        existing_qs = pending[-MAX_PENDING_QUESTIONS:]

    q_store["questions"] = existing_qs
    q_store["last_checked_at"] = datetime.now(timezone.utc).isoformat()
    _save_json(_questions_file(), q_store)

    logger.info(f"Question generation: +{len(new_questions)} questions, total pending: {len([q for q in existing_qs if q.get('status') == 'pending'])}")
    return {
        "status": "ok",
        "new_questions": len(new_questions),
        "total_pending": len([q for q in existing_qs if q.get("status") == "pending"]),
        "questions": new_questions,
    }


# ── Phase 4: Create Checkpoints + Post to Roundtable ──────────────────────────

async def ask_pending_questions(room_id: Optional[int] = None) -> dict:
    """
    将 pending 问题：
    1. 写入 agent_checkpoints 表（出现在 PM Agent 待审批面板）
    2. 发到专属圆桌房间（方便团队讨论）
    """
    from database import get_db
    import secrets
    import uuid

    q_store = _load_json(_questions_file())
    pending = [q for q in q_store.get("questions", []) if q.get("status") == "pending"]

    if not pending:
        return {"status": "skip", "reason": "no pending questions"}

    # Pick top priority questions (max 3 per dream cycle)
    priority_order = {"high": 0, "medium": 1, "low": 2}
    pending.sort(key=lambda q: priority_order.get(q.get("priority", "low"), 2))
    to_ask = pending[:3]

    run_id = f"dream-{uuid.uuid4().hex[:8]}"

    db = await get_db()
    try:
        # Create a dedicated dream roundtable room
        if not room_id:
            now = datetime.now()
            date_str = now.strftime("%m/%d")
            title = f"💭 PM Agent 做梦笔记 ({date_str})"
            topic = "PM Agent 在整理记忆时发现了一些问题，想向团队请教。"
            token = secrets.token_urlsafe(18)

            cur = await db.execute(
                """INSERT INTO roundtable_rooms
                   (title, topic, status, invite_token, created_at, updated_at)
                   VALUES (?, ?, 'active', ?, ?, ?)""",
                (title, topic, token, now.isoformat(), now.isoformat()),
            )
            room_id = cur.lastrowid
            await db.commit()
            logger.info(f"Created dream room {room_id}: {title}")

        asked = 0
        checkpoint_ids = []
        for q in to_ask:
            type_label = {
                "contradiction": "🔀 发现矛盾",
                "blind_spot": "🔍 知识盲区",
                "methodology_challenge": "⚡ 方法论质疑",
                "confirmation": "❓ 需要确认",
            }.get(q.get("type", ""), "💭 有个问题")

            now = datetime.now().isoformat()

            # 1. Insert into agent_checkpoints (appears in PM Agent pending panel)
            proposal_json = json.dumps({
                "question": q["question"],
                "context": q.get("context", ""),
                "type": q.get("type", ""),
                "source": "dreaming",
                "priority": q.get("priority", "medium"),
                "room_id": room_id,
            }, ensure_ascii=False)

            cur = await db.execute(
                """INSERT INTO agent_checkpoints
                   (run_id, checkpoint_type, demand_id, proposal, status, urgency, created_at)
                   VALUES (?, 'question', NULL, ?, 'pending', 'ask', ?)""",
                (run_id, proposal_json, now),
            )
            checkpoint_ids.append(cur.lastrowid)

            # 2. Also post to roundtable for discussion context
            message = f"**{type_label}**\n\n{q['question']}\n\n> 背景: {q.get('context', '')}"
            await db.execute(
                """INSERT INTO roundtable_messages
                   (room_id, sender_type, sender_name, content, created_at)
                   VALUES (?, 'pm_agent', 'PM Agent', ?, ?)""",
                (room_id, message, now),
            )

            # Mark as asked
            q["status"] = "asked"
            q["asked_at"] = now
            q["asked_in_room"] = room_id
            asked += 1

        await db.commit()
        _save_json(_questions_file(), q_store)

        logger.info(f"Asked {asked} questions: checkpoints {checkpoint_ids}, room {room_id}")
        return {"status": "ok", "asked": asked, "room_id": room_id, "checkpoint_ids": checkpoint_ids}
    finally:
        await db.close()


# ── Main Dream Cycle ─────────────────────────────────────────────────────────

async def dream_cycle(ask_questions: bool = True, room_id: Optional[int] = None) -> dict:
    """
    执行完整的"做梦"循环：
    1. 压缩记忆
    2. 提炼方法论
    3. 检测矛盾 & 生成问题
    4. (可选) 在圆桌中提问
    """
    logger.info("🌙 Dream cycle starting...")
    results = {}

    # Phase 1: Compress
    try:
        results["compression"] = await compress_memories()
    except Exception as e:
        logger.error(f"Dream phase 1 (compression) failed: {e}", exc_info=True)
        results["compression"] = {"status": "error", "error": str(e)}

    # Phase 2: Extract methodologies
    try:
        results["methodologies"] = await extract_methodologies()
    except Exception as e:
        logger.error(f"Dream phase 2 (methodologies) failed: {e}", exc_info=True)
        results["methodologies"] = {"status": "error", "error": str(e)}

    # Phase 3: Detect contradictions & generate questions
    try:
        results["questions"] = await detect_contradictions_and_questions()
    except Exception as e:
        logger.error(f"Dream phase 3 (questions) failed: {e}", exc_info=True)
        results["questions"] = {"status": "error", "error": str(e)}

    # Phase 4: Ask questions (optional)
    if ask_questions and results.get("questions", {}).get("new_questions", 0) > 0:
        try:
            results["asked"] = await ask_pending_questions(room_id)
        except Exception as e:
            logger.error(f"Dream phase 4 (ask) failed: {e}", exc_info=True)
            results["asked"] = {"status": "error", "error": str(e)}

    # Log the dream
    dream_log = _load_json(_dream_log_file())
    logs = dream_log.setdefault("logs", [])
    logs.append({
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "results": results,
    })
    # Keep last 30 dream logs
    if len(logs) > 30:
        dream_log["logs"] = logs[-30:]
    _save_json(_dream_log_file(), dream_log)

    logger.info(f"🌙 Dream cycle complete: {json.dumps({k: v.get('status', '?') for k, v in results.items()}, ensure_ascii=False)}")
    return results


# ── Query helpers (for PM Agent to use) ──────────────────────────────────────

def get_methodologies() -> list[dict]:
    """获取所有方法论，供 PM Agent 在对话中参考。"""
    store = _load_json(_methodology_file())
    return store.get("methodologies", [])


def get_pending_questions() -> list[dict]:
    """获取待解答的问题。"""
    store = _load_json(_questions_file())
    return [q for q in store.get("questions", []) if q.get("status") in ("pending", "asked")]


def answer_question(question_text: str, answer: str) -> bool:
    """标记问题为已回答，并将答案存入记忆。"""
    store = _load_json(_questions_file())
    for q in store.get("questions", []):
        if q.get("question") == question_text and q.get("status") in ("pending", "asked"):
            q["status"] = "answered"
            q["answer"] = answer
            q["answered_at"] = datetime.now(timezone.utc).isoformat()
            _save_json(_questions_file(), store)
            return True
    return False
