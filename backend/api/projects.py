"""Projects CRUD API — kanban-style project management with stage gates."""

from __future__ import annotations

import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File as FastAPIFile
from pydantic import BaseModel

from auth.deps import get_current_user
from database import get_db
from utils.activity import log_activity
import os

router = APIRouter()

# ── Constants ────────────────────────────────────────────────────────────────

STAGE_ORDER = ["discover", "value_filter", "validate", "pmf", "business_model"]

SKILL_TO_DOC: dict[str, dict] = {
    "user_research":          {"doc_type": "user_research",        "stage": "validate"},
    "tam_analysis":           {"doc_type": "tam_analysis",         "stage": "validate"},
    "competitive_battlecard": {"doc_type": "competitive_research", "stage": "value_filter"},
    "positioning":            {"doc_type": "positioning",          "stage": "validate"},
    "write_prd":              {"doc_type": "prd",                  "stage": "pmf"},
}

# ── Pydantic models ──────────────────────────────────────────────────────────


class ProjectCreate(BaseModel):
    title: str
    description: Optional[str] = ""
    demand_id: Optional[int] = None


class ProjectUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    tags: Optional[str] = None
    status: Optional[str] = None
    landing_page_url: Optional[str] = None
    mvp_url: Optional[str] = None
    analytics_dashboard_url: Optional[str] = None
    stats_api_url: Optional[str] = None


class ProjectKill(BaseModel):
    reason: str
    category: Optional[str] = "other"  # no_demand, no_pmf, competition, resource, pivot, other


class AnalyticsRecord(BaseModel):
    recorded_date: str  # YYYY-MM-DD
    visits: int = 0
    signups: int = 0
    active_users: int = 0
    revenue: float = 0
    custom_metrics: Optional[dict] = None
    notes: Optional[str] = ""


class MemberAdd(BaseModel):
    user_id: int


class GateVote(BaseModel):
    vote: str  # "approve" | "reject"
    comment: Optional[str] = ""


# ── Helpers ──────────────────────────────────────────────────────────────────


def _next_stage(current: str) -> Optional[str]:
    try:
        idx = STAGE_ORDER.index(current)
        return STAGE_ORDER[idx + 1] if idx + 1 < len(STAGE_ORDER) else None
    except ValueError:
        return None


# ── Endpoints ────────────────────────────────────────────────────────────────


@router.get("")
async def list_projects(
    stage: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    user: dict = Depends(get_current_user),
):
    db = await get_db()
    try:
        conditions = ["1=1"]
        params: list = []

        if stage:
            conditions.append("p.current_stage = ?")
            params.append(stage)
        if status:
            conditions.append("p.status = ?")
            params.append(status)
        else:
            conditions.append("p.status NOT IN ('archived', 'killed')")
        if search:
            conditions.append("(p.title LIKE ? OR p.description LIKE ?)")
            params.extend([f"%{search}%", f"%{search}%"])

        where = " AND ".join(conditions)

        cur = await db.execute(
            f"""
            SELECT p.*,
                   (SELECT COUNT(*) FROM project_members pm WHERE pm.project_id = p.id) AS member_count,
                   (SELECT COUNT(*) FROM project_documents pd WHERE pd.project_id = p.id) AS doc_count
            FROM projects p
            WHERE {where}
            ORDER BY p.updated_at DESC
            """,
            params,
        )
        rows = await cur.fetchall()
        return [dict(r) for r in rows]
    finally:
        await db.close()


@router.get("/kanban")
async def kanban_projects(
    user: dict = Depends(get_current_user),
):
    db = await get_db()
    try:
        result: dict[str, list] = {s: [] for s in STAGE_ORDER}
        cur = await db.execute(
            """
            SELECT p.*,
                   (SELECT COUNT(*) FROM project_members pm WHERE pm.project_id = p.id) AS member_count,
                   (SELECT COUNT(*) FROM project_documents pd WHERE pd.project_id = p.id) AS doc_count
            FROM projects p
            WHERE p.status NOT IN ('archived', 'killed')
            ORDER BY p.updated_at DESC
            """
        )
        rows = await cur.fetchall()
        for r in rows:
            d = dict(r)
            stage = d.get("current_stage", "discover")
            if stage in result:
                result[stage].append(d)
            else:
                result.setdefault(stage, []).append(d)
        return result
    finally:
        await db.close()


@router.get("/deployed")
async def deployed_projects(user: dict = Depends(get_current_user)):
    """List all projects with at least one deployment URL, plus latest analytics."""
    db = await get_db()
    try:
        cur = await db.execute(
            """
            SELECT p.*,
                   (SELECT COUNT(*) FROM project_members pm WHERE pm.project_id = p.id) AS member_count,
                   (SELECT COUNT(*) FROM project_documents pd WHERE pd.project_id = p.id) AS doc_count
            FROM projects p
            WHERE p.status NOT IN ('archived', 'killed')
              AND (COALESCE(p.landing_page_url, '') != '' OR COALESCE(p.mvp_url, '') != ''
                   OR COALESCE(p.analytics_dashboard_url, '') != '')
            ORDER BY p.updated_at DESC
            """
        )
        projects = [dict(r) for r in await cur.fetchall()]

        for proj in projects:
            acur = await db.execute(
                "SELECT * FROM project_analytics WHERE project_id = ? ORDER BY recorded_date DESC LIMIT 1",
                (proj["id"],),
            )
            arow = await acur.fetchone()
            proj["latest_analytics"] = dict(arow) if arow else None

        return projects
    finally:
        await db.close()


@router.get("/stage-deliverables")
async def list_stage_deliverables(
    user: dict = Depends(get_current_user),
):
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT * FROM stage_deliverables ORDER BY stage, sort_order"
        )
        rows = await cur.fetchall()
        return [dict(r) for r in rows]
    finally:
        await db.close()


@router.post("")
async def create_project(
    body: ProjectCreate,
    user: dict = Depends(get_current_user),
):
    db = await get_db()
    try:
        cur = await db.execute(
            "INSERT INTO projects (title, description, demand_id, created_by) VALUES (?, ?, ?, ?)",
            (body.title, body.description or "", body.demand_id, user["id"]),
        )
        project_id = cur.lastrowid

        # Auto-add creator as owner
        await db.execute(
            "INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, 'owner')",
            (project_id, user["id"]),
        )

        # Import skill outputs if demand_id provided
        if body.demand_id:
            so_cur = await db.execute(
                "SELECT * FROM skill_outputs WHERE demand_id = ?",
                (body.demand_id,),
            )
            skill_rows = await so_cur.fetchall()
            for so in skill_rows:
                mapping = SKILL_TO_DOC.get(so["skill_name"])
                if not mapping:
                    continue
                await db.execute(
                    """INSERT INTO project_documents
                       (project_id, doc_type, title, content, stage, generated_by, skill_output_id, status, created_by)
                       VALUES (?, ?, ?, ?, ?, 'skill_import', ?, 'draft', ?)""",
                    (
                        project_id,
                        mapping["doc_type"],
                        mapping["doc_type"],
                        so["output"],
                        mapping["stage"],
                        so["id"],
                        user["id"],
                    ),
                )

            # Detect initial stage based on deliverables coverage
            detected_stage = await _detect_stage(db, project_id)
            if detected_stage and detected_stage != "discover":
                await db.execute(
                    "UPDATE projects SET current_stage = ? WHERE id = ?",
                    (detected_stage, project_id),
                )

        await log_activity(db, project_id, user["id"], "project_created")
        await db.commit()

        # Fetch and return
        cur2 = await db.execute("SELECT * FROM projects WHERE id = ?", (project_id,))
        project = dict(await cur2.fetchone())
        return project
    finally:
        await db.close()


async def _detect_stage(db, project_id: int) -> str:
    """Return the furthest stage whose required deliverables are all present."""
    del_cur = await db.execute(
        "SELECT stage, doc_type, is_required FROM stage_deliverables"
    )
    deliverables = await del_cur.fetchall()

    doc_cur = await db.execute(
        "SELECT doc_type FROM project_documents WHERE project_id = ?",
        (project_id,),
    )
    existing_types = {r["doc_type"] for r in await doc_cur.fetchall()}

    # Build required doc_types per stage
    required_by_stage: dict[str, list[str]] = {}
    for d in deliverables:
        if d["is_required"]:
            required_by_stage.setdefault(d["stage"], []).append(d["doc_type"])

    # Find the furthest completed stage
    furthest = "discover"
    for stage in STAGE_ORDER:
        required = required_by_stage.get(stage, [])
        if required and all(dt in existing_types for dt in required):
            # This stage is complete — the project can move to the next stage
            ns = _next_stage(stage)
            if ns:
                furthest = ns
        else:
            break
    return furthest


@router.get("/{project_id}")
async def get_project(
    project_id: int,
    user: dict = Depends(get_current_user),
):
    db = await get_db()
    try:
        cur = await db.execute("SELECT * FROM projects WHERE id = ?", (project_id,))
        project = await cur.fetchone()
        if not project:
            raise HTTPException(status_code=404, detail="项目不存在")

        result = dict(project)

        # Members with user info
        mcur = await db.execute(
            """SELECT pm.*, u.username, u.display_name, u.avatar_url
               FROM project_members pm
               JOIN users u ON u.id = pm.user_id
               WHERE pm.project_id = ?""",
            (project_id,),
        )
        result["members"] = [dict(r) for r in await mcur.fetchall()]

        # Current stage info
        scur = await db.execute(
            "SELECT * FROM stage_deliverables WHERE stage = ? ORDER BY sort_order",
            (result["current_stage"],),
        )
        result["current_stage_info"] = [dict(r) for r in await scur.fetchall()]

        # Latest analytics snapshot
        acur = await db.execute(
            "SELECT * FROM project_analytics WHERE project_id = ? ORDER BY recorded_date DESC LIMIT 1",
            (project_id,),
        )
        arow = await acur.fetchone()
        result["latest_analytics"] = dict(arow) if arow else None

        return result
    finally:
        await db.close()


@router.patch("/{project_id}")
async def update_project(
    project_id: int,
    body: ProjectUpdate,
    user: dict = Depends(get_current_user),
):
    db = await get_db()
    try:
        updates = []
        params: list = []
        for field, val in body.model_dump(exclude_none=True).items():
            updates.append(f"{field} = ?")
            params.append(val)
        if not updates:
            raise HTTPException(status_code=400, detail="没有需要更新的字段")

        updates.append("updated_at = CURRENT_TIMESTAMP")
        params.append(project_id)
        await db.execute(
            f"UPDATE projects SET {', '.join(updates)} WHERE id = ?", params
        )
        await db.commit()
        return {"status": "ok"}
    finally:
        await db.close()


@router.delete("/{project_id}")
async def archive_project(
    project_id: int,
    user: dict = Depends(get_current_user),
):
    db = await get_db()
    try:
        await db.execute(
            "UPDATE projects SET status = 'archived', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (project_id,),
        )
        await db.commit()
        return {"status": "ok"}
    finally:
        await db.close()


@router.post("/{project_id}/kill")
async def kill_project(
    project_id: int,
    body: ProjectKill,
    user: dict = Depends(get_current_user),
):
    """砍掉项目 — 标记为 killed，记录原因，并让 PM Agent 学习这个决策。"""
    db = await get_db()
    try:
        # 1. 获取项目信息
        cur = await db.execute("SELECT * FROM projects WHERE id = ?", (project_id,))
        project = await cur.fetchone()
        if not project:
            raise HTTPException(status_code=404, detail="项目不存在")
        project = dict(project)

        # 2. 更新项目状态为 killed，保存原因到 tags JSON
        existing_tags = project.get("tags") or "{}"
        if isinstance(existing_tags, str):
            try:
                parsed = json.loads(existing_tags)
                tags_dict = parsed if isinstance(parsed, dict) else {}
            except Exception:
                tags_dict = {}
        elif isinstance(existing_tags, dict):
            tags_dict = existing_tags
        else:
            tags_dict = {}
        tags_dict["kill_reason"] = body.reason
        tags_dict["kill_category"] = body.category
        tags_dict["killed_by"] = user.get("display_name") or user.get("username", "")
        tags_dict["killed_at"] = __import__("datetime").datetime.now().isoformat()

        await db.execute(
            "UPDATE projects SET status = 'killed', tags = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (json.dumps(tags_dict, ensure_ascii=False), project_id),
        )

        # 3. 记录活动日志
        await log_activity(
            db, project_id, user["id"],
            f"项目被砍掉 — 原因: {body.reason} (分类: {body.category})",
            target_type="project", target_id=project_id,
        )
        await db.commit()

        # 4. PM Agent 记忆 — 学习砍掉项目的决策逻辑
        try:
            from agent.tools import _remember
            stage_label = project.get("current_stage", "unknown")
            memory_content = (
                f"[项目决策] 砍掉了项目「{project['title']}」"
                f"（阶段: {stage_label}，分类: {body.category}）。"
                f"原因: {body.reason}"
            )
            await _remember(memory_content, "decision")

            # 额外记录为 insight，帮助 PM Agent 学习什么项目不该做
            insight_content = (
                f"[砍项目教训] {body.category}: {body.reason} "
                f"（项目「{project['title']}」在 {stage_label} 阶段被砍）"
            )
            await _remember(insight_content, "insight")
        except Exception:
            pass  # memory is best-effort

        return {
            "status": "ok",
            "project_id": project_id,
            "new_status": "killed",
            "reason": body.reason,
            "category": body.category,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"操作失败: {str(e)}")
    finally:
        await db.close()


# ── Progress ─────────────────────────────────────────────────────────────────


@router.get("/{project_id}/progress")
async def get_project_progress(
    project_id: int,
    user: dict = Depends(get_current_user),
):
    db = await get_db()
    try:
        # All deliverable definitions
        del_cur = await db.execute(
            "SELECT * FROM stage_deliverables ORDER BY stage, sort_order"
        )
        deliverables = [dict(r) for r in await del_cur.fetchall()]

        # Existing project documents
        doc_cur = await db.execute(
            "SELECT doc_type, status FROM project_documents WHERE project_id = ?",
            (project_id,),
        )
        doc_map: dict[str, str] = {}
        for r in await doc_cur.fetchall():
            doc_map[r["doc_type"]] = r["status"]

        # Build per-stage progress
        stages: dict[str, list] = {s: [] for s in STAGE_ORDER}
        for d in deliverables:
            entry = {**d, "completed": d["doc_type"] in doc_map}
            if d["doc_type"] in doc_map:
                entry["doc_status"] = doc_map[d["doc_type"]]
            stages.setdefault(d["stage"], []).append(entry)

        return stages
    finally:
        await db.close()


# ── Members ──────────────────────────────────────────────────────────────────


@router.post("/{project_id}/members")
async def add_member(
    project_id: int,
    body: MemberAdd,
    user: dict = Depends(get_current_user),
):
    db = await get_db()
    try:
        # Check project exists
        cur = await db.execute("SELECT id FROM projects WHERE id = ?", (project_id,))
        if not await cur.fetchone():
            raise HTTPException(status_code=404, detail="项目不存在")

        # Check user exists
        ucur = await db.execute("SELECT id FROM users WHERE id = ?", (body.user_id,))
        if not await ucur.fetchone():
            raise HTTPException(status_code=404, detail="用户不存在")

        try:
            await db.execute(
                "INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, 'member')",
                (project_id, body.user_id),
            )
        except Exception:
            raise HTTPException(status_code=409, detail="成员已存在")

        await log_activity(
            db, project_id, user["id"], "member_added",
            target_type="user", target_id=body.user_id,
        )
        await db.commit()
        return {"status": "ok"}
    finally:
        await db.close()


@router.delete("/{project_id}/members/{member_user_id}")
async def remove_member(
    project_id: int,
    member_user_id: int,
    user: dict = Depends(get_current_user),
):
    db = await get_db()
    try:
        await db.execute(
            "DELETE FROM project_members WHERE project_id = ? AND user_id = ?",
            (project_id, member_user_id),
        )
        await db.commit()
        return {"status": "ok"}
    finally:
        await db.close()


# ── Stage Gates ──────────────────────────────────────────────────────────────


@router.post("/{project_id}/gates")
async def open_gate(
    project_id: int,
    user: dict = Depends(get_current_user),
):
    db = await get_db()
    try:
        # Fetch project
        pcur = await db.execute("SELECT * FROM projects WHERE id = ?", (project_id,))
        project = await pcur.fetchone()
        if not project:
            raise HTTPException(status_code=404, detail="项目不存在")

        current = project["current_stage"]
        to_stage = _next_stage(current)
        if not to_stage:
            raise HTTPException(status_code=400, detail="已经是最后阶段")

        # Check: all required deliverables for current stage are approved
        del_cur = await db.execute(
            "SELECT doc_type FROM stage_deliverables WHERE stage = ? AND is_required = 1",
            (current,),
        )
        required_types = [r["doc_type"] for r in await del_cur.fetchall()]

        if required_types:
            placeholders = ",".join(["?"] * len(required_types))
            doc_cur = await db.execute(
                f"""SELECT doc_type FROM project_documents
                    WHERE project_id = ? AND doc_type IN ({placeholders}) AND status = 'approved'""",
                [project_id] + required_types,
            )
            approved = {r["doc_type"] for r in await doc_cur.fetchall()}
            missing = [dt for dt in required_types if dt not in approved]
            if missing:
                raise HTTPException(
                    status_code=400,
                    detail=f"以下必需交付物未通过审批: {', '.join(missing)}",
                )

        # Check no existing open gate
        existing = await db.execute(
            "SELECT id FROM stage_gates WHERE project_id = ? AND status = 'open'",
            (project_id,),
        )
        if await existing.fetchone():
            raise HTTPException(status_code=409, detail="已有进行中的阶段门投票")

        cur = await db.execute(
            "INSERT INTO stage_gates (project_id, from_stage, to_stage, opened_by) VALUES (?, ?, ?, ?)",
            (project_id, current, to_stage, user["id"]),
        )
        gate_id = cur.lastrowid
        await db.commit()

        return {"gate_id": gate_id, "from_stage": current, "to_stage": to_stage, "status": "open"}
    finally:
        await db.close()


@router.get("/{project_id}/gates")
async def list_gates(
    project_id: int,
    user: dict = Depends(get_current_user),
):
    db = await get_db()
    try:
        gcur = await db.execute(
            "SELECT * FROM stage_gates WHERE project_id = ? ORDER BY created_at DESC",
            (project_id,),
        )
        gates = []
        for g in await gcur.fetchall():
            gd = dict(g)
            vcur = await db.execute(
                """SELECT v.*, u.username, u.display_name
                   FROM stage_gate_votes v
                   JOIN users u ON u.id = v.user_id
                   WHERE v.gate_id = ?""",
                (g["id"],),
            )
            gd["votes"] = [dict(v) for v in await vcur.fetchall()]
            gates.append(gd)
        return gates
    finally:
        await db.close()


@router.post("/{project_id}/gates/{gate_id}/vote")
async def cast_vote(
    project_id: int,
    gate_id: int,
    body: GateVote,
    user: dict = Depends(get_current_user),
):
    if body.vote not in ("approve", "reject"):
        raise HTTPException(status_code=400, detail="vote 必须为 approve 或 reject")

    db = await get_db()
    try:
        # Verify gate exists and is open
        gcur = await db.execute(
            "SELECT * FROM stage_gates WHERE id = ? AND project_id = ? AND status = 'open'",
            (gate_id, project_id),
        )
        gate = await gcur.fetchone()
        if not gate:
            raise HTTPException(status_code=404, detail="阶段门不存在或已关闭")

        # Cast vote (UNIQUE constraint handles duplicate)
        try:
            await db.execute(
                "INSERT INTO stage_gate_votes (gate_id, user_id, vote, comment) VALUES (?, ?, ?, ?)",
                (gate_id, user["id"], body.vote, body.comment or ""),
            )
        except Exception:
            raise HTTPException(status_code=409, detail="您已投票")

        # Check if gate has passed: approvals > total_members / 2
        mcur = await db.execute(
            "SELECT COUNT(*) FROM project_members WHERE project_id = ?",
            (project_id,),
        )
        total_members = (await mcur.fetchone())[0]

        acur = await db.execute(
            "SELECT COUNT(*) FROM stage_gate_votes WHERE gate_id = ? AND vote = 'approve'",
            (gate_id,),
        )
        approve_count = (await acur.fetchone())[0]

        passed = approve_count > total_members / 2

        if passed:
            # Advance stage
            await db.execute(
                "UPDATE projects SET current_stage = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (gate["to_stage"], project_id),
            )
            await db.execute(
                "UPDATE stage_gates SET status = 'passed', resolved_at = CURRENT_TIMESTAMP WHERE id = ?",
                (gate_id,),
            )
            await log_activity(
                db, project_id, user["id"], "stage_advanced",
                target_type="gate", target_id=gate_id,
                detail=json.dumps({"from": gate["from_stage"], "to": gate["to_stage"]}),
            )

        await db.commit()

        return {
            "status": "ok",
            "gate_passed": passed,
            "approve_count": approve_count,
            "total_members": total_members,
        }
    finally:
        await db.close()


# ── Create project from uploaded files ──────────────────────────────────────

FILES_ROOT = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "project_files")


def _extract_text_from_file(filepath: str, mime_type: str) -> str:
    if mime_type in ("text/plain", "text/markdown", "application/x-markdown"):
        with open(filepath, "r", errors="ignore") as f:
            return f.read()
    elif mime_type == "application/pdf":
        try:
            import pdfplumber
            parts = []
            with pdfplumber.open(filepath) as pdf:
                for page in pdf.pages:
                    t = page.extract_text()
                    if t:
                        parts.append(t)
            return "\n\n".join(parts)
        except Exception:
            return ""
    elif "wordprocessingml" in mime_type:
        try:
            from docx import Document
            doc = Document(filepath)
            return "\n\n".join(p.text for p in doc.paragraphs if p.text.strip())
        except Exception:
            return ""
    return ""


@router.post("/create-from-files")
async def create_project_from_files(
    files: list[UploadFile] = FastAPIFile(...),
    user: dict = Depends(get_current_user),
):
    """Upload files to create a project. AI analyzes and classifies documents."""
    if not files:
        raise HTTPException(400, "请至少上传一个文件")

    from ai.client import chat
    from project_knowledge import index_document, index_file
    import mimetypes

    db = await get_db()
    try:
        # 1. Save files and extract text
        file_texts = []
        saved_files = []
        tmp_dir = os.path.join(FILES_ROOT, "_tmp")
        os.makedirs(tmp_dir, exist_ok=True)

        for f in files:
            content = await f.read()
            mime = f.content_type or mimetypes.guess_type(f.filename or "")[0] or "application/octet-stream"
            filepath = os.path.join(tmp_dir, f.filename or "upload")
            with open(filepath, "wb") as fp:
                fp.write(content)
            text = _extract_text_from_file(filepath, mime)
            file_texts.append({"filename": f.filename, "mime": mime, "text": text[:3000], "path": filepath, "size": len(content)})
            saved_files.append({"filename": f.filename, "mime": mime, "path": filepath, "size": len(content)})

        # 2. AI analysis
        docs_summary = "\n\n".join(
            "文件：" + ft['filename'] + "\n内容摘要：" + ft['text'][:1500] for ft in file_texts if ft["text"]
        )
        ai_prompt = f"""分析以下项目文件，提取项目信息。

{docs_summary}

请以 JSON 格式返回：
{{
  "title": "项目标题",
  "description": "项目描述（一两句话）",
  "files": [
    {{
      "filename": "文件名",
      "doc_type": "one_pager|signal_summary|scoring_report|competitive_research|user_research|tam_analysis|positioning|prd|prototype_brief|user_test_plan|business_model_canvas|unit_economics|go_to_market|custom",
      "stage": "discover|value_filter|validate|pmf|business_model",
      "title": "文档标题"
    }}
  ]
}}

只返回 JSON，不要其他文字。"""

        ai_result = await chat("你是一位资深产品经理，擅长分析项目文档。", ai_prompt, temperature=0.3)

        # Parse AI result
        import re
        json_match = re.search(r"\{[\s\S]*\}", ai_result)
        if not json_match:
            raise HTTPException(500, "AI 分析失败，请重试")
        try:
            parsed = json.loads(json_match.group())
        except json.JSONDecodeError:
            raise HTTPException(500, "AI 返回格式错误")

        project_title = parsed.get("title", "未命名项目")
        project_desc = parsed.get("description", "")
        ai_files = {f["filename"]: f for f in parsed.get("files", [])}

        # 3. Create project
        cur = await db.execute(
            "INSERT INTO projects (title, description, created_by) VALUES (?, ?, ?)",
            (project_title, project_desc, user["id"]),
        )
        project_id = cur.lastrowid
        await db.execute(
            "INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, 'owner')",
            (project_id, user["id"]),
        )

        # 4. Move files and create records
        proj_dir = os.path.join(FILES_ROOT, str(project_id))
        os.makedirs(proj_dir, exist_ok=True)

        for sf in saved_files:
            new_path = os.path.join(proj_dir, sf["filename"])
            os.rename(sf["path"], new_path)
            sf["final_path"] = new_path

            cur = await db.execute(
                "INSERT INTO project_files (project_id, filename, file_path, file_size, mime_type, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)",
                (project_id, sf["filename"], new_path, sf["size"], sf["mime"], user["id"]),
            )
            file_id = cur.lastrowid

            # Index file content
            ft = next((t for t in file_texts if t["filename"] == sf["filename"]), None)
            if ft and ft["text"]:
                await index_file(db, project_id, file_id, ft["text"])

            # Create project document if AI classified it
            ai_info = ai_files.get(sf["filename"])
            if ai_info:
                doc_type = ai_info.get("doc_type", "custom")
                stage = ai_info.get("stage", "discover")
                title = ai_info.get("title", sf["filename"])
                text_content = next((t["text"] for t in file_texts if t["filename"] == sf["filename"]), "")

                cur2 = await db.execute(
                    "INSERT INTO project_documents (project_id, doc_type, title, content, stage, generated_by, created_by) VALUES (?, ?, ?, ?, ?, 'manual', ?)",
                    (project_id, doc_type, title, text_content, stage, user["id"]),
                )
                doc_id = cur2.lastrowid
                if text_content:
                    await index_document(db, project_id, doc_id, text_content)

        # 5. Detect stage
        detected = await _detect_stage(db, project_id)
        if detected != "discover":
            await db.execute(
                "UPDATE projects SET current_stage = ? WHERE id = ?",
                (detected, project_id),
            )

        await log_activity(db, project_id, user["id"], "project_created",
                          detail=json.dumps({"from": "file_upload", "file_count": len(files)}))
        await db.commit()

        return {"id": project_id, "title": project_title, "current_stage": detected}
    finally:
        await db.close()


# ── Project analytics ─────────────────────────────────────────────────────


@router.post("/{project_id}/analytics")
async def record_analytics(
    project_id: int,
    body: AnalyticsRecord,
    user: dict = Depends(get_current_user),
):
    db = await get_db()
    try:
        custom = json.dumps(body.custom_metrics or {}, ensure_ascii=False)
        await db.execute(
            """INSERT OR REPLACE INTO project_analytics
               (project_id, recorded_date, visits, signups, active_users, revenue, custom_metrics, notes)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (project_id, body.recorded_date, body.visits, body.signups,
             body.active_users, body.revenue, custom, body.notes or ""),
        )
        await db.commit()
        await log_activity(
            db, project_id, user["id"], "analytics_recorded",
            detail=json.dumps({"date": body.recorded_date, "visits": body.visits, "signups": body.signups}),
        )
        return {"status": "ok"}
    finally:
        await db.close()


@router.get("/{project_id}/analytics")
async def get_analytics(
    project_id: int,
    days: int = Query(30),
    user: dict = Depends(get_current_user),
):
    db = await get_db()
    try:
        cur = await db.execute(
            """SELECT * FROM project_analytics
               WHERE project_id = ? AND recorded_date >= date('now', ?)
               ORDER BY recorded_date DESC""",
            (project_id, f"-{days} days"),
        )
        rows = [dict(r) for r in await cur.fetchall()]

        latest = rows[0] if rows else None
        previous = rows[1] if len(rows) > 1 else None

        trends = {}
        if latest and previous:
            for key in ["visits", "signups", "active_users", "revenue"]:
                old_val = previous.get(key, 0) or 0
                new_val = latest.get(key, 0) or 0
                if old_val > 0:
                    trends[key] = round((new_val - old_val) / old_val * 100, 1)
                else:
                    trends[key] = 100.0 if new_val > 0 else 0

        return {"history": rows, "latest": latest, "trends": trends}
    finally:
        await db.close()


@router.get("/{project_id}/stats-query")
async def query_project_stats(
    project_id: int,
    q: str = Query("", description="查询类型，如 funnel, event_counts, quiz_detail 等"),
    user: dict = Depends(get_current_user),
):
    """实时查询项目的 Stats API，支持 &q= 参数指定查询类型。"""
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT stats_api_url FROM projects WHERE id = ?", (project_id,)
        )
        row = await cur.fetchone()
        if not row or not row["stats_api_url"]:
            raise HTTPException(404, "该项目未配置 Stats API")

        url = row["stats_api_url"]
        if q:
            sep = "&" if "?" in url else "?"
            url = f"{url}{sep}q={q}"

        import httpx
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            return resp.json()
    except httpx.HTTPError as e:
        raise HTTPException(502, f"Stats API 请求失败: {e}")
    finally:
        await db.close()


@router.get("/{project_id}/stats-live")
async def live_stats(
    project_id: int,
    user: dict = Depends(get_current_user),
):
    """实时拉取项目 Stats API 的基础数据（用于首页实时展示）。"""
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT stats_api_url FROM projects WHERE id = ?", (project_id,)
        )
        row = await cur.fetchone()
        if not row or not row["stats_api_url"]:
            raise HTTPException(404, "该项目未配置 Stats API")

        import httpx
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(row["stats_api_url"])
            resp.raise_for_status()
            raw = resp.json()

        # 智能扁平化：嵌套 dict 展开为 parent.child，data[] 取第一条
        flat = {}
        if isinstance(raw, dict):
            for k, v in raw.items():
                if k == "data" and isinstance(v, list) and len(v) > 0 and isinstance(v[0], dict):
                    flat.update(v[0])
                elif isinstance(v, dict):
                    # 展开嵌套 dict，如 overview.totalPV
                    for k2, v2 in v.items():
                        if not isinstance(v2, (list, dict)):
                            flat[k2] = v2
                elif not isinstance(v, (list, dict)):
                    flat[k] = v

        # 字段名归一化：常见别名 → 标准名
        ALIASES = {
            "total_visits": "visits", "visit": "visits", "pv": "visits", "pageviews": "visits",
            "totalPV": "visits", "uniqueVisitors": "active_users",
            "signup": "signups", "registrations": "signups", "registered": "signups",
            "totalWaitlist": "signups", "emailSubmits": "signups",
            "dau": "active_users", "daily_active": "active_users",
            "income": "revenue", "earnings": "revenue", "sales": "revenue",
        }
        normalized = {}
        for k, v in flat.items():
            normalized[ALIASES.get(k, k)] = v

        return {"project_id": project_id, "live": True, **normalized}
    except Exception as e:
        return {"project_id": project_id, "live": False, "error": f"Stats API 错误: {e}"}
    finally:
        await db.close()


# 字段中英对照翻译表
FIELD_CN = {
    # 通用
    "visits": "访问量", "signups": "注册数", "active_users": "活跃用户", "revenue": "收入",
    "totalPV": "总页面浏览", "uniqueVisitors": "独立访客", "totalWaitlist": "候补名单",
    "emailSubmits": "邮件提交", "conversionRate": "转化率", "totalSwipes": "总滑动次数",
    "avgScrollDepth": "平均滚动深度", "avgTimeOnPage": "平均停留时长",
    # NoFOMO
    "landing_view": "落地页浏览", "entrance_select": "选择入口", "career_select": "选择职业",
    "level_select": "选择等级", "lesson_started": "开始课程", "quiz_completed": "完成测验",
    "lesson_completed": "完成课程", "saw_paywall": "看到付费墙", "clicked_pay": "点击付费",
    "submitted_info": "提交信息", "page_view": "页面浏览", "paywall_view": "付费墙浏览",
    "thankyou_view": "感谢页浏览", "paywall_dismiss": "关闭付费墙", "profile_submit": "提交资料",
    # BlendIn
    "total_signups": "总注册", "today_signups": "今日注册", "conversion_rate": "转化率",
    "page_views_total": "总页面浏览", "today_page_views": "今日浏览",
    "avg_time_on_page_sec": "平均停留(秒)", "avg_scroll_depth_pct": "平均滚动深度%",
    "share_rate": "分享率", "survey_completion_rate": "问卷完成率",
    "viral_coefficient": "病毒系数",
    # Mirage engagement
    "hero": "首屏", "how_it_works": "使用方式", "chat_demo": "聊天演示",
    "cta": "行动号召", "gradual_reveal": "渐进展示", "quote": "引言",
    "showcase_loaded": "展示加载", "cards_exhausted": "卡片翻完",
    "card_shown": "卡片展示", "card_swipe": "卡片滑动", "scroll_depth": "滚动深度",
    "section_view": "板块浏览", "time_on_page": "停留时长",
}


def _translate_key(key: str) -> str:
    return FIELD_CN.get(key, key.replace("_", " "))


def _translate_data(raw) -> dict:
    """递归翻译所有 key 为中文，保留完整结构。"""
    if isinstance(raw, dict):
        out = {}
        for k, v in raw.items():
            cn = _translate_key(k)
            out[cn] = _translate_data(v)
        return out
    elif isinstance(raw, list):
        return [_translate_data(item) for item in raw]
    else:
        return raw


@router.get("/{project_id}/stats-full")
async def full_stats(
    project_id: int,
    user: dict = Depends(get_current_user),
):
    """获取项目 Stats API 的完整原始数据 + 中文翻译版。"""
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT stats_api_url, title FROM projects WHERE id = ?", (project_id,)
        )
        row = await cur.fetchone()
        if not row or not row["stats_api_url"]:
            raise HTTPException(404, "该项目未配置 Stats API")

        import httpx
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(row["stats_api_url"])
            resp.raise_for_status()
            raw = resp.json()

        translated = _translate_data(raw)
        return {
            "project_id": project_id,
            "project_title": row["title"],
            "raw": raw,
            "cn": translated,
        }
    except httpx.HTTPError as e:
        raise HTTPException(502, f"Stats API 请求失败: {e}")
    finally:
        await db.close()


# ── Helpers ───────────────────────────────────────────────────────────────


async def _detect_stage(db, project_id: int) -> str:
    """Detect current stage based on completed deliverables."""
    # Get all required deliverables
    cur = await db.execute(
        "SELECT stage, doc_type FROM stage_deliverables WHERE is_required = 1"
    )
    required = {}
    for r in await cur.fetchall():
        required.setdefault(r["stage"], set()).add(r["doc_type"])

    # Get existing documents
    cur = await db.execute(
        "SELECT doc_type FROM project_documents WHERE project_id = ?",
        (project_id,),
    )
    existing = {r["doc_type"] for r in await cur.fetchall()}

    # Walk stages; if all required docs exist, this stage is complete
    for i, stage in enumerate(STAGE_ORDER):
        stage_required = required.get(stage, set())
        if not stage_required.issubset(existing):
            return stage  # This stage is incomplete, project is here

    return STAGE_ORDER[-1]  # All complete
