import os
import logging
import asyncio
import httpx
from openai import AsyncOpenAI
from config import OPENAI_API_KEY, OPENAI_BASE_URL, OPENAI_MODEL

logger = logging.getLogger("ai.client")

client = AsyncOpenAI(
    api_key=OPENAI_API_KEY,
    base_url=OPENAI_BASE_URL,
    timeout=httpx.Timeout(180.0, connect=10.0),  # 180s 总超时，10s 连接超时
    max_retries=2,  # SDK 内置重试（指数退避）
)

# 轻量模型：用于预筛等低成本批量任务
FAST_MODEL = os.getenv("OPENAI_FAST_MODEL", "gemini-2.0-flash")


async def chat_fast(system_prompt: str, user_prompt: str, temperature: float = 0.3) -> str:
    """用轻量模型做批量预筛等低成本任务。失败时回退到主模型。"""
    try:
        resp = await client.chat.completions.create(
            model=FAST_MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=temperature,
        )
        return resp.choices[0].message.content or ""
    except Exception as e:
        logger.warning(f"Fast model ({FAST_MODEL}) failed, falling back to main: {e}")
        try:
            return await chat(system_prompt, user_prompt, temperature)
        except Exception as e2:
            logger.error(f"Fallback to main model also failed: {e2}")
            return f"[AI Error] All models failed: {str(e2)}"


async def chat(system_prompt: str, user_prompt: str, temperature: float = 0.7) -> str:
    """调用 AI 聊天。失败时返回 [AI Error] 前缀的字符串（向后兼容）。"""
    try:
        resp = await client.chat.completions.create(
            model=OPENAI_MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=temperature,
        )
        return resp.choices[0].message.content or ""
    except Exception as e:
        logger.error(f"AI call failed: {e}", exc_info=True)
        return f"[AI Error] {str(e)}"


async def chat_strict(system_prompt: str, user_prompt: str, temperature: float = 0.7) -> str:
    """调用 AI 聊天。失败时抛出异常（不吞错误）。"""
    resp = await client.chat.completions.create(
        model=OPENAI_MODEL,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        temperature=temperature,
    )
    return resp.choices[0].message.content or ""


async def chat_multi(messages: list[dict], temperature: float = 0.7) -> str:
    """多轮对话。失败时抛出异常。"""
    resp = await client.chat.completions.create(
        model=OPENAI_MODEL,
        messages=messages,
        temperature=temperature,
    )
    return resp.choices[0].message.content or ""


async def chat_multi_stream(messages: list[dict], temperature: float = 0.7, tools: list | None = None):
    """多轮对话流式输出。yields (type, content) tuples.

    type 可以是:
    - "content": content 为文本片段
    - "tool_calls": content 为 tool call 列表 [{id, name, arguments}, ...]
    - "done": content 为 None
    """
    kwargs = {
        "model": OPENAI_MODEL,
        "messages": messages,
        "temperature": temperature,
        "stream": True,
    }
    if tools:
        kwargs["tools"] = tools

    stream = await client.chat.completions.create(**kwargs)

    tool_calls_buffer = {}  # index -> {id, name, arguments}

    async for chunk in stream:
        delta = chunk.choices[0].delta if chunk.choices else None
        if not delta:
            continue

        # Content streaming
        if delta.content:
            yield ("content", delta.content)

        # Tool call streaming
        if delta.tool_calls:
            for tc in delta.tool_calls:
                idx = tc.index
                if idx not in tool_calls_buffer:
                    tool_calls_buffer[idx] = {"id": tc.id or "", "name": "", "arguments": ""}
                if tc.id:
                    tool_calls_buffer[idx]["id"] = tc.id
                if tc.function:
                    if tc.function.name:
                        tool_calls_buffer[idx]["name"] = tc.function.name
                    if tc.function.arguments:
                        tool_calls_buffer[idx]["arguments"] += tc.function.arguments

        # Check finish reason
        if chunk.choices[0].finish_reason == "tool_calls":
            yield ("tool_calls", list(tool_calls_buffer.values()))
            tool_calls_buffer = {}
        elif chunk.choices[0].finish_reason == "stop":
            yield ("done", None)


async def chat_stream_simple(messages: list[dict], temperature: float = 0.7):
    """简单流式输出（无 tool calling）。yields 文本片段字符串。"""
    stream = await client.chat.completions.create(
        model=OPENAI_MODEL,
        messages=messages,
        temperature=temperature,
        stream=True,
    )
    async for chunk in stream:
        delta = chunk.choices[0].delta if chunk.choices else None
        if not delta:
            continue
        if delta.content:
            yield delta.content
