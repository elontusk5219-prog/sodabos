import asyncio
from fastapi import APIRouter, BackgroundTasks
from database import get_db

router = APIRouter()


# Cache for AI-extracted demand keywords
_wordcloud_cache = {"data": None, "ts": 0, "error": None}
_wordcloud_generating = False  # prevent concurrent AI calls


async def _generate_wordcloud_bg():
    """Run AI wordcloud generation in background, update cache when done."""
    global _wordcloud_generating
    if _wordcloud_generating:
        return
    _wordcloud_generating = True
    import time, json as _json
    try:
        db = await get_db()
        try:
            all_rows = []
            platforms = [
                'reddit', 'hackernews', 'producthunt', 'v2ex', 'quora', 'trustmrr',
                'tieba', 'bilibili', 'zhihu', 'xiaohongshu', 'twitter',
                'google_trends', 'youtube', 'github_issues',
            ]
            for platform in platforms:
                cur = await db.execute(
                    """SELECT title, content, sentiment, platform FROM raw_items
                    WHERE platform = ? ORDER BY fetched_at DESC LIMIT 60""",
                    (platform,),
                )
                all_rows.extend(await cur.fetchall())

            cur = await db.execute(
                """SELECT title, content, sentiment, platform FROM raw_items
                WHERE platform IN ('tieba', 'bilibili', 'zhihu', 'xiaohongshu')
                AND (sentiment = 'negative'
                    OR title LIKE '%难%' OR title LIKE '%烦%' OR title LIKE '%怎么办%'
                    OR title LIKE '%求助%' OR title LIKE '%吐槽%' OR title LIKE '%坑%'
                    OR title LIKE '%贵%' OR title LIKE '%替代%' OR title LIKE '%有没有%'
                    OR title LIKE '%推荐%什么%' OR title LIKE '%求%工具%')
                ORDER BY fetched_at DESC LIMIT 100"""
            )
            all_rows.extend(await cur.fetchall())
        finally:
            await db.close()

        if not all_rows:
            _wordcloud_cache["error"] = "no_data"
            return

        seen = set()
        rows = []
        for r in all_rows:
            key = (r[0] or "")[:40]
            if key not in seen:
                seen.add(key)
                rows.append(r)

        texts = []
        for r in rows[:300]:
            line = f"[{r[3]}] {r[0] or ''}"
            if r[1]:
                line += f" | {r[1][:150]}"
            if r[2] == "negative":
                line += " [负面/吐槽]"
            texts.append(line)

        batch_text = "\n".join(texts)

        # 自动检索知识库，注入到 system prompt（知识库为空时无额外开销）
        from ai.client import chat
        from ai.knowledge_retriever import retrieve
        db2 = await get_db()
        try:
            # 用所有 items 的标题拼成查询词
            query = " ".join(set(
                w for r in rows[:50]
                for w in (r[0] or "").split()[:3]
            ))
            knowledge_context = await retrieve(query, db2, top_k=4)
        except Exception:
            knowledge_context = ""
        finally:
            await db2.close()

        system_prompt = DEMAND_EXTRACT_PROMPT
        if knowledge_context:
            system_prompt += (
                "\n\n# 知识库参考（内部市场分析文档，提取痛点时可结合以下竞品/市场背景）\n"
                + knowledge_context
            )

        response = await chat(system_prompt, batch_text, temperature=0.2)

        text = response.strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[1].rsplit("```", 1)[0]
        words = _json.loads(text)
        if isinstance(words, list) and len(words) > 0:
            _wordcloud_cache["data"] = words
            _wordcloud_cache["ts"] = time.time()
            _wordcloud_cache["error"] = None
        else:
            _wordcloud_cache["error"] = "empty_result"
    except Exception as e:
        print(f"[wordcloud bg] error: {e}")
        _wordcloud_cache["error"] = str(e)
    finally:
        _wordcloud_generating = False

DEMAND_EXTRACT_PROMPT = """分析以下来自Reddit、Hacker News、Product Hunt、贴吧、B站、知乎等平台的用户讨论数据。

任务：分两层提取需求信息。

第一层：**痛点/需求**（3-8字的短语）——用户在抱怨什么、缺什么、想要什么。
- 好："租房信息不透明"、"记账太麻烦"、"跨平台同步难"、"订阅费越来越贵"
- 坏："焦虑"、"孤独"（太笼统）、"XX推荐平台"（不是痛点）

第二层：每个痛点下面挂2-4个**具体的产品方向**（10-25字），是一个独立开发者可以动手做的具体工具/服务。

要求：
1. 只提取数据中有人**真实讨论过**的痛点，不要编造
2. value是该痛点在数据中出现的频次（1-20）
3. 产品方向要具体到能想象出产品形态
4. 中英文数据都分析，输出统一中文
5. **严格去重**：相似的痛点必须合并，不要出现"XX体验差"和"XX不好用"这样的重复
6. **领域均衡（重要）**：同一领域（如美食/烹饪、减肥/健身、娱乐）的痛点**最多2条**，必须覆盖至少6个不同领域：效率工具、开发者体验、财务/副业、社交/职场、内容创作、生活消费
7. **优先有产品机会**的痛点，纯情绪宣泄（如"好累"、"好难"）不算，单纯的生活吐槽也不算

输出JSON数组：
[{"text": "痛点短语", "value": 频次, "products": ["具体产品方向1", "具体产品方向2", "具体产品方向3"]}]
只输出JSON。输出25-40条不重复的痛点，**美食/烹饪类合计不超过2条**。"""


@router.post("/wordcloud/refresh")
async def refresh_wordcloud(background_tasks: BackgroundTasks):
    """Clear cache and trigger background regeneration."""
    _wordcloud_cache["data"] = None
    _wordcloud_cache["ts"] = 0
    _wordcloud_cache["error"] = None
    background_tasks.add_task(_generate_wordcloud_bg)
    return {"status": "generating", "message": "词云正在后台生成，约30秒后刷新页面"}


@router.get("/wordcloud")
async def get_wordcloud(background_tasks: BackgroundTasks):
    import time
    # Return cache if fresh (30 min)
    if _wordcloud_cache["data"] and time.time() - _wordcloud_cache["ts"] < 1800:
        return {"status": "ready", "words": _wordcloud_cache["data"]}

    # If already generating, tell the frontend to wait
    if _wordcloud_generating:
        return {"status": "generating", "words": []}

    # If there was a previous error, report it so frontend doesn't spin forever
    if _wordcloud_cache["error"]:
        err = _wordcloud_cache["error"]
        # Clear error so a manual refresh can retry
        _wordcloud_cache["error"] = None
        return {"status": "error", "words": [], "error": err}

    # Trigger background generation and return status immediately
    background_tasks.add_task(_generate_wordcloud_bg)
    return {"status": "generating", "words": []}


@router.get("")
async def get_dashboard():
    db = await get_db()
    try:
        # Total items
        cur = await db.execute("SELECT COUNT(*) FROM raw_items")
        total_items = (await cur.fetchone())[0]

        # Items today
        cur = await db.execute("SELECT COUNT(*) FROM raw_items WHERE date(fetched_at) = date('now')")
        items_today = (await cur.fetchone())[0]

        # Total demands
        cur = await db.execute("SELECT COUNT(*) FROM demands")
        total_demands = (await cur.fetchone())[0]

        # Avg score
        cur = await db.execute("SELECT AVG(score_total) FROM demands WHERE score_total > 0")
        row = await cur.fetchone()
        avg_score = round(row[0] or 0, 1)

        # Sources
        cur = await db.execute("SELECT COUNT(*) FROM data_sources")
        total_sources = (await cur.fetchone())[0]
        cur = await db.execute("SELECT COUNT(*) FROM data_sources WHERE enabled = 1")
        active_sources = (await cur.fetchone())[0]

        # Top platforms — use configured data_sources (human-readable names),
        # with actual item counts from raw_items, so the chart reflects real sources.
        cur = await db.execute(
            """SELECT ds.name, COALESCE(ri.cnt, 0) as cnt
               FROM data_sources ds
               LEFT JOIN (
                   SELECT platform, COUNT(*) as cnt FROM raw_items GROUP BY platform
               ) ri ON ri.platform = ds.platform
               WHERE ds.enabled = 1
               ORDER BY cnt DESC
               LIMIT 8"""
        )
        top_platforms = [{"platform": r[0], "count": r[1]} for r in await cur.fetchall()]

        import json as _json2

        # 1. Google Trends rising queries (more specific than generic keyword scores)
        cur = await db.execute(
            """SELECT title, metrics FROM raw_items
               WHERE platform='google_trends' AND title LIKE '[Rising]%'
               AND date(fetched_at) >= date('now','-7 days')"""
        )
        gt_rows_all = await cur.fetchall()
        gt_rows = sorted(
            gt_rows_all,
            key=lambda r: _json2.loads(r[1] or "{}").get("rise_value", 0) if r[1] else 0,
            reverse=True
        )[:4]
        google_trends = []
        for r in gt_rows:
            try:
                m = _json2.loads(r[1] or "{}")
                rise = m.get("rise_value", 0)
                parent = m.get("parent_keyword", "")
                # Strip "[Rising] " prefix
                kw = (r[0] or "").replace("[Rising] ", "").strip()
                if rise > 0:
                    google_trends.append({
                        "keyword": kw,
                        "value": rise,
                        "change_percent": 0,
                        "platform": "google",
                        "sub": f"关联: {parent}",
                    })
            except Exception:
                pass

        # 2. Reddit: top posts by score
        cur = await db.execute(
            """SELECT title, metrics FROM raw_items
               WHERE platform='reddit' AND date(fetched_at) >= date('now','-7 days')"""
        )
        reddit_rows_all = await cur.fetchall()
        reddit_rows = sorted(
            reddit_rows_all,
            key=lambda r: _json2.loads(r[1] or "{}").get("score", 0) if r[1] else 0,
            reverse=True
        )[:4]
        reddit_trends = []
        for r in reddit_rows:
            try:
                m = _json2.loads(r[1] or "{}")
                score = m.get("score", 0)
                if score > 0:
                    title = (r[0] or "")[:40]
                    reddit_trends.append({
                        "keyword": title,
                        "value": score,
                        "change_percent": 0,
                        "platform": "reddit",
                        "sub": f"👍 {score}  💬 {m.get('comments', 0)}",
                    })
            except Exception:
                pass

        # 3. HackerNews: top stories by score
        hn_rows_all = await db.execute_fetchall(
            "SELECT title, metrics FROM raw_items WHERE platform='hackernews' AND date(fetched_at) >= date('now','-7 days')"
        ) if False else None
        cur = await db.execute(
            "SELECT title, metrics FROM raw_items WHERE platform='hackernews' AND date(fetched_at) >= date('now','-7 days')"
        )
        hn_all = await cur.fetchall()
        # Sort in Python to avoid JSON_EXTRACT compat issues
        hn_scored = []
        for r in hn_all:
            try:
                m = _json2.loads(r[1] or "{}")
                score = m.get("score", 0)
                if score:
                    hn_scored.append((score, r[0], m))
            except Exception:
                pass
        hn_scored.sort(key=lambda x: -x[0])
        hn_trends = []
        for score, title, m in hn_scored[:4]:
            hn_trends.append({
                "keyword": (title or "")[:40],
                "value": score,
                "change_percent": 0,
                "platform": "hackernews",
                "sub": f"⬆ {score}  💬 {m.get('comments', 0)}",
            })

        # Merge all, interleave by source for variety
        recent_trends = []
        pools = [google_trends, reddit_trends, hn_trends]
        idx = [0, 0, 0]
        while len(recent_trends) < 10:
            added = False
            for i, pool in enumerate(pools):
                if idx[i] < len(pool):
                    recent_trends.append(pool[idx[i]])
                    idx[i] += 1
                    added = True
            if not added:
                break

        # Recent items
        cur = await db.execute(
            "SELECT id, title, platform, url, sentiment, fetched_at FROM raw_items ORDER BY fetched_at DESC LIMIT 20"
        )
        recent_items = [
            {"id": r[0], "title": r[1], "platform": r[2], "url": r[3], "sentiment": r[4], "fetched_at": r[5]}
            for r in await cur.fetchall()
        ]

        # Stage distribution
        cur = await db.execute(
            "SELECT stage, COUNT(*) FROM demands GROUP BY stage"
        )
        stages = {r[0]: r[1] for r in await cur.fetchall()}

        return {
            "total_items": total_items,
            "items_today": items_today,
            "total_demands": total_demands,
            "avg_score": avg_score,
            "total_sources": total_sources,
            "active_sources": active_sources,
            "top_platforms": top_platforms,
            "recent_trends": recent_trends,
            "recent_items": recent_items,
            "stages": stages,
        }
    finally:
        await db.close()
