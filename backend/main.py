import asyncio
import json
import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager
from database import init_db, get_db
from api import sources, items, demands, trends, analysis, dashboard, feedback, sync, knowledge, competitive
from api import agent as agent_api
from api import auth as auth_api
from api import projects as projects_api
from api import documents as documents_api
from api import files as files_api
from api import discussions as discussions_api
from api import activity as activity_api
from api import validation as validation_api
from api import acquisition as acquisition_api
from api import twitter_monitor as twitter_monitor_api
from api import agent_bus_api
from api import lessons as lessons_api
from api import roundtable as roundtable_api
from agent.cognitive_loop import CognitiveLoop
from agent.memory import AgentMemory
from auth.deps import get_current_user

logger = logging.getLogger("scheduler")

# Background task handles
_scheduler_task = None
_stats_task = None
_cognitive_loop: CognitiveLoop | None = None


async def _run_all_scrapers():
    """Run all enabled scrapers once."""
    from scrapers.base import run_scraper
    db = await get_db()
    try:
        cur = await db.execute("SELECT * FROM data_sources WHERE enabled = 1")
        all_sources = [dict(r) for r in await cur.fetchall()]
        results = {}
        for source in all_sources:
            try:
                count = await run_scraper(
                    source["platform"],
                    json.loads(source.get("config") or "{}"),
                    source["id"],
                    db,
                )
                await db.execute(
                    "UPDATE data_sources SET last_fetched_at = CURRENT_TIMESTAMP WHERE id = ?",
                    (source["id"],),
                )
                results[source["platform"]] = count
            except Exception as e:
                results[source["platform"]] = f"error: {str(e)}"
        await db.commit()
        logger.info(f"Scheduled fetch complete: {results}")
        return results
    except Exception as e:
        logger.error(f"Scheduled fetch error: {e}")
    finally:
        await db.close()


async def _daily_pipeline():
    """
    完整每日流水线：
    1. 审计（如需要）→ 优化策略
    2. 正式抓取
    3. 轻量审计（质量报告）
    4. 旧数据生成简报 → 存入知识库 → 删除原始数据
    """
    from agent.data_auditor import should_audit, run_audit_cycle, light_audit, evolve_scraper_strategy
    from agent.data_digest import run_digest_and_cleanup

    db = await get_db()
    try:
        # Step 1: 检查是否需要完整审计
        needs_audit = await should_audit(db)
    finally:
        await db.close()

    if needs_audit:
        logger.info("Running data quality audit before fetch...")
        # 小批量抽样抓取用于审计
        await _run_all_scrapers()  # 先抓一轮
        db = await get_db()
        try:
            cur = await db.execute(
                "SELECT * FROM raw_items ORDER BY fetched_at DESC LIMIT 200"
            )
            sample_items = [dict(r) for r in await cur.fetchall()]
            report = await run_audit_cycle(db, sample_items)
            logger.info(f"Audit round complete: {report.get('overall_rate', 0)*100:.0f}% quality")
        except Exception as e:
            logger.error(f"Audit failed: {e}")
        finally:
            await db.close()
    else:
        # Step 2: 正式抓取
        logger.info("Starting scheduled daily data fetch...")
        await _run_all_scrapers()

    # Step 3: 轻量审计（每次都做，只报告不改策略）
    try:
        db = await get_db()
        try:
            cur = await db.execute(
                "SELECT * FROM raw_items ORDER BY fetched_at DESC LIMIT 100"
            )
            recent_items = [dict(r) for r in await cur.fetchall()]
            if recent_items:
                audit_report = await light_audit(db, recent_items)
                logger.info(f"Light audit: {audit_report.get('overall_rate', 0)*100:.0f}% quality")
                if audit_report.get("needs_full_audit"):
                    logger.warning("Quality below 60% — full audit will run next cycle")
        finally:
            await db.close()
    except Exception as e:
        logger.error(f"Light audit failed: {e}")

    # Step 3.5: 改造三 — 需求质量反推爬虫策略
    try:
        db = await get_db()
        try:
            await evolve_scraper_strategy(db)
            logger.info("Scraper strategy evolution complete")
        finally:
            await db.close()
    except Exception as e:
        logger.error(f"Scraper strategy evolution failed: {e}")

    # Step 4: 生成简报 + 清理旧数据
    try:
        db = await get_db()
        try:
            result = await run_digest_and_cleanup(db)
            if result["digests_created"] > 0:
                logger.info(f"Digests: {result['digests_created']} created, {result['items_cleaned']} items cleaned")
        finally:
            await db.close()
    except Exception as e:
        logger.error(f"Digest/cleanup failed: {e}")


async def _scheduler_loop():
    """Background loop: run daily pipeline once a day."""
    # Wait 60 seconds after startup before first run
    await asyncio.sleep(60)

    while True:
        try:
            logger.info("Starting daily pipeline...")
            await _daily_pipeline()
            logger.info("Daily pipeline complete")
        except Exception as e:
            logger.error(f"Scheduler error: {e}")

        # Wait 24 hours before next run
        await asyncio.sleep(24 * 60 * 60)


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _scheduler_task, _stats_task, _cognitive_loop
    await init_db()
    # Start background scheduler
    _scheduler_task = asyncio.create_task(_scheduler_loop())
    logger.info("Background scheduler started (once daily)")

    # Start stats puller background loop (every 12 hours)
    from tasks.stats_puller import stats_pull_loop
    _stats_task = asyncio.create_task(stats_pull_loop(interval_hours=12))
    logger.info("Stats puller started (every 12h)")

    # Initialize agent memory (single source of truth)
    _memory = AgentMemory()
    await _memory.initialize()

    # Wire memory to all subsystems (eliminates duplicate file I/O)
    from agent.tools import set_tools_memory
    set_tools_memory(_memory)
    from agent.dreaming import set_dreaming_memory
    set_dreaming_memory(_memory)

    # Initialize cognitive loop (disabled by default, user toggles on)
    _cognitive_loop = CognitiveLoop(db_getter=get_db, memory=_memory)
    agent_api.set_cognitive_loop(_cognitive_loop)
    agent_api.set_memory(_memory)

    # 注册多 Agent 协作框架
    from agent.agent_bus import register_agents
    register_agents()
    logger.info("Cognitive loop initialized (toggle on via /api/agent/toggle)")

    yield
    # Cleanup
    if _cognitive_loop:
        await _cognitive_loop.stop()
    if _stats_task:
        _stats_task.cancel()
    if _scheduler_task:
        _scheduler_task.cancel()
    # Close singleton DB connection
    from database import close_db
    await close_db()


app = FastAPI(title="Demand Monitor API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Auth router (no auth required)
app.include_router(auth_api.router, prefix="/api/auth", tags=["auth"])

# All other routers require authentication
from fastapi import Depends
_auth = [Depends(get_current_user)]
app.include_router(dashboard.router, prefix="/api/dashboard", tags=["dashboard"], dependencies=_auth)
app.include_router(sources.router, prefix="/api/sources", tags=["sources"], dependencies=_auth)
app.include_router(items.router, prefix="/api/items", tags=["items"], dependencies=_auth)
app.include_router(demands.router, prefix="/api/demands", tags=["demands"], dependencies=_auth)
app.include_router(trends.router, prefix="/api/trends", tags=["trends"], dependencies=_auth)
app.include_router(analysis.router, prefix="/api/analysis", tags=["analysis"], dependencies=_auth)
app.include_router(feedback.router, prefix="/api/feedback", tags=["feedback"], dependencies=_auth)
app.include_router(sync.router, prefix="/api/sync", tags=["sync"], dependencies=_auth)
app.include_router(knowledge.router, prefix="/api/knowledge", tags=["knowledge"], dependencies=_auth)
app.include_router(competitive.router, prefix="/api/competitive", tags=["competitive"], dependencies=_auth)
app.include_router(agent_api.router, prefix="/api/agent", tags=["agent"], dependencies=_auth)
app.include_router(projects_api.router, prefix="/api/projects", tags=["projects"], dependencies=_auth)
app.include_router(documents_api.router, prefix="/api", tags=["documents"], dependencies=_auth)
app.include_router(files_api.router, prefix="/api", tags=["files"], dependencies=_auth)
app.include_router(discussions_api.router, prefix="/api", tags=["discussions"], dependencies=_auth)
app.include_router(activity_api.router, prefix="/api/activity", tags=["activity"], dependencies=_auth)
app.include_router(validation_api.router, prefix="/api/validation", tags=["validation"], dependencies=_auth)
app.include_router(acquisition_api.router, prefix="/api/acquisition", tags=["acquisition"], dependencies=_auth)
app.include_router(twitter_monitor_api.router, prefix="/api/twitter", tags=["twitter"], dependencies=_auth)
app.include_router(agent_bus_api.router, prefix="/api/bus", tags=["agent-bus"], dependencies=_auth)
app.include_router(lessons_api.router, prefix="/api/lessons", tags=["lessons"], dependencies=_auth)
app.include_router(roundtable_api.router, prefix="/api/roundtable", tags=["roundtable"], dependencies=_auth)
# Open roundtable API — token-based, no auth required (for external agents)
app.include_router(roundtable_api.open_router, prefix="/api/roundtable/open", tags=["roundtable-open"])

# Serve generated H5 prototypes as static files
import os
_proto_dir = os.getenv("PROTOTYPE_DIR", os.path.join(os.path.dirname(__file__), "..", "data", "prototypes"))
os.makedirs(_proto_dir, exist_ok=True)
app.mount("/prototypes", StaticFiles(directory=_proto_dir), name="prototypes")


@app.get("/api/config/voice-keys")
async def get_voice_keys(user=Depends(get_current_user)):
    """Return voice service API keys from server environment (authenticated)."""
    return {
        "deepgram_key": os.getenv("DEEPGRAM_API_KEY", ""),
    }


@app.post("/api/stats/pull")
async def trigger_stats_pull(user=Depends(get_current_user)):
    """手动触发一次数据拉取。"""
    from tasks.stats_puller import pull_all_stats
    result = await pull_all_stats()
    return result


@app.post("/api/agent/dream")
async def trigger_dream(user: dict = Depends(get_current_user)):
    """手动触发 Agent 做梦 — 压缩记忆、提炼方法论、生成问题。"""
    from agent.dreaming import dream_cycle
    results = await dream_cycle(ask_questions=True)
    return results


@app.get("/api/agent/methodologies")
async def get_methodologies(user: dict = Depends(get_current_user)):
    """获取 Agent 提炼的方法论列表。"""
    from agent.dreaming import get_methodologies, get_pending_questions
    return {
        "methodologies": get_methodologies(),
        "pending_questions": get_pending_questions(),
    }


@app.get("/api/health")
async def health():
    checks = {"status": "ok"}
    try:
        db = await get_db()
        await db.execute("SELECT 1")
        await db.close()
        checks["db"] = "ok"
    except Exception as e:
        checks["status"] = "degraded"
        checks["db"] = str(e)
    return checks
