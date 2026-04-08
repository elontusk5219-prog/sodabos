"""
认知循环核心编排器 — 飞轮改造版。

改造后的阶段：
Perception → State Modeling → Simulation (+ rule injection) → Quality Gate
→ Value Filter → Decision (+ rule injection) → Self-Review → Execution → Reflection
→ Rule Extraction → Rule Effectiveness Tracking

新增能力：
- 改造一：Agent 自审（Phase 5.5）
- 改造二：Few-shot 注入（历史正负样本 → prompt）
- 改造五：趋势累积（加速趋势信号）
- 改造七：认知飞轮（prevention rules 提炼 / 注入 / 追踪）
"""
import asyncio
import json
import uuid
import logging
from datetime import datetime

from agent.perception import detect_new_signals
from agent.state_builder import build_world_state
from agent.role_prompts import get_prompt
from ai.client import chat

logger = logging.getLogger("cognitive_loop")


def _parse_json(text: str):
    """从 AI 响应中提取 JSON。"""
    clean = text.strip()
    if clean.startswith("```"):
        clean = clean.split("\n", 1)[1].rsplit("```", 1)[0]
    return json.loads(clean)


# ── 改造二：Few-shot 上下文构建 ──────────────────────────────────────────────

async def build_few_shot_context(db, memory=None) -> str:
    """从历史需求 + 团队问答教训中提取上下文，作为 few-shot 注入 prompt。"""
    sections = []

    # ── 正例：stage 走到 validate+ 或被团队审批通过的 demand ──
    try:
        cur = await db.execute("""
            SELECT title, description, score_total, track,
                   COALESCE(insight_layer, 'conventional') as insight_layer
            FROM demands
            WHERE stage IN ('validate', 'pmf', 'business_model')
               OR id IN (
                   SELECT demand_id FROM agent_checkpoints
                   WHERE status = 'approved' AND demand_id IS NOT NULL
                   GROUP BY demand_id HAVING COUNT(*) >= 1
               )
            ORDER BY updated_at DESC LIMIT 5
        """)
        positives = [dict(r) for r in await cur.fetchall()]
        if positives:
            lines = []
            for p in positives:
                lines.append(
                    f"  ✅ [{p.get('track', 'A')}] {p['title']} "
                    f"(总分{p.get('score_total', 0)}, {p.get('insight_layer', '')})"
                    f"\n     {(p.get('description') or '')[:120]}"
                )
            sections.append("## 成功案例（团队验证通过）\n" + "\n".join(lines))
    except Exception as e:
        logger.debug(f"Few-shot positive examples failed: {e}")

    # ── 负例：dismissed 或 agent_verdict=auto_reject ──
    try:
        cur = await db.execute("""
            SELECT title, description, score_total,
                   COALESCE(agent_verdict, '') as agent_verdict
            FROM demands
            WHERE stage = 'dismissed' OR agent_verdict = 'auto_reject'
            ORDER BY updated_at DESC LIMIT 5
        """)
        negatives = [dict(r) for r in await cur.fetchall()]
        if negatives:
            lines = []
            for n in negatives:
                lines.append(
                    f"  ❌ {n['title']} (总分{n.get('score_total', 0)})"
                    f"\n     {(n.get('description') or '')[:120]}"
                )
            sections.append("## 失败案例（被团队否决，避免重复推荐类似方向）\n" + "\n".join(lines))
    except Exception as e:
        logger.debug(f"Few-shot negative examples failed: {e}")

    # ── 分歧案例（最有学习价值）──
    try:
        cur = await db.execute("""
            SELECT target_id, note, type FROM feedback
            WHERE type IN ('agent_overconfidence', 'agent_underconfidence')
            ORDER BY created_at DESC LIMIT 3
        """)
        divergences = [dict(r) for r in await cur.fetchall()]
        if divergences:
            lines = []
            for d in divergences:
                label = "Agent过度自信" if d["type"] == "agent_overconfidence" else "Agent信心不足"
                lines.append(f"  ⚠️ [{label}] {d.get('note', '')[:150]}")
            sections.append("## 分歧案例（Agent 与 PM 判断不一致，重点校准）\n" + "\n".join(lines))
    except Exception as e:
        logger.debug(f"Few-shot divergence cases failed: {e}")

    # 注入团队问答教训（认知循环闭合的关键）
    if memory:
        try:
            lessons = memory._local_store.get("learned_lessons", [])
            if lessons:
                recent = lessons[-15:]  # 最近 15 条教训
                lines = []
                for l in recent:
                    decision_label = "✅ 团队同意" if l.get("decision") == "approved" else "❌ 团队否决"
                    answer = l.get("answer", "")
                    answer_text = f" — 回复: {answer[:80]}" if answer and answer not in ("团队同意", "团队否决") else ""
                    lines.append(f"  {decision_label}: {l.get('question', '')[:120]}{answer_text}")
                sections.append(
                    "## 团队问答教训（这些是团队明确表态过的方向性结论，必须遵守）\n" + "\n".join(lines)
                )
        except Exception as e:
            logger.debug(f"Failed to inject learned lessons: {e}")

    if sections:
        return "\n\n# 历史参考（校准你的判断标准）\n\n" + "\n\n".join(sections)
    return ""


class CognitiveLoop:
    def __init__(self, db_getter, memory=None):
        self._get_db = db_getter
        self._memory = memory  # AgentMemory instance
        self._running = False
        self._current_run_id: str | None = None
        self._task: asyncio.Task | None = None
        self._cycle_lock: asyncio.Lock | None = None  # 防止并发循环

    # ── 生命周期 ─────────────────────────────────────────────────────────

    async def start(self):
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._loop())
        logger.info("Cognitive loop started")

    async def stop(self):
        self._running = False
        if self._task:
            self._task.cancel()
            self._task = None
        logger.info("Cognitive loop stopped")

    @property
    def running(self) -> bool:
        return self._running

    async def _get_config(self) -> dict:
        db = await self._get_db()
        try:
            cur = await db.execute("SELECT * FROM agent_config WHERE id=1")
            row = await cur.fetchone()
            return dict(row) if row else {"enabled": 0, "cycle_interval": 3600}
        finally:
            await db.close()

    async def _loop(self):
        # 启动后等 30 秒再开始第一轮
        await asyncio.sleep(30)
        while self._running:
            try:
                config = await self._get_config()
                if not config.get("enabled"):
                    await asyncio.sleep(60)
                    continue

                # 检查 pending checkpoints 数量，避免堆积
                db = await self._get_db()
                try:
                    cur = await db.execute(
                        "SELECT COUNT(*) FROM agent_checkpoints WHERE status='pending'"
                    )
                    pending = (await cur.fetchone())[0]
                finally:
                    await db.close()

                max_pending = config.get("max_pending_checkpoints", 5)
                if pending >= max_pending:
                    logger.info(f"Skipping cycle: {pending} pending checkpoints (max={max_pending})")
                    await asyncio.sleep(config.get("cycle_interval", 3600))
                    continue

                if self._cycle_lock is None:
                    self._cycle_lock = asyncio.Lock()
                async with self._cycle_lock:
                    await self._run_cycle(config)
                await asyncio.sleep(config.get("cycle_interval", 3600))

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Cognitive loop error: {e}", exc_info=True)
                await asyncio.sleep(300)

    # ── 单次认知循环 ─────────────────────────────────────────────────────

    async def _run_cycle(self, config: dict):
        run_id = str(uuid.uuid4())
        self._current_run_id = run_id
        reasoning_log = []

        db = await self._get_db()
        try:
            await db.execute(
                "INSERT INTO agent_runs (run_id, status, phase) VALUES (?, 'running', 'perception')",
                (run_id,),
            )
            await db.commit()
        finally:
            await db.close()

        try:
            # Phase 1: 感知（信号猎手）
            await self._update_phase(run_id, "perception")
            signals = await self._perceive(run_id)
            reasoning_log.append({
                "phase": "perception",
                "role": "信号猎手",
                "summary": f"检测到 {signals['new_items_count']} 条新数据, "
                           f"{len(signals['feedback_changes'])} 条反馈, "
                           f"{len(signals['trend_shifts'])} 个趋势变化",
            })

            # 持久化：signal_report
            await self._store_artifact(run_id, None, "signal_report", {
                "new_items_count": signals["new_items_count"],
                "feedback_count": len(signals["feedback_changes"]),
                "trend_shifts_count": len(signals["trend_shifts"]),
                "top_items": [{"id": i.get("id"), "title": i.get("title"), "platform": i.get("platform")}
                              for i in signals.get("new_items", [])[:10]],
            })

            if signals["new_items_count"] == 0 and not signals["new_demands"]:
                # No new signals — use idle time for "dreaming" (memory consolidation)
                reasoning_log.append({"phase": "idle", "summary": "无新信号，进入做梦模式（记忆整理）"})
                await self._update_phase(run_id, "dreaming")
                dream_results = await self._dream(run_id)
                reasoning_log.append({
                    "phase": "dreaming",
                    "summary": f"做梦完成: {json.dumps({k: v.get('status', '?') for k, v in dream_results.items()}, ensure_ascii=False)}",
                })
                await self._finish_run(run_id, reasoning_log, "completed")
                return

            # Phase 1.5: Pre-cycle questioning（信号猎手提问）
            questions = await self._check_for_questions(signals)
            if questions:
                reasoning_log.append({
                    "phase": "questioning",
                    "role": "信号猎手",
                    "summary": f"Agent 有 {len(questions)} 个问题想确认",
                })
                await self._create_question_checkpoints(run_id, questions)

            # Phase 2: 状态建模
            await self._update_phase(run_id, "state_modeling")
            world_state = await self._model_state(run_id, signals)
            reasoning_log.append({
                "phase": "state_modeling",
                "summary": f"建模完成: {len(world_state['top_demands'])} 个 top 需求, "
                           f"{len(world_state['trending_keywords'])} 个趋势关键词",
            })

            # Phase 3: 模拟（产品策略师）
            await self._update_phase(run_id, "simulation")
            simulations = await self._simulate(run_id, world_state, config)
            reasoning_log.append({
                "phase": "simulation",
                "role": "产品策略师",
                "summary": f"对 {len(simulations)} 个需求模拟了产品方向",
            })

            # Phase 3.5: 三层知识分类
            if simulations:
                await self._classify_insight_layers(run_id, world_state, simulations)
                reasoning_log.append({
                    "phase": "insight_classification",
                    "role": "洞察分类器",
                    "summary": "已完成三层知识分类",
                })

            # Phase 3.8: 质量门禁
            simulations, gate_passed = await self._quality_gate(run_id, simulations)
            if not gate_passed:
                reasoning_log.append({
                    "phase": "quality_gate",
                    "summary": "质量门禁触发：置信度过低，暂停本轮决策",
                })
                await self._finish_run(run_id, reasoning_log, "completed", world_state)
                return
            reasoning_log.append({
                "phase": "quality_gate",
                "summary": f"质量门禁通过，{len(simulations)} 个需求进入决策",
            })

            # Phase 3.9: 价值过滤（Google Trends + KD 验证）
            await self._update_phase(run_id, "value_filter")
            try:
                from ai.value_filter import run_value_filter
                validated_count = 0
                for sim in simulations:
                    did = sim.get("demand_id")
                    if did:
                        try:
                            vr = await run_value_filter(did)
                            verdict = vr.get("verdict", {})
                            if isinstance(verdict, dict) and verdict.get("verdict") == "建议放弃":
                                sim["_filtered_out"] = True
                            validated_count += 1
                        except Exception as e:
                            logger.warning(f"Value filter failed for demand {did}: {e}")
                simulations = [s for s in simulations if not s.get("_filtered_out")]
                reasoning_log.append({
                    "phase": "value_filter",
                    "summary": f"验证了 {validated_count} 个需求，{len(simulations)} 个通过价值过滤",
                })
            except Exception as e:
                logger.warning(f"Value filter phase skipped: {e}")
                reasoning_log.append({"phase": "value_filter", "summary": f"跳过: {e}"})

            # Phase 4: 决策（投资人评委 + 规则注入）
            await self._update_phase(run_id, "decision")
            decisions = await self._decide(run_id, world_state, simulations)
            reasoning_log.append({
                "phase": "decision",
                "role": "投资人评委",
                "summary": f"决策结果: {sum(1 for d in decisions if d['action']=='investigate')} 个建议调研, "
                           f"{sum(1 for d in decisions if d['action']=='skip')} 个跳过",
            })

            # 持久化：decision_rationale
            for dec in decisions:
                if dec.get("demand_id"):
                    await self._store_artifact(run_id, dec["demand_id"], "decision_rationale", dec)

            # Phase 5: 自审（改造一：Agent 对本轮新需求做自动评审）
            await self._update_phase(run_id, "self_review")
            review_result = await self._self_review(run_id)
            reasoning_log.append({
                "phase": "self_review",
                "role": "投资人评委(自审)",
                "summary": f"自审 {review_result['total']} 个新需求: "
                           f"{review_result['high']} high, {review_result['medium']} medium, "
                           f"{review_result['low']} low, {review_result['auto_reject']} auto_reject",
            })

            # Phase 5.5: 执行（三级分流，结合自审结果）
            await self._update_phase(run_id, "execution")
            exec_result = await self._execute(run_id, decisions, simulations)
            reasoning_log.append({
                "phase": "execution",
                "summary": f"创建 {exec_result['ask']} 个待审批, "
                           f"{exec_result['inform']} 个自动通过(通知), "
                           f"{exec_result['auto']} 个自动跳过",
            })

            # Phase 6: 反思 + 规则提炼 + 规则效果追踪 + 项目健康检查
            await self._update_phase(run_id, "reflection")
            await self._reflect(run_id, world_state)
            reasoning_log.append({
                "phase": "reflection",
                "role": "复盘分析师",
                "summary": "反思完成，已更新历史记录和预防规则",
            })

            # Phase 6.5: 项目健康检查（独立阶段记录）
            if world_state.get("active_projects"):
                reasoning_log.append({
                    "phase": "project_health",
                    "role": "项目管理专家",
                    "summary": f"监控 {len(world_state['active_projects'])} 个活跃项目, "
                               f"{len(world_state.get('stalled_projects', []))} 个停滞",
                })

            await self._finish_run(run_id, reasoning_log, "completed", world_state, decisions)

        except Exception as e:
            logger.error(f"Cycle {run_id} failed: {e}", exc_info=True)
            reasoning_log.append({"phase": "error", "summary": str(e)})
            await self._finish_run(run_id, reasoning_log, "failed", error=str(e))

    # ── Dreaming (idle-time memory consolidation) ────────────────────────

    async def _dream(self, run_id: str) -> dict:
        """Run dream cycle phases during idle: compress memories, extract methodologies,
        detect contradictions, and generate questions.

        This merges the dreaming system into the cognitive loop, avoiding duplicate
        rule/methodology extraction and question generation.
        """
        from agent.dreaming import compress_memories, extract_methodologies, detect_contradictions_and_questions

        results = {}

        # Phase D1: Memory compression
        try:
            results["compression"] = await compress_memories()
        except Exception as e:
            logger.error(f"Dream compression failed: {e}", exc_info=True)
            results["compression"] = {"status": "error", "error": str(e)}

        # Phase D2: Methodology extraction
        try:
            results["methodologies"] = await extract_methodologies()
        except Exception as e:
            logger.error(f"Dream methodology extraction failed: {e}", exc_info=True)
            results["methodologies"] = {"status": "error", "error": str(e)}

        # Phase D3: Contradiction detection + question generation
        try:
            q_result = await detect_contradictions_and_questions()
            results["questions"] = q_result

            # If new questions generated, also create question checkpoints
            # so they appear in the cognitive loop's existing question pipeline
            new_qs = q_result.get("questions", [])
            if new_qs:
                dream_questions = []
                for q in new_qs[:3]:
                    dream_questions.append({
                        "question": q.get("question", ""),
                        "context": f"[做梦-{q.get('type', 'insight')}] {q.get('context', '')}",
                        "priority": q.get("priority", "medium"),
                    })
                await self._create_question_checkpoints(run_id, dream_questions)
                logger.info(f"Dream created {len(dream_questions)} question checkpoints")
        except Exception as e:
            logger.error(f"Dream contradiction detection failed: {e}", exc_info=True)
            results["questions"] = {"status": "error", "error": str(e)}

        logger.info(f"🌙 Dream complete: {json.dumps({k: v.get('status', '?') if isinstance(v, dict) else '?' for k, v in results.items()}, ensure_ascii=False)}")
        return results

    # ── Phase 实现 ───────────────────────────────────────────────────────

    async def _perceive(self, run_id: str) -> dict:
        db = await self._get_db()
        try:
            cur = await db.execute(
                "SELECT completed_at FROM agent_runs WHERE status='completed' ORDER BY completed_at DESC LIMIT 1"
            )
            row = await cur.fetchone()
            since = row[0] if row else None
            return await detect_new_signals(db, since)
        finally:
            await db.close()

    async def _model_state(self, run_id: str, signals: dict) -> dict:
        db = await self._get_db()
        try:
            world_state = await build_world_state(db)
            world_state["current_signals"] = {
                "new_items_count": signals["new_items_count"],
                "trend_shifts": signals["trend_shifts"][:10],
                "recent_feedback": signals["feedback_changes"][:10],
            }
            return world_state
        finally:
            await db.close()

    async def _simulate(self, run_id: str, world_state: dict, config: dict) -> list[dict]:
        """对高分且未调研的需求模拟产品方向（产品策略师角色）。"""
        threshold = config.get("auto_investigate_threshold", 7.5)
        investigated = set(world_state.get("already_investigated", []))

        # 排除已有 simulation artifact 的需求
        db = await self._get_db()
        try:
            cur = await db.execute(
                "SELECT DISTINCT demand_id FROM agent_artifacts WHERE artifact_type='simulation' AND demand_id IS NOT NULL"
            )
            already_simulated = {r[0] for r in await cur.fetchall()}
        finally:
            await db.close()

        # Phase 6: 排除已关联项目的需求（避免重复处理）
        project_demand_ids = set(world_state.get("project_demand_ids", []))

        candidates = [
            d for d in world_state["top_demands"]
            if d["score_total"] >= threshold
            and d["id"] not in investigated
            and d["id"] not in already_simulated
            and d["id"] not in project_demand_ids
            and d["stage"] == "discovered"
        ][:5]

        if not candidates:
            return []

        # 构建用户偏好上下文
        prefs = world_state.get("user_preferences", {})
        pref_context = ""
        if prefs.get("liked_topics"):
            pref_context += f"用户关注的方向: {', '.join(prefs['liked_topics'][:10])}\n"
        if prefs.get("disliked_topics"):
            pref_context += f"用户不感兴趣的: {', '.join(prefs['disliked_topics'][:10])}\n"

        # 趋势上下文
        trend_context = ""
        if world_state.get("trending_keywords"):
            trends = [f"{t['keyword']}({t.get('change_percent', 0):+.0f}%)"
                      for t in world_state["trending_keywords"][:10]]
            trend_context = f"当前趋势: {', '.join(trends)}\n"

        # 加速趋势上下文（改造五：累积趋势注入仿真）
        accel_trends = world_state.get("accelerating_trends", [])
        if accel_trends:
            accel_lines = [
                f"  📈 {t['keyword']}（出现{t.get('appearances', 0)}次, 动量{t.get('momentum', 0):+.0f}%）"
                for t in accel_trends[:5]
            ]
            trend_context += "加速累积趋势（多次出现且持续上升，高价值信号）:\n" + "\n".join(accel_lines) + "\n"

        # 原始信号上下文（用于证据锚定）
        signal_items = world_state.get("recent_signals", [])
        signal_context = ""
        if signal_items:
            signal_lines = []
            for item in signal_items[:15]:
                line = f"[{item.get('platform', '?')}] ID:{item.get('id', '?')} | {item.get('title', '')}"
                signal_lines.append(line)
            signal_context = f"可引用的原始信号:\n" + "\n".join(signal_lines) + "\n"

        # 改造二：注入 few-shot 历史上下文 + 改造四：动态 prompt
        few_shot_ctx = ""
        db_fs = await self._get_db()
        try:
            few_shot_ctx = await build_few_shot_context(db_fs, memory=self._memory)
            _strategist_prompt = await get_prompt("product_strategist", db_fs)
        finally:
            await db_fs.close()

        simulations = []
        for demand in candidates:
            system_prompt = _strategist_prompt + f"\n\n{pref_context}{trend_context}{signal_context}"
            # 改造二：追加 few-shot 上下文
            if few_shot_ctx:
                system_prompt += few_shot_ctx
            # 改造七：注入匹配的预防规则
            system_prompt = await self._apply_rules_to_prompt(demand, system_prompt)

            user_prompt = f"""需求标题: {demand['title']}
描述: {demand.get('description', '')}
评分: 痛点={demand['score_pain']}, 竞争={demand['score_competition']}, 冷启动={demand['score_cold_start']}, AI机会={demand['score_ai_opportunity']}
分析: {(demand.get('ai_analysis') or '')[:500]}"""

            result = await chat(system_prompt, user_prompt, temperature=0.7)

            try:
                approaches = _parse_json(result)
            except (json.JSONDecodeError, IndexError):
                approaches = [{"direction": "解析失败", "raw": result[:300], "confidence": 0}]

            # 确保每个 approach 都有 confidence 和 evidence
            for approach in approaches:
                if "confidence" not in approach:
                    approach["confidence"] = 0.5
                if "evidence" not in approach:
                    approach["evidence"] = []

            sim_entry = {
                "demand_id": demand["id"],
                "demand_title": demand["title"],
                "score_total": demand["score_total"],
                "approaches": approaches,
            }
            simulations.append(sim_entry)

            # 持久化：simulation artifact
            await self._store_artifact(run_id, demand["id"], "simulation", sim_entry)

        return simulations

    async def _classify_insight_layers(self, run_id: str, world_state: dict, simulations: list):
        """三层知识分类：conventional / trending / first_principles。"""
        demand_ids = [s["demand_id"] for s in simulations]
        if not demand_ids:
            return

        # 收集分类所需的上下文
        trend_keywords = [t["keyword"] for t in world_state.get("trending_keywords", [])
                          if abs(t.get("change_percent", 0)) > 50]

        demands_info = []
        for sim in simulations:
            # 检查跨平台证据
            platforms_with_evidence = set()
            for approach in sim.get("approaches", []):
                for ev in approach.get("evidence", []):
                    platforms_with_evidence.add(ev.get("source", ""))

            demands_info.append({
                "demand_id": sim["demand_id"],
                "title": sim["demand_title"],
                "score_total": sim["score_total"],
                "platforms_with_evidence": list(platforms_with_evidence),
                "has_trending_keyword": any(kw in sim["demand_title"] for kw in trend_keywords),
            })

        db_cls = await self._get_db()
        try:
            system_prompt = await get_prompt("insight_classifier", db_cls)
        finally:
            await db_cls.close()
        user_prompt = f"""需求列表:
{json.dumps(demands_info, ensure_ascii=False, indent=2)}

当前趋势关键词 (涨幅>50%): {trend_keywords[:10]}"""

        result = await chat(system_prompt, user_prompt, temperature=0.2)

        try:
            classifications = _parse_json(result)
        except (json.JSONDecodeError, IndexError):
            classifications = []

        # 写入 demands 表
        db = await self._get_db()
        try:
            for cls in classifications:
                demand_id = cls.get("demand_id")
                layer = cls.get("insight_layer", "conventional")
                if layer not in ("conventional", "trending", "first_principles"):
                    layer = "conventional"

                await db.execute(
                    "UPDATE demands SET insight_layer=? WHERE id=?",
                    (layer, demand_id),
                )

                # 加权：first_principles × 1.3, trending × 1.1
                if layer == "first_principles":
                    await db.execute(
                        "UPDATE demands SET score_total = ROUND(score_total * 1.3, 1) WHERE id=? AND insight_layer != 'first_principles'",
                        (demand_id,),
                    )
                elif layer == "trending":
                    await db.execute(
                        "UPDATE demands SET score_total = ROUND(score_total * 1.1, 1) WHERE id=? AND insight_layer != 'trending'",
                        (demand_id,),
                    )

            await db.commit()
            logger.info(f"Classified {len(classifications)} demands into insight layers")
        finally:
            await db.close()

    async def _quality_gate(self, run_id: str, simulations: list) -> tuple[list, bool]:
        """质量门禁：评估仿真结果质量，必要时暂停循环。"""
        if not simulations:
            return simulations, True

        # 计算平均置信度
        confidences = []
        for sim in simulations:
            for approach in sim.get("approaches", []):
                confidences.append(approach.get("confidence", 0.5))

        avg_confidence = sum(confidences) / len(confidences) if confidences else 0

        # 连续低置信度检测 → 暂停循环，生成 question checkpoint
        if avg_confidence < 0.4:
            await self._create_question_checkpoints(run_id, [{
                "question": f"最近 {len(simulations)} 个需求的仿真置信度偏低（{avg_confidence:.0%}），"
                            f"是否需要调整监控关键词或平台权重？",
                "context": "质量门禁触发：平均置信度低于 40%",
            }])
            logger.warning(f"Quality gate triggered: avg_confidence={avg_confidence:.2f}")
            return [], False

        # 过滤低置信度方向（保留 confidence >= 0.3 的）
        filtered = []
        for sim in simulations:
            good_approaches = [a for a in sim.get("approaches", [])
                               if a.get("confidence", 0.5) >= 0.3]
            if good_approaches:
                sim["approaches"] = good_approaches
                filtered.append(sim)

        return filtered, True

    async def _decide(self, run_id: str, world_state: dict, simulations: list) -> list[dict]:
        """决定哪些需求值得调研（投资人评委角色 + 改造二/七增强）。"""
        if not simulations:
            return []

        prefs = world_state.get("user_preferences", {})

        # 改造四：动态 prompt + 改造二：注入 few-shot 上下文
        db = await self._get_db()
        try:
            system_prompt = await get_prompt("investor_judge", db)
            few_shot_ctx = await build_few_shot_context(db, memory=self._memory)
            if few_shot_ctx:
                system_prompt += few_shot_ctx
        finally:
            await db.close()

        # 改造七：注入全局高置信度规则摘要（决策层面）
        db = await self._get_db()
        try:
            cur = await db.execute(
                "SELECT rule_id, pattern, action, action_params, confidence, success_rate "
                "FROM prevention_rules WHERE status = 'active' AND confidence >= 0.6 "
                "ORDER BY success_rate DESC LIMIT 10"
            )
            active_rules = [dict(r) for r in await cur.fetchall()]
            if active_rules:
                rules_text = "\n\n# 预防规则（历史教训，请在决策时遵守）\n"
                for rule in active_rules:
                    rules_text += (
                        f"\n- [{rule['rule_id']}] {rule['pattern']}"
                        f" → {rule['action']}({rule.get('action_params', '{}')})"
                        f" [置信度{rule['confidence']:.0%}]"
                    )
                system_prompt += rules_text
        except Exception:
            pass  # prevention_rules table might not exist yet
        finally:
            await db.close()

        # 注入做梦提炼的方法论（与预防规则互补：一个防错，一个指导）
        try:
            from agent.dreaming import get_methodologies
            meths = get_methodologies()
            if meths:
                meth_text = "\n\n# 经验方法论（从历史记忆中提炼，辅助决策判断）\n"
                for m in meths[:8]:
                    meth_text += f"\n- **{m['title']}**: {m['content'][:150]}"
                    if m.get("applies_to"):
                        meth_text += f" (适用: {m['applies_to']})"
                system_prompt += meth_text
        except Exception:
            pass  # dreaming may not have run yet

        # Phase 6: 项目上下文注入决策
        project_context = ""
        project_demand_ids = world_state.get("project_demand_ids", [])
        active_projects = world_state.get("active_projects", [])
        if active_projects:
            project_context = (
                f"\n\n当前有 {len(active_projects)} 个活跃项目，"
                f"其中 {len(world_state.get('stalled_projects', []))} 个停滞。"
                f"已关联项目的需求ID: {project_demand_ids}"
            )

        user_prompt = f"""候选需求模拟结果:
{json.dumps(simulations, ensure_ascii=False, indent=2)}

用户偏好:
- 关注方向: {prefs.get('liked_topics', [])}
- 不感兴趣: {prefs.get('disliked_topics', [])}
- 认可的需求: {[d.get('title') for d in prefs.get('liked_demands', [])]}
- 否决的需求: {[d.get('title') for d in prefs.get('disliked_demands', [])]}"""
        if project_context:
            user_prompt += project_context

        result = await chat(system_prompt, user_prompt, temperature=0.3)

        try:
            decisions = _parse_json(result)
        except (json.JSONDecodeError, IndexError):
            # AI 调用失败时不应自动推荐 investigate，而是跳过本轮
            logger.warning(f"Decision AI parse failed, skipping all {len(simulations)} simulations. Raw: {result[:200]}")
            decisions = [
                {"demand_id": s["demand_id"], "action": "skip",
                 "reasoning": "AI 决策解析失败，跳过本轮", "rejection_reason": "解析失败",
                 "priority": 5, "avg_confidence": 0}
                for s in simulations
            ]

        # 确保每个 decision 有 demand_id 和 avg_confidence
        for i, d in enumerate(decisions):
            if "demand_id" not in d and i < len(simulations):
                d["demand_id"] = simulations[i]["demand_id"]
                d["demand_title"] = simulations[i]["demand_title"]
            if "avg_confidence" not in d and i < len(simulations):
                approaches = simulations[i].get("approaches", [])
                confs = [a.get("confidence", 0.5) for a in approaches]
                d["avg_confidence"] = sum(confs) / len(confs) if confs else 0.5
            if "demand_title" not in d and i < len(simulations):
                d["demand_title"] = simulations[i].get("demand_title", "")

        return decisions

    async def _execute(self, run_id: str, decisions: list[dict], simulations: list[dict] = None) -> dict:
        """三级分流执行：auto / inform / ask。"""
        db = await self._get_db()
        result = {"auto": 0, "inform": 0, "ask": 0}

        # 建立 simulation 查找表
        sim_map = {}
        if simulations:
            for s in simulations:
                sim_map[s["demand_id"]] = s

        try:
            for decision in decisions:
                if decision.get("action") != "investigate":
                    result["auto"] += 1
                    continue

                demand_id = decision.get("demand_id")
                if not demand_id:
                    continue

                # 检查是否已有 pending checkpoint
                cur = await db.execute(
                    "SELECT id FROM agent_checkpoints WHERE demand_id=? AND status='pending' AND checkpoint_type='investigate'",
                    (demand_id,),
                )
                if await cur.fetchone():
                    continue

                # 获取需求分数和置信度
                cur = await db.execute("SELECT score_total FROM demands WHERE id=?", (demand_id,))
                demand_row = await cur.fetchone()
                score_total = demand_row[0] if demand_row else 0

                avg_confidence = decision.get("avg_confidence", 0.5)

                # ── 三级分流逻辑 ──
                if score_total < 5:
                    # AUTO: 低分需求直接跳过，不创建 checkpoint
                    result["auto"] += 1
                    continue
                elif score_total < 7.5 or avg_confidence < 0.7:
                    # INFORM: 中等需求自动通过，创建记录供查看
                    urgency = "inform"
                    status = "auto_approved"
                    result["inform"] += 1
                else:
                    # ASK: 高分高置信度需求等待审批
                    urgency = "ask"
                    status = "pending"
                    result["ask"] += 1

                proposal = json.dumps({
                    "reasoning": decision.get("reasoning", ""),
                    "rejection_reason": decision.get("rejection_reason", ""),
                    "priority": decision.get("priority", 3),
                    "recommended_approach": decision.get("recommended_approach", ""),
                    "demand_title": decision.get("demand_title", ""),
                    "avg_confidence": avg_confidence,
                }, ensure_ascii=False)

                # 改造六：智能推荐审批人
                suggested_reviewer = None
                if urgency == "ask" and self._memory:
                    try:
                        demand_obj = {
                            "title": decision.get("demand_title", ""),
                            "track": sim_map.get(demand_id, {}).get("track", "A"),
                        }
                        suggested_reviewer = await self._memory.suggest_reviewer(demand_obj)
                    except Exception as e:
                        logger.debug(f"Reviewer suggestion failed: {e}")

                await db.execute(
                    """INSERT INTO agent_checkpoints (run_id, checkpoint_type, demand_id, proposal, status, urgency, suggested_reviewer)
                       VALUES (?, 'investigate', ?, ?, ?, ?, ?)""",
                    (run_id, demand_id, proposal, status, urgency, suggested_reviewer),
                )

                # INFORM 级别：自动触发 skill pipeline
                if urgency == "inform":
                    try:
                        from agent.skill_pipeline import run_pipeline
                        asyncio.create_task(run_pipeline(
                            demand_id=demand_id,
                            memory=self._memory,
                        ))
                    except Exception as e:
                        logger.warning(f"Auto-pipeline for demand {demand_id} failed: {e}")

            await db.commit()
            return result
        finally:
            await db.close()

    async def _reflect(self, run_id: str, world_state: dict = None):
        """反思：检查已解决的检查点，记录学习，提炼预防规则（改造七）。

        关键改进：question checkpoint 的问答内容会被提炼为 learned_lessons，
        注入后续 _decide 和 _simulate 的 prompt，真正闭合认知循环。
        """
        db = await self._get_db()
        try:
            cur = await db.execute(
                """SELECT id, demand_id, checkpoint_type, status, user_feedback, proposal
                   FROM agent_checkpoints
                   WHERE status IN ('approved', 'rejected', 'auto_approved')
                   AND resolved_at > COALESCE(
                       (SELECT completed_at FROM agent_runs WHERE status='completed'
                        ORDER BY completed_at DESC LIMIT 1 OFFSET 1),
                       '2000-01-01'
                   )"""
            )
            resolved = [dict(r) for r in await cur.fetchall()]

            if self._memory and resolved:
                for cp in resolved:
                    await self._memory.store_decision(
                        checkpoint_id=cp["id"],
                        demand_id=cp["demand_id"],
                        approved=cp["status"] in ("approved", "auto_approved"),
                        feedback=cp.get("user_feedback", ""),
                    )

                    # 关键：把 question checkpoint 的问答提炼为教训
                    if cp["checkpoint_type"] == "question" and cp.get("proposal"):
                        try:
                            proposal = json.loads(cp["proposal"]) if isinstance(cp["proposal"], str) else cp["proposal"]
                            question = proposal.get("question", "")
                            answer = cp.get("user_feedback", "") or ("团队同意" if cp["status"] == "approved" else "团队否决")
                            lesson = {
                                "question": question,
                                "answer": answer,
                                "decision": cp["status"],
                                "timestamp": datetime.utcnow().isoformat(),
                            }
                            lessons = self._memory._local_store.setdefault("learned_lessons", [])
                            lessons.append(lesson)
                            # Keep last 100 lessons
                            if len(lessons) > 100:
                                self._memory._local_store["learned_lessons"] = lessons[-100:]
                            self._memory._save_local()
                            logger.info(f"Learned lesson from question #{cp['id']}: {question[:60]}...")
                        except (json.JSONDecodeError, TypeError):
                            pass

            logger.info(f"Reflection: processed {len(resolved)} resolved checkpoints")
        finally:
            await db.close()

        # 改造七：规则效果追踪 → 规则提炼
        if resolved:
            await self._update_rule_effectiveness(resolved)
            await self._extract_prevention_rules(resolved)

        # Run proactive anomaly detection（含 Phase 6 项目健康检查）
        await self._proactive_check(run_id, world_state or {})

    # ── 中间产物持久化 ───────────────────────────────────────────────────

    async def _store_artifact(self, run_id: str, demand_id: int | None,
                              artifact_type: str, content: dict):
        """存储中间产物到 agent_artifacts 表。"""
        db = await self._get_db()
        try:
            await db.execute(
                """INSERT INTO agent_artifacts (run_id, demand_id, artifact_type, content)
                   VALUES (?, ?, ?, ?)""",
                (run_id, demand_id, artifact_type,
                 json.dumps(content, ensure_ascii=False)),
            )
            await db.commit()
        except Exception as e:
            logger.warning(f"Failed to store artifact {artifact_type}: {e}")
        finally:
            await db.close()

    # ── Phase 6: 项目健康检查 ────────────────────────────────────────────

    async def _check_project_health(self, run_id: str, db, world_state: dict):
        """Phase 6: 项目健康监控与推进建议。"""
        active_projects = world_state.get("active_projects", [])
        stalled_projects = world_state.get("stalled_projects", [])

        if not active_projects:
            return

        # 构建项目上下文给 AI 分析
        project_summary = json.dumps({
            "active_projects": active_projects,
            "stalled_projects": stalled_projects,
        }, ensure_ascii=False, default=str)

        prompt = f"""当前项目状态：
{project_summary}

请分析项目健康度并给出建议。"""

        db_ps = await self._get_db()
        try:
            _proj_prompt = await get_prompt("project_strategist", db_ps)
        finally:
            await db_ps.close()
        result = await chat(_proj_prompt, prompt, temperature=0.3)

        try:
            recommendations = _parse_json(result)
        except (json.JSONDecodeError, IndexError):
            logger.warning("Project health check returned non-JSON")
            return

        # 1. 记录停滞项目警告
        for diag in recommendations.get("stalled_diagnosis", []):
            pid = diag.get("project_id")
            if pid:
                await db.execute(
                    """INSERT INTO activity_log (project_id, action, target_type, detail, created_at)
                       VALUES (?, 'agent_warning', 'project', ?, datetime('now'))""",
                    (pid, json.dumps({"type": "stalled", "reason": diag.get("reason", ""), "action": diag.get("action", "")}, ensure_ascii=False))
                )

        # 2. 建议推进的项目
        for adv in recommendations.get("ready_to_advance", []):
            pid = adv.get("project_id")
            if pid:
                await db.execute(
                    """INSERT INTO activity_log (project_id, action, target_type, detail, created_at)
                       VALUES (?, 'agent_suggestion', 'project', ?, datetime('now'))""",
                    (pid, json.dumps({"type": "ready_to_advance", "next_stage": adv.get("next_stage", ""), "reason": adv.get("reason", "")}, ensure_ascii=False))
                )

        if stalled_projects or recommendations.get("ready_to_advance"):
            await db.commit()

        logger.info("Project health check: %d stalled, %d ready to advance",
                    len(recommendations.get("stalled_diagnosis", [])),
                    len(recommendations.get("ready_to_advance", [])))

    # ── 主动行为：异常检测 + 推送问题 ────────────────────────────────────

    async def _proactive_check(self, run_id: str, world_state: dict):
        """检测异常情况并主动向团队提问。"""
        db = await self._get_db()
        try:
            questions = []

            # 1. 数据质量下降检测
            cur = await db.execute(
                "SELECT COUNT(*) as c FROM raw_items WHERE date(created_at) = date('now')"
            )
            today_items = (await cur.fetchone())["c"]
            cur = await db.execute(
                "SELECT COUNT(*) as c FROM raw_items WHERE date(created_at) = date('now', '-1 day')"
            )
            yesterday_items = (await cur.fetchone())["c"]
            if yesterday_items > 0 and today_items < yesterday_items * 0.3:
                questions.append({
                    "question": f"数据采集量异常下降：今日 {today_items} 条 vs 昨日 {yesterday_items} 条。是否需要检查数据源配置？",
                    "context": "数据质量监控",
                })

            # 2. 需求池长时间无更新
            cur = await db.execute(
                "SELECT MAX(created_at) as latest FROM demands"
            )
            row = await cur.fetchone()
            if row and row["latest"]:
                from datetime import datetime, timedelta
                try:
                    latest = datetime.fromisoformat(str(row["latest"]).replace("Z", "+00:00").replace(" ", "T"))
                    if datetime.now(latest.tzinfo) - latest > timedelta(days=2):
                        questions.append({
                            "question": f"需求池已 {(datetime.now(latest.tzinfo) - latest).days} 天没有新需求了。是否需要触发一轮新的采集和分析？",
                            "context": "需求池健康检查",
                        })
                except (ValueError, TypeError):
                    pass

            # 3. 高分需求无人关注
            cur = await db.execute(
                """SELECT id, title, score_total FROM demands
                   WHERE score_total >= 80 AND stage = 'discovered'
                   AND id NOT IN (SELECT demand_id FROM agent_checkpoints WHERE demand_id IS NOT NULL)
                   AND id NOT IN (SELECT COALESCE(demand_id, 0) FROM projects)
                   ORDER BY score_total DESC LIMIT 3"""
            )
            high_score = [dict(r) for r in await cur.fetchall()]
            if high_score:
                names = ", ".join([f"「{d['title']}」({d['score_total']}分)" for d in high_score])
                questions.append({
                    "question": f"发现 {len(high_score)} 个高分需求尚未被关注: {names}。要不要深入调研？",
                    "context": "高分需求提醒",
                })

            # 4. 项目停滞检测
            cur = await db.execute(
                """SELECT id, title, current_stage, updated_at FROM projects
                   WHERE status='active'
                   AND updated_at < datetime('now', '-3 days')
                   LIMIT 3"""
            )
            stale_projects = [dict(r) for r in await cur.fetchall()]
            if stale_projects:
                names = ", ".join([f"「{p['title']}」" for p in stale_projects])
                questions.append({
                    "question": f"{len(stale_projects)} 个项目超过 3 天没有更新: {names}。需要推进吗？",
                    "context": "项目停滞提醒",
                })

            # 5. 被大量否决的方向检测
            if self._memory:
                try:
                    prefs = await self._memory.query_preferences("")
                    disliked = prefs.get("disliked_topics", {})
                    hot_dislike = [k for k, v in disliked.items() if v >= 3]
                    if hot_dislike:
                        questions.append({
                            "question": f"团队多次否决了以下方向: {', '.join(hot_dislike[:5])}。是否要把这些加入全局过滤词，避免再次抓取？",
                            "context": "方向偏好学习",
                        })
                except Exception:
                    pass

            # Insert questions as checkpoints (with dedup)
            recent_questions = await self._get_recent_questions(db, days=30)

            # Check pending count
            cur = await db.execute(
                "SELECT COUNT(*) as c FROM agent_checkpoints WHERE checkpoint_type='question' AND status='pending'"
            )
            pending = (await cur.fetchone())["c"]
            if pending >= 5:
                logger.info(f"Skipping proactive questions: {pending} already pending")
                return

            created = 0
            for q in questions[:3]:
                q_text = q.get("question", "")
                if self._is_duplicate_question(q_text, recent_questions):
                    continue

                await db.execute(
                    """INSERT INTO agent_checkpoints
                       (run_id, demand_id, checkpoint_type, proposal, status)
                       VALUES (?, NULL, 'question', ?, 'pending')""",
                    (run_id, json.dumps(q, ensure_ascii=False)),
                )
                recent_questions.append(q_text)
                created += 1

            await db.commit()
            if created:
                logger.info(f"Proactive check: created {created} questions ({len(questions) - created} deduped)")
            logger.info(f"Proactive check: generated {len(questions)} questions")

            # Phase 6: 项目健康检查（在主动检测中集成）
            if world_state.get("active_projects"):
                try:
                    await self._check_project_health(run_id, db, world_state)
                except Exception as e:
                    logger.warning(f"Project health check failed: {e}")
        except Exception as e:
            logger.error(f"Proactive check failed: {e}")
        finally:
            await db.close()

    # ── 工具方法 ─────────────────────────────────────────────────────────

    async def _update_phase(self, run_id: str, phase: str):
        db = await self._get_db()
        try:
            await db.execute(
                "UPDATE agent_runs SET phase=? WHERE run_id=?", (phase, run_id)
            )
            await db.commit()
        finally:
            await db.close()

    async def _finish_run(self, run_id: str, reasoning_log: list, status: str,
                          world_state: dict = None, decisions: list = None,
                          error: str = None):
        db = await self._get_db()
        try:
            await db.execute(
                """UPDATE agent_runs
                   SET status=?, reasoning_log=?, world_state=?, decisions=?,
                       completed_at=CURRENT_TIMESTAMP, error=?
                   WHERE run_id=?""",
                (
                    status,
                    json.dumps(reasoning_log, ensure_ascii=False),
                    json.dumps(world_state or {}, ensure_ascii=False),
                    json.dumps(decisions or [], ensure_ascii=False),
                    error,
                    run_id,
                ),
            )
            await db.commit()
        finally:
            await db.close()

    # ── 提问机制 ─────────────────────────────────────────────────────────

    async def _get_recent_questions(self, db, days: int = 30) -> list[str]:
        """获取最近 N 天所有 checkpoint 问题文本（用于去重）。"""
        cur = await db.execute(
            f"""SELECT proposal FROM agent_checkpoints
                WHERE checkpoint_type = 'question'
                AND created_at > datetime('now', '-{days} days')
                ORDER BY created_at DESC LIMIT 50"""
        )
        texts = []
        for r in await cur.fetchall():
            try:
                p = json.loads(r[0]) if isinstance(r[0], str) else r[0]
                texts.append(p.get("question", ""))
            except (json.JSONDecodeError, TypeError):
                texts.append(str(r[0])[:200])
        return texts

    def _is_duplicate_question(self, new_q: str, existing: list[str], threshold: float = 0.5) -> bool:
        """简单关键词重叠去重：如果新问题和已有问题的关键词重叠超过阈值，视为重复。"""
        if not new_q or not existing:
            return False
        import re
        # 提取中文词 + 英文词（简单分词）
        def extract_keywords(text: str) -> set:
            # 去掉标点，按空格和中文字符分割
            words = set(re.findall(r'[\u4e00-\u9fff]{2,}|[a-zA-Z]{3,}', text.lower()))
            # 去掉太常见的词
            stopwords = {'是否', '需要', '是否需要', '团队', '关于', '目前', '已经', '还是',
                         '什么', '哪些', '如何', '我们', '可以', '这个', '那个', '一个',
                         '否决', '需求', '方向', '工具', '产品', '用户', '分析'}
            return words - stopwords

        new_kw = extract_keywords(new_q)
        if not new_kw:
            return False

        for eq in existing:
            eq_kw = extract_keywords(eq)
            if not eq_kw:
                continue
            overlap = len(new_kw & eq_kw) / min(len(new_kw), len(eq_kw))
            if overlap >= threshold:
                logger.info(f"Duplicate question detected (overlap={overlap:.0%}): {new_q[:60]}...")
                return True
        return False

    async def _check_for_questions(self, signals: dict) -> list[dict]:
        """信号猎手角色：分析反馈模式并提问（注入历史避免重复）。"""
        db = await self._get_db()
        try:
            cur = await db.execute(
                """SELECT f.note, d.title, d.track
                   FROM feedback f
                   LEFT JOIN demands d ON CAST(f.target_id AS INTEGER) = d.id
                   WHERE f.type = 'demand_dismiss'
                   AND f.created_at > datetime('now', '-7 days')
                   ORDER BY f.created_at DESC LIMIT 20"""
            )
            dismissals = [dict(r) for r in await cur.fetchall()]

            if not dismissals:
                return []

            # 获取历史问题，注入 prompt 避免 AI 生成重复问题
            recent_questions = await self._get_recent_questions(db)
            history_block = ""
            if recent_questions:
                history_block = "\n\n⚠️ 以下问题已经问过或被处理过，请勿重复提问:\n" + "\n".join(
                    f"  - {q[:120]}" for q in recent_questions[:15]
                )

            db_sh = await self._get_db()
            try:
                system_prompt = await get_prompt("signal_hunter", db_sh)
            finally:
                await db_sh.close()

            user_prompt = f"""最近被否决的需求:
{json.dumps(dismissals, ensure_ascii=False, indent=2)}

新抓取的信号数量: {signals['new_items_count']}
趋势变化: {json.dumps(signals['trend_shifts'][:5], ensure_ascii=False)}{history_block}"""

            result = await chat(system_prompt, user_prompt, temperature=0.3)

            try:
                questions = _parse_json(result)
                return questions if isinstance(questions, list) else []
            except (json.JSONDecodeError, IndexError):
                return []
        except Exception as e:
            logger.warning(f"Question generation failed: {e}")
            return []
        finally:
            await db.close()

    async def _create_question_checkpoints(self, run_id: str, questions: list[dict]):
        """Create question-type checkpoints, skipping duplicates of recent questions."""
        db = await self._get_db()
        try:
            # Get all recent questions (pending + resolved) for dedup
            recent_questions = await self._get_recent_questions(db, days=30)

            created = 0
            for q in questions[:2]:
                question_text = q.get("question", "")
                if not question_text:
                    continue

                # Skip if duplicate of any recent question
                if self._is_duplicate_question(question_text, recent_questions):
                    continue

                proposal = json.dumps({
                    "question": question_text,
                    "context": q.get("context", ""),
                }, ensure_ascii=False)

                await db.execute(
                    """INSERT INTO agent_checkpoints (run_id, checkpoint_type, demand_id, proposal, status, urgency)
                       VALUES (?, 'question', NULL, ?, 'pending', 'ask')""",
                    (run_id, proposal),
                )
                # Add to recent list so subsequent questions in this batch also dedup
                recent_questions.append(question_text)
                created += 1

            await db.commit()
            if created:
                logger.info(f"Created {created} question checkpoints ({len(questions) - created} duplicates skipped)")
            else:
                logger.info(f"All {len(questions)} questions were duplicates, none created")
        finally:
            await db.close()

    # ── 改造一：Agent 自审 ─────────────────────────────────────────────

    async def _self_review(self, run_id: str) -> dict:
        """Phase 5.5: 对本轮新生成的 demands 逐一自审，输出 verdict + 溯源归因。"""
        result = {"total": 0, "high": 0, "medium": 0, "low": 0, "auto_reject": 0}
        db = await self._get_db()
        try:
            # 查询本轮新生成的 demands（未被自审过的）
            cur = await db.execute("""
                SELECT id, title, description, ai_analysis, source_items,
                       score_pain, score_competition, score_cold_start,
                       score_ai_opportunity, score_total, track
                FROM demands
                WHERE agent_verdict IS NULL
                  AND stage = 'discovered'
                ORDER BY created_at DESC LIMIT 20
            """)
            new_demands = [dict(r) for r in await cur.fetchall()]
        finally:
            await db.close()

        if not new_demands:
            return result

        result["total"] = len(new_demands)

        # 构建自审 prompt（复用 investor_judge + 溯源归因要求 + 改造四动态补丁）
        db_sr = await self._get_db()
        try:
            _judge_prompt = await get_prompt("investor_judge", db_sr)
        finally:
            await db_sr.close()
        system_prompt = _judge_prompt + """

## 额外输出要求（溯源归因）
对每个需求，还需输出：
- agent_verdict: "high_confidence" / "medium" / "low" / "auto_reject"
- confidence_score: 0.0-1.0
- source_attribution: 哪些平台/数据源贡献了关键信号

输出格式改为：
[{
  "demand_id": 数字,
  "agent_verdict": "high_confidence/medium/low/auto_reject",
  "confidence_score": 0.0-1.0,
  "reject_reason": "即使推荐也要说的风险点",
  "source_attribution": {"platform": {"signal_strength": "high/medium/low"}}
}]"""

        # 改造二：注入 few-shot
        db = await self._get_db()
        try:
            few_shot = await build_few_shot_context(db, memory=self._memory)
            if few_shot:
                system_prompt += few_shot
        finally:
            await db.close()

        demands_text = json.dumps(
            [{"id": d["id"], "title": d["title"],
              "description": (d.get("description") or "")[:300],
              "score_total": d.get("score_total", 0),
              "track": d.get("track", "A")}
             for d in new_demands],
            ensure_ascii=False, indent=2,
        )

        user_prompt = f"请对以下 {len(new_demands)} 个新需求进行自审：\n\n{demands_text}"

        resp = await chat(system_prompt, user_prompt, temperature=0.3)
        try:
            verdicts = _parse_json(resp)
        except (json.JSONDecodeError, IndexError):
            verdicts = []

        # 写入 demands 表
        db = await self._get_db()
        try:
            for v in verdicts:
                demand_id = v.get("demand_id")
                verdict = v.get("agent_verdict", "medium")
                if verdict not in ("high_confidence", "medium", "low", "auto_reject"):
                    verdict = "medium"

                result[verdict.replace("_confidence", "")] = result.get(
                    verdict.replace("_confidence", ""), 0
                ) + 1

                await db.execute(
                    "UPDATE demands SET agent_verdict=?, agent_review_at=CURRENT_TIMESTAMP WHERE id=?",
                    (verdict, demand_id),
                )

                # auto_reject: 记录拒绝原因到 memory
                if verdict == "auto_reject" and self._memory:
                    reject_reason = v.get("reject_reason", "")
                    await self._memory.store_feedback(
                        feedback_type="demand",
                        target=str(demand_id),
                        vote=-1,
                        context={"reason": reject_reason, "source": "agent_self_review"},
                    )

                # 持久化：self_review artifact（含溯源归因）
                await self._store_artifact(run_id, demand_id, "self_review", v)

            await db.commit()
            # 重新统计
            result["high"] = sum(1 for v in verdicts if v.get("agent_verdict") == "high_confidence")
            result["medium"] = sum(1 for v in verdicts if v.get("agent_verdict") == "medium")
            result["low"] = sum(1 for v in verdicts if v.get("agent_verdict") == "low")
            result["auto_reject"] = sum(1 for v in verdicts if v.get("agent_verdict") == "auto_reject")
            logger.info(f"Self-review: {result}")
        finally:
            await db.close()

        return result

    # ── 改造七：Prevention Rules — 匹配 + 注入 ────────────────────────

    async def _match_prevention_rules(self, demand: dict) -> list[dict]:
        """查询与当前需求匹配的 active prevention rules。"""
        db = await self._get_db()
        try:
            cur = await db.execute(
                "SELECT * FROM prevention_rules WHERE status = 'active' AND confidence >= 0.4"
            )
            all_rules = [dict(r) for r in await cur.fetchall()]
        except Exception:
            return []
        finally:
            await db.close()

        matched = []
        demand_text = f"{demand.get('title', '')} {demand.get('description', '')}".lower()

        for rule in all_rules:
            try:
                keywords = json.loads(rule.get("pattern_keywords", "[]"))
            except (json.JSONDecodeError, TypeError):
                keywords = []
            if keywords:
                hits = sum(1 for kw in keywords if kw.lower() in demand_text)
                if hits >= max(1, len(keywords) // 2):
                    matched.append(rule)

        return matched

    async def _apply_rules_to_prompt(self, demand: dict, base_prompt: str) -> str:
        """将匹配的预防规则注入到 system prompt 中（改造七）。"""
        matched = await self._match_prevention_rules(demand)
        if not matched:
            return base_prompt

        rules_section = "\n\n# 历史教训规则（基于过去的错误决策，请严格遵守）\n"
        for rule in matched:
            params = rule.get("action_params", "{}")
            rules_section += f"\n- [{rule['rule_id']}] {rule['pattern']}"
            rules_section += f"\n  → 动作: {rule['action']}({params})"
            rules_section += (
                f"\n  → 置信度: {rule['confidence']:.0%}, "
                f"历史命中 {rule['hit_count']} 次, "
                f"正确率 {rule['success_rate']:.0%}"
            )

        # 记录 rule_hits artifact（hit_count 在 _update_rule_effectiveness 中按 checkpoint 维度递增，避免仿真阶段膨胀）
        db = await self._get_db()
        try:
            # 记录命中了哪些规则（用于后续效果追踪）
            demand_id = demand.get("id")
            if demand_id:
                await self._store_artifact(
                    self._current_run_id or "", demand_id, "rule_hits",
                    {"rule_ids": [r["rule_id"] for r in matched]},
                )
        except Exception as e:
            logger.debug(f"Rule hit tracking failed: {e}")
        finally:
            await db.close()

        return base_prompt + rules_section

    # ── 改造七：Prevention Rules — 提炼 ──────────────────────────────

    async def _extract_prevention_rules(self, resolved: list[dict]):
        """从被否决的决策中自动提炼预防规则（认知飞轮 extractor）。"""
        rejected = [cp for cp in resolved if cp.get("status") == "rejected"]
        if not rejected:
            return

        # 收集否决上下文
        rejection_contexts = []
        db = await self._get_db()
        try:
            for cp in rejected:
                demand_id = cp.get("demand_id")
                if not demand_id:
                    continue

                cur = await db.execute(
                    "SELECT title, description, ai_analysis, score_pain, score_competition, "
                    "score_cold_start, score_ai_opportunity, agent_verdict, track "
                    "FROM demands WHERE id = ?", (demand_id,),
                )
                demand = await cur.fetchone()
                if not demand:
                    continue

                cur = await db.execute(
                    "SELECT content FROM agent_artifacts WHERE demand_id = ? "
                    "AND artifact_type = 'simulation' ORDER BY created_at DESC LIMIT 1",
                    (demand_id,),
                )
                sim_row = await cur.fetchone()
                simulation = {}
                if sim_row:
                    try:
                        simulation = json.loads(sim_row["content"])
                    except (json.JSONDecodeError, TypeError):
                        pass

                rejection_contexts.append({
                    "demand": dict(demand),
                    "proposal": cp.get("proposal", ""),
                    "user_feedback": cp.get("user_feedback", ""),
                    "simulation_summary": str(simulation)[:500],
                })
        finally:
            await db.close()

        if not rejection_contexts:
            return

        # 查询现有 active rules 避免重复
        db = await self._get_db()
        try:
            cur = await db.execute(
                "SELECT rule_id, pattern, action FROM prevention_rules WHERE status IN ('active', 'candidate')"
            )
            existing_rules = [dict(r) for r in await cur.fetchall()]
        except Exception:
            existing_rules = []
        finally:
            await db.close()

        # AI 提炼（改造四：动态 prompt）
        db_rc = await self._get_db()
        try:
            system_prompt = await get_prompt("rule_compiler", db_rc)
        finally:
            await db_rc.close()
        if not system_prompt:
            return

        user_prompt = f"""以下是 Agent 最近被否决的决策：

{json.dumps(rejection_contexts, ensure_ascii=False, indent=2)}

已有的规则（避免重复）：
{json.dumps(existing_rules[:20], ensure_ascii=False, indent=2)}

请提炼新的预防规则。如果否决原因是纯粹偏好问题（非系统性错误），可以返回空数组 []。"""

        result = await chat(system_prompt, user_prompt, temperature=0.2)

        try:
            new_rules = _parse_json(result)
            if not isinstance(new_rules, list):
                return
        except (json.JSONDecodeError, IndexError):
            return

        if not new_rules:
            return

        # 写入 prevention_rules 表
        db = await self._get_db()
        try:
            cur = await db.execute(
                "SELECT MAX(CAST(SUBSTR(rule_id, 3) AS INTEGER)) FROM prevention_rules"
            )
            row = await cur.fetchone()
            max_id = (row[0] or 0) if row else 0

            source_ids = [cp.get("id") for cp in rejected if cp.get("id")]

            for i, rule in enumerate(new_rules[:5]):  # 每轮最多提炼 5 条
                rule_id = f"R-{max_id + i + 1:04d}"
                await db.execute("""
                    INSERT INTO prevention_rules
                    (rule_id, pattern, pattern_keywords, action, action_params,
                     confidence, source_type, source_ids, status)
                    VALUES (?, ?, ?, ?, ?, 0.5, 'agent', ?, 'candidate')
                """, (
                    rule_id,
                    rule.get("pattern", ""),
                    json.dumps(rule.get("pattern_keywords", []), ensure_ascii=False),
                    rule.get("action", "warn"),
                    json.dumps(rule.get("action_params", {}), ensure_ascii=False),
                    json.dumps(source_ids),
                ))

            await db.commit()
            logger.info(f"Extracted {len(new_rules)} prevention rules from {len(rejected)} rejections")
        except Exception as e:
            logger.warning(f"Rule extraction DB write failed: {e}")
        finally:
            await db.close()

    # ── 改造七：Prevention Rules — 效果追踪 ──────────────────────────

    async def _update_rule_effectiveness(self, resolved: list[dict]):
        """根据最终结果更新规则有效性，管理规则生命周期。"""
        db = await self._get_db()
        try:
            for cp in resolved:
                demand_id = cp.get("demand_id")
                if not demand_id:
                    continue

                # 查询该 demand 触发过哪些规则
                cur = await db.execute(
                    "SELECT content FROM agent_artifacts "
                    "WHERE demand_id = ? AND artifact_type = 'rule_hits' "
                    "ORDER BY created_at DESC LIMIT 1",
                    (demand_id,),
                )
                hit_row = await cur.fetchone()
                if not hit_row:
                    continue

                try:
                    hit_rule_ids = json.loads(hit_row["content"]).get("rule_ids", [])
                except (json.JSONDecodeError, TypeError):
                    continue

                # 预防规则的语义：规则目的是「阻止/警告坏需求」
                # 规则命中 + 需求被拒绝 = 规则正确（阻止了坏需求）
                # 规则命中 + 需求被批准 = 规则错误（误报了好需求）
                is_correct = cp["status"] in ("rejected",)

                for rule_id in hit_rule_ids:
                    if is_correct:
                        await db.execute(
                            "UPDATE prevention_rules SET "
                            "hit_count = hit_count + 1, "
                            "hit_correct = hit_correct + 1, "
                            "success_rate = CAST(hit_correct + 1 AS REAL) / CAST(MAX(hit_count + 1, 1) AS REAL), "
                            "updated_at = CURRENT_TIMESTAMP "
                            "WHERE rule_id = ?",
                            (rule_id,),
                        )
                    else:
                        await db.execute(
                            "UPDATE prevention_rules SET "
                            "hit_count = hit_count + 1, "
                            "success_rate = CAST(hit_correct AS REAL) / CAST(MAX(hit_count + 1, 1) AS REAL), "
                            "updated_at = CURRENT_TIMESTAMP "
                            "WHERE rule_id = ?",
                            (rule_id,),
                        )

            # 规则生命周期管理
            # candidate → active: 命中 3 次且 success_rate >= 0.6
            await db.execute("""
                UPDATE prevention_rules SET status = 'active', updated_at = CURRENT_TIMESTAMP
                WHERE status = 'candidate' AND hit_count >= 3 AND success_rate >= 0.6
            """)
            # active → suspended: success_rate 持续走低
            await db.execute("""
                UPDATE prevention_rules SET status = 'suspended', updated_at = CURRENT_TIMESTAMP
                WHERE status = 'active' AND hit_count >= 5 AND success_rate < 0.3
            """)
            # suspended → retired: 超过 2 周无改善
            await db.execute("""
                UPDATE prevention_rules SET status = 'retired', retired_at = CURRENT_TIMESTAMP
                WHERE status = 'suspended'
                AND updated_at < datetime('now', '-14 days')
            """)

            await db.commit()
            logger.info("Rule effectiveness updated, lifecycle transitions applied")
        except Exception as e:
            logger.warning(f"Rule effectiveness update failed: {e}")
        finally:
            await db.close()

    # ── 触发 ─────────────────────────────────────────────────────────

    async def trigger_cycle(self):
        """手动触发一次认知循环（不等待间隔）。有并发锁防止重复执行。"""
        if self._cycle_lock is None:
            self._cycle_lock = asyncio.Lock()
        if self._cycle_lock.locked():
            logger.warning("Cognitive cycle already running, skipping manual trigger")
            return
        async with self._cycle_lock:
            config = await self._get_config()
            await self._run_cycle(config)
