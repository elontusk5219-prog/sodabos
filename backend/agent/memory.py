"""
Agent Memory — Cognee-backed knowledge graph for self-evolution.

Wraps Cognee to store:
- User feedback patterns (what they like/dislike)
- Decision history (which checkpoints approved/rejected and why)
- Prototype feedback (design preference learning)
- Market insight evolution

Falls back to local JSON storage if Cognee is not installed.
"""
import json
import os
import logging
from datetime import datetime

logger = logging.getLogger("agent_memory")

# Try importing cognee; fall back gracefully
try:
    import cognee
    COGNEE_AVAILABLE = True
except ImportError:
    COGNEE_AVAILABLE = False
    logger.warning("cognee not installed — using local JSON fallback for agent memory")


_MEMORY_DIR = os.getenv("MEMORY_DIR", os.path.join(os.path.dirname(__file__), "..", "..", "data", "cognee"))


class AgentMemory:
    def __init__(self):
        self._initialized = False
        self._local_store: dict = {}
        self._local_path = os.path.join(_MEMORY_DIR, "local_memory.json")

    async def initialize(self):
        os.makedirs(_MEMORY_DIR, exist_ok=True)

        if COGNEE_AVAILABLE:
            try:
                from config import OPENAI_API_KEY, OPENAI_BASE_URL, OPENAI_MODEL
                cognee.config.set_llm_config({
                    "llm_api_key": OPENAI_API_KEY,
                    "llm_model": OPENAI_MODEL,
                    "llm_provider": "openai",
                    "llm_endpoint": OPENAI_BASE_URL,
                })
                cognee.config.set_vector_db_config({
                    "vector_db_provider": "lancedb",
                    "vector_db_url": os.path.join(_MEMORY_DIR, "lancedb"),
                })
                logger.info("Cognee initialized with LanceDB backend")
            except Exception as e:
                logger.error(f"Cognee init failed, using local fallback: {e}")

        # Load local store regardless (used for structured preference tracking)
        self._load_local()
        self._initialized = True

    # ── Store operations ─────────────────────────────────────────────

    async def store_feedback(self, feedback_type: str, target: str, vote: int, context: dict = None):
        """Store user feedback as a learning signal."""
        entry = {
            "type": "feedback",
            "feedback_type": feedback_type,
            "target": target,
            "vote": vote,
            "context": context or {},
            "timestamp": datetime.utcnow().isoformat(),
        }

        # Local structured storage
        fb_key = f"feedback:{feedback_type}:{target}"
        self._local_store.setdefault("feedbacks", {})[fb_key] = entry
        user_id = (context or {}).get("user_id", "global")
        self._update_preference_model(feedback_type, target, vote, user_id=str(user_id))
        self._save_local()

        # Cognee ingestion
        if COGNEE_AVAILABLE:
            try:
                await cognee.add([json.dumps(entry, ensure_ascii=False)])
                await cognee.cognify()
            except Exception as e:
                logger.warning(f"Cognee store_feedback failed: {e}")

    async def store_decision(self, checkpoint_id: int, demand_id: int,
                             approved: bool, feedback: str = ""):
        """Store checkpoint resolution as decision history."""
        entry = {
            "type": "decision",
            "checkpoint_id": checkpoint_id,
            "demand_id": demand_id,
            "approved": approved,
            "feedback": feedback,
            "timestamp": datetime.utcnow().isoformat(),
        }

        decisions = self._local_store.setdefault("decisions", [])
        decisions.append(entry)
        # Keep last 200 decisions
        if len(decisions) > 200:
            self._local_store["decisions"] = decisions[-200:]
        self._save_local()

        if COGNEE_AVAILABLE:
            try:
                await cognee.add([json.dumps(entry, ensure_ascii=False)])
                await cognee.cognify()
            except Exception as e:
                logger.warning(f"Cognee store_decision failed: {e}")

    async def store_prototype_feedback(self, prototype_id: int, demand_id: int,
                                        score: int, notes: str = ""):
        """Store prototype review feedback."""
        entry = {
            "type": "prototype_feedback",
            "prototype_id": prototype_id,
            "demand_id": demand_id,
            "score": score,
            "notes": notes,
            "timestamp": datetime.utcnow().isoformat(),
        }

        proto_fb = self._local_store.setdefault("prototype_feedbacks", [])
        proto_fb.append(entry)
        self._save_local()

        if COGNEE_AVAILABLE:
            try:
                await cognee.add([json.dumps(entry, ensure_ascii=False)])
                await cognee.cognify()
            except Exception as e:
                logger.warning(f"Cognee store_prototype_feedback failed: {e}")

    # ── Query operations ─────────────────────────────────────────────

    async def query_preferences(self, context: str = "") -> dict:
        """Query user preference patterns."""
        prefs = self._local_store.get("preferences", {})

        # If Cognee available, enrich with semantic search
        if COGNEE_AVAILABLE and context:
            try:
                results = await cognee.search("INSIGHTS", query=f"user preferences about {context}")
                if results:
                    prefs["cognee_insights"] = [str(r)[:200] for r in results[:5]]
            except Exception as e:
                logger.warning(f"Cognee query_preferences failed: {e}")

        return prefs

    async def query_similar_decisions(self, demand_description: str) -> list[dict]:
        """Find similar past decisions and their outcomes."""
        decisions = self._local_store.get("decisions", [])

        # Simple local search: return recent approved/rejected decisions
        recent = decisions[-50:]

        if COGNEE_AVAILABLE:
            try:
                results = await cognee.search("INSIGHTS", query=demand_description)
                if results:
                    return [{"source": "cognee", "insight": str(r)[:300]} for r in results[:5]]
            except Exception as e:
                logger.warning(f"Cognee query_similar_decisions failed: {e}")

        return recent[-10:]

    async def get_learning_summary(self) -> dict:
        """Generate a summary of what the agent has learned."""
        prefs = self._local_store.get("preferences", {})
        decisions = self._local_store.get("decisions", [])

        total_decisions = len(decisions)
        approved = sum(1 for d in decisions if d.get("approved"))
        rejected = total_decisions - approved

        liked_topics = prefs.get("liked_topics", {})
        disliked_topics = prefs.get("disliked_topics", {})

        # Sort by frequency
        top_liked = sorted(liked_topics.items(), key=lambda x: -x[1])[:10]
        top_disliked = sorted(disliked_topics.items(), key=lambda x: -x[1])[:10]

        return {
            "total_decisions": total_decisions,
            "approved": approved,
            "rejected": rejected,
            "approval_rate": f"{approved/total_decisions*100:.0f}%" if total_decisions else "N/A",
            "top_liked_topics": [{"topic": k, "count": v} for k, v in top_liked],
            "top_disliked_topics": [{"topic": k, "count": v} for k, v in top_disliked],
            "total_feedbacks": len(self._local_store.get("feedbacks", {})),
            "total_prototype_feedbacks": len(self._local_store.get("prototype_feedbacks", [])),
        }

    # ── Preference model ─────────────────────────────────────────────

    def _update_preference_model(self, feedback_type: str, target: str, vote: int, user_id: str = "global"):
        """Incrementally update the preference model from a single feedback event.
        改造六：支持 per-user 偏好追踪。
        """
        # Global preferences (backward compatible)
        prefs = self._local_store.setdefault("preferences", {
            "liked_topics": {},
            "disliked_topics": {},
            "liked_demands": {},
            "disliked_demands": {},
        })

        if feedback_type == "wordcloud":
            bucket = "liked_topics" if vote > 0 else "disliked_topics"
            prefs[bucket][target] = prefs[bucket].get(target, 0) + 1
        elif feedback_type in ("demand", "demand_approved", "demand_dismissed"):
            bucket = "liked_demands" if vote > 0 else "disliked_demands"
            prefs[bucket][target] = prefs[bucket].get(target, 0) + 1

        # Per-user preferences (改造六)
        if user_id and user_id != "global":
            user_prefs = self._local_store.setdefault("user_preferences", {}).setdefault(str(user_id), {
                "liked_topics": {}, "disliked_topics": {},
                "liked_demands": {}, "disliked_demands": {},
                "approved_tracks": {"A": 0, "B": 0},
            })

            if feedback_type == "wordcloud":
                bucket = "liked_topics" if vote > 0 else "disliked_topics"
                user_prefs[bucket][target] = user_prefs[bucket].get(target, 0) + 1
            elif feedback_type in ("demand", "demand_approved"):
                user_prefs["liked_demands"][target] = user_prefs["liked_demands"].get(target, 0) + 1
            elif feedback_type in ("demand_dismiss", "demand_dismissed"):
                user_prefs["disliked_demands"][target] = user_prefs["disliked_demands"].get(target, 0) + 1

    async def suggest_reviewer(self, demand: dict) -> str | None:
        """改造六：根据需求特征匹配最合适的审批人。"""
        user_prefs = self._local_store.get("user_preferences", {})
        best_match = None
        best_score = -1

        demand_title = (demand.get("title") or "").lower()
        demand_track = demand.get("track", "A")

        for user_id, prefs in user_prefs.items():
            score = 0
            # Track 偏好匹配
            approved_tracks = prefs.get("approved_tracks", {})
            if demand_track == "A" and approved_tracks.get("A", 0) > approved_tracks.get("B", 0):
                score += 2
            elif demand_track == "B" and approved_tracks.get("B", 0) > approved_tracks.get("A", 0):
                score += 2

            # 关键词匹配
            for topic in list(prefs.get("liked_topics", {}).keys())[:10]:
                if topic.lower() in demand_title:
                    score += 1

            # 排除用户不喜欢的方向
            for topic in list(prefs.get("disliked_topics", {}).keys())[:10]:
                if topic.lower() in demand_title:
                    score -= 2

            if score > best_score:
                best_score = score
                best_match = user_id

        return best_match if best_score > 0 else None

    # ── Local persistence ────────────────────────────────────────────

    def _load_local(self):
        if os.path.exists(self._local_path):
            try:
                with open(self._local_path, "r", encoding="utf-8") as f:
                    self._local_store = json.load(f)
            except (json.JSONDecodeError, IOError):
                self._local_store = {}
        else:
            self._local_store = {}

    def _save_local(self):
        try:
            os.makedirs(os.path.dirname(self._local_path), exist_ok=True)
            with open(self._local_path, "w", encoding="utf-8") as f:
                json.dump(self._local_store, f, ensure_ascii=False, indent=2)
        except IOError as e:
            logger.error(f"Failed to save local memory: {e}")

    # ── Public memory API (unified access for tools.py, dreaming.py) ────

    @property
    def memory_dir(self) -> str:
        return os.path.dirname(self._local_path)

    @property
    def memory_file(self) -> str:
        return self._local_path

    def load_memory_dict(self) -> dict:
        """Return the in-memory store (no file I/O). Reload from disk first to pick up external writes."""
        self._load_local()
        return self._local_store

    def save_memory_dict(self, data: dict | None = None):
        """Persist the memory dict. If data is provided, replace the store first."""
        if data is not None:
            self._local_store = data
        self._save_local()

    def add_memory(self, content: str, category: str = "general", **extra) -> int:
        """Append a memory entry and save. Returns total count."""
        self._load_local()  # Reload to avoid clobbering external writes
        entry = {
            "content": content,
            "category": category,
            "timestamp": datetime.utcnow().isoformat(),
            **extra,
        }
        self._local_store.setdefault("memories", []).append(entry)
        self._save_local()
        return len(self._local_store["memories"])

    def add_decision_record(self, decision: str, reasoning: str, **extra) -> int:
        """Append a decision entry and save. Returns total count."""
        self._load_local()
        entry = {
            "decision": decision,
            "reasoning": reasoning,
            "category": "decision",
            "timestamp": datetime.utcnow().isoformat(),
            **extra,
        }
        self._local_store.setdefault("decisions", []).append(entry)
        self._save_local()
        return len(self._local_store["decisions"])
