"""
教训复盘 API
POST   /api/lessons              创建教训
GET    /api/lessons              教训列表（支持 category/severity 筛选）
GET    /api/lessons/insights     AI 分析所有教训的模式
GET    /api/lessons/{id}         教训详情
PATCH  /api/lessons/{id}         更新教训
DELETE /api/lessons/{id}         删除教训 + 清理 chunks
POST   /api/lessons/{id}/learn   让 Agent 深度学习教训
"""

import json
import re
import logging
from fastapi import APIRouter, HTTPException, Query, Depends
from pydantic import BaseModel
from typing import Optional
from database import get_db
from auth.deps import get_current_user
from utils.chunks import split_chunks

logger = logging.getLogger("lessons")

router = APIRouter()

# ── Lazy table init ──────────────────────────────────────────────────────────
_table_ready = False

LESSON_DOC_ID_OFFSET = 100000  # knowledge_docs id offset for lessons


async def _ensure_tables():
    global _table_ready
    if _table_ready:
        return
    db = await get_db()
    try:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS lessons (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                category TEXT NOT NULL DEFAULT 'other',
                severity TEXT NOT NULL DEFAULT 'medium',
                background TEXT DEFAULT '',
                lesson TEXT NOT NULL,
                prevention_rule TEXT DEFAULT '',
                related_demand_ids TEXT DEFAULT '[]',
                related_project_id INTEGER,
                created_by INTEGER REFERENCES users(id),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_lessons_category ON lessons(category)"
        )
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_lessons_severity ON lessons(severity)"
        )
        await db.commit()
        _table_ready = True
    finally:
        await db.close()


# ── Pydantic models ──────────────────────────────────────────────────────────

class LessonCreate(BaseModel):
    title: str
    category: str = "other"
    severity: str = "medium"
    background: str = ""
    lesson: str
    prevention_rule: str = ""
    related_demand_ids: list[int] = []
    related_project_id: Optional[int] = None


class LessonUpdate(BaseModel):
    title: Optional[str] = None
    category: Optional[str] = None
    severity: Optional[str] = None
    background: Optional[str] = None
    lesson: Optional[str] = None
    prevention_rule: Optional[str] = None
    related_demand_ids: Optional[list[int]] = None
    related_project_id: Optional[int] = None


# ── Chunk helpers (delegated to utils.chunks) ────────────────────────────────

CHUNK_SIZE = 500


def _split_chunks(text: str) -> list[str]:
    """Split text by paragraphs, max CHUNK_SIZE chars per chunk."""
    return split_chunks(text, chunk_size=CHUNK_SIZE, overlap=0)


def _lesson_to_text(title: str, background: str, lesson: str, prevention_rule: str, category: str) -> str:
    """Combine lesson fields into indexable text."""
    parts = [f"[教训复盘] {title}"]
    if category:
        parts.append(f"分类: {category}")
    if background:
        parts.append(f"背景:\n{background}")
    if lesson:
        parts.append(f"教训:\n{lesson}")
    if prevention_rule:
        parts.append(f"预防规则:\n{prevention_rule}")
    return "\n\n".join(parts)


async def _index_lesson_chunks(db, lesson_id: int, title: str, background: str, lesson: str, prevention_rule: str, category: str):
    """Index lesson into knowledge_chunks for RAG retrieval."""
    doc_id = lesson_id + LESSON_DOC_ID_OFFSET

    # Ensure a knowledge_docs entry exists for this lesson
    cur = await db.execute("SELECT id FROM knowledge_docs WHERE id = ?", (doc_id,))
    existing = await cur.fetchone()

    text = _lesson_to_text(title, background, lesson, prevention_rule, category)
    chunks = _split_chunks(text)

    if existing:
        # Update: delete old chunks first
        await db.execute("DELETE FROM knowledge_chunks WHERE doc_id = ?", (doc_id,))
        await db.execute(
            "UPDATE knowledge_docs SET title=?, category=?, char_count=?, chunks_count=?, created_by=? WHERE id=?",
            (f"[教训] {title}", f"lesson:{category}", len(text), len(chunks), "system", doc_id),
        )
    else:
        await db.execute(
            "INSERT INTO knowledge_docs (id, title, category, file_type, char_count, chunks_count, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (doc_id, f"[教训] {title}", f"lesson:{category}", "lesson", len(text), len(chunks), "system"),
        )

    for i, chunk in enumerate(chunks):
        await db.execute(
            "INSERT INTO knowledge_chunks (doc_id, chunk_index, content) VALUES (?, ?, ?)",
            (doc_id, i, chunk),
        )


async def _remove_lesson_chunks(db, lesson_id: int):
    """Remove lesson chunks from knowledge store."""
    doc_id = lesson_id + LESSON_DOC_ID_OFFSET
    await db.execute("DELETE FROM knowledge_chunks WHERE doc_id = ?", (doc_id,))
    await db.execute("DELETE FROM knowledge_docs WHERE id = ?", (doc_id,))


async def _auto_bridge_prevention_rule(db, lesson_id: int, prevention_rule: str, title: str):
    """创建教训时自动将 prevention_rule 字段桥接到 prevention_rules 表（候选状态）。"""
    try:
        cur = await db.execute(
            "SELECT MAX(CAST(SUBSTR(rule_id, 3) AS INTEGER)) FROM prevention_rules"
        )
        row = await cur.fetchone()
        max_rule_id = (row[0] or 0) if row else 0
    except Exception:
        max_rule_id = 0

    rule_id = f"R-{max_rule_id + 1:04d}"
    # 从规则文本中提取关键词
    keywords = [w for w in prevention_rule.replace("，", " ").replace("、", " ").replace("。", " ").split()
               if len(w) > 1][:5]

    await db.execute("""
        INSERT OR IGNORE INTO prevention_rules
        (rule_id, pattern, pattern_keywords, action, action_params,
         confidence, source_type, source_ids, status)
        VALUES (?, ?, ?, 'warn', ?, 0.5, 'lesson', ?, 'candidate')
    """, (
        rule_id,
        prevention_rule[:500],
        json.dumps(keywords, ensure_ascii=False),
        json.dumps({"warning_text": prevention_rule[:200]}, ensure_ascii=False),
        json.dumps([lesson_id]),
    ))
    logger.info(f"Auto-bridged lesson {lesson_id} prevention rule → {rule_id}")


async def _remember_lesson(title: str, lesson: str, prevention_rule: str):
    """Write lesson to agent local memory for fast recall."""
    try:
        from api.agent import _memory
        if _memory:
            await _memory.store_feedback(
                feedback_type="lesson_learned",
                target=title,
                vote=0,
                context={
                    "lesson": lesson[:500],
                    "prevention_rule": prevention_rule[:500],
                },
            )
    except Exception as e:
        logger.warning(f"Failed to remember lesson: {e}")


# ── Category constants ───────────────────────────────────────────────────────

CATEGORY_NAMES = {
    "product_direction": "产品方向",
    "tech_choice": "技术选型",
    "market_judgment": "市场判断",
    "execution": "执行问题",
    "other": "其他",
}

SEVERITY_NAMES = {
    "high": "严重",
    "medium": "中等",
    "low": "轻微",
}


# ── Routes ───────────────────────────────────────────────────────────────────

@router.get("")
async def list_lessons(
    category: str = Query(""),
    severity: str = Query(""),
    project_id: int = Query(0),
    limit: int = Query(50),
    offset: int = Query(0),
    user=Depends(get_current_user),
):
    """教训列表，支持分类、严重程度和项目筛选。"""
    await _ensure_tables()
    db = await get_db()
    try:
        conditions = []
        params = []
        if category:
            conditions.append("l.category = ?")
            params.append(category)
        if severity:
            conditions.append("l.severity = ?")
            params.append(severity)
        if project_id:
            conditions.append("l.related_project_id = ?")
            params.append(project_id)

        where = " WHERE " + " AND ".join(conditions) if conditions else ""

        cur = await db.execute(
            f"""SELECT l.*, u.display_name AS creator_name
                FROM lessons l
                LEFT JOIN users u ON l.created_by = u.id
                {where}
                ORDER BY l.created_at DESC
                LIMIT ? OFFSET ?""",
            params + [limit, offset],
        )
        rows = await cur.fetchall()

        cur2 = await db.execute(f"SELECT COUNT(*) FROM lessons l{where}", params)
        total = (await cur2.fetchone())[0]

        return {"lessons": [dict(r) for r in rows], "total": total}
    finally:
        await db.close()


@router.post("")
async def create_lesson(data: LessonCreate, user=Depends(get_current_user)):
    """创建教训，自动索引到知识库用于 RAG 检索。"""
    await _ensure_tables()
    db = await get_db()
    try:
        cur = await db.execute(
            """INSERT INTO lessons (title, category, severity, background, lesson, prevention_rule, related_demand_ids, related_project_id, created_by)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                data.title,
                data.category,
                data.severity,
                data.background,
                data.lesson,
                data.prevention_rule,
                json.dumps(data.related_demand_ids),
                data.related_project_id,
                user["id"],
            ),
        )
        lesson_id = cur.lastrowid

        # Index into knowledge_chunks for RAG
        await _index_lesson_chunks(
            db, lesson_id, data.title, data.background,
            data.lesson, data.prevention_rule, data.category,
        )

        # 改造七：如果用户填写了 prevention_rule，自动桥接到 prevention_rules 表
        if data.prevention_rule and data.prevention_rule.strip():
            try:
                await _auto_bridge_prevention_rule(db, lesson_id, data.prevention_rule, data.title)
            except Exception as e:
                logger.warning(f"Auto-bridge prevention rule failed: {e}")

        await db.commit()

        # Store in agent memory (non-blocking)
        await _remember_lesson(data.title, data.lesson, data.prevention_rule)

        return {
            "id": lesson_id,
            "title": data.title,
            "category": data.category,
            "severity": data.severity,
        }
    finally:
        await db.close()


@router.get("/insights")
async def lesson_insights(user=Depends(get_current_user)):
    """AI 分析所有教训，返回模式总结。"""
    await _ensure_tables()
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT title, category, severity, lesson, prevention_rule FROM lessons ORDER BY created_at DESC LIMIT 100"
        )
        rows = await cur.fetchall()
    finally:
        await db.close()

    if not rows:
        return {
            "total": 0,
            "categories": {},
            "patterns": [],
            "suggestions": [],
            "summary": "暂无教训记录，请先添加教训。",
        }

    lessons_list = [dict(r) for r in rows]

    # Category distribution
    cat_counts: dict[str, int] = {}
    sev_counts: dict[str, int] = {}
    for l in lessons_list:
        cat = l.get("category", "other")
        sev = l.get("severity", "medium")
        cat_counts[cat] = cat_counts.get(cat, 0) + 1
        sev_counts[sev] = sev_counts.get(sev, 0) + 1

    # Try AI analysis
    ai_summary = ""
    patterns = []
    suggestions = []
    try:
        from ai.client import chat
        lessons_text = "\n\n".join(
            f"- [{CATEGORY_NAMES.get(l['category'], l['category'])}][{SEVERITY_NAMES.get(l['severity'], l['severity'])}] {l['title']}: {l['lesson'][:200]}"
            for l in lessons_list
        )

        prompt = f"""分析以下 {len(lessons_list)} 条教训复盘记录，提取关键模式和建议。

{lessons_text}

请输出 JSON 格式：
{{
  "patterns": ["模式1", "模式2", ...],
  "suggestions": ["建议1", "建议2", ...],
  "summary": "总结概述(100字以内)"
}}"""

        result = await chat(
            "你是一位资深产品总监，擅长从教训中提炼规律性认知。请用中文回答，输出纯 JSON。",
            prompt,
            temperature=0.3,
        )

        # Parse JSON from response
        json_match = re.search(r"\{[\s\S]*\}", result)
        if json_match:
            parsed = json.loads(json_match.group())
            patterns = parsed.get("patterns", [])
            suggestions = parsed.get("suggestions", [])
            ai_summary = parsed.get("summary", "")
    except Exception as e:
        logger.warning(f"AI insights analysis failed: {e}")
        ai_summary = f"AI 分析暂时不可用: {str(e)[:100]}"

    return {
        "total": len(lessons_list),
        "categories": {CATEGORY_NAMES.get(k, k): v for k, v in cat_counts.items()},
        "severities": {SEVERITY_NAMES.get(k, k): v for k, v in sev_counts.items()},
        "patterns": patterns,
        "suggestions": suggestions,
        "summary": ai_summary,
    }


@router.get("/{lesson_id}")
async def get_lesson(lesson_id: int, user=Depends(get_current_user)):
    """教训详情。"""
    await _ensure_tables()
    db = await get_db()
    try:
        cur = await db.execute(
            """SELECT l.*, u.display_name AS creator_name
               FROM lessons l
               LEFT JOIN users u ON l.created_by = u.id
               WHERE l.id = ?""",
            (lesson_id,),
        )
        row = await cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="教训不存在")
        return dict(row)
    finally:
        await db.close()


@router.patch("/{lesson_id}")
async def update_lesson(lesson_id: int, data: LessonUpdate, user=Depends(get_current_user)):
    """更新教训，重新索引知识库。"""
    await _ensure_tables()
    db = await get_db()
    try:
        # Check existence
        cur = await db.execute("SELECT * FROM lessons WHERE id = ?", (lesson_id,))
        existing = await cur.fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="教训不存在")

        updates = []
        params = []
        update_data = data.model_dump(exclude_none=True)

        if "related_demand_ids" in update_data:
            update_data["related_demand_ids"] = json.dumps(update_data["related_demand_ids"])

        for field, val in update_data.items():
            updates.append(f"{field} = ?")
            params.append(val)

        if not updates:
            return {"status": "ok", "message": "无更新内容"}

        updates.append("updated_at = CURRENT_TIMESTAMP")
        params.append(lesson_id)

        await db.execute(
            f"UPDATE lessons SET {', '.join(updates)} WHERE id = ?", params
        )

        # Re-index: fetch updated row
        cur = await db.execute("SELECT * FROM lessons WHERE id = ?", (lesson_id,))
        updated = dict(await cur.fetchone())

        await _index_lesson_chunks(
            db, lesson_id,
            updated["title"], updated["background"],
            updated["lesson"], updated["prevention_rule"],
            updated["category"],
        )

        await db.commit()
        return {"status": "ok", "id": lesson_id}
    finally:
        await db.close()


@router.delete("/{lesson_id}")
async def delete_lesson(lesson_id: int, user=Depends(get_current_user)):
    """删除教训 + 清理知识库 chunks。"""
    await _ensure_tables()
    db = await get_db()
    try:
        cur = await db.execute("SELECT id FROM lessons WHERE id = ?", (lesson_id,))
        if not await cur.fetchone():
            raise HTTPException(status_code=404, detail="教训不存在")

        await _remove_lesson_chunks(db, lesson_id)
        await db.execute("DELETE FROM lessons WHERE id = ?", (lesson_id,))
        await db.commit()
        return {"status": "deleted", "id": lesson_id}
    finally:
        await db.close()


@router.post("/{lesson_id}/learn")
async def learn_lesson(lesson_id: int, user=Depends(get_current_user)):
    """让 Agent 深度学习教训：提取预防规则和模式，存为结构化记忆。"""
    await _ensure_tables()
    db = await get_db()
    try:
        cur = await db.execute("SELECT * FROM lessons WHERE id = ?", (lesson_id,))
        row = await cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="教训不存在")
        lesson_data = dict(row)
    finally:
        await db.close()

    # AI extraction of prevention rules
    extracted = {"rules": [], "patterns": []}
    try:
        from ai.client import chat

        prompt = f"""深度分析这条教训，提取可操作的预防规则和行为模式。

标题: {lesson_data['title']}
分类: {CATEGORY_NAMES.get(lesson_data['category'], lesson_data['category'])}
严重程度: {SEVERITY_NAMES.get(lesson_data['severity'], lesson_data['severity'])}
背景: {lesson_data.get('background', '')}
教训: {lesson_data['lesson']}
现有预防规则: {lesson_data.get('prevention_rule', '')}

请输出 JSON 格式：
{{
  "rules": ["具体规则1", "具体规则2"],
  "patterns": ["识别模式1", "识别模式2"],
  "enhanced_prevention": "增强版预防规则(合并现有规则和新提取的规则)"
}}"""

        result = await chat(
            "你是产品管理专家，擅长从教训中提炼可执行的预防规则。请用中文回答，输出纯 JSON。",
            prompt,
            temperature=0.2,
        )

        json_match = re.search(r"\{[\s\S]*\}", result)
        if json_match:
            extracted = json.loads(json_match.group())
    except Exception as e:
        logger.warning(f"AI learn extraction failed: {e}")
        extracted["error"] = str(e)

    # Store in agent memory as structured knowledge
    try:
        from api.agent import _memory
        if _memory:
            # Store as a decision-like entry for pattern matching
            await _memory.store_feedback(
                feedback_type="lesson_deep_learn",
                target=str(lesson_id),
                vote=0,
                context={
                    "title": lesson_data["title"],
                    "category": lesson_data["category"],
                    "severity": lesson_data["severity"],
                    "rules": extracted.get("rules", []),
                    "patterns": extracted.get("patterns", []),
                    "prevention": extracted.get("enhanced_prevention", ""),
                },
            )
    except Exception as e:
        logger.warning(f"Memory store failed: {e}")

    # 改造七：将提取的规则桥接到 prevention_rules 表
    try:
        db2 = await get_db()
        try:
            cur = await db2.execute(
                "SELECT MAX(CAST(SUBSTR(rule_id, 3) AS INTEGER)) FROM prevention_rules"
            )
            row = await cur.fetchone()
            max_rule_id = (row[0] or 0) if row else 0

            for i, rule_text in enumerate(extracted.get("rules", [])):
                rule_id = f"R-{max_rule_id + i + 1:04d}"
                # 从规则文本中提取关键词（取前3个实词）
                keywords = [w for w in rule_text.replace("，", " ").replace("、", " ").split()
                           if len(w) > 1][:5]
                await db2.execute("""
                    INSERT OR IGNORE INTO prevention_rules
                    (rule_id, pattern, pattern_keywords, action, action_params,
                     confidence, source_type, source_ids, status)
                    VALUES (?, ?, ?, 'warn', ?, 0.5, 'lesson', ?, 'candidate')
                """, (
                    rule_id,
                    rule_text[:500],
                    json.dumps(keywords, ensure_ascii=False),
                    json.dumps({"warning_text": rule_text[:200]}, ensure_ascii=False),
                    json.dumps([lesson_id]),
                ))
            await db2.commit()
            logger.info(f"Bridged {len(extracted.get('rules', []))} lesson rules to prevention_rules")
        finally:
            await db2.close()
    except Exception as e:
        logger.warning(f"Lesson-to-prevention bridge failed: {e}")

    return {
        "status": "learned",
        "lesson_id": lesson_id,
        "extracted_rules": extracted.get("rules", []),
        "extracted_patterns": extracted.get("patterns", []),
        "enhanced_prevention": extracted.get("enhanced_prevention", ""),
    }
