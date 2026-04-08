"""
PM Skill 注册表 — 自动发现并注册所有技能。
"""
from agent.skills.base import PMSkill

_registry: "SkillRegistry | None" = None


class SkillRegistry:
    def __init__(self):
        self._skills: dict[str, PMSkill] = {}

    def register(self, skill: PMSkill):
        self._skills[skill.name] = skill

    def get(self, name: str) -> PMSkill | None:
        return self._skills.get(name)

    def list_skills(self) -> list[dict]:
        return [{"name": s.name, "description": s.description} for s in self._skills.values()]

    def all(self) -> list[PMSkill]:
        return list(self._skills.values())


def get_registry() -> SkillRegistry:
    global _registry
    if _registry is None:
        _registry = SkillRegistry()
        _auto_register(_registry)
    return _registry


def _auto_register(registry: SkillRegistry):
    """Import and register all built-in skills."""
    from agent.skills.user_research import UserResearchSkill
    from agent.skills.tam_analysis import TAMAnalysisSkill
    from agent.skills.competitive_battlecard import CompetitiveBattlecardSkill
    from agent.skills.positioning import PositioningSkill
    from agent.skills.write_prd import WritePRDSkill

    for cls in [UserResearchSkill, TAMAnalysisSkill, CompetitiveBattlecardSkill, PositioningSkill, WritePRDSkill]:
        registry.register(cls())
