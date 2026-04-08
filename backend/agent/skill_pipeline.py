"""
技能流水线 — 批准检查点后自动执行完整的 PM 分析流程。

借鉴 gstack 并行 Sprint 思路：
- 第一组互不依赖的 skill 并行执行（user_research, tam_analysis, competitive_battlecard）
- 第二组依赖前面结果的 skill 串行执行（positioning, write_prd）
- 最后生成原型
"""
import asyncio
import json
import logging
from database import get_db
from agent.skills.registry import get_registry
from agent.prototype_generator import generate_prototype

logger = logging.getLogger("skill_pipeline")

# 第一组：互不依赖，可并行
PARALLEL_SKILLS = [
    "user_research",
    "tam_analysis",
    "competitive_battlecard",
]

# 第二组：依赖前面的上下文，需串行
SEQUENTIAL_SKILLS = [
    "positioning",
    "write_prd",
]

PIPELINE_ORDER = PARALLEL_SKILLS + SEQUENTIAL_SKILLS


async def _run_single_skill(skill, skill_name: str, demand: dict,
                            context: dict, memory, demand_id: int) -> tuple[str, dict | None]:
    """执行单个 skill 并存储结果，返回 (skill_name, result)。"""
    try:
        logger.info(f"Running skill '{skill_name}' for demand #{demand_id}")
        result = await skill.execute(demand, context, memory)

        # Store output
        db = await get_db()
        try:
            await db.execute(
                "INSERT INTO skill_outputs (demand_id, skill_name, output) VALUES (?, ?, ?)",
                (demand_id, skill_name, json.dumps(result, ensure_ascii=False)),
            )
            await db.commit()
        finally:
            await db.close()

        return skill_name, result
    except Exception as e:
        logger.error(f"Skill '{skill_name}' failed for demand #{demand_id}: {e}")
        return skill_name, {"error": str(e)}


async def run_pipeline(demand_id: int, memory=None, checkpoint_id: int = None):
    """
    Run the full PM skills pipeline for a demand, then generate a prototype.
    Creates a Checkpoint 2 (prototype review) when done.
    """
    registry = get_registry()

    db = await get_db()
    try:
        cur = await db.execute("SELECT * FROM demands WHERE id=?", (demand_id,))
        row = await cur.fetchone()
        if not row:
            logger.error(f"Demand {demand_id} not found")
            return
        demand = dict(row)
    finally:
        await db.close()

    context = {}

    # ── 第一组：并行执行互不依赖的 skill ──
    parallel_tasks = []
    for skill_name in PARALLEL_SKILLS:
        skill = registry.get(skill_name)
        if not skill:
            logger.warning(f"Skill {skill_name} not found, skipping")
            continue
        parallel_tasks.append(
            _run_single_skill(skill, skill_name, demand, context, memory, demand_id)
        )

    if parallel_tasks:
        results = await asyncio.gather(*parallel_tasks, return_exceptions=True)
        for item in results:
            if isinstance(item, Exception):
                logger.error(f"Parallel skill failed: {item}")
                continue
            skill_name, result = item
            if result is not None:
                context[skill_name] = result

    logger.info(f"Parallel phase done for demand #{demand_id}: {list(context.keys())}")

    # ── 第二组：串行执行依赖上下文的 skill ──
    for skill_name in SEQUENTIAL_SKILLS:
        skill = registry.get(skill_name)
        if not skill:
            logger.warning(f"Skill {skill_name} not found, skipping")
            continue

        try:
            logger.info(f"Running skill '{skill_name}' for demand #{demand_id}")
            result = await skill.execute(demand, context, memory)
            context[skill_name] = result

            db = await get_db()
            try:
                await db.execute(
                    "INSERT INTO skill_outputs (demand_id, skill_name, output) VALUES (?, ?, ?)",
                    (demand_id, skill_name, json.dumps(result, ensure_ascii=False)),
                )
                await db.commit()
            finally:
                await db.close()

        except Exception as e:
            logger.error(f"Skill '{skill_name}' failed for demand #{demand_id}: {e}")
            context[skill_name] = {"error": str(e)}

    # ── 生成原型 ──
    try:
        logger.info(f"Generating prototype for demand #{demand_id}")
        proto_result = await generate_prototype(
            demand=demand,
            skill_outputs=context,
            memory=memory,
        )

        # Create Checkpoint 2 (prototype review)
        db = await get_db()
        try:
            run_id = None
            if checkpoint_id:
                cur = await db.execute(
                    "SELECT run_id FROM agent_checkpoints WHERE id=?", (checkpoint_id,)
                )
                cp_row = await cur.fetchone()
                if cp_row:
                    run_id = cp_row[0]

            proposal = json.dumps({
                "reasoning": f"I've completed research and generated a prototype for '{demand['title']}'. "
                             f"Skills run: {', '.join(PIPELINE_ORDER)}. "
                             f"Please review the prototype and provide feedback.",
                "prototype_id": proto_result.get("prototype_id"),
                "prototype_path": proto_result.get("html_path"),
                "skills_completed": list(context.keys()),
            }, ensure_ascii=False)

            await db.execute(
                """INSERT INTO agent_checkpoints (run_id, checkpoint_type, demand_id, proposal, status, urgency)
                   VALUES (?, 'prototype', ?, ?, 'pending', 'ask')""",
                (run_id, demand_id, proposal),
            )

            if proto_result.get("prototype_id"):
                cur = await db.execute("SELECT last_insert_rowid()")
                cp_id = (await cur.fetchone())[0]
                await db.execute(
                    "UPDATE prototypes SET checkpoint_id=? WHERE id=?",
                    (cp_id, proto_result["prototype_id"]),
                )

            await db.commit()
        finally:
            await db.close()

        logger.info(f"Pipeline complete for demand #{demand_id}, prototype checkpoint created")

    except Exception as e:
        logger.error(f"Prototype generation failed for demand #{demand_id}: {e}")
