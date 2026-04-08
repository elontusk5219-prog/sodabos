"use client";
import { useParams, useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { useApi } from "@/hooks/useApi";
import { api } from "@/lib/api";
import type { Project, ProjectMember, User } from "@/lib/types";

export default function ProjectSettingsPage() {
  const { id } = useParams();
  const router = useRouter();
  const pid = Number(id);

  // Backend returns flat object: {id, title, ..., members: [...], current_stage_info: [...]}
  const { data, loading, error, reload } = useApi<Project & { members: ProjectMember[] }>(
    () => api.project(pid),
    [pid],
  );

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Member management
  const [showAddModal, setShowAddModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<User[]>([]);
  const [searching, setSearching] = useState(false);
  const [addingMember, setAddingMember] = useState(false);
  const [removingId, setRemovingId] = useState<number | null>(null);

  // Archive
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [archiving, setArchiving] = useState(false);

  // Kill project
  const [showKillModal, setShowKillModal] = useState(false);
  const [killReason, setKillReason] = useState("");
  const [killCategory, setKillCategory] = useState("other");
  const [killing, setKilling] = useState(false);
  const [killError, setKillError] = useState("");

  // Backend returns flat object with members embedded, not {project, members}
  const project = data;
  const members = data?.members ?? [];

  useEffect(() => {
    if (project) {
      setTitle(project.title);
      setDescription(project.description || "");
    }
  }, [project]);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await api.updateProject(pid, { title, description });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      reload();
    } finally {
      setSaving(false);
    }
  };

  const handleSearchUsers = async (query: string) => {
    setSearchQuery(query);
    if (query.length < 1) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      const res = await api.projects({ search: query });
      // The user search might be part of a different endpoint.
      // We use the activity endpoint as a proxy to find usernames, or
      // in a real app there would be a user search endpoint.
      // For now, we'll handle this gracefully.
      setSearchResults(Array.isArray(res) ? res : []);
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  const handleAddMember = async (userId: number) => {
    setAddingMember(true);
    try {
      await api.addProjectMember(pid, userId);
      setShowAddModal(false);
      setSearchQuery("");
      setSearchResults([]);
      reload();
    } finally {
      setAddingMember(false);
    }
  };

  const handleRemoveMember = async (userId: number) => {
    setRemovingId(userId);
    try {
      await api.removeProjectMember(pid, userId);
      reload();
    } finally {
      setRemovingId(null);
    }
  };

  const handleArchive = async () => {
    setArchiving(true);
    try {
      await api.updateProject(pid, { status: "archived" });
      router.push("/projects");
    } finally {
      setArchiving(false);
    }
  };

  const handleKill = async () => {
    if (!killReason.trim()) return;
    setKilling(true);
    setKillError("");
    try {
      await api.killProject(pid, killReason.trim(), killCategory);
      router.push("/projects");
    } catch (e) {
      setKillError(e instanceof Error ? e.message : "操作失败，请重试");
    } finally {
      setKilling(false);
    }
  };

  if (loading) {
    return (
      <div className="animate-pulse space-y-6">
        <div className="h-10 bg-gray-200 rounded w-1/2" />
        <div className="h-32 bg-gray-200 rounded" />
        <div className="h-48 bg-gray-200 rounded" />
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
        {error || "加载失败"}
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-8">
      {/* Basic Info */}
      <section className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">基本信息</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">项目名称</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">项目描述</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
            />
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={saving || (title === project.title && description === (project.description || ""))}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-500 hover:bg-blue-600 rounded-lg disabled:opacity-50 transition-colors"
            >
              {saving ? "保存中..." : "保存"}
            </button>
            {saved && (
              <span className="text-sm text-green-600 flex items-center gap-1">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                已保存
              </span>
            )}
          </div>
        </div>
      </section>

      {/* Members Management */}
      <section className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">项目成员</h2>
          <button
            onClick={() => setShowAddModal(true)}
            className="px-3 py-1.5 text-sm font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
          >
            添加成员
          </button>
        </div>

        <div className="divide-y divide-gray-100">
          {members.map((m) => (
            <div key={m.id} className="flex items-center justify-between py-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center text-sm font-medium text-gray-600">
                  {(m.display_name || m.username || "?").slice(0, 1).toUpperCase()}
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    {m.display_name || m.username}
                  </p>
                  <p className="text-xs text-gray-400">
                    {m.role === "owner" ? "拥有者" : m.role === "admin" ? "管理员" : "成员"}
                  </p>
                </div>
              </div>
              {m.role !== "owner" && (
                <button
                  onClick={() => handleRemoveMember(m.user_id)}
                  disabled={removingId === m.user_id}
                  className="text-sm text-red-500 hover:text-red-700 disabled:opacity-50 transition-colors"
                >
                  {removingId === m.user_id ? "移除中..." : "移除"}
                </button>
              )}
            </div>
          ))}
          {members.length === 0 && (
            <p className="text-sm text-gray-400 py-4 text-center">暂无成员</p>
          )}
        </div>
      </section>

      {/* Add Member Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">添加成员</h3>
              <button
                onClick={() => {
                  setShowAddModal(false);
                  setSearchQuery("");
                  setSearchResults([]);
                }}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => handleSearchUsers(e.target.value)}
                placeholder="搜索用户名..."
                autoFocus
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div className="max-h-60 overflow-y-auto">
              {searching ? (
                <p className="text-sm text-gray-400 text-center py-4">搜索中...</p>
              ) : searchResults.length > 0 ? (
                <div className="divide-y divide-gray-100">
                  {searchResults
                    .filter((u) => !members.some((m) => m.user_id === u.id))
                    .map((u) => (
                      <div key={u.id} className="flex items-center justify-between py-2">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-xs font-medium text-gray-600">
                            {(u.display_name || u.username).slice(0, 1).toUpperCase()}
                          </div>
                          <span className="text-sm text-gray-700">{u.display_name || u.username}</span>
                        </div>
                        <button
                          onClick={() => handleAddMember(u.id)}
                          disabled={addingMember}
                          className="text-sm text-blue-500 hover:text-blue-700 disabled:opacity-50"
                        >
                          添加
                        </button>
                      </div>
                    ))}
                </div>
              ) : searchQuery.length > 0 ? (
                <p className="text-sm text-gray-400 text-center py-4">未找到用户</p>
              ) : (
                <p className="text-sm text-gray-400 text-center py-4">输入用户名开始搜索</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Kill Project */}
      <section className="bg-white border border-red-200 rounded-xl p-6 space-y-4">
        <h2 className="text-lg font-semibold text-red-600">砍掉项目</h2>
        <p className="text-sm text-gray-500">
          砍掉项目会永久标记为「已砍掉」，PM Agent 会学习砍掉原因，帮助未来做出更好的项目决策。
        </p>
        <button
          onClick={() => setShowKillModal(true)}
          className="px-4 py-2 text-sm font-medium text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors"
        >
          砍掉这个项目
        </button>
      </section>

      {/* Kill Modal */}
      {showKillModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-red-600">砍掉项目</h3>
              <button
                onClick={() => { setShowKillModal(false); setKillReason(""); setKillCategory("other"); }}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">砍掉原因分类</label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { value: "no_demand", label: "没有真实需求", emoji: "🎯" },
                  { value: "no_pmf", label: "找不到 PMF", emoji: "🔍" },
                  { value: "competition", label: "竞争太激烈", emoji: "⚔️" },
                  { value: "resource", label: "资源不足", emoji: "💰" },
                  { value: "pivot", label: "方向调整/Pivot", emoji: "🔄" },
                  { value: "other", label: "其他原因", emoji: "📝" },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setKillCategory(opt.value)}
                    className={`text-left px-3 py-2.5 rounded-lg border text-sm transition-colors ${
                      killCategory === opt.value
                        ? "border-red-400 bg-red-50 text-red-700 font-medium"
                        : "border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50"
                    }`}
                  >
                    <span className="mr-1.5">{opt.emoji}</span>
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                详细原因 <span className="text-red-500">*</span>
              </label>
              <p className="text-xs text-gray-400 mb-2">
                PM Agent 会从这个决策中学习，请尽量写清楚为什么砍掉
              </p>
              <textarea
                value={killReason}
                onChange={(e) => setKillReason(e.target.value)}
                placeholder="例: 经过2周验证，目标用户群体太小（TAM &lt; 500万），获客成本过高，ROI 算不过来..."
                rows={4}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-red-400 focus:border-transparent resize-none"
              />
            </div>

            {killError && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-600">
                {killError}
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => { setShowKillModal(false); setKillReason(""); setKillCategory("other"); setKillError(""); }}
                className="px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleKill}
                disabled={killing || !killReason.trim()}
                className="px-4 py-2 text-sm font-medium text-white bg-red-500 hover:bg-red-600 rounded-lg disabled:opacity-50 transition-colors"
              >
                {killing ? "处理中..." : "确认砍掉"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Archive (less destructive) */}
      <section className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
        <h2 className="text-sm font-medium text-gray-500">其他操作</h2>
        <p className="text-xs text-gray-400">归档项目仅从列表隐藏，不记录原因，可恢复。</p>
        {!showArchiveConfirm ? (
          <button
            onClick={() => setShowArchiveConfirm(true)}
            className="px-3 py-1.5 text-xs text-gray-500 bg-gray-50 hover:bg-gray-100 rounded-lg border border-gray-200 transition-colors"
          >
            归档项目
          </button>
        ) : (
          <div className="flex items-center gap-3">
            <button
              onClick={handleArchive}
              disabled={archiving}
              className="px-3 py-1.5 text-xs text-white bg-gray-500 hover:bg-gray-600 rounded-lg disabled:opacity-50 transition-colors"
            >
              {archiving ? "归档中..." : "确认归档"}
            </button>
            <button
              onClick={() => setShowArchiveConfirm(false)}
              className="px-3 py-1.5 text-xs text-gray-500 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
            >
              取消
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
