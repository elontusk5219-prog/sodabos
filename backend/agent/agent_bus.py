"""
多 Agent 协作框架 — Agent 消息总线

支持 Agent 之间互相发消息、委派任务、汇报结果。
类似 OpenClaw 的多角色协同，但专注于 PM 领域。

架构：
- AgentBus: 中央消息路由器
- 注册的 Agent: pm_agent, acquisition_agent, validation_agent, research_agent
- 每个 Agent 有 handle_message() 方法处理收到的消息
- 任务队列: 所有后台任务统一管理，支持进度查询
"""

import asyncio
import json
import logging
import time
from dataclasses import dataclass, field, asdict
from enum import Enum
from typing import Callable, Awaitable

from database import get_db

logger = logging.getLogger(__name__)


class TaskStatus(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"
    CANCELLED = "cancelled"


class TaskPriority(str, Enum):
    LOW = "low"
    NORMAL = "normal"
    HIGH = "high"
    URGENT = "urgent"


@dataclass
class AgentTask:
    id: str
    agent_from: str
    agent_to: str
    action: str
    params: dict = field(default_factory=dict)
    status: TaskStatus = TaskStatus.QUEUED
    priority: TaskPriority = TaskPriority.NORMAL
    progress: str = ""
    result: dict | None = None
    error: str = ""
    created_at: float = field(default_factory=time.time)
    started_at: float = 0
    finished_at: float = 0
    plan_steps: list[dict] = field(default_factory=list)  # 规划透明度


@dataclass
class AgentMessage:
    """Agent 间通信消息"""
    from_agent: str
    to_agent: str
    msg_type: str  # "request" | "response" | "notify" | "delegate"
    content: str
    task_id: str = ""
    data: dict = field(default_factory=dict)
    timestamp: float = field(default_factory=time.time)


# ── 全局 Agent 注册表 ──────────────────────────────────────────────

_agents: dict[str, "BaseAgent"] = {}
_task_queue: dict[str, AgentTask] = {}
_message_log: list[dict] = []


class BaseAgent:
    """Agent 基类，所有 Agent 必须继承"""

    name: str = "unnamed"
    display_name: str = "未命名 Agent"
    description: str = ""
    capabilities: list[str] = []

    async def handle_message(self, msg: AgentMessage) -> AgentMessage | None:
        """处理收到的消息，返回回复（或 None）"""
        raise NotImplementedError

    async def handle_task(self, task: AgentTask) -> dict:
        """执行被委派的任务，返回结果"""
        raise NotImplementedError

    async def plan(self, task: AgentTask) -> list[dict]:
        """生成执行计划（规划透明度），返回步骤列表"""
        return [{"step": 1, "action": task.action, "description": "直接执行"}]


class PMAgent(BaseAgent):
    name = "pm_agent"
    display_name = "PM Agent"
    description = "产品经理 Agent，负责需求分析、产品决策、项目规划"
    capabilities = ["需求分析", "产品评分", "生成文档", "项目管理", "竞品分析"]

    async def handle_message(self, msg: AgentMessage) -> AgentMessage | None:
        if msg.msg_type == "response":
            # 收到其他 Agent 的回复
            logger.info(f"PM Agent 收到来自 {msg.from_agent} 的回复: {msg.content[:100]}")
            # 存入对话历史
            await _log_agent_message(msg)
            return None

        if msg.msg_type == "notify":
            logger.info(f"PM Agent 收到通知: {msg.content[:100]}")
            await _log_agent_message(msg)
            return None

        return None

    async def handle_task(self, task: AgentTask) -> dict:
        from ai.client import chat
        if task.action == "analyze_demand":
            result = await chat(
                "你是产品经理。分析以下需求的可行性。",
                json.dumps(task.params, ensure_ascii=False),
            )
            return {"analysis": result}
        elif task.action == "generate_document":
            result = await chat(
                f"你是产品经理。生成 {task.params.get('doc_type', '文档')}。",
                json.dumps(task.params, ensure_ascii=False),
            )
            return {"content": result}
        return {"error": f"未知任务: {task.action}"}

    async def plan(self, task: AgentTask) -> list[dict]:
        from ai.client import chat
        result = await chat(
            """你是产品经理 Agent 的规划模块。给定一个任务，输出执行计划。
输出 JSON 数组: [{"step": 1, "action": "xxx", "description": "xxx", "agent": "pm_agent|acquisition_agent|validation_agent"}]
如果需要其他 Agent 协助，在 agent 字段指定。""",
            f"任务: {task.action}\n参数: {json.dumps(task.params, ensure_ascii=False)}",
            temperature=0.3,
        )
        try:
            clean = result.strip()
            if clean.startswith("```"):
                clean = clean.split("\n", 1)[1].rsplit("```", 1)[0]
            return json.loads(clean)
        except (json.JSONDecodeError, IndexError):
            return [{"step": 1, "action": task.action, "description": "直接执行", "agent": self.name}]


class AcquisitionAgent(BaseAgent):
    name = "acquisition_agent"
    display_name = "获客 Agent"
    description = "用户获取 Agent，负责寻找目标用户、生成获客策略和触达内容"
    capabilities = ["用户画像", "获客策略", "平台扫描", "质量评估", "生成回复"]

    async def handle_message(self, msg: AgentMessage) -> AgentMessage | None:
        if msg.msg_type == "delegate":
            logger.info(f"获客 Agent 收到 PM Agent 委派: {msg.content[:100]}")
            await _log_agent_message(msg)
            return AgentMessage(
                from_agent=self.name,
                to_agent=msg.from_agent,
                msg_type="response",
                content=f"收到，正在处理获客任务...",
                task_id=msg.task_id,
            )
        return None

    async def handle_task(self, task: AgentTask) -> dict:
        if task.action == "find_users":
            from api.acquisition import _execute_pipeline, _active_runs
            from database import get_db
            import asyncio
            persona_id = task.params.get("persona_id")
            if not persona_id:
                return {"error": "缺少 persona_id"}
            # 创建 run 记录
            db = await get_db()
            try:
                cur = await db.execute(
                    "INSERT INTO acq_runs (persona_id, status) VALUES (?, 'pending')",
                    (persona_id,),
                )
                run_id = cur.lastrowid
                await db.commit()
            finally:
                await db.close()
            _active_runs[run_id] = True
            asyncio.create_task(_execute_pipeline(run_id, persona_id))
            return {"run_id": run_id, "status": "started"}
        return {"error": f"未知任务: {task.action}"}


class ValidationAgent(BaseAgent):
    name = "validation_agent"
    display_name = "验证 Agent"
    description = "市场验证 Agent，负责 Google Trends 验证、KD 分析、竞品格局评估"
    capabilities = ["趋势验证", "KD 分析", "竞品格局", "市场热度评估"]

    async def handle_message(self, msg: AgentMessage) -> AgentMessage | None:
        if msg.msg_type == "delegate":
            logger.info(f"验证 Agent 收到委派: {msg.content[:100]}")
            await _log_agent_message(msg)
            return AgentMessage(
                from_agent=self.name,
                to_agent=msg.from_agent,
                msg_type="response",
                content="开始验证...",
                task_id=msg.task_id,
            )
        return None

    async def handle_task(self, task: AgentTask) -> dict:
        if task.action == "validate_demand":
            from ai.value_filter import run_value_filter
            demand_id = task.params.get("demand_id")
            if demand_id:
                result = await run_value_filter(demand_id)
                return result
            return {"error": "缺少 demand_id"}
        elif task.action == "batch_validate":
            from ai.value_filter import batch_value_filter
            result = await batch_value_filter(
                demand_ids=task.params.get("demand_ids"),
                min_score=task.params.get("min_score", 5.0),
            )
            return {"results": result}
        return {"error": f"未知任务: {task.action}"}


# ── 消息总线 ──────────────────────────────────────────────────────

def register_agents():
    """注册所有 Agent"""
    global _agents
    _agents = {
        "pm_agent": PMAgent(),
        "acquisition_agent": AcquisitionAgent(),
        "validation_agent": ValidationAgent(),
    }
    logger.info(f"已注册 {len(_agents)} 个 Agent: {list(_agents.keys())}")


async def send_message(msg: AgentMessage) -> AgentMessage | None:
    """发送消息到目标 Agent"""
    target = _agents.get(msg.to_agent)
    if not target:
        logger.warning(f"目标 Agent 不存在: {msg.to_agent}")
        return None

    # 记录消息
    await _log_agent_message(msg)

    # 路由到目标 Agent
    reply = await target.handle_message(msg)
    if reply:
        await _log_agent_message(reply)
    return reply


async def delegate_task(
    from_agent: str,
    to_agent: str,
    action: str,
    params: dict,
    priority: TaskPriority = TaskPriority.NORMAL,
    with_plan: bool = True,
) -> AgentTask:
    """
    委派任务给另一个 Agent。
    1. 创建任务
    2. 如果 with_plan=True，先生成执行计划
    3. 放入队列
    4. 发送委派消息
    5. 后台执行
    """
    task_id = f"task-{int(time.time()*1000)}-{from_agent[:3]}-{to_agent[:3]}"
    task = AgentTask(
        id=task_id,
        agent_from=from_agent,
        agent_to=to_agent,
        action=action,
        params=params,
        priority=priority,
    )

    # 生成计划（规划透明度）
    if with_plan:
        target = _agents.get(to_agent)
        if target:
            try:
                task.plan_steps = await target.plan(task)
            except Exception as e:
                task.plan_steps = [{"step": 1, "action": action, "description": f"直接执行 ({e})"}]

    _task_queue[task_id] = task

    # 持久化到数据库
    await _persist_task(task)

    # 发送委派消息
    await send_message(AgentMessage(
        from_agent=from_agent,
        to_agent=to_agent,
        msg_type="delegate",
        content=f"请执行: {action}",
        task_id=task_id,
        data=params,
    ))

    # 后台执行
    asyncio.create_task(_execute_task(task))
    return task


async def _execute_task(task: AgentTask):
    """后台执行任务"""
    target = _agents.get(task.agent_to)
    if not target:
        task.status = TaskStatus.FAILED
        task.error = f"Agent 不存在: {task.agent_to}"
        await _persist_task(task)
        return

    task.status = TaskStatus.RUNNING
    task.started_at = time.time()
    task.progress = "执行中..."
    await _persist_task(task)

    try:
        # 按计划步骤执行
        for i, step in enumerate(task.plan_steps):
            task.progress = f"步骤 {i+1}/{len(task.plan_steps)}: {step.get('description', step.get('action', ''))}"
            await _persist_task(task)

            # 如果步骤需要其他 Agent，递归委派
            step_agent = step.get("agent", task.agent_to)
            if step_agent != task.agent_to and step_agent in _agents:
                sub_task = await delegate_task(
                    task.agent_to, step_agent,
                    step.get("action", ""),
                    step.get("params", task.params),
                    with_plan=False,
                )
                # 等待子任务完成
                while sub_task.status in (TaskStatus.QUEUED, TaskStatus.RUNNING):
                    await asyncio.sleep(2)
                    sub_task = _task_queue.get(sub_task.id, sub_task)

        # 执行主任务
        result = await target.handle_task(task)
        task.result = result
        task.status = TaskStatus.DONE
        task.progress = "完成"
    except Exception as e:
        task.status = TaskStatus.FAILED
        task.error = str(e)
        task.progress = f"失败: {e}"
        logger.error(f"任务 {task.id} 执行失败: {e}")
    finally:
        task.finished_at = time.time()
        await _persist_task(task)

    # 通知发起者
    await send_message(AgentMessage(
        from_agent=task.agent_to,
        to_agent=task.agent_from,
        msg_type="response",
        content=f"任务完成: {task.action}" if task.status == TaskStatus.DONE else f"任务失败: {task.error}",
        task_id=task.id,
        data=task.result or {},
    ))


# ── 任务查询 ──────────────────────────────────────────────────────

def get_task(task_id: str) -> AgentTask | None:
    return _task_queue.get(task_id)


def get_all_tasks(status: TaskStatus | None = None, limit: int = 50) -> list[dict]:
    tasks = sorted(_task_queue.values(), key=lambda t: t.created_at, reverse=True)
    if status:
        tasks = [t for t in tasks if t.status == status]
    return [asdict(t) for t in tasks[:limit]]


def get_agent_list() -> list[dict]:
    return [
        {
            "name": a.name,
            "display_name": a.display_name,
            "description": a.description,
            "capabilities": a.capabilities,
        }
        for a in _agents.values()
    ]


# ── 持久化 ────────────────────────────────────────────────────────

async def _persist_task(task: AgentTask):
    """任务状态持久化到数据库"""
    db = await get_db()
    try:
        await db.execute("""
            INSERT OR REPLACE INTO agent_tasks
            (id, agent_from, agent_to, action, params, status, priority, progress, result, error, plan_steps, created_at, started_at, finished_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            task.id, task.agent_from, task.agent_to, task.action,
            json.dumps(task.params, ensure_ascii=False),
            task.status.value, task.priority.value, task.progress,
            json.dumps(task.result, ensure_ascii=False) if task.result else None,
            task.error,
            json.dumps(task.plan_steps, ensure_ascii=False),
            task.created_at, task.started_at, task.finished_at,
        ))
        await db.commit()
    except Exception as e:
        logger.warning(f"任务持久化失败: {e}")
    finally:
        await db.close()


async def _log_agent_message(msg: AgentMessage):
    """记录 Agent 间消息"""
    entry = {
        "from": msg.from_agent,
        "to": msg.to_agent,
        "type": msg.msg_type,
        "content": msg.content[:500],
        "task_id": msg.task_id,
        "timestamp": msg.timestamp,
    }
    _message_log.append(entry)
    # 只保留最近 200 条
    if len(_message_log) > 200:
        _message_log.pop(0)

    # 也写 DB
    db = await get_db()
    try:
        await db.execute(
            "INSERT INTO agent_messages (from_agent, to_agent, msg_type, content, task_id) VALUES (?, ?, ?, ?, ?)",
            (msg.from_agent, msg.to_agent, msg.msg_type, msg.content[:1000], msg.task_id),
        )
        await db.commit()
    except Exception:
        pass
    finally:
        await db.close()


def get_message_log(limit: int = 50) -> list[dict]:
    return _message_log[-limit:]
