#!/usr/bin/env python3
"""
PM Agent MCP Server (SSE mode)
远程 SSE 模式，运行在服务器上，同事们只需在 Claude Code 里加一个 URL 即可使用。

启动方式：
  python3 mcp_sse_server.py --port 8851

同事配置（Claude Code settings.json）：
  "mcpServers": {
    "pm-agent": {
      "url": "http://10.1.0.111:8851/sse"
    }
  }
"""

import argparse
import json
import httpx
from mcp.server.fastmcp import FastMCP

# ── Config ────────────────────────────────────────────────────────────────────

API_BASE = "http://127.0.0.1:8000/api"

# ── HTTP helpers ──────────────────────────────────────────────────────────────

# Per-session token storage (keyed by a simple session concept)
# For SSE mode, each connection gets its own tool call context,
# but we use a module-level dict keyed by username for simplicity.
_tokens: dict[str, str] = {}
_current_token: str = ""


def _headers() -> dict:
    h = {"Content-Type": "application/json"}
    if _current_token:
        h["Authorization"] = f"Bearer {_current_token}"
    return h


def _get(path: str, params: dict | None = None) -> dict:
    try:
        r = httpx.get(f"{API_BASE}{path}", headers=_headers(), params=params, timeout=30)
        r.raise_for_status()
        return r.json()
    except httpx.HTTPStatusError as e:
        return {"error": f"API 错误 ({e.response.status_code}): {e.response.text[:200]}"}
    except httpx.RequestError as e:
        return {"error": f"连接失败: {str(e)}"}
    except Exception as e:
        return {"error": f"请求异常: {str(e)}"}


def _post(path: str, data: dict | None = None) -> dict:
    try:
        r = httpx.post(f"{API_BASE}{path}", headers=_headers(), json=data or {}, timeout=300)
        r.raise_for_status()
        return r.json()
    except httpx.HTTPStatusError as e:
        return {"error": f"API 错误 ({e.response.status_code}): {e.response.text[:200]}"}
    except httpx.RequestError as e:
        return {"error": f"连接失败: {str(e)}"}
    except Exception as e:
        return {"error": f"请求异常: {str(e)}"}


def _patch(path: str, data: dict) -> dict:
    try:
        r = httpx.patch(f"{API_BASE}{path}", headers=_headers(), json=data, timeout=30)
        r.raise_for_status()
        return r.json()
    except httpx.HTTPStatusError as e:
        return {"error": f"API 错误 ({e.response.status_code}): {e.response.text[:200]}"}
    except httpx.RequestError as e:
        return {"error": f"连接失败: {str(e)}"}
    except Exception as e:
        return {"error": f"请求异常: {str(e)}"}


def _delete(path: str) -> dict:
    try:
        r = httpx.delete(f"{API_BASE}{path}", headers=_headers(), timeout=30)
        r.raise_for_status()
        return r.json()
    except httpx.HTTPStatusError as e:
        return {"error": f"API 错误 ({e.response.status_code}): {e.response.text[:200]}"}
    except httpx.RequestError as e:
        return {"error": f"连接失败: {str(e)}"}
    except Exception as e:
        return {"error": f"请求异常: {str(e)}"}


# ── MCP Server ────────────────────────────────────────────────────────────────

mcp = FastMCP(
    "PM Agent",
    instructions="产品经理 Agent 项目管理系统。使用前需先调用 login 工具登录。",
    host="0.0.0.0",
    port=8851,
)

# ── Auth ──────────────────────────────────────────────────────────────────────


@mcp.tool()
def login(username: str, password: str) -> str:
    """登录 PM Agent 系统。必须先登录才能使用其他工具。"""
    global _current_token
    result = _post("/auth/login", {"username": username, "password": password})
    _current_token = result.get("access_token", "")
    _tokens[username] = _current_token
    user = result.get("user", {})
    return f"登录成功：{user.get('display_name', username)} ({user.get('role', 'member')})"


# ── Dashboard ─────────────────────────────────────────────────────────────────


@mcp.tool()
def dashboard() -> str:
    """查看仪表盘概览：采集数据量、需求数、平均评分等。"""
    d = _get("/dashboard")
    lines = [
        f"采集数据: {d.get('total_items', 0)}",
        f"今日新增: {d.get('items_today', 0)}",
        f"已发现需求: {d.get('total_demands', 0)}",
        f"平均评分: {d.get('avg_score', 0):.1f}",
        f"活跃数据源: {d.get('active_sources', 0)}/{d.get('total_sources', 0)}",
    ]
    return "\n".join(lines)


# ── Demands ───────────────────────────────────────────────────────────────────


@mcp.tool()
def list_demands(
    stage: str = "",
    track: str = "",
    min_score: float = 0,
    sort: str = "score_desc",
    limit: int = 20,
) -> str:
    """查看需求池。stage: discovered/filtered/validated; track: A=痛点 B=竞品; sort: score_desc/newest"""
    params = {"sort": sort, "limit": str(limit)}
    if stage:
        params["stage"] = stage
    if track:
        params["track"] = track
    if min_score > 0:
        params["min_score"] = str(min_score)
    demands = _get("/demands", params)
    if not demands:
        return "需求池为空"
    lines = []
    for d in demands:
        lines.append(f"[{d['id']}] {d['title']} (评分: {d.get('score_total', 0):.1f}, 阶段: {d.get('stage', '?')})")
    return "\n".join(lines)


@mcp.tool()
def demand_detail(demand_id: int) -> str:
    """查看需求详情：描述、AI 分析、各维度评分。"""
    d = _get(f"/demands/{demand_id}")
    lines = [
        f"标题: {d['title']}",
        f"描述: {d.get('description', '')}",
        f"总评分: {d.get('score_total', 0):.1f}",
        f"  痛点: {d.get('score_pain', 0)} | 竞争: {d.get('score_competition', 0)} | 冷启动: {d.get('score_cold_start', 0)}",
        f"  成本: {d.get('score_cost', 0)} | 传播: {d.get('score_virality', 0)} | LTV: {d.get('score_ltv', 0)} | AI: {d.get('score_ai_opportunity', 0)}",
    ]
    if d.get("ai_analysis"):
        lines.append(f"AI 分析: {d['ai_analysis'][:500]}")
    return "\n".join(lines)


# ── Projects ──────────────────────────────────────────────────────────────────

STAGE_NAMES = {
    "discover": "发现需求", "value_filter": "价值过滤", "validate": "验证需求",
    "pmf": "PMF验证", "business_model": "商业模型验证",
}


@mcp.tool()
def list_projects(stage: str = "", status: str = "") -> str:
    """查看所有项目。stage: discover/value_filter/validate/pmf/business_model"""
    params = {}
    if stage:
        params["stage"] = stage
    if status:
        params["status"] = status
    projects = _get("/projects", params)
    if not projects:
        return "暂无项目"
    lines = []
    for p in projects:
        sn = STAGE_NAMES.get(p.get("current_stage", ""), p.get("current_stage", ""))
        lines.append(f"[{p['id']}] {p['title']} | {sn} | 文档:{p.get('doc_count', 0)} 成员:{p.get('member_count', 0)}")
    return "\n".join(lines)


@mcp.tool()
def project_kanban() -> str:
    """看板视图：按 5 阶段分组展示项目。"""
    data = _get("/projects/kanban")
    lines = []
    for key in ["discover", "value_filter", "validate", "pmf", "business_model"]:
        projects = data.get(key, [])
        lines.append(f"\n## {STAGE_NAMES[key]} ({len(projects)})")
        for p in projects:
            lines.append(f"  [{p['id']}] {p['title']}")
        if not projects:
            lines.append("  (空)")
    return "\n".join(lines)


@mcp.tool()
def create_project(title: str, description: str = "", demand_id: int = 0) -> str:
    """创建新项目。指定 demand_id 可从需求池创建并自动导入分析结果。"""
    data = {"title": title, "description": description}
    if demand_id:
        data["demand_id"] = demand_id
    result = _post("/projects", data)
    return f"项目已创建：[{result['id']}] {result['title']} (阶段: {result.get('current_stage', 'discover')})"


@mcp.tool()
def project_detail(project_id: int) -> str:
    """查看项目详情：信息、成员、阶段。"""
    p = _get(f"/projects/{project_id}")
    lines = [
        f"项目: {p['title']}",
        f"描述: {p.get('description', '')}",
        f"阶段: {STAGE_NAMES.get(p['current_stage'], p['current_stage'])}",
        f"状态: {p.get('status', '?')}",
    ]
    # Deployment links
    urls = []
    if p.get("landing_page_url"): urls.append(f"Landing Page: {p['landing_page_url']}")
    if p.get("mvp_url"): urls.append(f"MVP: {p['mvp_url']}")
    if p.get("analytics_dashboard_url"): urls.append(f"数据看板: {p['analytics_dashboard_url']}")
    if urls:
        lines.append("部署链接:")
        for u in urls:
            lines.append(f"  - {u}")

    # Latest analytics
    analytics = p.get("latest_analytics")
    if analytics:
        lines.append(f"最新数据 ({analytics.get('recorded_date', '')}):")
        lines.append(f"  访问量: {analytics.get('visits', 0)} | 注册数: {analytics.get('signups', 0)} | 活跃: {analytics.get('active_users', 0)} | 收入: {analytics.get('revenue', 0)}")
        # 动态展示扩展指标
        custom = analytics.get("custom_metrics")
        if custom and isinstance(custom, str):
            import json as _json
            try: custom = _json.loads(custom)
            except Exception: custom = {}
        if custom and isinstance(custom, dict):
            extras = " | ".join(f"{k}: {v}" for k, v in custom.items())
            if extras:
                lines.append(f"  扩展: {extras}")

    for m in p.get("members", []):
        lines.append(f"  成员: {m.get('display_name', '?')} ({m.get('role', 'member')})")
    return "\n".join(lines)


@mcp.tool()
def query_project_stats(project_id: int, query: str = "") -> str:
    """实时查询项目的运营数据。
    不传 query 返回完整数据（含中文翻译）；
    传 query 可查特定维度，如 funnel(漏斗), event_counts(事件分布) 等。"""
    if query:
        params = {"q": query}
        try:
            data = _get(f"/projects/{project_id}/stats-query", params=params)
        except Exception as e:
            return f"查询失败: {e}"
        return json.dumps(data, ensure_ascii=False, indent=2)
    else:
        try:
            data = _get(f"/projects/{project_id}/stats-full")
        except Exception as e:
            return f"查询失败: {e}"
        cn = data.get("cn", {})
        title = data.get("project_title", f"项目{project_id}")
        lines = [f"📊 {title} 完整运营数据\n"]
        _format_cn_data(lines, cn, depth=0)
        return "\n".join(lines)


def _format_cn_data(lines: list, data, depth: int = 0):
    """递归格式化中文数据为可读文本。"""
    indent = "  " * depth
    if isinstance(data, dict):
        for k, v in data.items():
            if isinstance(v, dict):
                lines.append(f"{indent}【{k}】")
                _format_cn_data(lines, v, depth + 1)
            elif isinstance(v, list):
                lines.append(f"{indent}【{k}】({len(v)}条)")
                for i, item in enumerate(v):
                    if isinstance(item, dict):
                        parts = [f"{ik}: {iv}" for ik, iv in item.items()]
                        lines.append(f"{indent}  {i+1}. {' | '.join(parts)}")
                    else:
                        lines.append(f"{indent}  - {item}")
            else:
                lines.append(f"{indent}{k}: {v}")
    elif isinstance(data, list):
        for item in data:
            _format_cn_data(lines, item, depth)


@mcp.tool()
def project_progress(project_id: int) -> str:
    """查看项目各阶段交付物完成情况。"""
    data = _get(f"/projects/{project_id}/progress")
    lines = []
    for key in ["discover", "value_filter", "validate", "pmf", "business_model"]:
        items = data.get(key, [])
        if not items:
            continue
        lines.append(f"\n### {STAGE_NAMES[key]}")
        for d in items:
            check = "x" if d.get("completed") else " "
            req = " *" if d.get("is_required") else ""
            lines.append(f"  [{check}] {d['title']}{req}")
    return "\n".join(lines)


# ── Documents ─────────────────────────────────────────────────────────────────


@mcp.tool()
def list_documents(project_id: int, stage: str = "") -> str:
    """查看项目文档列表。"""
    params = {"stage": stage} if stage else {}
    result = _get(f"/projects/{project_id}/documents", params)
    docs = result.get("documents", result) if isinstance(result, dict) else result
    if not docs:
        return "暂无文档"
    lines = []
    for d in docs:
        lines.append(f"[{d['id']}] {d['title']} | {d.get('doc_type', '?')} | {d.get('status', '?')}")
    return "\n".join(lines)


@mcp.tool()
def read_document(project_id: int, doc_id: int) -> str:
    """读取文档内容。"""
    d = _get(f"/projects/{project_id}/documents/{doc_id}")
    return f"# {d['title']}\n类型: {d.get('doc_type')} | 状态: {d.get('status')}\n\n{d.get('content', '(空)')}"


@mcp.tool()
def generate_document(project_id: int, doc_type: str, extra_instructions: str = "") -> str:
    """AI 生成文档。doc_type: one_pager/signal_summary/scoring_report/competitive_research/user_research/tam_analysis/positioning/prd/prototype_brief/business_model_canvas/unit_economics/go_to_market"""
    data = {"doc_type": doc_type}
    if extra_instructions:
        data["extra_instructions"] = extra_instructions
    result = _post(f"/projects/{project_id}/documents/generate", data)
    return f"已生成：[{result['id']}] {result['title']}\n\n{result.get('content', '')[:1000]}..."


@mcp.tool()
def update_document(project_id: int, doc_id: int, content: str = "", status: str = "") -> str:
    """编辑文档或更新状态。status: draft/review/approved"""
    data = {}
    if content:
        data["content"] = content
    if status:
        data["status"] = status
    result = _patch(f"/projects/{project_id}/documents/{doc_id}", data)
    return f"已更新：{result.get('title', '')} (v{result.get('version', 1)}, {result.get('status', '?')})"


# ── Discussions ───────────────────────────────────────────────────────────────


@mcp.tool()
def list_discussions(project_id: int) -> str:
    """查看项目讨论列表。"""
    threads = _get(f"/projects/{project_id}/discussions")
    if not threads:
        return "暂无讨论"
    lines = []
    for t in threads:
        lines.append(f"[{t['id']}] {t.get('title', '无标题')} | 消息:{t.get('message_count', 0)}")
    return "\n".join(lines)


@mcp.tool()
def read_discussion(project_id: int, thread_id: int) -> str:
    """读取讨论消息。"""
    data = _get(f"/projects/{project_id}/discussions/{thread_id}")
    lines = [f"讨论: {data.get('title', '')}", "---"]
    for msg in data.get("messages", []):
        role = "AI" if msg["role"] == "assistant" else (msg.get("display_name") or "用户")
        lines.append(f"\n**{role}**:\n{msg['content']}")
    return "\n".join(lines)


@mcp.tool()
def discuss(project_id: int, thread_id: int, message: str) -> str:
    """发送消息并获取 AI 回复。"""
    result = _post(f"/projects/{project_id}/discussions/{thread_id}/ai", {"content": message})
    return f"AI 回复:\n\n{result.get('ai_message', {}).get('content', '(无回复)')}"


@mcp.tool()
def create_discussion(project_id: int, title: str, document_id: int = 0) -> str:
    """创建讨论。可关联文档。"""
    data = {"title": title, "thread_type": "document" if document_id else "general"}
    if document_id:
        data["document_id"] = document_id
    result = _post(f"/projects/{project_id}/discussions", data)
    return f"讨论已创建：[{result['id']}] {title}"


# ── Stage Gates ───────────────────────────────────────────────────────────────


@mcp.tool()
def open_stage_gate(project_id: int) -> str:
    """发起阶段评审（需所有必需交付物已 approved）。"""
    result = _post(f"/projects/{project_id}/gates")
    return f"评审已发起：{result.get('from_stage')} → {result.get('to_stage')}"


@mcp.tool()
def vote_stage_gate(project_id: int, gate_id: int, vote: str, comment: str = "") -> str:
    """投票。vote: approve/reject"""
    result = _post(f"/projects/{project_id}/gates/{gate_id}/vote", {"vote": vote, "comment": comment})
    passed = result.get("gate_passed", False)
    return f"已投票({vote})。{result.get('approve_count', 0)}/{result.get('total_members', 0)}。{'阶段已推进!' if passed else ''}"


# ── Knowledge & Agent ─────────────────────────────────────────────────────────


@mcp.tool()
def search_knowledge(query: str) -> str:
    """搜索知识库。"""
    result = _post("/knowledge/search", {"query": query})
    chunks = result if isinstance(result, list) else result.get("results", [])
    return "\n---\n".join(c.get("content", "")[:300] for c in chunks[:5]) or "未找到"


@mcp.tool()
def agent_status() -> str:
    """查看 PM Agent 状态。"""
    s = _get("/agent/status")
    return f"状态: {'运行中' if s.get('enabled') else '已停止'} | 待审批: {s.get('pending_checkpoints', 0)} | 上次: {s.get('last_phase', '-')}"


@mcp.tool()
def fetch_all_sources() -> str:
    """触发一键采集所有数据源。"""
    result = _post("/sources/fetch-all")
    return f"采集已启动。Job ID: {result.get('job_id', '?')}"


@mcp.tool()
def run_ai_analysis() -> str:
    """对采集数据运行 AI 分析提取需求。"""
    result = _post("/analysis/extract", {"auto": True, "use_knowledge": True})
    return f"分析已启动。Job ID: {result.get('job_id', '?')}"


@mcp.tool()
def recent_activity(project_id: int = 0, limit: int = 20) -> str:
    """查看最近活动。project_id=0 看全局。"""
    path = f"/activity/project/{project_id}" if project_id else "/activity"
    items = _get(path, {"limit": str(limit)})
    if not items:
        return "暂无活动"
    lines = []
    for a in items:
        who = a.get("display_name") or a.get("username", "?")
        lines.append(f"{a.get('created_at', '')} | {who} | {a['action']}")
    return "\n".join(lines)


# ── Lessons (教训复盘) ────────────────────────────────────────────────────────


@mcp.tool()
def submit_lesson(
    title: str,
    lesson: str,
    category: str = "other",
    severity: str = "medium",
    background: str = "",
    prevention_rule: str = "",
) -> str:
    """提交教训复盘。category: product_direction/tech_choice/market_judgment/execution/other; severity: high/medium/low"""
    data = {
        "title": title,
        "lesson": lesson,
        "category": category,
        "severity": severity,
        "background": background,
        "prevention_rule": prevention_rule,
        "related_demand_ids": [],
    }
    result = _post("/lessons", data)
    lesson_id = result.get("id", "?")
    # Trigger deep learning
    try:
        _post(f"/lessons/{lesson_id}/learn")
    except Exception:
        pass
    return f"教训已记录并学习：[{lesson_id}] {title}"


@mcp.tool()
def list_lessons(category: str = "") -> str:
    """查看教训列表。category: product_direction/tech_choice/market_judgment/execution/other"""
    params = {}
    if category:
        params["category"] = category
    result = _get("/lessons", params)
    lessons = result.get("lessons", []) if isinstance(result, dict) else result
    if not lessons:
        return "暂无教训记录"
    severity_icons = {"high": "严重", "medium": "中等", "low": "轻微"}
    lines = []
    for l in lessons:
        sev = severity_icons.get(l.get("severity", "medium"), "?")
        lines.append(f"[{l['id']}] [{sev}] {l['title']} ({l.get('category', '?')})")
    return "\n".join(lines)


@mcp.tool()
def search_lessons(query: str) -> str:
    """搜索相关教训（通过知识库 RAG 检索）。"""
    result = _post("/knowledge/search", {"query": query, "category": "", "limit": 10})
    chunks = result if isinstance(result, list) else result.get("results", [])
    # Filter to lesson-related chunks
    lesson_chunks = [c for c in chunks if "[教训" in c.get("doc_title", "") or "lesson:" in c.get("category", "")]
    if not lesson_chunks:
        return "未找到相关教训"
    return "\n---\n".join(c.get("content", "")[:300] for c in lesson_chunks[:5])


# ── Roundtable ────────────────────────────────────────────────────────────────


@mcp.tool()
def roundtable_list() -> str:
    """列出所有活跃的圆桌讨论室。"""
    rooms = _get("/roundtable/rooms")
    if not rooms:
        return "暂无圆桌讨论室。使用 roundtable_create 创建一个。"
    lines = ["📋 圆桌讨论室列表\n"]
    for r in rooms:
        project = f" [项目: {r.get('project_title', '')}]" if r.get('project_id') else ""
        count = r.get('message_count', 0)
        lines.append(f"  #{r['id']} {r['title']}{project} — {count}条消息")
        if r.get('topic'):
            lines.append(f"      话题: {r['topic']}")
    return "\n".join(lines)


@mcp.tool()
def _get_open(path: str, params: dict | None = None) -> dict:
    """No-auth GET via open API."""
    try:
        r = httpx.get(f"{API_BASE}{path}", params=params, timeout=30)
        r.raise_for_status()
        return r.json()
    except Exception as e:
        return {"error": str(e)}


def _post_open(path: str, data: dict | None = None) -> dict:
    """No-auth POST via open API."""
    try:
        r = httpx.post(f"{API_BASE}{path}", json=data or {}, timeout=300,
                       headers={"Content-Type": "application/json"})
        r.raise_for_status()
        return r.json()
    except Exception as e:
        return {"error": str(e)}


# Cache: room_id -> invite_token
_room_tokens: dict[int, str] = {}


def _resolve_room_token(room_id: int) -> str | None:
    """Get invite_token for a room (cached). Returns None if not found."""
    if room_id in _room_tokens:
        return _room_tokens[room_id]
    # Try listing rooms to find token (needs auth)
    data = _get("/roundtable/rooms")
    if isinstance(data, list):
        for r in data:
            if r.get("invite_token"):
                _room_tokens[r["id"]] = r["invite_token"]
        return _room_tokens.get(room_id)
    elif isinstance(data, dict) and data.get("rooms"):
        for r in data["rooms"]:
            if r.get("invite_token"):
                _room_tokens[r["id"]] = r["invite_token"]
        return _room_tokens.get(room_id)
    return None


@mcp.tool()
def roundtable_read(room_id: int, limit: int = 30) -> str:
    """读取圆桌讨论室的消息。如果未登录会自动尝试免认证方式读取。"""
    data = _get(f"/roundtable/rooms/{room_id}", params={"limit": str(limit)})

    # If auth failed (401), try open API with invite_token
    if data.get("error") and "401" in str(data.get("error", "")):
        token = _resolve_room_token(room_id)
        if token:
            data = _get_open(f"/roundtable/open/{token}/messages", params={"limit": str(limit)})
            if data.get("error"):
                return f"❌ 读取圆桌失败: {data['error']}\n💡 请先使用 login 工具登录。"
            # open API returns {room_id, title, messages}
            messages = data.get("messages", [])
            lines = [f"🔵 圆桌: {data.get('title', '')} (免认证模式)\n"]
            ICONS = {"human": "👤", "claude_code": "🖥️", "pm_agent": "🤖", "system": "⚙️", "agent": "🔗"}
            for m in messages:
                icon = ICONS.get(m["sender_type"], "💬")
                time = m["created_at"][11:16] if len(m.get("created_at", "")) > 16 else ""
                lines.append(f"{icon} [{time}] {m['sender_name']}: {m['content']}")
            if not messages:
                lines.append("（暂无消息）")
            return "\n".join(lines)
        return f"❌ 认证已过期，请先使用 login 工具重新登录后再读取圆桌。"

    if data.get("error"):
        return f"❌ 读取圆桌失败: {data['error']}\n💡 如果是认证问题，请先使用 login 工具登录。"

    room = data.get("room", {})
    messages = data.get("messages", [])
    # Cache token if available
    if room.get("invite_token"):
        _room_tokens[room_id] = room["invite_token"]

    lines = [f"🔵 圆桌: {room.get('title', '')}", f"话题: {room.get('topic', '')}\n"]

    ICONS = {"human": "👤", "claude_code": "🖥️", "pm_agent": "🤖", "system": "⚙️"}
    for m in messages:
        icon = ICONS.get(m["sender_type"], "💬")
        time = m["created_at"][11:16] if len(m.get("created_at", "")) > 16 else ""
        lines.append(f"{icon} [{time}] {m['sender_name']}: {m['content']}")

    if not messages:
        lines.append("（暂无消息）")

    return "\n".join(lines)


@mcp.tool()
def roundtable_post(room_id: int, message: str) -> str:
    """在圆桌讨论室发送消息（以 Claude Code 身份）。使用 @pm_agent 可以呼叫 PM Agent 参与讨论。"""
    result = _post(f"/roundtable/rooms/{room_id}/messages", {
        "content": message,
        "sender_type": "claude_code",
        "sender_name": "Claude Code"
    })
    if result.get("error"):
        err = result["error"]
        if "401" in str(err):
            # Try open API fallback
            token = _resolve_room_token(room_id)
            if token:
                # Use open API to post message
                mention = "@pm_agent" in message.lower() or "@pm" in message.lower()
                endpoint = f"/roundtable/open/{token}/pm" if mention else f"/roundtable/open/{token}/messages"
                result2 = _post_open(endpoint, {
                    "content": message,
                    "sender_type": "claude_code",
                    "sender_name": "Claude Code"
                })
                if result2.get("error"):
                    return f"❌ 免认证发送也失败: {result2['error']}\n💡 请使用 login 工具登录后重试。"
                return f"✅ 消息已发送到圆桌 #{room_id}（免认证模式）"
            return f"❌ 认证已过期，请先使用 login 工具重新登录后再发送消息。"
        return f"❌ 发送失败: {err}"
    return f"✅ 消息已发送到圆桌 #{room_id}"


@mcp.tool()
def roundtable_create(title: str, topic: str = "", project_id: int = 0) -> str:
    """创建新的圆桌讨论室。可选关联项目。"""
    data = {"title": title, "topic": topic}
    if project_id:
        data["project_id"] = project_id
    result = _post("/roundtable/rooms", data)
    rid = result.get("id", "?")
    return f"✅ 圆桌讨论室已创建: #{rid} {title}\n使用 roundtable_post({rid}, '你的消息') 开始讨论"


# ── Dreaming / Memory ────────────────────────────────────────────────────────


@mcp.tool()
def agent_dream() -> str:
    """触发 Agent 做梦 — 压缩记忆、提炼方法论、发现知识盲区并生成问题。"""
    result = _post("/agent/dream", {})
    if result.get("error"):
        return f"❌ 做梦失败: {result['error']}"
    lines = ["🌙 Agent 做梦完成："]
    comp = result.get("compression", {})
    if comp.get("status") == "ok":
        lines.append(f"  记忆压缩: {comp.get('original', '?')} → {comp.get('compressed', '?')}")
    meth = result.get("methodologies", {})
    if meth.get("status") == "ok":
        lines.append(f"  方法论: +{meth.get('new', 0)} 新增, {meth.get('updated', 0)} 更新, 共 {meth.get('total', 0)}")
    qs = result.get("questions", {})
    if qs.get("status") == "ok":
        lines.append(f"  问题: +{qs.get('new_questions', 0)} 新问题")
        for q in qs.get("questions", [])[:3]:
            lines.append(f"    ❓ {q.get('question', '')[:80]}")
    return "\n".join(lines)


@mcp.tool()
def agent_methodologies() -> str:
    """查看 Agent 积累的方法论和待解答的问题。"""
    result = _get("/agent/methodologies")
    if result.get("error"):
        return f"❌ 获取失败: {result['error']}"
    meths = result.get("methodologies", [])
    qs = result.get("pending_questions", [])
    lines = [f"📚 方法论 ({len(meths)} 条)："]
    for m in meths:
        lines.append(f"  • {m.get('title', '')}: {m.get('content', '')[:100]}")
    if qs:
        lines.append(f"\n❓ 待解答问题 ({len(qs)} 条)：")
        for q in qs:
            lines.append(f"  • [{q.get('type', '')}] {q.get('question', '')[:80]}")
    return "\n".join(lines) if meths or qs else "暂无方法论和待解答问题。先执行 agent_dream 让 Agent 做一次梦。"


# ── Run ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8851)
    args, _ = parser.parse_known_args()
    mcp.settings.port = args.port
    mcp.run(transport="sse")
