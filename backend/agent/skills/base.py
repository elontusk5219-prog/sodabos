"""
PM Skill 抽象基类。
每个技能是一个独立的分析能力，可被认知循环的执行阶段调用。
"""
from abc import ABC, abstractmethod
from typing import Any


class PMSkill(ABC):
    name: str = ""
    description: str = ""

    @abstractmethod
    async def execute(self, demand: dict, context: dict, memory: Any = None) -> dict:
        """
        Run the skill on a demand.

        Args:
            demand: demand row dict (title, description, scores, ai_analysis, etc.)
            context: additional context (other skill outputs, world state, etc.)
            memory: AgentMemory instance for querying preferences

        Returns:
            Structured output dict specific to this skill.
        """
        pass
