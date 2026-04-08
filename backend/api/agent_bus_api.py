"""
多 Agent 协作 API

提供任务委派、任务查询、Agent 列表、消息日志等端点。
"""
from fastapi import APIRouter
from pydantic import BaseModel
from agent.agent_bus import (
    delegate_task, get_task, get_all_tasks, get_agent_list,
    get_message_log, TaskPriority, TaskStatus,
)

router = APIRouter()


class DelegateRequest(BaseModel):
    from_agent: str = "pm_agent"
    to_agent: str
    action: str
    params: dict = {}
    priority: str = "normal"
    with_plan: bool = True


@router.get("/agents")
async def list_agents():
    """列出所有注册的 Agent"""
    return get_agent_list()


@router.post("/delegate")
async def delegate(req: DelegateRequest):
    """委派任务给某个 Agent"""
    task = await delegate_task(
        from_agent=req.from_agent,
        to_agent=req.to_agent,
        action=req.action,
        params=req.params,
        priority=TaskPriority(req.priority),
        with_plan=req.with_plan,
    )
    return {
        "task_id": task.id,
        "status": task.status.value,
        "plan_steps": task.plan_steps,
    }


@router.get("/tasks")
async def list_tasks(status: str = "", limit: int = 50):
    """查询任务列表"""
    s = TaskStatus(status) if status else None
    return get_all_tasks(status=s, limit=limit)


@router.get("/tasks/{task_id}")
async def task_detail(task_id: str):
    """查询单个任务详情"""
    task = get_task(task_id)
    if not task:
        return {"error": "任务不存在"}
    from dataclasses import asdict
    return asdict(task)


@router.get("/messages")
async def message_log(limit: int = 50):
    """Agent 间消息日志"""
    return get_message_log(limit)
