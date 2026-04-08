"""
知识库 API
POST   /api/knowledge/docs          上传文档（JSON body，含 raw_text 全文）
GET    /api/knowledge/docs          文档列表，支持 ?category= 筛选
DELETE /api/knowledge/docs/{id}     删除文档（级联删除 chunks）
GET    /api/knowledge/categories    获取所有已有赛道标签
POST   /api/knowledge/search        FTS5 关键词检索
POST   /api/knowledge/ask           向知识库提问（AI 回答）
"""
import re
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from database import get_db
from ai.client import chat
from ai.knowledge_retriever import retrieve
from utils.chunks import split_chunks

router = APIRouter()

# ── Pydantic 模型 ────────────────────────────────────────────────────────────

class DocUpload(BaseModel):
    title: str
    category: str = ""
    file_type: str = "txt"   # txt / md
    raw_text: str
    created_by: str = ""


class SearchRequest(BaseModel):
    query: str
    category: str = ""
    limit: int = 5


class AskRequest(BaseModel):
    question: str
    category: str = ""


# ── 切块工具（已迁移到 utils.chunks.split_chunks）────────────────────────────

_split_chunks = split_chunks  # backward compat alias


# ── 路由 ─────────────────────────────────────────────────────────────────────

@router.post("/docs")
async def upload_doc(payload: DocUpload):
    """上传文档：解析文本 → 切块 → 写入 DB 和 FTS5"""
    raw = payload.raw_text.strip()
    if not raw:
        raise HTTPException(status_code=400, detail="文档内容不能为空")

    chunks = _split_chunks(raw)
    if not chunks:
        raise HTTPException(status_code=400, detail="无法解析文档内容")

    db = await get_db()
    try:
        cur = await db.execute(
            """INSERT INTO knowledge_docs (title, category, file_type, char_count, chunks_count, created_by)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (payload.title, payload.category, payload.file_type, len(raw), len(chunks), payload.created_by),
        )
        doc_id = cur.lastrowid

        for i, chunk in enumerate(chunks):
            await db.execute(
                "INSERT INTO knowledge_chunks (doc_id, chunk_index, content) VALUES (?, ?, ?)",
                (doc_id, i, chunk),
            )

        await db.commit()

        return {
            "id": doc_id,
            "title": payload.title,
            "category": payload.category,
            "char_count": len(raw),
            "chunks_count": len(chunks),
            "created_by": payload.created_by,
        }
    finally:
        await db.close()


@router.get("/docs")
async def list_docs(category: str = ""):
    """获取文档列表，可按赛道标签筛选"""
    db = await get_db()
    try:
        if category:
            cur = await db.execute(
                "SELECT * FROM knowledge_docs WHERE category = ? ORDER BY created_at DESC",
                (category,),
            )
        else:
            cur = await db.execute(
                "SELECT * FROM knowledge_docs ORDER BY created_at DESC"
            )
        rows = await cur.fetchall()
        return [dict(r) for r in rows]
    finally:
        await db.close()


@router.get("/docs/{doc_id}")
async def get_doc(doc_id: int):
    """获取文档详情（含全部 chunks 内容拼接）"""
    db = await get_db()
    try:
        cur = await db.execute("SELECT * FROM knowledge_docs WHERE id = ?", (doc_id,))
        doc = await cur.fetchone()
        if not doc:
            raise HTTPException(status_code=404, detail="文档不存在")

        cur2 = await db.execute(
            "SELECT content FROM knowledge_chunks WHERE doc_id = ? ORDER BY chunk_index",
            (doc_id,),
        )
        chunks = await cur2.fetchall()
        full_text = "\n\n".join(r["content"] for r in chunks)

        return {**dict(doc), "preview": full_text[:2000]}
    finally:
        await db.close()


@router.delete("/docs/{doc_id}")
async def delete_doc(doc_id: int):
    """删除文档（级联删除 chunks，FTS 触发器自动清理索引）"""
    db = await get_db()
    try:
        cur = await db.execute("SELECT id FROM knowledge_docs WHERE id = ?", (doc_id,))
        if not await cur.fetchone():
            raise HTTPException(status_code=404, detail="文档不存在")

        await db.execute("DELETE FROM knowledge_docs WHERE id = ?", (doc_id,))
        await db.commit()
        return {"status": "deleted", "id": doc_id}
    finally:
        await db.close()


@router.get("/categories")
async def list_categories():
    """获取所有已有赛道标签（去重排序）"""
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT DISTINCT category FROM knowledge_docs WHERE category != '' ORDER BY category"
        )
        rows = await cur.fetchall()
        return [r["category"] for r in rows]
    finally:
        await db.close()


@router.post("/search")
async def search_knowledge(payload: SearchRequest):
    """FTS5 关键词检索，返回相关 chunks"""
    if not payload.query.strip():
        return {"results": [], "query": payload.query}

    db = await get_db()
    try:
        terms = re.findall(r"[\u4e00-\u9fff]{2,}|[a-zA-Z]{3,}", payload.query)
        if not terms:
            return {"results": [], "query": payload.query}

        fts_query = " OR ".join(f'"{t}"' for t in terms)

        if payload.category:
            sql = """
                SELECT kc.id AS chunk_id, kc.doc_id, kc.content,
                       kd.title AS doc_title, kd.category,
                       knowledge_chunks_fts.rank AS rank
                FROM knowledge_chunks_fts
                JOIN knowledge_chunks kc ON knowledge_chunks_fts.rowid = kc.id
                JOIN knowledge_docs kd ON kc.doc_id = kd.id
                WHERE knowledge_chunks_fts MATCH ?
                  AND kd.category = ?
                ORDER BY rank
                LIMIT ?
            """
            cur = await db.execute(sql, (fts_query, payload.category, payload.limit))
        else:
            sql = """
                SELECT kc.id AS chunk_id, kc.doc_id, kc.content,
                       kd.title AS doc_title, kd.category,
                       knowledge_chunks_fts.rank AS rank
                FROM knowledge_chunks_fts
                JOIN knowledge_chunks kc ON knowledge_chunks_fts.rowid = kc.id
                JOIN knowledge_docs kd ON kc.doc_id = kd.id
                WHERE knowledge_chunks_fts MATCH ?
                ORDER BY rank
                LIMIT ?
            """
            cur = await db.execute(sql, (fts_query, payload.limit))

        rows = await cur.fetchall()
        return {
            "results": [dict(r) for r in rows],
            "query": payload.query,
        }
    except Exception as e:
        return {"results": [], "query": payload.query, "error": str(e)}
    finally:
        await db.close()


# ── AI 提问 ──────────────────────────────────────────────────────────────────

_ASK_SYSTEM = """# 角色
你是团队的内部知识库助手，专门基于产品经理团队上传的市场调研文档回答问题。

# 规则
1. **只基于提供的知识库内容回答**，不要引入知识库以外的信息
2. 如果知识库中没有相关内容，明确说"知识库中暂无此方面的资料"
3. 引用具体来源（文档名称），便于同事核实
4. 回答简洁、结构清晰，使用 Markdown

# 输出格式
直接回答，最后附上"**参考来源：**"列表"""


@router.post("/ask")
async def ask_knowledge(payload: AskRequest):
    """向知识库提问，AI 基于检索结果回答"""
    db = await get_db()
    try:
        context = await retrieve(
            payload.question,
            db,
            category=payload.category or None,
            top_k=6,
        )
    finally:
        await db.close()

    if not context:
        return {
            "answer": "知识库中暂无与此问题相关的资料，请先上传相关文档。",
            "sources": [],
        }

    user_prompt = (
        f"# 知识库检索结果\n\n{context}\n\n"
        f"---\n\n# 问题\n\n{payload.question}"
    )

    answer = await chat(_ASK_SYSTEM, user_prompt, temperature=0.2)

    # 从 context 提取来源列表（格式：【来源：文档名 · 分类】）
    sources = re.findall(r"【来源：(.+?) · (.+?)】", context)
    unique_sources = list({f"{title} [{cat}]" for title, cat in sources})

    return {
        "answer": answer,
        "sources": unique_sources,
    }
