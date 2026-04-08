#!/usr/bin/env python3
"""
PM Agent MCP Server
Exposes project management capabilities to Claude Code / Claude Desktop via MCP protocol.

Usage:
  python mcp_server.py [--api-url http://10.1.0.111:8899]

Add to Claude Code settings.json:
  "mcpServers": {
    "pm-agent": {
      "command": "python3",
      "args": ["/path/to/mcp_server.py", "--api-url", "http://10.1.0.111:8899"]
    }
  }
"""

import argparse
import json
import sys
import httpx
from mcp.server.fastmcp import FastMCP

# ── Parse args ────────────────────────────────────────────────────────────────

parser = argparse.ArgumentParser()
parser.add_argument("--api-url", default="http://10.1.0.111:8899", help="Backend API base URL")
args, _ = parser.parse_known_args()
API_BASE = args.api_url.rstrip("/") + "/api"

# ── Auth state ────────────────────────────────────────────────────────────────

_token: str | None = None


def _headers() -> dict:
    h = {"Content-Type": "application/json"}
    if _token:
        h["Authorization"] = f"Bearer {_token}"
    return h


def _get(path: str, params: dict | None = None) -> dict:
    r = httpx.get(f"{API_BASE}{path}", headers=_headers(), params=params, timeout=30)
    r.raise_for_status()
    return r.json()


def _post(path: str, data: dict | None = None) -> dict:
    r = httpx.post(f"{API_BASE}{path}", headers=_headers(), json=data or {}, timeout=300)
    r.raise_for_status()
    return r.json()


def _patch(path: str, data: dict) -> dict:
    r = httpx.patch(f"{API_BASE}{path}", headers=_headers(), json=data, timeout=30)
    r.raise_for_status()
    return r.json()


def _delete(path: str) -> dict:
    r = httpx.delete(f"{API_BASE}{path}", headers=_headers(), timeout=30)
    r.raise_for_status()
    return r.json()


# ── MCP Server ────────────────────────────────────────────────────────────────

mcp = FastMCP(
    "PM Agent",
    instructions="产品经理 Agent 项目管理系统 - 管理需求、项目、文档、讨论。使用前需先调用 login 工具登录。",
)

# ── Auth ──────────────────────────────────────────────────────────────────────


@mcp.tool()
def login(username: str, password: str) -> str:
    """登录 PM Agent 系统。必须先登录才能使用其他工具。"""
    global _token
    result = _post("/auth/login", {"username": username, "password": password})
    _token = result.get("access_token")
    user = result.get("user", {})
    return f"登录成功：{user.get('display_name', username)} ({user.get('role', 'member')})"


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
def roundtable_read(room_id: int, limit: int = 30) -> str:
    """读取圆桌讨论室的消息。"""
    data = _get(f"/roundtable/rooms/{room_id}", params={"limit": str(limit)})
    messages = data.get("messages", [])
    lines = [f"🔵 圆桌: {data.get('title', '')}", f"话题: {data.get('topic', '')}\n"]

    ICONS = {"human": "👤", "claude_code": "🖥️", "pm_agent": "🤖", "system": "⚙️"}
    for m in messages:
        icon = ICONS.get(m["sender_type"], "💬")
        time = m["created_at"][11:16] if len(m.get("created_at", "")) > 16 else ""
        lines.append(f"{icon} [{time}] {m['sender_name']}: {m['content']}")

    return "\n".join(lines)


@mcp.tool()
def roundtable_post(room_id: int, message: str) -> str:
    """在圆桌讨论室发送消息（以 Claude Code 身份）。使用 @pm_agent 可以呼叫 PM Agent 参与讨论。"""
    result = _post(f"/roundtable/rooms/{room_id}/messages", {
        "content": message,
        "sender_type": "claude_code",
        "sender_name": "Claude Code"
    })
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


# ── Dashboard ─────────────────────────────────────────────────────────────────


@mcp.tool()
def dashboard() -> str:
    """查看仪表盘概览：采集数据量、需求数、平均评分、平台分布等。"""
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
    """查看需求池列表。
    stage: discovered/filtered/validated (留空=全部)
    track: A=痛点洞察 B=竞品洞察 (留空=全部)
    sort: score_desc/score_asc/newest/oldest
    """
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
        score = d.get("score_total", 0)
        lines.append(
            f"[{d['id']}] {d['title']} (评分: {score:.1f}, 阶段: {d.get('stage', '?')}, Track: {d.get('track', 'A')})"
        )
    return "\n".join(lines)


@mcp.tool()
def demand_detail(demand_id: int) -> str:
    """查看某个需求的详细信息，包括描述、AI 分析、各维度评分。"""
    d = _get(f"/demands/{demand_id}")
    lines = [
        f"标题: {d['title']}",
        f"描述: {d.get('description', '')}",
        f"阶段: {d.get('stage', '?')}",
        f"总评分: {d.get('score_total', 0):.1f}",
        f"  痛点: {d.get('score_pain', 0)} | 竞争: {d.get('score_competition', 0)} | 冷启动: {d.get('score_cold_start', 0)}",
        f"  成本: {d.get('score_cost', 0)} | 传播: {d.get('score_virality', 0)} | LTV: {d.get('score_ltv', 0)} | AI机会: {d.get('score_ai_opportunity', 0)}",
    ]
    if d.get("ai_analysis"):
        lines.append(f"AI 分析: {d['ai_analysis'][:500]}")
    return "\n".join(lines)


# ── Projects ──────────────────────────────────────────────────────────────────


@mcp.tool()
def list_projects(stage: str = "", status: str = "") -> str:
    """查看所有项目。可按阶段和状态过滤。
    stage: discover/value_filter/validate/pmf/business_model
    status: active/paused/completed/archived
    """
    params = {}
    if stage:
        params["stage"] = stage
    if status:
        params["status"] = status
    projects = _get("/projects", params)
    if not projects:
        return "暂无项目"
    lines = []
    stage_names = {
        "discover": "发现需求",
        "value_filter": "价值过滤",
        "validate": "验证需求",
        "pmf": "PMF验证",
        "business_model": "商业模型验证",
    }
    for p in projects:
        sn = stage_names.get(p.get("current_stage", ""), p.get("current_stage", ""))
        lines.append(
            f"[{p['id']}] {p['title']} | 阶段: {sn} | 文档: {p.get('doc_count', 0)} | 成员: {p.get('member_count', 0)}"
        )
    return "\n".join(lines)


@mcp.tool()
def project_kanban() -> str:
    """看板视图：按 5 个阶段分组展示所有项目。"""
    data = _get("/projects/kanban")
    stage_names = {
        "discover": "发现需求",
        "value_filter": "价值过滤",
        "validate": "验证需求",
        "pmf": "PMF验证",
        "business_model": "商业模型验证",
    }
    lines = []
    for stage_key in ["discover", "value_filter", "validate", "pmf", "business_model"]:
        projects = data.get(stage_key, [])
        lines.append(f"\n## {stage_names[stage_key]} ({len(projects)})")
        if not projects:
            lines.append("  (空)")
        for p in projects:
            lines.append(f"  [{p['id']}] {p['title']}")
    return "\n".join(lines)


@mcp.tool()
def create_project(title: str, description: str = "", demand_id: int = 0) -> str:
    """创建新项目。可指定 demand_id 从需求池创建（自动导入已有分析结果）。"""
    data = {"title": title, "description": description}
    if demand_id:
        data["demand_id"] = demand_id
    result = _post("/projects", data)
    return f"项目已创建：[{result['id']}] {result['title']} (阶段: {result.get('current_stage', 'discover')})"


@mcp.tool()
def project_detail(project_id: int) -> str:
    """查看项目详情：基本信息、成员、当前阶段交付物。"""
    p = _get(f"/projects/{project_id}")
    stage_names = {
        "discover": "发现需求",
        "value_filter": "价值过滤",
        "validate": "验证需求",
        "pmf": "PMF验证",
        "business_model": "商业模型验证",
    }
    lines = [
        f"项目: {p['title']}",
        f"描述: {p.get('description', '')}",
        f"阶段: {stage_names.get(p['current_stage'], p['current_stage'])}",
        f"状态: {p.get('status', '?')}",
        f"创建时间: {p.get('created_at', '')}",
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
        lines.append(f"  访问量: {analytics.get('visits', 0)}")
        lines.append(f"  注册数: {analytics.get('signups', 0)}")
        lines.append(f"  活跃用户: {analytics.get('active_users', 0)}")
        lines.append(f"  收入: {analytics.get('revenue', 0)}")
        # 动态展示扩展指标
        custom = analytics.get("custom_metrics")
        if custom and isinstance(custom, str):
            import json as _json
            try: custom = _json.loads(custom)
            except Exception: custom = {}
        if custom and isinstance(custom, dict):
            for k, v in custom.items():
                lines.append(f"  {k}: {v}")
        if analytics.get("notes"):
            lines.append(f"  备注: {analytics['notes']}")

    members = p.get("members", [])
    if members:
        lines.append(f"成员 ({len(members)}):")
        for m in members:
            lines.append(f"  - {m.get('display_name', m.get('username', '?'))} ({m.get('role', 'member')})")
    return "\n".join(lines)


# query_project_stats merged into project_detail


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
                        parts = []
                        for ik, iv in item.items():
                            parts.append(f"{ik}: {iv}")
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
    stage_names = {
        "discover": "发现需求",
        "value_filter": "价值过滤",
        "validate": "验证需求",
        "pmf": "PMF验证",
        "business_model": "商业模型验证",
    }
    lines = []
    for stage_key in ["discover", "value_filter", "validate", "pmf", "business_model"]:
        deliverables = data.get(stage_key, [])
        if not deliverables:
            continue
        lines.append(f"\n### {stage_names[stage_key]}")
        for d in deliverables:
            check = "x" if d.get("completed") else " "
            req = " *" if d.get("is_required") else ""
            status = f" ({d.get('doc_status', '')})" if d.get("completed") else ""
            lines.append(f"  [{check}] {d['title']}{req}{status}")
    return "\n".join(lines)


# ── Documents ─────────────────────────────────────────────────────────────────


@mcp.tool()
def list_documents(project_id: int, stage: str = "") -> str:
    """查看项目文档列表。可按阶段过滤。"""
    params = {}
    if stage:
        params["stage"] = stage
    result = _get(f"/projects/{project_id}/documents", params)
    docs = result.get("documents", result) if isinstance(result, dict) else result
    if not docs:
        return "暂无文档"
    lines = []
    for d in docs:
        lines.append(
            f"[{d['id']}] {d['title']} | 类型: {d.get('doc_type', '?')} | 阶段: {d.get('stage', '?')} | 状态: {d.get('status', '?')} | 生成: {d.get('generated_by', '?')}"
        )
    return "\n".join(lines)


@mcp.tool()
def read_document(project_id: int, doc_id: int) -> str:
    """读取文档内容（Markdown）。"""
    d = _get(f"/projects/{project_id}/documents/{doc_id}")
    return f"# {d['title']}\n\n类型: {d.get('doc_type', '?')} | 阶段: {d.get('stage', '?')} | 状态: {d.get('status', '?')}\n\n---\n\n{d.get('content', '(空)')}"


@mcp.tool()
def generate_document(project_id: int, doc_type: str, extra_instructions: str = "") -> str:
    """AI 生成项目文档。
    doc_type: one_pager/signal_summary/scoring_report/competitive_research/user_research/tam_analysis/positioning/prd/prototype_brief/user_test_plan/business_model_canvas/unit_economics/go_to_market
    """
    data = {"doc_type": doc_type}
    if extra_instructions:
        data["extra_instructions"] = extra_instructions
    result = _post(f"/projects/{project_id}/documents/generate", data)
    return f"文档已生成：[{result['id']}] {result['title']}\n\n{result.get('content', '')[:1000]}..."


@mcp.tool()
def update_document(project_id: int, doc_id: int, content: str = "", status: str = "") -> str:
    """编辑文档内容或更新状态。status: draft/review/approved"""
    data = {}
    if content:
        data["content"] = content
    if status:
        data["status"] = status
    result = _patch(f"/projects/{project_id}/documents/{doc_id}", data)
    return f"文档已更新：{result.get('title', '')} (v{result.get('version', 1)}, 状态: {result.get('status', '?')})"


# ── Discussions ───────────────────────────────────────────────────────────────


@mcp.tool()
def list_discussions(project_id: int) -> str:
    """查看项目讨论列表。"""
    threads = _get(f"/projects/{project_id}/discussions")
    if not threads:
        return "暂无讨论"
    lines = []
    for t in threads:
        lines.append(
            f"[{t['id']}] {t.get('title', '无标题')} | 消息: {t.get('message_count', 0)} | 创建: {t.get('creator_name', '?')}"
        )
    return "\n".join(lines)


@mcp.tool()
def read_discussion(project_id: int, thread_id: int) -> str:
    """读取讨论主题及所有消息。"""
    data = _get(f"/projects/{project_id}/discussions/{thread_id}")
    lines = [f"讨论: {data.get('title', '无标题')}", "---"]
    for msg in data.get("messages", []):
        role = "AI" if msg["role"] == "assistant" else (msg.get("display_name") or "用户")
        lines.append(f"\n**{role}** ({msg.get('created_at', '')}):\n{msg['content']}")
    return "\n".join(lines)


@mcp.tool()
def discuss(project_id: int, thread_id: int, message: str) -> str:
    """在讨论中发送消息并获取 AI 回复。"""
    result = _post(f"/projects/{project_id}/discussions/{thread_id}/ai", {"content": message})
    ai_msg = result.get("ai_message", {})
    return f"AI 回复:\n\n{ai_msg.get('content', '(无回复)')}"


@mcp.tool()
def create_discussion(project_id: int, title: str, document_id: int = 0) -> str:
    """创建新讨论主题。可关联文档 (document_id)。"""
    data = {"title": title, "thread_type": "document" if document_id else "general"}
    if document_id:
        data["document_id"] = document_id
    result = _post(f"/projects/{project_id}/discussions", data)
    return f"讨论已创建：[{result['id']}] {title}"


# ── Stage Gates ───────────────────────────────────────────────────────────────


@mcp.tool()
def open_stage_gate(project_id: int) -> str:
    """发起阶段评审投票（需当前阶段所有必需交付物已 approved）。"""
    result = _post(f"/projects/{project_id}/gates")
    return f"评审已发起：{result.get('from_stage', '?')} → {result.get('to_stage', '?')}"


@mcp.tool()
def vote_stage_gate(project_id: int, gate_id: int, vote: str, comment: str = "") -> str:
    """对阶段评审投票。vote: approve/reject"""
    result = _post(f"/projects/{project_id}/gates/{gate_id}/vote", {"vote": vote, "comment": comment})
    passed = result.get("gate_passed", False)
    return f"投票完成 ({vote})。通过票: {result.get('approve_count', 0)}/{result.get('total_members', 0)}。{'阶段已推进!' if passed else '等待更多投票。'}"


# ── Knowledge Base ────────────────────────────────────────────────────────────


@mcp.tool()
def search_knowledge(query: str) -> str:
    """搜索全局知识库。"""
    result = _post("/knowledge/search", {"query": query})
    if not result:
        return "未找到相关内容"
    chunks = result if isinstance(result, list) else result.get("results", [])
    lines = []
    for c in chunks[:5]:
        content = c.get("content", "")[:300]
        lines.append(f"---\n{content}")
    return "\n".join(lines) if lines else "未找到相关内容"


# ask_knowledge merged into search_knowledge

# ── Agent ─────────────────────────────────────────────────────────────────────


@mcp.tool()
def agent_status() -> str:
    """查看 PM Agent 状态及待审批 checkpoint。"""
    s = _get("/agent/status")
    lines = [
        f"状态: {'运行中' if s.get('enabled') else '已停止'}",
        f"待审批: {s.get('pending_checkpoints', 0)}",
        f"上次阶段: {s.get('last_phase', '-')}",
        f"循环间隔: {s.get('cycle_interval', 3600)}秒",
    ]
    try:
        cps = _get("/agent/checkpoints", {"status": "pending"})
        checkpoints = cps if isinstance(cps, list) else cps.get("checkpoints", [])
        for cp in checkpoints[:5]:
            lines.append(f"  [{cp['id']}] {cp.get('demand_title', cp.get('proposal', '')[:60])} | {cp.get('checkpoint_type', '?')}")
    except Exception:
        pass
    return "\n".join(lines)


@mcp.tool()
def resolve_checkpoint(checkpoint_id: int, action: str, feedback: str = "") -> str:
    """审批 checkpoint。action: approve/reject"""
    result = _post(f"/agent/checkpoints/{checkpoint_id}/resolve", {
        "action": action,
        "feedback": feedback,
    })
    return f"Checkpoint {checkpoint_id} 已{action}。" + (f" 反馈: {feedback}" if feedback else "")


# ── Activity ──────────────────────────────────────────────────────────────────


@mcp.tool()
def recent_activity(project_id: int = 0, limit: int = 20) -> str:
    """查看最近活动。指定 project_id 看单个项目的活动，不指定看全局。"""
    if project_id:
        items = _get(f"/activity/project/{project_id}", {"limit": str(limit)})
    else:
        items = _get("/activity", {"limit": str(limit)})
    if not items:
        return "暂无活动"
    lines = []
    for a in items:
        who = a.get("display_name") or a.get("username", "?")
        proj = a.get("project_title", "")
        lines.append(f"{a.get('created_at', '')} | {who} | {a['action']} | {proj}")
    return "\n".join(lines)


# ── Data Fetching ─────────────────────────────────────────────────────────────


@mcp.tool()
def fetch_all_sources() -> str:
    """触发一键采集并自动运行 AI 分析提取需求。"""
    result = _post("/sources/fetch-all")
    return f"采集已启动。Job ID: {result.get('job_id', '?')}\n采集完成后会自动运行 AI 分析。"


# ── Run ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    mcp.run()
