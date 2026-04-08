import aiosqlite
import os
from config import DATABASE_PATH

os.makedirs(os.path.dirname(DATABASE_PATH), exist_ok=True)

SCHEMA = """
CREATE TABLE IF NOT EXISTS data_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    platform TEXT NOT NULL,
    enabled INTEGER DEFAULT 1,
    fetch_interval INTEGER DEFAULT 3600,
    last_fetched_at TIMESTAMP,
    config TEXT DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS raw_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id INTEGER REFERENCES data_sources(id),
    title TEXT NOT NULL,
    content TEXT,
    url TEXT,
    platform TEXT NOT NULL,
    metrics TEXT DEFAULT '{}',
    sentiment TEXT,
    tags TEXT DEFAULT '[]',
    fetched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS demands (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    source_items TEXT DEFAULT '[]',
    stage TEXT DEFAULT 'discovered',
    score_total REAL DEFAULT 0,
    score_pain INTEGER DEFAULT 0,
    score_competition INTEGER DEFAULT 0,
    score_cold_start INTEGER DEFAULT 0,
    score_cost INTEGER DEFAULT 0,
    score_virality INTEGER DEFAULT 0,
    score_ltv INTEGER DEFAULT 0,
    score_ai_opportunity INTEGER DEFAULT 0,
    ai_analysis TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS trends (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    keyword TEXT NOT NULL,
    platform TEXT NOT NULL,
    value REAL,
    previous_value REAL,
    change_percent REAL,
    recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_raw_items_platform ON raw_items(platform);
CREATE INDEX IF NOT EXISTS idx_raw_items_fetched ON raw_items(fetched_at);
CREATE INDEX IF NOT EXISTS idx_demands_stage ON demands(stage);
CREATE INDEX IF NOT EXISTS idx_trends_keyword ON trends(keyword);

-- ── 知识库 ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS knowledge_docs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT '',
    file_type TEXT NOT NULL DEFAULT 'txt',
    char_count INTEGER DEFAULT 0,
    chunks_count INTEGER DEFAULT 0,
    created_by TEXT DEFAULT '',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS knowledge_chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_id INTEGER NOT NULL REFERENCES knowledge_docs(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_doc ON knowledge_chunks(doc_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_docs_category ON knowledge_docs(category);

-- ── 反馈 ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    vote INTEGER NOT NULL,
    note TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ── PM Agent 认知循环 ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    enabled INTEGER DEFAULT 0,
    cycle_interval INTEGER DEFAULT 3600,
    auto_investigate_threshold REAL DEFAULT 7.5,
    max_pending_checkpoints INTEGER DEFAULT 5,
    config TEXT DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS agent_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT UNIQUE NOT NULL,
    status TEXT DEFAULT 'running',
    phase TEXT DEFAULT 'perception',
    world_state TEXT DEFAULT '{}',
    decisions TEXT DEFAULT '[]',
    reasoning_log TEXT DEFAULT '[]',
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP,
    error TEXT
);

CREATE TABLE IF NOT EXISTS agent_checkpoints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT REFERENCES agent_runs(run_id),
    checkpoint_type TEXT NOT NULL,
    demand_id INTEGER REFERENCES demands(id),
    proposal TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    user_feedback TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS skill_outputs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    demand_id INTEGER REFERENCES demands(id),
    skill_name TEXT NOT NULL,
    output TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS prototypes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    demand_id INTEGER REFERENCES demands(id),
    checkpoint_id INTEGER REFERENCES agent_checkpoints(id),
    title TEXT NOT NULL,
    description TEXT,
    html_path TEXT NOT NULL,
    feedback_score INTEGER DEFAULT 0,
    feedback_notes TEXT DEFAULT '[]',
    version INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_status ON agent_runs(status);
CREATE INDEX IF NOT EXISTS idx_agent_checkpoints_status ON agent_checkpoints(status);
CREATE INDEX IF NOT EXISTS idx_skill_outputs_demand ON skill_outputs(demand_id);
CREATE INDEX IF NOT EXISTS idx_prototypes_demand ON prototypes(demand_id);

-- ── Agent 中间产物（gstack 思路：技能链式传递，上下文不丢）─────────────────
CREATE TABLE IF NOT EXISTS agent_artifacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT REFERENCES agent_runs(run_id),
    demand_id INTEGER REFERENCES demands(id),
    artifact_type TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_agent_artifacts_demand ON agent_artifacts(demand_id);
CREATE INDEX IF NOT EXISTS idx_agent_artifacts_type ON agent_artifacts(artifact_type);

-- ── 用户认证 ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL DEFAULT '',
    email TEXT UNIQUE,
    password_hash TEXT NOT NULL,
    avatar_url TEXT DEFAULT '',
    role TEXT NOT NULL DEFAULT 'member',
    is_active INTEGER DEFAULT 1,
    last_login_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username);

-- ── 项目系统 ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    demand_id INTEGER REFERENCES demands(id),
    current_stage TEXT NOT NULL DEFAULT 'discover',
    status TEXT NOT NULL DEFAULT 'active',
    created_by INTEGER REFERENCES users(id),
    tags TEXT DEFAULT '[]',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_projects_stage ON projects(current_stage);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);

CREATE TABLE IF NOT EXISTS project_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    role TEXT NOT NULL DEFAULT 'member',
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id, user_id)
);

CREATE TABLE IF NOT EXISTS stage_deliverables (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stage TEXT NOT NULL,
    doc_type TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    is_required INTEGER DEFAULT 1,
    sort_order INTEGER DEFAULT 0,
    ai_generatable INTEGER DEFAULT 1,
    UNIQUE(stage, doc_type)
);

CREATE TABLE IF NOT EXISTS project_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    doc_type TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    stage TEXT NOT NULL,
    generated_by TEXT DEFAULT 'manual',
    skill_output_id INTEGER REFERENCES skill_outputs(id),
    version INTEGER DEFAULT 1,
    status TEXT DEFAULT 'draft',
    created_by INTEGER REFERENCES users(id),
    updated_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_project_docs_project ON project_documents(project_id);

CREATE TABLE IF NOT EXISTS project_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    document_id INTEGER REFERENCES project_documents(id) ON DELETE SET NULL,
    filename TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_size INTEGER DEFAULT 0,
    mime_type TEXT DEFAULT '',
    uploaded_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_project_files_project ON project_files(project_id);

-- ── 项目文档 RAG 分块 ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    document_id INTEGER REFERENCES project_documents(id) ON DELETE CASCADE,
    file_id INTEGER REFERENCES project_files(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    chunk_index INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_project_chunks_project ON project_chunks(project_id);
CREATE INDEX IF NOT EXISTS idx_project_chunks_document ON project_chunks(document_id);

-- ── 讨论系统 ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS discussion_threads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    document_id INTEGER REFERENCES project_documents(id) ON DELETE SET NULL,
    title TEXT DEFAULT '',
    thread_type TEXT NOT NULL DEFAULT 'general',
    created_by INTEGER REFERENCES users(id),
    is_archived INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_discussion_threads_project ON discussion_threads(project_id);

CREATE TABLE IF NOT EXISTS discussion_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id INTEGER NOT NULL REFERENCES discussion_threads(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id),
    role TEXT NOT NULL DEFAULT 'user',
    content TEXT NOT NULL,
    metadata TEXT DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_discussion_messages_thread ON discussion_messages(thread_id);

-- ── Stage Gate 投票 ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stage_gates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    from_stage TEXT NOT NULL,
    to_stage TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    opened_by INTEGER REFERENCES users(id),
    resolved_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_stage_gates_project ON stage_gates(project_id);

CREATE TABLE IF NOT EXISTS stage_gate_votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    gate_id INTEGER NOT NULL REFERENCES stage_gates(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    vote TEXT NOT NULL,
    comment TEXT DEFAULT '',
    voted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(gate_id, user_id)
);

-- ── 活动日志 ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id),
    action TEXT NOT NULL,
    target_type TEXT DEFAULT '',
    target_id INTEGER DEFAULT 0,
    detail TEXT DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_activity_log_project ON activity_log(project_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_created ON activity_log(created_at);

-- Agent 对话持久化
CREATE TABLE IF NOT EXISTS agent_chat_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id),
    title TEXT DEFAULT '',
    demand_id INTEGER,
    context_type TEXT DEFAULT '',
    context_data TEXT DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_user ON agent_chat_sessions(user_id);

CREATE TABLE IF NOT EXISTS agent_chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES agent_chat_sessions(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id),
    role TEXT NOT NULL DEFAULT 'user',
    content TEXT NOT NULL,
    context_type TEXT DEFAULT '',
    context_ref TEXT DEFAULT '',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON agent_chat_messages(session_id);
"""

# FTS5 相关 SQL —— CentOS 7 的 SQLite 可能不支持 fts5 模块，需要单独 try/except
_FTS5_SQL = [
    """CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_chunks_fts
       USING fts5(content, content=knowledge_chunks, content_rowid=id)""",
    """CREATE TRIGGER IF NOT EXISTS knowledge_chunks_ai
       AFTER INSERT ON knowledge_chunks BEGIN
           INSERT INTO knowledge_chunks_fts(rowid, content) VALUES (new.id, new.content);
       END""",
    """CREATE TRIGGER IF NOT EXISTS knowledge_chunks_ad
       AFTER DELETE ON knowledge_chunks BEGIN
           INSERT INTO knowledge_chunks_fts(knowledge_chunks_fts, rowid, content)
           VALUES ('delete', old.id, old.content);
       END""",
    # Project chunks FTS5
    """CREATE VIRTUAL TABLE IF NOT EXISTS project_chunks_fts
       USING fts5(content, content=project_chunks, content_rowid=id)""",
    """CREATE TRIGGER IF NOT EXISTS project_chunks_ai
       AFTER INSERT ON project_chunks BEGIN
           INSERT INTO project_chunks_fts(rowid, content) VALUES (new.id, new.content);
       END""",
    """CREATE TRIGGER IF NOT EXISTS project_chunks_ad
       AFTER DELETE ON project_chunks BEGIN
           INSERT INTO project_chunks_fts(project_chunks_fts, rowid, content)
           VALUES ('delete', old.id, old.content);
       END""",
    """CREATE TRIGGER IF NOT EXISTS project_chunks_au
       AFTER UPDATE ON project_chunks BEGIN
           INSERT INTO project_chunks_fts(project_chunks_fts, rowid, content)
           VALUES ('delete', old.id, old.content);
           INSERT INTO project_chunks_fts(rowid, content) VALUES (new.id, new.content);
       END""",
]

# Stage deliverable seed data
STAGE_DELIVERABLES = [
    ("discover", "one_pager", "One Pager", "项目概述：问题、方案、目标用户、价值主张", 1, 0, 1),
    ("discover", "signal_summary", "信号摘要", "市场信号汇总和初步分析", 1, 1, 1),
    ("value_filter", "scoring_report", "评分报告", "多维度评分和优先级分析", 1, 0, 1),
    ("value_filter", "competitive_research", "竞品研究", "竞品分析和差异化定位", 1, 1, 1),
    ("validate", "user_research", "用户研究", "用户画像、痛点分析、Jobs-to-be-done", 1, 0, 1),
    ("validate", "tam_analysis", "TAM分析", "总可用市场、可服务市场、可获得市场", 1, 1, 1),
    ("validate", "positioning", "定位策略", "产品定位、slogan、差异化策略", 0, 2, 1),
    ("pmf", "prd", "产品需求文档", "功能需求、MVP 范围、用户故事", 1, 0, 1),
    ("pmf", "prototype_brief", "原型简报", "原型设计要求和交互说明", 1, 1, 1),
    ("pmf", "user_test_plan", "用户测试计划", "测试方案、成功指标、用户招募", 0, 2, 1),
    ("business_model", "business_model_canvas", "商业模式画布", "九要素商业模式分析", 1, 0, 1),
    ("business_model", "unit_economics", "单位经济模型", "CAC、LTV、毛利等关键指标", 1, 1, 1),
    ("business_model", "go_to_market", "GTM策略", "上市策略、渠道、定价", 0, 2, 1),
]

DEFAULT_SOURCES = [
    ("Google Trends", "google_trends", 1, 3600, '{"keywords": ["AI tools", "SaaS", "no-code", "automation", "side hustle"]}'),
    ("Reddit", "reddit", 1, 1800, '{}'),
    ("Hacker News", "hackernews", 1, 1800, '{"min_score": 50}'),
    ("Product Hunt", "producthunt", 1, 3600, '{}'),
    ("YouTube", "youtube", 1, 7200, '{}'),
    ("TrustMRR", "trustmrr", 1, 86400, '{}'),
    ("Fiverr", "fiverr", 1, 7200, '{}'),
    ("Etsy", "etsy", 1, 7200, '{}'),
    ("Apify Reddit", "apify_reddit", 1, 3600, '{"keywords": ["I wish there was", "frustrated with", "looking for alternative", "need a tool for"]}'),
    ("Apify Twitter/X", "apify_twitter", 1, 3600, '{"keywords": ["I wish there was an app", "frustrated with tool", "need alternative to", "worst software experience"]}'),
    ("Apify YouTube Comments", "apify_youtube", 1, 7200, '{"keywords": ["frustrating software tools", "worst SaaS products", "need better alternative"]}'),
    ("Apify G2 Reviews", "apify_g2", 1, 14400, '{"products": ["notion", "slack", "trello", "asana", "clickup", "monday-com", "airtable"]}'),
    ("Apify Bilibili", "apify_bilibili", 1, 7200, '{"keywords": ["效率工具推荐", "办公软件吐槽", "SaaS工具", "AI工具测评"]}'),
    ("Apify Xiaohongshu", "apify_xiaohongshu", 1, 7200, '{"keywords": ["效率工具", "办公神器", "好用的APP", "AI工具"]}'),
    ("Apify Weibo", "apify_weibo", 1, 7200, '{"keywords": ["效率工具", "办公软件", "SaaS工具", "AI工具"]}'),
    ("Apify Quora", "apify_quora", 1, 7200, '{"keywords": ["best productivity tools", "frustrated with software", "looking for alternative"]}'),
    ("Apify Stack Overflow", "apify_stackoverflow", 1, 7200, '{"keywords": ["automation tool recommendation", "workflow tool", "no-code alternative"]}'),
    ("Apify Product Hunt", "apify_producthunt", 1, 3600, '{"sort": "NEWEST"}'),
    ("Apify Hacker News", "apify_hackernews", 1, 3600, '{}'),
    ("Apify IndieHackers", "apify_indiehackers", 1, 7200, '{}'),
    ("Apify Fiverr", "apify_fiverr", 1, 7200, '{"keywords": ["AI automation", "no-code development", "SaaS MVP"]}'),
    ("Apify Etsy", "apify_etsy", 1, 7200, '{"keywords": ["digital planner", "notion template", "productivity tool"]}'),
    ("Apify YouTube Videos", "apify_youtube_videos", 1, 7200, '{"keywords": ["best SaaS tools", "productivity app review", "AI automation tools"]}'),
    ("PainOnSocial", "painonsocial", 1, 86400, '{"max_professions": 20, "discover_index": true}'),
    # ── 直连抓取源 ──────────────────────────────────────────────────────────
    ("Bilibili", "bilibili", 1, 7200, '{"keywords": ["效率工具", "SaaS测评", "AI工具", "办公软件"]}'),
    ("Tieba", "tieba", 1, 7200, '{"tiebas": ["创业吧", "程序员吧", "独立开发者吧"]}'),
    ("Stack Overflow", "stackoverflow", 1, 7200, '{"tags": ["automation", "workflow", "no-code", "saas", "productivity"], "keywords": ["alternative to", "looking for tool", "recommend a library"]}'),
    # ── Crawl4AI 免费抓取源 ─────────────────────────────────────────────────
    ("Crawl4AI Twitter", "crawl4ai_twitter", 1, 3600, '{"keywords": ["I wish there was an app", "frustrated with tool", "need alternative to"]}'),
    ("Crawl4AI Quora", "crawl4ai_quora", 1, 7200, '{"keywords": ["best productivity tools", "frustrated with software", "looking for alternative"]}'),
    ("Crawl4AI G2", "crawl4ai_g2", 1, 14400, '{"products": ["notion", "slack", "trello", "asana", "clickup"]}'),
    ("Crawl4AI Fiverr", "crawl4ai_fiverr", 1, 7200, '{"keywords": ["AI automation", "no-code development", "SaaS MVP"]}'),
    ("Crawl4AI Etsy", "crawl4ai_etsy", 1, 7200, '{"keywords": ["digital planner", "notion template", "productivity tool"]}'),
    ("Crawl4AI IndieHackers", "crawl4ai_indiehackers", 1, 7200, '{}'),
    ("Crawl4AI YouTube", "crawl4ai_youtube", 1, 7200, '{"keywords": ["SaaS tools review", "productivity app", "AI automation"]}'),
    ("Crawl4AI Xiaohongshu", "crawl4ai_xiaohongshu", 1, 7200, '{"keywords": ["效率工具", "办公神器", "好用的APP"]}'),
    ("Crawl4AI Zhihu", "crawl4ai_zhihu", 1, 7200, '{"keywords": ["效率工具推荐", "SaaS工具", "自动化工具"]}'),
    ("Crawl4AI Weibo", "crawl4ai_weibo", 1, 7200, '{"keywords": ["效率工具", "办公软件", "AI工具"]}'),
]


_db_instance = None
_db_lock = None


class _SharedConnection:
    """Wrapper around aiosqlite connection that makes close() a no-op.

    All API handlers call db.close() in their finally blocks.
    With a singleton connection, we must NOT actually close it.
    Only _real_close() (called at shutdown) truly closes it.
    """

    def __init__(self, conn):
        self._conn = conn

    # Proxy all attribute access to the real connection
    def __getattr__(self, name):
        return getattr(self._conn, name)

    async def close(self):
        """No-op — singleton connection stays open."""
        pass

    async def _real_close(self):
        """Actually close the connection (for app shutdown)."""
        await self._conn.close()


async def get_db():
    """Return a shared singleton database connection.

    Using a single connection avoids 'database is locked' errors
    that occur when multiple aiosqlite connections try to write
    concurrently to the same SQLite database.
    """
    import asyncio
    global _db_instance, _db_lock

    if _db_lock is None:
        _db_lock = asyncio.Lock()

    async with _db_lock:
        if _db_instance is not None:
            try:
                await _db_instance._conn.execute("SELECT 1")
                return _db_instance
            except Exception:
                try:
                    await _db_instance._real_close()
                except Exception:
                    pass
                _db_instance = None

        conn = await aiosqlite.connect(DATABASE_PATH, timeout=60)
        conn.row_factory = aiosqlite.Row
        await conn.execute("PRAGMA journal_mode=WAL")
        await conn.execute("PRAGMA busy_timeout=30000")
        await conn.execute("PRAGMA synchronous=NORMAL")
        _db_instance = _SharedConnection(conn)
        return _db_instance


async def close_db():
    """Actually close the singleton connection. Call at app shutdown."""
    global _db_instance
    if _db_instance is not None:
        await _db_instance._real_close()
        _db_instance = None


async def init_db():
    db = await get_db()
    await db.executescript(SCHEMA)

    # FTS5 知识库索引（CentOS 7 的 SQLite 可能不支持，失败不影响其他功能）
    for sql in _FTS5_SQL:
        try:
            await db.execute(sql)
        except Exception as e:
            print(f"[init_db] FTS5 跳过 (可能不支持): {e}")
            break  # fts5 不可用，后续 trigger 也没意义
    await db.commit()

    # Migration: 给 demands 表加 track 和 competitive_ref 列（已有数据不受影响）
    try:
        await db.execute("ALTER TABLE demands ADD COLUMN track TEXT DEFAULT 'A'")
    except Exception:
        pass  # 列已存在
    try:
        await db.execute("ALTER TABLE demands ADD COLUMN competitive_ref TEXT DEFAULT ''")
    except Exception:
        pass  # 列已存在
    try:
        await db.execute("CREATE INDEX IF NOT EXISTS idx_demands_track ON demands(track)")
    except Exception:
        pass

    # Migration: demands.insight_layer (三层知识分类)
    try:
        await db.execute("ALTER TABLE demands ADD COLUMN insight_layer TEXT DEFAULT 'conventional'")
    except Exception:
        pass
    # Migration: demands.seo_keywords + validation_data (验证层)
    try:
        await db.execute("ALTER TABLE demands ADD COLUMN seo_keywords TEXT DEFAULT '[]'")
    except Exception:
        pass
    try:
        await db.execute("ALTER TABLE demands ADD COLUMN validation_data TEXT DEFAULT '{}'")
    except Exception:
        pass

    # Migration: agent_tasks + agent_messages (多Agent协作)
    try:
        await db.execute("""CREATE TABLE IF NOT EXISTS agent_tasks (
            id TEXT PRIMARY KEY,
            agent_from TEXT NOT NULL,
            agent_to TEXT NOT NULL,
            action TEXT NOT NULL,
            params TEXT DEFAULT '{}',
            status TEXT DEFAULT 'queued',
            priority TEXT DEFAULT 'normal',
            progress TEXT DEFAULT '',
            result TEXT,
            error TEXT DEFAULT '',
            plan_steps TEXT DEFAULT '[]',
            created_at REAL,
            started_at REAL DEFAULT 0,
            finished_at REAL DEFAULT 0
        )""")
    except Exception:
        pass
    try:
        await db.execute("""CREATE TABLE IF NOT EXISTS agent_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            from_agent TEXT NOT NULL,
            to_agent TEXT NOT NULL,
            msg_type TEXT NOT NULL,
            content TEXT NOT NULL,
            task_id TEXT DEFAULT '',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )""")
    except Exception:
        pass

    # Migration: agent_checkpoints.urgency (三级分流)
    try:
        await db.execute("ALTER TABLE agent_checkpoints ADD COLUMN urgency TEXT DEFAULT 'ask'")
    except Exception:
        pass

    # Migration: knowledge_docs.content (存储周报等文本内容)
    try:
        await db.execute("ALTER TABLE knowledge_docs ADD COLUMN content TEXT DEFAULT ''")
    except Exception:
        pass

    # 改造六：智能审批人推荐 — checkpoints 新增字段
    try:
        await db.execute("ALTER TABLE agent_checkpoints ADD COLUMN suggested_reviewer TEXT")
    except Exception:
        pass

    # ── 飞轮改造迁移 ─────────────────────────────────────────────────────

    # 改造一：Agent 自审 — demands 表新增字段
    try:
        await db.execute("ALTER TABLE demands ADD COLUMN agent_verdict TEXT")
    except Exception:
        pass
    try:
        await db.execute("ALTER TABLE demands ADD COLUMN agent_review_at DATETIME")
    except Exception:
        pass
    try:
        await db.execute("CREATE INDEX IF NOT EXISTS idx_demands_verdict ON demands(agent_verdict)")
    except Exception:
        pass

    # 改造四：Prompt 版本化自进化
    try:
        await db.execute("""CREATE TABLE IF NOT EXISTS prompt_versions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            role TEXT NOT NULL,
            patch_content TEXT NOT NULL,
            status TEXT DEFAULT 'candidate',
            metrics_snapshot TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )""")
    except Exception:
        pass

    # 改造三：Source 效率追踪
    try:
        await db.execute("""CREATE TABLE IF NOT EXISTS source_efficiency_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source_id INTEGER NOT NULL,
            period_start DATE,
            period_end DATE,
            total_items INTEGER DEFAULT 0,
            contributed_demands INTEGER DEFAULT 0,
            approved_demands INTEGER DEFAULT 0,
            efficiency REAL DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )""")
    except Exception:
        pass

    # 改造七：认知飞轮 — 预防规则表
    try:
        await db.execute("""CREATE TABLE IF NOT EXISTS prevention_rules (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            rule_id TEXT UNIQUE NOT NULL,
            pattern TEXT NOT NULL,
            pattern_keywords TEXT DEFAULT '[]',
            action TEXT NOT NULL,
            action_params TEXT DEFAULT '{}',
            confidence REAL DEFAULT 0.5,
            source_type TEXT DEFAULT 'agent',
            source_ids TEXT DEFAULT '[]',
            hit_count INTEGER DEFAULT 0,
            hit_correct INTEGER DEFAULT 0,
            success_rate REAL DEFAULT 0.0,
            status TEXT DEFAULT 'candidate',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            retired_at DATETIME
        )""")
    except Exception:
        pass
    try:
        await db.execute("CREATE INDEX IF NOT EXISTS idx_prevention_rules_status ON prevention_rules(status)")
    except Exception:
        pass

    # Insert default agent config if empty
    try:
        await db.execute(
            "INSERT OR IGNORE INTO agent_config (id, enabled) VALUES (1, 0)"
        )
    except Exception:
        pass

    # Seed stage deliverables
    try:
        cur = await db.execute("SELECT COUNT(*) FROM stage_deliverables")
        row = await cur.fetchone()
        if row[0] == 0:
            for stage, doc_type, title, desc, required, sort, ai_gen in STAGE_DELIVERABLES:
                await db.execute(
                    "INSERT INTO stage_deliverables (stage, doc_type, title, description, is_required, sort_order, ai_generatable) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (stage, doc_type, title, desc, required, sort, ai_gen),
                )
    except Exception:
        pass

    # Migration: add new data sources if not already present
    for name, platform, enabled, interval, config in [
        ("Fiverr", "fiverr", 1, 7200, '{}'),
        ("Etsy", "etsy", 1, 7200, '{}'),
        ("Apify Reddit", "apify_reddit", 1, 3600, '{"keywords": ["I wish there was", "frustrated with", "looking for alternative", "need a tool for"]}'),
        ("Apify Twitter/X", "apify_twitter", 1, 3600, '{"keywords": ["I wish there was an app", "frustrated with tool", "need alternative to", "worst software experience"]}'),
        ("Apify YouTube Comments", "apify_youtube", 1, 7200, '{"keywords": ["frustrating software tools", "worst SaaS products", "need better alternative"]}'),
        ("Apify G2 Reviews", "apify_g2", 1, 14400, '{"products": ["notion", "slack", "trello", "asana", "clickup", "monday-com", "airtable"]}'),
        ("Apify Bilibili", "apify_bilibili", 1, 7200, '{"keywords": ["效率工具推荐", "办公软件吐槽", "SaaS工具", "AI工具测评"]}'),
        ("Apify Xiaohongshu", "apify_xiaohongshu", 1, 7200, '{"keywords": ["效率工具", "办公神器", "好用的APP", "AI工具"]}'),
        ("Apify Weibo", "apify_weibo", 1, 7200, '{"keywords": ["效率工具", "办公软件", "SaaS工具", "AI工具"]}'),
        ("Apify Quora", "apify_quora", 1, 7200, '{"keywords": ["best productivity tools", "frustrated with software", "looking for alternative"]}'),
        ("Apify Stack Overflow", "apify_stackoverflow", 1, 7200, '{"keywords": ["automation tool recommendation", "workflow tool", "no-code alternative"]}'),
        ("Apify Product Hunt", "apify_producthunt", 1, 3600, '{"sort": "NEWEST"}'),
        ("Apify Hacker News", "apify_hackernews", 1, 3600, '{}'),
        ("Apify IndieHackers", "apify_indiehackers", 1, 7200, '{}'),
        ("Apify Fiverr", "apify_fiverr", 1, 7200, '{"keywords": ["AI automation", "no-code development", "SaaS MVP"]}'),
        ("Apify Etsy", "apify_etsy", 1, 7200, '{"keywords": ["digital planner", "notion template", "productivity tool"]}'),
        ("Apify YouTube Videos", "apify_youtube_videos", 1, 7200, '{"keywords": ["best SaaS tools", "productivity app review", "AI automation tools"]}'),
        ("PainOnSocial", "painonsocial", 1, 86400, '{"max_professions": 20, "discover_index": true}'),
        # 直连抓取源
        ("Bilibili", "bilibili", 1, 7200, '{"keywords": ["效率工具", "SaaS测评", "AI工具", "办公软件"]}'),
        ("Tieba", "tieba", 1, 7200, '{"tiebas": ["创业吧", "程序员吧", "独立开发者吧"]}'),
        ("Stack Overflow", "stackoverflow", 1, 7200, '{"tags": ["automation", "workflow", "no-code", "saas", "productivity"], "keywords": ["alternative to", "looking for tool", "recommend a library"]}'),
        # Crawl4AI 免费抓取源
        ("Crawl4AI Twitter", "crawl4ai_twitter", 1, 3600, '{"keywords": ["I wish there was an app", "frustrated with tool", "need alternative to"]}'),
        ("Crawl4AI Quora", "crawl4ai_quora", 1, 7200, '{"keywords": ["best productivity tools", "frustrated with software", "looking for alternative"]}'),
        ("Crawl4AI G2", "crawl4ai_g2", 1, 14400, '{"products": ["notion", "slack", "trello", "asana", "clickup"]}'),
        ("Crawl4AI Fiverr", "crawl4ai_fiverr", 1, 7200, '{"keywords": ["AI automation", "no-code development", "SaaS MVP"]}'),
        ("Crawl4AI Etsy", "crawl4ai_etsy", 1, 7200, '{"keywords": ["digital planner", "notion template", "productivity tool"]}'),
        ("Crawl4AI IndieHackers", "crawl4ai_indiehackers", 1, 7200, '{}'),
        ("Crawl4AI YouTube", "crawl4ai_youtube", 1, 7200, '{"keywords": ["SaaS tools review", "productivity app", "AI automation"]}'),
        ("Crawl4AI Xiaohongshu", "crawl4ai_xiaohongshu", 1, 7200, '{"keywords": ["效率工具", "办公神器", "好用的APP"]}'),
        ("Crawl4AI Zhihu", "crawl4ai_zhihu", 1, 7200, '{"keywords": ["效率工具推荐", "SaaS工具", "自动化工具"]}'),
        ("Crawl4AI Weibo", "crawl4ai_weibo", 1, 7200, '{"keywords": ["效率工具", "办公软件", "AI工具"]}'),
    ]:
        try:
            cur = await db.execute("SELECT id FROM data_sources WHERE platform=?", (platform,))
            if not await cur.fetchone():
                await db.execute(
                    "INSERT INTO data_sources (name, platform, enabled, fetch_interval, config) VALUES (?, ?, ?, ?, ?)",
                    (name, platform, enabled, interval, config),
                )
        except Exception:
            pass

    # ── 项目部署链接 + 数据分析 ─────────────────────────────────────────────
    for col in ["landing_page_url TEXT DEFAULT ''",
                "mvp_url TEXT DEFAULT ''",
                "analytics_dashboard_url TEXT DEFAULT ''",
                "stats_api_url TEXT DEFAULT ''"]:
        try:
            await db.execute(f"ALTER TABLE projects ADD COLUMN {col}")
        except Exception:
            pass

    try:
        await db.execute("""CREATE TABLE IF NOT EXISTS project_analytics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            recorded_date TEXT NOT NULL,
            visits INTEGER DEFAULT 0,
            signups INTEGER DEFAULT 0,
            active_users INTEGER DEFAULT 0,
            revenue REAL DEFAULT 0,
            custom_metrics TEXT DEFAULT '{}',
            notes TEXT DEFAULT '',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(project_id, recorded_date)
        )""")
        await db.execute("CREATE INDEX IF NOT EXISTS idx_project_analytics_project ON project_analytics(project_id)")
    except Exception:
        pass

    # ── 圆桌讨论 ──
    await db.execute("""
        CREATE TABLE IF NOT EXISTS roundtable_rooms (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            topic TEXT DEFAULT '',
            project_id INTEGER,
            created_by INTEGER,
            invite_token TEXT UNIQUE,
            status TEXT DEFAULT 'active',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    await db.execute("CREATE INDEX IF NOT EXISTS idx_rt_rooms_status ON roundtable_rooms(status)")
    await db.execute("CREATE INDEX IF NOT EXISTS idx_rt_rooms_project ON roundtable_rooms(project_id)")
    # Migration: add invite_token column + backfill tokens
    try:
        await db.execute("ALTER TABLE roundtable_rooms ADD COLUMN invite_token TEXT")
        await db.commit()
    except Exception:
        pass
    try:
        await db.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_rt_rooms_token ON roundtable_rooms(invite_token)")
        import secrets as _secrets
        cur = await db.execute("SELECT id FROM roundtable_rooms WHERE invite_token IS NULL")
        for row in await cur.fetchall():
            await db.execute("UPDATE roundtable_rooms SET invite_token = ? WHERE id = ?",
                             (_secrets.token_urlsafe(18), row[0]))
        await db.commit()
    except Exception as _e:
        print(f"[init_db] invite_token migration skipped: {_e}")

    await db.execute("""
        CREATE TABLE IF NOT EXISTS roundtable_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            room_id INTEGER NOT NULL,
            sender_type TEXT NOT NULL DEFAULT 'human',
            sender_name TEXT NOT NULL DEFAULT '',
            user_id INTEGER,
            content TEXT NOT NULL,
            metadata TEXT DEFAULT '{}',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    await db.execute("CREATE INDEX IF NOT EXISTS idx_rt_messages_room ON roundtable_messages(room_id)")
    await db.execute("CREATE INDEX IF NOT EXISTS idx_rt_messages_created ON roundtable_messages(created_at)")

    # Insert default sources if empty
    cursor = await db.execute("SELECT COUNT(*) FROM data_sources")
    row = await cursor.fetchone()
    if row[0] == 0:
        for name, platform, enabled, interval, config in DEFAULT_SOURCES:
            await db.execute(
                "INSERT INTO data_sources (name, platform, enabled, fetch_interval, config) VALUES (?, ?, ?, ?, ?)",
                (name, platform, enabled, interval, config),
            )
    await db.commit()
    await db.close()
