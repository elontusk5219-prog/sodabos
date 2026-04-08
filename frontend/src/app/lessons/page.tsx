"use client";
import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { Lesson, LessonInsights } from "@/lib/types";

// ── Constants ───────────────────────────────────────────────────────────────

const CATEGORIES = [
  { key: "", label: "全部" },
  { key: "product_direction", label: "产品方向" },
  { key: "tech_choice", label: "技术选型" },
  { key: "market_judgment", label: "市场判断" },
  { key: "execution", label: "执行问题" },
  { key: "other", label: "其他" },
];

const CATEGORY_NAMES: Record<string, string> = {
  product_direction: "产品方向",
  tech_choice: "技术选型",
  market_judgment: "市场判断",
  execution: "执行问题",
  other: "其他",
};

const SEVERITY_CONFIG: Record<string, { icon: string; label: string; color: string }> = {
  high: { icon: "\uD83D\uDD34", label: "严重", color: "bg-red-100 text-red-700" },
  medium: { icon: "\uD83D\uDFE1", label: "中等", color: "bg-yellow-100 text-yellow-700" },
  low: { icon: "\uD83D\uDFE2", label: "轻微", color: "bg-green-100 text-green-700" },
};

function formatDate(dateStr: string) {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    // Display in Beijing timezone
    return d.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch {
    return dateStr;
  }
}

// ── Create Modal ────────────────────────────────────────────────────────────

function CreateLessonModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("other");
  const [severity, setSeverity] = useState("medium");
  const [background, setBackground] = useState("");
  const [lesson, setLesson] = useState("");
  const [preventionRule, setPreventionRule] = useState("");
  const [relatedDemandIds, setRelatedDemandIds] = useState("");
  const [relatedProjectId, setRelatedProjectId] = useState("");
  const [saving, setSaving] = useState(false);
  const [learning, setLearning] = useState(false);
  const [error, setError] = useState("");

  async function handleSaveAndLearn() {
    if (!title.trim() || !lesson.trim()) {
      setError("请填写标题和教训内容");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const demandIds = relatedDemandIds
        .split(",")
        .map((s) => parseInt(s.trim()))
        .filter((n) => !isNaN(n));

      const result = await api.createLesson({
        title: title.trim(),
        category,
        severity,
        background: background.trim(),
        lesson: lesson.trim(),
        prevention_rule: preventionRule.trim(),
        related_demand_ids: demandIds,
        related_project_id: relatedProjectId ? parseInt(relatedProjectId) : undefined,
      });

      // Trigger deep learning
      setLearning(true);
      try {
        await api.learnLesson(result.id);
      } catch {
        // Non-critical
      }
      setLearning(false);

      onCreated();
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
      setLearning(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">新增教训</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
        </div>

        {error && <div className="bg-red-50 text-red-600 text-sm px-3 py-2 rounded">{error}</div>}

        {/* Title */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">标题 *</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="简洁描述这次教训"
          />
        </div>

        {/* Category & Severity */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">分类</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            >
              {CATEGORIES.filter((c) => c.key).map((c) => (
                <option key={c.key} value={c.key}>{c.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">严重程度</label>
            <div className="flex gap-3 mt-1">
              {(["high", "medium", "low"] as const).map((s) => (
                <label key={s} className="flex items-center gap-1 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="severity"
                    value={s}
                    checked={severity === s}
                    onChange={() => setSeverity(s)}
                    className="text-blue-600"
                  />
                  <span>{SEVERITY_CONFIG[s].icon} {SEVERITY_CONFIG[s].label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* Background */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">背景</label>
          <textarea
            value={background}
            onChange={(e) => setBackground(e.target.value)}
            rows={3}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            placeholder="发生了什么？当时的情况和决策背景..."
          />
        </div>

        {/* Lesson */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">教训内容 *</label>
          <textarea
            value={lesson}
            onChange={(e) => setLesson(e.target.value)}
            rows={4}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            placeholder="核心教训是什么？从中学到了什么？"
          />
        </div>

        {/* Prevention Rule */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">预防规则</label>
          <textarea
            value={preventionRule}
            onChange={(e) => setPreventionRule(e.target.value)}
            rows={2}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            placeholder="未来如何避免类似问题？具体的行动准则..."
          />
        </div>

        {/* Related IDs */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">关联需求 ID</label>
            <input
              value={relatedDemandIds}
              onChange={(e) => setRelatedDemandIds(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              placeholder="如 1,2,3 (逗号分隔)"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">关联项目 ID</label>
            <input
              value={relatedProjectId}
              onChange={(e) => setRelatedProjectId(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              placeholder="项目 ID"
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            取消
          </button>
          <button
            onClick={handleSaveAndLearn}
            disabled={saving || learning}
            className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {learning ? "Agent 学习中..." : saving ? "保存中..." : "保存并让 Agent 学习"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Detail Drawer ───────────────────────────────────────────────────────────

function LessonDetail({
  lesson,
  onClose,
}: {
  lesson: Lesson;
  onClose: () => void;
}) {
  const sev = SEVERITY_CONFIG[lesson.severity] || SEVERITY_CONFIG.medium;
  let demandIds: number[] = [];
  try {
    demandIds = JSON.parse(lesson.related_demand_ids || "[]");
  } catch {
    demandIds = [];
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={`text-xs px-2 py-0.5 rounded-full ${sev.color}`}>
              {sev.icon} {sev.label}
            </span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
              {CATEGORY_NAMES[lesson.category] || lesson.category}
            </span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
        </div>

        <h2 className="text-xl font-bold text-gray-900">{lesson.title}</h2>

        <div className="text-xs text-gray-400">
          {lesson.creator_name || "未知"} &middot; {formatDate(lesson.created_at)}
        </div>

        {lesson.background && (
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-1">背景</h3>
            <p className="text-sm text-gray-600 whitespace-pre-wrap">{lesson.background}</p>
          </div>
        )}

        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-1">教训</h3>
          <p className="text-sm text-gray-800 whitespace-pre-wrap bg-amber-50 p-3 rounded-lg">{lesson.lesson}</p>
        </div>

        {lesson.prevention_rule && (
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-1">预防规则</h3>
            <p className="text-sm text-gray-600 whitespace-pre-wrap bg-blue-50 p-3 rounded-lg">{lesson.prevention_rule}</p>
          </div>
        )}

        {(demandIds.length > 0 || lesson.related_project_id) && (
          <div className="flex gap-4 text-xs text-gray-500">
            {demandIds.length > 0 && (
              <span>关联需求: {demandIds.map((id) => `#${id}`).join(", ")}</span>
            )}
            {lesson.related_project_id && (
              <span>关联项目: #{lesson.related_project_id}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Page ───────────────────────────────────────────────────────────────

export default function LessonsPage() {
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [selectedLesson, setSelectedLesson] = useState<Lesson | null>(null);

  // Insights
  const [insights, setInsights] = useState<LessonInsights | null>(null);
  const [loadingInsights, setLoadingInsights] = useState(false);

  async function fetchLessons() {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (category) params.category = category;
      const data = await api.lessons(params);
      setLessons(data.lessons || []);
      setTotal(data.total || 0);
    } catch (e) {
      console.error("Failed to load lessons:", e);
    } finally {
      setLoading(false);
    }
  }

  async function fetchInsights() {
    setLoadingInsights(true);
    try {
      const data = await api.lessonInsights();
      setInsights(data);
    } catch (e) {
      console.error("Failed to load insights:", e);
    } finally {
      setLoadingInsights(false);
    }
  }

  useEffect(() => {
    fetchLessons();
  }, [category]);

  useEffect(() => {
    fetchInsights();
  }, []);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            <span className="mr-2">&#x1F4D6;</span>教训复盘
          </h1>
          <p className="text-sm text-gray-500 mt-1">记录教训、提炼规律、防止重蹈覆辙</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors"
        >
          + 新增教训
        </button>
      </div>

      {/* Category Tabs */}
      <div className="flex gap-2 flex-wrap">
        {CATEGORIES.map((c) => (
          <button
            key={c.key}
            onClick={() => setCategory(c.key)}
            className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
              category === c.key
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* Lessons List */}
      {loading ? (
        <div className="text-center py-12 text-gray-400">
          <div className="animate-spin inline-block w-6 h-6 border-2 border-blue-400 border-t-transparent rounded-full mb-2" />
          <p>加载中...</p>
        </div>
      ) : lessons.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <p className="text-4xl mb-2">&#x1F4D6;</p>
          <p>暂无教训记录</p>
          <p className="text-xs mt-1">点击「+ 新增教训」开始记录</p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-gray-400">共 {total} 条教训</p>
          {lessons.map((l) => {
            const sev = SEVERITY_CONFIG[l.severity] || SEVERITY_CONFIG.medium;
            return (
              <div
                key={l.id}
                onClick={() => setSelectedLesson(l)}
                className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow cursor-pointer"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${sev.color}`}>
                        {sev.icon} {sev.label}
                      </span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                        {CATEGORY_NAMES[l.category] || l.category}
                      </span>
                    </div>
                    <h3 className="font-semibold text-gray-900 mb-1">{l.title}</h3>
                    <p className="text-sm text-gray-600 line-clamp-2">{l.lesson}</p>
                  </div>
                  <div className="text-right text-xs text-gray-400 whitespace-nowrap">
                    <div>{l.creator_name || "未知"}</div>
                    <div>{formatDate(l.created_at)}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* AI Insights Section */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">
            <span className="mr-1">&#x1F9E0;</span>AI 洞察分析
          </h2>
          <button
            onClick={fetchInsights}
            disabled={loadingInsights}
            className="text-sm text-blue-600 hover:text-blue-700 disabled:opacity-50"
          >
            {loadingInsights ? "分析中..." : "刷新分析"}
          </button>
        </div>

        {!insights ? (
          <p className="text-sm text-gray-400">加载中...</p>
        ) : insights.total === 0 ? (
          <p className="text-sm text-gray-400">暂无数据，添加教训后可查看 AI 分析。</p>
        ) : (
          <div className="space-y-4">
            {/* Summary */}
            {insights.summary && (
              <p className="text-sm text-gray-700 bg-blue-50 p-3 rounded-lg">{insights.summary}</p>
            )}

            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {Object.entries(insights.categories).map(([name, count]) => (
                <div key={name} className="bg-gray-50 rounded-lg p-3 text-center">
                  <div className="text-lg font-bold text-gray-900">{count}</div>
                  <div className="text-xs text-gray-500">{name}</div>
                </div>
              ))}
            </div>

            {/* Patterns */}
            {insights.patterns.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-2">常见模式</h3>
                <ul className="space-y-1">
                  {insights.patterns.map((p, i) => (
                    <li key={i} className="text-sm text-gray-600 flex gap-2">
                      <span className="text-amber-500">&#x26A0;&#xFE0F;</span>
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Suggestions */}
            {insights.suggestions.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-2">改进建议</h3>
                <ul className="space-y-1">
                  {insights.suggestions.map((s, i) => (
                    <li key={i} className="text-sm text-gray-600 flex gap-2">
                      <span className="text-green-500">&#x1F4A1;</span>
                      {s}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modals */}
      {showCreate && (
        <CreateLessonModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            fetchLessons();
            fetchInsights();
          }}
        />
      )}

      {selectedLesson && (
        <LessonDetail
          lesson={selectedLesson}
          onClose={() => setSelectedLesson(null)}
        />
      )}
    </div>
  );
}
