"""
PM Agent Tool Definitions — 让 Agent 在对话中能调用系统工具。

每个工具定义为 OpenAI function calling 格式 + 对应的执行函数。
"""
import json
import logging
import os
import socket
from datetime import datetime, timezone
from database import get_db

logger = logging.getLogger("agent_tools")

# ── Tool Definitions (OpenAI function calling schema) ─────────────────────

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "query_demands",
            "description": "查询需求池，支持按评分、阶段、关键词过滤",
            "parameters": {
                "type": "object",
                "properties": {
                    "min_score": {"type": "number", "description": "最低评分（0-100）"},
                    "stage": {"type": "string", "enum": ["discovered", "filtered", "validated"], "description": "需求阶段"},
                    "keyword": {"type": "string", "description": "关键词搜索"},
                    "limit": {"type": "integer", "description": "返回数量，默认10"},
                    "sort": {"type": "string", "enum": ["score_desc", "newest", "oldest"], "description": "排序方式"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_demand_detail",
            "description": "获取单个需求的完整详情，包括7维评分和AI分析",
            "parameters": {
                "type": "object",
                "properties": {
                    "demand_id": {"type": "integer", "description": "需求ID"},
                },
                "required": ["demand_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_raw_items",
            "description": "搜索原始采集数据（来自各平台的帖子/问题/讨论）",
            "parameters": {
                "type": "object",
                "properties": {
                    "keyword": {"type": "string", "description": "搜索关键词"},
                    "platform": {"type": "string", "description": "平台名（reddit, hackernews, bilibili, zhihu, stackoverflow 等）"},
                    "limit": {"type": "integer", "description": "返回数量，默认20"},
                },
                "required": ["keyword"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_dashboard_stats",
            "description": "获取仪表盘统计数据：采集总量、需求数、平均评分、各平台分布",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_knowledge",
            "description": "搜索知识库文档（团队上传的研究报告、行业资料等）",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "搜索查询"},
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_projects",
            "description": "查看项目列表及进度",
            "parameters": {
                "type": "object",
                "properties": {
                    "stage": {"type": "string", "description": "按阶段过滤"},
                    "status": {"type": "string", "enum": ["active", "paused", "completed"], "description": "项目状态"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_project_progress",
            "description": "获取指定项目的阶段进度和交付物完成情况",
            "parameters": {
                "type": "object",
                "properties": {
                    "project_id": {"type": "integer", "description": "项目ID"},
                },
                "required": ["project_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "trigger_scrape",
            "description": "触发数据采集（抓取各平台最新数据）",
            "parameters": {
                "type": "object",
                "properties": {
                    "platforms": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "要采集的平台列表，留空则采集全部",
                    },
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "run_ai_analysis",
            "description": "对原始数据运行AI分析，提取需求",
            "parameters": {
                "type": "object",
                "properties": {
                    "use_knowledge": {"type": "boolean", "description": "是否参考知识库，默认true"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "dismiss_demand",
            "description": "否决/删除一个需求（标记为不感兴趣）",
            "parameters": {
                "type": "object",
                "properties": {
                    "demand_id": {"type": "integer", "description": "需求ID"},
                    "reason": {"type": "string", "description": "否决原因"},
                },
                "required": ["demand_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_competitive_products",
            "description": "获取竞品产品列表和分析",
            "parameters": {
                "type": "object",
                "properties": {
                    "limit": {"type": "integer", "description": "返回数量"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "web_search",
            "description": "搜索互联网获取最新信息（竞品、市场数据、新闻、技术趋势等）",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "搜索关键词"},
                    "num_results": {"type": "integer", "description": "返回结果数量，默认5"},
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "web_fetch",
            "description": "访问指定网页并提取正文内容（用户给你链接时调用此工具）",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "要访问的网页URL"},
                    "extract_mode": {"type": "string", "enum": ["text", "full", "summary"], "description": "提取模式：text=纯文本，full=完整HTML转文本，summary=AI摘要。默认text"},
                },
                "required": ["url"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "manage_data_source",
            "description": "管理数据源配置：新增、修改、启用/禁用数据源，调整关键词和采集参数",
            "parameters": {
                "type": "object",
                "properties": {
                    "action": {"type": "string", "enum": ["add", "update", "toggle", "list", "update_keywords"], "description": "操作类型"},
                    "source_id": {"type": "integer", "description": "数据源ID（update/toggle/update_keywords时必填）"},
                    "name": {"type": "string", "description": "数据源名称（add时必填）"},
                    "platform": {"type": "string", "description": "平台标识（add时必填），如 reddit, hackernews, bilibili, g2_reviews 等"},
                    "enabled": {"type": "boolean", "description": "是否启用（toggle时使用）"},
                    "keywords": {"type": "array", "items": {"type": "string"}, "description": "搜索关键词列表"},
                    "config": {"type": "object", "description": "额外配置（JSON格式，如 subreddits, repos 等）"},
                },
                "required": ["action"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "manage_filter_rules",
            "description": "管理全局过滤规则：查看、添加、删除过滤关键词（用于排除广告/噪声/不相关内容）",
            "parameters": {
                "type": "object",
                "properties": {
                    "action": {"type": "string", "enum": ["list", "add", "remove"], "description": "操作类型"},
                    "keywords": {"type": "array", "items": {"type": "string"}, "description": "要添加或删除的过滤词"},
                },
                "required": ["action"],
            },
        },
    },
    # ── Project Operations ─────────────────────────────────────────────────
    {
        "type": "function",
        "function": {
            "name": "create_project",
            "description": "创建项目（可从需求导入，也可空白创建）",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "项目标题"},
                    "description": {"type": "string", "description": "项目描述"},
                    "demand_id": {"type": "integer", "description": "关联需求ID（可选，提供则导入已有技能产出）"},
                },
                "required": ["title"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "update_project_stage",
            "description": "将项目推进到不同阶段",
            "parameters": {
                "type": "object",
                "properties": {
                    "project_id": {"type": "integer", "description": "项目ID"},
                    "stage": {
                        "type": "string",
                        "enum": ["discover", "value_filter", "validate", "pmf", "business_model"],
                        "description": "目标阶段",
                    },
                },
                "required": ["project_id", "stage"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "generate_document",
            "description": "AI生成项目文档（one_pager、竞品分析、PRD等）",
            "parameters": {
                "type": "object",
                "properties": {
                    "project_id": {"type": "integer", "description": "项目ID"},
                    "doc_type": {
                        "type": "string",
                        "enum": [
                            "one_pager", "signal_summary", "scoring_report",
                            "competitive_research", "user_research", "tam_analysis",
                            "positioning", "prd", "prototype_brief",
                            "business_model_canvas", "unit_economics", "go_to_market",
                        ],
                        "description": "文档类型",
                    },
                    "extra_instructions": {"type": "string", "description": "额外指示（可选）"},
                },
                "required": ["project_id", "doc_type"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_discussion",
            "description": "在项目中创建讨论帖",
            "parameters": {
                "type": "object",
                "properties": {
                    "project_id": {"type": "integer", "description": "项目ID"},
                    "title": {"type": "string", "description": "讨论标题"},
                    "initial_message": {"type": "string", "description": "首条消息内容（可选）"},
                },
                "required": ["project_id", "title"],
            },
        },
    },
    # ── Memory / Learning ──────────────────────────────────────────────────
    {
        "type": "function",
        "function": {
            "name": "remember",
            "description": "将重要信息存入长期记忆（决策、偏好、洞察、反馈等）",
            "parameters": {
                "type": "object",
                "properties": {
                    "content": {"type": "string", "description": "要记住的内容"},
                    "category": {"type": "string", "description": "分类（decision/preference/insight/feedback）"},
                },
                "required": ["content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "recall",
            "description": "搜索长期记忆中的相关信息",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "搜索关键词"},
                    "category": {"type": "string", "description": "按分类过滤（可选）"},
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "log_decision",
            "description": "记录团队决策及其推理过程",
            "parameters": {
                "type": "object",
                "properties": {
                    "decision": {"type": "string", "description": "决策内容"},
                    "reasoning": {"type": "string", "description": "决策理由"},
                    "related_demand_id": {"type": "integer", "description": "关联需求ID（可选）"},
                    "related_project_id": {"type": "integer", "description": "关联项目ID（可选）"},
                },
                "required": ["decision", "reasoning"],
            },
        },
    },
    # ── Analysis ───────────────────────────────────────────────────────────
    {
        "type": "function",
        "function": {
            "name": "compare_demands",
            "description": "多个需求并排对比（含7维评分）",
            "parameters": {
                "type": "object",
                "properties": {
                    "demand_ids": {
                        "type": "array",
                        "items": {"type": "integer"},
                        "description": "要对比的需求ID列表",
                    },
                },
                "required": ["demand_ids"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "estimate_tam",
            "description": "基于搜索量快速估算TAM（总可寻址市场）",
            "parameters": {
                "type": "object",
                "properties": {
                    "keywords": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "用于搜索量评估的关键词列表",
                    },
                },
                "required": ["keywords"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "check_domain",
            "description": "检查域名是否可用",
            "parameters": {
                "type": "object",
                "properties": {
                    "domain": {"type": "string", "description": "要检查的域名（如 example.com）"},
                },
                "required": ["domain"],
            },
        },
    },
    # ── Self-Maintenance ───────────────────────────────────────────────────
    {
        "type": "function",
        "function": {
            "name": "get_audit_report",
            "description": "获取最新的数据质量审计报告",
            "parameters": {"type": "object", "properties": {}},
        },
    },
]


# ── Tool Execution Functions ──────────────────────────────────────────────

async def execute_tool(name: str, args: dict) -> str:
    """Execute a tool and return the result as a string for the AI."""
    try:
        fn = TOOL_HANDLERS.get(name)
        if not fn:
            return f"未知工具: {name}"
        result = await fn(**args)
        return json.dumps(result, ensure_ascii=False, default=str)
    except Exception as e:
        logger.error(f"Tool {name} failed: {e}")
        return f"工具执行失败: {str(e)}"


async def _query_demands(min_score: float = 0, stage: str = "", keyword: str = "", limit: int = 10, sort: str = "score_desc") -> dict:
    db = await get_db()
    try:
        conditions = ["1=1"]
        params = []
        if min_score > 0:
            conditions.append("score_total >= ?")
            params.append(min_score)
        if stage:
            conditions.append("stage = ?")
            params.append(stage)
        if keyword:
            conditions.append("(title LIKE ? OR description LIKE ?)")
            params.extend([f"%{keyword}%", f"%{keyword}%"])

        order = "score_total DESC" if sort == "score_desc" else ("created_at DESC" if sort == "newest" else "created_at ASC")
        sql = f"SELECT id, title, description, score_total, score_pain, score_ai_opportunity, stage, track FROM demands WHERE {' AND '.join(conditions)} ORDER BY {order} LIMIT ?"
        params.append(limit)

        cur = await db.execute(sql, params)
        rows = [dict(r) for r in await cur.fetchall()]
        return {"demands": rows, "count": len(rows)}
    finally:
        await db.close()


async def _get_demand_detail(demand_id: int) -> dict:
    db = await get_db()
    try:
        cur = await db.execute("SELECT * FROM demands WHERE id=?", (demand_id,))
        row = await cur.fetchone()
        if not row:
            return {"error": "需求不存在"}
        d = dict(row)
        # Also get skill outputs
        cur = await db.execute("SELECT skill_name, output FROM skill_outputs WHERE demand_id=?", (demand_id,))
        d["skill_outputs"] = {r["skill_name"]: r["output"][:500] for r in await cur.fetchall()}
        return d
    finally:
        await db.close()


async def _search_raw_items(keyword: str, platform: str = "", limit: int = 20) -> dict:
    db = await get_db()
    try:
        conditions = ["(title LIKE ? OR content LIKE ?)"]
        params = [f"%{keyword}%", f"%{keyword}%"]
        if platform:
            conditions.append("platform = ?")
            params.append(platform)
        sql = f"SELECT id, title, content, platform, sentiment, created_at FROM raw_items WHERE {' AND '.join(conditions)} ORDER BY created_at DESC LIMIT ?"
        params.append(limit)
        cur = await db.execute(sql, params)
        rows = [dict(r) for r in await cur.fetchall()]
        # Truncate content
        for r in rows:
            if r.get("content") and len(r["content"]) > 200:
                r["content"] = r["content"][:200] + "..."
        return {"items": rows, "count": len(rows)}
    finally:
        await db.close()


async def _get_dashboard_stats() -> dict:
    db = await get_db()
    try:
        stats = {}
        cur = await db.execute("SELECT COUNT(*) as c FROM raw_items")
        stats["total_items"] = (await cur.fetchone())["c"]
        cur = await db.execute("SELECT COUNT(*) as c FROM demands")
        stats["total_demands"] = (await cur.fetchone())["c"]
        cur = await db.execute("SELECT AVG(score_total) as avg FROM demands WHERE score_total > 0")
        row = await cur.fetchone()
        stats["avg_score"] = round(row["avg"] or 0, 1)
        cur = await db.execute("SELECT platform, COUNT(*) as c FROM raw_items GROUP BY platform ORDER BY c DESC")
        stats["platforms"] = {r["platform"]: r["c"] for r in await cur.fetchall()}
        cur = await db.execute("SELECT COUNT(*) as c FROM raw_items WHERE date(created_at) = date('now')")
        stats["items_today"] = (await cur.fetchone())["c"]
        return stats
    finally:
        await db.close()


async def _search_knowledge(query: str) -> dict:
    db = await get_db()
    try:
        # FTS5 search
        try:
            cur = await db.execute(
                "SELECT c.content, d.title as doc_title FROM knowledge_chunks_fts f JOIN knowledge_chunks c ON f.rowid = c.id JOIN knowledge_docs d ON c.doc_id = d.id WHERE f.content MATCH ? LIMIT 5",
                (query,),
            )
            results = [dict(r) for r in await cur.fetchall()]
        except Exception:
            # Fallback to LIKE
            cur = await db.execute(
                "SELECT c.content, d.title as doc_title FROM knowledge_chunks c JOIN knowledge_docs d ON c.doc_id = d.id WHERE c.content LIKE ? LIMIT 5",
                (f"%{query}%",),
            )
            results = [dict(r) for r in await cur.fetchall()]
        return {"results": results, "count": len(results)}
    finally:
        await db.close()


async def _list_projects(stage: str = "", status: str = "") -> dict:
    db = await get_db()
    try:
        conditions = ["1=1"]
        params = []
        if stage:
            conditions.append("current_stage = ?")
            params.append(stage)
        if status:
            conditions.append("status = ?")
            params.append(status)
        cur = await db.execute(
            f"SELECT id, title, current_stage, status, created_at FROM projects WHERE {' AND '.join(conditions)} ORDER BY updated_at DESC LIMIT 20",
            params,
        )
        rows = [dict(r) for r in await cur.fetchall()]
        return {"projects": rows, "count": len(rows)}
    finally:
        await db.close()


async def _get_project_progress(project_id: int) -> dict:
    db = await get_db()
    try:
        cur = await db.execute("SELECT * FROM projects WHERE id=?", (project_id,))
        row = await cur.fetchone()
        if not row:
            return {"error": "项目不存在"}
        project = dict(row)
        cur = await db.execute(
            "SELECT doc_type, title, status, stage FROM project_documents WHERE project_id=? ORDER BY stage, id",
            (project_id,),
        )
        docs = [dict(r) for r in await cur.fetchall()]
        project["documents"] = docs
        return project
    finally:
        await db.close()


async def _trigger_scrape(platforms: list = None) -> dict:
    from scrapers.base import run_scraper
    import json as _json
    db = await get_db()
    try:
        cur = await db.execute("SELECT * FROM data_sources WHERE enabled = 1")
        sources = [dict(r) for r in await cur.fetchall()]
        if platforms:
            sources = [s for s in sources if s["platform"] in platforms]

        results = {}
        for source in sources[:5]:  # Limit to 5 to avoid timeout
            try:
                config = _json.loads(source.get("config") or "{}")
                count = await run_scraper(source["platform"], config, source["id"], db)
                results[source["platform"]] = count
            except Exception as e:
                results[source["platform"]] = f"error: {str(e)}"

        return {"message": "采集完成", "results": results, "sources_count": len(sources)}
    finally:
        await db.close()


async def _run_ai_analysis(use_knowledge: bool = True) -> dict:
    from ai.extractor import extract_demands
    db = await get_db()
    try:
        # Get unanalyzed items (last 50)
        cur = await db.execute(
            "SELECT id, title, content, platform, metrics, sentiment, tags FROM raw_items ORDER BY created_at DESC LIMIT 50"
        )
        items = [dict(r) for r in await cur.fetchall()]
        if not items:
            return {"message": "没有新数据可分析", "status": "empty"}

        # Build knowledge context if requested
        knowledge_context = ""
        if use_knowledge:
            try:
                cur = await db.execute(
                    "SELECT c.content FROM knowledge_chunks c ORDER BY c.id DESC LIMIT 10"
                )
                chunks = [r["content"] for r in await cur.fetchall()]
                if chunks:
                    knowledge_context = "\n".join(chunks[:5])
            except Exception:
                pass

        # Run extraction
        try:
            demands = await extract_demands(items, knowledge_context=knowledge_context)
            return {"message": f"分析完成，发现 {len(demands)} 个需求", "status": "done", "count": len(demands)}
        except Exception as e:
            return {"message": f"分析过程中出错: {str(e)}", "status": "error"}
    finally:
        await db.close()


async def _dismiss_demand(demand_id: int, reason: str = "") -> dict:
    db = await get_db()
    try:
        cur = await db.execute("SELECT id, title FROM demands WHERE id=?", (demand_id,))
        row = await cur.fetchone()
        if not row:
            return {"error": "需求不存在"}
        title = row["title"]
        await db.execute("UPDATE demands SET stage='dismissed' WHERE id=?", (demand_id,))
        await db.commit()
        return {"message": f"已否决需求 [{demand_id}] {title}", "reason": reason}
    finally:
        await db.close()


async def _get_competitive_products(limit: int = 10) -> dict:
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT id, title, description, score_total, score_competition FROM demands WHERE track='B' ORDER BY score_total DESC LIMIT ?",
            (limit,),
        )
        rows = [dict(r) for r in await cur.fetchall()]
        return {"products": rows, "count": len(rows)}
    finally:
        await db.close()


async def _web_search(query: str, num_results: int = 5) -> dict:
    """Search the web using DuckDuckGo (no API key needed)."""
    import httpx
    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
            # Use DuckDuckGo HTML search
            resp = await client.get(
                "https://html.duckduckgo.com/html/",
                params={"q": query},
                headers={"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"},
            )
            resp.raise_for_status()
            html = resp.text

            # Parse results
            from html.parser import HTMLParser

            results = []

            class DDGParser(HTMLParser):
                def __init__(self):
                    super().__init__()
                    self._in_result = False
                    self._in_title = False
                    self._in_snippet = False
                    self._current = {}

                def handle_starttag(self, tag, attrs):
                    attrs_dict = dict(attrs)
                    cls = attrs_dict.get("class", "")
                    if tag == "a" and "result__a" in cls:
                        self._in_title = True
                        href = attrs_dict.get("href", "")
                        # DDG wraps URLs, extract actual URL
                        if "uddg=" in href:
                            import urllib.parse
                            parsed = urllib.parse.parse_qs(urllib.parse.urlparse(href).query)
                            href = parsed.get("uddg", [href])[0]
                        self._current = {"title": "", "url": href, "snippet": ""}
                    if tag == "a" and "result__snippet" in cls:
                        self._in_snippet = True

                def handle_endtag(self, tag):
                    if tag == "a" and self._in_title:
                        self._in_title = False
                    if tag == "a" and self._in_snippet:
                        self._in_snippet = False
                        if self._current.get("title"):
                            results.append(self._current)
                            self._current = {}

                def handle_data(self, data):
                    if self._in_title:
                        self._current["title"] += data.strip()
                    if self._in_snippet:
                        self._current["snippet"] += data.strip()

            parser = DDGParser()
            parser.feed(html)

            return {
                "query": query,
                "results": results[:num_results],
                "count": len(results[:num_results]),
            }
    except Exception as e:
        logger.error(f"Web search failed: {e}")
        return {"error": f"搜索失败: {str(e)}", "query": query}


async def _web_fetch(url: str, extract_mode: str = "text") -> dict:
    """Fetch a webpage and extract its content."""
    import httpx
    try:
        async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
            resp = await client.get(
                url,
                headers={
                    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                },
            )
            resp.raise_for_status()
            html = resp.text

            # Extract text from HTML
            from html.parser import HTMLParser
            import re

            class TextExtractor(HTMLParser):
                def __init__(self):
                    super().__init__()
                    self._skip_tags = {"script", "style", "noscript", "iframe", "svg", "nav", "footer", "header"}
                    self._skip_depth = 0
                    self._texts = []
                    self._title = ""
                    self._in_title = False

                def handle_starttag(self, tag, attrs):
                    if tag in self._skip_tags:
                        self._skip_depth += 1
                    if tag == "title":
                        self._in_title = True

                def handle_endtag(self, tag):
                    if tag in self._skip_tags and self._skip_depth > 0:
                        self._skip_depth -= 1
                    if tag == "title":
                        self._in_title = False

                def handle_data(self, data):
                    if self._in_title:
                        self._title += data.strip()
                    if self._skip_depth == 0:
                        text = data.strip()
                        if text:
                            self._texts.append(text)

            extractor = TextExtractor()
            extractor.feed(html)

            full_text = "\n".join(extractor._texts)
            # Clean up excessive whitespace
            full_text = re.sub(r"\n{3,}", "\n\n", full_text)

            # Truncate to avoid token overflow
            max_chars = 8000 if extract_mode == "full" else 4000
            if len(full_text) > max_chars:
                full_text = full_text[:max_chars] + f"\n\n... (截断，共 {len(full_text)} 字符)"

            result = {
                "url": url,
                "title": extractor._title,
                "content": full_text,
                "char_count": len(full_text),
                "status_code": resp.status_code,
            }

            if extract_mode == "summary":
                # Use AI to summarize
                try:
                    from ai.client import chat
                    summary = await chat(
                        f"请用中文简要总结以下网页内容（200字以内）：\n\n标题：{extractor._title}\n\n{full_text[:3000]}",
                        system="你是一个内容摘要助手，用简洁的中文总结网页要点。"
                    )
                    result["summary"] = summary
                    result["content"] = summary  # Replace with summary
                except Exception:
                    pass

            return result

    except Exception as e:
        logger.error(f"Web fetch failed: {e}")
        return {"error": f"网页访问失败: {str(e)}", "url": url}


async def _manage_data_source(action: str, source_id: int = 0, name: str = "", platform: str = "",
                              enabled: bool = True, keywords: list = None, config: dict = None) -> dict:
    """Manage data source configurations."""
    db = await get_db()
    try:
        if action == "list":
            cur = await db.execute("SELECT id, name, platform, enabled, config, last_fetched_at FROM data_sources ORDER BY id")
            sources = [dict(r) for r in await cur.fetchall()]
            return {"sources": sources, "count": len(sources)}

        elif action == "add":
            if not name or not platform:
                return {"error": "新增数据源需要 name 和 platform 参数"}
            cfg = json.dumps(config or {})
            if keywords:
                cfg_data = config or {}
                cfg_data["keywords"] = keywords
                cfg = json.dumps(cfg_data)
            await db.execute(
                "INSERT INTO data_sources (name, platform, enabled, config) VALUES (?, ?, ?, ?)",
                (name, platform, 1 if enabled else 0, cfg),
            )
            await db.commit()
            return {"message": f"已添加数据源: {name} ({platform})", "keywords": keywords}

        elif action == "update" and source_id:
            updates = []
            params = []
            if name:
                updates.append("name=?")
                params.append(name)
            if config:
                updates.append("config=?")
                params.append(json.dumps(config))
            if not updates:
                return {"error": "没有要更新的字段"}
            params.append(source_id)
            await db.execute(f"UPDATE data_sources SET {', '.join(updates)} WHERE id=?", params)
            await db.commit()
            return {"message": f"已更新数据源 #{source_id}"}

        elif action == "toggle" and source_id:
            await db.execute("UPDATE data_sources SET enabled=? WHERE id=?", (1 if enabled else 0, source_id))
            await db.commit()
            return {"message": f"数据源 #{source_id} 已{'启用' if enabled else '禁用'}"}

        elif action == "update_keywords" and source_id:
            if not keywords:
                return {"error": "需要提供 keywords 参数"}
            cur = await db.execute("SELECT config FROM data_sources WHERE id=?", (source_id,))
            row = await cur.fetchone()
            if not row:
                return {"error": f"数据源 #{source_id} 不存在"}
            try:
                cfg_data = json.loads(row["config"] or "{}")
            except (json.JSONDecodeError, TypeError):
                cfg_data = {}
            cfg_data["keywords"] = keywords
            await db.execute("UPDATE data_sources SET config=? WHERE id=?", (json.dumps(cfg_data), source_id))
            await db.commit()
            return {"message": f"数据源 #{source_id} 关键词已更新为 {len(keywords)} 个", "keywords": keywords}

        else:
            return {"error": f"无效操作: {action}"}
    finally:
        await db.close()


async def _manage_filter_rules(action: str, keywords: list = None) -> dict:
    """Manage global content filter rules (stored in agent_config)."""
    db = await get_db()
    try:
        # Store filter rules in a dedicated table or agent_config
        # Use a simple approach: store as JSON in a config row
        cur = await db.execute("SELECT value FROM agent_config WHERE key='global_filter_keywords'")
        row = await cur.fetchone()
        if row:
            current_filters = json.loads(row["value"] or "[]")
        else:
            # Default filters
            current_filters = [
                "crypto", "blockchain", "bitcoin", "ethereum", "NFT",
                "forex", "trading", "stock market", "investment advice",
                "medical diagnosis", "prescription", "surgery",
                "casino", "gambling", "betting",
            ]

        if action == "list":
            return {"filter_keywords": current_filters, "count": len(current_filters)}

        elif action == "add":
            if not keywords:
                return {"error": "需要提供要添加的关键词"}
            added = []
            for kw in keywords:
                if kw not in current_filters:
                    current_filters.append(kw)
                    added.append(kw)
            # Upsert
            if row:
                await db.execute("UPDATE agent_config SET value=? WHERE key='global_filter_keywords'",
                                (json.dumps(current_filters),))
            else:
                await db.execute("INSERT INTO agent_config (key, value) VALUES ('global_filter_keywords', ?)",
                                (json.dumps(current_filters),))
            await db.commit()
            return {"message": f"已添加 {len(added)} 个过滤词", "added": added, "total": len(current_filters)}

        elif action == "remove":
            if not keywords:
                return {"error": "需要提供要删除的关键词"}
            removed = []
            for kw in keywords:
                if kw in current_filters:
                    current_filters.remove(kw)
                    removed.append(kw)
            if row:
                await db.execute("UPDATE agent_config SET value=? WHERE key='global_filter_keywords'",
                                (json.dumps(current_filters),))
            await db.commit()
            return {"message": f"已移除 {len(removed)} 个过滤词", "removed": removed, "total": len(current_filters)}

        else:
            return {"error": f"无效操作: {action}"}
    finally:
        await db.close()


# ── Project Operations ─────────────────────────────────────────────────────

async def _create_project(title: str, description: str = "", demand_id: int = 0) -> dict:
    """Create a project, optionally importing from an existing demand."""
    db = await get_db()
    try:
        now = datetime.now(timezone.utc).isoformat()
        await db.execute(
            "INSERT INTO projects (title, description, current_stage, status, created_at, updated_at) VALUES (?, ?, 'discover', 'active', ?, ?)",
            (title, description, now, now),
        )
        await db.commit()
        cur = await db.execute("SELECT last_insert_rowid() as id")
        project_id = (await cur.fetchone())["id"]

        imported = 0
        if demand_id:
            # Import skill_outputs as project_documents
            cur = await db.execute(
                "SELECT skill_name, output FROM skill_outputs WHERE demand_id=?", (demand_id,)
            )
            for row in await cur.fetchall():
                await db.execute(
                    "INSERT INTO project_documents (project_id, doc_type, title, content, stage, status, created_at) VALUES (?, ?, ?, ?, 'discover', 'draft', ?)",
                    (project_id, row["skill_name"], f"{row['skill_name']} (从需求#{demand_id}导入)", row["output"], now),
                )
                imported += 1
            await db.commit()

        return {"message": f"项目已创建", "project_id": project_id, "title": title, "imported_docs": imported}
    finally:
        await db.close()


async def _update_project_stage(project_id: int, stage: str) -> dict:
    """Move a project to a different stage."""
    db = await get_db()
    try:
        cur = await db.execute("SELECT id, title, current_stage FROM projects WHERE id=?", (project_id,))
        row = await cur.fetchone()
        if not row:
            return {"error": "项目不存在"}
        old_stage = row["current_stage"]
        now = datetime.now(timezone.utc).isoformat()
        await db.execute(
            "UPDATE projects SET current_stage=?, updated_at=? WHERE id=?",
            (stage, now, project_id),
        )
        await db.commit()
        return {"message": f"项目 [{project_id}] {row['title']} 已从 {old_stage} 推进到 {stage}", "project_id": project_id, "old_stage": old_stage, "new_stage": stage}
    finally:
        await db.close()


async def _generate_document(project_id: int, doc_type: str, extra_instructions: str = "") -> dict:
    """AI-generate a project document."""
    from ai.client import chat
    db = await get_db()
    try:
        # Get project context
        cur = await db.execute("SELECT * FROM projects WHERE id=?", (project_id,))
        project = await cur.fetchone()
        if not project:
            return {"error": "项目不存在"}
        project = dict(project)

        # Get existing documents for context
        cur = await db.execute(
            "SELECT doc_type, title, content FROM project_documents WHERE project_id=? ORDER BY id",
            (project_id,),
        )
        existing_docs = [dict(r) for r in await cur.fetchall()]
        docs_context = "\n".join(
            f"[{d['doc_type']}] {d['title']}:\n{d['content'][:500]}" for d in existing_docs
        ) if existing_docs else "暂无已有文档"

        doc_type_labels = {
            "one_pager": "One Pager（一页纸概要）",
            "signal_summary": "信号摘要报告",
            "scoring_report": "评分报告",
            "competitive_research": "竞品调研",
            "user_research": "用户调研",
            "tam_analysis": "TAM市场规模分析",
            "positioning": "产品定位文档",
            "prd": "产品需求文档（PRD）",
            "prototype_brief": "原型设计简报",
            "business_model_canvas": "商业模式画布",
            "unit_economics": "单位经济模型",
            "go_to_market": "上市策略（GTM）",
        }
        label = doc_type_labels.get(doc_type, doc_type)

        prompt = (
            f"你是一位资深产品经理，请为以下项目生成一份 **{label}** 文档。\n\n"
            f"项目标题：{project['title']}\n"
            f"项目描述：{project.get('description', '无')}\n"
            f"当前阶段：{project.get('current_stage', '未知')}\n\n"
            f"已有参考资料：\n{docs_context}\n\n"
            f"请用 Markdown 格式输出，内容详实、结构清晰。"
        )
        if extra_instructions:
            prompt += f"\n\n额外要求：{extra_instructions}"

        content = await chat(prompt, system="你是一位专业的产品经理文档撰写助手。请输出高质量的 Markdown 文档。")

        now = datetime.now(timezone.utc).isoformat()
        await db.execute(
            "INSERT INTO project_documents (project_id, doc_type, title, content, stage, status, created_at) VALUES (?, ?, ?, ?, ?, 'draft', ?)",
            (project_id, doc_type, label, content, project.get("current_stage", "discover"), now),
        )
        await db.commit()

        return {"message": f"已生成 {label}", "project_id": project_id, "doc_type": doc_type, "content_preview": content[:300] + "..."}
    finally:
        await db.close()


async def _create_discussion(project_id: int, title: str, initial_message: str = "") -> dict:
    """Create a discussion thread in a project."""
    db = await get_db()
    try:
        cur = await db.execute("SELECT id FROM projects WHERE id=?", (project_id,))
        if not await cur.fetchone():
            return {"error": "项目不存在"}

        now = datetime.now(timezone.utc).isoformat()
        await db.execute(
            "INSERT INTO discussion_threads (project_id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
            (project_id, title, now, now),
        )
        await db.commit()
        cur = await db.execute("SELECT last_insert_rowid() as id")
        thread_id = (await cur.fetchone())["id"]

        if initial_message:
            await db.execute(
                "INSERT INTO discussion_messages (thread_id, role, content, created_at) VALUES (?, 'user', ?, ?)",
                (thread_id, initial_message, now),
            )
            await db.commit()

        return {"message": f"讨论帖已创建", "thread_id": thread_id, "title": title, "has_initial_message": bool(initial_message)}
    finally:
        await db.close()


# ── Memory / Learning (unified via AgentMemory) ─────────────────────────────

# Singleton reference — set by main.py at startup via set_tools_memory()
_agent_memory = None

# Fallback paths for when AgentMemory is not wired (e.g., standalone scripts)
MEMORY_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "data", "cognee")
MEMORY_FILE = os.path.join(MEMORY_DIR, "local_memory.json")


def set_tools_memory(mem):
    """Wire the shared AgentMemory instance. Called from main.py at startup."""
    global _agent_memory, MEMORY_DIR, MEMORY_FILE
    _agent_memory = mem
    if mem:
        MEMORY_DIR = mem.memory_dir
        MEMORY_FILE = mem.memory_file


def _load_memory() -> dict:
    """Load memory — delegates to AgentMemory if available, else direct file I/O."""
    if _agent_memory:
        return _agent_memory.load_memory_dict()
    if os.path.exists(MEMORY_FILE):
        try:
            with open(MEMORY_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            pass
    return {"memories": [], "decisions": []}


def _save_memory(data: dict):
    """Save memory — delegates to AgentMemory if available, else direct file I/O."""
    if _agent_memory:
        _agent_memory.save_memory_dict(data)
        return
    os.makedirs(MEMORY_DIR, exist_ok=True)
    with open(MEMORY_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


async def _remember(content: str, category: str = "general") -> dict:
    """Store important information in long-term memory."""
    if _agent_memory:
        total = _agent_memory.add_memory(content, category)
        return {"message": "已记住", "category": category, "total_memories": total}
    mem = _load_memory()
    entry = {
        "content": content,
        "category": category,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    mem.setdefault("memories", []).append(entry)
    _save_memory(mem)
    return {"message": "已记住", "category": category, "total_memories": len(mem["memories"])}


async def _recall(query: str, category: str = "") -> dict:
    """Search memory for relevant information."""
    mem = _load_memory()
    query_lower = query.lower()
    keywords = query_lower.split()

    results = []
    for entry in mem.get("memories", []) + mem.get("decisions", []):
        text = entry.get("content", "") + " " + entry.get("decision", "")
        text_lower = text.lower()
        if category and entry.get("category", "") != category:
            continue
        score = sum(1 for kw in keywords if kw in text_lower)
        if score > 0:
            results.append({**entry, "_score": score})

    results.sort(key=lambda x: x["_score"], reverse=True)
    for r in results:
        r.pop("_score", None)

    return {"results": results[:10], "count": len(results), "query": query}


async def _log_decision(decision: str, reasoning: str, related_demand_id: int = 0, related_project_id: int = 0) -> dict:
    """Record a team decision with reasoning."""
    if _agent_memory:
        extra = {}
        if related_demand_id:
            extra["related_demand_id"] = related_demand_id
        if related_project_id:
            extra["related_project_id"] = related_project_id
        total = _agent_memory.add_decision_record(decision, reasoning, **extra)
        return {"message": "决策已记录", "total_decisions": total}
    mem = _load_memory()
    entry = {
        "decision": decision,
        "reasoning": reasoning,
        "category": "decision",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    if related_demand_id:
        entry["related_demand_id"] = related_demand_id
    if related_project_id:
        entry["related_project_id"] = related_project_id
    mem.setdefault("decisions", []).append(entry)
    _save_memory(mem)
    return {"message": "决策已记录", "total_decisions": len(mem["decisions"])}


# ── Analysis ───────────────────────────────────────────────────────────────

async def _compare_demands(demand_ids: list) -> dict:
    """Compare multiple demands side by side."""
    if not demand_ids or len(demand_ids) < 2:
        return {"error": "至少需要2个需求ID进行对比"}
    db = await get_db()
    try:
        placeholders = ",".join("?" for _ in demand_ids)
        cur = await db.execute(
            f"SELECT id, title, description, score_total, score_pain, score_frequency, "
            f"score_willingness_to_pay, score_competition, score_ai_opportunity, "
            f"score_market_timing, score_founder_fit, stage, track "
            f"FROM demands WHERE id IN ({placeholders})",
            demand_ids,
        )
        rows = [dict(r) for r in await cur.fetchall()]
        if not rows:
            return {"error": "未找到任何匹配的需求"}

        # Build comparison
        dimensions = [
            "score_pain", "score_frequency", "score_willingness_to_pay",
            "score_competition", "score_ai_opportunity", "score_market_timing", "score_founder_fit",
        ]
        comparison = []
        for row in rows:
            entry = {
                "id": row["id"],
                "title": row["title"],
                "score_total": row["score_total"],
                "stage": row["stage"],
            }
            for dim in dimensions:
                entry[dim] = row.get(dim, 0)
            comparison.append(entry)

        return {"comparison": comparison, "count": len(comparison), "dimensions": dimensions}
    finally:
        await db.close()


async def _estimate_tam(keywords: list) -> dict:
    """Quick TAM estimate using search volume data."""
    if not keywords:
        return {"error": "需要提供关键词"}

    search_results = {}
    for kw in keywords[:5]:  # Limit to 5 keywords
        result = await _web_search(f"{kw} search volume monthly users", num_results=3)
        search_results[kw] = result.get("results", [])

    # Build rough estimate context
    summary_parts = []
    for kw, results in search_results.items():
        snippets = " | ".join(r.get("snippet", "")[:100] for r in results[:2])
        summary_parts.append(f"关键词 '{kw}': {snippets}")

    # Conservative assumptions for TAM calculation
    tam_note = (
        "TAM估算基于搜索量近似，假设：\n"
        "- 搜索量代表潜在需求的冰山一角（约10%用户会搜索）\n"
        "- 付费转化率约 2-5%\n"
        "- 平均客单价需根据具体品类判断\n"
        "请结合实际行业数据调整。"
    )

    return {
        "keywords": keywords,
        "search_data": summary_parts,
        "methodology": tam_note,
        "recommendation": "建议结合行业报告和竞品数据进一步验证",
    }


async def _check_domain(domain: str) -> dict:
    """Check if a domain name is available via DNS resolution."""
    domain = domain.strip().lower()
    if not domain:
        return {"error": "请提供域名"}

    try:
        socket.getaddrinfo(domain, None)
        return {"domain": domain, "available": False, "message": f"{domain} 已被注册（DNS可解析）"}
    except socket.gaierror:
        return {"domain": domain, "available": True, "message": f"{domain} 可能可用（DNS无法解析）"}
    except Exception as e:
        return {"domain": domain, "available": None, "message": f"检查失败: {str(e)}"}


# ── Self-Maintenance ───────────────────────────────────────────────────────

async def _get_audit_report() -> dict:
    """Get the latest data quality audit report."""
    db = await get_db()
    try:
        # Look for the latest audit-related agent run
        cur = await db.execute(
            "SELECT id, status, result, created_at FROM agent_runs WHERE task_type LIKE '%audit%' ORDER BY id DESC LIMIT 1"
        )
        row = await cur.fetchone()
        if row:
            report = dict(row)
            try:
                report["result"] = json.loads(report["result"]) if report["result"] else None
            except (json.JSONDecodeError, TypeError):
                pass
            return {"report": report, "source": "agent_runs"}

        # Fallback: generate a quick quality snapshot
        stats = {}
        cur = await db.execute("SELECT COUNT(*) as c FROM raw_items")
        stats["total_items"] = (await cur.fetchone())["c"]
        cur = await db.execute("SELECT COUNT(*) as c FROM raw_items WHERE content IS NULL OR content = ''")
        stats["empty_content"] = (await cur.fetchone())["c"]
        cur = await db.execute("SELECT COUNT(*) as c FROM demands WHERE score_total = 0 OR score_total IS NULL")
        stats["unscored_demands"] = (await cur.fetchone())["c"]
        cur = await db.execute("SELECT COUNT(*) as c FROM demands")
        stats["total_demands"] = (await cur.fetchone())["c"]
        cur = await db.execute("SELECT COUNT(DISTINCT platform) as c FROM raw_items")
        stats["active_platforms"] = (await cur.fetchone())["c"]
        cur = await db.execute(
            "SELECT COUNT(*) as c FROM raw_items WHERE date(created_at) >= date('now', '-7 days')"
        )
        stats["items_last_7d"] = (await cur.fetchone())["c"]

        quality_score = 100
        if stats["total_items"] > 0:
            empty_ratio = stats["empty_content"] / stats["total_items"]
            quality_score -= int(empty_ratio * 50)
        if stats["total_demands"] > 0:
            unscored_ratio = stats["unscored_demands"] / stats["total_demands"]
            quality_score -= int(unscored_ratio * 30)
        if stats["items_last_7d"] == 0:
            quality_score -= 20

        stats["quality_score"] = max(0, quality_score)
        return {"report": stats, "source": "live_snapshot", "message": "无历史审计记录，已生成实时快照"}
    finally:
        await db.close()


# ── Handler Map ───────────────────────────────────────────────────────────

TOOL_HANDLERS = {
    "query_demands": _query_demands,
    "get_demand_detail": _get_demand_detail,
    "search_raw_items": _search_raw_items,
    "get_dashboard_stats": _get_dashboard_stats,
    "search_knowledge": _search_knowledge,
    "list_projects": _list_projects,
    "get_project_progress": _get_project_progress,
    "trigger_scrape": _trigger_scrape,
    "run_ai_analysis": _run_ai_analysis,
    "dismiss_demand": _dismiss_demand,
    "get_competitive_products": _get_competitive_products,
    "web_search": _web_search,
    "web_fetch": _web_fetch,
    "manage_data_source": _manage_data_source,
    "manage_filter_rules": _manage_filter_rules,
    # New tools
    "create_project": _create_project,
    "update_project_stage": _update_project_stage,
    "generate_document": _generate_document,
    "create_discussion": _create_discussion,
    "remember": _remember,
    "recall": _recall,
    "log_decision": _log_decision,
    "compare_demands": _compare_demands,
    "estimate_tam": _estimate_tam,
    "check_domain": _check_domain,
    "get_audit_report": _get_audit_report,
}


# ── Self-Awareness: Build Agent State Summary ─────────────────────────────

async def build_self_awareness() -> str:
    """Build a summary of the agent's current state for injection into system prompt."""
    db = await get_db()
    try:
        parts = []

        # Pending checkpoints
        cur = await db.execute("SELECT COUNT(*) as c FROM agent_checkpoints WHERE status='pending'")
        pending = (await cur.fetchone())["c"]
        parts.append(f"待审批检查点: {pending}")

        # Last cognitive loop run
        cur = await db.execute("SELECT created_at, status FROM agent_runs ORDER BY id DESC LIMIT 1")
        row = await cur.fetchone()
        if row:
            parts.append(f"上次认知循环: {row['created_at']} ({row['status']})")

        # Demand stats
        cur = await db.execute("SELECT COUNT(*) as c FROM demands")
        total = (await cur.fetchone())["c"]
        cur = await db.execute("SELECT COUNT(*) as c FROM demands WHERE stage='dismissed'")
        dismissed = (await cur.fetchone())["c"]
        cur = await db.execute("SELECT COUNT(*) as c FROM demands WHERE date(created_at) = date('now')")
        today = (await cur.fetchone())["c"]
        parts.append(f"需求池: {total}个 (今日新增{today}, 已否决{dismissed})")

        # Data freshness
        cur = await db.execute("SELECT MAX(created_at) as latest FROM raw_items")
        row = await cur.fetchone()
        if row and row["latest"]:
            parts.append(f"最新数据: {row['latest']}")

        # Active projects
        cur = await db.execute("SELECT COUNT(*) as c FROM projects WHERE status='active'")
        active = (await cur.fetchone())["c"]
        parts.append(f"活跃项目: {active}个")

        # Recent team activity (what team discussed recently)
        cur = await db.execute(
            "SELECT content FROM agent_chat_messages WHERE role='user' ORDER BY id DESC LIMIT 5"
        )
        recent_msgs = [r["content"][:60] for r in await cur.fetchall()]
        if recent_msgs:
            parts.append(f"团队最近讨论: {'; '.join(recent_msgs)}")

        return "\n".join(parts)
    except Exception as e:
        return f"(状态获取失败: {e})"
    finally:
        await db.close()
