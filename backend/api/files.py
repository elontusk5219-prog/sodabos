"""
项目文件上传 / 下载 API
POST   /projects/{pid}/files              上传文件
GET    /projects/{pid}/files              列出项目文件
GET    /projects/{pid}/files/{id}/download 下载文件
DELETE /projects/{pid}/files/{id}         删除文件
"""

import os
import mimetypes
from datetime import datetime

from fastapi import APIRouter, HTTPException, UploadFile, File as FastAPIFile, Depends
from fastapi.responses import FileResponse

from auth.deps import get_current_user
from database import get_db
from project_knowledge import index_file, delete_file_chunks

router = APIRouter()

FILES_ROOT = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "project_files")


# ── 文本提取 ──────────────────────────────────────────────────────────────────

def extract_text(filepath: str, mime_type: str) -> str:
    if mime_type in ("text/plain", "text/markdown", "application/x-markdown"):
        with open(filepath, "r", errors="ignore") as f:
            return f.read()
    elif mime_type == "application/pdf":
        try:
            import pdfplumber
            text_parts = []
            with pdfplumber.open(filepath) as pdf:
                for page in pdf.pages:
                    t = page.extract_text()
                    if t:
                        text_parts.append(t)
            return "\n\n".join(text_parts)
        except Exception:
            return ""
    elif mime_type in (
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ):
        try:
            from docx import Document
            doc = Document(filepath)
            return "\n\n".join(p.text for p in doc.paragraphs if p.text.strip())
        except Exception:
            return ""
    return ""


# ── POST /projects/{pid}/files ────────────────────────────────────────────────

@router.post("/projects/{pid}/files")
async def upload_file(
    pid: int,
    file: UploadFile = FastAPIFile(...),
    user: dict = Depends(get_current_user),
):
    db = await get_db()
    try:
        # 确认项目存在
        cur = await db.execute("SELECT id FROM projects WHERE id = ?", (pid,))
        project = await cur.fetchone()
        if not project:
            raise HTTPException(status_code=404, detail="项目不存在")

        # 准备存储目录
        project_dir = os.path.join(FILES_ROOT, str(pid))
        os.makedirs(project_dir, exist_ok=True)

        # 处理文件名冲突：若同名文件已存在，加时间戳后缀
        filename = file.filename or "unnamed"
        dest_path = os.path.join(project_dir, filename)
        if os.path.exists(dest_path):
            name, ext = os.path.splitext(filename)
            filename = f"{name}_{datetime.now().strftime('%Y%m%d%H%M%S')}{ext}"
            dest_path = os.path.join(project_dir, filename)

        # 写入磁盘
        content = await file.read()
        with open(dest_path, "wb") as f:
            f.write(content)

        file_size = len(content)
        mime_type = file.content_type or mimetypes.guess_type(filename)[0] or ""

        # 写入数据库
        cur = await db.execute(
            """INSERT INTO project_files
               (project_id, filename, file_path, file_size, mime_type, uploaded_by)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (pid, filename, dest_path, file_size, mime_type, user["id"]),
        )
        file_id = cur.lastrowid
        await db.commit()

        # 提取文本并建立 RAG 索引
        text = extract_text(dest_path, mime_type)
        chunk_count = 0
        if text.strip():
            chunk_count = await index_file(db, pid, file_id, text)
            await db.commit()

        return {
            "id": file_id,
            "project_id": pid,
            "filename": filename,
            "file_size": file_size,
            "mime_type": mime_type,
            "chunk_count": chunk_count,
            "created_at": datetime.now().isoformat(),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"上传失败: {str(e)}")
    finally:
        await db.close()


# ── GET /projects/{pid}/files ─────────────────────────────────────────────────

@router.get("/projects/{pid}/files")
async def list_files(
    pid: int,
    user: dict = Depends(get_current_user),
):
    db = await get_db()
    try:
        cur = await db.execute(
            """SELECT pf.id, pf.filename, pf.file_size, pf.mime_type,
                      pf.uploaded_by, u.display_name AS uploader_name,
                      pf.created_at
               FROM project_files pf
               LEFT JOIN users u ON u.id = pf.uploaded_by
               WHERE pf.project_id = ?
               ORDER BY pf.created_at DESC""",
            (pid,),
        )
        rows = await cur.fetchall()
        return [dict(r) for r in rows]
    finally:
        await db.close()


# ── GET /projects/{pid}/files/{file_id}/download ──────────────────────────────

@router.get("/projects/{pid}/files/{file_id}/download")
async def download_file(
    pid: int,
    file_id: int,
    user: dict = Depends(get_current_user),
):
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT * FROM project_files WHERE id = ? AND project_id = ?",
            (file_id, pid),
        )
        row = await cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="文件不存在")

        filepath = row["file_path"]
        if not os.path.isfile(filepath):
            raise HTTPException(status_code=404, detail="文件已从磁盘移除")

        return FileResponse(
            path=filepath,
            filename=row["filename"],
            media_type=row["mime_type"] or "application/octet-stream",
        )
    finally:
        await db.close()


# ── DELETE /projects/{pid}/files/{file_id} ────────────────────────────────────

@router.delete("/projects/{pid}/files/{file_id}")
async def delete_file(
    pid: int,
    file_id: int,
    user: dict = Depends(get_current_user),
):
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT * FROM project_files WHERE id = ? AND project_id = ?",
            (file_id, pid),
        )
        row = await cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="文件不存在")

        # 删除磁盘文件
        filepath = row["file_path"]
        if os.path.isfile(filepath):
            os.remove(filepath)

        # 删除 RAG chunks
        await delete_file_chunks(db, pid, file_id)

        # 删除数据库记录
        await db.execute(
            "DELETE FROM project_files WHERE id = ? AND project_id = ?",
            (file_id, pid),
        )
        await db.commit()

        return {"detail": "文件已删除", "id": file_id}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"删除失败: {str(e)}")
    finally:
        await db.close()
