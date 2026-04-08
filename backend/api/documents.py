"""
项目文档 API
GET    /projects/{pid}/documents              文档列表（可按 stage 筛选）
POST   /projects/{pid}/documents              手动创建文档
GET    /projects/{pid}/documents/{id}         文档详情（含 content）
PATCH  /projects/{pid}/documents/{id}         编辑文档
DELETE /projects/{pid}/documents/{id}         删除文档
POST   /projects/{pid}/documents/generate     AI 生成文档
POST   /projects/{pid}/documents/{id}/import-skill  从 skill_output 导入
"""

import json
from fastapi import APIRouter, HTTPException, Depends, Query
from pydantic import BaseModel
from typing import Optional
from auth.deps import get_current_user
from database import get_db
from project_knowledge import index_document, reindex_document, delete_document_chunks
from ai.client import chat
from project_knowledge import retrieve_combined_context
from utils.activity import log_activity

router = APIRouter()


# ── Pydantic 模型 ────────────────────────────────────────────────────────────

class DocumentCreate(BaseModel):
    doc_type: str
    title: str
    content: Optional[str] = ""
    stage: str


class DocumentUpdate(BaseModel):
    content: Optional[str] = None
    title: Optional[str] = None
    status: Optional[str] = None


class DocumentGenerate(BaseModel):
    doc_type: str
    extra_instructions: Optional[str] = ""


class SkillImport(BaseModel):
    skill_output_id: int


# ── 辅助函数 ─────────────────────────────────────────────────────────────────

async def _get_project_or_404(db, project_id: int) -> dict:
    cur = await db.execute("SELECT * FROM projects WHERE id = ?", (project_id,))
    project = await cur.fetchone()
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")
    return dict(project)


async def _get_document_or_404(db, project_id: int, doc_id: int) -> dict:
    cur = await db.execute(
        "SELECT * FROM project_documents WHERE id = ? AND project_id = ?",
        (doc_id, project_id),
    )
    doc = await cur.fetchone()
    if not doc:
        raise HTTPException(status_code=404, detail="文档不存在")
    return dict(doc)


async def _log_activity(
    db, project_id: int, user_id: int, action: str,
    target_type: str = "document", target_id: int = 0, detail: dict | None = None,
):
    """Thin wrapper around shared log_activity with document defaults."""
    await log_activity(db, project_id, user_id, action, target_type, target_id, detail or {})


# ── 路由 ─────────────────────────────────────────────────────────────────────

@router.get("/projects/{pid}/documents")
async def list_documents(
    pid: int,
    stage: Optional[str] = Query(None),
    user: dict = Depends(get_current_user),
):
    """获取项目文档列表，可按 stage 筛选，返回创建者名称"""
    db = await get_db()
    try:
        await _get_project_or_404(db, pid)

        if stage:
            sql = """
                SELECT pd.id, pd.project_id, pd.doc_type, pd.title, pd.stage,
                       pd.generated_by, pd.skill_output_id, pd.version,
                       pd.status, pd.created_by, pd.updated_by,
                       pd.created_at, pd.updated_at,
                       u.display_name AS creator_name
                FROM project_documents pd
                LEFT JOIN users u ON pd.created_by = u.id
                WHERE pd.project_id = ? AND pd.stage = ?
                ORDER BY pd.created_at DESC
            """
            cur = await db.execute(sql, (pid, stage))
        else:
            sql = """
                SELECT pd.id, pd.project_id, pd.doc_type, pd.title, pd.stage,
                       pd.generated_by, pd.skill_output_id, pd.version,
                       pd.status, pd.created_by, pd.updated_by,
                       pd.created_at, pd.updated_at,
                       u.display_name AS creator_name
                FROM project_documents pd
                LEFT JOIN users u ON pd.created_by = u.id
                WHERE pd.project_id = ?
                ORDER BY pd.created_at DESC
            """
            cur = await db.execute(sql, (pid,))

        rows = await cur.fetchall()
        return {"documents": [dict(r) for r in rows]}
    finally:
        await db.close()


@router.post("/projects/{pid}/documents")
async def create_document(
    pid: int,
    payload: DocumentCreate,
    user: dict = Depends(get_current_user),
):
    """手动创建文档"""
    db = await get_db()
    try:
        await _get_project_or_404(db, pid)

        cur = await db.execute(
            """INSERT INTO project_documents
               (project_id, doc_type, title, content, stage, generated_by, status, created_by, updated_by)
               VALUES (?, ?, ?, ?, ?, 'manual', 'draft', ?, ?)""",
            (pid, payload.doc_type, payload.title, payload.content or "", payload.stage,
             user["id"], user["id"]),
        )
        doc_id = cur.lastrowid

        # 索引文档内容
        if payload.content:
            await index_document(db, pid, doc_id, payload.content)

        await _log_activity(db, pid, user["id"], "create_document", "document", doc_id, {
            "title": payload.title, "doc_type": payload.doc_type,
        })
        await db.commit()

        # 返回新建的文档
        cur2 = await db.execute(
            "SELECT * FROM project_documents WHERE id = ?", (doc_id,)
        )
        doc = await cur2.fetchone()
        return dict(doc)
    finally:
        await db.close()


@router.get("/projects/{pid}/documents/{doc_id}")
async def get_document(
    pid: int,
    doc_id: int,
    user: dict = Depends(get_current_user),
):
    """获取文档详情（含 content）"""
    db = await get_db()
    try:
        doc = await _get_document_or_404(db, pid, doc_id)
        return doc
    finally:
        await db.close()


@router.patch("/projects/{pid}/documents/{doc_id}")
async def update_document(
    pid: int,
    doc_id: int,
    payload: DocumentUpdate,
    user: dict = Depends(get_current_user),
):
    """编辑文档，内容变更时重新索引"""
    db = await get_db()
    try:
        doc = await _get_document_or_404(db, pid, doc_id)

        updates = []
        params = []
        changes = {}

        if payload.title is not None:
            updates.append("title = ?")
            params.append(payload.title)
            changes["title"] = payload.title

        if payload.content is not None:
            updates.append("content = ?")
            params.append(payload.content)
            changes["content_updated"] = True

        if payload.status is not None:
            updates.append("status = ?")
            params.append(payload.status)
            changes["status"] = payload.status

        if not updates:
            raise HTTPException(status_code=400, detail="没有需要更新的字段")

        updates.append("updated_by = ?")
        params.append(user["id"])
        updates.append("updated_at = CURRENT_TIMESTAMP")
        updates.append("version = version + 1")

        params.append(doc_id)
        params.append(pid)

        await db.execute(
            f"UPDATE project_documents SET {', '.join(updates)} WHERE id = ? AND project_id = ?",
            params,
        )

        # 内容变更时重新索引
        if payload.content is not None:
            await reindex_document(db, pid, doc_id, payload.content)

        await _log_activity(db, pid, user["id"], "update_document", "document", doc_id, changes)
        await db.commit()

        # 返回更新后的文档
        cur = await db.execute(
            "SELECT * FROM project_documents WHERE id = ?", (doc_id,)
        )
        updated = await cur.fetchone()
        return dict(updated)
    finally:
        await db.close()


@router.delete("/projects/{pid}/documents/{doc_id}")
async def delete_document(
    pid: int,
    doc_id: int,
    user: dict = Depends(get_current_user),
):
    """删除文档及其 RAG chunks"""
    db = await get_db()
    try:
        await _get_document_or_404(db, pid, doc_id)

        # 先删除 RAG chunks
        await delete_document_chunks(db, pid, doc_id)

        await db.execute(
            "DELETE FROM project_documents WHERE id = ? AND project_id = ?",
            (doc_id, pid),
        )
        await _log_activity(db, pid, user["id"], "delete_document", "document", doc_id)
        await db.commit()

        return {"status": "deleted", "id": doc_id}
    finally:
        await db.close()


@router.post("/projects/{pid}/documents/generate")
async def generate_document(
    pid: int,
    payload: DocumentGenerate,
    user: dict = Depends(get_current_user),
):
    """AI 生成文档"""
    db = await get_db()
    try:
        # 1. 查找 stage_deliverables 获取文档类型信息
        cur = await db.execute(
            "SELECT * FROM stage_deliverables WHERE doc_type = ?",
            (payload.doc_type,),
        )
        deliverable = await cur.fetchone()
        if not deliverable:
            raise HTTPException(status_code=400, detail=f"未知的文档类型: {payload.doc_type}")

        deliverable = dict(deliverable)
        deliverable_title = deliverable["title"]
        deliverable_description = deliverable["description"]
        stage = deliverable["stage"]

        # 2. 获取项目信息
        project = await _get_project_or_404(db, pid)
        project_title = project["title"]
        project_description = project.get("description", "")

        # 3. RAG 检索相关上下文
        rag_context = await retrieve_combined_context(
            db, pid, f"{deliverable_title} {project_title}"
        )

        # 4. 构建 system prompt
        system_prompt = f"""你是一位资深产品经理。请为项目「{project_title}」生成以下文档：

## 文档类型：{deliverable_title}
{deliverable_description}

## 项目背景
{project_description}

## 参考资料
{rag_context if rag_context else '暂无参考资料'}

{('## 额外要求' + chr(10) + payload.extra_instructions) if payload.extra_instructions else ''}

请用 Markdown 格式输出完整文档，结构清晰，内容专业。"""

        user_prompt = f"请生成「{deliverable_title}」文档。"

        # 5. 调用 AI 生成
        content = await chat(system_prompt, user_prompt, temperature=0.5)

        if content.startswith("[AI Error]"):
            raise HTTPException(status_code=502, detail=f"AI 生成失败: {content}")

        # 6. 写入数据库
        cur = await db.execute(
            """INSERT INTO project_documents
               (project_id, doc_type, title, content, stage, generated_by, status, created_by, updated_by)
               VALUES (?, ?, ?, ?, ?, 'ai', 'draft', ?, ?)""",
            (pid, payload.doc_type, deliverable_title, content, stage,
             user["id"], user["id"]),
        )
        doc_id = cur.lastrowid

        # 7. 索引生成的内容
        await index_document(db, pid, doc_id, content)

        await _log_activity(db, pid, user["id"], "generate_document", "document", doc_id, {
            "title": deliverable_title, "doc_type": payload.doc_type, "generated_by": "ai",
        })
        await db.commit()

        # 8. 返回新文档
        cur2 = await db.execute(
            "SELECT * FROM project_documents WHERE id = ?", (doc_id,)
        )
        doc = await cur2.fetchone()
        return dict(doc)
    finally:
        await db.close()


@router.post("/projects/{pid}/documents/{doc_id}/import-skill")
async def import_skill_output(
    pid: int,
    doc_id: int,
    payload: SkillImport,
    user: dict = Depends(get_current_user),
):
    """从 skill_output 导入内容到文档"""
    db = await get_db()
    try:
        doc = await _get_document_or_404(db, pid, doc_id)

        # 获取 skill_output 内容
        cur = await db.execute(
            "SELECT * FROM skill_outputs WHERE id = ?",
            (payload.skill_output_id,),
        )
        skill_output = await cur.fetchone()
        if not skill_output:
            raise HTTPException(status_code=404, detail="Skill output 不存在")

        skill_output = dict(skill_output)
        content = skill_output["output"]

        # 更新文档
        await db.execute(
            """UPDATE project_documents
               SET content = ?, generated_by = 'skill_import', skill_output_id = ?,
                   updated_by = ?, updated_at = CURRENT_TIMESTAMP, version = version + 1
               WHERE id = ? AND project_id = ?""",
            (content, payload.skill_output_id, user["id"], doc_id, pid),
        )

        # 重新索引
        await reindex_document(db, pid, doc_id, content)

        await _log_activity(db, pid, user["id"], "import_skill", "document", doc_id, {
            "skill_output_id": payload.skill_output_id,
            "skill_name": skill_output.get("skill_name", ""),
        })
        await db.commit()

        # 返回更新后的文档
        cur2 = await db.execute(
            "SELECT * FROM project_documents WHERE id = ?", (doc_id,)
        )
        updated = await cur2.fetchone()
        return dict(updated)
    finally:
        await db.close()
